import pytest
from pydantic import BaseModel

from app.contracts import API_MODELS, SectionResult, Verdict
from app.llm.mock import MockBackend, default_instance, register_mock_fixture
from app.llm.registry import ModelRegistry
from app.llm.service import LLMService
from app.llm.types import LLMTask


@pytest.mark.parametrize("model", API_MODELS, ids=lambda m: m.__name__)
def test_default_instance_is_valid_for_every_contract_model(model: type[BaseModel]):
    assert isinstance(default_instance(model), model)


@pytest.fixture
def service(tmp_path):
    from app.store.db import Database
    from app.store.llm_repo import LLMRepo

    return LLMService(MockBackend(), ModelRegistry([]), LLMRepo(Database(tmp_path / "x.db")), True)


async def test_mock_structured_reply_is_deterministic_zero_cost(service: LLMService):
    task = LLMTask(purpose="t", system="s", user="u", schema=SectionResult)
    first = await service.complete(task, "m")
    second = await service.complete(task, "m")
    assert first.parsed == second.parsed
    assert isinstance(first.parsed, SectionResult)
    assert (first.tokens_in, first.tokens_out, first.cost_usd, first.cached) == (0, 0, 0.0, False)


async def test_mock_text_reply(service: LLMService):
    result = await service.complete(LLMTask(purpose="t", system="", user="hi"), "m")
    assert result.parsed is None and result.text


async def test_registered_fixture_wins_over_defaults(service: LLMService):
    register_mock_fixture(
        "verdict.test",
        {"decision": "invest", "confidence": "high", "reason_codes": [], "rationale": "canned"},
    )
    result = await service.complete(
        LLMTask(purpose="verdict.test", system="", user="", schema=Verdict), "m"
    )
    assert result.parsed.decision == "invest"  # type: ignore[union-attr]
