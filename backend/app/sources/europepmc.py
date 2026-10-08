from typing import Any

from app.sources.base import HttpSource


def flatten_paper(r: dict[str, Any]) -> dict[str, Any]:
    pub_types = (r.get("pubTypeList") or {}).get("pubType") or []
    return {
        "id": r.get("id"),
        "source": r.get("source"),  # MED, PMC, PPR (preprint), ...
        "pmid": r.get("pmid"),
        "pmcid": r.get("pmcid"),
        "doi": r.get("doi"),
        "title": (r.get("title") or "").strip(),
        "authors": r.get("authorString"),
        "journal": ((r.get("journalInfo") or {}).get("journal") or {}).get("title"),
        "year": r.get("pubYear"),
        "first_publication_date": r.get("firstPublicationDate"),
        "pub_types": pub_types,
        "abstract": r.get("abstractText") or "",
        "cited_by": r.get("citedByCount"),
        "is_preprint": r.get("source") == "PPR",
    }


class EuropePMCClient(HttpSource):
    """Europe PMC REST search. resultType=core is the only way to get abstracts in one call."""

    name = "europepmc"
    min_interval_s = 0.1

    async def search(
        self,
        query: str,
        *,
        page_size: int = 25,
        sort: str | None = None,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        body = await self.get_json(
            "search",
            {
                "query": query,
                "format": "json",
                "resultType": "core",
                "pageSize": page_size,
                "sort": sort,
            },
            force_refresh=force_refresh,
        )
        results = ((body or {}).get("resultList") or {}).get("result") or []
        return [flatten_paper(r) for r in results]
