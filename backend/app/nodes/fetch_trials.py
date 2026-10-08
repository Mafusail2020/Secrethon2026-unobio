from collections import Counter
from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._data import (
    NCT_RE,
    client,
    correction_links,
    correction_text,
    entity_ids,
    force_refresh,
    register,
)
from app.nodes._fixture import nap, register_fixture_sources
from app.nodes.base import NodeContext
from app.sources.base import SourceError
from app.sources.clinicaltrials import ClinicalTrialsClient
from app.sources.opentargets import OpenTargetsClient
from app.sources.records import trial_records

SPEC = NodeSpec(
    id="fetch_trials",
    label="ClinicalTrials.gov",
    kind="data",
    phase="fetch",
    description="Fetches trials for the same target, drug or indication with status and stop reasons.",
    reads=["program", "entities", "questions"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)

STOPPED = ["TERMINATED", "WITHDRAWN", "SUSPENDED"]
LATE_STAGES = {"APPROVAL", "PHASE_4", "PREAPPROVAL", "PHASE_3", "PHASE_2_3", "PHASE_2"}


def _priority(trial: dict[str, Any]) -> tuple[int, int, int]:
    """Stopped late-phase trials first: they carry the most underwriting signal."""
    phases = trial.get("phases") or []
    phase = 3 if "PHASE3" in phases else 2 if "PHASE2" in phases else 1 if phases else 0
    stopped = trial.get("overall_status") in STOPPED
    return (-int(stopped), -phase, -int(trial.get("has_results", False)))


async def _twin_drugs(ctx: NodeContext, target_id: str, fr: bool, limit: int) -> list[str]:
    ot = client(ctx, "opentargets", OpenTargetsClient)
    if ot is None:
        return []
    try:
        rows = await ot.target_drugs(target_id, force_refresh=fr)
    except SourceError as exc:
        ctx.log(f"could not list drugs on the target: {exc}", "warn")
        return []
    names = [
        r["drug"]["name"]
        for r in rows
        if r.get("drug") and r.get("maxClinicalStage") in LATE_STAGES
    ]
    return list(dict.fromkeys(names))[:limit]


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ct = client(ctx, "clinicaltrials", ClinicalTrialsClient)
    if ct is None:
        return await _fixture_run(state, ctx)
    entities = state.get("entities")
    if entities is None:
        ctx.log("no resolved entities, nothing to search", "warn")
        return {}
    program, fr, ids = state["program"], force_refresh(state), entity_ids(entities)
    disease = entities.disease.label
    target = entities.target.label if entities.target else None

    searches: list[tuple[str, dict[str, Any]]] = []
    for name in dict.fromkeys(
        n for n in (program.drug_name, entities.drug and entities.drug.label) if n
    ):
        searches.append((f"drug {name}", {"intervention": name}))
    if target:
        searches.append((f"{target} in {disease}", {"term": target, "condition": disease}))
        searches.append(
            (
                f"stopped {target} trials",
                {"term": target, "condition": disease, "statuses": STOPPED},
            )
        )
        for name in await _twin_drugs(ctx, entities.target.id, fr, ctx.effort.n_queries):  # type: ignore[union-attr]
            searches.append((f"twin {name}", {"intervention": name, "condition": disease}))
    else:
        searches.append(
            (f"stopped trials in {disease}", {"condition": disease, "statuses": STOPPED})
        )

    trials: dict[str, dict[str, Any]] = {}
    for label, params in searches:
        try:
            found = await ct.search(**params, page_size=50, max_pages=1, force_refresh=fr)
        except SourceError as exc:
            ctx.log(f"search '{label}' failed: {exc}", "warn")
            continue
        new = [t for t in found if t.get("nct_id") and t["nct_id"] not in trials]
        trials.update((t["nct_id"], t) for t in new)
        ctx.progress(f"search '{label}': {len(found)} trials, {len(new)} new")

    asked = {
        m.upper()
        for m in NCT_RE.findall(correction_text(ctx) + " " + " ".join(correction_links(ctx)))
    }
    for nct in sorted(asked - set(trials)):
        try:
            study = await ct.study(nct, force_refresh=fr)
        except SourceError as exc:
            ctx.log(f"could not fetch {nct} from the correction: {exc}", "warn")
            continue
        if study:
            trials[nct] = study
            ctx.log(f"added {nct} from a correction")

    cap = 5 * ctx.effort.retrieval_k
    kept = sorted(trials.values(), key=_priority)[:cap]
    if len(trials) > cap:
        ctx.log(
            f"kept the {cap} most informative of {len(trials)} trials (stopped, late phase first)"
        )
    n_sources, n_evidence = await register(ctx, state, (trial_records(t, ids) for t in kept))

    statuses = Counter(t.get("overall_status") or "UNKNOWN" for t in kept)
    stopped = [
        {"nct_id": t["nct_id"], "phases": t.get("phases"), "why_stopped": t.get("why_stopped")}
        for t in kept
        if t.get("overall_status") in STOPPED
    ]
    ctx.log(
        f"registered {n_sources} trial(s), {n_evidence} evidence item(s); "
        + ", ".join(f"{n} {s.lower()}" for s, n in statuses.most_common())
    )
    return {"scratch": {ctx.node_id: {"statuses": dict(statuses), "stopped": stopped}}}


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("querying ClinicalTrials.gov (FIXTURE: no network call)")
    await nap(ctx.node_id)
    sources, evidence = await register_fixture_sources(ctx, state, "trial")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
