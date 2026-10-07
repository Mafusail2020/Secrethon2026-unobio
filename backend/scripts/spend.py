"""Team LLM spend so far, from the llm_calls table (uncached calls only)."""

import asyncio

from app.core.settings import get_settings
from app.store.db import Database
from app.store.llm_repo import LLMRepo


async def main() -> None:
    db = Database(get_settings().data_path / "app.db")
    await db.init()
    totals = await LLMRepo(db).spend()
    cost = totals["cost_usd"]
    print(f"calls: {totals['calls']}")
    print(f"tokens in/out: {totals['tokens_in']}/{totals['tokens_out']}")
    print(
        "cost: "
        + ("unknown (no model prices configured)" if cost is None else f"${cost:.4f}")
        + " of the $67 team budget"
    )
    await db.dispose()


if __name__ == "__main__":
    asyncio.run(main())
