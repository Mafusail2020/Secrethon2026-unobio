from pathlib import Path

import yaml

from app.contracts import ModelInfo


class ModelRegistry:
    def __init__(self, models: list[ModelInfo], default_override: str = "") -> None:
        self._models = {m.id: m for m in models}
        self._yaml_default = next((m.id for m in models if m.default), None)
        self._override = default_override

    @classmethod
    def from_yaml(cls, path: Path, default_override: str = "") -> "ModelRegistry":
        raw = yaml.safe_load(path.read_text()) or {}
        models = [
            ModelInfo(
                id=m["id"],
                label=m.get("label", m["id"]),
                tier=m.get("tier", "unknown"),
                price_in_per_mtok=m.get("price_in_per_mtok"),
                price_out_per_mtok=m.get("price_out_per_mtok"),
                available=True,
                default=bool(m.get("default", False)),
            )
            for m in raw.get("models", [])
        ]
        return cls(models, default_override)

    def apply_gateway_models(self, gateway_ids: set[str]) -> None:
        """Mark configured models by gateway availability; extra gateway models get tier unknown."""
        for model_id, model in list(self._models.items()):
            self._models[model_id] = model.model_copy(update={"available": model_id in gateway_ids})
        for model_id in sorted(gateway_ids - set(self._models)):
            self._models[model_id] = ModelInfo(
                id=model_id, label=model_id, tier="unknown", available=True
            )

    def get(self, model_id: str) -> ModelInfo | None:
        return self._models.get(model_id)

    @staticmethod
    def _price(model: ModelInfo) -> float | None:
        if model.price_in_per_mtok is None or model.price_out_per_mtok is None:
            return None
        return model.price_in_per_mtok + model.price_out_per_mtok

    def _cheapest(self, models: list[ModelInfo]) -> str | None:
        priced = [(self._price(m), m.id) for m in models if self._price(m) is not None]
        if priced:
            return min(priced)[1]  # type: ignore[type-var]
        return None

    def default_id(self) -> str:
        if self._override:
            return self._override
        available = [m for m in self._models.values() if m.available]
        cheapest = self._cheapest(available)
        if cheapest:
            return cheapest
        if self._yaml_default and self._models[self._yaml_default].available:
            return self._yaml_default
        if available:
            return available[0].id
        raise RuntimeError("no available models; check config/models.yaml and the gateway")

    def for_run(self, requested: str | None) -> str:
        """The model a run asked for while it is still available, else the default."""
        model = self._models.get(requested or "")
        return model.id if model and model.available else self.default_id()

    def pick(self, tier: str) -> str:
        """Cheapest available model of the tier, else the registry default."""
        if self._override:
            return self._override
        in_tier = [m for m in self._models.values() if m.available and m.tier == tier]
        return self._cheapest(in_tier) or (in_tier[0].id if in_tier else self.default_id())

    def infos(self) -> list[ModelInfo]:
        default = self.default_id()
        return [m.model_copy(update={"default": m.id == default}) for m in self._models.values()]

    def cost(self, model_id: str, tokens_in: int, tokens_out: int) -> float | None:
        model = self._models.get(model_id)
        if model is None or self._price(model) is None:
            return None
        return (
            tokens_in * model.price_in_per_mtok + tokens_out * model.price_out_per_mtok  # type: ignore[operator]
        ) / 1_000_000
