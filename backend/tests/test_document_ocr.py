import base64
import re

import pytest

from app.sources import documents
from app.sources.documents import DocumentUnreadable, document_records, read_document, use_ocr
from tests.test_document_ingest import PAGES, make_pdf

# a 1x1 grey JPEG: the page image of a scan, which the fake engine "reads" whatever it holds
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcp"
    "LDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgED"
    "AwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RF"
    "RkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJ"
    "ytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APf6/9k="
)


def scan_pdf(pages: list[str | None]) -> bytes:
    """A PDF whose pages are text (a string) or an image with no text layer (None)."""
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        4: (
            b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray "
            b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % len(JPEG)
        )
        + JPEG
        + b"\nendstream",
    }
    kids = []
    for i, text in enumerate(pages):
        page_no, content_no = 5 + 2 * i, 6 + 2 * i
        kids.append(f"{page_no} 0 R")
        drawing = (
            f"BT /F1 11 Tf 40 700 Td ({text}) Tj ET" if text else "q 612 0 0 792 0 0 cm /Im1 Do Q"
        )
        stream = drawing.encode()
        objects[page_no] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_no} 0 R "
            "/Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> >>"
        ).encode()
        objects[content_no] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        )
    objects[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>".encode()
    out, offsets = b"%PDF-1.4\n", {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offsets[n]:010d} 00000 n \n".encode() for n in sorted(objects))
    trailer = f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
    out += trailer.encode()
    return out


@pytest.fixture(autouse=True)
def _fresh_engine():
    yield
    documents._engine = None


def test_a_scanned_page_is_read_with_ocr_and_marked_so_in_its_locator():
    use_ocr(lambda data: "Abeta42 fell 62 percent in mice.")
    text = read_document(scan_pdf([None]), "pdf")
    assert [(p.label, p.text) for p in text.pages] == [
        ("p. 1 (OCR)", "Abeta42 fell 62 percent in mice.")
    ]
    assert text.ocr_pages == 1 and text.ocr_skipped == 0


def test_a_mixed_document_keeps_real_text_as_it_is_and_only_scans_the_pages_without_any():
    use_ocr(lambda data: "scanned words")
    text = read_document(scan_pdf(["typed words", None, "more typed words"]), "pdf")
    assert [p.label for p in text.pages] == ["p. 1", "p. 2 (OCR)", "p. 3"]
    assert [p.text for p in text.pages] == ["typed words", "scanned words", "more typed words"]
    from app.contracts import DocumentInfo

    info = DocumentInfo(id="doc_0123456789abcdef", name="m.pdf", kind="pdf", size_bytes=1)
    _, items = document_records(info, text, [])
    assert [e.locator for e in items] == ["p. 1", "p. 2 (OCR)", "p. 3"]


def test_without_an_ocr_engine_a_scan_is_unreadable_and_says_why():
    use_ocr(None)
    with pytest.raises(DocumentUnreadable, match="no text layer.*OCR is not installed"):
        read_document(scan_pdf([None, None]), "pdf")


def test_a_page_the_engine_finds_nothing_on_is_skipped_like_a_blank_one():
    use_ocr(lambda data: "")
    with pytest.raises(DocumentUnreadable, match="no text layer"):
        read_document(scan_pdf([None]), "pdf")


def test_a_long_scan_is_read_only_up_to_the_page_limit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(documents, "OCR_MAX_PAGES", 2)
    use_ocr(lambda data: "page text")
    text = read_document(scan_pdf([None] * 5), "pdf")
    assert text.ocr_pages == 2 and text.ocr_skipped == 3 and len(text.pages) == 2


def test_an_engine_that_fails_on_a_page_does_not_fail_the_document():
    calls = []

    def flaky(data: bytes) -> str:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("model crashed")
        return "second page text"

    use_ocr(flaky)
    text = read_document(scan_pdf([None, None]), "pdf")
    assert [p.label for p in text.pages] == ["p. 2 (OCR)"]


def test_text_pdfs_never_call_the_engine():
    def boom(data: bytes) -> str:
        raise AssertionError("OCR must not run on a page that has text")

    use_ocr(boom)
    assert read_document(make_pdf(PAGES), "pdf").ocr_pages == 0


def test_the_real_engine_reads_a_rendered_scan():
    pytest.importorskip("rapidocr_onnxruntime")
    image_lib = pytest.importorskip("PIL.Image")
    draw_lib = pytest.importorskip("PIL.ImageDraw")
    font_lib = pytest.importorskip("PIL.ImageFont")
    import io

    sheet = image_lib.new("L", (1700, 700), 255)
    try:
        font = font_lib.truetype("/System/Library/Fonts/Helvetica.ttc", 34)
    except OSError:
        pytest.skip("no system font to render the scan with")
    draw_lib.Draw(sheet).text(
        (60, 80), "Brain Abeta42 fell 62 percent in mice treated at 10 mg/kg.", fill=0, font=font
    )
    buf = io.BytesIO()
    sheet.save(buf, "PDF", resolution=150)
    documents._engine = None
    text = read_document(buf.getvalue(), "pdf")
    words = set(re.findall(r"[a-z0-9]+", text.pages[0].text.lower()))
    assert text.pages[0].label == "p. 1 (OCR)" and {"abeta42", "62", "mice"} <= words
