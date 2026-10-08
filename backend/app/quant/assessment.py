"""Scoring of the efficacy and safety lanes: gathered numbers and gated claims -> risk adjustments,
a rating and a headline. Formulas only; every ratio comes from config/ledger.yaml `risk_ratios`."""

import math
import re
from dataclasses import dataclass, field
from typing import Any

from app.contracts import (
    AssessmentMetric,
    AssessmentResult,
    Range,
    RiskAdjustment,
    TranslationLink,
    TwinStats,
)
from app.sources.records import OT_RELEASE

HUMAN_STEPS = ("target_engagement", "biological_response", "patient_benefit")
OPENFDA = "U.S. FDA drug labels via openFDA"
# Open Targets drugType -> our Modality
OT_MODALITY = {
    "small molecule": "small_molecule",
    "antibody": "antibody",
    "antibody drug conjugate": "antibody",
    "oligonucleotide": "oligonucleotide",
    "gene": "gene_therapy",
    "cell": "cell_therapy",
    "protein": "biologic_other",
    "enzyme": "biologic_other",
}
_MODALITY_WORDS = (
    (
        re.compile(r"antisense|oligonucleotide|\bsirna\b|\baso\b|exon.skipping|\brnai\b", re.I),
        "oligonucleotide",
    ),
    (re.compile(r"gene therapy|gene transfer|\baav\b|gene editing|crispr", re.I), "gene_therapy"),
    (re.compile(r"\bcar.?t\b|cell therapy", re.I), "cell_therapy"),
    (re.compile(r"antibod|mab\b|nanobody", re.I), "antibody"),
    (re.compile(r"small.molecule", re.I), "small_molecule"),
)


def infer_modality(mechanism: str) -> str | None:
    """The modality the mechanism text names, if it names one."""
    return next((m for pattern, m in _MODALITY_WORDS if pattern.search(mechanism)), None)


def ot_modality(drug_type: str | None) -> str | None:
    return OT_MODALITY.get((drug_type or "").strip().lower())


@dataclass
class EfficacyInputs:
    genetic_score: float | None = None
    somatic_score: float | None = None
    cancer: bool = False
    association_score: float | None = None
    association_evidence_ids: list[str] = field(default_factory=list)
    chain: list[TranslationLink] = field(default_factory=list)
    claim_ids: list[str] = field(default_factory=list)
    twins: TwinStats | None = None
    same_target_approved: list[str] = field(default_factory=list)


@dataclass
class SafetyInputs:
    liabilities: list[str] = field(default_factory=list)
    liability_evidence_ids: list[str] = field(default_factory=list)
    same_target_approved: list[str] = field(default_factory=list)
    labels_checked: dict[str, list[str]] = field(default_factory=dict)
    boxed_warnings: dict[str, list[str]] = field(default_factory=dict)
    faers: dict[str, list[str]] = field(default_factory=dict)
    claim_ids: list[str] = field(default_factory=list)
    twins: TwinStats | None = None
    fetched: bool = True
    modality: str | None = None
    drug_modalities: dict[str, str] = field(default_factory=dict)


def _adjust(
    conf: dict[str, Any],
    key: str,
    factor: str,
    inputs: dict[str, float | int | str | None],
    claim_ids: list[str] = (),  # type: ignore[assignment]
    evidence_ids: list[str] = (),  # type: ignore[assignment]
) -> RiskAdjustment:
    entry = conf["risk_ratios"][key]
    return RiskAdjustment(
        cause=key.split(".")[0],  # type: ignore[arg-type]
        factor=factor,
        risk_ratio=Range(low=entry["low"], base=entry["base"], high=entry["high"], unit="ratio"),
        basis="sourced" if entry.get("citation") else "assumption",
        citation=entry.get("citation"),
        inputs={**inputs, "config": f"ledger.yaml risk_ratios.{key}"},
        claim_ids=list(claim_ids),
        evidence_ids=list(evidence_ids),
    )


def rating(adjustments: list[RiskAdjustment], conf: dict[str, Any], has_inputs: bool) -> str:
    if not has_inputs:
        return "unknown"
    cut = conf["assessment"]["rating_cutoffs"]
    net = math.prod(a.risk_ratio.base for a in adjustments)
    if net <= cut["strong"]:
        return "strong"
    if net <= cut["moderate"]:
        return "moderate"
    if net <= cut["weak"]:
        return "weak"
    return "concerning"


def _twin_stops(twins: TwinStats | None, category: str) -> int:
    if twins is None:
        return 0
    return sum(
        n
        for reason, n in twins.stop_reasons.items()
        if twins.stop_reason_categories.get(reason) == category
    )


def score_efficacy(
    x: EfficacyInputs, conf: dict[str, Any], produced_by: str
) -> tuple[list[RiskAdjustment], AssessmentResult]:
    adjustments: list[RiskAdjustment] = []
    metrics: list[AssessmentMetric] = []
    gaps: list[str] = []
    told: list[str] = []
    threshold = conf["assessment"]["genetic_support_min_score"]["value"]

    # in cancer the human genetic evidence for a target is somatic: driver mutations in tumours
    somatic = x.somatic_score if x.cancer else None
    kind = "somatic_mutation" if (somatic or 0) > (x.genetic_score or 0) else "genetic_association"
    genetic = max((s for s in (x.genetic_score, somatic) if s is not None), default=None)
    if x.association_score is not None or x.association_evidence_ids:
        metrics.append(
            AssessmentMetric(
                key="genetic_support",
                label=f"Human genetic support (Open Targets {kind})",
                value=genetic,
                unit="score 0-1",
                note="no genetic association evidence"
                if genetic is None
                else f"supported at >= {threshold} (our cut-off)",
                basis="sourced",
                citation=OT_RELEASE,
                evidence_ids=x.association_evidence_ids,
            )
        )
        if genetic is not None and genetic >= threshold:
            adjustments.append(
                _adjust(
                    conf,
                    "efficacy.genetic_support",
                    "human genetic support for the target-disease link",
                    {kind: round(genetic, 3), "min_score": threshold},
                    evidence_ids=x.association_evidence_ids,
                )
            )
            told.append(
                f"genetic support {genetic:.2f}"
                + (" (somatic)" if kind != "genetic_association" else "")
            )
        else:
            told.append("no human genetic support")
    else:
        gaps.append("no Open Targets association data for this target and disease")

    steps = {link.step: link for link in x.chain}
    supported = [s for s, link in steps.items() if link.status == "supported"]
    contradicted = [s for s, link in steps.items() if link.status == "contradicted"]
    if x.chain:
        metrics.append(
            AssessmentMetric(
                key="chain_supported_share",
                label="Translation steps supported in humans",
                value=round(len(supported) / 5, 2),
                unit="fraction",
                note=f"{len(supported)} of 5 supported, {len(contradicted)} contradicted",
                basis="assumption",
            )
        )
        told.append(f"{len(supported)} of 5 translation steps supported")
    if not x.chain:
        gaps.append("translation chain not assessed")
    else:
        human = [s for s in HUMAN_STEPS if s in supported]
        if contradicted:
            ids = [c for s in contradicted for c in steps[s].claim_ids]
            adjustments.append(
                _adjust(
                    conf,
                    "efficacy.contradicted_translation",
                    f"evidence contradicts the translation chain ({', '.join(contradicted)})",
                    {"contradicted_steps": len(contradicted)},
                    claim_ids=ids,
                )
            )
        if "patient_benefit" in supported:
            adjustments.append(
                _adjust(
                    conf,
                    "efficacy.human_proof_of_concept",
                    "patient benefit shown in humans",
                    {"supported_steps": len(supported)},
                    claim_ids=steps["patient_benefit"].claim_ids,
                )
            )
        elif not human and not contradicted:
            adjustments.append(
                _adjust(
                    conf,
                    "efficacy.unproven_translation",
                    "unproven translation: no human target engagement or benefit shown",
                    {"supported_steps": len(supported)},
                )
            )
            gaps.append("no human evidence of target engagement, biological response or benefit")
        exposure = steps.get("human_exposure")
        if exposure and exposure.status == "supported":
            adjustments.append(
                _adjust(
                    conf,
                    "pk_exposure.human_exposure_shown",
                    "enough drug reaches the target tissue in people",
                    {},
                    claim_ids=exposure.claim_ids,
                )
            )
        elif exposure is None or exposure.status in ("missing", "contradicted"):
            adjustments.append(
                _adjust(
                    conf,
                    "pk_exposure.no_human_exposure",
                    "no human exposure data at the target tissue",
                    {"human_exposure": exposure.status if exposure else "missing"},
                    claim_ids=exposure.claim_ids if exposure else [],
                )
            )

    twins = x.twins
    stopped_eff = _twin_stops(twins, "efficacy")
    # a base-rate prior has no programs behind it: nothing to say about precedent
    if twins is not None and twins.n_programs:
        metrics.append(
            AssessmentMetric(
                key="twin_efficacy_stops",
                label="Precedent programs stopped for efficacy",
                value=stopped_eff,
                unit="programs",
                note=f"{twins.match_level}; already counted in the prior",
                basis="sourced",
                citation=OT_RELEASE,
            )
        )
        if stopped_eff and twins.match_level != "exact_target_indication":
            adjustments.append(
                _adjust(
                    conf,
                    "efficacy.terminated_twins",
                    "same-target programs terminated for efficacy elsewhere",
                    {"stopped_for_efficacy": stopped_eff, "match_level": twins.match_level},
                )
            )
        if stopped_eff:
            told.append(f"{stopped_eff} precedent stop(s) for efficacy")
    if x.same_target_approved:
        told.append(f"{len(x.same_target_approved)} approved drug(s) on the target")

    rated = rating(adjustments, conf, bool(metrics or x.claim_ids))
    headline = f"Efficacy {rated}: " + ("; ".join(told) if told else "little usable evidence")
    return adjustments, AssessmentResult(
        cause="efficacy",
        rating=rated,  # type: ignore[arg-type]
        headline=headline,
        metrics=metrics,
        claim_ids=x.claim_ids,
        gaps=gaps,
        produced_by=produced_by,
    )


def score_safety(
    x: SafetyInputs, conf: dict[str, Any], produced_by: str
) -> tuple[list[RiskAdjustment], AssessmentResult]:
    adjustments: list[RiskAdjustment] = []
    metrics: list[AssessmentMetric] = []
    gaps: list[str] = []
    told: list[str] = []

    if x.fetched:
        metrics.append(
            AssessmentMetric(
                key="target_liabilities",
                label="Target safety liabilities",
                value=len(x.liabilities),
                unit="events",
                note=", ".join(x.liabilities[:5]) or "none recorded",
                basis="sourced",
                citation=OT_RELEASE,
                evidence_ids=x.liability_evidence_ids,
            )
        )
        told.append(f"{len(x.liabilities)} target safety liabilities")
        if x.liabilities:
            adjustments.append(
                _adjust(
                    conf,
                    "safety.target_liability",
                    "known target safety liabilities",
                    {"liabilities": len(x.liabilities)},
                    evidence_ids=x.liability_evidence_ids,
                )
            )
    else:
        gaps.append("target safety liabilities were not fetched")

    labelled = [d for d in x.same_target_approved if d in x.labels_checked]
    # an AAV gene therapy's liver warning says little about an antisense drug on the same gene
    other = [
        d for d in labelled if x.modality and x.drug_modalities.get(d) not in (None, x.modality)
    ]
    if other:
        labelled = [d for d in labelled if d not in other]
        told.append(
            "not scored, different modality: "
            + ", ".join(f"{d} ({x.drug_modalities[d]})" for d in other)
        )
    if x.labels_checked:
        boxed_ids = [i for ids in x.boxed_warnings.values() for i in ids]
        metrics.append(
            AssessmentMetric(
                key="boxed_warnings",
                label="Boxed warnings on drugs checked",
                value=len(x.boxed_warnings),
                unit="drugs",
                note=f"{len(x.labels_checked)} label(s) checked",
                basis="sourced",
                citation=OPENFDA,
                evidence_ids=boxed_ids,
            )
        )
        boxed_same = [d for d in labelled if d in x.boxed_warnings]
        if boxed_same:
            adjustments.append(
                _adjust(
                    conf,
                    "safety.boxed_warning_same_target",
                    f"boxed warning on a same-target drug ({', '.join(boxed_same)})",
                    {"drugs_with_boxed_warning": len(boxed_same)},
                    evidence_ids=[i for d in boxed_same for i in x.boxed_warnings[d]],
                )
            )
            told.append(f"boxed warning on {', '.join(boxed_same)}")
        elif labelled:
            adjustments.append(
                _adjust(
                    conf,
                    "safety.tolerated_same_target",
                    f"same-target drug approved without a boxed warning ({', '.join(labelled)})",
                    {"approved_same_target_labelled": len(labelled)},
                    evidence_ids=[i for d in labelled for i in x.labels_checked[d]],
                )
            )
            told.append(f"same-target drug approved without boxed warning ({labelled[0]})")
    elif x.fetched:
        gaps.append("no FDA label for this drug or an approved same-target drug")

    stopped_safety = _twin_stops(x.twins, "safety")
    if x.twins is not None and x.twins.n_programs:
        metrics.append(
            AssessmentMetric(
                key="twin_safety_stops",
                label="Precedent programs stopped for safety",
                value=stopped_safety,
                unit="programs",
                note=f"{x.twins.match_level}; already in the prior and the failure mix",
                basis="sourced",
                citation=OT_RELEASE,
            )
        )
        if stopped_safety:
            told.append(f"{stopped_safety} precedent stop(s) for safety")
    if not x.faers:
        gaps.append("no adverse-event report counts")

    rated = rating(adjustments, conf, bool(metrics or x.claim_ids))
    headline = f"Safety {rated}: " + ("; ".join(told) if told else "little usable evidence")
    return adjustments, AssessmentResult(
        cause="safety",
        rating=rated,  # type: ignore[arg-type]
        headline=headline,
        metrics=metrics,
        claim_ids=x.claim_ids,
        gaps=gaps,
        produced_by=produced_by,
    )
