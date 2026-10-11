"""Shared pieces of the analysis nodes: prompts, evidence digests, drafted claims and the quote check.

The model only sees evidence through a digest that names each item by id, and may only cite those ids.
Code turns its drafts into Claims, then the gate keeps a claim only if its ids are valid and its quote is
really in the cited text."""

import re
import unicodedata
from collections.abc import Awaitable, Callable, Collection, Iterable, Sequence
from functools import cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.contracts import Claim, ResolvedEntities, SectionId
from app.contracts.common import Confidence
from app.contracts.ids import claim_id
from app.graph.provenance import EVIDENCE_REQUIRED, gate_claims
from app.graph.state import GraphState
from app.llm.limits import GATEWAY_MAX_OUTPUT_TOKENS
from app.llm.types import LLMBudgetError, LLMParseError, LLMResult, LLMTask
from app.nodes._fixture import excluded_ids
from app.nodes.base import NodeContext

PROMPTS = Path(__file__).parent / "prompts"
EXCERPT_CHARS = 700
# the gateway refuses inputs above a "conservative input limit"; calls of ~5.5k tokens went through
# and ones of ~7k did not, so the evidence part of a message is capped by characters
DIGEST_CHARS = 7500
# reply caps per call; the model reasons inside the same budget, and a cap hit means an empty or
# cut reply plus a paid repair call (seen live at 2000 for sections). Billing is per token used.
# The gateway refuses caps above ~4k ("outside the supported range" at 5000).
MAX_OUT_TOKENS = GATEWAY_MAX_OUTPUT_TOKENS
OUT_TOKENS = {
    "questions": 3000,
    "queries": 1500,
    "claims": 4000,
    "extract": 4000,
    "section": 4000,
    "risks": 4000,
}
MIN_QUOTE_CHARS = 12
QUOTE_MISSING = "quote not found verbatim in the cited evidence"


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftClaim(Draft):
    text: str = Field(description="One specific, checkable statement.")
    section: SectionId
    stance: Literal["pro", "con", "neutral"] = "neutral"
    label: Literal["extracted", "derived", "inferred", "hypothesis"]
    evidence_ids: list[str] = Field(default_factory=list)
    quote: str = Field(
        default="",
        description="Verbatim words copied from one cited evidence item; empty for a hypothesis.",
    )
    confidence: Confidence = "medium"


class DraftClaims(Draft):
    claims: list[DraftClaim] = Field(default_factory=list)


@cache
def prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8").strip()


def system_prompt(name: str) -> str:
    return f"{prompt('rules')}\n\n{prompt(name)}"


def fixture_run(state: GraphState) -> bool:
    """Runs on fixture entities keep the scaffolding outputs, so the stub pipeline stays testable."""
    entities = state.get("entities")
    return entities is None or entities.disease.id.startswith("FIXTURE:")


def usable_evidence(state: GraphState) -> set[str]:
    return set(state.get("evidence_ids", [])) - excluded_ids(state)


def instructions(ctx: NodeContext) -> str:
    texts = [c.text for c in ctx.corrections_for() if c.text.strip()]
    if not texts:
        return ""
    return "Reviewer instructions (follow them):\n" + "\n".join(f"- {t}" for t in texts)


def describe_program(state: GraphState) -> str:
    program = state["program"]
    entities: ResolvedEntities | None = state.get("entities")
    lines = [f"Indication: {program.indication}", f"Mechanism: {program.mechanism}"]
    for label, value in (
        ("Drug", program.drug_name),
        ("Modality", program.modality),
        ("Stage", program.stage),
        ("Route", program.route),
        ("Biomarkers", program.biomarkers),
        ("Preclinical results (from the user)", program.preclinical_results),
        ("User notes", program.notes),
    ):
        if value:
            lines.append(f"{label}: {value}")
    if not program.drug_name:
        # without a drug name the model adopts the best-known drug in the evidence as the program
        lines.append(
            "Drug: not named; the program is a new asset with this mechanism. Drugs named in the "
            "evidence are precedents or competitors, not this program."
        )
    if entities is not None:
        lines.append(f"Resolved disease: {entities.disease.label} ({entities.disease.id})")
        if entities.target:
            lines.append(f"Resolved target: {entities.target.label} ({entities.target.id})")
        if entities.drug:
            lines.append(f"Resolved drug: {entities.drug.label} ({entities.drug.id})")
        if entities.therapeutic_areas:
            lines.append(f"Therapeutic areas: {', '.join(entities.therapeutic_areas)}")
        if entities.mechanism_class:
            lines.append(f"Mechanism class: {entities.mechanism_class}")
    return "\n".join(lines)


RESULTS = re.compile(r"\b(?:Results|Findings)\s*:", re.I)


def clip_excerpt(text: str, chars: int) -> str:
    """Cut to `chars`. When a structured abstract's Results start past the halfway mark, keep a
    short opening plus the results: a plain cut would keep only the background."""
    if len(text) <= chars:
        return text
    found = RESULTS.search(text)
    if found and found.start() > chars // 2:
        head = text[: chars // 4].rsplit(" ", 1)[0]
        text = f"{head} … {text[found.start() :]}"
    return text[:chars] + " …" if len(text) > chars else text


async def digest(
    ctx: NodeContext,
    evidence_ids: Sequence[str],
    chars: int = EXCERPT_CHARS,
    budget: int = DIGEST_CHARS,
) -> tuple[str, list[str]]:
    """The evidence list a model may cite, best first, until the budget is spent; and the ids shown."""
    items = await ctx.store.evidence.get_many_evidence(list(evidence_ids))
    titles = {
        s.id: s.title
        for s in await ctx.store.evidence.get_sources(
            list(dict.fromkeys(e.source_id for e in items))
        )
    }
    blocks: list[str] = []
    shown: list[str] = []
    used = 0
    for e in items:
        text = clip_excerpt(" ".join(e.excerpt.split()), chars)
        where = f", {e.locator}" if e.locator else ""
        block = f"[{e.id}] {titles.get(e.source_id, 'unknown source')}{where}\n{text}"
        if shown and used + len(block) > budget:
            break
        blocks.append(block)
        shown.append(e.id)
        used += len(block) + 2
    return ("\n\n".join(blocks) if blocks else "(no evidence available)"), shown


async def ask_full[M: BaseModel](
    ctx: NodeContext,
    purpose: str,
    system: str,
    user: str,
    schema: type[M],
    max_tokens: int,
    shrinkable: bool = False,
) -> tuple[M | None, LLMResult | None]:
    """One structured model call. A failed call or unusable reply is logged, not fatal."""
    task = LLMTask(
        purpose=purpose,
        system=system,
        user=user,
        schema=schema,
        max_tokens=min(max(max_tokens, ctx.effort.max_tokens), MAX_OUT_TOKENS),
    )
    try:
        result = await ctx.llm.complete(task)
    except LLMBudgetError:
        raise
    except LLMParseError as exc:
        ctx.log(f"model reply unusable ({exc}); continuing without it", "warn")
        return None, None
    except Exception as exc:  # a refused or failed call costs this answer, not the whole node
        if shrinkable and TOO_LONG.search(str(exc)):
            raise _TooLong from exc
        ctx.log(f"model call failed ({str(exc)[:300]}); continuing without it", "warn")
        return None, None
    parsed = result.parsed
    return (parsed if isinstance(parsed, schema) else None), result


async def ask[M: BaseModel](
    ctx: NodeContext, purpose: str, system: str, user: str, schema: type[M], max_tokens: int
) -> M | None:
    return (await ask_full(ctx, purpose, system, user, schema, max_tokens))[0]


class _TooLong(Exception):
    pass


# the gateway's input limit is not documented, so a refused input is retried smaller
SHRINK = (1.0, 0.6, 0.35)
TOO_LONG = re.compile(r"input limit|context length|maximum context|too many tokens", re.I)
Build = Callable[[float], Awaitable[tuple[str, list[str]]]]


async def ask_fitted[M: BaseModel](
    ctx: NodeContext, purpose: str, system: str, build: Build, schema: type[M], max_tokens: int
) -> tuple[M | None, LLMResult | None, list[str]]:
    """ask_full with a user message built at a scale; returns the evidence ids the model saw."""
    for i, scale in enumerate(SHRINK):
        user, shown = await build(scale)
        last = i == len(SHRINK) - 1
        try:
            parsed, result = await ask_full(
                ctx, purpose, system, user, schema, max_tokens, shrinkable=not last
            )
        except _TooLong:
            ctx.log(
                f"{purpose}: input too long for the gateway ({len(system) + len(user)} chars); "
                f"retrying at {SHRINK[i + 1]:.0%}",
                "warn",
            )
            continue
        return parsed, result, shown
    return None, None, []


def to_claims(
    drafts: Iterable[DraftClaim], produced_by: str, stance: str | None = None
) -> tuple[list[Claim], dict[str, str]]:
    """Drafts -> Claims with content-addressed ids, plus each claim's quote for the gate."""
    claims: dict[str, Claim] = {}
    quotes: dict[str, str] = {}
    for d in drafts:
        text = " ".join(d.text.split())
        if not text:
            continue
        cid = claim_id(produced_by, text)
        claims[cid] = Claim(
            id=cid,
            text=text,
            section=d.section,
            stance=stance or d.stance,  # type: ignore[arg-type]
            label=d.label,
            evidence_ids=list(dict.fromkeys(d.evidence_ids)),
            confidence="low" if d.label == "hypothesis" else d.confidence,
            produced_by=produced_by,
        )
        quotes[cid] = d.quote
    return list(claims.values()), quotes


def _norm(text: str) -> str:
    # models write typographic dashes and quotes where the source has plain ones, and vice versa
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[‐‑‒–—―−]", "-", text)
    text = re.sub(r"[\"'“”‘’`]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def quote_found(quote: str, excerpts: Iterable[str]) -> bool:
    """The quote is in a cited excerpt, or it joins fragments (with an ellipsis or a semicolon,
    often one from each cited item) that are each verbatim in some cited excerpt."""
    texts = [_norm(x) for x in excerpts]
    whole = _norm(quote).strip(" .,;:")
    if len(whole) >= MIN_QUOTE_CHARS and any(whole in t for t in texts):
        return True
    parts = [p.strip(" .,;:") for p in re.split(r"…|\.\.\.|;", _norm(quote))]
    parts = [p for p in parts if p]
    # every fragment must be long enough to be a quote on its own: "survival; placebo; patients"
    # would otherwise pass on words that occur anywhere
    if len(parts) < 2 or any(len(p) < MIN_QUOTE_CHARS for p in parts):
        return False
    return all(any(p in t for t in texts) for p in parts)


async def gate(
    ctx: NodeContext,
    claims: Iterable[Claim],
    quotes: dict[str, str],
    valid: Collection[str],
) -> dict[str, Claim]:
    """gate_claims (ids exist in the run) plus the quote check; a failed quote downgrades to unknown."""
    gated = gate_claims(claims, valid)
    cited = {i for c in gated.values() for i in c.evidence_ids}
    items = await ctx.store.evidence.get_many_evidence(list(cited))
    sources = await ctx.store.evidence.get_sources(list({e.source_id for e in items}))
    titles = {s.id: s.title for s in sources}
    # the digest shows each item under its source title (a trial's official title, a paper's
    # title), so a quote from the title is a quote from what the model was given
    excerpts = {e.id: f"{titles.get(e.source_id, '')}\n{e.excerpt}" for e in items}
    out: dict[str, Claim] = {}
    for cid, c in gated.items():
        if c.status != "rejected" and c.label in EVIDENCE_REQUIRED:
            if not quote_found(quotes.get(cid, ""), (excerpts.get(i, "") for i in c.evidence_ids)):
                c = c.model_copy(
                    update={
                        "status": "downgraded",
                        "label": "unknown",
                        "confidence": "low",
                        "rejection_reason": QUOTE_MISSING,
                    }
                )
        out[cid] = c
    return out


def dump_drafts(claims: Sequence[Claim], quotes: dict[str, str], **extra: object) -> dict:
    return {"claims": [c.model_dump(mode="json") for c in claims], "quotes": quotes, **extra}


def load_drafts(scratch: dict) -> tuple[list[Claim], dict[str, str]]:
    return [Claim.model_validate(c) for c in scratch.get("claims", [])], dict(
        scratch.get("quotes", {})
    )


def tally(claims: dict[str, Claim]) -> str:
    counts: dict[str, int] = {}
    for c in claims.values():
        counts[c.status] = counts.get(c.status, 0) + 1
    return ", ".join(f"{n} {s}" for s, n in sorted(counts.items())) or "no claims"
