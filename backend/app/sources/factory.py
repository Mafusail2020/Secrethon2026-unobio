from typing import Any

import yaml

from app.core.settings import Settings
from app.sources.base import HttpSource, SourceRegistry
from app.sources.clinicaltrials import ClinicalTrialsClient
from app.sources.europepmc import EuropePMCClient
from app.sources.openfda import OpenFDAClient
from app.sources.opentargets import OpenTargetsClient
from app.sources.web import WebClient
from app.store.source_cache import SourceCache

CLIENTS: dict[str, type[HttpSource]] = {
    c.name: c for c in (OpenTargetsClient, ClinicalTrialsClient, EuropePMCClient, OpenFDAClient)
}


def load_source_config(settings: Settings) -> dict[str, dict[str, Any]]:
    path = settings.config_dir / "sources.yaml"
    return (yaml.safe_load(path.read_text()) or {}).get("sources", {})


def build_sources(settings: Settings, cache: SourceCache) -> SourceRegistry:
    """Builds the clients without touching the network, so the app starts offline."""
    registry = SourceRegistry()
    if settings.sources_mode == "fixture":
        return registry  # nodes see no clients and fall back to their fixture path
    for name, conf in load_source_config(settings).items():
        cls = CLIENTS.get(name)
        if cls is None:
            continue
        registry.register(
            cls(conf["base_url"], cache, ttl_days=conf.get("ttl_days") or settings.cache_ttl_days)
        )
    registry.register(WebClient("", cache, ttl_days=settings.cache_ttl_days))
    return registry
