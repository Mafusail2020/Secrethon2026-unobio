import asyncio
import hashlib
import json
import time
from typing import Any, Protocol

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.store.source_cache import SourceCache


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

    def has(self, name: str) -> bool:
        return name in self._clients

    def names(self) -> list[str]:
        return sorted(self._clients)

    async def aclose(self) -> None:
        for client in self._clients.values():
            await client.aclose()


class SourceError(RuntimeError):
    """A source call failed after retries. Nodes catch it and continue with partial evidence."""


NOT_FOUND = {"_not_found": True}


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and (
        exc.response.status_code == 429 or exc.response.status_code >= 500
    )


class HttpSource:
    """Cached, rate-limited, retrying JSON client. Subclasses add typed methods."""

    name: str = "http"
    min_interval_s: float = 0.2  # per-source politeness floor between requests
    user_agent = "unobio-underwriting/0.1 (Secrethon 2026 hackathon)"

    def __init__(
        self,
        base_url: str,
        cache: SourceCache,
        *,
        ttl_days: int | None = None,
        min_interval_s: float | None = None,
        timeout_s: float = 30.0,
        attempts: int = 3,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.cache = cache
        self.ttl_days = ttl_days
        self._min_interval = self.min_interval_s if min_interval_s is None else min_interval_s
        self._attempts = attempts
        self._lock = asyncio.Lock()
        self._last = 0.0
        self._http = httpx.AsyncClient(
            timeout=timeout_s,
            follow_redirects=True,
            headers={"User-Agent": self.user_agent},
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    def cache_key(self, method: str, path: str, payload: Any) -> str:
        body = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        digest = hashlib.sha256(f"{method} {path} {body}".encode()).hexdigest()[:24]
        return f"{self.name}:{digest}"

    async def get_json(
        self, path: str, params: dict[str, Any] | None = None, *, force_refresh: bool = False
    ) -> Any | None:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        return await self._cached("GET", path, params, force_refresh)

    async def post_json(self, path: str, body: Any, *, force_refresh: bool = False) -> Any | None:
        return await self._cached("POST", path, body, force_refresh)

    async def _cached(self, method: str, path: str, payload: Any, force_refresh: bool) -> Any:
        key = self.cache_key(method, path, payload)
        hit = await self.cache.get(key, force_refresh=force_refresh)
        if hit is not None:
            return None if hit == NOT_FOUND else hit
        value = await self._request(method, path, payload)
        await self.cache.put(key, NOT_FOUND if value is None else value, ttl_days=self.ttl_days)
        return value

    async def _request(self, method: str, path: str, payload: Any) -> Any | None:
        url = f"{self.base_url}/{path.lstrip('/')}" if path else self.base_url
        try:
            async for attempt in AsyncRetrying(
                retry=retry_if_exception(_retryable),
                stop=stop_after_attempt(self._attempts),
                wait=wait_exponential(multiplier=0.5, max=8),
                reraise=True,
            ):
                with attempt:
                    await self._throttle()
                    if method == "GET":
                        resp = await self._http.get(url, params=payload)
                    else:
                        resp = await self._http.post(url, json=payload)
                    if resp.status_code == 404:
                        return None
                    resp.raise_for_status()
                    return resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SourceError(f"{self.name}: {method} {path or '/'} failed: {exc}") from exc
        return None

    async def _throttle(self) -> None:
        async with self._lock:
            wait = self._last + self._min_interval - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = time.monotonic()
