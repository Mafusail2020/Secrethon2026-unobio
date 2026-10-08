from typing import Any

from app.contracts import Evidence, NodeSpec, SourceRef
from app.graph.state import GraphState
from app.nodes._data import client, correction_links, entity_ids, force_refresh, register
from app.nodes._fixture import nap, register_fixture_sources
from app.nodes.base import NodeContext
from app.sources.base import SourceError
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
    records: list[tuple[SourceRef, list[Evidence]]] = [
        user_records(text.strip(), locator, ids, title=title)
        for locator, title, text in texts
        if text and text.strip()
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

    if not records:
        ctx.log("no user-provided material")
        return {}
    n_sources, n_evidence = await register(ctx, state, records)
    ctx.log(f"registered {n_sources} user-provided source(s), {n_evidence} evidence item(s)")
    return {"scratch": {ctx.node_id: {"links_unread": unread}}} if unread else {}


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    program = state["program"]
    added = [c for c in ctx.corrections_for() if c.add_notes or c.add_links]
    await nap(ctx.node_id)
    if not (program.notes or program.links or program.preclinical_results or added):
        ctx.log("no user-provided material")
        return {}
    ctx.log("turning user notes, links and results into user-provided evidence")
    sources, evidence = await register_fixture_sources(ctx, state, "user_provided")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
