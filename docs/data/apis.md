# Public APIs — probe notes (2026-10-08)

All probed with tiny live requests on 2026-10-08. All free, no key needed. Rate limits marked *(docs)* are the
providers' published numbers, not measured by us.

## Open Targets Platform GraphQL

- Endpoint: `POST https://api.platform.opentargets.org/api/v4/graphql`, body `{"query": "..."}`.
- Version: API 26.9.0, data 26.09 — same release as the bulk files.
- Rate limit: none published; keep it to a few calls per run, cache 7 days.
- **Field names changed vs older docs:** `knownDrugs` is gone, use `drugAndClinicalCandidates`. Root queries:
  `target, targets, disease, diseases, drug, drugs, search, mapIds, clinicalReport, clinicalReports, …`.
  Introspect (`__type(name:"Target"){ fields { name } }`) before adding a query.

| Need | Query |
|---|---|
| Resolve names | `search(queryString:"BACE1", entityNames:["target"], page:{index:0,size:5}){ hits { id name entity score } }` (also `"disease"`, `"drug"`) |
| Genetic score for a pair | `disease(efoId:"MONDO_0004975"){ associatedTargets(Bs:["ENSG00000186318"]){ rows { score datatypeScores { id score } } } }` |
| Safety liabilities | `target(ensemblId:…){ safetyLiabilities { event eventId datasource literature url effects { direction dosing } } }` |
| Tractability | `target(ensemblId:…){ tractability { label modality value } }` |
| Target class | `target(ensemblId:…){ targetClass { id label level } }` |
| Drugs on target | `target(ensemblId:…){ drugAndClinicalCandidates { count rows { maxClinicalStage drug { id name } diseases { disease { id name } } } } }` |

`datatypeScores` ids seen so far: `genetic_association, genetic_literature, somatic_mutation, clinical, literature,
animal_model` (`associationDatasources` returns an empty list in 26.09, so there is no full list from the API).
A missing id means no evidence of that type. Observed:
BACE1 × AD has **no** `genetic_association` (literature 0.99, clinical 0.63, animal_model 0.47);
PCSK9 × familial hypercholesterolemia has `genetic_association` **0.92**. That is the ledger's genetic-support input.

## ClinicalTrials.gov API v2

- One study: `GET https://clinicaltrials.gov/api/v2/studies/NCT01739348?fields=NCTId,OverallStatus,WhyStopped,Phase,EnrollmentCount,StartDate,CompletionDate,PrimaryOutcome,LeadSponsorName,Condition,InterventionName`
- Search: `GET /api/v2/studies?query.intr=verubecestat&query.cond=…&query.term=…&filter.overallStatus=TERMINATED,WITHDRAWN&fields=…&pageSize=…&countTotal=true`;
  paginate with `pageToken` = previous `nextPageToken`.
- `fields=` takes short names (`WhyStopped`) but the response is nested: `protocolSection.statusModule.whyStopped`,
  `designModule.phases` (list, e.g. `["PHASE2","PHASE3"]`), `designModule.enrollmentInfo.count`,
  `outcomesModule.primaryOutcomes[].measure`, `sponsorCollaboratorsModule.leadSponsor.name`.
- Empty fields are **omitted**, not null (NCT01739348 has no `whyStopped` key at all).
- Rate limit: ~50 requests/min per IP *(docs)*. No rate-limit headers returned.
- Stable source id: `nct:<NCTId>`; URL `https://clinicaltrials.gov/study/<NCTId>`.

## Europe PMC REST

- `GET https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=…&format=json&resultType=core&pageSize=25&cursorMark=*`
- `resultType=core` returns `abstractText`, `pubType`, `doi`, `pmid`, `pubYear`, `source` (`MED`, `PMC`, `PPR` = preprint).
  Paginate with `nextCursorMark`.
- Query syntax: Lucene-like; `"phase 3"` phrases, `AND/OR/NOT`, `SRC:PPR` (preprints only), `PUB_YEAR:[2015 TO 2026]`.
  `BACE1 AND "phase 3" AND alzheimer` → 466 hits, 2026 failure-taxonomy reviews on top.
- Rate limit: none published; be polite (≤ 10 req/s).
- Stable source id: `pmid:<pmid>` or `ppr:<id>`; excerpt = abstract sentence(s).

## openFDA

- Labels: `GET https://api.fda.gov/drug/label.json?search=openfda.generic_name:evolocumab&limit=1`
  → sections as string arrays: `indications_and_usage, boxed_warning (if any), warnings_and_cautions, mechanism_of_action,
  clinical_studies, adverse_reactions`, plus `openfda.{brand_name, application_number}`, `set_id`, `effective_time`.
- Approvals: `GET https://api.fda.gov/drug/drugsfda.json?search=openfda.generic_name:evolocumab&limit=1`
  → `application_number` (BLA125522), `sponsor_name`, `submissions[]{submission_type, submission_status, submission_status_date}`.
- No match returns HTTP 404 with `{"error":{"code":"NOT_FOUND"}}` — treat as empty, not as failure.
- Rate limit *(docs)*: 240 req/min and 1,000 req/day per IP without a key; an optional free key raises the daily cap.
- Stable source id: `fda_label:<set_id>`, `fda_app:<application_number>`.

## NCBI E-utilities

- `GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=verubecestat&retmode=json&retmax=20`
  → `esearchresult.idlist` (PMIDs), `count` (74 for verubecestat). Then `efetch.fcgi?db=pubmed&id=…&rettype=abstract&retmode=xml`.
- Rate limit *(docs)*: 3 req/s without key, 10 with key; send `tool` and `email` params.
- Mostly redundant with Europe PMC (which indexes PubMed); use only as fallback.

## Client plan for T1

| client | calls per run (medium effort) | cache key |
|---|---|---|
| `opentargets.py` | search ×2, association ×1, target details ×1 | GraphQL query + variables |
| `clinicaltrials.py` | search by target/drug/condition ×2–4, study details for terminated ones | path + sorted params |
| `europepmc.py` | 3–6 searches (bull + bear templates) | query + page |
| `openfda.py` | label + drugsfda per approved comparator | search string |
