from collections.abc import Sequence
from dataclasses import replace
from typing import Protocol

from app.contracts import PanelCandidate, PanelResult
from app.llm.service import LLMService
from app.llm.types import LLMResult, LLMTask


class PanelRunner(Protocol):
    supported: bool

    async def run(self, service: LLMService, task: LLMTask, models: Sequence[str]) -> LLMResult:
        """N parallel completions plus one comparator call -> merged output with a PanelResult."""
        ...


class MockPanelRunner:
    supported = True

    async def run(self, service: LLMService, task: LLMTask, models: Sequence[str]) -> LLMResult:
        base = await service.complete(task, models[0])
        names = [models[i % len(models)] for i in range(2)]
        panel = PanelResult(
            candidates=[
                PanelCandidate(model=f"{m}#{i + 1}", summary=f"mock candidate {i + 1}")
                for i, m in enumerate(names)
            ],
            consensus=f"mock consensus for {task.purpose}",
            disagreements=[],
            agreement=1.0,
        )
        return replace(base, panel=panel)


class UnavailablePanelRunner:
    """Live panel logic is Stage 3U; callers downgrade to a single call."""

    supported = False

    async def run(self, service: LLMService, task: LLMTask, models: Sequence[str]) -> LLMResult:
        raise NotImplementedError("live panel mode is not implemented yet")
