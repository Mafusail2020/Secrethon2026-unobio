"""Capital and time to the next milestone, and a risk-adjusted NPV range.

Phases still ahead are costed (patients x cost per patient + fixed cost) and weighted by the chance
of reaching them; launch revenue is a linear ramp to peak sales, discounted and weighted by the
ledger's probability of success. Phase success rates come from the area base rates, scaled so their
product equals that probability. Every input is in config/valuation.yaml.
"""

from dataclasses import dataclass
from typing import Any

from app.contracts import Assumption, Range, Valuation
from app.quant.base_rates import PHASES, STAGE_START, BaseRates

LABEL = {"ind_enabling": "IND-enabling", "p1": "Phase 1", "p2": "Phase 2", "p3": "Phase 3"}
PRECLINICAL = {"discovery", "preclinical", "ind_enabling"}
# pessimistic end of each input: costs, sizes, durations and discount high; sales, margin low
PESSIMISTIC_HIGH = {"cost", "size", "fixed", "duration", "discount"}


@dataclass(frozen=True)
class Scenario:
    pos: float
    cost_per_patient: float
    discount: float
    margin: float
    peak: float
    sizes: dict[str, float]
    fixed: dict[str, float]
    months: dict[str, float]


def _range(r: dict[str, Any], unit: str) -> Range:
    return Range(low=r["low"], base=r["base"], high=r["high"], unit=unit)


def _pick(r: dict[str, float], end: str, kind: str) -> float:
    if end == "base":
        return r["base"]
    worse = "high" if kind in PESSIMISTIC_HIGH else "low"
    better = "low" if worse == "high" else "high"
    return r[worse if end == "low" else better]


def phases_ahead(stage: str) -> list[str]:
    ahead = list(PHASES[STAGE_START.get(stage, 0) :])
    return (["ind_enabling"] if stage in PRECLINICAL else []) + ahead


def milestone(stage: str) -> str:
    if stage in PRECLINICAL:
        return "IND and Phase 1 readout"
    if stage == "filed":
        return "approval decision"
    if stage == "approved":
        return "launch"
    return f"{LABEL[PHASES[STAGE_START[stage]]]} readout"


def _scenario(end: str, pos: Range, conf: dict[str, Any], group: str, stage_phases: list[str]):
    trial = conf["trial_size"][group]
    return Scenario(
        pos=getattr(pos, end),
        cost_per_patient=_pick(conf["cost_per_patient_usd"], end, "cost"),
        discount=_pick(conf["discount_rate"], end, "discount"),
        margin=_pick(conf["commercial"]["operating_margin"], end, "margin"),
        peak=_pick(conf["peak_sales_usd"][group], end, "peak"),
        sizes={p: _pick(trial[p], end, "size") for p in stage_phases if p in trial},
        fixed={p: _pick(conf["fixed_cost_usd"][p], end, "fixed") for p in stage_phases},
        months={p: _pick(conf["duration_months"][p], end, "duration") for p in stage_phases},
    )


def _phase_cost(s: Scenario, phase: str) -> float:
    return s.sizes.get(phase, 0) * s.cost_per_patient + s.fixed[phase]


def _rnpv(s: Scenario, phases: list[str], base: BaseRates, conf: dict[str, Any]) -> float:
    clinical = [p for p in phases if p in PHASES]
    base_loa = 1.0
    for p in clinical:
        base_loa *= base.transitions[p]
    # scale each transition so their product is the ledger's PoS
    scale = (s.pos / base_loa) ** (1 / len(clinical)) if clinical and base_loa > 0 else 1.0
    reach, t, pv_cost = 1.0, 0.0, 0.0
    for phase in phases:
        mid = (t + s.months[phase] / 2) / 12
        pv_cost += reach * _phase_cost(s, phase) / (1 + s.discount) ** mid
        t += s.months[phase]
        if phase in PHASES:
            reach *= min(base.transitions[phase] * scale, 0.99)
    years = int(conf["commercial"]["years_on_market"])
    ramp = float(conf["commercial"]["ramp_years"])
    at_launch = sum(
        s.peak * s.margin * min(1.0, y / ramp) / (1 + s.discount) ** y for y in range(1, years + 1)
    )
    pv_revenue = s.pos * at_launch / (1 + s.discount) ** (t / 12)
    return pv_revenue - pv_cost


def value(
    stage: str | None, pos: Range, base: BaseRates, conf: dict[str, Any]
) -> tuple[Valuation, list[str]]:
    notes: list[str] = []
    if stage is None:
        stage = conf["default_stage"]["value"]
        notes.append(f"stage not given; assumed {stage}")
    group = conf["area_groups"].get(base.area, "general")
    phases = phases_ahead(stage)  # type: ignore[arg-type]
    first = phases[: 2 if phases and phases[0] == "ind_enabling" else 1]
    scenarios = {e: _scenario(e, pos, conf, group, phases) for e in ("low", "base", "high")}

    capital = {e: sum(_phase_cost(s, p) for p in first) for e, s in scenarios.items()}
    months = {e: sum(s.months[p] for p in first) for e, s in scenarios.items()}
    rnpv = {e: _rnpv(s, phases, base, conf) for e, s in scenarios.items()}

    reach, t, points = 1.0, 0.0, []
    mid = scenarios["base"]
    for phase in phases:
        t += mid.months[phase]
        if phase in PHASES:
            reach *= base.transitions[phase]
        name = "approval" if phase == "nda" else f"{LABEL[phase]} complete"
        points.append(f"{name} at ~{t:.0f} months (base-rate chance to get there {reach:.0%})")

    cpp = conf["cost_per_patient_usd"]
    assumptions = [
        Assumption(
            name="cost per patient (USD)",
            value=_range(cpp, "USD"),
            basis="sourced",
            citation=cpp["citation"],
        ),
        Assumption(
            name="discount rate", value=_range(conf["discount_rate"], "rate"), basis="assumption"
        ),
        Assumption(
            name=f"peak net sales per year (USD, {group})",
            value=_range(conf["peak_sales_usd"][group], "USD"),
            basis="assumption",
        ),
        Assumption(
            name="operating margin",
            value=_range(conf["commercial"]["operating_margin"], "share"),
            basis="assumption",
        ),
        *(
            Assumption(
                name=f"{LABEL[p]} trial size ({group})",
                value=_range(conf["trial_size"][group][p], "patients"),
                basis="assumption",
            )
            for p in phases
            if p in conf["trial_size"][group]
        ),
        Assumption(name="probability of success (ledger posterior)", value=pos, basis="assumption"),
    ]
    notes.append(f"trial sizes and market: '{group}' group (area '{base.area}')")
    return (
        Valuation(
            next_milestone=milestone(stage),  # type: ignore[arg-type]
            # the pessimistic scenario is the expensive one, so take min and max, not low and high
            capital_to_milestone=Range(
                low=round(min(capital.values())),
                base=round(capital["base"]),
                high=round(max(capital.values())),
                unit="USD",
            ),
            time_to_milestone_months=Range(
                low=min(months.values()),
                base=months["base"],
                high=max(months.values()),
                unit="months",
            ),
            rnpv=Range(
                low=round(rnpv["low"]),
                base=round(rnpv["base"]),
                high=round(rnpv["high"]),
                unit="USD",
            ),
            value_inflection_points=points,
            assumptions=assumptions,
        ),
        notes,
    )
