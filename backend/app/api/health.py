from fastapi import APIRouter

from app.contracts import HealthStatus
from app.core.settings import get_settings

router = APIRouter()


@router.get("/health", response_model=HealthStatus)
async def health() -> HealthStatus:
    settings = get_settings()
    return HealthStatus(
        llm_mode=settings.llm_mode,
        llm_cache=settings.llm_cache,
        has_api_key=bool(settings.team_api_key.get_secret_value()),
    )
