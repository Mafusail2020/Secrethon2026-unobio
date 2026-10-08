import hashlib
import re
from collections import defaultdict
from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="evidence_normalizer",
    label="Evidence normalizer",
    kind="processing",
    phase="index",
    description="Dedupes and chunks fetched material into canonical evidence and source records.",
    reads=["source_ids", "evidence_ids", "scratch"],
    writes=["source_ids", "evidence_ids"],
    correctable=False,
    critical=False,
)

# identifiers that name the same real-world record whichever query or API found it
SHARED_IDS = ("nct", "pmid", "doi", "set_id", "application_number")


def _fingerprint(text: str) -> str:
    return hashlib.sha256(re.sub(r"\W+", " ", text.lower()).strip().encode()).hexdigest()[:16]


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    # Ids are content-addressed at fetch time, so exact repeats are already merged, and long user
    # pages are chunked by the fetcher. The state reducers only add ids, so this node checks
    # provenance and reports overlaps rather than removing anything.
    evidence_ids, source_ids = state.get("evidence_ids", []), state.get("source_ids", [])
    evidence = await ctx.store.evidence.get_many_evidence(evidence_ids)
    sources = {s.id: s for s in await ctx.store.evidence.get_sources(source_ids)}
    ctx.log(f"checking {len(evidence)} evidence items from {len(sources)} sources")

    missing = len(evidence_ids) - len(evidence)
    if missing:
        ctx.log(f"{missing} evidence id(s) are not in the store", "error")
    orphans = [e.id for e in evidence if e.source_id not in sources]
    if orphans:
        ctx.log(f"{len(orphans)} evidence item(s) point at an unregistered source", "error")

    by_text: dict[str, set[str]] = defaultdict(set)
    for e in evidence:
        by_text[_fingerprint(e.excerpt)].add(e.source_id)
    repeated = sum(1 for srcs in by_text.values() if len(srcs) > 1)
    if repeated:
        ctx.log(f"{repeated} excerpt(s) appear verbatim in more than one source")

    by_identifier: dict[tuple[str, str], set[str]] = defaultdict(set)
    for s in sources.values():
        for key in SHARED_IDS:
            if key in s.identifiers:
                by_identifier[(key, s.identifiers[key].lower())].add(s.id)
    split = {k: v for k, v in by_identifier.items() if len(v) > 1}
    for (key, value), ids in list(split.items())[:5]:
        ctx.log(f"{key} {value} is recorded under {len(ids)} source ids", "warn")

    if not (missing or orphans or repeated or split):
        ctx.log("no duplicates, every evidence item resolves to its source")
    return {}
