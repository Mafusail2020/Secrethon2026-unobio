import asyncio
import html
import ipaddress
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from app.sources.base import HttpSource, SourceError

MAX_BYTES = 1_000_000
MAX_REDIRECTS = 5
TEXT_MAX = 20_000

_SCRIPT = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def html_to_text(raw: str) -> str:
    return _SPACE.sub(" ", html.unescape(_TAG.sub(" ", _SCRIPT.sub(" ", raw)))).strip()


async def _public_host(url: str) -> bool:
    """User links are fetched server-side; refuse anything that resolves to a private address."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        infos = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, None)
        # a scoped IPv6 answer ("fe80::1%eth0") is not a valid ip_address and is not public anyway
        return all(ipaddress.ip_address(info[4][0]).is_global for info in infos)
    except (OSError, ValueError):
        return False


class WebClient(HttpSource):
    """Fetches user-provided links as plain text, size-capped. Cached like any other source."""

    name = "web"
    min_interval_s = 0.2

    async def fetch_text(self, url: str, *, force_refresh: bool = False) -> dict[str, Any] | None:
        return await self._cached("GET", url, {}, force_refresh)

    async def _request(self, method: str, path: str, payload: Any) -> Any | None:
        # redirects are followed by hand: a public link that answers 302 to 169.254.169.254 or
        # localhost must be checked like the link itself
        url = path
        for _ in range(MAX_REDIRECTS + 1):
            if not await _public_host(url):
                raise SourceError(f"web: refusing to fetch {url}")
            await self._throttle()
            try:
                async with self._http.stream("GET", url, follow_redirects=False) as resp:
                    if resp.is_redirect and "location" in resp.headers:
                        url = urljoin(url, resp.headers["location"])
                        continue
                    return await _read(resp)
            except (httpx.HTTPError, ValueError) as exc:  # ValueError: a malformed Location
                raise SourceError(f"web: GET {url} failed: {exc}") from exc
        raise SourceError(f"web: too many redirects from {path}")


async def _read(resp: httpx.Response) -> dict[str, Any] | None:
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    ctype = resp.headers.get("content-type", "")
    if not ctype.startswith(("text/", "application/xhtml", "application/json")):
        return {"url": str(resp.url), "content_type": ctype, "text": "", "skipped": True}
    chunks, size = [], 0
    async for chunk in resp.aiter_bytes():
        chunks.append(chunk)
        size += len(chunk)
        if size >= MAX_BYTES:
            break
    raw = b"".join(chunks)[:MAX_BYTES].decode(resp.encoding or "utf-8", "replace")
    text = html_to_text(raw) if "html" in ctype else raw
    title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    return {
        "url": str(resp.url),
        "content_type": ctype,
        "title": html.unescape(title.group(1)).strip() if title else None,
        "text": text[:TEXT_MAX],
        "truncated": len(text) > TEXT_MAX or size >= MAX_BYTES,
    }
