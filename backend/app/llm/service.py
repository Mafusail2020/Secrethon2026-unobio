import hashlib
import json
import logging
import time

from app.llm.backend import Backend
from app.llm.registry import ModelRegistry
from app.llm.structured import extract_json
from app.llm.types import LLMResult, LLMTask
from app.store.llm_repo import LLMRepo

log = logging.getLogger(__name__)


def cache_key(task: LLMTask, model: str) -> str:
    payload = {
        "model": model,
        "system": task.system,
        "user": task.user,
        "schema": task.schema.__name__ if task.schema else None,
        "schema_json": task.schema.model_json_schema() if task.schema else None,
        "max_tokens": task.max_tokens,
        "temperature": task.temperature,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


class LLMService:
    """Backend call, response cache and cost. Model choice, budget and panel live in NodeLLM."""

    def __init__(
        self,
        backend: Backend,
        registry: ModelRegistry,
        repo: LLMRepo | None,
        cache_enabled: bool,
    ) -> None:
        self.backend = backend
        self.registry = registry
        self.repo = repo
        self.cache_enabled = cache_enabled

    async def complete(self, task: LLMTask, model: str) -> LLMResult:
        started = time.monotonic()
        use_cache = self.cache_enabled and self.repo is not None and self.backend.cacheable
        key = cache_key(task, model)

        if use_cache and (hit := await self.repo.cache_get(key)) is not None:  # type: ignore[union-attr]
            parsed = None
            try:
                if task.schema is not None:
                    parsed = task.schema.model_validate(extract_json(hit["text"]))
            except ValueError:
                log.warning("ignoring unparsable cache entry for %s", task.purpose)
            else:
                return LLMResult(
                    model=model,
                    text=hit["text"],
                    parsed=parsed,
                    tokens_in=hit["tokens_in"],
                    tokens_out=hit["tokens_out"],
                    cost_usd=0.0,
                    cached=True,
                    latency_ms=int((time.monotonic() - started) * 1000),
                )

        raw = await self.backend.complete(task, model)
        cost = (
            0.0
            if self.backend.is_mock
            else self.registry.cost(model, raw.tokens_in, raw.tokens_out)
        )
        if use_cache:
            await self.repo.cache_put(  # type: ignore[union-attr]
                key,
                model,
                {"text": raw.text, "tokens_in": raw.tokens_in, "tokens_out": raw.tokens_out},
            )
        return LLMResult(
            model=model,
            text=raw.text,
            parsed=raw.parsed,
            tokens_in=raw.tokens_in,
            tokens_out=raw.tokens_out,
            cost_usd=cost,
            cached=False,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
