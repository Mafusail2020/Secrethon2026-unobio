from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, Request

from app.api.deps import get_services
from app.contracts import DocumentInfo
from app.core.documents import MAX_BYTES, DocumentError
from app.core.errors import ApiError
from app.core.services import Services

router = APIRouter()
Svc = Annotated[Services, Depends(get_services)]

_STATUS = {"document_too_large": 413, "unsupported_document": 415}


@router.post("/documents", status_code=201, response_model=DocumentInfo)
async def post_document(
    request: Request,
    services: Svc,
    x_file_name: Annotated[str, Header()],
) -> DocumentInfo:
    """The raw file as the request body, its name percent-encoded in X-File-Name."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise ApiError(
            413, "document_too_large", f"files are limited to {MAX_BYTES // 1_000_000} MB"
        )
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BYTES:
            raise ApiError(
                413, "document_too_large", f"files are limited to {MAX_BYTES // 1_000_000} MB"
            )
        chunks.append(chunk)
    try:
        return services.documents.save(unquote(x_file_name), b"".join(chunks))
    except DocumentError as exc:
        raise ApiError(_STATUS.get(exc.code, 422), exc.code, str(exc)) from exc
