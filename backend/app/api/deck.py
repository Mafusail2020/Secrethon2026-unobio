import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_services
from app.chat.documents import passages_for
from app.contracts import DeckScript, ErrorResponse, LLMCallRecord
from app.core.errors import ApiError
from app.core.services import Services
from app.deck.script import GROUPS, write_script

log = logging.getLogger(__name__)
router = APIRouter()
Svc = Annotated[Services, Depends(get_services)]
_locks: dict[str, asyncio.Lock] = {}


@router.post(
    "/runs/{run_id}/deck",
    response_model=DeckScript,
    responses={409: {"model": ErrorResponse}},
)
async def write_deck(
    run_id: str, services: Svc, rewrite: Annotated[bool, Query()] = False
) -> DeckScript:
    """The words of the committee deck for a finished run. Written once and kept; `rewrite`
    writes it again. Empty `slides` means the deck should use the report's own wording (mock
    mode, or the model could not write it, or nothing it wrote held up)."""
    if await services.runs.get(run_id) is None:
        raise ApiError(404, "run_not_found", f"no run {run_id}")
    report = await services.runs.get_report(run_id)
    if report is None:
        raise ApiError(409, "run_not_completed", "the deck is written once the run has completed")
    async with _locks.setdefault(run_id, asyncio.Lock()):
        stored = await services.chat.get_deck(run_id)
        if stored and not rewrite:
            return stored
        if services.settings.llm_mode == "mock":
            return DeckScript()
        program = report.program
        about = f"{program.indication} {program.mechanism} {program.drug_name or ''} results"
        passages = await passages_for(services, report, about)
        try:
            script, results = await write_script(
                services.llm.service,
                services.llm.registry.default_id(),
                report,
                passages,
                fresh=rewrite,  # the same prompt would otherwise come back from the cache
            )
        except Exception as exc:  # the deck still has its own wording to fall back on
            log.warning("deck script failed on %s: %s", run_id, exc)
            return stored or DeckScript()
        for result in results:
            await services.llm_repo.add_call(
                run_id,
                "deck",
                LLMCallRecord(
                    model=result.model,
                    purpose="deck.script",
                    tokens_in=result.tokens_in,
                    tokens_out=result.tokens_out,
                    cost_usd=result.cost_usd,
                    cached=result.cached,
                    latency_ms=result.latency_ms,
                ),
            )
        if not script.slides:
            return stored or script  # a rewrite that came back empty keeps the deck there was
        # a deck missing a failed group is shown but not kept, so the next visit asks again
        if len(results) == len(GROUPS):
            await services.chat.put_deck(run_id, script)
        else:
            log.warning("deck for %s: %d of %d groups written", run_id, len(results), len(GROUPS))
        return script
