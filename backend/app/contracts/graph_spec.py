from typing import Literal

from pydantic import Field

from app.contracts.common import Contract

NodeKind = Literal["data", "processing", "knowledge", "quant", "bull", "bear", "analysis", "output"]
Phase = Literal["resolve", "plan", "fetch", "index", "cases", "analyse", "quant", "report"]


class NodeSpec(Contract):
    id: str
    label: str
    kind: NodeKind
    phase: Phase | None = Field(
        default=None, description="Pipeline phase the UI groups this step under."
    )
    description: str
    reads: list[str] = Field(default_factory=list)
    writes: list[str] = Field(default_factory=list)
    parent: str | None = None
    correctable: bool = True
    critical: bool = False


class GraphEdge(Contract):
    source: str
    target: str


class GraphSpec(Contract):
    nodes: list[NodeSpec]
    edges: list[GraphEdge]
    kind_colors: dict[NodeKind, str]
