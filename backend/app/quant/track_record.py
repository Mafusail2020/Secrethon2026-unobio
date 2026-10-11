from app.contracts import TwinStats


def track_record(twin: TwinStats | None) -> tuple[int, int]:
    """(approved, decided) among the twins the prior counts. The shown twins are a sample that
    lists stopped ones first, so they are counted only for reports stored without the totals."""
    if twin is None:
        return 0, 0
    if twin.n_decided is not None:
        return twin.n_approved or 0, twin.n_decided
    shown = [t for t in twin.twins if t.status in ("approved", "stopped")]
    return sum(t.status == "approved" for t in shown), len(shown)
