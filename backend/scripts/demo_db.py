"""A clean data dir for the demo: only the named runs, with the LLM and source caches kept, so a
replay of a demo case on stage costs nothing. The working app.db is only read.

    uv run python -m scripts.demo_db run_a run_b ...   # writes backend/data/demo
    DATA_DIR=backend/data/demo make dev
"""

import shutil
import sqlite3
import sys

from app.core.settings import get_settings

RUN_TABLES = (
    "run_events",
    "node_executions",
    "corrections",
    "llm_calls",
    "chat_messages",
    "run_decks",
    "run_summaries",
)


def main(keep: list[str]) -> None:
    if not keep:
        sys.exit("name the runs to keep, e.g. run_33228d7227d2 run_4064d1719d63")
    source = get_settings().data_path
    target = source / "demo"
    target.mkdir(parents=True, exist_ok=True)
    db = target / "app.db"
    for leftover in (db, target / "app.db-wal", target / "app.db-shm"):
        leftover.unlink(missing_ok=True)
    # the backup API copies a consistent snapshot, WAL included
    with sqlite3.connect(source / "app.db") as src, sqlite3.connect(db) as dst:
        src.backup(dst)
    with sqlite3.connect(db) as con:
        found = {r[0] for r in con.execute("SELECT id FROM runs")}
        missing = [r for r in keep if r not in found]
        if missing:
            sys.exit(f"not in app.db: {', '.join(missing)}")
        marks = ",".join("?" * len(keep))
        for table in RUN_TABLES:
            con.execute(f"DELETE FROM {table} WHERE run_id NOT IN ({marks})", keep)
        con.execute(f"DELETE FROM runs WHERE id NOT IN ({marks})", keep)
        # a kept run must not point at a parent that is gone
        orphan = f"UPDATE runs SET parent_run_id = NULL WHERE parent_run_id NOT IN ({marks})"
        con.execute(orphan, keep)
        con.commit()
        con.execute("VACUUM")
        print(f"{con.execute('SELECT count(*) FROM runs').fetchone()[0]} runs kept in {db}")
    ot = target / "opentargets"
    if not ot.exists():
        shutil.copytree(source / "opentargets", ot)
        print(f"copied Open Targets files to {ot}")


if __name__ == "__main__":
    main(sys.argv[1:])
