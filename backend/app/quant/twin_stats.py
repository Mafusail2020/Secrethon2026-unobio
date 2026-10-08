"""Twin statistics: how programs like this one (same target) fared, from Open Targets clinical data.

A program is one drug x disease row of `clinical_indication`. Its outcome is derived from its trials
(see docs/data/opentargets.md). The prior is a Beta posterior over approved vs stopped twins,
shrunk toward the disease area's base rate; running programs are censored.
"""

import random
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from math import sqrt
from pathlib import Path
from typing import Any

import duckdb

from app.contracts import CauseShare, FailureMix, Range
from app.contracts.quant import StopCategory
from app.quant.base_rates import BaseRates, twin_param
from app.sources.records import parent_name

DATASETS = (
    "clinical_report",
    "clinical_indication",
    "clinical_target",
    "disease",
    "drug_molecule",
    "target",
)

STAGE_RANK = {
    "UNKNOWN": 0,
    "PRECLINICAL": 0,
    "IND": 0,
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
# a twin counts for a program at this stage only if it got at least this far
STAGE_FLOOR = {"phase1": 1, "phase2": 2, "phase3": 3, "filed": 4, "approved": 4}

ACTIVE = {
    "RECRUITING",
    "ACTIVE_NOT_RECRUITING",
    "NOT_YET_RECRUITING",
    "ENROLLING_BY_INVITATION",
    "SUSPENDED",
}
STOPPED = {"TERMINATED", "WITHDRAWN"}

# Open Targets' ML stop-reason classes -> our four categories; anything else is "other"
OT_CATEGORY: dict[str, StopCategory] = {
    "Negative": "efficacy",
    "Safety_Sideeffects": "safety",
    "Business_Administrative": "business",
    "Logistics_Resources": "business",
}
SEVERITY: tuple[StopCategory, ...] = ("safety", "efficacy", "business", "other")
TO_CAUSE = {"efficacy": "efficacy", "safety": "safety", "business": "commercial", "other": "other"}
STATUS_ORDER = ("approved", "active", "stopped", "unknown")


@dataclass
class Trial:
    nct: str
    title: str | None
    phase: str
    status: str | None
    start: date | None
    why: str | None
    categories: list[str]


@dataclass
class Program:
    drug_id: str
    drug: str
    disease_id: str
    disease: str
    areas: list[str]
    max_stage: str
    drug_stage: str | None
    status: str = "unknown"
    presumed: bool = False
    stop_category: StopCategory | None = None
    ot_categories: list[str] = field(default_factory=list)
    why_stopped: str | None = None
    trials: list[Trial] = field(default_factory=list)
    note: str | None = None

    @property
    def rank(self) -> int:
        return STAGE_RANK.get(self.max_stage, 0)


@dataclass
class TwinResult:
    match_level: str
    programs: list[Program]
    decided: list[Program]
    prior: Range
    failure_mix: FailureMix
    notes: list[str]
    base: BaseRates


def data_ready(root: Path) -> bool:
    return all(any((root / d).glob("*.parquet")) for d in DATASETS)


class TwinData:
    """Read-only DuckDB views over the bulk parquet files."""

    def __init__(self, root: Path) -> None:
        self.con = duckdb.connect()
        for name in DATASETS:
            path = (root / name / "*.parquet").as_posix()
            self.con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{path}')")

    def close(self) -> None:
        self.con.close()

    def disease(self, disease_id: str) -> tuple[str, list[str], list[str]] | None:
        row = self.con.execute(
            "SELECT name, coalesce(descendants, []), coalesce(therapeuticAreas, []) "
            "FROM disease WHERE id = ?",
            [disease_id],
        ).fetchone()
        return (row[0], list(row[1]), list(row[2])) if row else None

    def class_targets(self, target_id: str, level: str = "l5") -> tuple[str | None, list[str]]:
        row = self.con.execute(
            "SELECT [c.label FOR c IN targetClass IF c.level = ?] FROM target WHERE id = ?",
            [level, target_id],
        ).fetchone()
        labels = list(row[0]) if row and row[0] else []
        if not labels:
            return None, []
        ids = self.con.execute(
            "SELECT id FROM target WHERE list_contains([c.label FOR c IN targetClass], ?)",
            [labels[0]],
        ).fetchall()
        return labels[0], [r[0] for r in ids]

    def programs(self, target_ids: list[str]) -> list[Program]:
        rows = self.con.execute(
            """
            WITH td AS (
                SELECT DISTINCT drugId FROM clinical_target WHERE list_contains(?, targetId)
            )
            SELECT ci.drugId, coalesce(m.name, ci.drugId),
                   ci.diseaseId, coalesce(d.name, ci.diseaseId),
                   coalesce(d.therapeuticAreas, []), ci.maxClinicalStage, m.maximumClinicalStage
            FROM clinical_indication ci
            JOIN td USING (drugId)
            LEFT JOIN drug_molecule m ON m.id = ci.drugId
            LEFT JOIN disease d ON d.id = ci.diseaseId
            WHERE ci.diseaseId IS NOT NULL
            """,
            [target_ids],
        ).fetchall()
        programs = {
            (r[0], r[2]): Program(
                drug_id=r[0],
                drug=r[1],
                disease_id=r[2],
                disease=r[3],
                areas=list(r[4]),
                max_stage=r[5] or "UNKNOWN",
                drug_stage=r[6],
            )
            for r in rows
        }
        trials = self.con.execute(
            """
            WITH td AS (
                SELECT DISTINCT drugId FROM clinical_target WHERE list_contains(?, targetId)
            ),
            p AS (
                SELECT ci.drugId, ci.diseaseId, unnest(ci.clinicalReportIds) AS rid
                FROM clinical_indication ci JOIN td USING (drugId)
                WHERE ci.diseaseId IS NOT NULL
            )
            SELECT p.drugId, p.diseaseId, r.id, coalesce(r.title, r.trialOfficialTitle),
                   r.clinicalStage, r.trialOverallStatus, r.trialStartDate, r.trialWhyStopped,
                   coalesce(r.trialStopReasonCategories, [])
            FROM p JOIN clinical_report r ON r.id = p.rid
            WHERE r.source = 'ClinicalTrials.gov'
            """,
            [target_ids],
        ).fetchall()
        for t in trials:
            program = programs.get((t[0], t[1]))
            if program is not None:
                program.trials.append(
                    Trial(
                        nct=t[2].upper(),
                        title=t[3],
                        phase=t[4] or "UNKNOWN",
                        status=t[5],
                        start=t[6],
                        why=t[7],
                        categories=list(t[8]),
                    )
                )
        return list(programs.values())


def classify(program: Program, today: date) -> Program:
    """Outcome rules from docs/data/opentargets.md, with the T0 fixes."""
    window = timedelta(days=365 * int(twin_param("active_window_years")["value"]))
    stopped = [t for t in program.trials if t.status in STOPPED]
    starts = [t.start for t in program.trials if t.start]
    if program.max_stage == "APPROVAL":
        program.status = "approved"
    elif any(t.status in ACTIVE for t in program.trials) or (
        starts and max(starts) >= today - window
    ):
        program.status = "active"
    elif stopped:
        program.status = "stopped"
    elif starts:
        if program.drug_stage == "APPROVAL" and program.rank >= 3:
            # e.g. tafolecimab: approved outside the regulators OT covers, so no approval record
            program.status = "unknown"
            program.note = "drug is approved elsewhere; this indication's outcome is not recorded"
        else:
            program.status, program.presumed = "stopped", True
    if program.status == "stopped" and stopped:
        top = max(stopped, key=lambda t: STAGE_RANK.get(t.phase, 0))
        program.why_stopped = next((t.why for t in [top, *stopped] if t.why), None)
        program.ot_categories = sorted({c for t in stopped for c in t.categories})
        found = {OT_CATEGORY.get(c, "other") for c in program.ot_categories}
        program.stop_category = next((c for c in SEVERITY if c in found), None)
    return program


def collapse_salts(programs: list[Program]) -> list[Program]:
    """inclisiran and inclisiran sodium are one program: keep the best outcome, furthest stage."""
    merged: dict[tuple[str, str], Program] = {}
    for p in programs:
        key = (parent_name(p.drug), p.disease_id)
        kept = merged.get(key)
        if kept is None:
            merged[key] = p
            continue
        best = min((kept, p), key=lambda x: (STATUS_ORDER.index(x.status), -x.rank))
        other = p if best is kept else kept
        best.trials += [t for t in other.trials if t.nct not in {x.nct for x in best.trials}]
        best.max_stage = max((kept, p), key=lambda x: x.rank).max_stage
        merged[key] = best
    return list(merged.values())


def beta_range(successes: int, failures: int, base_rate: float) -> Range:
    """5th / 50th / 95th percentiles of Beta(s + k*b, f + k*(1-b)); seeded, so runs repeat."""
    k = float(twin_param("pseudo_count")["value"])
    # an approved-stage program has a base rate of 1, which would zero a Beta parameter
    base_rate = min(max(base_rate, 0.01), 0.99)
    interval = twin_param("interval")
    a, b = successes + k * base_rate, failures + k * (1 - base_rate)
    rng = random.Random(f"{successes}:{failures}:{base_rate:.6f}")
    draws = sorted(rng.betavariate(a, b) for _ in range(20_000))

    def q(p: float) -> float:
        return round(draws[min(int(p * len(draws)), len(draws) - 1)], 4)

    return Range(low=q(interval["low"]), base=q(0.5), high=q(interval["high"]), unit="probability")


def _wilson(k: int, n: int, z: float = 1.645) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return max(0.0, centre - half), min(1.0, centre + half)


def failure_mix(stopped: list[Program], ledger_conf: dict[str, Any]) -> FailureMix:
    conf = ledger_conf["failure_mix"]
    literature = conf["literature"]
    shares = literature["shares"]
    categorized = [p for p in stopped if p.stop_category is not None]
    n = len(categorized)
    if n < int(conf["min_stopped_twins"]["value"]):
        return FailureMix(
            shares=[CauseShare(cause=c, share=Range(**v, unit="share")) for c, v in shares.items()],
            source="literature",
            n_stopped=0,
            basis="sourced",
            citation=" ".join(literature["citation"].split()),
            note=(
                f"only {n} stopped twin(s) with a recorded stop reason "
                f"(need {conf['min_stopped_twins']['value']}); using the literature split"
            ),
        )
    # stop reasons never name exposure problems, so that share stays the literature one
    pk = shares["pk_exposure"]["base"]
    counts = Counter(TO_CAUSE[p.stop_category] for p in categorized)  # type: ignore[index]
    out = [CauseShare(cause="pk_exposure", share=Range(**shares["pk_exposure"], unit="share"))]
    for cause in ("efficacy", "safety", "commercial", "other"):
        lo, hi = _wilson(counts[cause], n)
        base = counts[cause] / n * (1 - pk)
        out.append(
            CauseShare(
                cause=cause,  # type: ignore[arg-type]
                share=Range(
                    low=round(min(lo * (1 - pk), base), 4),
                    base=round(base, 4),
                    high=round(max(hi * (1 - pk), base), 4),
                    unit="share",
                ),
            )
        )
    return FailureMix(
        shares=out,
        source="twins",
        n_stopped=n,
        basis="sourced",
        citation=(
            "Open Targets Platform 26.09 clinical_report stop-reason classes of the stopped twin "
            "programs; pk_exposure share from the literature split in config/ledger.yaml"
        ),
        note=f"{n} stopped twins with a recorded reason; 90% Wilson intervals",
    )


def compute(
    data: TwinData,
    target_id: str,
    disease_id: str,
    stage: str | None,
    base: BaseRates,
    ledger_conf: dict[str, Any],
    *,
    today: date | None = None,
    drop_drugs: set[str] = frozenset(),  # type: ignore[assignment]
) -> TwinResult:
    today = today or date.today()
    notes: list[str] = []
    disease = data.disease(disease_id)
    family = {disease_id, *(disease[1] if disease else [])}
    areas = set(disease[2]) if disease else set()
    floor = STAGE_FLOOR.get(stage or "", 0)
    min_decided = int(twin_param("min_decided")["value"])

    def prepare(programs: list[Program]) -> list[Program]:
        programs = collapse_salts([classify(p, today) for p in programs])
        kept = [p for p in programs if parent_name(p.drug) not in drop_drugs]
        if len(kept) < len(programs):
            notes.append(f"{len(programs) - len(kept)} twin program(s) left out on request")
        return kept

    target_programs = prepare(data.programs([target_id]))
    levels: list[tuple[str, list[Program]]] = [
        ("exact_target_indication", [p for p in target_programs if p.disease_id in family]),
        ("target_area", [p for p in target_programs if areas & set(p.areas)]),
        ("target_any", target_programs),
    ]

    chosen: tuple[str, list[Program], list[Program]] | None = None
    for level, programs in levels:
        decided = _decided(programs, floor)
        if len(decided) >= min_decided:
            chosen = (level, programs, decided)
            break
    if chosen is None:
        label, class_ids = data.class_targets(target_id)
        if label and len(class_ids) > 1:
            programs = prepare(data.programs(class_ids))
            decided = _decided(programs, floor)
            if len(decided) >= min_decided:
                chosen = ("target_class", programs, decided)
                notes.append(
                    f"twins come from other targets in the '{label}' class: "
                    "different mechanisms, read with care"
                )

    loa = base.loa(stage)
    notes.append(
        f"area base rate ({base.area}): {loa:.3f} probability of approval from "
        f"{'Phase I' if floor <= 1 else 'the current phase'}"
        + (f"; {base.note}" if base.note else "")
    )
    if chosen is None:
        shown = levels[-1][1]
        notes.append(
            f"fewer than {min_decided} decided twins at every level; prior is the area base rate"
        )
        return TwinResult(
            match_level="area_base_rate",
            programs=shown,
            decided=[],
            prior=beta_range(0, 0, loa),
            failure_mix=failure_mix([], ledger_conf),
            notes=notes,
            base=base,
        )

    level, programs, decided = chosen
    approved = sum(p.status == "approved" for p in decided)
    stopped = [p for p in decided if p.status == "stopped"]
    presumed = sum(p.presumed for p in stopped)
    censored = Counter(p.status for p in programs if p.status in ("active", "unknown"))
    if floor:
        notes.append(f"only twins that reached the program's stage ({stage}) count")
    notes.append(
        f"{level}: {approved} approved, {len(stopped)} stopped of {len(decided)} decided"
        + (f" ({presumed} presumed stopped after 3+ years without a new trial)" if presumed else "")
        + (
            "; censored: " + ", ".join(f"{n} {s}" for s, n in sorted(censored.items()))
            if censored
            else ""
        )
    )
    if len(decided) < 3:
        notes.append("thin history: fewer than 3 decided twins")
    unknown_notes = list(dict.fromkeys(f"{p.drug}: {p.note}" for p in programs if p.note))
    notes += unknown_notes[:3]
    return TwinResult(
        match_level=level,
        programs=programs,
        decided=decided,
        prior=beta_range(approved, len(stopped), loa),
        failure_mix=failure_mix(stopped, ledger_conf),
        notes=notes,
        base=base,
    )


def _decided(programs: list[Program], floor: int) -> list[Program]:
    return [p for p in programs if p.status in ("approved", "stopped") and p.rank >= floor]
