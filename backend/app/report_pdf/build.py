"""The underwriting report as a PDF file, built on the server from the report itself.

It does not depend on a browser's print dialog: the same document comes out on every machine. Text is real
text (selectable, searchable), every claim carries its label, confidence and numbered sources, and the
numbered source list at the end gives the URL of each, so the drill-down Recommendation -> Claims ->
Evidence -> Sources survives on paper."""

import io
from collections.abc import Sequence
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.contracts import Claim, Range, SectionId, UnderwritingReport

FONTS = Path(__file__).resolve().parents[1] / "assets" / "fonts"
INK, MUTED, LINE = (
    colors.HexColor("#0b1130"),
    colors.HexColor("#4d5573"),
    colors.HexColor("#cdd4e6"),
)
BRAND, PAPER = colors.HexColor("#2f55b5"), colors.HexColor("#f6f7fb")
GOOD, BAD, WARN = colors.HexColor("#059669"), colors.HexColor("#dc2626"), colors.HexColor("#d97706")
GOOD_BG, BAD_BG, WARN_BG = (
    colors.HexColor("#ecfdf5"),
    colors.HexColor("#fef2f2"),
    colors.HexColor("#fffbeb"),
)
WIDTH = A4[0] - 32 * mm

# the four questions an investor asks, and where each report section and risk belongs (as in the UI)
QUESTIONS = (
    ("works", "Will it work in people?", ("scientific_thesis", "translation"), ("efficacy", "pk_exposure"), "efficacy"),
    ("approval", "Will it get through trials and regulators?", ("safety", "clinical_plan"), ("safety", "regulatory", "cmc"), "safety"),
    ("uptake", "Will it actually be used?", ("disease_need", "competition", "commercial_adoption"), ("commercial", "ip"), None),
    ("funding", "Is funding it to the next milestone worth it?", ("capital",), (), None),
)  # fmt: skip
SECTION_ORDER: tuple[SectionId, ...] = (
    "disease_need",
    "scientific_thesis",
    "translation",
    "safety",
    "clinical_plan",
    "competition",
    "commercial_adoption",
    "capital",
    "risks",
)
CONFIDENCE_WEIGHT = {"high": 3, "medium": 2, "low": 1}
RATING_STANDING = {
    "strong": "favourable",
    "moderate": "mixed",
    "weak": "unfavourable",
    "concerning": "unfavourable",
}
STANDING_COLOR = {
    "favourable": GOOD,
    "mixed": WARN,
    "unfavourable": BAD,
    "unknown": MUTED,
}
STANDING_LABEL = {
    "favourable": "Favourable",
    "mixed": "Mixed",
    "unfavourable": "Unfavourable",
    "unknown": "Not enough evidence",
}
DECISION = {"invest": "Invest", "conditional": "Conditional", "do_not_invest": "Do not invest"}
DECISION_COLOR = {"invest": GOOD, "conditional": WARN, "do_not_invest": BAD}
LABELS = ("extracted", "derived", "inferred", "modeled", "hypothesis", "unknown")
QUOTE_CHARS = 230


def _register_fonts() -> None:
    if "DejaVu" in pdfmetrics.getRegisteredFontNames():
        return
    for name, file in (
        ("DejaVu", "DejaVuSans.ttf"),
        ("DejaVu-Bold", "DejaVuSans-Bold.ttf"),
        ("DejaVu-Italic", "DejaVuSans-Oblique.ttf"),
        ("DejaVu-BoldItalic", "DejaVuSans-BoldOblique.ttf"),
    ):
        pdfmetrics.registerFont(TTFont(name, str(FONTS / file)))
    registerFontFamily(
        "DejaVu",
        normal="DejaVu",
        bold="DejaVu-Bold",
        italic="DejaVu-Italic",
        boldItalic="DejaVu-BoldItalic",
    )


def _style(name: str, size: float = 8.6, **kw) -> ParagraphStyle:
    base = {
        "fontName": "DejaVu",
        "fontSize": size,
        "leading": size * 1.42,
        "textColor": INK,
        "alignment": TA_LEFT,
    }
    return ParagraphStyle(name, **{**base, **kw})


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "body": _style("body"),
        "small": _style("small", 7.4, textColor=MUTED),
        "title": _style("title", 20, fontName="DejaVu-Bold", leading=24),
        "h1": _style("h1", 13.5, fontName="DejaVu-Bold", leading=17, spaceBefore=14, spaceAfter=5),
        "h2": _style("h2", 10.5, fontName="DejaVu-Bold", leading=14, spaceBefore=9, spaceAfter=3),
        "h3": _style(
            "h3", 7.6, fontName="DejaVu-Bold", textColor=MUTED, spaceBefore=6, spaceAfter=2
        ),
        "big": _style("big", 28, fontName="DejaVu-Bold", leading=32),
        "label": _style("label", 7, textColor=MUTED),
        "claim": _style("claim", 8.6, spaceAfter=1),
        "quote": _style(
            "quote", 7.4, fontName="DejaVu-Italic", textColor=MUTED, leftIndent=8, spaceAfter=2
        ),
    }


def esc(text: object) -> str:
    return escape(" ".join(str(text).split()))


def pct(x: float) -> str:
    return f"{x * 100:.{1 if x < 0.1 else 0}f}%"


def usd(x: float) -> str:
    sign, x = ("-", -x) if x < 0 else ("", x)
    for size, unit, digits in ((1e9, "B", 1), (1e6, "M", 1), (1e3, "K", 0)):
        if x >= size:
            return f"{sign}${x / size:.{digits}f}{unit}"
    return f"{sign}${x:.0f}"


def _range(r: Range, fmt) -> str:
    return f"{fmt(r.base)}  (range {fmt(r.low)} to {fmt(r.high)})"


def _clip(text: str, n: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


class SourceNumbers:
    """Sources are numbered the first time something cites them; the list at the end uses the same numbers."""

    def __init__(self, report: UnderwritingReport) -> None:
        self.report = report
        self.order: list[str] = []

    def of(self, evidence_ids: Sequence[str]) -> list[int]:
        numbers: list[int] = []
        for eid in evidence_ids:
            evidence = self.report.evidence.get(eid)
            if evidence is None or evidence.source_id not in self.report.sources:
                continue
            if evidence.source_id not in self.order:
                self.order.append(evidence.source_id)
            n = self.order.index(evidence.source_id) + 1
            if n not in numbers:
                numbers.append(n)
        return numbers


def _refs(numbers: Sequence[int]) -> str:
    return "".join(f' <font color="#2f55b5" size="7">[{n}]</font>' for n in numbers)


def _claim_weight(c: Claim) -> float:
    if c.status == "rejected":
        return 0.0
    return CONFIDENCE_WEIGHT[c.confidence] * (0.5 if c.status == "downgraded" else 1.0)


def _question_of_claim(report: UnderwritingReport) -> dict[str, str]:
    """Claim id -> question id, by report section, or by the risk a risk claim backs."""
    by_section = {s: q[0] for q in QUESTIONS for s in q[2]}
    by_category = {c: q[0] for q in QUESTIONS for c in q[3]}
    risk_of = {}
    for risk in report.key_risks:
        for cid in risk.claim_ids:
            risk_of.setdefault(cid, risk.category)
    out = {}
    for claim in report.claims.values():
        q = by_section.get(claim.section) or by_category.get(risk_of.get(claim.id, ""))
        if q:
            out[claim.id] = q
    return out


def _standing(
    report: UnderwritingReport, cause: str | None, pros: list[Claim], cons: list[Claim]
) -> str:
    rated = next((a for a in report.assessments if a.cause == cause), None) if cause else None
    if rated and rated.rating in RATING_STANDING:
        return RATING_STANDING[rated.rating]
    pro, con = sum(map(_claim_weight, pros)), sum(map(_claim_weight, cons))
    if pro + con == 0:
        return "unknown"
    lean = (pro - con) / (pro + con)
    return "favourable" if lean >= 0.4 else "unfavourable" if lean <= -0.4 else "mixed"


def _pill(text: str, color, align: str = "LEFT") -> Table:
    width = pdfmetrics.stringWidth(text, "DejaVu-Bold", 8) + 16
    t = Table(
        [[Paragraph(f'<font color="#ffffff"><b>{esc(text)}</b></font>', _style("pill", 8))]],
        colWidths=[width],
        hAlign=align,
    )
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), color),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return t


def _box(content, bg, edge, width: float) -> Table:
    t = Table([[content]], colWidths=[width])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, -1), 2.2, edge),
                ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def _claim_flowables(
    claim: Claim, report: UnderwritingReport, nums: SourceNumbers, s, quotes: bool
):
    meta = f"{claim.stance} · {claim.label} · {claim.confidence} confidence"
    if claim.status != "accepted":
        meta += f" · {claim.status}"
    refs = _refs(nums.of(claim.evidence_ids))
    out = [
        Paragraph(
            f"{esc(claim.text)}{refs}<br/><font size='7' color='#4d5573'>{esc(meta)}</font>",
            s["claim"],
        )
    ]
    if claim.rejection_reason:
        out.append(
            Paragraph(f"Rejected by the evidence gate: {esc(claim.rejection_reason)}", s["quote"])
        )
    if quotes:
        for eid in claim.evidence_ids[:2]:
            e = report.evidence.get(eid)
            src = report.sources.get(e.source_id) if e else None
            if e and src:
                where = f", {e.locator}" if e.locator else ""
                out.append(
                    Paragraph(
                        f"“{esc(_clip(e.excerpt, QUOTE_CHARS))}” — {esc(_clip(src.title, 80))}{esc(where)}",
                        s["quote"],
                    )
                )
    return out


def _two_columns(left, right, gap: float = 6.0) -> Table:
    half = (WIDTH - gap) / 2
    t = Table([[left, right]], colWidths=[half, half], hAlign="LEFT")
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), gap), ("RIGHTPADDING", (1, 0), (1, 0), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))  # fmt: skip
    return t


def _side(title: str, claims: list[Claim], report, nums, s, good: bool, width: float):
    inner = [
        Paragraph(f"<b>{esc(title)}</b>", _style("side", 8.6, textColor=GOOD if good else BAD))
    ]
    if not claims:
        inner.append(Paragraph("<i>Nothing found on this side.</i>", s["small"]))
    for claim in claims:
        inner.extend(_claim_flowables(claim, report, nums, s, quotes=False))
    return _box(inner, GOOD_BG if good else BAD_BG, GOOD if good else BAD, width)


def _steps_chart(report: UnderwritingReport) -> Drawing | None:
    ledger = report.ledger
    if not ledger or not ledger.steps:
        return None
    rows, before = [], ledger.prior.base
    for step in ledger.steps:
        rows.append((step.factor, (step.pos_after.base - before) * 100))
        before = step.pos_after.base
    reach = max(1.0, *(abs(p) for _, p in rows))
    row_h, label_w, bar_w = 14, 215, 190
    d = Drawing(WIDTH, row_h * len(rows) + 6)
    mid = label_w + bar_w / 2
    d.add(Line(mid, 0, mid, row_h * len(rows) + 2, strokeColor=MUTED, strokeWidth=0.4))
    for i, (factor, pts) in enumerate(rows):
        y = row_h * (len(rows) - 1 - i) + 2
        d.add(String(0, y + 2.5, _clip(factor, 60), fontName="DejaVu", fontSize=7.2, fillColor=INK))
        w = abs(pts) / reach * (bar_w / 2)
        d.add(
            Rect(
                mid if pts >= 0 else mid - w,
                y,
                max(w, 0.8),
                8,
                fillColor=GOOD if pts >= 0 else BAD,
                strokeColor=None,
            )
        )
        d.add(
            String(
                label_w + bar_w + 8,
                y + 2.5,
                f"{pts:+.1f} pts",
                fontName="DejaVu",
                fontSize=7.2,
                fillColor=MUTED,
            )
        )
    return d


def _mix_chart(report: UnderwritingReport) -> tuple[Drawing, str] | None:
    counted = [c for c in report.claims.values() if c.status != "rejected"]
    if not counted:
        return None
    palette = {"extracted": "#059669", "derived": "#14b8a6", "inferred": "#0ea5e9", "modeled": "#818cf8", "hypothesis": "#fbbf24", "unknown": "#b9c1d8"}  # fmt: skip
    d, x = Drawing(WIDTH, 12), 0.0
    parts = []
    for label in LABELS:
        n = sum(c.label == label for c in counted)
        if n:
            w = WIDTH * n / len(counted)
            d.add(Rect(x, 0, w, 10, fillColor=colors.HexColor(palette[label]), strokeColor=None))
            x += w
            parts.append(f"{label} {n}")
    grounded = sum(c.label in ("extracted", "derived") for c in counted) / len(counted)
    return (
        d,
        f"{pct(grounded)} of the {len(counted)} counted claims are read from a source or computed from one ({', '.join(parts)}).",
    )


def _footer(report: UnderwritingReport):
    def draw(canvas, doc):
        canvas.saveState()
        canvas.setFont("DejaVu", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(
            16 * mm,
            9 * mm,
            f"Unobio underwriting · {report.program.mechanism} in {report.program.indication} · run {report.run_id}",
        )
        canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"Page {doc.page}")
        if report.meta.synthetic:
            canvas.setFillColor(BAD)
            canvas.setFont("DejaVu-Bold", 7)
            canvas.drawString(
                16 * mm,
                A4[1] - 9 * mm,
                "Synthetic data: this report contains placeholder content and is not an assessment of a real program.",
            )
        canvas.restoreState()

    return draw


def build_report_pdf(report: UnderwritingReport) -> bytes:
    _register_fonts()
    s = _styles()
    nums = SourceNumbers(report)
    verdict, flow = report.verdict, []
    program = f"{report.program.mechanism} in {report.program.indication}"

    # ---- the call
    flow += [
        Paragraph("UNOBIO · DRUG PROGRAM UNDERWRITING REPORT", s["label"]),
        Paragraph(esc(program), s["title"]),
    ]
    extra = " · ".join(
        x.replace("_", " ")
        for x in (report.program.drug_name, report.program.modality, report.program.stage)
        if x
    )
    if extra:
        flow.append(Paragraph(esc(extra), s["small"]))
    flow.append(Spacer(1, 8))
    figures = [
        [
            Paragraph("Probability of success", s["label"]),
            Paragraph(pct(report.pos.base), s["big"]),
            Paragraph(f"range {pct(report.pos.low)} to {pct(report.pos.high)}", s["small"]),
        ]
    ]
    left = [
        _pill(DECISION[verdict.decision], DECISION_COLOR[verdict.decision]),
        Spacer(1, 3),
        Paragraph(f"{esc(verdict.confidence)} confidence", s["small"]),
        Spacer(1, 6),
        *figures[0],
    ]
    right = []
    if report.valuation:
        v = report.valuation
        right = [
            Paragraph("Risk-adjusted value", s["label"]), Paragraph(f"<b>{esc(_range(v.rnpv, usd))}</b>", s["body"]), Spacer(1, 4),
            Paragraph("Capital to the next milestone", s["label"]), Paragraph(f"<b>{esc(_range(v.capital_to_milestone, usd))}</b>", s["body"]), Spacer(1, 4),
            Paragraph(f"Time to {esc(v.next_milestone)}", s["label"]), Paragraph(f"<b>{v.time_to_milestone_months.base:.0f} months</b> (range {v.time_to_milestone_months.low:.0f} to {v.time_to_milestone_months.high:.0f})", s["body"]),
        ]  # fmt: skip
    flow.append(_two_columns(left, right))
    flow += [Spacer(1, 6), Paragraph(esc(verdict.rationale), s["body"]), Spacer(1, 6)]
    carries = [r for r in verdict.reason_codes if r.direction == "positive"]
    holds = [r for r in verdict.reason_codes if r.direction != "positive"]

    def reasons(title, items, good):
        inner = [Paragraph(f"<b>{title}</b>", _style("rs", 8.6, textColor=GOOD if good else BAD))]
        inner += [
            Paragraph(
                f"• {esc(r.text)}{_refs(nums.of([e for c in r.claim_ids[:1] for e in (report.claims[c].evidence_ids if c in report.claims else [])]))}",
                s["claim"],
            )
            for r in items
        ] or [Paragraph("<i>None the verdict leaned on.</i>", s["small"])]
        return _box(inner, GOOD_BG if good else BAD_BG, GOOD if good else BAD, (WIDTH - 6) / 2)

    flow.append(
        _two_columns(
            reasons("What carries it", carries, True), reasons("What holds it back", holds, False)
        )
    )
    if verdict.conditions:
        flow += [Paragraph("To proceed", s["h2"])] + [
            Paragraph(f"• {esc(c)}", s["body"]) for c in verdict.conditions
        ]

    # ---- the four questions
    flow.append(Paragraph("The case, question by question", s["h1"]))
    of_claim = _question_of_claim(report)
    for qid, title, sections, _cats, cause in QUESTIONS:
        mine = [c for c in report.claims.values() if of_claim.get(c.id) == qid]
        live = [c for c in mine if c.status != "rejected"]
        key = lambda c: -_claim_weight(c)  # noqa: E731
        pros = sorted((c for c in live if c.stance == "pro"), key=key)
        cons = sorted((c for c in live if c.stance == "con"), key=key)
        neutral = sorted((c for c in live if c.stance == "neutral"), key=key)
        standing = _standing(report, cause, pros, cons)
        rated = next((a for a in report.assessments if a.cause == cause), None) if cause else None
        lead = (
            rated.headline
            if rated and rated.headline
            else next(
                (
                    report.sections[x].summary
                    for x in sections
                    if x in report.sections and report.sections[x].summary.strip()
                ),
                "Public evidence did not answer this.",
            )
        )
        head = Table(
            [
                [
                    Paragraph(f"<b>{esc(title)}</b>", s["h2"]),
                    _pill(STANDING_LABEL[standing], STANDING_COLOR[standing], "RIGHT"),
                ]
            ],
            colWidths=[WIDTH - 110, 110],
        )
        head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))  # fmt: skip
        half = (WIDTH - 6) / 2
        block = [
            head,
            Paragraph(esc(_clip(lead, 320)), s["body"]),
            Spacer(1, 3),
            _two_columns(
                _side("For", pros, report, nums, s, True, half),
                _side("Against", cons, report, nums, s, False, half),
            ),
        ]
        flow.append(KeepTogether(block[:3]))
        flow += block[3:]
        if neutral:
            flow.append(Paragraph("Also noted", s["h3"]))
            for c in neutral:
                flow.extend(_claim_flowables(c, report, nums, s, quotes=False))
        unknowns = [
            u for x in sections if x in report.sections for u in report.sections[x].unknowns
        ]
        if unknowns:
            flow.append(
                Paragraph("What we could not establish: " + esc("; ".join(unknowns)), s["small"])
            )
        flow.append(Spacer(1, 6))

    # ---- the numbers
    flow.append(Paragraph("The numbers behind it", s["h1"]))
    chart = _steps_chart(report)
    if chart and report.ledger:
        flow += [
            Paragraph(
                f"How the chance of success was built: from {pct(report.ledger.prior.base)} (range {pct(report.ledger.prior.low)} to {pct(report.ledger.prior.high)}) to {pct(report.pos.base)}. Each bar is the points one piece of evidence added or took away.",
                s["body"],
            ),
            Spacer(1, 4),
            chart,
        ]
    for a in report.assessments:
        rows = [
            [
                Paragraph(esc(m.label), s["small"]),
                Paragraph(
                    f"{m.value:g} {esc(m.unit or '')}" if m.value is not None else "–", s["small"]
                ),
                Paragraph(esc(m.basis), s["small"]),
            ]
            for m in a.metrics
        ]
        flow.append(
            Paragraph(f"{a.cause.capitalize()} check: {esc(a.rating)}. {esc(a.headline)}", s["h2"])
        )
        if rows:
            t = Table(rows, colWidths=[WIDTH * 0.62, WIDTH * 0.2, WIDTH * 0.18])
            t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))  # fmt: skip
            flow.append(t)
        if a.gaps:
            flow.append(Paragraph("Could not check: " + esc("; ".join(a.gaps)), s["small"]))
    if report.twin_stats:
        t = report.twin_stats
        flow.append(
            Paragraph(
                f"Similar programs: {t.n_programs} matched on {esc(t.match_level.replace('_', ' '))}; starting chance {esc(_range(t.prior_pos, pct))}.",
                s["body"],
            )
        )
        rows = [
            [
                Paragraph(f"<b>{esc(w.drug)}</b>", s["small"]),
                Paragraph(esc(w.disease), s["small"]),
                Paragraph(esc(w.max_stage), s["small"]),
                Paragraph(esc(w.status), s["small"]),
            ]
            for w in t.twins[:10]
        ]
        if rows:
            tw = Table(rows, colWidths=[WIDTH * 0.25, WIDTH * 0.3, WIDTH * 0.25, WIDTH * 0.2])
            tw.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))  # fmt: skip
            flow += [Spacer(1, 3), tw]
    mix = _mix_chart(report)
    if mix:
        flow += [
            Paragraph("How solid the evidence is", s["h2"]),
            mix[0],
            Spacer(1, 3),
            Paragraph(esc(mix[1]), s["small"]),
        ]

    # ---- every section, with its claims and the quotes behind them
    flow.append(Paragraph("The report, section by section", s["h1"]))
    for sid in SECTION_ORDER:
        sec = report.sections.get(sid)
        if sec is None:
            continue
        flow += [
            Paragraph(
                f"{esc(sec.title)} <font size='7.5' color='#4d5573'>({esc(sec.status.replace('_', ' '))})</font>",
                s["h2"],
            ),
            Paragraph(esc(sec.summary), s["body"]),
        ]
        claims = sorted(
            (c for c in report.claims.values() if c.section == sid),
            key=lambda c: (c.status == "rejected", -_claim_weight(c)),
        )
        for c in claims:
            flow.append(
                KeepTogether(_claim_flowables(c, report, nums, s, quotes=True) + [Spacer(1, 3)])
            )
        if sec.unknowns:
            flow.append(
                Paragraph(
                    "What we could not establish: " + esc("; ".join(sec.unknowns)), s["small"]
                )
            )

    # ---- risks, unknowns, questions
    flow.append(Paragraph("Risks and what we do not know", s["h1"]))
    for r in sorted(report.key_risks, key=lambda r: ("high", "medium", "low").index(r.severity)):
        flow.append(
            Paragraph(f"• <b>{esc(r.severity)}</b> ({esc(r.category)}): {esc(r.text)}", s["body"])
        )
    for u in report.critical_unknowns:
        flow.append(Paragraph(f"• <i>Unknown:</i> {esc(u)}", s["body"]))
    if report.diligence_questions:
        flow.append(Paragraph("Questions to ask before committing", s["h2"]))
        for q in sorted(report.diligence_questions, key=lambda q: q.priority):
            flow.append(
                Paragraph(
                    f"{q.priority}. <b>{esc(q.question)}</b><br/><font size='7.4' color='#4d5573'>{esc(q.why_it_matters)}</font>",
                    s["claim"],
                )
            )

    # ---- the sources, numbered as cited
    flow.append(Paragraph("Sources", s["h1"]))
    flow.append(
        Paragraph(
            "Numbers in square brackets above refer to this list. Every source was retrieved through its public API or supplied by the user.",
            s["small"],
        )
    )
    for i, sid in enumerate(nums.order, start=1):
        src = report.sources[sid]
        ids = ", ".join(f"{k} {v}" for k, v in src.identifiers.items() if k != "chunks")
        line = (
            f"[{i}] <b>{esc(_clip(src.title, 140))}</b> — {esc(src.publisher)}, {esc(src.type.replace('_', ' '))}"
            + (f" ({esc(ids)})" if ids else "")
        )
        if src.url:
            line += f"<br/><font size='7' color='#2f55b5'>{esc(src.url)}</font>"
        flow.append(Paragraph(line, s["claim"]))
    m = report.meta
    flow += [
        Paragraph("Run details", s["h1"]),
        Paragraph(
            f"Run {esc(report.run_id)} · {esc(', '.join(m.models_used) or 'no model')} · effort {esc(m.effort)} · "
            f"{m.tokens_in:,} tokens in, {m.tokens_out:,} out · cost {'unknown' if m.cost_usd is None else f'${m.cost_usd:.2f}'} · "
            f"{m.duration_s:.0f} s · created {m.created_at:%Y-%m-%d %H:%M} UTC",
            s["small"],
        ),
    ]

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=15 * mm,
        bottomMargin=16 * mm,
        title=f"{program}: underwriting report",
        author="Unobio underwriting",
    )
    footer = _footer(report)
    doc.build(flow, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
