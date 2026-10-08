import asyncio
import html
import ipaddress
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.sources.base import HttpSource, SourceError

MAX_BYTES = 1_000_000
TEXT_MAX = 20_000

_SCRIPT = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def html_to_text(raw: str) -> str:
    return _SPACE.sub(" ", html.unescape(_TAG.sub(" ", _SCRIPT.sub(" ", raw)))).strip()


async def _public_host(url: str) -> bool:
    """User links are fetched server-side; refuse anything that resolves to a private address."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            return False
    return True


class WebClient(HttpSource):
    """Fetches user-provided links as plain text, size-capped. Cached like any other source."""

    name = "web"
    min_interval_s = 0.2

    async def fetch_text(self, url: str, *, force_refresh: bool = False) -> dict[str, Any] | None:
        return await self._cached("GET", url, {}, force_refresh)

    async def _request(self, method: str, path: str, payload: Any) -> Any | None:
        if not await _public_host(path):
            raise SourceError(f"web: refusing to fetch {path}")
        await self._throttle()
        try:
            async with self._http.stream("GET", path) as resp:
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                ctype = resp.headers.get("content-type", "")
                if not ctype.startswith(("text/", "application/xhtml", "application/json")):
                    return {
                        "url": str(resp.url),
                        "content_type": ctype,
                        "text": "",
                        "skipped": True,
                    }
                chunks, size = [], 0
                async for chunk in resp.aiter_bytes():
                    chunks.append(chunk)
                    size += len(chunk)
                    if size >= MAX_BYTES:
                        break
                raw = b"".join(chunks)[:MAX_BYTES].decode(resp.encoding or "utf-8", "replace")
        except httpx.HTTPError as exc:
            raise SourceError(f"web: GET {path} failed: {exc}") from exc
        text = html_to_text(raw) if "html" in ctype else raw
        title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
        return {
            "url": str(resp.url),
            "content_type": ctype,
            "title": html.unescape(title.group(1)).strip() if title else None,
            "text": text[:TEXT_MAX],
            "truncated": len(text) > TEXT_MAX or size >= MAX_BYTES,
        }
