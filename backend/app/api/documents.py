from typing import Annotated
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import Response

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


def _stored(services: Services, document_id: str):
    stored = services.documents.get(document_id)
    if stored is None:
        raise ApiError(404, "document_not_found", f"no document {document_id}")
    return stored


@router.get("/documents/{document_id}", response_model=DocumentInfo)
async def get_document(document_id: str, services: Svc) -> DocumentInfo:
    return _stored(services, document_id).info


@router.get("/documents/{document_id}/file", responses={200: {"content": {"application/pdf": {}}}})
async def get_document_file(document_id: str, services: Svc) -> Response:
    """The file as uploaded, so a reader can check a quote against it."""
    stored = _stored(services, document_id)
    pdf = stored.info.kind == "pdf"
    return Response(
        stored.read(),
        media_type="application/pdf" if pdf else "text/plain; charset=utf-8",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(stored.info.name)}",
        },
    )
