import pytest

from app.contracts import ModelInfo, RunOptions
from app.llm.budget import RunBudget
from app.llm.mock import MockBackend
from app.llm.node_llm import NodeLLM, RunLLM
from app.llm.panel import MockPanelRunner, UnavailablePanelRunner
from app.llm.registry import ModelRegistry
from app.llm.service import LLMService
from app.llm.types import EffortKnobs, LLMBudgetError, LLMResult, LLMTask


class FakeRepo:
    async def cache_get(self, key):
        return None

    async def cache_put(self, *args):
        return None


def _registry(priced: bool) -> ModelRegistry:
    return ModelRegistry(
        [
            ModelInfo(
                id="m",
                label="m",
                tier="cheap",
                price_in_per_mtok=1.0 if priced else None,
                price_out_per_mtok=2.0 if priced else None,
                available=True,
                default=True,
            )
        ]
    )


def _node_llm(effort: str, budget: RunBudget, panel=None, priced=False, kind="analysis"):
    registry = _registry(priced)
    run = RunLLM(
        service=LLMService(MockBackend(), registry, FakeRepo(), False),  # type: ignore[arg-type]
        registry=registry,
        options=RunOptions(effort=effort, panel_size=3),  # type: ignore[arg-type]
        knobs=EffortKnobs(effort=effort, retrieval_k=4, n_queries=2, max_tokens=256, tier="cheap"),  # type: ignore[arg-type]
        budget=budget,
        panel=panel or MockPanelRunner(),
        max_panel_size=4,
    )
    logs: list[tuple[str, str]] = []
    records = []
    node = NodeLLM(run, kind, records.append, lambda level, msg: logs.append((level, msg)))
    return node, logs, records


TASK = LLMTask(purpose="t", system="s" * 40, user="u" * 40, max_tokens=100)


def test_budget_counts_only_uncached_spend():
    budget = RunBudget(max_tokens=1000, max_cost_usd=0)
    base = dict(model="m", text="", parsed=None, latency_ms=0)
    budget.add(LLMResult(tokens_in=10, tokens_out=5, cost_usd=0.01, cached=False, **base))
    budget.add(LLMResult(tokens_in=999, tokens_out=999, cost_usd=0.5, cached=True, **base))
    assert (budget.tokens, budget.cost_usd) == (15, 0.01)


async def test_panel_runs_when_budget_allows():
    node, logs, records = _node_llm("panel", RunBudget(max_tokens=100_000, max_cost_usd=0))
    result = await node.complete(TASK)
    assert result.panel is not None and len(result.panel.candidates) == 2
    assert records[0].purpose == "t.panel" and not logs


async def test_panel_downgrades_to_single_when_budget_is_tight():
    # one call fits (~120 tokens), the 4 calls a panel of 3 needs do not
    node, logs, records = _node_llm("panel", RunBudget(max_tokens=300, max_cost_usd=0))
    result = await node.complete(TASK)
    assert result.panel is None
    assert records[0].purpose == "t"
    assert any("downgraded" in msg for _, msg in logs)


async def test_node_is_skipped_via_budget_error_when_even_one_call_does_not_fit():
    node, _, records = _node_llm("medium", RunBudget(max_tokens=50, max_cost_usd=0))
    with pytest.raises(LLMBudgetError):
        await node.complete(TASK)
    assert records == []


async def test_cost_guard_uses_prices_when_known():
    budget = RunBudget(max_tokens=0, max_cost_usd=0.000001)
    node, _, _ = _node_llm("medium", budget, priced=True)
    with pytest.raises(LLMBudgetError):
        await node.complete(TASK)


async def test_cost_guard_is_inert_without_prices():
    node, _, records = _node_llm("medium", RunBudget(max_tokens=0, max_cost_usd=0.000001))
    await node.complete(TASK)
    assert len(records) == 1


async def test_panel_only_applies_to_analysis_nodes():
    node, _, _ = _node_llm("panel", RunBudget(100_000, 0), kind="quant")
    assert (await node.complete(TASK)).panel is None


async def test_unsupported_live_panel_falls_back_with_warning():
    node, logs, _ = _node_llm("panel", RunBudget(100_000, 0), panel=UnavailablePanelRunner())
    assert (await node.complete(TASK)).panel is None
    assert logs and logs[0][0] == "warn"
