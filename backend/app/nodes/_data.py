"""Shared plumbing for the data nodes: client lookup, corrections, provenance registration."""

import re
from collections.abc import Iterable
from typing import Any

from app.contracts import Evidence, ResolvedEntities, SourceRef
from app.graph.state import GraphState
from app.nodes._fixture import excluded_ids
from app.nodes.base import NodeContext

NCT_RE = re.compile(r"\bNCT\d{8}\b", re.I)


def client[C](ctx: NodeContext, name: str, cls: type[C]) -> C | None:
    """The live client, or None in fixture mode (no clients registered)."""
    if not ctx.sources.has(name):
        return None
    found = ctx.sources.get(name)
    return found if isinstance(found, cls) else None


def force_refresh(state: GraphState) -> bool:
    options = state.get("options")
    return bool(options and options.force_refresh)


def entity_ids(entities: ResolvedEntities | None) -> list[str]:
    if entities is None:
        return []
    refs = (entities.target, entities.disease, entities.drug)
    return [r.id for r in refs if r is not None]


def correction_text(ctx: NodeContext) -> str:
    return " ".join(c.text for c in ctx.corrections_for())


def correction_links(ctx: NodeContext) -> list[str]:
    return [str(link) for c in ctx.corrections_for() for link in c.add_links]


async def register(
    ctx: NodeContext,
    state: GraphState,
    records: Iterable[tuple[SourceRef, list[Evidence]] | None],
) -> tuple[int, int]:
    """Registers sources with at least one evidence item the user has not excluded."""
    excluded = excluded_ids(state)
    sources: dict[str, SourceRef] = {}
    evidence: dict[str, Evidence] = {}
    dropped = 0
    for record in records:
        if record is None:
            continue
        source, items = record
        kept = [e for e in items if e.id not in excluded]
        dropped += len(items) - len(kept)
        if not kept:
            continue
        sources.setdefault(source.id, source)
        for e in kept:
            evidence.setdefault(e.id, e)
    if dropped:
        ctx.log(f"dropped {dropped} evidence item(s) excluded by a correction")
    if sources:
        await ctx.register_sources(list(sources.values()))
        await ctx.register_evidence(list(evidence.values()))
    return len(sources), len(evidence)


def summary(**counts: Any) -> dict[str, Any]:
    return {k: v for k, v in counts.items() if v not in (None, [], {})}
