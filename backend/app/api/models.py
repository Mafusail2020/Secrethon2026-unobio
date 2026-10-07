from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_services
from app.contracts import ModelInfo
from app.core.services import Services

router = APIRouter()


@router.get("/models", response_model=list[ModelInfo])
async def list_models(services: Annotated[Services, Depends(get_services)]) -> list[ModelInfo]:
    return services.llm.registry.infos()
