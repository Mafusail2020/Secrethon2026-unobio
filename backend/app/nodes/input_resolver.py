from typing import Any

from app.contracts import EntityRef, NodeSpec, ResolvedEntities
from app.graph.state import GraphState
from app.nodes._fixture import fixture_report, nap, slug
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="input_resolver",
    label="Input resolver",
    kind="processing",
    description="Resolves free-text indication, mechanism and drug into disease, target and drug ids plus therapeutic areas.",
    reads=["program"],
    writes=["entities"],
    correctable=True,
    critical=True,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
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
