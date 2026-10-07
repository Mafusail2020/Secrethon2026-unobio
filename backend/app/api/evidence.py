from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_services
from app.contracts import EvidenceDetail
from app.core.errors import ApiError
from app.core.services import Services

router = APIRouter()


@router.get("/evidence/{evidence_id}", response_model=EvidenceDetail)
async def get_evidence(
    evidence_id: str, services: Annotated[Services, Depends(get_services)]
) -> EvidenceDetail:
    evidence = await services.store.evidence.get_evidence(evidence_id)
    source = await services.store.evidence.get_source(evidence.source_id) if evidence else None
    if evidence is None or source is None:
        raise ApiError(404, "evidence_not_found", f"no evidence {evidence_id}")
    return EvidenceDetail(evidence=evidence, source=source)
