import asyncio
from dataclasses import dataclass, field
from typing import Any

from app.contracts import Evidence, NodeSpec, SourceRef
from app.core.documents import DocumentStore
from app.core.settings import get_settings
from app.graph.state import GraphState
from app.nodes._data import (
    client,
    correction_links,
    entity_ids,
    force_refresh,
    register,
    summary,
)
from app.nodes._fixture import excluded_ids, nap, register_fixture_sources
from app.nodes.base import NodeContext
from app.sources.base import SourceError
from app.sources.documents import (
    DocumentUnreadable,
    document_records,
    pick_for_lanes,
    read_document,
)
from app.sources.records import user_records
from app.sources.web import WebClient

SPEC = NodeSpec(
    id="ingest_user_input",
    label="User input",
    kind="data",
    phase="fetch",
    description="Turns user notes, links and preclinical data into user-provided evidence.",
    reads=["program", "entities"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)


LINK_TEXT_MAX = 6000


@dataclass
class DocumentsRead:
    records: list[tuple[SourceRef, list[Evidence]]] = field(default_factory=list)
    #: ids of the chunks the lanes are handed outright
    picks: list[str] = field(default_factory=list)
    #: names of files that could not be read
    unread: list[str] = field(default_factory=list)
    #: document id -> the source made from it and how many chunks it gave
    read: dict[str, dict[str, Any]] = field(default_factory=dict)

    def facts(self) -> dict[str, Any]:
        return summary(documents_read=self.read, documents_unread=self.unread)


async def read_documents(state: GraphState, ctx: NodeContext) -> DocumentsRead:
    """The files the run was given, as evidence chunks with page locators."""
    program = state["program"]
    store = DocumentStore(get_settings().data_path / "documents")
    ids = entity_ids(state.get("entities"))
    excluded = excluded_ids(state)
    out = DocumentsRead()
    chunks: list[Evidence] = []
    for document_id in program.document_ids:
        stored = store.get(document_id)
        if stored is None:
            ctx.log(f"uploaded document {document_id} is missing; skipped", "warn")
            out.unread.append(document_id)
            continue
        name = stored.info.name
        try:
            # OCR of a long scan takes seconds a page; keep the event loop free meanwhile
            text = await asyncio.to_thread(read_document, stored.read(), stored.info.kind)
        except (DocumentUnreadable, OSError) as exc:
            # an OSError names the server's own path; the run log is shown to the user
            reason = exc if isinstance(exc, DocumentUnreadable) else "the file could not be opened"
            ctx.log(f"{name}: {reason}; not used as evidence", "warn")
            out.unread.append(name)
            continue
        source, items = document_records(stored.info, text, ids)
        ctx.log(f"{name}: {len(text.pages)} pages or parts, {len(items)} evidence chunks")
        if text.truncated:
            ctx.log(f"{name} is long; only the start was read", "warn")
        if text.ocr_pages:
            ctx.log(f"{name}: read {text.ocr_pages} scanned page(s) with OCR; expect some errors")
        if text.ocr_skipped:
            ctx.log(f"{name}: {text.ocr_skipped} scanned page(s) skipped (OCR limit)", "warn")
        out.records.append((source, items))
        out.read[document_id] = {"source_id": source.id, "name": name, "chunks": len(items)}
        chunks += [e for e in items if e.id not in excluded]
    # one budget for all files together: the lanes' prompts are small, and every chunk stays searchable
    out.picks = pick_for_lanes(chunks, program)
    return out


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    web = client(ctx, "web", WebClient)
    if web is None:
        return await _fixture_run(state, ctx)
    program, fr = state["program"], force_refresh(state)
    ids = entity_ids(state.get("entities"))
    corrections = ctx.corrections_for()

    texts = [
        ("notes", "User notes", program.notes),
        ("preclinical_results", "User-provided preclinical results", program.preclinical_results),
        ("biomarkers", "User-provided biomarkers", program.biomarkers),
        ("route", "User-provided route of administration", program.route),
    ]
    texts += [
        (f"correction:{c.id}", "User note added by a correction", c.add_notes)
        for c in corrections
        if c.add_notes
    ]
    own_texts = [(loc, title, text) for loc, title, text in texts if text and text.strip()]
    records: list[tuple[SourceRef, list[Evidence]]] = [
        user_records(text.strip(), locator, ids, title=title) for locator, title, text in own_texts
    ]

    links = list(dict.fromkeys([str(u) for u in program.links] + correction_links(ctx)))
    unread: list[str] = []
    for url in links:
        try:
            page = await web.fetch_text(url, force_refresh=fr)
        except SourceError as exc:
            ctx.log(f"could not fetch {url}: {exc}", "warn")
            unread.append(url)
            continue
        if not page or not page.get("text"):
            reason = (page or {}).get("content_type") or "no text"
            ctx.log(f"{url}: nothing readable ({reason}); not used as evidence", "warn")
            unread.append(url)
            continue
        title = page.get("title") or url
        records.append(
            user_records(
                page["text"][:LINK_TEXT_MAX],
                "page text" + (" (truncated)" if page.get("truncated") else ""),
                ids,
                url=url,
                title=f"User link: {title}"[:200],
            )
        )

    docs = await read_documents(state, ctx)
    records += docs.records
    if not records:
        ctx.log("no user-provided material")
        return {"scratch": {ctx.node_id: docs.facts()}} if docs.facts() else {}
    n_sources, n_evidence = await register(ctx, state, records)
    ctx.log(f"registered {n_sources} user-provided source(s), {n_evidence} evidence item(s)")
    # the program's own data rarely shares words with the analysts' search queries, so the lanes
    # and cases are handed it directly instead of hoping retrieval finds it
    excluded = excluded_ids(state)
    own = [e.id for _, items in records[: len(own_texts)] for e in items if e.id not in excluded]
    facts = {**summary(program_evidence_ids=own + docs.picks, links_unread=unread), **docs.facts()}
    return {"scratch": {ctx.node_id: facts}} if facts else {}


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    program = state["program"]
    added = [c for c in ctx.corrections_for() if c.add_notes or c.add_links]
    await nap(ctx.node_id)
    docs = await read_documents(state, ctx)
    if docs.records:
        n_sources, n_evidence = await register(ctx, state, docs.records)
        ctx.log(f"registered {n_sources} document source(s), {n_evidence} evidence item(s)")
    result: dict[str, Any] = {"scratch": {ctx.node_id: docs.facts()}} if docs.facts() else {}
    if not (program.notes or program.links or program.preclinical_results or added):
        if not docs.records:
            ctx.log("no user-provided material")
        return result
    ctx.log("turning user notes, links and results into user-provided evidence")
    sources, evidence = await register_fixture_sources(ctx, state, "user_provided")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return result
