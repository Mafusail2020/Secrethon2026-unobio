import asyncio
import re
from collections import Counter
from typing import Any

import yaml

from app.contracts import NodeSpec, TwinProgram, TwinStats
from app.core.settings import get_settings
from app.graph.state import GraphState
from app.nodes._data import entity_ids
from app.nodes._fixture import excluded_ids, fixture_report, nap
from app.nodes.base import NodeContext
from app.quant.base_rates import BaseRates, base_rates, twin_param
from app.quant.twin_stats import (
    OT_CATEGORY,
    STAGE_FLOOR,
    Program,
    TwinData,
    beta_range,
    compute,
    data_ready,
    failure_mix,
)
from app.sources.records import parent_name, trial_source, twin_records

SPEC = NodeSpec(
    id="twin_stats",
    label="Twin stats",
    kind="quant",
    phase="fetch",
    description="Finds historical programs like this one and derives stage reached, stop reasons and a prior success range.",
    reads=["program", "entities"],
    writes=["twin_stats", "source_ids", "evidence_ids"],
    correctable=True,
    critical=False,
)

DROP_WORDS = re.compile(r"\b(exclude|ignore|remove|drop|without)\b", re.I)
SHOWN_ORDER = {"stopped": 0, "approved": 1, "active": 2, "unknown": 3}


def _describe(p: Program) -> str:
    text = f"{p.drug} × {p.disease}: max clinical stage {p.max_stage}, {p.status}"
    if p.status == "stopped":
        if p.presumed:
            text += " (presumed: no new trial for 3+ years)"
        elif p.ot_categories:
            text += f" (stop reason class: {', '.join(p.ot_categories)})"
        else:
            text += " (stop reason not recorded)"
    trials = ", ".join(t.nct for t in p.trials[:4])
    return text + (f"; trials {trials}" if trials else "")


def _dropped_drugs(ctx: NodeContext, programs_hint: list[str]) -> set[str]:
    """Drugs a correction asks to leave out, e.g. 'exclude atabecestat'."""
    texts = [c.text for c in ctx.corrections_for() if DROP_WORDS.search(c.text)]
    return {
        name
        for name in programs_hint
        for t in texts
        if re.search(rf"\b{re.escape(name)}\b", t, re.I)
    }


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    entities = state.get("entities")
    if entities is None or entities.disease.id.startswith("FIXTURE:"):
        return await _fixture_run(state, ctx)

    program = state["program"]
    options = state.get("options")
    today = options.as_of if options and options.as_of else None
    base = base_rates(entities.therapeutic_areas, entities.disease.label)
    ledger_conf = yaml.safe_load((get_settings().config_dir / "ledger.yaml").read_text())
    root = get_settings().data_path / "opentargets"
    if entities.target is None or not data_ready(root):
        reason = (
            "no resolved target, so no same-target history"
            if entities.target is None
            else "Open Targets bulk files missing (run `uv run python -m "
            "scripts.download_opentargets`)"
        )
        ctx.log(f"{reason}: prior is the area base rate", "warn")
        return {"twin_stats": _base_rate_only(base, program.stage, ledger_conf, reason)}

    target = entities.target
    # the program's own drug is not its own precedent
    own = {parent_name(entities.drug.label)} if entities.drug else set()
    ctx.log(
        f"looking up programs on {target.label} in Open Targets clinical data "
        f"(stage: {program.stage or 'not given'})"
    )

    def work() -> Any:
        data = TwinData(root)
        try:
            args = (data, target.id, entities.disease.id, program.stage, base, ledger_conf)
            first = compute(*args, today=today, drop_drugs=own)
            dropped = _dropped_drugs(ctx, sorted({parent_name(p.drug) for p in first.programs}))
            if not dropped:
                return first, dropped
            return compute(*args, today=today, drop_drugs=own | dropped), dropped
        finally:
            data.close()

    result, dropped = await asyncio.to_thread(work)
    if own:
        result.notes.insert(0, f"the program's own drug ({next(iter(own))}) is left out of twins")
    if dropped:
        ctx.log(f"left out by a correction: {', '.join(sorted(dropped))}")

    excluded = excluded_ids(state)
    ids = entity_ids(entities)
    # only twins comparable at the program's stage: the ones the prior counted, plus censored ones
    floor = STAGE_FLOOR.get(program.stage or "", 0)
    comparable = [p for p in result.programs if p.rank >= floor]
    shown = sorted(comparable, key=lambda p: (SHOWN_ORDER[p.status], -p.rank, p.drug))[
        : int(twin_param("max_twins_shown")["value"])
    ]
    twins: list[TwinProgram] = []
    for p in shown:
        record = twin_records(
            {
                "drug_id": p.drug_id,
                "drug": p.drug,
                "disease_id": p.disease_id,
                "disease": p.disease,
                "max_stage": p.max_stage,
                "status": p.status,
                "presumed_stop": p.presumed,
                "stop_category": p.stop_category,
                "ot_stop_classes": p.ot_categories,
                "nct_ids": [t.nct for t in p.trials],
            },
            _describe(p),
            ids,
        )
        source, evidence = record
        if any(e.id in excluded for e in evidence):
            ctx.log(f"{p.drug}: its record was excluded by a correction")
            continue
        trials = [trial_source(t.nct, t.title) for t in p.trials[:3]]
        await ctx.register_sources([source, *trials])
        await ctx.register_evidence(evidence)
        twins.append(
            TwinProgram(
                drug=p.drug,
                drug_id=p.drug_id,
                disease=p.disease,
                max_stage=p.max_stage,
                status=p.status,  # type: ignore[arg-type]
                stop_reason=p.why_stopped
                or (
                    "presumed: no new trial for 3+ years"
                    if p.presumed
                    else ("not recorded" if p.status == "stopped" else None)
                ),
                source_ids=[source.id, *(t.id for t in trials)],
            )
        )

    stopped = [p for p in result.decided if p.status == "stopped"]
    stop_classes = Counter(c for p in stopped for c in p.ot_categories)
    stats = TwinStats(
        match_level=result.match_level,  # type: ignore[arg-type]
        n_programs=len(comparable),
        twins=twins,
        stage_distribution=dict(Counter(p.max_stage for p in comparable)),
        stop_reasons=dict(stop_classes),
        stop_reason_categories={c: OT_CATEGORY.get(c, "other") for c in stop_classes},
        prior_pos=result.prior,
        failure_mix=result.failure_mix,
        notes=result.notes,
    )
    for note in result.notes:
        ctx.log(note)
    ctx.log(
        f"{stats.match_level}: prior PoS {stats.prior_pos.base:.3f} "
        f"({stats.prior_pos.low:.3f}–{stats.prior_pos.high:.3f}), failure mix from "
        f"{result.failure_mix.source}"
    )
    return {"twin_stats": stats}


def _base_rate_only(
    base: BaseRates, stage: str | None, ledger_conf: dict[str, Any], reason: str
) -> TwinStats:
    loa = base.loa(stage)
    return TwinStats(
        match_level="area_base_rate",
        n_programs=0,
        prior_pos=beta_range(0, 0, loa),
        failure_mix=failure_mix([], ledger_conf),
        notes=[
            reason,
            f"area base rate ({base.area}): {loa:.3f} probability of approval"
            + (f"; {base.note}" if base.note else ""),
        ],
    )


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("looking up historical programs (FIXTURE: no real Open Targets data)")
    await nap(ctx.node_id)
    report = fixture_report()
    twin = report.twin_stats
    assert twin is not None
    cited = {i for t in twin.twins for i in t.source_ids}
    await ctx.register_sources([s for i, s in report.sources.items() if i in cited])
    ctx.log(f"{twin.n_programs} twin programs, prior PoS base {twin.prior_pos.base:.2f}")
    return {"twin_stats": twin}
