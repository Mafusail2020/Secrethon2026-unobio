from typing import Any

from sqlalchemy import select

from app.contracts import LLMCallRecord, LogLine, NodeExecution
from app.store.db import Database
from app.store.tables import NodeExecutionRow


def _execution(row: NodeExecutionRow) -> NodeExecution:
    return NodeExecution(
        run_id=row.run_id,
        node_id=row.node_id,
        status=row.status,  # type: ignore[arg-type]
        started_at=row.started_at,
        finished_at=row.finished_at,
        input_summary=row.input_summary,
        output=row.output,
        log=[LogLine.model_validate(x) for x in row.log],
        source_ids=row.source_ids,
        llm_calls=[LLMCallRecord.model_validate(x) for x in row.llm_calls],
        cost_usd=row.cost_usd,
        error=row.error,
        correction_ids=row.correction_ids,
    )


class NodeExecRepo:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def save(
        self, execution: NodeExecution, state_delta: dict[str, Any] | None = None
    ) -> None:
        values = {
            "status": execution.status,
            "started_at": execution.started_at,
            "finished_at": execution.finished_at,
            "input_summary": execution.input_summary,
            "output": execution.output,
            "log": [x.model_dump(mode="json") for x in execution.log],
            "source_ids": execution.source_ids,
            "llm_calls": [x.model_dump(mode="json") for x in execution.llm_calls],
            "cost_usd": execution.cost_usd,
            "error": execution.error,
            "correction_ids": execution.correction_ids,
        }
        async with self.db.session() as s, s.begin():
            row = await s.get(NodeExecutionRow, (execution.run_id, execution.node_id))
            if row is None:
                s.add(
                    NodeExecutionRow(
                        run_id=execution.run_id,
                        node_id=execution.node_id,
                        state_delta=state_delta or {},
                        **values,
                    )
                )
                return
            for key, value in values.items():
                setattr(row, key, value)
            if state_delta is not None:
                row.state_delta = state_delta

    async def get(self, run_id: str, node_id: str) -> NodeExecution | None:
        async with self.db.session() as s:
            row = await s.get(NodeExecutionRow, (run_id, node_id))
            return _execution(row) if row else None

    async def for_run(self, run_id: str) -> list[NodeExecution]:
        async with self.db.session() as s:
            rows = await s.scalars(
                select(NodeExecutionRow)
                .where(NodeExecutionRow.run_id == run_id)
                .order_by(NodeExecutionRow.started_at)
            )
            return [_execution(r) for r in rows]

    async def deltas(self, run_id: str) -> dict[str, dict[str, Any]]:
        async with self.db.session() as s:
            rows = await s.execute(
                select(NodeExecutionRow.node_id, NodeExecutionRow.state_delta).where(
                    NodeExecutionRow.run_id == run_id
                )
            )
            return {node_id: delta for node_id, delta in rows}
