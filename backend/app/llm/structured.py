import json
import re
from typing import Any, Literal

from pydantic import BaseModel

Mode = Literal["json_schema", "json_object", "text"]
MODES: tuple[Mode, ...] = ("json_schema", "json_object", "text")

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def extract_json(text: str) -> Any:
    """Parse a JSON value from model output, tolerating code fences and surrounding prose."""
    candidates = [text.strip()]
    candidates += [m.strip() for m in _FENCE.findall(text)]
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        candidates.append(text[start : end + 1])
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as exc:
            last_error = exc
    raise ValueError(f"no JSON object found: {last_error}")


def response_format(mode: Mode, schema: type[BaseModel]) -> dict[str, Any] | None:
    if mode == "json_schema":
        return {
            "type": "json_schema",
            "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()},
        }
    if mode == "json_object":
        return {"type": "json_object"}
    return None


def schema_instruction(schema: type[BaseModel]) -> str:
    return (
        "Reply with one JSON object and nothing else. It must validate against this JSON schema:\n"
        + json.dumps(schema.model_json_schema())
    )
