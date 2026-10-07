import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.contracts import LLMCallRecord, RunOptions
from app.llm.budget import RunBudget
from app.llm.panel import PanelRunner
from app.llm.registry import ModelRegistry
from app.llm.service import LLMService
from app.llm.types import EffortKnobs, LLMResult, LLMTask

OnCall = Callable[[LLMCallRecord], Awaitable[None] | None]
OnLog = Callable[[str, str], None]


@dataclass
class RunLLM:
    """Everything LLM-related that is shared by the nodes of one run."""

    service: LLMService
    registry: ModelRegistry
    options: RunOptions
    knobs: EffortKnobs
    budget: RunBudget
    panel: PanelRunner
    max_panel_size: int

    @property
    def model(self) -> str:
        return self.options.model or self.registry.pick(self.knobs.tier)


class NodeLLM:
    """The `ctx.llm` a node sees: picks the model from effort, applies the budget, runs panel."""

    def __init__(self, run: RunLLM, node_kind: str, on_call: OnCall, on_log: OnLog) -> None:
        self._run = run
        self._kind = node_kind
        self._on_call = on_call
        self._on_log = on_log

    async def complete(self, task: LLMTask) -> LLMResult:
        run = self._run
        model = run.model
        est_tokens = (len(task.system) + len(task.user)) // 4 + 1 + task.max_tokens
        est_cost = run.registry.cost(model, est_tokens - task.max_tokens, task.max_tokens)

        models: list[str] = []
        if run.options.effort == "panel" and self._kind == "analysis":
            if not run.panel.supported:
                self._on_log("warn", "panel mode is not available yet; using a single call")
            else:
                n = min(max(run.options.panel_size, 2), run.max_panel_size)
                pool = run.options.panel_models or [model]
                models = [pool[i % len(pool)] for i in range(n)]
                calls = n + 1  # candidates plus the comparator
                if run.budget.would_exceed(
                    est_tokens * calls, est_cost * calls if est_cost is not None else None
                ):
                    self._on_log(
                        "warn", "run budget too low for panel; downgraded to a single call"
                    )
                    models = []

        run.budget.check(est_tokens, est_cost)
        result = (
            await run.panel.run(run.service, task, models)
            if models
            else await run.service.complete(task, model)
        )
        run.budget.add(result)

        record = LLMCallRecord(
            model=result.model,
            purpose=f"{task.purpose}.panel" if result.panel else task.purpose,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            cost_usd=result.cost_usd,
            cached=result.cached,
            latency_ms=result.latency_ms,
        )
        outcome = self._on_call(record)
        if inspect.isawaitable(outcome):
            await outcome
        return result
