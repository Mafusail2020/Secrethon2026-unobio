import logging
from dataclasses import dataclass

import yaml
from openai import AsyncOpenAI

from app.core.settings import Settings
from app.llm.backend import Backend
from app.llm.effort import EffortPolicy
from app.llm.mock import MockBackend
from app.llm.panel import LivePanelRunner, MockPanelRunner, PanelRunner
from app.llm.registry import ModelRegistry
from app.llm.service import LLMService
from app.store.llm_repo import LLMRepo

log = logging.getLogger(__name__)


@dataclass
class LLMStack:
    service: LLMService
    registry: ModelRegistry
    policy: EffortPolicy
    panel: PanelRunner


def build_live_backend(settings: Settings) -> tuple[Backend, AsyncOpenAI]:
    from app.llm.live import LiveBackend

    key = settings.team_api_key.get_secret_value()
    if not key:
        raise RuntimeError("LLM_MODE=live needs TEAM_API_KEY in .env")
    client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=key)
    raw = yaml.safe_load((settings.config_dir / "models.yaml").read_text()) or {}
    no_temperature = {m["id"] for m in raw.get("models", []) if m.get("temperature") is False}
    return LiveBackend(client, no_temperature), client


async def build_llm_stack(settings: Settings, repo: LLMRepo) -> LLMStack:
    registry = ModelRegistry.from_yaml(settings.config_dir / "models.yaml", settings.default_model)
    policy = EffortPolicy.from_yaml(settings.config_dir / "effort.yaml")
    if settings.llm_mode == "mock":
        backend: Backend = MockBackend()
        panel: PanelRunner = MockPanelRunner()
    else:
        backend, client = build_live_backend(settings)
        panel = LivePanelRunner()
        try:
            page = await client.models.list()
            registry.apply_gateway_models({m.id for m in page.data})
        except Exception as exc:
            log.warning("could not list gateway models (%s); trusting config/models.yaml", exc)
    service = LLMService(backend, registry, repo, settings.llm_cache)
    return LLMStack(service, registry, policy, panel)
