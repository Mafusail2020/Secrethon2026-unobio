import pytest
from fastapi.testclient import TestClient

from app.contracts import GraphSpec, HealthStatus
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_health(client: TestClient):
    body = HealthStatus.model_validate(client.get("/api/health").json())
    assert body.status == "ok"
    assert body.llm_mode == "mock"
    assert body.max_panel_size == 4


def test_graph_returns_every_node_with_kinds_and_colors(client: TestClient):
    spec = GraphSpec.model_validate(client.get("/api/graph").json())
    ids = {n.id for n in spec.nodes}
    assert {"bull_claim_gate", "bear_query_planner", "bull_case", "verdict"} <= ids
    assert len(ids) == 36
    assert all(n.kind in spec.kind_colors for n in spec.nodes)


def test_unknown_route_uses_error_shape(client: TestClient):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_error"
