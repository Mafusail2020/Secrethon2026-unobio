import pytest

from app.core.settings import get_settings


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LLM_MODE", "mock")
    monkeypatch.setenv("TEAM_API_KEY", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
