import json
from pathlib import Path

from app.graph.spec import build_graph_spec

OUT = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "graph_spec.json"


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build_graph_spec().model_dump(mode="json"), indent=2) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
