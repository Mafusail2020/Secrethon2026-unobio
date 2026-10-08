from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from app.api import chat, evidence, graph, health, models, runs
from app.contracts import ErrorResponse
from app.core.errors import install_error_handlers
from app.core.services import build_services
from app.core.settings import get_settings
from app.graph.lifecycle import recover_interrupted


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    services = await build_services(get_settings())
    await recover_interrupted(services)
    app.state.services = services
    try:
        yield
    finally:
        await services.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Unobio Underwriting",
        separate_input_output_schemas=False,
        responses={422: {"model": ErrorResponse}},
        lifespan=lifespan,
    )
    install_error_handlers(app)
    api = APIRouter(prefix="/api")
    for module in (health, models, graph, runs, chat, evidence):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()
