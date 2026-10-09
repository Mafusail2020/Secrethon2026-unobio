import pytest
from pydantic import BaseModel

from app.llm.panel import LivePanelRunner
from app.llm.types import LLMParseError, LLMResult, LLMTask


class Answer(BaseModel):
    verdict: str
    score: int


def _result(model: str, text: str, parsed=None, *, cost: float | None = 0.01, cached=False):
    return LLMResult(
        model=model,
        text=text,
        parsed=parsed,
        tokens_in=100,
        tokens_out=50,
        cost_usd=cost,
        cached=cached,
        latency_ms=200,
    )


class FakeService:
    """Answers each analyst call with its model's script, and the comparator with `compare`."""

    def __init__(self, answers: dict[str, object], compare: object) -> None:
        self.answers = answers
        self.compare = compare
        self.calls: list[tuple[LLMTask, str]] = []

    async def complete(self, task: LLMTask, model: str) -> LLMResult:
        self.calls.append((task, model))
        if task.purpose.endswith(".compare"):
            if isinstance(self.compare, Exception):
                raise self.compare
            schema = task.schema
            assert schema is not None
            parsed = schema.model_validate(self.compare)
            return _result(model, "compared", parsed)
        outcome = self.answers[model]
        if isinstance(outcome, Exception):
            raise outcome
        assert isinstance(outcome, dict)
        return _result(model, str(outcome), Answer.model_validate(outcome))


TASK = LLMTask(purpose="section.thesis", system="s", user="u", schema=Answer, max_tokens=900)
COMPARE = {
    "consensus": "Both say invest with caution.",
    "disagreements": ["They differ on the score."],
    "agreement": 0.8,
    "candidate_summaries": ["leans invest", "leans invest, lower score"],
    "merged": {"verdict": "invest", "score": 6},
}


async def test_candidates_run_then_one_comparison_merges_them():
    service = FakeService(
        {"a": {"verdict": "invest", "score": 7}, "b": {"verdict": "invest", "score": 5}}, COMPARE
    )
    result = await LivePanelRunner().run(service, TASK, ["a", "b"])  # type: ignore[arg-type]
    assert [t.purpose for t, _ in service.calls] == ["section.thesis"] * 2 + [
        "section.thesis.compare"
    ]
    assert result.parsed == Answer(verdict="invest", score=6)
    assert result.panel is not None
    assert [c.model for c in result.panel.candidates] == ["a#1", "b#2"]
    assert result.panel.candidates[1].summary == "leans invest, lower score"
    assert result.panel.agreement == 0.8 and result.panel.disagreements == [
        "They differ on the score."
    ]
    # the whole panel is paid for: two analysts and the comparison
    assert result.tokens_in == 300 and result.tokens_out == 150
    assert result.cost_usd == pytest.approx(0.03)
    assert result.cached is False


async def test_the_comparison_sees_every_answer_and_stays_inside_the_gateway_cap():
    service = FakeService(
        {"a": {"verdict": "invest", "score": 7}, "b": {"verdict": "pass", "score": 2}}, COMPARE
    )
    await LivePanelRunner().run(service, LLMTask("p", "s", "u", Answer, 3900), ["a", "b"])  # type: ignore[arg-type]
    compare, _ = service.calls[-1]
    assert "Analyst 1 (a)" in compare.user and "Analyst 2 (b)" in compare.user
    assert "'verdict': 'pass'" in compare.user
    assert compare.max_tokens == 4000


async def test_one_model_asked_twice_does_not_get_the_same_cached_answer_twice():
    service = FakeService({"a": {"verdict": "invest", "score": 7}}, COMPARE)
    await LivePanelRunner().run(service, TASK, ["a", "a", "a"])  # type: ignore[arg-type]
    temperatures = [t.temperature for t, _ in service.calls[:3]]
    assert temperatures[0] is None and len(set(temperatures)) == 3


async def test_a_failed_analyst_is_dropped_and_the_rest_are_still_compared():
    service = FakeService(
        {
            "a": {"verdict": "invest", "score": 7},
            "b": RuntimeError("gateway down"),
            "c": {"verdict": "invest", "score": 6},
        },
        {**COMPARE, "candidate_summaries": ["one", "two"]},
    )
    result = await LivePanelRunner().run(service, TASK, ["a", "b", "c"])  # type: ignore[arg-type]
    assert result.panel is not None and [c.model for c in result.panel.candidates] == ["a#1", "c#2"]


async def test_one_survivor_is_returned_as_a_plain_answer_without_a_comparison():
    service = FakeService(
        {"a": {"verdict": "invest", "score": 7}, "b": RuntimeError("down")}, COMPARE
    )
    result = await LivePanelRunner().run(service, TASK, ["a", "b"])  # type: ignore[arg-type]
    assert result.panel is None and result.parsed == Answer(verdict="invest", score=7)
    assert len(service.calls) == 2


async def test_when_every_analyst_fails_the_first_error_is_raised():
    service = FakeService({"a": RuntimeError("one"), "b": RuntimeError("two")}, COMPARE)
    with pytest.raises(RuntimeError, match="one"):
        await LivePanelRunner().run(service, TASK, ["a", "b"])  # type: ignore[arg-type]


async def test_an_unparsable_comparison_keeps_the_first_answer_and_says_agreement_is_unknown():
    service = FakeService(
        {"a": {"verdict": "invest", "score": 7}, "b": {"verdict": "pass", "score": 2}},
        LLMParseError("bad json"),
    )
    result = await LivePanelRunner().run(service, TASK, ["a", "b"])  # type: ignore[arg-type]
    assert result.parsed == Answer(verdict="invest", score=7)
    assert result.panel is not None and result.panel.agreement == 0.0
    assert "unknown" in result.panel.disagreements[0]
    assert result.tokens_in == 200


async def test_free_text_tasks_are_merged_as_text():
    class TextService(FakeService):
        async def complete(self, task: LLMTask, model: str) -> LLMResult:
            if task.purpose.endswith(".compare"):
                return await super().complete(task, model)
            return _result(model, f"text from {model}")

    service = TextService({}, {**COMPARE, "merged": "the merged text"})
    result = await LivePanelRunner().run(service, LLMTask("t", "s", "u"), ["a", "b"])  # type: ignore[arg-type]
    assert result.text == "the merged text" and result.parsed is None and result.panel is not None


async def test_unknown_prices_stay_unknown():
    service = FakeService(
        {"a": {"verdict": "x", "score": 1}, "b": {"verdict": "x", "score": 1}}, COMPARE
    )
    original = service.complete

    async def priceless(task: LLMTask, model: str) -> LLMResult:
        result = await original(task, model)
        result.cost_usd = None
        return result

    service.complete = priceless  # type: ignore[method-assign]
    result = await LivePanelRunner().run(service, TASK, ["a", "b"])  # type: ignore[arg-type]
    assert result.cost_usd is None
