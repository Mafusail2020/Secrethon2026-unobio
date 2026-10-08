# Contract change: efficacy and safety lanes, hazard ledger

For Person B (data sources, store, quant, node bodies). The plan is in `docs/ARCHITECTURE.md` sections 2a-2c; this file is
what you need to build against it. Everything below is already in the repo as a contract plus working stubs; the stubs
return fixture data, so the app runs end to end and `make check` is green.

## Why

The graph had no step that asks the two biggest questions directly: does the drug do what it is meant to do, and is it
toxic. ASBMB Today ("90% of drugs fail clinical trials", 2022,
https://www.asbmb.org/asbmb-today/opinions/031222/90-of-drugs-fail-clinical-trials) gives the split: roughly 40-50% lack
of efficacy, 30% unmanageable toxicity, 10-15% poor drug-like properties, 10% commercial or strategic. The article credits
"a 2016 analysis" without naming it, so we cite the article and the primary study is **unverified**. If you find it,
replace the citation in `backend/config/ledger.yaml` and in the fixture.

## What changed

| Area | Before | After |
|---|---|---|
| Graph | 25 nodes (17 + 8 bull/bear inner) | 36 nodes, 32 runnable: new `fetch_safety`, and containers `efficacy_assessment`, `safety_assessment` with inner `<lane>_gather / _extract / _gate / _score` |
| Ledger step | `likelihood_ratio` on odds | `cause` + `risk_ratio` on that cause's hazard; `pos_after` now required |
| Ledger | `prior`, `steps`, `posterior` | adds `failure_mix` and `by_cause`; `posterior` must equal the last step's `pos_after` |
| Twin stats | stop reasons only | `TwinStats.failure_mix` (`twins` or `literature`) |
| State | | `risk_adjustments` (dict, key `cause:factor`), `assessments` (dict, key cause) |
| Report | | `assessments: list[AssessmentResult]`; new section id `safety`; `ReasonCode.cause` |
| Node kinds / phase | | kinds `efficacy`, `safety`; phase `assess` |
| Config | `likelihood_ratios` | `failure_mix` (literature fallback) and `risk_ratios` in `config/ledger.yaml`; all `assumption: true` |

`translation_chain` is now written by `efficacy_gate`, not by `section_analysts`. `section_analysts` reads `assessments`.

## The math (`backend/app/quant/hazard.py`, already written and tested)

```
H     = -ln(prior)                       cumulative hazard of failing
H_i   = share_i * H                      split by failure cause (failure mix)
H_i  <- H_i * risk_ratio                 per RiskAdjustment on cause i
PoS   = exp(-sum(H_i)), clamped to posterior_clamp
```

Worked example: prior 0.10, efficacy and "other" 50% each, one efficacy ratio 0.5. `H = 2.3026`, efficacy hazard 1.1513
becomes 0.5756, total 1.7269, `PoS = 0.1778`. Properties the tests pin: no adjustments returns the prior; a ratio only
moves its own cause; order of adjustments does not change the posterior; ranges stay ordered (the low end of a probability
is pessimistic, the low end of a hazard or ratio is the smaller number); clamp holds at extreme priors.

## What you implement

Keep node ids, function names, `SPEC`s and state keys. Stub bodies live in `nodes/subgraphs/assessments.py` and
`nodes/fetch_safety.py`.

| Node | Real body |
|---|---|
| `fetch_safety` | Open Targets target safety liabilities and tissue expression, openFDA label warnings and adverse-event counts for the target's drug class. Register sources and evidence through `ctx`. |
| `twin_stats` | Add `failure_mix`: from the twins' own stop reasons when at least `failure_mix.min_stopped_twins` stopped, otherwise the literature split from config with its citation. Set `n_stopped`. |
| `<lane>_gather` | Code only. Collect numbers and evidence ids for the lane into `scratch[<lane>_gather]`: association evidence by data type, same-target and same-class trial outcomes and stop reasons (precedent base, ARCHITECTURE 2c), tissue expression, label warnings. |
| `<lane>_extract` | One model call over the gathered digest, never over raw evidence. Writes claims into `scratch`; efficacy also drafts the five-step translation chain. Labels follow CLAUDE.md: background knowledge is `hypothesis` only. |
| `<lane>_gate` | `gate_claims`, then write `claims` (and `translation_chain` for efficacy). |
| `<lane>_score` | Formulas. Build `RiskAdjustment`s (efficacy lane covers `efficacy` and `pk_exposure`, safety lane covers `safety`) and one `AssessmentResult` with metrics, rating and gaps. Ratios come from `risk_ratios` in config. |
| `evidence_ledger` | Already uses `apply_adjustments`; fill `failure_mix` from `twin_stats` and keep the validators happy. |

## Rules that will bite

- **Lanes run in parallel with the bull and bear cases.** An adjustment or assessment may cite only claims written by its
  own lane's extractor, or evidence ids. Citing bull or bear claims points at claims that may not exist yet. The stub
  drops an adjustment that had support and lost all of it to a correction; keep that behaviour.
- Every `sourced` ratio or metric needs a `citation`; otherwise `basis: "assumption"` and the value lives in config with
  `assumption: true`.
- `LedgerStep` validators: `direction == "up"` needs `risk_ratio.base <= 1`, `"down"` needs `>= 1`; `pos_after` required;
  the ledger's posterior equals the last step's `pos_after`. `FailureMix` base shares sum to 1 within 0.02.
- `hazard.py` sits in your folder but I wrote it as the reference. Refactor freely if the tests in `tests/test_hazard.py`
  and `tests/test_contract_quant.py` still pass.
- A real run replaces fixtures: the stubs still read `contracts/fixtures/report_bace1_alzheimers.json`. Delete what you
  replace; the fixture stays as the contract example.

## Cost

Estimate, not measured: one model call per lane on a gathered digest, about 17k extra tokens per run. Gather and score are
code. Develop against the cheap model with the cache on and ask before big live runs (team budget $67).

## Open questions for you

1. Is Open Targets bulk data enough for the precedent base (`clinical_report`, `clinical_indication`, `clinical_target`,
   `target_safety_event`), or do you also need ChEMBL? Target: usable by Sat 18:00 freeze.
2. Which stop-reason categories can you derive reliably from ClinicalTrials.gov `why_stopped` text? Anything uncategorised
   stays `other`.
3. Are the starting `risk_ratios` in `config/ledger.yaml` reasonable? They are placeholders (`assumption: true`).
4. Do you want the per-run evidence graph for the demo, or only the precedent base?

## Where to look

`backend/app/contracts/{quant,assessment,report}.py`, `backend/app/graph/topology.py`, `backend/app/quant/hazard.py`,
`backend/app/nodes/subgraphs/assessments.py`, `backend/config/ledger.yaml`, `contracts/fixtures/report_bace1_alzheimers.json`.

This change touches more than contracts (topology, stubs, tests, and the frontend names that depend on them) because they
cannot be separated without leaving `make check` red. It sits on branch `ivan`.
