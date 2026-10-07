import hashlib
import re


def _digest(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def source_id(source_type: str, canonical: str) -> str:
    """canonical = the source's stable external id (nct, pmid, doi, ...) or its normalized url."""
    return f"src_{_digest(source_type, _norm(canonical))}"


def evidence_id(source: str, excerpt: str, locator: str | None = None) -> str:
    return f"ev_{_digest(source, locator or '', _norm(excerpt))}"


def claim_id(produced_by: str, text: str) -> str:
    return f"clm_{_digest(produced_by, _norm(text))}"
