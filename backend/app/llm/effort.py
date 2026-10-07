from pathlib import Path

import yaml

from app.contracts.program import Effort
from app.llm.types import EffortKnobs


class EffortPolicy:
    def __init__(self, knobs: dict[str, EffortKnobs]) -> None:
        self._knobs = knobs

    @classmethod
    def from_yaml(cls, path: Path) -> "EffortPolicy":
        raw = (yaml.safe_load(path.read_text()) or {}).get("effort", {})
        return cls(
            {
                name: EffortKnobs(
                    effort=name,  # type: ignore[arg-type]
                    retrieval_k=int(v["retrieval_k"]),
                    n_queries=int(v["n_queries"]),
                    max_tokens=int(v["max_tokens"]),
                    tier=str(v["tier"]),
                )
                for name, v in raw.items()
            }
        )

    def knobs(self, effort: Effort) -> EffortKnobs:
        return self._knobs[effort]
