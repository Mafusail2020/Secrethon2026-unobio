from fastapi import APIRouter

from app.contracts import GraphSpec
from app.graph.spec import build_graph_spec

router = APIRouter()


@router.get("/graph", response_model=GraphSpec)
async def graph() -> GraphSpec:
    return build_graph_spec()
