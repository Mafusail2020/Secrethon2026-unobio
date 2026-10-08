"""Declarative graph shape. Changing it is a contract change."""

from app.contracts import AssessedCause, CaseStance

ENTRY = "input_resolver"
EXIT = "report_assembler"

FETCH_NODES: tuple[str, ...] = (
    "fetch_opentargets",
    "fetch_trials",
    "fetch_literature",
    "fetch_regulatory",
    "fetch_safety",
    "ingest_user_input",
    "twin_stats",
)
STANCES: tuple[CaseStance, ...] = ("bull", "bear")
CASE_STEPS: tuple[str, ...] = ("query_planner", "retriever", "claim_writer", "claim_gate")
# the two assessment lanes: gather (code), extract (model), gate (code), score (formulas)
LANES: tuple[AssessedCause, ...] = ("efficacy", "safety")
LANE_STEPS: tuple[str, ...] = ("gather", "extract", "gate", "score")


def case_container(stance: CaseStance) -> str:
    return f"{stance}_case"


def case_node(stance: CaseStance, step: str) -> str:
    return f"{stance}_{step}"


def lane_container(lane: AssessedCause) -> str:
    return f"{lane}_assessment"


def lane_node(lane: AssessedCause, step: str) -> str:
    return f"{lane}_{step}"


# Top-level nodes in display order. bull_case/bear_case are spec-only containers.
TOP_LEVEL: tuple[str, ...] = (
    "input_resolver",
    "question_planner",
    *FETCH_NODES,
    "evidence_normalizer",
    "knowledge_indexer",
    "efficacy_assessment",
    "safety_assessment",
    "bull_case",
    "bear_case",
    "section_analysts",
    "evidence_ledger",
    "valuation",
    "verdict",
    "report_assembler",
)

# container id -> inner node ids, in pipeline order
CONTAINERS: dict[str, tuple[str, ...]] = {
    **{case_container(s): tuple(case_node(s, step) for step in CASE_STEPS) for s in STANCES},
    **{lane_container(a): tuple(lane_node(a, step) for step in LANE_STEPS) for a in LANES},
}


def _edges() -> list[tuple[str, str]]:
    edges: list[tuple[str, str]] = [("input_resolver", "question_planner")]
    for node in FETCH_NODES:
        edges.append(("question_planner", node))
        edges.append((node, "evidence_normalizer"))
    edges.append(("evidence_normalizer", "knowledge_indexer"))
    for stance in STANCES:
        inner = CONTAINERS[case_container(stance)]
        edges.append(("knowledge_indexer", inner[0]))
        edges.extend(zip(inner, inner[1:], strict=False))
        edges.append((inner[-1], "section_analysts"))
    for lane in LANES:
        inner = CONTAINERS[lane_container(lane)]
        edges.append(("knowledge_indexer", inner[0]))
        edges.extend(zip(inner, inner[1:], strict=False))
        edges.append((inner[-1], "section_analysts"))
    edges += [
        ("section_analysts", "evidence_ledger"),
        ("evidence_ledger", "valuation"),
        ("valuation", "verdict"),
        ("verdict", "report_assembler"),
    ]
    return edges


EDGES: tuple[tuple[str, str], ...] = tuple(_edges())


def runnable_ids() -> list[str]:
    """Node ids that have a run function, in display order."""
    ids: list[str] = []
    for node in TOP_LEVEL:
        ids.extend(CONTAINERS[node] if node in CONTAINERS else (node,))
    return ids
