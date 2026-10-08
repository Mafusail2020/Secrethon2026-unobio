from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._data import client, entity_ids, force_refresh, register
from app.nodes._fixture import nap, register_fixture_sources
from app.nodes.base import NodeContext
from app.sources.base import SourceError
from app.sources.europepmc import EuropePMCClient
from app.sources.records import paper_records

SPEC = NodeSpec(
    id="fetch_literature",
    label="Europe PMC",
    kind="data",
    phase="fetch",
    description="Fetches literature, including preprints, relevant to the program.",
    reads=["program", "entities", "questions"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)


def _q(text: str) -> str:
    return '"' + text.replace('"', "").strip() + '"'


def build_queries(
    target: str | None, drug: str | None, disease_names: list[str]
) -> list[tuple[str, str]]:
    """(purpose, query) in priority order; effort decides how many run."""
    disease = "(" + " OR ".join(_q(d) for d in dict.fromkeys(disease_names)) + ")"
    subject = " OR ".join(_q(x) for x in (target, drug) if x)
    subject = f"({subject})" if subject else None
    if subject is None:
        return [
            ("standard of care", f'{disease} AND ("standard of care" OR guideline)'),
            ("failures", f"{disease} AND (terminated OR futility OR failed) AND trial"),
        ]
    return [
        ("target and disease", f"{subject} AND {disease}"),
        (
            "clinical results",
            f'{subject} AND {disease} AND ("phase 3" OR "phase 2" OR "clinical trial")',
        ),
        (
            "failures and safety",
            f'{subject} AND {disease} AND (terminated OR futility OR failed OR "no benefit" '
            "OR toxicity OR hepatotoxicity OR adverse)",
        ),
        (
            "human genetics",
            f'{subject} AND {disease} AND (genetic OR GWAS OR variant OR "loss-of-function")',
        ),
        ("reviews", f'{subject} AND {disease} AND PUB_TYPE:"review"'),
        ("standard of care", f'{disease} AND ("standard of care" OR guideline OR guidelines)'),
        ("preprints", f"{subject} AND {disease} AND SRC:PPR"),
        ("biomarkers", f'{subject} AND {disease} AND (biomarker OR "target engagement")'),
    ]


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    epmc = client(ctx, "europepmc", EuropePMCClient)
    if epmc is None:
        return await _fixture_run(state, ctx)
    entities = state.get("entities")
    if entities is None:
        ctx.log("no resolved entities, nothing to search", "warn")
        return {}
    program, fr, ids = state["program"], force_refresh(state), entity_ids(entities)
    queries = build_queries(
        entities.target.label if entities.target else None,
        entities.drug.label if entities.drug else program.drug_name,
        [entities.disease.label, program.indication],
    )[: max(2, ctx.effort.n_queries)]

    papers: dict[str, dict[str, Any]] = {}
    per_query: dict[str, int] = {}
    for purpose, query in queries:
        try:
            found = await epmc.search(query, page_size=ctx.effort.retrieval_k, force_refresh=fr)
        except SourceError as exc:
            ctx.log(f"query '{purpose}' failed: {exc}", "warn")
            continue
        new = [p for p in found if p.get("id") and p["id"] not in papers]
        papers.update((p["id"], p) for p in new)
        per_query[purpose] = len(new)
        ctx.progress(f"query '{purpose}': {len(found)} papers, {len(new)} new")

    n_sources, n_evidence = await register(
        ctx, state, (paper_records(p, ids) for p in papers.values())
    )
    preprints = sum(p.get("is_preprint", False) for p in papers.values())
    ctx.log(
        f"registered {n_sources} paper(s) ({preprints} preprints), {n_evidence} evidence item(s)"
    )
    return {"scratch": {ctx.node_id: {"queries": dict(queries), "new_per_query": per_query}}}


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("querying Europe PMC (FIXTURE: no network call)")
    await nap(ctx.node_id)
    sources, evidence = await register_fixture_sources(ctx, state, "paper")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
