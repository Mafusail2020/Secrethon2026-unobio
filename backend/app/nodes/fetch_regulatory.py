from typing import Any

from app.contracts import Evidence, NodeSpec, SourceRef
from app.graph.state import GraphState
from app.nodes._data import client, entity_ids, force_refresh, register
from app.nodes._fixture import nap, register_fixture_sources
from app.nodes.base import NodeContext
from app.sources.base import SourceError
from app.sources.openfda import OpenFDAClient
from app.sources.opentargets import OpenTargetsClient
from app.sources.records import (
    application_records,
    drug_landscape_records,
    label_records,
    parent_name,
)

SPEC = NodeSpec(
    id="fetch_regulatory",
    label="openFDA",
    kind="data",
    phase="fetch",
    description="Fetches labels and approvals for standard of care and competitors.",
    reads=["program", "entities", "questions"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)


APPROVED = {"APPROVAL", "PHASE_4"}


def _approved(rows: list[dict[str, Any]], with_moa: bool) -> list[dict[str, Any]]:
    """Approved drugs, one per parent name; diagnostics (no mechanism) dropped on request."""
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        drug = r.get("drug") or {}
        if r.get("maxClinicalStage") not in APPROVED or not drug.get("name"):
            continue
        moa = (drug.get("mechanismsOfAction") or {}).get("rows") or []
        if with_moa and not moa:
            continue
        out.setdefault(parent_name(drug["name"]), r)
    return list(out.values())


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    fda = client(ctx, "openfda", OpenFDAClient)
    if fda is None:
        return await _fixture_run(state, ctx)
    entities = state.get("entities")
    if entities is None:
        ctx.log("no resolved entities, nothing to look up", "warn")
        return {}
    program, fr, ids = state["program"], force_refresh(state), entity_ids(entities)
    records: list[tuple[SourceRef, list[Evidence]] | None] = []

    # who would this drug have to beat: approved drugs on the same target and for the disease
    same_target: list[dict[str, Any]] = []
    standard_of_care: list[dict[str, Any]] = []
    ot = client(ctx, "opentargets", OpenTargetsClient)
    if ot is not None:
        try:
            if entities.target:
                same_target = _approved(
                    await ot.target_drugs(entities.target.id, force_refresh=fr), False
                )
            rows = await ot.disease_drugs(entities.disease.id, force_refresh=fr)
            standard_of_care = _approved(rows, True)
            disease_owner = ("disease", entities.disease.id, entities.disease.label)
            records.append(drug_landscape_records(standard_of_care, disease_owner, ids, 25))
            ctx.log(
                f"{len(standard_of_care)} approved drugs for {entities.disease.label}, "
                f"{len(same_target)} approved on the same target"
            )
        except SourceError as exc:
            ctx.log(f"Open Targets drug lists failed: {exc}", "warn")

    names = [program.drug_name, entities.drug.label if entities.drug else None]
    names += [r["drug"]["name"] for r in same_target + standard_of_care]
    lookups = list(dict.fromkeys(parent_name(n) for n in names if n))[: 2 + ctx.effort.n_queries]

    found: dict[str, list[str]] = {}
    for name in lookups:
        try:
            labels = await fda.labels(name, limit=1, force_refresh=fr)
            apps = await fda.applications(name, limit=1, force_refresh=fr)
        except SourceError as exc:
            ctx.log(f"openFDA lookup for {name} failed: {exc}", "warn")
            continue
        records += [label_records(lab, ids) for lab in labels]
        records += [application_records(a, ids) for a in apps]
        found[name] = [a["application_number"] for a in apps if a.get("application_number")]
        ctx.progress(f"{name}: {len(labels)} label(s), {len(apps)} application(s)")

    n_sources, n_evidence = await register(ctx, state, records)
    missing = [n for n, apps in found.items() if not apps]
    if missing:
        ctx.log(f"no FDA application found for: {', '.join(missing)}")
    ctx.log(f"registered {n_sources} source(s) and {n_evidence} evidence item(s)")
    return {
        "scratch": {
            ctx.node_id: {
                "fda_applications": found,
                "standard_of_care": [r["drug"]["name"] for r in standard_of_care],
                "same_target_approved": [r["drug"]["name"] for r in same_target],
            }
        }
    }


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("querying openFDA (FIXTURE: no network call)")
    await nap(ctx.node_id)
    sources, evidence = await register_fixture_sources(ctx, state, "label")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
