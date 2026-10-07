from typing import Protocol


class SourceClient(Protocol):
    """One public-data API client. Each concrete client adds its own typed methods."""

    name: str

    async def aclose(self) -> None: ...


class SourceRegistry:
    def __init__(self) -> None:
        self._clients: dict[str, SourceClient] = {}

    def register(self, client: SourceClient) -> None:
        self._clients[client.name] = client

    def get(self, name: str) -> SourceClient:
        try:
            return self._clients[name]
        except KeyError:
            raise KeyError(f"source client not registered: {name}") from None

    def names(self) -> list[str]:
        return sorted(self._clients)

    async def aclose(self) -> None:
        for client in self._clients.values():
            await client.aclose()
