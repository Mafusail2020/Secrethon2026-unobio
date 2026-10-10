import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_services
from app.chat.answer import answer_with_llm, mock_answer
from app.chat.documents import passages_for
from app.chat.summary import summarise_with_llm, template_summary
from app.contracts import ChatMessage, ErrorResponse, LLMCallRecord
from app.core.errors import ApiError
from app.core.services import Services
from app.llm.types import LLMParseError

log = logging.getLogger(__name__)

router = APIRouter()
Svc = Annotated[Services, Depends(get_services)]
MAX_QUESTION_CHARS = 2000
_summary_locks: dict[str, asyncio.Lock] = {}


async def _require_run(services: Services, run_id: str) -> None:
    if await services.runs.get(run_id) is None:
        raise ApiError(404, "run_not_found", f"no run {run_id}")


@router.get("/runs/{run_id}/messages", response_model=list[ChatMessage])
async def list_messages(run_id: str, services: Svc) -> list[ChatMessage]:
    await _require_run(services, run_id)
    return await services.chat.list(run_id)


@router.post(
    "/runs/{run_id}/messages",
    response_model=ChatMessage,
    responses={
        409: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
    },
)
async def post_message(run_id: str, body: ChatMessage, services: Svc) -> ChatMessage:
    """Follow-up on a finished run; the reply cites its claims or says it cannot answer."""
    await _require_run(services, run_id)
    question = body.content.strip()
    if body.role != "user" or not question or len(question) > MAX_QUESTION_CHARS:
        raise ApiError(
            422, "validation_error", f"send a user question of 1 to {MAX_QUESTION_CHARS} characters"
        )
    report = await services.runs.get_report(run_id)
    if report is None:
        raise ApiError(
            409, "run_not_completed", "follow-up questions open once the run has completed"
        )
    if await services.chat.count_questions(run_id) >= services.settings.max_chat_questions:
        raise ApiError(429, "chat_limit", "this run has reached its follow-up question limit")

    history = await services.chat.list(run_id)
    passages = await passages_for(services, report, question)
    if services.settings.llm_mode == "mock":
        reply = mock_answer(report, question, run_id, passages)
    else:
        registry = services.llm.registry
        try:
            reply, result = await answer_with_llm(
                services.llm.service,
                registry.default_id(),
                report,
                history,
                question,
                run_id,
                passages,
            )
        except LLMParseError as exc:
            raise ApiError(
                502, "chat_failed", "the model's answer could not be read; try again"
            ) from exc
        except Exception as exc:  # a refused or failed gateway call
            log.warning("chat answer failed on %s: %s", run_id, exc)
            raise ApiError(502, "chat_failed", "the model could not answer; try again") from exc
        await services.llm_repo.add_call(
            run_id,
            "chat",
            LLMCallRecord(
                model=result.model,
                purpose="chat.answer",
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
                cost_usd=result.cost_usd,
                cached=result.cached,
                latency_ms=result.latency_ms,
            ),
        )
    await services.chat.add(run_id, ChatMessage(role="user", content=question, run_id=run_id))
    await services.chat.add(run_id, reply)
    return reply


@router.post(
    "/runs/{run_id}/summary",
    response_model=ChatMessage,
    responses={409: {"model": ErrorResponse}},
)
async def run_summary(run_id: str, services: Svc) -> ChatMessage:
    """The plain-language read-out of a finished run. Written once, then returned as stored."""
    await _require_run(services, run_id)
    report = await services.runs.get_report(run_id)
    if report is None:
        raise ApiError(
            409, "run_not_completed", "the summary is written once the run has completed"
        )
    async with _summary_locks.setdefault(run_id, asyncio.Lock()):
        stored = await services.chat.get_summary(run_id)
        if stored:
            return stored
        program = report.program
        about = f"{program.indication} {program.mechanism} {program.drug_name or ''} results"
        passages = await passages_for(services, report, about)
        if services.settings.llm_mode == "mock":
            message = template_summary(report, run_id, passages)
        else:
            try:
                message, result = await summarise_with_llm(
                    services.llm.service,
                    services.llm.registry.default_id(),
                    report,
                    run_id,
                    passages,
                )
            except Exception as exc:  # the template briefing beats an empty thread
                log.warning("briefing call failed on %s: %s", run_id, exc)
                # shown but not kept: a gateway hiccup must not fix the template for good
                return template_summary(report, run_id, passages)
            else:
                await services.llm_repo.add_call(
                    run_id,
                    "summary",
                    LLMCallRecord(
                        model=result.model,
                        purpose="chat.summary",
                        tokens_in=result.tokens_in,
                        tokens_out=result.tokens_out,
                        cost_usd=result.cost_usd,
                        cached=result.cached,
                        latency_ms=result.latency_ms,
                    ),
                )
        await services.chat.put_summary(run_id, message)
    return message
