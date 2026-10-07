"""One tiny live call to check the gateway and structured output. Spends a few tokens."""

import asyncio

from pydantic import BaseModel

from app.core.settings import get_settings
from app.llm.factory import build_live_backend
from app.llm.registry import ModelRegistry
from app.llm.service import LLMService
from app.llm.types import LLMTask


class Pong(BaseModel):
    reply: str


async def main() -> None:
    settings = get_settings()
    backend, client = build_live_backend(settings)
    registry = ModelRegistry.from_yaml(settings.config_dir / "models.yaml", settings.default_model)
    try:
        page = await client.models.list()
        ids = sorted(m.id for m in page.data)
        registry.apply_gateway_models(set(ids))
        print(f"gateway models ({len(ids)}): {', '.join(ids)}")
    except Exception as exc:
        print(f"could not list models: {exc}")

    model = registry.default_id()
    service = LLMService(backend, registry, None, cache_enabled=False)
    print(f"model: {model}")

    plain = await service.complete(
        LLMTask(purpose="smoke", system="", user="Say pong.", max_tokens=16), model
    )
    print(
        f"plain: {plain.text!r} tokens={plain.tokens_in}/{plain.tokens_out} cost={plain.cost_usd}"
    )

    structured = await service.complete(
        LLMTask(
            purpose="smoke.structured",
            system="Answer as JSON.",
            user='Return {"reply": "pong"}.',
            schema=Pong,
            max_tokens=64,
        ),
        model,
    )
    mode = getattr(backend, "_mode", {}).get(model)
    print(
        f"structured: {structured.parsed!r} mode={mode} "
        f"tokens={structured.tokens_in}/{structured.tokens_out}"
    )


if __name__ == "__main__":
    asyncio.run(main())
