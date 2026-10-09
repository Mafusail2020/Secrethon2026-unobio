import re
from typing import Any

from app.sources.base import HttpSource, SourceError

_SEARCH = """
query Search($q: String!, $entities: [String!]!, $size: Int!) {
  search(queryString: $q, entityNames: $entities, page: {index: 0, size: $size}) {
    hits { id name entity score }
  }
}"""

_DISEASE = """
query Disease($id: String!) {
  disease(efoId: $id) {
    id name description dbXRefs
    therapeuticAreas { id name }
    synonyms { relation terms }
  }
}"""

_TARGET = """
query Target($id: String!) {
  target(ensemblId: $id) {
    id approvedSymbol approvedName
    targetClass { label level }
    tractability { label modality value }
    safetyLiabilities {
      event eventId datasource literature url
      effects { direction dosing }
      biosamples { tissueLabel cellLabel }
    }
  }
}"""

_ASSOCIATION = """
query Association($disease: String!, $target: String!) {
  disease(efoId: $disease) {
    associatedTargets(Bs: [$target]) { rows { score datatypeScores { id score } } }
  }
}"""

_DRUG = """
query Drug($id: String!) {
  drug(chemblId: $id) {
    id name drugType maximumClinicalStage
    mechanismsOfAction { rows { mechanismOfAction actionType targets { id approvedSymbol } } }
  }
}"""

_TARGET_DRUGS = """
query TargetDrugs($id: String!) {
  target(ensemblId: $id) {
    drugAndClinicalCandidates {
      count
      rows { maxClinicalStage drug { id name drugType } diseases { disease { id name } } }
    }
  }
}"""

_DISEASE_DRUGS = """
query DiseaseDrugs($id: String!) {
  disease(efoId: $id) {
    drugAndClinicalCandidates {
      count
      rows {
        maxClinicalStage
        drug { id name drugType mechanismsOfAction { rows { mechanismOfAction } } }
      }
    }
  }
}"""


class OpenTargetsClient(HttpSource):
    """Open Targets Platform GraphQL. Field names follow API 26.9 (knownDrugs is gone)."""

    name = "opentargets"
    min_interval_s = 0.1

    async def query(
        self, query: str, variables: dict[str, Any], *, force_refresh: bool = False
    ) -> dict[str, Any]:
        body = await self.post_json(
            "", {"query": query, "variables": variables}, force_refresh=force_refresh
        )
        if not body or body.get("errors"):
            errors = (body or {}).get("errors")
            raise SourceError(f"opentargets: graphql error {errors}")
        return body["data"]

    async def search(
        self, text: str, entity: str, size: int = 5, *, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        # OT search returns nothing for "HER2-positive" or "BACE-1" but finds the unhyphenated forms
        variants = [text, re.sub(r"(?<=[A-Za-z])-(?=\d)", "", text), text.replace("-", " ")]
        hits: list[dict[str, Any]] = []
        for q in dict.fromkeys(variants):
            data = await self.query(
                _SEARCH, {"q": q, "entities": [entity], "size": size}, force_refresh=force_refresh
            )
            hits = data["search"]["hits"]
            if hits:
                break
        return hits

    async def disease(self, efo_id: str, *, force_refresh: bool = False) -> dict[str, Any] | None:
        return (await self.query(_DISEASE, {"id": efo_id}, force_refresh=force_refresh))["disease"]

    async def target(
        self, ensembl_id: str, *, force_refresh: bool = False
    ) -> dict[str, Any] | None:
        data = await self.query(_TARGET, {"id": ensembl_id}, force_refresh=force_refresh)
        return data["target"]

    async def drug(self, chembl_id: str, *, force_refresh: bool = False) -> dict[str, Any] | None:
        return (await self.query(_DRUG, {"id": chembl_id}, force_refresh=force_refresh))["drug"]

    async def association(
        self, disease_id: str, target_id: str, *, force_refresh: bool = False
    ) -> dict[str, Any] | None:
        """Overall score + per-datatype scores, or None when OT has no association at all."""
        data = await self.query(
            _ASSOCIATION, {"disease": disease_id, "target": target_id}, force_refresh=force_refresh
        )
        rows = ((data.get("disease") or {}).get("associatedTargets") or {}).get("rows") or []
        return rows[0] if rows else None

    async def target_drugs(
        self, ensembl_id: str, *, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        data = await self.query(_TARGET_DRUGS, {"id": ensembl_id}, force_refresh=force_refresh)
        block = (data.get("target") or {}).get("drugAndClinicalCandidates") or {}
        return block.get("rows") or []

    async def disease_drugs(
        self, efo_id: str, *, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        data = await self.query(_DISEASE_DRUGS, {"id": efo_id}, force_refresh=force_refresh)
        block = (data.get("disease") or {}).get("drugAndClinicalCandidates") or {}
        return block.get("rows") or []
