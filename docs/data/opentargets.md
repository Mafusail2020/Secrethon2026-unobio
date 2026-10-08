# Open Targets bulk data — schemas and twin-stats join plan

Release **26.09** (files dated 2026-09-24), `https://ftp.ebi.ac.uk/pub/databases/opentargets/platform/latest/output/`.

```sh
cd backend
uv run python -m scripts.download_opentargets            # ~159 MB into backend/data/opentargets/
uv run python -m scripts.download_opentargets --dry-run  # sizes only
uv run python -m scripts.explore_opentargets             # twin-stats prototype on the demo cases
uv run python -m scripts.explore_opentargets PCSK9 MONDO_0005439
```

`association_by_datatype_direct` (860 MB, 15 parts) is **not** downloaded by default (`--with-associations`).
We only need the genetic score for one target × disease pair per run, and GraphQL returns it in one call
(see `apis.md`).

## Datasets we use

| Dataset | Rows | Size | Grain | Used for |
|---|---:|---:|---|---|
| `clinical_report` | 289,954 | 76 MB | one trial / label / curated record | stage, status, why stopped, stop categories, NCT url |
| `clinical_indication` | 86,451 | 5 MB | drug × disease | **the program**: max stage + report ids |
| `clinical_target` | 13,261 | 3 MB | drug × target (unique) | drugs acting on the target |
| `evidence_clinical_precedence` | 876,506 | 39 MB | target × disease × report | alternative join, has `score`; not needed for twin stats |
| `disease` | 45,896 | 6 MB | disease | `descendants`, `ancestors`, `therapeuticAreas`, synonyms |
| `drug_molecule` | 19,170 | 7 MB | drug | name, type (modality), `maximumClinicalStage`, synonyms |
| `drug_mechanism_of_action` | 6,092 | 0.3 MB | MoA | `actionType` (INHIBITOR, AGONIST…), `chemblIds`, `targets` |
| `drug_warning` | 2,009 | 0.2 MB | warning | black-box / withdrawal, `toxicityClass` |
| `target` | 78,733 | 22 MB | target | symbol → Ensembl id, `targetClass` (ChEMBL l1–l5) |
| `target_safety_event` | 4,387 | 0.1 MB | target × event | safety liabilities for the bear case |

### Key columns

- `clinical_report`: `id` (`nct01739348` for CT.gov, `<ttd id>/<disease>` for TTD, etc.), `source`
  (ClinicalTrials.gov 231k, TTD 30k, DailyMed 17k, ATC, EMA, PMDA, FDA, …), `type` (`INDICATION` | `SAFETY`),
  `clinicalStage`, `trialOverallStatus`, `trialWhyStopped`, `trialStopReasonCategories VARCHAR[]`,
  `trialStartDate DATE`, `drugs STRUCT(drugFromSource, drugId)[]`, `diseases STRUCT(diseaseFromSource, diseaseId)[]`,
  `trialSponsor`, `trialPhase`, `url`. `year` is null for CT.gov rows — use `trialStartDate`.
- `clinical_indication`: `drugId`, `diseaseId`, `maxClinicalStage`, `clinicalReportIds VARCHAR[]`.
- `clinical_target`: `drugId`, `targetId`, `diseases[]`, `clinicalReportIds[]`, `maxClinicalStage`.
- `disease`: `id` (MONDO_/EFO_/HP_/Orphanet_/…), `name`, `parents`, `ancestors`, `descendants`,
  `therapeuticAreas` (ids of top-level areas, e.g. `EFO_0000651` = phenotype, `MONDO_0005071` = nervous system disorder).

### Value sets (release 26.09)

- **Stages** (`clinicalStage`): `PRECLINICAL, IND, EARLY_PHASE_1, PHASE_1, PHASE_1_2, PHASE_2, PHASE_2_3, PHASE_3,
  PREAPPROVAL, APPROVAL, PHASE_4, WITHDRAWAL, UNKNOWN`. `clinical_indication.maxClinicalStage` never contains
  `PHASE_4` / `WITHDRAWAL` (approved programs are `APPROVAL`); `clinical_target.maxClinicalStage` does contain `PHASE_4`.
- **Trial status**: `COMPLETED, TERMINATED, WITHDRAWN, SUSPENDED, RECRUITING, ACTIVE_NOT_RECRUITING, NOT_YET_RECRUITING,
  ENROLLING_BY_INVITATION, UNKNOWN, NULL` (+ expanded-access values). NULL = non-trial sources.
- **Stop-reason categories**: the docs say 17, the data has **13**:

| OT category | count | our `StopCategory` |
|---|---:|---|
| `Negative` | 2,456 | efficacy |
| `Safety_Sideeffects` | 935 | safety |
| `Business_Administrative` | 7,905 | business |
| `Logistics_Resources` | 1,614 | business |
| `Insufficient_Enrollment` | 8,047 | other |
| `Study_Design` | 1,672 | other |
| `Invalid_Reason` | 1,309 | other |
| `Another_Study` | 1,026 | other |
| `Study_Staff_Moved` | 847 | other |
| `Covid19` | 812 | other |
| `Regulatory` | 611 | other |
| `Uncategorised` | 540 | other |
| `No_Context` | 241 | other |

  A program with several categories takes the most severe: safety > efficacy > business > other.

## Twin-stats join plan

A **program** = one row of `clinical_indication` (drug × disease). Twins = programs whose drug acts on the input target.

```text
target symbol ──target──▶ targetId
targetId ──clinical_target──▶ drugIds
drugIds ──clinical_indication──▶ programs (drugId, diseaseId, maxClinicalStage, clinicalReportIds)
programs ──unnest(clinicalReportIds)──▶ clinical_report  (status, start date, why stopped, categories, NCT url)
programs ──disease──▶ name, therapeuticAreas      programs ──drug_molecule──▶ drug name, drugType
```

Reference SQL: `PROGRAMS_SQL` in `backend/scripts/explore_opentargets.py`.

### Program outcome (`TwinStatus`)

| status | rule |
|---|---|
| `approved` | `maxClinicalStage = 'APPROVAL'` |
| `active` (censored) | any linked trial in RECRUITING / ACTIVE_NOT_RECRUITING / NOT_YET_RECRUITING / ENROLLING_BY_INVITATION / SUSPENDED, **or** latest `trialStartDate` within 3 years |
| `stopped` | otherwise, if any linked trial exists (explicit TERMINATED/WITHDRAWN, or no activity for 3+ years) |
| `unknown` | only curated/label records, no trial dates |

Success rate for a match level = `approved / (approved + stopped)`; `active` and `unknown` are excluded.
`stop_reason` = `trialWhyStopped` of the highest-stage terminated trial; category from the table above.

### Match levels

| level | filter on programs |
|---|---|
| `exact_target_indication` | `diseaseId ∈ {input disease} ∪ disease.descendants` |
| `target_area` | `list_has_any(therapeuticAreas, input disease's therapeuticAreas)` |
| `target_any` | all programs on the target |
| `target_class` | programs on targets sharing the input's `targetClass` label at level l4/l5 (via `target.targetClass` + `clinical_target`) — not prototyped yet |
| `area_base_rate` | none: `config/base_rates.yaml` |

Stop at the first level with ≥ 3 decided (approved + stopped) programs.

### Results on the demo cases (prototype, release 26.09)

**BACE1 × Alzheimer disease (`MONDO_0004975`)** — exact level: 4 programs, **0 approved / 4 stopped**.

| drug | max stage | status | category | why stopped (CT.gov) |
|---|---|---|---|---|
| verubecestat | PHASE_3 | stopped | — (none in OT) | — (empty on CT.gov too) |
| lanabecestat | PHASE_3 | stopped | efficacy | "independent assessment concluded the trial was not likely to meet…" |
| elenbecestat | PHASE_3 | stopped | efficacy | "unfavorable risk-benefit ratio including no evidence of potential benefit" |
| atabecestat | PHASE_2_3 | stopped | efficacy | "Change in benefit-risk profile…" |

target_area 0/5, target_any 0/7.

**PCSK9 × Hypercholesterolemia (`HP_0003124`)** — exact level: **4 approved / 4 stopped**, 1 active (lerodalcibep).
Approved: alirocumab, evolocumab, inclisiran (+ inclisiran sodium as a separate ChEMBL id). target_area 10/34,
target_any 20/62. With `MONDO_0005439` (familial hypercholesterolemia): 5/10.

So the two cases give clearly different priors from real twins; twin stats is computable.

## Caveats (handle in T3 / T1)

1. **Disease id choice changes the twin set.** `HP_0003124` (phenotype ontology) has 0 descendants; PCSK9 programs are also
   filed under `MONDO_0005439` and `MONDO_0004995`. `input_resolver` should prefer MONDO/EFO disease ids over HP, and
   log the alternatives.
2. **Salt forms and parents are separate drugs** (inclisiran vs inclisiran sodium), and `parentId` is not always set
   (it is NULL for inclisiran sodium). Collapse by `parentId` / `childChemblIds` **and** by name with salt suffixes
   stripped (sodium, hydrochloride, …) before counting, or n is inflated.
3. **Missing stop reasons.** Verubecestat's Phase 3 trials are TERMINATED with no `whyStopped` in OT *or* CT.gov.
   Report "stop reason not recorded" rather than guessing; literature (Europe PMC) can supply it as separate evidence.
4. **"Stopped by inactivity" is a heuristic, and it misclassifies tafolecimab.** Tafolecimab was approved in China in
   August 2023 for primary hyperlipidemia incl. HeFH (Europe PMC, PMID 37847461 "Tafolecimab: First Approval").
   OT has `drug_molecule.maximumClinicalStage = APPROVAL` for it, but no approval record linked to any indication
   (no NMPA source), so every tafolecimab × disease program tops out at PHASE_3 and the hypercholesterolemia one is
   counted as stopped. The same program is also split across `HP_0003124`, `MONDO_0005439` and `Orphanet_79211`.
   Fix in T3: never mark a program `stopped` by inactivity when the drug itself is at APPROVAL and the program reached
   Phase 3 without a terminated trial. Mark it `unknown` (censored), with a note. Also split explicit stops
   (TERMINATED/WITHDRAWN at max stage) from presumed ones in the twin notes.
5. **Stage-conditional prior.** The raw rate above is "ever approved". For an input program already in Phase 2, use only
   twins that reached ≥ its stage (rank stages: 1 = PHASE_1/EARLY, 2 = PHASE_1_2/PHASE_2, 3 = PHASE_2_3/PHASE_3,
   4 = PREAPPROVAL, 5 = APPROVAL).
6. **Small n.** Exact-level twins are usually < 10, so the Beta-Binomial shrinkage toward the area base rate (pseudo-count
   ≈ 5) is essential; 0/4 must not become a 0 % prior.
7. Some `clinical_target.diseases[].diseaseId` are NULL (unmapped source terms); `clinical_indication` already drops them.
8. `trialStopReasonCategories` exists only on CT.gov rows; TTD / label rows never carry a status.
9. Coverage gaps: only drugs with a ChEMBL id and a mapped MoA appear (e.g. umibecestat is absent for BACE1).
