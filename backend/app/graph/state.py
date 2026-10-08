from collections.abc import Mapping
from typing import Annotated, Any, TypedDict, get_type_hints

from pydantic import TypeAdapter

from app.contracts import (
    AssessmentResult,
    Claim,
    Correction,
    DiligenceQuestion,
    EvidenceLedger,
    PlannedQuestion,
    ProgramInput,
    ResolvedEntities,
    Risk,
    RiskAdjustment,
    RunOptions,
    SectionId,
    SectionResult,
    TranslationLink,
    TwinStats,
    UnderwritingReport,
    Valuation,
    Verdict,
)


def merge_dicts(left: dict | None, right: dict | None) -> dict:
    return {**(left or {}), **(right or {})}


def union_lists(left: list | None, right: list | None) -> list:
    return list(dict.fromkeys([*(left or []), *(right or [])]))


class GraphState(TypedDict, total=False):
    program: ProgramInput
    options: RunOptions
    corrections: list[Correction]
    entities: ResolvedEntities | None
    questions: list[PlannedQuestion]
    source_ids: Annotated[list[str], union_lists]
    evidence_ids: Annotated[list[str], union_lists]
    claims: Annotated[dict[str, Claim], merge_dicts]
    twin_stats: TwinStats | None
    # evidence that moves one failure cause's risk, keyed 'cause:factor'; written by the lanes
    risk_adjustments: Annotated[dict[str, RiskAdjustment], merge_dicts]
    # what the efficacy and safety lanes found, keyed by cause
    assessments: Annotated[dict[str, AssessmentResult], merge_dicts]
    sections: Annotated[dict[SectionId, SectionResult], merge_dicts]
    translation_chain: list[TranslationLink]
    key_risks: list[Risk]
    critical_unknowns: list[str]
    diligence_questions: list[DiligenceQuestion]
    ledger: EvidenceLedger | None
    valuation: Valuation | None
    verdict: Verdict | None
    report: UnderwritingReport | None
    # hand-offs between nodes that are not part of the report; keyed by producing node id
    scratch: Annotated[dict[str, dict[str, Any]], merge_dicts]


STATE_KEYS: tuple[str, ...] = tuple(get_type_hints(GraphState))
INITIAL_KEYS: frozenset[str] = frozenset({"program", "options", "corrections"})

_ADAPTERS: dict[str, TypeAdapter] = {
    key: TypeAdapter(tp) for key, tp in get_type_hints(GraphState).items()
}


def dump_delta(delta: Mapping[str, Any]) -> dict[str, Any]:
    return {k: _ADAPTERS[k].dump_python(v, mode="json") for k, v in delta.items()}


def load_delta(raw: Mapping[str, Any]) -> dict[str, Any]:
    return {k: _ADAPTERS[k].validate_python(v) for k, v in raw.items()}
