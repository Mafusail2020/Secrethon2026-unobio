import logging
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from app.api.deps import get_services
from app.contracts import ErrorResponse
from app.core.errors import ApiError
from app.core.services import Services
from app.report_pdf.build import build_report_pdf

log = logging.getLogger(__name__)
router = APIRouter()
Svc = Annotated[Services, Depends(get_services)]


@router.get(
    "/runs/{run_id}/report.pdf",
    responses={200: {"content": {"application/pdf": {}}}, 409: {"model": ErrorResponse}},
)
async def get_report_pdf(run_id: str, services: Svc) -> Response:
    """The finished run's report as a PDF file, built here so it looks the same on every machine."""
    if await services.runs.get(run_id) is None:
        raise ApiError(404, "run_not_found", f"no run {run_id}")
    report = await services.runs.get_report(run_id)
    if report is None:
        raise ApiError(409, "run_not_completed", "the PDF is built once the run has completed")
    data = build_report_pdf(report)
    program = f"{report.program.mechanism} in {report.program.indication}"
    name = f"Unobio underwriting - {program}.pdf"
    return Response(
        data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )
