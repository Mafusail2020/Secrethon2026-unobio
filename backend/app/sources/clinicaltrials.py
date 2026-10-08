from typing import Any

from app.sources.base import HttpSource

FIELDS = ",".join(
    [
        "NCTId",
        "BriefTitle",
        "OfficialTitle",
        "OverallStatus",
        "WhyStopped",
        "Phase",
        "EnrollmentCount",
        "StartDate",
        "PrimaryCompletionDate",
        "CompletionDate",
        "LeadSponsorName",
        "Condition",
        "InterventionName",
        "InterventionType",
        "PrimaryOutcome",
        "HasResults",
    ]
)


def flatten_study(study: dict[str, Any]) -> dict[str, Any]:
    """The v2 API nests everything and omits empty fields; give nodes one flat, stable shape."""
    p = study.get("protocolSection", {})
    ident, status = p.get("identificationModule", {}), p.get("statusModule", {})
    design = p.get("designModule", {})
    arms = p.get("armsInterventionsModule", {})
    outcomes = p.get("outcomesModule", {})
    return {
        "nct_id": ident.get("nctId"),
        "title": ident.get("officialTitle") or ident.get("briefTitle"),
        "brief_title": ident.get("briefTitle"),
        "overall_status": status.get("overallStatus"),
        "why_stopped": status.get("whyStopped"),
        "phases": design.get("phases") or [],
        "enrollment": (design.get("enrollmentInfo") or {}).get("count"),
        "start_date": (status.get("startDateStruct") or {}).get("date"),
        "primary_completion_date": (status.get("primaryCompletionDateStruct") or {}).get("date"),
        "completion_date": (status.get("completionDateStruct") or {}).get("date"),
        "sponsor": ((p.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}).get(
            "name"
        ),
        "conditions": (p.get("conditionsModule") or {}).get("conditions") or [],
        "interventions": [i.get("name") for i in arms.get("interventions") or [] if i.get("name")],
        "primary_outcomes": [
            o.get("measure") for o in outcomes.get("primaryOutcomes") or [] if o.get("measure")
        ],
        "has_results": bool(study.get("hasResults")),
    }


class ClinicalTrialsClient(HttpSource):
    """ClinicalTrials.gov API v2."""

    name = "clinicaltrials"
    min_interval_s = 1.2  # ~50 requests/min per IP (docs)

    async def search(
        self,
        *,
        intervention: str | None = None,
        condition: str | None = None,
        term: str | None = None,
        statuses: list[str] | None = None,
        page_size: int = 50,
        max_pages: int = 2,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "query.intr": intervention,
            "query.cond": condition,
            "query.term": term,
            "filter.overallStatus": ",".join(statuses) if statuses else None,
            "fields": FIELDS,
            "pageSize": page_size,
            "sort": "LastUpdatePostDate:desc",
        }
        studies: list[dict[str, Any]] = []
        token: str | None = None
        for _ in range(max_pages):
            body = await self.get_json(
                "studies", {**params, "pageToken": token}, force_refresh=force_refresh
            )
            if not body:
                break
            studies.extend(flatten_study(s) for s in body.get("studies", []))
            token = body.get("nextPageToken")
            if not token:
                break
        return studies

    async def study(self, nct_id: str, *, force_refresh: bool = False) -> dict[str, Any] | None:
        body = await self.get_json(
            f"studies/{nct_id.upper()}", {"fields": FIELDS}, force_refresh=force_refresh
        )
        return flatten_study(body) if body else None
