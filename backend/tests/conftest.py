import pytest

from app.core.services import Services, build_services
from app.core.settings import get_settings


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch, tmp_path):
    monkeypatch.setenv("LLM_MODE", "mock")
    monkeypatch.setenv("TEAM_API_KEY", "")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STUB_DELAY_SCALE", "0")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
async def services():
    built = await build_services(get_settings())
    yield built
    await built.close()


async def run_to_end(services: Services, run_id: str) -> None:
    await services.manager.wait_idle()
    await services.bus.flush()
