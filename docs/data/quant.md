# Quant layer (T3): twin stats, ledger, valuation, verdict

No model calls anywhere in this layer. Every number is a formula over Open Targets data plus config in
`backend/config/` where each entry has a `citation` or `assumption: true`.

| Node | Code | Config |
|---|---|---|
| `twin_stats` | `app/quant/twin_stats.py` (DuckDB over the bulk parquet) | `base_rates.yaml` (`twins:` block), `ledger.yaml` (`failure_mix`) |
| `evidence_ledger` | `app/quant/hazard.py` (Ivan's reference math) | `ledger.yaml` |
| `valuation` | `app/quant/valuation.py` | `valuation.yaml`, `base_rates.yaml` |
| `verdict` | `app/quant/verdict.py` | `verdict.yaml` |

`twin_stats` needs the bulk files (`uv run python -m scripts.download_opentargets`, ~159 MB under
`DATA_DIR/opentargets`). Without them, or with fixture entities, it falls back to the fixture and logs a warning.

## Twin stats

1. Programs = `clinical_indication` rows (drug × disease) whose drug acts on the target (`clinical_target`).
2. Outcome per program: `approved` (stage APPROVAL); `active` (a running trial or one started in the last 3 years —
   censored); `stopped` (a terminated/withdrawn trial, or no new trial for 3+ years = *presumed*); `unknown`
   (censored). If the drug itself is approved and the program reached Phase 3 without a terminated trial, it is
   `unknown`, not stopped (tafolecimab: approved in China, no approval record in Open Targets).
3. Salt forms collapse by parent name (inclisiran + inclisiran sodium = one program).
4. Only twins that reached the program's stage count (a Phase 2 program ignores twins that died in Phase 1).
5. Match levels, first with ≥ 3 decided twins: `exact_target_indication` (disease, descendants and direct parents that are not area roots; Open Targets files resmetirom's approval under fatty liver, not MASH) → `target_area` →
   `target_any` → `target_class` (other targets sharing the ChEMBL l5 class; logged as different mechanisms) →
   `area_base_rate`.
6. Prior = mean with 5th/95th percentiles of Beta(approved + k·b, stopped + k·(1 − b)), k = 5, b = the area's probability of
   approval from the program's stage. The mean, not the median, because rNPV is an expected value and a Beta with few
   twins is skewed (the median of the bare area prior sits about a third below b). Percentiles are sampled with a fixed
   seed, so a run repeats exactly.
7. Stop reasons: Open Targets' ML classes → efficacy (`Negative`), safety (`Safety_Sideeffects`), business
   (`Business_Administrative`, `Logistics_Resources`), other.
8. `failure_mix`: from the stopped twins once ≥ 5 have a recorded reason (90 % Wilson intervals), otherwise the
   literature split. `pk_exposure` always keeps the literature share — no stop-reason class names it.

**Base rates** (`base_rates.yaml`): BIO, Biomedtracker, Amplion, *Clinical Development Success Rates 2006–2015*
(2016), Figure 2b (14 disease areas) and Figure 8 (rare diseases), checked against the report on 2026-10-08. The
newer 2011–2020 edition was not readable, so it is not cited. Open Targets therapeutic areas map to the report's
areas; phenotype-only terms (e.g. `HP_0003124`) fall back to name keywords, marked as an assumption.

**Literature failure split** (`ledger.yaml`): Sun et al., *Acta Pharm Sin B* 2022 (PMID 35865092), which cites
Dowden & Munro 2019 and Harrison 2016 (the "2016 analysis" ASBMB Today quotes). The fixture still cites ASBMB; it
changes only through a `contract/...` PR.

## Ledger

Ivan's hazard split (`hazard.py`), with:
- prior from twin stats, else `prior_fallback`, else the all-indications base rate;
- failure mix from twin stats, else the literature split; clamp from `posterior_clamp`;
- **no double counting**: an efficacy adjustment about terminated twins is skipped when the prior already comes from
  same-indication twins;
- a correction that says to drop/ignore a named factor removes that adjustment.

## Valuation

Phases ahead of the program's stage are costed (patients × cost per patient + fixed cost) and weighted by the
chance of reaching them; revenue is a 5-year linear ramp to peak sales, 10 years on market, operating margin,
discounted and weighted by the ledger's PoS. Phase success rates are the area base rates scaled so their product
equals the PoS. low/base/high take the pessimistic, central and optimistic end of every input. Cost per patient
$100–200K is cited from the Unobio opening session; trial sizes, fixed costs, durations, peak sales, margin and the
discount rate are assumptions. Corrections such as "cost per patient 250k", "peak sales 2b" or "discount rate 15%"
edit the matching assumption; other text is logged as not applied.

## Verdict

- `do_not_invest`: a kill flag — ≥ 2 same-indication, same-target twins stopped for efficacy at Phase 2/3 or later,
  or a verdict correction that reports a failure (terminated, futility, toxicity, …) — or rNPV high < 0.
- `invest`: PoS low ≥ 10 %, rNPV low > 0, no concerning assessment and no high-severity risk.
- otherwise `conditional`, with conditions from high risks, assessment gaps, an rNPV range spanning zero and a low PoS.
- confidence from the posterior's high/low ratio and the number of decided twins. At most 5 reason codes.

## Measured (live sources, mocked LLM, stage Phase 2)

| Case | Twins (exact indication) | Prior PoS | Decision |
|---|---|---|---|
| BACE1 × Alzheimer's | 0 approved / 4 stopped (3 for efficacy) | 0.050 (0.002–0.253) | do_not_invest (kill flag) |
| PCSK9 × hypercholesterolemia | 3 approved / 2 stopped; lerodalcibep active, tafolecimab unknown | 0.420 (0.188–0.679) | conditional |

PCSK9 is held at conditional by the fixture stubs of the efficacy/safety lanes (T4).
