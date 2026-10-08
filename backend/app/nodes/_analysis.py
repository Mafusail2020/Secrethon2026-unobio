"""Shared pieces of the analysis nodes: prompts, evidence digests, drafted claims and the quote check.

The model only sees evidence through a digest that names each item by id, and may only cite those ids.
Code turns its drafts into Claims, then the gate keeps a claim only if its ids are valid and its quote is
really in the cited text."""

import re
from collections.abc import Collection, Iterable, Sequence
from functools import cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.contracts import Claim, ResolvedEntities, SectionId
from app.contracts.common import Confidence
from app.contracts.ids import claim_id
from app.graph.provenance import EVIDENCE_REQUIRED, gate_claims
from app.graph.state import GraphState
from app.llm.types import LLMBudgetError, LLMParseError, LLMResult, LLMTask
from app.nodes._fixture import excluded_ids
from app.nodes.base import NodeContext

PROMPTS = Path(__file__).parent / "prompts"
EXCERPT_CHARS = 700
MIN_QUOTE_CHARS = 12
QUOTE_MISSING = "quote not found verbatim in the cited evidence"


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftClaim(Draft):
    text: str = Field(description="One specific, checkable statement.")
    section: SectionId
    stance: Literal["pro", "con", "neutral"] = "neutral"
    label: Literal["extracted", "derived", "inferred", "hypothesis"]
    evidence_ids: list[str] = Field(default_factory=list)
    quote: str = Field(
        default="",
        description="Verbatim words copied from one cited evidence item; empty for a hypothesis.",
    )
    confidence: Confidence = "medium"


class DraftClaims(Draft):
    claims: list[DraftClaim] = Field(default_factory=list)


@cache
def prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8").strip()


def system_prompt(name: str) -> str:
    return f"{prompt('rules')}\n\n{prompt(name)}"


def fixture_run(state: GraphState) -> bool:
    """Runs on fixture entities keep the scaffolding outputs, so the stub pipeline stays testable."""
    entities = state.get("entities")
    return entities is None or entities.disease.id.startswith("FIXTURE:")


def usable_evidence(state: GraphState) -> set[str]:
    return set(state.get("evidence_ids", [])) - excluded_ids(state)


def instructions(ctx: NodeContext) -> str:
    texts = [c.text for c in ctx.corrections_for() if c.text.strip()]
    if not texts:
        return ""
    return "Reviewer instructions (follow them):\n" + "\n".join(f"- {t}" for t in texts)


def describe_program(state: GraphState) -> str:
    program = state["program"]
    entities: ResolvedEntities | None = state.get("entities")
    lines = [f"Indication: {program.indication}", f"Mechanism: {program.mechanism}"]
    for label, value in (
        ("Drug", program.drug_name),
        ("Modality", program.modality),
        ("Stage", program.stage),
        ("Route", program.route),
        ("Biomarkers", program.biomarkers),
        ("Preclinical results (from the user)", program.preclinical_results),
        ("User notes", program.notes),
    ):
        if value:
            lines.append(f"{label}: {value}")
    if entities is not None:
        lines.append(f"Resolved disease: {entities.disease.label} ({entities.disease.id})")
        if entities.target:
            lines.append(f"Resolved target: {entities.target.label} ({entities.target.id})")
        if entities.drug:
            lines.append(f"Resolved drug: {entities.drug.label} ({entities.drug.id})")
        if entities.therapeutic_areas:
            lines.append(f"Therapeutic areas: {', '.join(entities.therapeutic_areas)}")
        if entities.mechanism_class:
            lines.append(f"Mechanism class: {entities.mechanism_class}")
    return "\n".join(lines)


async def digest(ctx: NodeContext, evidence_ids: Sequence[str], chars: int = EXCERPT_CHARS) -> str:
    """The evidence list a model may cite, one item per block, in the given order."""
    items = await ctx.store.evidence.get_many_evidence(list(evidence_ids))
    titles = {
        s.id: s.title
        for s in await ctx.store.evidence.get_sources(
            list(dict.fromkeys(e.source_id for e in items))
        )
    }
    blocks = []
    for e in items:
        text = " ".join(e.excerpt.split())
        if len(text) > chars:
            text = text[:chars] + " …"
        where = f", {e.locator}" if e.locator else ""
        blocks.append(f"[{e.id}] {titles.get(e.source_id, 'unknown source')}{where}\n{text}")
    return "\n\n".join(blocks) if blocks else "(no evidence available)"


async def ask_full[M: BaseModel](
    ctx: NodeContext, purpose: str, system: str, user: str, schema: type[M], max_tokens: int
) -> tuple[M | None, LLMResult | None]:
    """One structured model call. A reply that fails validation is logged, not fatal."""
    task = LLMTask(
        purpose=purpose,
        system=system,
        user=user,
        schema=schema,
        max_tokens=max(max_tokens, ctx.effort.max_tokens),
    )
    try:
        result = await ctx.llm.complete(task)
    except LLMBudgetError:
        raise
    except LLMParseError as exc:
        ctx.log(f"model reply unusable ({exc}); continuing without it", "warn")
        return None, None
    parsed = result.parsed
    return (parsed if isinstance(parsed, schema) else None), result


async def ask[M: BaseModel](
    ctx: NodeContext, purpose: str, system: str, user: str, schema: type[M], max_tokens: int
) -> M | None:
    return (await ask_full(ctx, purpose, system, user, schema, max_tokens))[0]


def to_claims(
    drafts: Iterable[DraftClaim], produced_by: str, stance: str | None = None
) -> tuple[list[Claim], dict[str, str]]:
    """Drafts -> Claims with content-addressed ids, plus each claim's quote for the gate."""
    claims: dict[str, Claim] = {}
    quotes: dict[str, str] = {}
    for d in drafts:
        text = " ".join(d.text.split())
        if not text:
            continue
        cid = claim_id(produced_by, text)
        claims[cid] = Claim(
            id=cid,
            text=text,
            section=d.section,
            stance=stance or d.stance,  # type: ignore[arg-type]
            label=d.label,
            evidence_ids=list(dict.fromkeys(d.evidence_ids)),
            confidence="low" if d.label == "hypothesis" else d.confidence,
            produced_by=produced_by,
        )
        quotes[cid] = d.quote
    return list(claims.values()), quotes


def _norm(text: str) -> str:
    text = text.lower().replace("…", " ").replace("...", " ")
    text = re.sub(r"[\"'“”‘’`]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def quote_found(quote: str, excerpts: Iterable[str]) -> bool:
    q = _norm(quote)
    return len(q) >= MIN_QUOTE_CHARS and any(q in _norm(x) for x in excerpts)


async def gate(
    ctx: NodeContext,
    claims: Iterable[Claim],
    quotes: dict[str, str],
    valid: Collection[str],
) -> dict[str, Claim]:
    """gate_claims (ids exist in the run) plus the quote check; a failed quote downgrades to unknown."""
    gated = gate_claims(claims, valid)
    cited = {i for c in gated.values() for i in c.evidence_ids}
    excerpts = {e.id: e.excerpt for e in await ctx.store.evidence.get_many_evidence(list(cited))}
    out: dict[str, Claim] = {}
    for cid, c in gated.items():
        if c.status != "rejected" and c.label in EVIDENCE_REQUIRED:
            if not quote_found(quotes.get(cid, ""), (excerpts.get(i, "") for i in c.evidence_ids)):
                c = c.model_copy(
                    update={
                        "status": "downgraded",
                        "label": "unknown",
                        "confidence": "low",
                        "rejection_reason": QUOTE_MISSING,
                    }
                )
        out[cid] = c
    return out


def dump_drafts(claims: Sequence[Claim], quotes: dict[str, str], **extra: object) -> dict:
    return {"claims": [c.model_dump(mode="json") for c in claims], "quotes": quotes, **extra}


def load_drafts(scratch: dict) -> tuple[list[Claim], dict[str, str]]:
    return [Claim.model_validate(c) for c in scratch.get("claims", [])], dict(
        scratch.get("quotes", {})
    )


def tally(claims: dict[str, Claim]) -> str:
    counts: dict[str, int] = {}
    for c in claims.values():
        counts[c.status] = counts.get(c.status, 0) + 1
    return ", ".join(f"{n} {s}" for s, n in sorted(counts.items())) or "no claims"
