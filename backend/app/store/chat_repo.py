from sqlalchemy import func, select

from app.contracts import ChatMessage, utcnow
from app.store.db import Database
from app.store.tables import ChatMessageRow, RunSummaryRow

EVIDENCE_PREFIX = "ev_"


def _split(cited: list[str]) -> tuple[list[str], list[str]]:
    """Passage ids ride in the same JSON column as claim ids, told apart by their prefix: databases
    already hold the demo runs, and there is no migration step to add a column."""
    evidence = [i for i in cited if i.startswith(EVIDENCE_PREFIX)]
    return [i for i in cited if not i.startswith(EVIDENCE_PREFIX)], evidence


class ChatRepo:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def add(self, run_id: str, message: ChatMessage) -> None:
        async with self.db.session() as s, s.begin():
            s.add(
                ChatMessageRow(
                    run_id=run_id,
                    role=message.role,
                    content=message.content,
                    cited_claim_ids=[*message.cited_claim_ids, *message.cited_evidence_ids],
                    ts=utcnow(),
                )
            )

    async def list(self, run_id: str) -> list[ChatMessage]:
        async with self.db.session() as s:
            rows = await s.scalars(
                select(ChatMessageRow)
                .where(ChatMessageRow.run_id == run_id)
                .order_by(ChatMessageRow.id)
            )
            out = []
            for r in rows:
                claims, evidence = _split(r.cited_claim_ids)
                out.append(
                    ChatMessage(
                        role=r.role,  # type: ignore[arg-type]
                        content=r.content,
                        run_id=r.run_id,
                        cited_claim_ids=claims,
                        cited_evidence_ids=evidence,
                    )
                )
            return out

    async def count_questions(self, run_id: str) -> int:
        async with self.db.session() as s:
            return (
                await s.scalar(
                    select(func.count()).where(
                        ChatMessageRow.run_id == run_id, ChatMessageRow.role == "user"
                    )
                )
                or 0
            )

    async def get_summary(self, run_id: str) -> ChatMessage | None:
        async with self.db.session() as s:
            row = await s.get(RunSummaryRow, run_id)
            if row is None:
                return None
            return ChatMessage(
                role="assistant",
                content=row.content,
                run_id=row.run_id,
                cited_claim_ids=row.cited_claim_ids,
            )

    async def put_summary(self, run_id: str, message: ChatMessage) -> None:
        async with self.db.session() as s, s.begin():
            s.add(
                RunSummaryRow(
                    run_id=run_id,
                    content=message.content,
                    cited_claim_ids=message.cited_claim_ids,
                    ts=utcnow(),
                )
            )
