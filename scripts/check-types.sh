#!/bin/sh
# Fails if contracts/openapi.json or frontend/src/api/types.gen.ts differ from what the models generate.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(cd "$root/backend" && uv run python scripts/export_openapi.py --out "$tmp/openapi.json")
if ! diff -q "$root/contracts/openapi.json" "$tmp/openapi.json" >/dev/null; then
  echo "contracts/openapi.json is stale: run 'make types'" >&2
  exit 1
fi

(cd "$root/frontend" && npx openapi-typescript "$tmp/openapi.json" -o "$tmp/types.gen.ts" >/dev/null)
if ! diff -q "$root/frontend/src/api/types.gen.ts" "$tmp/types.gen.ts" >/dev/null; then
  echo "frontend/src/api/types.gen.ts is stale: run 'make types'" >&2
  exit 1
fi
