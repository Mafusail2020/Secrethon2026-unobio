from typing import Any

from pydantic import BaseModel


def compact(value: Any) -> Any:
    """Small JSON-safe view of node inputs and outputs for the UI."""
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    if isinstance(value, str):
        return value if len(value) <= 300 else value[:300] + "…"
    if isinstance(value, dict):
        out = {str(k): compact(v) for k, v in list(value.items())[:20]}
        if len(value) > 20:
            out["…"] = f"{len(value) - 20} more"
        return out
    if isinstance(value, list | tuple | set):
        seq = list(value)
        out_list = [compact(v) for v in seq[:5]]
        if len(seq) > 5:
            out_list.append(f"… {len(seq) - 5} more")
        return out_list
    return value
