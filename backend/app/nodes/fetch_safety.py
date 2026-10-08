from typing import Any
from urllib.parse import urlencode

from app.contracts import Evidence, NodeSpec, SourceRef
from app.graph.state import GraphState
from app.nodes._data import client, entity_ids, force_refresh, register
from app.nodes._fixture import excluded_ids, nap, register_fixture_sources
from app.nodes.base import NodeContext
from app.nodes.fetch_regulatory import _approved
from app.quant.assessment import infer_modality, ot_modality
from app.sources.base import SourceError
from app.sources.openfda import FAERS_COUNT, OpenFDAClient, faers_search
from app.sources.opentargets import OpenTargetsClient
from app.sources.records import (
    LABEL_SAFETY,
    faers_records,
    label_records,
    parent_name,
    safety_liability_records,
)

SPEC = NodeSpec(
    id="fetch_safety",
    label="Safety data",
    kind="data",
    phase="fetch",
    description=(
        "Fetches target safety liabilities, tissue expression, label warnings and adverse-event "
        "counts for the target and its drug class."
    ),
    reads=["program", "entities", "questions"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)

FAERS_TOP = 10
FAERS_URL = "https://api.fda.gov/drug/event.json"
Record = tuple[SourceRef, list[Evidence]]


def _kept(record: Record | None, excluded: set[str]) -> list[str]:
    return [e.id for e in record[1] if e.id not in excluded] if record else []


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ot = client(ctx, "opentargets", OpenTargetsClient)
    fda = client(ctx, "openfda", OpenFDAClient)
    if ot is None and fda is None:
        return await _fixture_run(state, ctx)
    entities = state.get("entities")
    if entities is None:
        ctx.log("no resolved entities, nothing to look up", "warn")
        return {}
    program, fr, ids = state["program"], force_refresh(state), entity_ids(entities)
    excluded = excluded_ids(state)
    records: list[Record | None] = []
    facts: dict[str, Any] = {}
    same_target: list[str] = []
    modalities: dict[str, str] = {}

    if ot is not None and entities.target is not None:
        try:
            profile = await ot.target(entities.target.id, force_refresh=fr)
            if profile:
                record = safety_liability_records(profile, ids)
                records.append(record)
                facts["liability_evidence_ids"] = _kept(record, excluded)
                facts["liabilities"] = sorted({e.data["event"] for e in record[1] if e.data})
                ctx.log(
                    f"{len(facts['liabilities'])} target safety liabilities for "
                    f"{entities.target.label} in Open Targets"
                )
            rows = await ot.target_drugs(entities.target.id, force_refresh=fr)
            for r in _approved(rows, False):
                same_target.append(r["drug"]["name"])
                found = ot_modality(r["drug"].get("drugType"))
                if found:
                    modalities[parent_name(r["drug"]["name"])] = found
        except SourceError as exc:
            ctx.log(f"Open Targets safety lookup failed: {exc}", "warn")
    elif entities.target is None:
        ctx.log("no resolved target: no target safety liabilities to look up", "warn")

    # labels of drugs of the program's own modality say the most about it, so read them first
    modality = program.modality or infer_modality(program.mechanism)
    same_target = sorted(
        same_target,
        key=lambda n: modality is not None and modalities.get(parent_name(n)) != modality,
    )
    own = entities.drug.label if entities.drug else program.drug_name
    names = [n for n in (own, *same_target) if n]
    lookups = list(dict.fromkeys(parent_name(n) for n in names))[: 1 + ctx.effort.n_queries // 2]
    facts["same_target_approved"] = [parent_name(n) for n in same_target]
    facts["drug_modalities"] = modalities
    facts["labels"], facts["boxed_warning_evidence_ids"], facts["faers"] = {}, {}, {}
    if fda is not None:
        for name in lookups:
            try:
                labels = await fda.labels(name, limit=1, force_refresh=fr)
                reactions = await fda.adverse_events(name, limit=FAERS_TOP, force_refresh=fr)
            except SourceError as exc:
                ctx.log(f"openFDA safety lookup for {name} failed: {exc}", "warn")
                continue
            for label in labels:
                record = label_records(label, ids, sections=LABEL_SAFETY)
                records.append(record)
                boxed = [
                    e.id
                    for e in (record[1] if record else [])
                    if e.locator == "boxed_warning" and e.id not in excluded
                ]
                facts["labels"][name] = _kept(record, excluded)
                if boxed:
                    facts["boxed_warning_evidence_ids"][name] = boxed
            url = f"{FAERS_URL}?" + urlencode(
                {"search": faers_search(name), "count": FAERS_COUNT, "limit": FAERS_TOP}
            )
            record = faers_records(name, reactions, ids, url)
            records.append(record)
            if record:
                facts["faers"][name] = _kept(record, excluded)
            ctx.progress(
                f"{name}: {len(labels)} label(s)"
                + (", boxed warning" if name in facts["boxed_warning_evidence_ids"] else "")
                + f", {len(reactions)} FAERS reaction terms"
            )

    n_sources, n_evidence = await register(ctx, state, records)
    ctx.log(f"registered {n_sources} source(s) and {n_evidence} evidence item(s)")
    return {"scratch": {ctx.node_id: facts}}


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("querying safety sources (FIXTURE: no network call)")
    await nap(ctx.node_id)
    sources, evidence = await register_fixture_sources(ctx, state, "db_record", title_has="safety")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
