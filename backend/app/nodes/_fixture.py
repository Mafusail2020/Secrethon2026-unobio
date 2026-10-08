"""Shared helpers for the stub nodes. Real node implementations do not need this module."""

import asyncio
import hashlib
import re
from functools import cache

from app.contracts import KeyPoint, UnderwritingReport
from app.core.settings import ROOT, get_settings
from app.graph.state import GraphState
from app.llm.types import LLMResult, LLMTask
from app.nodes.base import NodeContext

FIXTURE_PATH = ROOT / "contracts" / "fixtures" / "report_bace1_alzheimers.json"


@cache
def fixture_report() -> UnderwritingReport:
    return UnderwritingReport.model_validate_json(FIXTURE_PATH.read_text())


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "x"


async def nap(node_id: str, factor: float = 1.0) -> None:
    """Deterministic 0.3-1.0 s pause (times factor) so streaming is visible in the UI."""
    scale = get_settings().stub_delay_scale
    if scale:
        fraction = int(hashlib.sha256(node_id.encode()).hexdigest()[:4], 16) / 0xFFFF
        await asyncio.sleep((0.3 + 0.7 * fraction) * scale * factor)


def excluded_ids(state: GraphState) -> set[str]:
    return {i for c in state.get("corrections", []) for i in c.exclude_evidence_ids}


async def touch_llm(ctx: NodeContext, purpose: str) -> LLMResult | None:
    """Exercise the LLM path (events, cost, panel) in mock mode; never spend credits on a stub."""
    if get_settings().llm_mode != "mock":
        return None
    task = LLMTask(
        purpose=purpose, system="FIXTURE stub", user=purpose, schema=KeyPoint, max_tokens=64
    )
    return await ctx.llm.complete(task)


async def register_fixture_sources(
    ctx: NodeContext,
    state: GraphState,
    source_type: str,
    *,
    title_has: str | None = None,
    title_lacks: str | None = None,
) -> tuple[int, int]:
    """Register fixture sources of a type plus their evidence, minus corrected-away evidence."""
    report = fixture_report()
    excluded = excluded_ids(state)
    n_sources = n_evidence = 0
    wanted = (
        s
        for s in report.sources.values()
        if s.type == source_type
        and (title_has is None or title_has in s.title.lower())
        and (title_lacks is None or title_lacks not in s.title.lower())
    )
    for source in wanted:
        evidence = [
            e for e in report.evidence.values() if e.source_id == source.id and e.id not in excluded
        ]
        if not evidence:
            continue
        await ctx.register_sources([source])
        await ctx.register_evidence(evidence)
        n_sources += 1
        n_evidence += len(evidence)
    return n_sources, n_evidence
