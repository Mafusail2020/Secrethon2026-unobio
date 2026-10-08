from typing import Any

from app.sources.base import HttpSource

LABEL_SECTIONS = (
    "indications_and_usage",
    "boxed_warning",
    "warnings_and_cautions",
    "mechanism_of_action",
    "clinical_studies",
    "adverse_reactions",
)


def _query(name: str) -> str:
    quoted = '"' + name.replace('"', "") + '"'
    # a literal "+" arrives as %2B and openFDA reads it as AND; spell OR out
    return f"(openfda.generic_name:{quoted} OR openfda.brand_name:{quoted})"


def faers_search(name: str) -> str:
    return 'patient.drug.openfda.generic_name:"' + name.replace('"', "") + '"'


FAERS_COUNT = "patient.reaction.reactionmeddrapt.exact"


def flatten_label(r: dict[str, Any]) -> dict[str, Any]:
    ofda = r.get("openfda") or {}
    return {
        "set_id": r.get("set_id"),
        "effective_time": r.get("effective_time"),
        "brand_names": ofda.get("brand_name") or [],
        "generic_names": ofda.get("generic_name") or [],
        "application_numbers": ofda.get("application_number") or [],
        "manufacturer": (ofda.get("manufacturer_name") or [None])[0],
        "sections": {s: " ".join(r[s]) for s in LABEL_SECTIONS if r.get(s)},
    }


def flatten_application(r: dict[str, Any]) -> dict[str, Any]:
    submissions = sorted(
        r.get("submissions") or [], key=lambda s: s.get("submission_status_date") or ""
    )
    original = next((s for s in submissions if s.get("submission_type") == "ORIG"), None)
    ofda = r.get("openfda") or {}
    return {
        "application_number": r.get("application_number"),
        "sponsor": r.get("sponsor_name"),
        "brand_names": ofda.get("brand_name") or [],
        "generic_names": ofda.get("generic_name") or [],
        "original_status": (original or {}).get("submission_status"),
        "original_date": (original or {}).get("submission_status_date"),
        "n_submissions": len(submissions),
    }


class OpenFDAClient(HttpSource):
    """openFDA drug endpoints. 404 means no match and comes back as an empty list."""

    name = "openfda"
    min_interval_s = 0.25  # 240 requests/min without a key (docs)

    async def labels(
        self, drug_name: str, *, limit: int = 3, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        body = await self.get_json(
            "drug/label.json",
            {"search": _query(drug_name), "limit": limit},
            force_refresh=force_refresh,
        )
        return [flatten_label(r) for r in (body or {}).get("results", [])]

    async def applications(
        self, drug_name: str, *, limit: int = 3, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        body = await self.get_json(
            "drug/drugsfda.json",
            {"search": _query(drug_name), "limit": limit},
            force_refresh=force_refresh,
        )
        return [flatten_application(r) for r in (body or {}).get("results", [])]

    async def adverse_events(
        self, drug_name: str, *, limit: int = 10, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        """Most reported reactions in FAERS for a generic name: [{term, count}]."""
        body = await self.get_json(
            "drug/event.json",
            {"search": faers_search(drug_name), "count": FAERS_COUNT, "limit": limit},
            force_refresh=force_refresh,
        )
        return [r for r in (body or {}).get("results", []) if r.get("term")]
