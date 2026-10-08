import re
from collections import Counter
from typing import Any

from app.contracts import EntityRef, Evidence, NodeSpec, SourceRef
from app.graph.state import GraphState
from app.nodes.base import NodeContext
from app.sources.records import parent_name
from app.store import KGEdge

SPEC = NodeSpec(
    id="knowledge_indexer",
    label="Knowledge indexer",
    kind="knowledge",
    phase="index",
    description="Builds the vector index and knowledge-graph edges over the frozen evidence set.",
    reads=["entities", "evidence_ids"],
    writes=["scratch"],
    correctable=False,
    critical=False,
)

STOPPED = {"TERMINATED", "WITHDRAWN", "SUSPENDED"}


def _mentions(text: str, name: str) -> bool:
    return len(name) >= 3 and re.search(rf"\b{re.escape(name)}\b", text, re.I) is not None


def build_graph(
    entities: list[EntityRef], evidence: list[Evidence], sources: dict[str, SourceRef]
) -> tuple[list[EntityRef], list[KGEdge]]:
    """Edges only where a record states the relation; each edge cites the evidence it came from."""
    nodes: dict[str, EntityRef] = {e.id: e for e in entities}
    edges: list[KGEdge] = []
    target = next((e for e in entities if e.kind == "target"), None)
    disease = next((e for e in entities if e.kind == "disease"), None)

    def edge(src: str, dst: str, relation: str, ev: Evidence) -> None:
        edges.append(KGEdge(source=src, target=dst, relation=relation, evidence_id=ev.id))

    # drugs first: trials and papers are linked to them by name
    for ev in evidence:
        data, source = ev.data or {}, sources.get(ev.source_id)
        if not (data.get("drug_id") and data.get("drug") and source):
            continue
        drug = nodes.setdefault(
            data["drug_id"],
            EntityRef(
                id=data["drug_id"],
                label=data["drug"],
                kind="drug",
                external_ids={"chembl": data["drug_id"]},
            ),
        )
        owner = source.identifiers.get("opentargets")
        if target and owner == target.id:
            edge(drug.id, target.id, "targets", ev)
        elif disease and owner == disease.id:
            edge(drug.id, disease.id, "indicated_for", ev)

    drugs = [n for n in nodes.values() if n.kind == "drug"]
    for ev in evidence:
        data, source = ev.data or {}, sources.get(ev.source_id)
        if source is None:
            continue
        if source.type == "db_record" and "overall" in data and target and disease:
            edge(target.id, disease.id, "associated_with", ev)
        elif source.type == "trial" and data.get("nct_id"):
            trial = nodes.setdefault(
                data["nct_id"],
                EntityRef(
                    id=data["nct_id"],
                    label=source.title,
                    kind="trial",
                    external_ids={"nct": data["nct_id"]},
                ),
            )
            interventions = " ".join(data.get("interventions") or [])
            stopped = data.get("overall_status") in STOPPED
            for drug in drugs:
                if _mentions(interventions, parent_name(drug.label)):
                    edge(trial.id, drug.id, "stopped_testing" if stopped else "tests", ev)
            conditions = " ".join(data.get("conditions") or [])
            if disease and _mentions(conditions, disease.label.split()[0]):
                edge(trial.id, disease.id, "studies", ev)
        elif source.type in ("paper", "preprint", "user_provided"):
            doc = nodes.setdefault(
                source.id, EntityRef(id=source.id, label=source.title[:200], kind="paper")
            )
            text = f"{source.title} {ev.excerpt}"
            for entity in [*entities, *drugs]:
                name = parent_name(entity.label) if entity.kind == "drug" else entity.label
                if _mentions(text, name):
                    edge(doc.id, entity.id, "reports_on", ev)
    return list(nodes.values()), edges


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    evidence = await ctx.store.evidence.get_many_evidence(state.get("evidence_ids", []))
    source_ids = sorted({e.source_id for e in evidence})
    sources = {s.id: s for s in await ctx.store.evidence.get_sources(source_ids)}
    ctx.log(f"indexing {len(evidence)} evidence items")
    # trial status lines don't name the drug; the source title does
    titles = {e.id: sources[e.source_id].title for e in evidence if e.source_id in sources}
    await ctx.store.vectors.add(evidence, titles)

    entities = state.get("entities")
    resolved = (
        [e for e in (entities.disease, entities.target, entities.drug) if e] if entities else []
    )
    nodes, edges = build_graph(resolved, evidence, sources)
    await ctx.store.kg.add_nodes(nodes)
    await ctx.store.kg.add_edges(edges)
    relations = Counter(e.relation for e in edges)
    ctx.log(
        f"added {len(nodes)} entities and {len(edges)} graph edges"
        + (": " + ", ".join(f"{n} {r}" for r, n in sorted(relations.items())) if edges else "")
    )
    return {
        "scratch": {
            ctx.node_id: {
                "indexed": len(evidence),
                "kg_edges": len(edges),
                "relations": dict(relations),
            }
        }
    }
