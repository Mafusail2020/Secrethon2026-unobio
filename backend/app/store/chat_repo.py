from sqlalchemy import func, select

from app.contracts import ChatMessage, utcnow
from app.store.db import Database
from app.store.tables import ChatMessageRow


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
                    cited_claim_ids=message.cited_claim_ids,
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
            return [
                ChatMessage(
                    role=r.role,
                    content=r.content,
                    run_id=r.run_id,
                    cited_claim_ids=r.cited_claim_ids,
                )  # type: ignore[arg-type]
                for r in rows
            ]

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
