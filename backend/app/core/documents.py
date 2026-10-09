import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

from app.contracts import DocumentInfo

MAX_BYTES = 10_000_000
KINDS = {".pdf": "pdf", ".txt": "text", ".md": "text"}


class DocumentError(ValueError):
    """The upload cannot be kept; `code` is the API error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class StoredDocument:
    info: DocumentInfo
    path: Path

    def read(self) -> bytes:
        return self.path.read_bytes()


def _kind_of(name: str, data: bytes) -> str:
    kind = KINDS.get(Path(name).suffix.lower())
    if kind is None:
        raise DocumentError("unsupported_document", "only PDF, TXT and MD files are accepted")
    if kind == "pdf" and not data[:1024].lstrip().startswith(b"%PDF-"):
        raise DocumentError("invalid_document", f"{name} is not a PDF file")
    if kind == "text":
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise DocumentError("invalid_document", f"{name} is not UTF-8 text") from exc
        if b"\x00" in data:
            raise DocumentError("invalid_document", f"{name} is not a text file")
    return kind


def _clean_name(name: str) -> str:
    # the name is shown and cited, never used as a path
    cleaned = "".join(ch for ch in Path(name.replace("\\", "/")).name if ch.isprintable()).strip()
    return cleaned[:200]


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


class DocumentStore:
    """Uploaded files, content-addressed: the same bytes are one document, whatever the name."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def save(self, name: str, data: bytes) -> DocumentInfo:
        name = _clean_name(name)
        if not name:
            raise DocumentError("invalid_document", "the file has no name")
        if not data:
            raise DocumentError("invalid_document", f"{name} is empty")
        if len(data) > MAX_BYTES:
            raise DocumentError("document_too_large", f"{name} is over {MAX_BYTES // 1_000_000} MB")
        kind = _kind_of(name, data)
        info = DocumentInfo(
            id=f"doc_{hashlib.sha256(data).hexdigest()[:16]}",
            name=name,
            kind=kind,  # type: ignore[arg-type]
            size_bytes=len(data),
        )
        self.root.mkdir(parents=True, exist_ok=True)
        self._write(self.root / f"{info.id}.bin", data)
        self._write(self.root / f"{info.id}.json", info.model_dump_json().encode())
        return info

    def get(self, document_id: str) -> StoredDocument | None:
        meta, blob = self.root / f"{document_id}.json", self.root / f"{document_id}.bin"
        if not (meta.is_file() and blob.is_file()):
            return None
        try:
            return StoredDocument(DocumentInfo.model_validate(json.loads(meta.read_text())), blob)
        except (ValueError, OSError):
            return None

    def prune(self, keep: set[str], older_than_s: float, now: float | None = None) -> list[str]:
        """Delete files no run names that were last written more than `older_than_s` ago. An upload
        is written again whenever the same bytes are uploaded, so a file about to be used stays."""
        cutoff = (now if now is not None else time.time()) - older_than_s
        removed: list[str] = []
        if not self.root.is_dir():
            return removed
        for meta in self.root.glob("doc_*.json"):
            document_id = meta.stem
            blob = self.root / f"{document_id}.bin"
            if document_id in keep or max(_mtime(meta), _mtime(blob)) > cutoff:
                continue
            for path in (blob, meta):
                path.unlink(missing_ok=True)
            removed.append(document_id)
        return removed

    @staticmethod
    def _write(path: Path, data: bytes) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
