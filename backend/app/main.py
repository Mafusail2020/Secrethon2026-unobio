from fastapi import APIRouter, FastAPI

from app.api import graph, health
from app.contracts import ErrorResponse
from app.core.errors import install_error_handlers


def create_app() -> FastAPI:
    app = FastAPI(
        title="Unobio Underwriting",
        separate_input_output_schemas=False,
        responses={422: {"model": ErrorResponse}},
    )
    install_error_handlers(app)
    api = APIRouter(prefix="/api")
    api.include_router(health.router)
    api.include_router(graph.router)
    app.include_router(api)
    return app


app = create_app()
