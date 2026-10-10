"""Uploaded files -> evidence. A document is one user-provided source; each chunk of its text is
an evidence item whose locator names the page, so a quote can be checked against that page."""

import io
import re
from collections.abc import Callable
from dataclasses import dataclass

from pypdf import PdfReader

from app.contracts import DocumentInfo, Evidence, ProgramInput, SourceRef, utcnow
from app.contracts.ids import evidence_id, source_id
from app.sources.records import chunk_text

MAX_PAGES = 300
OCR_MAX_PAGES = 30
MAX_CHARS = 400_000
MAX_CHUNKS = 400
PART_CHARS = 3000
LANE_CHUNKS = 6
LANE_CHARS = 3500

_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{2,}")
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_COMMON = {
    *("the", "and", "for", "with", "that", "this", "from", "was", "were", "are", "not", "has"),
    *("disease", "inhibition", "inhibitor", "treatment", "patients", "study", "results", "data"),
}


class DocumentUnreadable(Exception):
    """The file is stored but no text can be taken from it; the message says why, in plain words."""


@dataclass(frozen=True)
class Page:
    label: str
    text: str


@dataclass(frozen=True)
class DocumentText:
    pages: list[Page]
    truncated: bool
    #: pages whose text came from OCR of a scan, marked "(OCR)" in their locators
    ocr_pages: int = 0
    #: scanned pages left unread because of the OCR page limit
    ocr_skipped: int = 0


Ocr = Callable[[bytes], str]
_engine: Ocr | None | bool = None


def _ocr() -> Ocr | None:
    """OCR is an optional install (the `ocr` extra); without it a scan is reported as unreadable."""
    global _engine
    if _engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError:
            _engine = False
        else:
            engine = RapidOCR()

            def recognise(data: bytes) -> str:
                found, _ = engine(data)
                return " ".join(line[1] for line in found or [])

            _engine = recognise
    return _engine or None


def use_ocr(engine: Ocr | None) -> None:
    """Swap the OCR engine (tests); None switches OCR off."""
    global _engine
    _engine = engine if engine is not None else False


def _scanned_text(page: object, ocr: Ocr) -> str:
    try:
        images = list(page.images)[:4]  # type: ignore[attr-defined]
        return _tidy(" ".join(ocr(image.data) for image in images))
    except (
        Exception
    ):  # an image the decoder or the engine cannot handle is just a page without text
        return ""


def _tidy(text: str) -> str:
    return " ".join(_HYPHEN_BREAK.sub(r"\1\2", text).split())


def _read_pdf(data: bytes) -> DocumentText:
    try:
        ocr = _ocr()
    except Exception:  # an OCR engine that fails to load leaves typed PDFs readable
        ocr = None
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise DocumentUnreadable("the PDF is password-protected")
        pages: list[Page] = []
        total = ocr_pages = ocr_skipped = 0
        truncated = len(reader.pages) > MAX_PAGES
        for number, page in enumerate(reader.pages[:MAX_PAGES], start=1):
            text, label = _tidy(page.extract_text() or ""), f"p. {number}"
            if not text and ocr is not None:
                if ocr_pages < OCR_MAX_PAGES:
                    text, label = _scanned_text(page, ocr), f"p. {number} (OCR)"
                    ocr_pages += bool(text)
                else:
                    ocr_skipped += 1
            if not text:
                continue
            total += len(text)
            pages.append(Page(label, text))
            if total >= MAX_CHARS:
                truncated = True
                break
    except DocumentUnreadable:
        raise
    # pypdf also raises IndexError, AttributeError, ZeroDivisionError... on broken files; one bad
    # upload must not take the user's notes and other files down with it
    except Exception as exc:
        raise DocumentUnreadable("the PDF could not be read") from exc
    if not pages:
        raise DocumentUnreadable(
            "the PDF has no text layer (a scan?)"
            + ("" if ocr is not None else " and OCR is not installed")
        )
    return DocumentText(pages, truncated, ocr_pages, ocr_skipped)


def _read_text(data: bytes) -> DocumentText:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DocumentUnreadable("the file is not UTF-8 text") from exc
    truncated = len(text) > MAX_CHARS
    paragraphs = [_tidy(p) for p in re.split(r"\n\s*\n", text[:MAX_CHARS])]
    parts: list[str] = []
    for paragraph in filter(None, paragraphs):
        if parts and len(parts[-1]) + len(paragraph) < PART_CHARS:
            parts[-1] = f"{parts[-1]} {paragraph}"
        else:
            parts.append(paragraph)
    if not parts:
        raise DocumentUnreadable("the file has no text")
    return DocumentText([Page(f"part {i}", p) for i, p in enumerate(parts, start=1)], truncated)


def read_document(data: bytes, kind: str) -> DocumentText:
    return _read_pdf(data) if kind == "pdf" else _read_text(data)


def document_records(
    info: DocumentInfo, text: DocumentText, entity_ids: list[str]
) -> tuple[SourceRef, list[Evidence]]:
    source = SourceRef(
        id=source_id("user_provided", f"document:{info.id}"),
        type="user_provided",
        title=f"User document: {info.name}"[:200],
        publisher="user",
        retrieved_at=utcnow(),
        identifiers={"document": info.id},
    )
    evidence: list[Evidence] = []
    for page in text.pages:
        chunks = chunk_text(page.text)
        for i, chunk in enumerate(chunks, start=1):
            locator = page.label if len(chunks) == 1 else f"{page.label} [{i}]"
            evidence.append(
                Evidence(
                    id=evidence_id(source.id, chunk, locator),
                    source_id=source.id,
                    excerpt=chunk,
                    locator=locator,
                    entity_ids=entity_ids,
                    kind="text",
                    data=None,
                )
            )
            if len(evidence) >= MAX_CHUNKS:
                return source, evidence
    return source, evidence


def _terms(program: ProgramInput) -> set[str]:
    fields = [program.indication, program.mechanism, program.drug_name, program.biomarkers]
    fields += [program.preclinical_results]
    words = (w.lower() for f in fields if f for w in _WORD.findall(f))
    return {w for w in words if w not in _COMMON}


def pick_for_lanes(
    evidence: list[Evidence],
    program: ProgramInput,
    *,
    limit: int = LANE_CHUNKS,
    chars: int = LANE_CHARS,
) -> list[str]:
    """The few chunks the analysis lanes are handed outright: the ones that mention what the
    program is about, best first, within a character budget. All chunks stay searchable."""
    terms = _terms(program)

    def score(e: Evidence) -> int:
        return len(terms & {w.lower() for w in _WORD.findall(e.excerpt)})

    ranked = sorted(enumerate(evidence), key=lambda pair: (-score(pair[1]), pair[0]))
    picked: list[str] = []
    used = 0
    for _, e in ranked:
        if len(picked) >= limit or used + len(e.excerpt) > chars:
            continue
        picked.append(e.id)
        used += len(e.excerpt)
    return picked
