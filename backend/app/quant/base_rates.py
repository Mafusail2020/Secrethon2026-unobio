import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

import yaml

from app.core.settings import get_settings

PHASES = ("p1", "p2", "p3", "nda")
# program stage -> index of the first transition still ahead of it
STAGE_START = {
    "discovery": 0,
    "preclinical": 0,
    "ind_enabling": 0,
    "phase1": 0,
    "phase2": 1,
    "phase3": 2,
    "filed": 3,
    "approved": 4,
}


@dataclass(frozen=True)
class BaseRates:
    area: str
    transitions: dict[str, float]
    citation: str
    note: str | None = None

    def loa(self, stage: str | None) -> float:
        """Probability of approval from the start of the stage's next clinical phase. Preclinical
        stages count from Phase I: the report has no preclinical attrition."""
        start = STAGE_START.get(stage or "phase1", 0)
        p = 1.0
        for phase in PHASES[start:]:
            p *= self.transitions[phase]
        return p


@cache
def _config(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text())


def config() -> dict[str, Any]:
    return _config(get_settings().config_dir / "base_rates.yaml")


def area_for(therapeutic_areas: list[str], disease_name: str) -> tuple[str, str | None]:
    """(report area, note). Open Targets area names first, then disease-name keywords."""
    conf = config()
    lowered = [a.lower() for a in therapeutic_areas]
    for rule in conf["area_map"]:
        if rule["match"] in lowered:
            return rule["area"], None
    for rule in conf["name_keywords"]["rules"]:
        if re.search(rule["pattern"], disease_name, re.I):
            return rule["area"], (
                f"no therapeutic area on the disease term; '{rule['area']}' inferred from its name"
                " (assumption)"
            )
    return "all", "no matching disease area; using the all-indications rates"


def base_rates(therapeutic_areas: list[str], disease_name: str) -> BaseRates:
    conf = config()
    area, note = area_for(therapeutic_areas, disease_name)
    return BaseRates(
        area=area, transitions=conf["areas"][area], citation=conf["citation"].strip(), note=note
    )


def twin_param(name: str) -> Any:
    return config()["twins"][name]
