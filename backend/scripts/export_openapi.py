import argparse
import json
from pathlib import Path

from pydantic.json_schema import models_json_schema

from app.contracts import API_MODELS
from app.main import create_app

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"
# clients may omit defaulted fields only on these; every other model is always fully serialized
REQUEST_MODELS = {"ProgramInput", "RunOptions", "CreateRunRequest", "CorrectionRequest"}


def build_openapi() -> dict:
    schema = create_app().openapi()
    _, defs = models_json_schema(
        [(m, "validation") for m in API_MODELS], ref_template="#/components/schemas/{model}"
    )
    # models not reachable from a route (events, corrections, ...) still need TS types
    components = schema.setdefault("components", {}).setdefault("schemas", {})
    for name, model_schema in defs.get("$defs", {}).items():
        components.setdefault(name, model_schema)
    for name, model_schema in components.items():
        if name not in REQUEST_MODELS and "properties" in model_schema:
            model_schema["required"] = sorted(model_schema["properties"])
    return schema


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(build_openapi(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
