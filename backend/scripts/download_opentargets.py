"""Download the Open Targets parquet datasets twin stats needs into backend/data/opentargets/.

uv run python -m scripts.download_opentargets [--dry-run] [--with-associations] [--only a,b]

Idempotent: a file is skipped when it already exists with the size the server reports.
"""

import argparse
import asyncio
import re
import sys
from pathlib import Path

import httpx

BASE_URL = "https://ftp.ebi.ac.uk/pub/databases/opentargets/platform/latest/output/"
DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "opentargets"

DATASETS = [
    "clinical_report",
    "clinical_indication",
    "clinical_target",
    "evidence_clinical_precedence",
    "disease",
    "drug_molecule",
    "drug_mechanism_of_action",
    "drug_warning",
    "target",
    "target_safety_event",
]
# ~860 MB; the per-pair genetic score is cheaper to fetch from GraphQL at run time.
OPTIONAL = ["association_by_datatype_direct"]

_HREF = re.compile(r'href="([^"?/][^"]*)"')


async def list_files(client: httpx.AsyncClient, dataset: str) -> list[tuple[str, int]]:
    url = f"{BASE_URL}{dataset}/"
    resp = await client.get(url)
    resp.raise_for_status()
    names = [n for n in _HREF.findall(resp.text) if n.endswith(".parquet")]
    out = []
    for name in names:
        head = await client.head(url + name)
        head.raise_for_status()
        out.append((name, int(head.headers.get("content-length", 0))))
    return out


async def download(client: httpx.AsyncClient, dataset: str, name: str, size: int) -> bool:
    dest = DATA_DIR / dataset / name
    if dest.exists() and dest.stat().st_size == size:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    async with client.stream("GET", f"{BASE_URL}{dataset}/{name}") as resp:
        resp.raise_for_status()
        with tmp.open("wb") as fh:
            async for chunk in resp.aiter_bytes(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)
    return True


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="only print sizes")
    parser.add_argument("--only", default="", help="comma-separated dataset names")
    parser.add_argument("--with-associations", action="store_true")
    args = parser.parse_args()
    datasets = [d for d in args.only.split(",") if d] or (
        DATASETS + (OPTIONAL if args.with_associations else [])
    )

    timeout = httpx.Timeout(60, read=300)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        listing = {d: await list_files(client, d) for d in datasets}
        total = 0
        for d, files in listing.items():
            size = sum(s for _, s in files)
            total += size
            print(f"{d:40s} {len(files):4d} files {size / 1e6:9.1f} MB")
        print(f"{'TOTAL':40s} {'':10s} {total / 1e6:9.1f} MB")
        if args.dry_run:
            return

        for d, files in listing.items():
            fetched = 0
            for name, size in files:
                fetched += await download(client, d, name, size)
            print(f"{d}: {fetched} downloaded, {len(files) - fetched} already present", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
