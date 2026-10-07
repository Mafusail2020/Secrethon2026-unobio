import logging

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    BadRequestError,
    InternalServerError,
    RateLimitError,
)
from pydantic import BaseModel
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.llm.backend import RawCompletion
from app.llm.structured import MODES, Mode, extract_json, response_format, schema_instruction
from app.llm.types import LLMParseError, LLMTask

log = logging.getLogger(__name__)

_TRANSIENT = (RateLimitError, APIConnectionError, APITimeoutError, InternalServerError)


@retry(
    retry=retry_if_exception_type(_TRANSIENT),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    reraise=True,
)
async def _create(client: AsyncOpenAI, **kwargs):
    return await client.chat.completions.create(**kwargs)


def _validate(schema: type[BaseModel], text: str) -> BaseModel:
    return schema.model_validate(extract_json(text))


class LiveBackend:
    cacheable = True
    is_mock = False

    def __init__(self, client: AsyncOpenAI) -> None:
        self.client = client
        # structured-output mode that worked for a model; probed lazily on its first schema call
        self._mode: dict[str, Mode] = {}

    async def _chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        task: LLMTask,
        fmt: dict | None,
    ) -> tuple[str, int, int]:
        kwargs: dict = {
            "model": model,
            "messages": messages,
            "max_completion_tokens": task.max_tokens,
        }
        if task.temperature is not None:
            kwargs["temperature"] = task.temperature
        if fmt is not None:
            kwargs["response_format"] = fmt
        response = await _create(self.client, **kwargs)
        usage = response.usage
        text = response.choices[0].message.content or ""
        return (
            text,
            getattr(usage, "prompt_tokens", 0) or 0,
            getattr(usage, "completion_tokens", 0) or 0,
        )

    @staticmethod
    def _messages(system: str, user: str) -> list[dict[str, str]]:
        messages = [{"role": "system", "content": system}] if system else []
        return [*messages, {"role": "user", "content": user}]

    async def complete(self, task: LLMTask, model: str) -> RawCompletion:
        if task.schema is None:
            text, tin, tout = await self._chat(
                model, self._messages(task.system, task.user), task, None
            )
            return RawCompletion(text=text, parsed=None, tokens_in=tin, tokens_out=tout)

        start = MODES.index(self._mode[model]) if model in self._mode else 0
        modes = MODES[start:]
        for i, mode in enumerate(modes):
            try:
                result = await self._structured(model, task, mode)
            except BadRequestError as exc:
                if i == len(modes) - 1:
                    raise
                log.info("model %s rejected %s (%s); trying next mode", model, mode, exc.message)
                continue
            self._mode[model] = mode
            return result
        raise AssertionError("unreachable")

    async def _structured(self, model: str, task: LLMTask, mode: Mode) -> RawCompletion:
        assert task.schema is not None
        system = task.system
        if mode != "json_schema":
            system = f"{system}\n\n{schema_instruction(task.schema)}".strip()
        messages = self._messages(system, task.user)
        fmt = response_format(mode, task.schema)

        text, tin, tout = await self._chat(model, messages, task, fmt)
        try:
            return RawCompletion(text, _validate(task.schema, text), tin, tout)
        except ValueError as first_error:
            repair = [
                *messages,
                {"role": "assistant", "content": text},
                {
                    "role": "user",
                    "content": (
                        f"Your reply failed validation: {str(first_error)[:1500]}\n"
                        "Reply again with only the corrected JSON object."
                    ),
                },
            ]
            text2, tin2, tout2 = await self._chat(model, repair, task, fmt)
            try:
                return RawCompletion(text2, _validate(task.schema, text2), tin + tin2, tout + tout2)
            except ValueError as second_error:
                raise LLMParseError(
                    f"{task.purpose}: reply failed validation after one repair: {second_error}"
                ) from second_error
