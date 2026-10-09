import json
from datetime import UTC, date, datetime
from enum import Enum
from types import NoneType, UnionType
from typing import Annotated, Any, Literal, Union, get_args, get_origin

from annotated_types import Ge, Gt, MinLen
from pydantic import BaseModel, ValidationError

from app.contracts import DocumentInfo, FailureMix, LedgerStep, RiskAdjustment
from app.llm.backend import RawCompletion
from app.llm.types import LLMParseError, LLMTask

# purpose -> canned reply; nodes may register richer ones than the schema defaults
MOCK_FIXTURES: dict[str, dict[str, Any]] = {}


def register_mock_fixture(purpose: str, data: dict[str, Any]) -> None:
    MOCK_FIXTURES[purpose] = data


_SHARE = {"low": 0.4, "base": 0.5, "high": 0.6, "unit": "share"}
# models with cross-field rules that the smallest-instance builder cannot satisfy
_OVERRIDES: dict[type[BaseModel], dict[str, Any]] = {
    DocumentInfo: {
        "id": "doc_0123456789abcdef",
        "name": "mock.pdf",
        "kind": "pdf",
        "size_bytes": 0,
    },
    FailureMix: {
        "shares": [
            {"cause": "efficacy", "share": _SHARE},
            {"cause": "safety", "share": _SHARE},
        ],
        "source": "literature",
        "basis": "assumption",
    },
    LedgerStep: {
        "factor": "mock",
        "cause": "efficacy",
        "direction": "up",
        "risk_ratio": {"low": 1.0, "base": 1.0, "high": 1.0, "unit": "ratio"},
        "basis": "assumption",
        "pos_after": {"low": 0.1, "base": 0.1, "high": 0.1, "unit": "probability"},
    },
    RiskAdjustment: {
        "cause": "efficacy",
        "factor": "mock",
        "risk_ratio": {"low": 1.0, "base": 1.0, "high": 1.0, "unit": "ratio"},
        "basis": "assumption",
    },
}


def _value(tp: Any, meta: tuple[Any, ...], pick: int) -> Any:
    if isinstance(tp, type) and tp in _OVERRIDES:
        return _OVERRIDES[tp]
    origin = get_origin(tp)
    if origin is Annotated:
        base, *extra = get_args(tp)
        return _value(base, (*meta, *extra), pick)
    if origin in (Union, UnionType):
        args = get_args(tp)
        if NoneType in args:
            return None
        return _value(args[0], meta, pick)
    if origin is Literal:
        return get_args(tp)[pick]
    if origin in (list, set, frozenset, tuple):
        inner = get_args(tp)[0] if get_args(tp) else str
        count = next((m.min_length for m in meta if isinstance(m, MinLen)), 0)
        return [_value(inner, (), pick) for _ in range(count)]
    if origin is dict:
        return {}
    if isinstance(tp, type) and issubclass(tp, BaseModel):
        return _fields(tp, pick)
    if isinstance(tp, type) and issubclass(tp, Enum):
        return list(tp)[pick].value
    if tp is bool:
        return False
    if tp is int:
        return int(_lower_bound(meta, 0))
    if tp is float:
        return float(_lower_bound(meta, 0))
    if tp is str:
        return "mock"
    if tp is datetime:
        return datetime(2026, 1, 1, tzinfo=UTC).isoformat()
    if tp is date:
        return "2026-01-01"
    if getattr(tp, "__name__", "") in ("Url", "HttpUrl"):
        return "https://example.org/mock"
    return None


def _lower_bound(meta: tuple[Any, ...], default: float) -> float:
    for m in meta:
        if isinstance(m, Ge):
            return max(default, m.ge)  # type: ignore[arg-type]
        if isinstance(m, Gt):
            return max(default, m.gt + 1)  # type: ignore[operator]
    return default


def _fields(model: type[BaseModel], pick: int) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name, info in model.model_fields.items():
        if not info.is_required():
            continue
        out[name] = _value(info.annotation, tuple(info.metadata), pick)
    return out


def default_instance(model: type[BaseModel]) -> BaseModel:
    """Smallest valid instance; retries with the last literal member to dodge validators."""
    if model in _OVERRIDES:
        return model.model_validate(_OVERRIDES[model])
    error: ValidationError | None = None
    for pick in (0, -1):
        try:
            return model.model_validate(_fields(model, pick))
        except ValidationError as exc:
            error = exc
    raise LLMParseError(f"cannot build a mock {model.__name__}; register a fixture: {error}")


class MockBackend:
    cacheable = False
    is_mock = True

    async def complete(self, task: LLMTask, model: str):
        if task.schema is None:
            return RawCompletion(text=f"mock reply for {task.purpose}", parsed=None)
        fixture = MOCK_FIXTURES.get(task.purpose)
        try:
            parsed = (
                task.schema.model_validate(fixture) if fixture else default_instance(task.schema)
            )
        except ValidationError as exc:
            raise LLMParseError(f"mock fixture for {task.purpose} is invalid: {exc}") from exc
        return RawCompletion(text=json.dumps(parsed.model_dump(mode="json")), parsed=parsed)


__all__ = ["MOCK_FIXTURES", "MockBackend", "default_instance", "register_mock_fixture"]
