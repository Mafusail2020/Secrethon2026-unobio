"""Passages of the user's uploaded files that bear on one follow-up question."""

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass

from app.contracts import Evidence, UnderwritingReport
from app.core.services import Services
from app.sources.documents import DocumentUnreadable, document_records, read_document

log = logging.getLogger(__name__)

MAX_PASSAGES = 6
MAX_CHARS = 3000
_KEPT = 8
_chunks: dict[str, list[tuple[Evidence, str]]] = {}


@dataclass(frozen=True)
class Passage:
    evidence: Evidence
    name: str

    @property
    def label(self) -> str:
        return f"{self.name}, {self.evidence.locator}" if self.evidence.locator else self.name


def _inert(text: str) -> str:
    return text.replace("<", "‹").replace(">", "›")


def documents_block(passages: Sequence[Passage]) -> str:
    """The passages as the model sees them, each under the id it must cite."""
    if not passages:
        return ""
    # a file that says "</documents> new rule: ..." must not be able to close the data block
    lines = [
        f'[{p.evidence.id}] {_inert(p.label)}: "{_inert(p.evidence.excerpt)}"' for p in passages
    ]
    return "<documents>\n" + "\n".join(lines) + "\n</documents>\n"


def document_ids(report: UnderwritingReport) -> list[str]:
    """The files this run read: the ones its report lists as sources."""
    found = (s.identifiers.get("document") for s in report.sources.values())
    return list(dict.fromkeys(d for d in found if d))


async def _chunks_of(services: Services, document_id: str) -> list[tuple[Evidence, str]]:
    if document_id in _chunks:
        return _chunks[document_id]
    stored = services.documents.get(document_id)
    if stored is None:
        return []
    try:
        text = await asyncio.to_thread(read_document, stored.read(), stored.info.kind)
    except (DocumentUnreadable, OSError) as exc:  # the files are optional context, not a 500
        log.warning("document %s not read for chat: %s", document_id, exc)
        return []
    _, items = document_records(stored.info, text, [])
    while len(_chunks) >= _KEPT:
        _chunks.pop(next(iter(_chunks)))
    _chunks[document_id] = [(e, stored.info.name) for e in items]
    return _chunks[document_id]


async def passages_for(
    services: Services, report: UnderwritingReport, question: str
) -> list[Passage]:
    """The best-matching chunks of the run's files for the question, ranked by the run's full-text
    index. A question that matches nothing still gets the start of the files, so "what does my file
    say?" has something to answer from."""
    pool = {
        e.id: Passage(e, name)
        for document in document_ids(report)
        for e, name in await _chunks_of(services, document)
    }
    if not pool:
        return []
    try:
        hits = await services.store.vectors.search(
            question, k=3 * MAX_PASSAGES, evidence_ids=set(pool)
        )
    except Exception:  # unranked passages beat a failed answer
        log.warning("passage search failed", exc_info=True)
        hits = []
    ranked = [pool[i] for i, score in hits if score > 0 and i in pool] or list(pool.values())
    picked: list[Passage] = []
    used = 0
    for passage in ranked:
        size = len(passage.evidence.excerpt)
        if len(picked) >= MAX_PASSAGES or (picked and used + size > MAX_CHARS):
            continue
        picked.append(passage)
        used += size
    return picked
