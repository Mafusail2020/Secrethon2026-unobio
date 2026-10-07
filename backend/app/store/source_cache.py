from typing import Any, Protocol


class SourceCache(Protocol):
    async def get(self, key: str, *, force_refresh: bool = False) -> Any | None:
        """None on miss, expired entry or force_refresh."""
        ...

    async def put(self, key: str, value: Any, *, ttl_days: int | None = None) -> None: ...
