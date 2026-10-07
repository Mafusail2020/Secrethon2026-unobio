# Unobio Underwriting

Secrethon 2026, Unobio track. A drug-program underwriting system: give it an indication and a mechanism or target, and
it researches public evidence and answers whether the program will work in humans, get through trials and regulators,
get used, and be worth funding to the next milestone. Output is Invest / Conditional / Do Not Invest plus a report
with drill-down from recommendation to claims to evidence to sources.

Concept for Unobio, not affiliated. Design and decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status

Walking skeleton (PR 1a and 1b): the whole pipeline runs end to end with streaming, corrections and a UI. Node bodies are
fixture-driven stubs, so reports are synthetic and say so (`FIXTURE:` text, `meta.synthetic`). Real data fetching, analysis
and quant arrive node by node. The LLM layer is real: `live` mode is implemented and tested against a faked gateway, and
costs nothing until you set `LLM_MODE=live`.

## Quick start

Needs `uv`, Node 20+ and npm.

```sh
cp .env.example .env     # defaults to LLM_MODE=mock, no key needed
make setup
make check               # lint, tests, typecheck, generated types up to date
make dev                 # backend :8000, frontend :5173 (Vite proxies /api)
```

## Env vars

| Var | Meaning |
|---|---|
| `TEAM_API_KEY` | Gateway key. Only in `.env`; never log or commit it |
| `LLM_BASE_URL` | OpenAI-compatible gateway |
| `LLM_MODE` | `mock` (dev/tests, zero cost) or `live` |
| `LLM_CACHE` | `1` caches LLM responses in SQLite |
| `DEFAULT_MODEL` | Override the registry default (cheapest) |
| `MAX_RUN_COST_USD`, `MAX_RUN_TOKENS` | Per-run budget guards |
| `MAX_PANEL_SIZE` | Upper bound for panel mode |
| `CACHE_TTL_DAYS` | Source cache TTL |
| `SEC_USER_AGENT` | Descriptive User-Agent with contact email for SEC requests |
| `DATA_DIR` | SQLite and vector files (git-ignored) |
| `MAX_CONCURRENT_RUNS` | Runs executing at once (default 2) |
| `STUB_DELAY_SCALE` | Scales the sleeps in stub nodes; `0` for instant runs (tests set it) |
| `VITE_API_MODE` | `live` or `mock` (frontend serves fixtures with no backend) |
| `API_PROXY_TARGET` | Where the Vite dev server proxies `/api` (default `http://localhost:8000`); lets a second dev setup run beside the first |

## Make targets

| Target | What it does |
|---|---|
| `setup` | `uv sync` and `npm install` |
| `dev` | Backend and frontend together |
| `check` | `ruff` check and format check, `pytest`, `tsc`, `eslint`, `vitest`, generated types up to date |
| `types` | Export OpenAPI to `contracts/openapi.json`, regenerate `frontend/src/api/types.gen.ts` |
| `graph-spec` | Regenerate `contracts/fixtures/graph_spec.json` from the node registry |
| `llm-smoke` | One tiny live gateway call plus a structured-output probe. Spends a few tokens; run it yourself |
| `spend` | Team LLM usage so far from the `llm_calls` table, against the $67 budget |

## Mock vs live

`LLM_MODE=mock` is a development and test switch: deterministic canned replies, zero tokens, zero cost. The demo, demo
cases, cost per run and any numbers quoted here come from `live` runs on real data.

## Run a demo case

1. `make dev`, open http://localhost:5173. This is the Unobio home page; every link on it is inert except "Gravity" in the
   header, which opens the chat page, and the header logo, which returns here.
2. Click "Use the BACE1 example", then Underwrite. Chat steps, the Graph tab and the Logs tab stream live.
3. When it completes, the Report tab shows the verdict. Expand a claim to see its evidence and the source link.
4. Graph tab, click `verdict` (or any node), write a correction containing "terminated", and re-run. Only the affected
   nodes recompute, the rest show as reused, and the version bar shows the decision change.

No backend? `VITE_API_MODE=mock npm run dev` in `frontend/` replays the same flow from fixtures. In mock mode, add
`?scenario=sparse|large|failed|slow|broken` to `/underwriting` before starting a run to see messy data. The full
walk-through, with what to check at each step, is in [docs/frontend-demo-script.md](docs/frontend-demo-script.md).

## Layout

```
backend/    FastAPI + LangGraph. contracts/ is the source of truth, nodes/ one module per node
frontend/   Vite + React + TypeScript. src/api/types.gen.ts is generated, never hand-edited;
            src/unobio/ is a copy of the unobio.com header, footer and home page (see ARCHITECTURE 9b)
contracts/  openapi.json and fixtures (all fixture text is synthetic and prefixed FIXTURE:)
docs/       ARCHITECTURE.md
```

## Sources

Public data through official APIs only: Open Targets, ClinicalTrials.gov v2, Europe PMC, openFDA. Every claim in a
report cites evidence ids that resolve to a source record with its URL and retrieval time.
