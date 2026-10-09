import re
import unicodedata
from typing import Any

from app.contracts import Confidence, EntityRef, NodeSpec, ResolvedEntities
from app.graph.state import GraphState
from app.nodes._data import client, correction_text, force_refresh
from app.nodes._fixture import fixture_report, nap, slug
from app.nodes.base import NodeContext
from app.sources.base import SourceError
from app.sources.opentargets import OpenTargetsClient

SPEC = NodeSpec(
    id="input_resolver",
    label="Input resolver",
    kind="processing",
    phase="resolve",
    description="Resolves free-text indication, mechanism and drug into disease, target and drug ids plus therapeutic areas.",
    reads=["program"],
    writes=["entities"],
    correctable=True,
    critical=True,
)

DISEASE_ID = re.compile(r"\b(?:MONDO|EFO|HP|Orphanet|DOID)_\d+\b")
TARGET_ID = re.compile(r"\bENSG\d{11}\b")
DRUG_ID = re.compile(r"\bCHEMBL\d+\b")

# "BACE1 inhibitor" finds nothing; "BACE1" does. Longest phrases first.
ACTIONS = {
    "negative allosteric modulator": "negative allosteric modulator",
    "positive allosteric modulator": "positive allosteric modulator",
    "inverse agonist": "inverse agonist",
    "gene therapy": "gene therapy",
    "inhibitor": "inhibitor",
    "inhibition": "inhibitor",
    "inhibiting": "inhibitor",
    "antagonist": "antagonist",
    "antagonism": "antagonist",
    "agonist": "agonist",
    "agonism": "agonist",
    "blocker": "blocker",
    "blockade": "blocker",
    "activator": "activator",
    "activation": "activator",
    "modulator": "modulator",
    "degrader": "degrader",
    "degradation": "degrader",
    "antibody": "antibody",
    "sirna": "siRNA",
    "antisense": "antisense oligonucleotide",
    "silencing": "gene silencing",
    "knockdown": "gene silencing",
    "vaccine": "vaccine",
}
FILLER = {
    *("of", "the", "a", "an", "targeting", "targeted", "anti", "selective", "oral", "small"),
    *("molecule", "monoclonal", "humanized", "human", "fully", "recombinant", "bispecific"),
}
CONFIDENT_RATIO = 3.0


def plain(text: str) -> str:
    """Typographic quotes and dashes (pasted from Word or a web page) as ASCII: Open Targets finds
    "Crohn's disease" but not "Crohn’s disease"."""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[‘’‚‛′`]", "'", text)
    text = re.sub(r"[“”„‟″]", '"', text)
    return re.sub(r"[‐‑‒–—―−]", "-", text).strip()


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def parse_mechanism(text: str) -> tuple[list[str], str | None]:
    """Search candidates (cleaned phrase first, then symbol-like tokens) and the action class."""
    # keep the user's punctuation: OT finds "beta-secretase 1" but not "beta secretase 1"
    cleaned, action = re.sub(r"\banti-", " ", text, flags=re.I), None
    for phrase, label in ACTIONS.items():
        pattern = re.compile(rf"\b{re.escape(phrase)}s?\b", re.I)
        if pattern.search(cleaned):
            action = action or label
            cleaned = pattern.sub(" ", cleaned)
    words = [w for w in cleaned.split() if w.lower() not in FILLER]
    phrase = " ".join(words).strip(" -,;")
    symbolish = [s for s in re.findall(r"\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)?\b", text) if len(s) >= 3]
    candidates = list(dict.fromkeys(c for c in [phrase, *symbolish] if c))
    return candidates, action


def _confidence(hits: list[dict[str, Any]]) -> Confidence:
    if len(hits) == 1 or hits[0]["score"] >= CONFIDENT_RATIO * hits[1]["score"]:
        return "high"
    return "medium"


def _alternatives(hits: list[dict[str, Any]], chosen: str) -> str:
    return ", ".join(f"{h['name']} ({h['id']})" for h in hits if h["id"] != chosen)[:300]


async def _disease(
    ot: OpenTargetsClient, text: str, override: str | None, ctx: NodeContext, fr: bool
) -> tuple[EntityRef, list[str], Confidence] | None:
    if override:
        hit = {"id": override, "name": override, "score": 1.0}
        hits, confidence = [hit], "high"
        ctx.log(f"disease taken from correction: {override}")
    else:
        hits = [
            h
            for h in await ot.search(text, "disease", 8, force_refresh=fr)
            if "measurement" not in h["name"].lower() and not h["id"].startswith("OBA_")
        ]
        if not hits:
            return None
        confidence = _confidence(hits)
        exact = [h for h in hits if _norm(h["name"]) == _norm(text)]
        preferred = [h for h in exact if h["id"].startswith(("MONDO_", "EFO_"))]
        hit = (preferred or exact or hits)[0]
        if not hit["id"].startswith(("MONDO_", "EFO_")):
            ctx.log(f"best disease match {hit['id']} is not a MONDO/EFO term", "warn")
        others = _alternatives(hits[:4], hit["id"])
        ctx.log(
            f"disease '{text}' -> {hit['name']} ({hit['id']})"
            + (f"; alternatives: {others}" if others else "")
        )
    details = await ot.disease(hit["id"], force_refresh=fr)
    if details is None:
        return None
    areas = [a["name"] for a in details.get("therapeuticAreas") or []]
    ref = EntityRef(
        id=details["id"],
        label=details["name"],
        kind="disease",
        external_ids={"opentargets": details["id"]},
    )
    return ref, areas, confidence  # type: ignore[return-value]


async def _target(
    ot: OpenTargetsClient, text: str, override: str | None, ctx: NodeContext, fr: bool
) -> tuple[EntityRef, Confidence] | None:
    if override:
        hits = [{"id": override, "name": override, "score": 1.0}]
        confidence: Confidence = "high"
    else:
        candidates, _ = parse_mechanism(text)
        hits = []
        for candidate in candidates[:3]:
            hits = await ot.search(candidate, "target", 5, force_refresh=fr)
            if hits:
                exact = [h for h in hits if h["name"].lower() == candidate.lower()]
                hits = exact + [h for h in hits if h not in exact]
                ctx.log(f"target '{candidate}' -> {hits[0]['name']} ({hits[0]['id']})")
                break
        if not hits:
            return None
        confidence = _confidence(hits)
    details = await ot.target(hits[0]["id"], force_refresh=fr)
    if details is None:
        return None
    symbol = details.get("approvedSymbol") or details["id"]
    ref = EntityRef(
        id=details["id"],
        label=symbol,
        kind="target",
        external_ids={"opentargets": details["id"], "symbol": symbol},
    )
    return ref, confidence


async def _drug(
    ot: OpenTargetsClient, name: str | None, override: str | None, ctx: NodeContext, fr: bool
) -> tuple[EntityRef, dict[str, Any], Confidence] | None:
    if override:
        chembl, confidence = override, "high"
    elif name:
        hits = await ot.search(name, "drug", 3, force_refresh=fr)
        if not hits:
            ctx.log(f"drug '{name}' not found in Open Targets; treated as a new asset", "warn")
            return None
        chembl, confidence = hits[0]["id"], _confidence(hits)
        ctx.log(f"drug '{name}' -> {hits[0]['name']} ({chembl})")
    else:
        return None
    details = await ot.drug(chembl, force_refresh=fr)
    if details is None:
        return None
    ref = EntityRef(
        id=details["id"],
        label=details["name"],
        kind="drug",
        external_ids={"chembl": details["id"]},
    )
    return ref, details, confidence  # type: ignore[return-value]


def _lowest(*levels: Confidence) -> Confidence:
    order: list[Confidence] = ["low", "medium", "high"]
    return min(levels, key=order.index)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ot = client(ctx, "opentargets", OpenTargetsClient)
    if ot is None:
        return await _fixture_run(state, ctx)
    program, fr = state["program"], force_refresh(state)
    fix = correction_text(ctx)
    overrides = {
        "disease": next(iter(DISEASE_ID.findall(fix)), None),
        "target": next(iter(TARGET_ID.findall(fix)), None),
        "drug": next(iter(DRUG_ID.findall(fix)), None),
    }
    notes: list[str] = []
    try:
        disease = await _disease(ot, plain(program.indication), overrides["disease"], ctx, fr)
        if disease is None:
            raise ValueError(f"could not resolve the indication '{program.indication}'")
        target = await _target(ot, plain(program.mechanism), overrides["target"], ctx, fr)
        drug = await _drug(
            ot, program.drug_name and plain(program.drug_name), overrides["drug"], ctx, fr
        )
    except SourceError as exc:
        raise ValueError(f"Open Targets is unavailable, cannot resolve the program: {exc}") from exc

    disease_ref, areas, disease_conf = disease
    _, action = parse_mechanism(program.mechanism)
    confidences: list[Confidence] = [disease_conf]

    drug_targets: list[dict[str, Any]] = []
    if drug:
        moa_rows = ((drug[1].get("mechanismsOfAction") or {}).get("rows")) or []
        drug_targets = [t for row in moa_rows for t in row.get("targets") or []]
        action = action or next(
            (row["actionType"].lower() for row in moa_rows if row.get("actionType")), None
        )
        confidences.append(drug[2])

    if target is None and drug_targets:
        first = drug_targets[0]
        target = (
            EntityRef(
                id=first["id"],
                label=first["approvedSymbol"],
                kind="target",
                external_ids={"opentargets": first["id"], "symbol": first["approvedSymbol"]},
            ),
            "medium",
        )
        notes.append(f"target taken from the drug's mechanism of action: {first['approvedSymbol']}")
    if target is None:
        notes.append(f"could not resolve a target from '{program.mechanism}'")
        ctx.log(notes[-1], "warn")
        confidences.append("low")
    else:
        confidences.append(target[1])
        if drug_targets and target[0].id not in {t["id"] for t in drug_targets}:
            symbols = ", ".join(t["approvedSymbol"] for t in drug_targets)
            notes.append(
                f"the drug's recorded targets ({symbols}) do not include {target[0].label}"
            )
            ctx.log(notes[-1], "warn")
            confidences.append("low")

    if fix:
        notes.append(f"resolution adjusted by a correction: {fix[:200]}")
    entities = ResolvedEntities(
        disease=disease_ref,
        target=target[0] if target else None,
        drug=drug[0] if drug else None,
        therapeutic_areas=areas,
        mechanism_class=action,
        confidence=_lowest(*confidences),
        notes=notes,
    )
    ctx.log(
        f"resolved: {disease_ref.label} | {entities.target.label if entities.target else '?'}"
        f" | {entities.drug.label if entities.drug else 'no drug'} (confidence {entities.confidence})"
    )
    return {"entities": entities}


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    program = state["program"]
    ctx.log(f"resolving '{program.indication}' and '{program.mechanism}'")
    await nap(ctx.node_id)
    base = fixture_report().entities

    def ref(kind: str, label: str) -> EntityRef:
        return EntityRef(
            id=f"FIXTURE:{kind}:{slug(label)}",
            label=label,
            kind=kind,  # type: ignore[arg-type]
            external_ids={"fixture": slug(label)},
        )

    ctx.log("FIXTURE: no real lookup, ids are placeholders", "warn")
    return {
        "entities": ResolvedEntities(
            disease=ref("disease", program.indication),
            target=ref("target", program.mechanism),
            drug=ref("drug", program.drug_name) if program.drug_name else None,
            therapeutic_areas=base.therapeutic_areas,
            mechanism_class=base.mechanism_class,
            confidence="low",
            notes=["FIXTURE: stub resolution, no real lookup"],
        )
    }
