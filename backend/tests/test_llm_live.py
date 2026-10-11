import json

import httpx2  # the OpenAI SDK's own http layer; respx only patches plain httpx
import pytest
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.contracts import ModelInfo
from app.llm.live import LiveBackend
from app.llm.registry import ModelRegistry
from app.llm.service import LLMService
from app.llm.types import LLMParseError, LLMTask
from app.store.db import Database
from app.store.llm_repo import LLMRepo


class Answer(BaseModel):
    verdict: str
    score: int


def _reply(content: str, tin: int = 10, tout: int = 5) -> httpx2.Response:
    return httpx2.Response(
        200,
        json={
            "id": "x",
            "object": "chat.completion",
            "created": 0,
            "model": "m",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": content},
                }
            ],
            "usage": {"prompt_tokens": tin, "completion_tokens": tout, "total_tokens": tin + tout},
        },
    )


def _unsupported() -> httpx2.Response:
    return httpx2.Response(400, json={"error": {"message": "response_format unsupported"}})


class Gateway:
    """Scripted fake gateway; the last reply repeats."""

    def __init__(self, *replies: httpx2.Response) -> None:
        self.replies = list(replies)
        self.bodies: list[dict] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.bodies.append(json.loads(request.content))
        return self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]

    def formats(self) -> list[str | None]:
        return [b.get("response_format", {}).get("type") for b in self.bodies]


@pytest.fixture
async def make_service(tmp_path):
    db = Database(tmp_path / "t.db")
    await db.init()
    registry = ModelRegistry(
        [
            ModelInfo(
                id="m",
                label="m",
                tier="cheap",
                price_in_per_mtok=1.0,
                price_out_per_mtok=2.0,
                available=True,
                default=True,
            )
        ]
    )

    def build(gateway: Gateway) -> LLMService:
        client = AsyncOpenAI(
            base_url="https://gw.example.org/v1",
            api_key="test-key",
            max_retries=0,
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(gateway)),
        )
        return LLMService(LiveBackend(client), registry, LLMRepo(db), cache_enabled=True)

    yield build
    await db.dispose()


TASK = LLMTask(purpose="t", system="sys", user="usr", schema=Answer, max_tokens=64)
GOOD = json.dumps({"verdict": "ok", "score": 3})


async def test_json_schema_mode_parses_prices_and_uses_max_completion_tokens(make_service):
    gateway = Gateway(_reply(GOOD, 1000, 500))
    result = await make_service(gateway).complete(TASK, "m")
    assert result.parsed == Answer(verdict="ok", score=3)
    assert result.cost_usd == pytest.approx((1000 * 1.0 + 500 * 2.0) / 1_000_000)
    assert gateway.bodies[0]["max_completion_tokens"] == 64
    assert "max_tokens" not in gateway.bodies[0]
    assert gateway.formats() == ["json_schema"]


async def test_second_identical_call_is_served_from_cache(make_service):
    gateway = Gateway(_reply(GOOD))
    service = make_service(gateway)
    first = await service.complete(TASK, "m")
    second = await service.complete(TASK, "m")
    assert len(gateway.bodies) == 1
    assert (first.cached, second.cached) == (False, True)
    assert second.cost_usd == 0.0 and second.parsed == first.parsed


async def test_falls_back_to_json_object_and_remembers_the_mode(make_service):
    gateway = Gateway(_unsupported(), _reply(GOOD))
    service = make_service(gateway)
    await service.complete(TASK, "m")
    assert gateway.formats() == ["json_schema", "json_object"]
    other = LLMTask(purpose="t2", system="sys", user="different", schema=Answer)
    await service.complete(other, "m")
    assert gateway.formats()[2:] == ["json_object"]


async def test_falls_back_to_plain_text_with_json_extraction(make_service):
    gateway = Gateway(_unsupported(), _unsupported(), _reply(f"Sure!\n```json\n{GOOD}\n```"))
    result = await make_service(gateway).complete(TASK, "m")
    assert result.parsed == Answer(verdict="ok", score=3)
    assert gateway.formats() == ["json_schema", "json_object", None]
    assert "JSON schema" in gateway.bodies[2]["messages"][0]["content"]


async def test_one_repair_retry_sums_usage(make_service):
    gateway = Gateway(_reply('{"verdict": "ok"}', 10, 5), _reply(GOOD, 20, 7))
    result = await make_service(gateway).complete(TASK, "m")
    assert result.parsed == Answer(verdict="ok", score=3)
    assert (result.tokens_in, result.tokens_out) == (30, 12)
    assert "failed validation" in gateway.bodies[1]["messages"][-1]["content"]


async def test_second_invalid_reply_raises_parse_error(make_service):
    gateway = Gateway(_reply('{"verdict": "ok"}'))
    with pytest.raises(LLMParseError):
        await make_service(gateway).complete(TASK, "m")
    assert len(gateway.bodies) == 2


async def test_plain_text_task_sends_no_response_format(make_service):
    gateway = Gateway(_reply("hello"))
    result = await make_service(gateway).complete(LLMTask(purpose="p", system="", user="hi"), "m")
    assert result.text == "hello" and result.parsed is None
    assert gateway.formats() == [None]
    assert [m["role"] for m in gateway.bodies[0]["messages"]] == ["user"]


async def test_a_model_that_rejects_temperature_never_gets_one(tmp_path):
    db = Database(tmp_path / "t.db")
    await db.init()
    gateway = Gateway(_reply("hello"))
    client = AsyncOpenAI(
        base_url="https://gw.example.org/v1",
        api_key="test-key",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(gateway)),
    )
    registry = ModelRegistry([ModelInfo(id="m", label="m", tier="cheap", available=True)])
    service = LLMService(LiveBackend(client, {"m"}), registry, LLMRepo(db), cache_enabled=False)
    await service.complete(LLMTask(purpose="p", system="", user="hi", temperature=0.2), "m")
    assert "temperature" not in gateway.bodies[0]
    await db.dispose()


def test_a_run_keeps_its_model_for_follow_ups_while_the_gateway_offers_it():
    registry = ModelRegistry(
        [
            ModelInfo(id="luna", label="luna", tier="unknown", available=True, default=True),
            ModelInfo(id="sol", label="sol", tier="unknown", available=True),
        ]
    )
    assert registry.for_run("sol") == "sol"
    assert registry.for_run(None) == registry.for_run("gone") == "luna"
    registry.apply_gateway_models({"luna"})
    assert registry.for_run("sol") == "luna"


def test_every_configured_model_is_sent_without_a_temperature():
    from pathlib import Path

    import yaml

    raw = yaml.safe_load((Path(__file__).parents[1] / "config" / "models.yaml").read_text())
    ids = {m["id"] for m in raw["models"]}
    assert "gpt-6-luna" in ids
    assert all(m.get("temperature") is False for m in raw["models"])
