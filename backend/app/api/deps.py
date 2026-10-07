from fastapi import Request

from app.core.services import Services


def get_services(request: Request) -> Services:
    return request.app.state.services
