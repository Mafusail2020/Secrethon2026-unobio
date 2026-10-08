"""API payloads -> SourceRef + Evidence. Excerpts are verbatim text or a plain rendering of the
structured record they come from; the claim gate matches quotes against them."""

import re
from datetime import datetime
from typing import Any

from app.contracts import Evidence, SourceRef, utcnow
from app.contracts.ids import evidence_id, source_id

OT_RELEASE = "Open Targets Platform 26.09"
ABSTRACT_MAX = 4000
MAX_OUTCOMES = 2
CHUNK_CHARS = 1500
DRUGS_FDA_URL = (
    "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo="
)

_SALTS = {
    *("hydrochloride", "hcl", "dihydrochloride", "sodium", "disodium", "potassium", "calcium"),
    *("mesylate", "dimesylate", "besylate", "maleate", "tartrate", "bitartrate", "succinate"),
    *("acetate", "sulfate", "citrate", "phosphate", "fumarate", "hydrobromide", "bromide"),
    *("chloride", "monohydrate", "hydrate", "tosylate", "lactate", "magnesium"),
}


def parent_name(name: str) -> str:
    """Salt forms are separate ChEMBL drugs (inclisiran vs inclisiran sodium) and parentId is
    often missing, so collapse by name."""
    words = name.lower().split()
    while len(words) > 1 and words[-1] in _SALTS:
        words.pop()
    return " ".join(words)


def _date(text: str | None) -> datetime | None:
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y%m%d", "%Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _evidence(
    source: SourceRef,
    excerpt: str,
    locator: str,
    entity_ids: list[str],
    data: dict[str, Any] | None = None,
) -> Evidence:
    return Evidence(
        id=evidence_id(source.id, excerpt, locator),
        source_id=source.id,
        excerpt=excerpt,
        locator=locator,
        entity_ids=entity_ids,
        kind="structured" if data is not None else "text",
        data=data,
    )


def trial_records(trial: dict[str, Any], entity_ids: list[str]) -> tuple[SourceRef, list[Evidence]]:
    nct = trial["nct_id"]
    source = SourceRef(
        id=source_id("trial", nct),
        type="trial",
        title=f"{trial.get('brief_title') or trial.get('title') or nct} ({nct})",
        url=f"https://clinicaltrials.gov/study/{nct}",
        publisher="ClinicalTrials.gov",
        published_at=_date(trial.get("start_date")),
        retrieved_at=utcnow(),
        identifiers={"nct": nct},
    )
    phases = "/".join(trial.get("phases") or []) or "NA"
    status = trial.get("overall_status") or "UNKNOWN"
    parts = [f"{nct}: {phases}, status {status}"]
    if trial.get("enrollment") is not None:
        parts.append(f"enrollment {trial['enrollment']}")
    if trial.get("sponsor"):
        parts.append(f"sponsor {trial['sponsor']}")
    evidence = [
        _evidence(
            source,
            ", ".join(parts),
            "protocolSection.statusModule",
            entity_ids,
            data={k: v for k, v in trial.items() if v not in (None, [], "")},
        )
    ]
    if trial.get("why_stopped"):
        evidence.append(
            _evidence(source, trial["why_stopped"], "statusModule.whyStopped", entity_ids)
        )
    # some trials list dozens of primary outcomes; the first ones carry the design
    for i, outcome in enumerate((trial.get("primary_outcomes") or [])[:MAX_OUTCOMES]):
        evidence.append(
            _evidence(source, outcome, f"outcomesModule.primaryOutcomes[{i}]", entity_ids)
        )
    return source, evidence


def paper_records(
    paper: dict[str, Any], entity_ids: list[str]
) -> tuple[SourceRef, list[Evidence]] | None:
    canonical = (
        (f"pmid:{paper['pmid']}" if paper.get("pmid") else None)
        or (f"doi:{paper['doi']}" if paper.get("doi") else None)
        or (f"epmc:{paper['source']}:{paper['id']}" if paper.get("id") else None)
    )
    if canonical is None or not paper.get("title"):
        return None
    preprint = paper.get("is_preprint", False)
    kind = "preprint" if preprint else "paper"
    identifiers = {k: str(paper[k]) for k in ("pmid", "pmcid", "doi") if paper.get(k) is not None}
    if paper.get("pmid"):
        url = f"https://europepmc.org/article/MED/{paper['pmid']}"
    elif paper.get("doi"):
        url = f"https://doi.org/{paper['doi']}"
    else:
        url = f"https://europepmc.org/article/{paper['source']}/{paper['id']}"
    source = SourceRef(
        id=source_id(kind, canonical),
        type=kind,
        title=paper["title"],
        url=url,
        publisher=paper.get("journal") or ("preprint server" if preprint else "Europe PMC"),
        published_at=_date(paper.get("first_publication_date") or paper.get("year")),
        retrieved_at=utcnow(),
        identifiers=identifiers,
    )
    abstract = (paper.get("abstract") or "").strip()
    excerpt, locator = (
        (abstract[:ABSTRACT_MAX], "abstract") if abstract else (paper["title"], "title")
    )
    return source, [_evidence(source, excerpt, locator, entity_ids)]


def ot_source(kind: str, key: str, title: str, url: str) -> SourceRef:
    return SourceRef(
        id=source_id("db_record", f"opentargets:{kind}:{key}"),
        type="db_record",
        title=title,
        url=url,
        publisher=OT_RELEASE,
        retrieved_at=utcnow(),
        identifiers={"opentargets": key},
    )


def association_records(
    assoc: dict[str, Any] | None,
    target: tuple[str, str],
    disease: tuple[str, str],
    entity_ids: list[str],
) -> tuple[SourceRef, list[Evidence]]:
    (tid, tlabel), (did, dlabel) = target, disease
    source = ot_source(
        "association",
        f"{tid}-{did}",
        f"Open Targets association: {tlabel} × {dlabel}",
        f"https://platform.opentargets.org/evidence/{tid}/{did}",
    )
    if assoc is None:
        text = f"Open Targets reports no association between {tlabel} and {dlabel}."
        return source, [_evidence(source, text, "associatedTargets", entity_ids, data={})]
    scores = {d["id"]: round(d["score"], 3) for d in assoc.get("datatypeScores") or []}
    rendered = ", ".join(f"{k} {v}" for k, v in sorted(scores.items(), key=lambda kv: -kv[1]))
    text = f"{tlabel} × {dlabel}: overall association score {assoc['score']:.3f}; {rendered}."
    if "genetic_association" not in scores:
        text += " No genetic_association evidence."
    data = {"overall": assoc["score"], "datatype_scores": scores}
    return source, [_evidence(source, text, "associatedTargets.rows[0]", entity_ids, data=data)]


def target_profile_records(
    profile: dict[str, Any], entity_ids: list[str]
) -> tuple[SourceRef, list[Evidence]]:
    tid, symbol = profile["id"], profile.get("approvedSymbol") or profile["id"]
    source = ot_source(
        "target",
        tid,
        f"Open Targets target profile: {symbol}",
        f"https://platform.opentargets.org/target/{tid}",
    )
    evidence: list[Evidence] = []
    for i, s in enumerate(profile.get("safetyLiabilities") or []):
        if not s.get("event"):
            continue
        effects = ", ".join(
            "/".join(x for x in (e.get("direction"), e.get("dosing")) if x)
            for e in s.get("effects") or []
        )
        text = f"Safety liability for {symbol} ({s.get('datasource')}): {s['event']}"
        if effects:
            text += f"; effects: {effects}"
        evidence.append(
            _evidence(
                source,
                text,
                f"safetyLiabilities[{i}]",
                entity_ids,
                data={k: s.get(k) for k in ("event", "eventId", "datasource", "literature", "url")},
            )
        )
    by_modality: dict[str, list[str]] = {}
    for t in profile.get("tractability") or []:
        if t.get("value"):
            by_modality.setdefault(t["modality"], []).append(t["label"])
    if by_modality:
        text = f"Tractability of {symbol}: " + "; ".join(
            f"{m}: {', '.join(labels)}" for m, labels in sorted(by_modality.items())
        )
        evidence.append(_evidence(source, text, "tractability", entity_ids, data=by_modality))
    classes = [c["label"] for c in profile.get("targetClass") or []]
    if classes:
        text = f"Target class of {symbol}: {', '.join(classes)}"
        evidence.append(
            _evidence(source, text, "targetClass", entity_ids, data={"classes": classes})
        )
    return source, evidence


def drug_landscape_records(
    rows: list[dict[str, Any]], owner: tuple[str, str, str], entity_ids: list[str], limit: int
) -> tuple[SourceRef, list[Evidence]]:
    """owner = (kind 'target'|'disease', id, label): drugs OT links to that target or disease."""
    kind, oid, label = owner
    source = ot_source(
        f"{kind}_drugs",
        oid,
        f"Open Targets drugs and clinical candidates: {label}",
        f"https://platform.opentargets.org/{kind}/{oid}",
    )
    stage_rank = {"APPROVAL": 6, "PHASE_4": 6, "PREAPPROVAL": 5, "PHASE_3": 4, "PHASE_2_3": 4}
    rows = sorted(rows, key=lambda r: -stage_rank.get(r.get("maxClinicalStage") or "", 0))
    evidence = []
    for r in rows[:limit]:
        drug = r.get("drug") or {}
        if not drug.get("name"):
            continue
        diseases = sorted(
            {d["disease"]["name"] for d in r.get("diseases") or [] if d.get("disease")}
        )
        text = f"{drug['name']} ({drug.get('drugType') or 'unknown type'}) on {label}: "
        text += f"max clinical stage {r.get('maxClinicalStage')}"
        if diseases:
            text += f"; indications: {', '.join(diseases[:6])}"
        moa = [
            m["mechanismOfAction"]
            for m in ((drug.get("mechanismsOfAction") or {}).get("rows") or [])
            if m.get("mechanismOfAction")
        ]
        if moa:
            text += f"; mechanism: {moa[0]}"
        data = {
            "mechanisms": moa,
            "drug_id": drug.get("id"),
            "drug": drug["name"],
            "max_stage": r.get("maxClinicalStage"),
            "diseases": diseases,
        }
        evidence.append(
            _evidence(
                source, text, f"drugAndClinicalCandidates[{drug.get('id')}]", entity_ids, data
            )
        )
    return source, evidence


def label_records(
    label: dict[str, Any], entity_ids: list[str], section_max: int = 1500
) -> tuple[SourceRef, list[Evidence]] | None:
    if not label.get("set_id"):
        return None
    brand = ", ".join(label.get("brand_names") or []) or ", ".join(label.get("generic_names") or [])
    source = SourceRef(
        id=source_id("label", label["set_id"]),
        type="label",
        title=f"FDA label: {brand or label['set_id']}",
        url=f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={label['set_id']}",
        publisher="U.S. FDA (openFDA)",
        published_at=_date(label.get("effective_time")),
        retrieved_at=utcnow(),
        identifiers={"set_id": label["set_id"]},
    )
    evidence = [
        _evidence(source, text[:section_max], section, entity_ids)
        for section, text in (label.get("sections") or {}).items()
        if section in ("indications_and_usage", "boxed_warning", "mechanism_of_action")
    ]
    return source, evidence


def application_records(
    app: dict[str, Any], entity_ids: list[str]
) -> tuple[SourceRef, list[Evidence]] | None:
    number = app.get("application_number")
    if not number:
        return None
    brand = ", ".join(app.get("brand_names") or []) or ", ".join(app.get("generic_names") or [])
    source = SourceRef(
        id=source_id("approval", number),
        type="approval",
        title=f"FDA application {number}: {brand}",
        url=f"{DRUGS_FDA_URL}{number.lstrip('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}",
        publisher="U.S. FDA (Drugs@FDA)",
        published_at=_date(app.get("original_date")),
        retrieved_at=utcnow(),
        identifiers={"application_number": number},
    )
    text = f"{number} ({brand}), sponsor {app.get('sponsor')}: original submission status "
    text += f"{app.get('original_status') or 'unknown'}"
    if app.get("original_date"):
        text += f" on {app['original_date']}"
    return source, [_evidence(source, text, "submissions", entity_ids, data=app)]


def user_records(
    text: str, locator: str, entity_ids: list[str], *, url: str | None = None, title: str
) -> tuple[SourceRef, list[Evidence]]:
    source = SourceRef(
        id=source_id("user_provided", url or text),
        type="user_provided",
        title=title,
        url=url,
        publisher="user",
        retrieved_at=utcnow(),
        identifiers={"url": url} if url else {},
    )
    chunks = chunk_text(text) if len(text) > CHUNK_CHARS else [text]
    locators = (
        [locator] if len(chunks) == 1 else [f"{locator} [{i + 1}]" for i in range(len(chunks))]
    )
    return source, [
        _evidence(source, c, loc, entity_ids) for c, loc in zip(chunks, locators, strict=True)
    ]


def chunk_text(text: str, size: int = 0) -> list[str]:
    """Sentence-aligned pieces of about `size` chars; each piece is a verbatim slice of the text."""
    size = size or CHUNK_CHARS
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        while len(sentence) > size:  # one huge run-on "sentence" (tables, scraped pages)
            if current:
                chunks.append(current)
                current = ""
            chunks.append(sentence[:size])
            sentence = sentence[size:]
        if current and len(current) + 1 + len(sentence) > size:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}" if current else sentence
    if current:
        chunks.append(current)
    return chunks


def twin_records(
    program: dict[str, Any], text: str, entity_ids: list[str]
) -> tuple[SourceRef, list[Evidence]]:
    """One historical program (drug x disease) as Open Targets records it."""
    source = ot_source(
        "clinical_indication",
        f"{program['drug_id']}-{program['disease_id']}",
        f"Open Targets clinical record: {program['drug']} × {program['disease']}",
        f"https://platform.opentargets.org/drug/{program['drug_id']}",
    )
    return source, [_evidence(source, text, "clinical_indication", entity_ids, data=program)]


def trial_source(nct: str, title: str | None) -> SourceRef:
    """Same id as the ClinicalTrials.gov record fetch_trials registers for this NCT."""
    return SourceRef(
        id=source_id("trial", nct),
        type="trial",
        title=f"{title or nct} ({nct})",
        url=f"https://clinicaltrials.gov/study/{nct}",
        publisher="ClinicalTrials.gov",
        retrieved_at=utcnow(),
        identifiers={"nct": nct},
    )
