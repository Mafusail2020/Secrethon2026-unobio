from functools import cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    team_api_key: SecretStr = SecretStr("")
    llm_base_url: str = (
        "https://secrethon-gateway.nicewave-ab4e0867.swedencentral.azurecontainerapps.io/v1"
    )
    llm_mode: Literal["mock", "live"] = "mock"
    llm_cache: bool = True
    default_model: str = ""
    max_run_cost_usd: float = 0.50
    max_run_tokens: int = 400_000
    max_panel_size: int = 4
    cache_ttl_days: int = 7
    sec_user_agent: str = ""
    data_dir: Path = Path("backend/data")

    @property
    def config_dir(self) -> Path:
        return ROOT / "backend" / "config"

    @property
    def data_path(self) -> Path:
        return self.data_dir if self.data_dir.is_absolute() else ROOT / self.data_dir


@cache
def get_settings() -> Settings:
    return Settings()
