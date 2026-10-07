from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.store.db import Base, UTCDateTime


class RunRow(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String)
    program: Mapped[dict[str, Any]] = mapped_column(JSON)
    options: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    parent_run_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    correction_id: Mapped[str | None] = mapped_column(String, nullable=True)
    decision: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


class RunEventRow(Base):
    __tablename__ = "run_events"

    run_id: Mapped[str] = mapped_column(String, primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime)
    type: Mapped[str] = mapped_column(String)
    node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)


class NodeExecutionRow(Base):
    __tablename__ = "node_executions"

    run_id: Mapped[str] = mapped_column(String, primary_key=True)
    node_id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    input_summary: Mapped[dict[str, Any]] = mapped_column(JSON)
    output: Mapped[dict[str, Any]] = mapped_column(JSON)
    log: Mapped[list[Any]] = mapped_column(JSON)
    source_ids: Mapped[list[str]] = mapped_column(JSON)
    llm_calls: Mapped[list[Any]] = mapped_column(JSON)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    correction_ids: Mapped[list[str]] = mapped_column(JSON)
    # full JSON-serialised state delta; `output` is only the compact UI view
    state_delta: Mapped[dict[str, Any]] = mapped_column(JSON)


class CorrectionRow(Base):
    __tablename__ = "corrections"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    run_id: Mapped[str] = mapped_column(String, index=True)
    node_id: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    exclude_evidence_ids: Mapped[list[str]] = mapped_column(JSON)
    add_links: Mapped[list[str]] = mapped_column(JSON)
    add_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class LLMCallRow(Base):
    __tablename__ = "llm_calls"
    __table_args__ = (Index("ix_llm_calls_run", "run_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String)
    node_id: Mapped[str] = mapped_column(String)
    model: Mapped[str] = mapped_column(String)
    purpose: Mapped[str] = mapped_column(String)
    tokens_in: Mapped[int] = mapped_column(Integer)
    tokens_out: Mapped[int] = mapped_column(Integer)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    cached: Mapped[bool] = mapped_column(Boolean)
    latency_ms: Mapped[int] = mapped_column(Integer)
    ts: Mapped[datetime] = mapped_column(UTCDateTime)


class LLMCacheRow(Base):
    __tablename__ = "llm_cache"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    model: Mapped[str] = mapped_column(String)
    response: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
