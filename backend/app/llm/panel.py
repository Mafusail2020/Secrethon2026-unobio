import asyncio
import logging
from collections.abc import Sequence
from dataclasses import replace
from typing import Any, Protocol

from pydantic import BaseModel, Field, create_model

from app.contracts import PanelCandidate, PanelResult
from app.llm.service import LLMService
from app.llm.types import LLMBudgetError, LLMResult, LLMTask

log = logging.getLogger(__name__)


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
    """Stands in where panel mode cannot run; callers downgrade to a single call."""

    supported = False

    async def run(self, service: LLMService, task: LLMTask, models: Sequence[str]) -> LLMResult:
        raise NotImplementedError("panel mode is not available here")


class _Comparison(BaseModel):
    consensus: str
    disagreements: list[str] = Field(default_factory=list)
    agreement: float = Field(ge=0, le=1)
    candidate_summaries: list[str] = Field(default_factory=list)


_COMPARATOR_SYSTEM = (
    "You merge the answers of several independent analysts who all did the same task. "
    "Keep a point only if at least two analysts support it, or one analyst supports it with "
    "cited evidence that no other analyst contradicts. Never add anything none of them said. "
    "Keep every evidence id and quote exactly as the analysts wrote it. "
    "List where they disagree, plainly. "
    "`agreement` is the share of the substantive points they agree on, between 0 and 1. "
    "`candidate_summaries` has one short sentence per analyst, in the order given."
)

# a model that appears twice in the pool would otherwise return its cached first answer twice
_SPREAD = (None, 0.7, 1.0, 0.4)
_GATEWAY_CAP = 4000
_COMPARE_CHARS = 12000
_SUMMARY_FALLBACK = 200


def _merge_model(schema: type[BaseModel] | None) -> type[BaseModel]:
    merged: Any = schema if schema is not None else str
    return create_model(
        "PanelMerge",
        __base__=_Comparison,
        merged=(merged, ...),
    )


def _candidate_task(task: LLMTask, nth: int) -> LLMTask:
    temperature = _SPREAD[nth % len(_SPREAD)]
    return task if temperature is None or nth == 0 else replace(task, temperature=temperature)


def _comparator_task(task: LLMTask, texts: list[str], models: list[str]) -> LLMTask:
    pairs = zip(models, texts, strict=True)
    answers = "\n\n".join(f"=== Analyst {i + 1} ({m}) ===\n{t}" for i, (m, t) in enumerate(pairs))
    return LLMTask(
        purpose=f"{task.purpose}.compare",
        system=f"{_COMPARATOR_SYSTEM}\n\nThe task they were given: {task.purpose}.",
        user=f"{answers}\n\nMerge these into `merged`, in the same format each analyst used.",
        schema=_merge_model(task.schema),
        max_tokens=min(task.max_tokens + 800, _GATEWAY_CAP),
        temperature=0.0,
    )


def _total(results: list[LLMResult]) -> tuple[int, int, float | None]:
    costs = [r.cost_usd for r in results]
    return (
        sum(r.tokens_in for r in results),
        sum(r.tokens_out for r in results),
        None if any(c is None for c in costs) else sum(c or 0.0 for c in costs),
    )


class LivePanelRunner:
    """N analysts answer one task in parallel; one more call merges them and lists differences."""

    supported = True

    async def run(self, service: LLMService, task: LLMTask, models: Sequence[str]) -> LLMResult:
        seen: dict[str, int] = {}
        calls = []
        for m in models:
            calls.append(service.complete(_candidate_task(task, seen.get(m, 0)), m))
            seen[m] = seen.get(m, 0) + 1
        outcomes = await asyncio.gather(*calls, return_exceptions=True)
        kept = [(m, r) for m, r in zip(models, outcomes, strict=True) if isinstance(r, LLMResult)]
        for m, r in zip(models, outcomes, strict=True):
            if isinstance(r, BaseException):
                log.warning("panel analyst %s failed on %s: %s", m, task.purpose, r)
        if not kept:
            raise next(r for r in outcomes if isinstance(r, BaseException))
        if len(kept) == 1:
            return kept[0][1]

        names = [m for m, _ in kept]
        results = [r for _, r in kept]
        comparator = _comparator_task(task, [r.text for r in results], names)
        # the gateway refuses long prompts; N full answers often are one, so skip a doomed call
        if len(comparator.system) + len(comparator.user) > _COMPARE_CHARS:
            log.warning("panel answers on %s are too long to compare", task.purpose)
            return self._unmerged(results, names, "The answers were too long to compare")
        try:
            merged = await service.complete(comparator, names[0])
        except LLMBudgetError:
            raise
        except Exception as exc:  # a refused comparison must not cost the analysts' answers
            log.warning("panel comparison failed on %s: %s", task.purpose, exc)
            return self._unmerged(results, names, "The comparison step failed")

        parsed: Any = merged.parsed
        assert parsed is not None
        everything = [*results, merged]
        tokens_in, tokens_out, cost = _total(everything)
        summaries = list(parsed.candidate_summaries)
        panel = PanelResult(
            candidates=[
                PanelCandidate(
                    model=f"{m}#{i + 1}",
                    summary=summaries[i] if i < len(summaries) else r.text[:_SUMMARY_FALLBACK],
                )
                for i, (m, r) in enumerate(kept)
            ],
            consensus=parsed.consensus,
            disagreements=list(parsed.disagreements),
            agreement=parsed.agreement,
        )
        merged_value = parsed.merged
        return LLMResult(
            model=merged.model,
            text=merged_value if isinstance(merged_value, str) else merged_value.model_dump_json(),
            parsed=None if isinstance(merged_value, str) else merged_value,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            cached=all(r.cached for r in everything),
            latency_ms=max(r.latency_ms for r in results) + merged.latency_ms,
            panel=panel,
        )

    @staticmethod
    def _unmerged(results: list[LLMResult], names: list[str], why: str) -> LLMResult:
        tokens_in, tokens_out, cost = _total(results)
        panel = PanelResult(
            candidates=[
                PanelCandidate(model=f"{m}#{i + 1}", summary=r.text[:_SUMMARY_FALLBACK])
                for i, (m, r) in enumerate(zip(names, results, strict=True))
            ],
            consensus="The answers could not be compared; the first one is used as written.",
            disagreements=[f"{why}, so agreement between the analysts is unknown."],
            agreement=0.0,
        )
        return replace(
            results[0],
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            cached=all(r.cached for r in results),
            latency_ms=max(r.latency_ms for r in results),
            panel=panel,
        )
