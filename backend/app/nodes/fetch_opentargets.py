from typing import Any

from app.contracts import Evidence, NodeSpec, SourceRef
from app.graph.state import GraphState
from app.nodes._data import client, entity_ids, force_refresh, register
from app.nodes._fixture import nap, register_fixture_sources
from app.nodes.base import NodeContext
from app.sources.base import SourceError
from app.sources.opentargets import OpenTargetsClient
from app.sources.records import (
    association_records,
    drug_landscape_records,
    target_profile_records,
)

SPEC = NodeSpec(
    id="fetch_opentargets",
    label="Open Targets",
    kind="data",
    phase="fetch",
    description="Fetches target-disease associations by datatype, known drugs and tractability.",
    reads=["program", "entities", "questions"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ot = client(ctx, "opentargets", OpenTargetsClient)
    if ot is None:
        return await _fixture_run(state, ctx)
    entities = state.get("entities")
    if entities is None or entities.target is None:
        ctx.log("no resolved target, nothing to look up in Open Targets", "warn")
        return {"scratch": {ctx.node_id: {"skipped": "no target"}}}

    fr, ids = force_refresh(state), entity_ids(entities)
    target, disease = entities.target, entities.disease
    records: list[tuple[SourceRef, list[Evidence]]] = []
    facts: dict[str, Any] = {}

    try:
        assoc = await ot.association(disease.id, target.id, force_refresh=fr)
        record = association_records(
            assoc, (target.id, target.label), (disease.id, disease.label), ids
        )
        records.append(record)
        facts["association_evidence_ids"] = [e.id for e in record[1]]
        scores = {d["id"]: d["score"] for d in (assoc or {}).get("datatypeScores") or []}
        facts["association_score"] = assoc["score"] if assoc else None
        facts["genetic_association"] = scores.get("genetic_association")
        ctx.log(
            f"association {target.label} × {disease.label}: "
            + (f"{assoc['score']:.2f}" if assoc else "none")
            + ", genetic "
            + (
                f"{scores['genetic_association']:.2f}"
                if "genetic_association" in scores
                else "none"
            )
        )
    except SourceError as exc:
        ctx.log(f"association lookup failed: {exc}", "warn")

    try:
        profile = await ot.target(target.id, force_refresh=fr)
        if profile:
            records.append(target_profile_records(profile, ids))
            ctx.log("target tractability and class (safety liabilities: see Safety data)")
    except SourceError as exc:
        ctx.log(f"target profile lookup failed: {exc}", "warn")

    try:
        rows = await ot.target_drugs(target.id, force_refresh=fr)
        limit = min(40, 4 * ctx.effort.retrieval_k)
        records.append(
            drug_landscape_records(rows, ("target", target.id, target.label), ids, limit)
        )
        facts["target_drugs"] = len(rows)
        ctx.log(f"{len(rows)} drugs and clinical candidates on {target.label}")
    except SourceError as exc:
        ctx.log(f"drug landscape lookup failed: {exc}", "warn")

    n_sources, n_evidence = await register(ctx, state, records)
    ctx.log(f"registered {n_sources} source(s) and {n_evidence} evidence item(s)")
    return {"scratch": {ctx.node_id: facts}}


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("querying Open Targets (FIXTURE: no network call)")
    await nap(ctx.node_id)
    sources, evidence = await register_fixture_sources(
        ctx, state, "db_record", title_lacks="safety"
    )
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
