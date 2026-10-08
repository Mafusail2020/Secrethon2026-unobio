"""Prototype of the twin-stats join over the Open Targets parquet files (T0 exploration).

uv run python -m scripts.explore_opentargets [TARGET_SYMBOL DISEASE_ID ...]

Prints, per match level, the historical programs (drug x disease) on the same target
and their outcome.
The production version lives in app/quant/twin_stats.py; this is the reference the notes in
docs/data/opentargets.md were written from.
"""

import sys
from pathlib import Path

import duckdb

DATA = Path(__file__).resolve().parents[1] / "data" / "opentargets"

DEMO_CASES = [("BACE1", "MONDO_0004975"), ("PCSK9", "HP_0003124")]

# A program whose latest trial started this recently, or that has a trial in one of these statuses,
# is still running: censored, neither success nor failure.
ACTIVE_STATUSES = (
    "RECRUITING",
    "ACTIVE_NOT_RECRUITING",
    "NOT_YET_RECRUITING",
    "ENROLLING_BY_INVITATION",
    "SUSPENDED",
)
ACTIVE_WINDOW_YEARS = 3
STOPPED_STATUSES = ("TERMINATED", "WITHDRAWN")

STOP_CATEGORY = {
    "Negative": "efficacy",
    "Safety_Sideeffects": "safety",
    "Business_Administrative": "business",
    "Logistics_Resources": "business",
}

STAGE_RANK = {
    "PRECLINICAL": 0,
    "IND": 0,
    "UNKNOWN": 0,
    "EARLY_PHASE_1": 1,
    "PHASE_1": 1,
    "PHASE_1_2": 2,
    "PHASE_2": 2,
    "PHASE_2_3": 3,
    "PHASE_3": 3,
    "PREAPPROVAL": 4,
    "APPROVAL": 5,
    "PHASE_4": 5,
}


def views(con: duckdb.DuckDBPyConnection) -> None:
    for name in [
        "clinical_report",
        "clinical_indication",
        "clinical_target",
        "disease",
        "drug_molecule",
        "target",
    ]:
        con.execute(f"create view {name} as select * from '{DATA / name}/*.parquet'")


PROGRAMS_SQL = f"""
with target_drugs as (
    select distinct drugId from clinical_target where targetId = $target
),
programs as (
    select ci.drugId, ci.diseaseId, ci.maxClinicalStage, ci.clinicalReportIds
    from clinical_indication ci join target_drugs using (drugId)
    where ci.diseaseId is not null
),
reports as (
    select p.drugId, p.diseaseId, r.*
    from programs p, unnest(p.clinicalReportIds) as u(rid)
    join clinical_report r on r.id = u.rid
),
per_program as (
    select drugId, diseaseId,
        bool_or(trialOverallStatus in {ACTIVE_STATUSES}) as has_active_trial,
        max(trialStartDate) as last_start,
        bool_or(trialOverallStatus in {STOPPED_STATUSES}) as has_stopped_trial,
        list(distinct c) filter (where c is not null) as stop_cats,
        list(id) filter (where source = 'ClinicalTrials.gov') as nct_ids,
        first(trialWhyStopped) filter (where trialWhyStopped is not null) as why_stopped
    from reports left join unnest(trialStopReasonCategories) as s(c) on true
    group by all
)
select p.drugId, m.name as drug, p.diseaseId, d.name as disease, d.therapeuticAreas,
    p.maxClinicalStage,
    case
        when p.maxClinicalStage = 'APPROVAL' then 'approved'
        when pp.has_active_trial
            or pp.last_start >= current_date - interval {ACTIVE_WINDOW_YEARS} year then 'active'
        when pp.has_stopped_trial or pp.last_start is not null then 'stopped'
        else 'unknown'
    end as status,
    pp.stop_cats, pp.why_stopped, pp.nct_ids
from programs p
left join per_program pp using (drugId, diseaseId)
left join drug_molecule m on m.id = p.drugId
left join disease d on d.id = p.diseaseId
"""


def match_levels(con: duckdb.DuckDBPyConnection, target: str, disease: str) -> None:
    con.execute(
        "create or replace temp table progs as " + PROGRAMS_SQL.replace("$target", f"'{target}'")
    )
    row = con.execute(
        "select descendants, therapeuticAreas, name from disease where id = ?", [disease]
    ).fetchone()
    if row is None:
        print(f"  disease {disease} not found")
        return
    descendants, areas, name = row
    exact = [disease, *(descendants or [])]
    print(f"  disease: {name}  areas={areas}  descendants={len(descendants or [])}")

    levels = {
        "exact_target_indication": f"diseaseId in {tuple(exact) + ('',)}",
        "target_area": f"list_has_any(therapeuticAreas, {list(areas or [])})",
        "target_any": "true",
    }
    for level, where in levels.items():
        res = con.execute(
            f"""select status, count(*) from progs where {where} group by 1 order by 1"""
        ).fetchall()
        counts = dict(res)
        approved, stopped = counts.get("approved", 0), counts.get("stopped", 0)
        decided = approved + stopped
        rate = f"{approved / decided:.2f}" if decided else "n/a"
        print(f"  {level:26s} {counts}  raw success = {approved}/{decided} = {rate}")
        if level == "exact_target_indication":
            con.sql(
                f"""select drug, disease, maxClinicalStage, status, stop_cats,
                    left(why_stopped, 60) why, nct_ids[:4] ncts
                from progs where {where} order by status, drug"""
            ).show(max_width=260)

    cats = con.execute(
        "select c, count(*) from (select unnest(stop_cats) c from progs where status = 'stopped') "
        "group by 1 order by 2 desc"
    ).fetchall()
    mapped = {c: (n, STOP_CATEGORY.get(c, "other")) for c, n in cats}
    print("  stop categories (target_any):", mapped)


def main() -> None:
    args = sys.argv[1:]
    cases = list(zip(args[::2], args[1::2], strict=True)) if args else DEMO_CASES
    con = duckdb.connect()
    views(con)
    for symbol, disease in cases:
        ensg = con.execute("select id from target where approvedSymbol = ?", [symbol]).fetchone()
        if ensg is None:
            print(f"{symbol}: target not found")
            continue
        print(f"\n### {symbol} ({ensg[0]}) x {disease}")
        match_levels(con, ensg[0], disease)


if __name__ == "__main__":
    main()
