import re
from typing import Any

import yaml

from app.contracts import NodeSpec, Range
from app.core.settings import get_settings
from app.graph.state import GraphState
from app.nodes.base import NodeContext
from app.quant.base_rates import base_rates
from app.quant.valuation import value

SPEC = NodeSpec(
    id="valuation",
    label="Valuation",
    kind="quant",
    phase="quant",
    description="Estimates capital and time to the next milestone and an rNPV range.",
    reads=["program", "entities", "twin_stats", "ledger", "claims"],
    writes=["valuation"],
    correctable=True,
    critical=False,
)

_SCALE = {"k": 1e3, "m": 1e6, "mm": 1e6, "b": 1e9, "bn": 1e9}
_NUMBER = r"\$?\s*([\d.,]+)\s*(k|mm|m|bn|b)?\b"
# correction phrases we can turn into an edited assumption: (pattern, config path, kind)
_EDITS = [
    (rf"cost per patient\D{{0,20}}?{_NUMBER}", ("cost_per_patient_usd",), "usd"),
    (rf"peak (?:net )?sales\D{{0,20}}?{_NUMBER}", ("peak_sales_usd",), "usd"),
    (r"discount rate\D{0,20}?([\d.]+)\s*%", ("discount_rate",), "pct"),
]


def _amount(number: str, unit: str | None, kind: str) -> float:
    x = float(number.replace(",", ""))
    return x / 100 if kind == "pct" else x * _SCALE.get((unit or "").lower(), 1)


def apply_corrections(conf: dict[str, Any], texts: list[str], group: str) -> list[str]:
    """Edits config in place from phrases like 'cost per patient 250k'. Returns what was applied."""
    applied = []
    for text in texts:
        for pattern, path, kind in _EDITS:
            m = re.search(pattern, text, re.I)
            if not m:
                continue
            x = _amount(m.group(1), m.group(2) if kind != "pct" else None, kind)
            entry = conf[path[0]]
            if path[0] == "peak_sales_usd":
                entry = entry[group]
            entry.update(low=x, base=x, high=x)
            entry.pop("citation", None)
            applied.append(f"{path[0]} set to {x:g} by a correction")
    return applied


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    program, entities, ledger = state["program"], state.get("entities"), state.get("ledger")
    twin = state.get("twin_stats")
    pos = ledger.posterior if ledger else (twin.prior_pos if twin else None)
    if pos is None or entities is None:
        raise ValueError("valuation needs resolved entities and a ledger or twin prior")
    conf = yaml.safe_load((get_settings().config_dir / "valuation.yaml").read_text())
    base = base_rates(entities.therapeutic_areas, entities.disease.label)
    group = conf["area_groups"].get(base.area, "general")

    corrections = [c.text for c in ctx.corrections_for()]
    applied = apply_corrections(conf, corrections, group)
    for line in applied:
        ctx.log(line)
    if corrections and not applied:
        ctx.log(
            "correction noted, but it names no assumption this model can edit "
            "(cost per patient, peak sales, discount rate)",
            "warn",
        )

    valuation, notes = value(program.stage, pos, base, conf)
    if applied:
        # an edited input is the user's number, not ours or the cited one
        valuation = valuation.model_copy(
            update={
                "assumptions": [
                    a.model_copy(update={"basis": "assumption", "citation": None})
                    if a.name.startswith(("cost per patient", "peak net sales", "discount rate"))
                    else a
                    for a in valuation.assumptions
                ]
            }
        )
    for note in notes:
        ctx.log(note)
    cap, rnpv = valuation.capital_to_milestone, valuation.rnpv

    def usd(r: Range) -> str:
        return f"${r.low / 1e6:,.0f}M–${r.high / 1e6:,.0f}M (base ${r.base / 1e6:,.0f}M)"

    ctx.log(f"next milestone: {valuation.next_milestone}; capital {usd(cap)}; rNPV {usd(rnpv)}")
    return {"valuation": valuation}
