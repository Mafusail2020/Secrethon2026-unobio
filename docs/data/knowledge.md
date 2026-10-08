# Knowledge layer (T2): evidence store, search, graph, retriever

Everything lives in SQLite (`backend/data/app.db`), so runs, corrections and the evidence drill-down survive a
restart. Built in `app/store/sqlite_store.py::build_store`, wired in `core/services.py`.

| Piece | Code | Table | Notes |
|---|---|---|---|
| Evidence store | `store/evidence.py::SqliteEvidenceStore` | `sources`, `evidence` | Ids are content-addressed, so the first write wins. Exception: a real source replaces a `FIXTURE:` copy with the same id (stub nodes still register fixture trials under real NCT-based ids). |
| Search | `store/vector.py::FtsIndex` | `evidence_fts` (FTS5) | BM25 over excerpt + source title. `PHASE3` / `PHASE_3` are indexed as `phase 3`. Queries are reduced to quoted OR terms, so punctuation can't break FTS syntax. |
| Knowledge graph | `store/kg.py::SqliteKnowledgeGraph` | `kg_nodes`, `kg_edges` | Every edge carries the evidence id it was read from; `neighbors` filters by the run's evidence set. |
| Retriever | `store/retriever.py::RunRetriever` | — | BM25 over the run's frozen set, minus corrected-away ids. Evidence on an edge touching a requested entity ×1.5, one hop further ×1.25. Falls back to set order when nothing matches. |

## Decisions

- **FTS5 instead of LanceDB + embeddings.** A run holds ~150 evidence items; keyword ranking finds the right trials
  and stop reasons (see below) with no new dependency or model download. The `VectorIndex` protocol is unchanged, so
  LanceDB can replace `FtsIndex` later without touching nodes. `docs/ARCHITECTURE.md` still says LanceDB [later].
- **Graph edges only where a record states the relation** (no "everything mentions everything"):

| Relation | From → to | Read from |
|---|---|---|
| `targets` | drug → target | Open Targets drug list for the target |
| `indicated_for` | drug → disease | Open Targets drug list for the disease |
| `associated_with` | target → disease | Open Targets association record |
| `tests` / `stopped_testing` | trial → drug | CT.gov interventions name the drug; stopped = terminated, withdrawn or suspended |
| `studies` | trial → disease | CT.gov conditions name the disease |
| `reports_on` | paper → entity | title or abstract names the entity |

- **The normalizer does not delete.** Exact duplicates are already merged by content-addressed ids, and the state
  reducer for `evidence_ids` only adds. The node checks that every evidence item resolves to a source, reports
  excerpts repeated across sources and records split across source ids (same NCT/PMID/DOI). Long user pages are
  chunked at fetch time (`records.chunk_text`, ~1,500 chars, sentence-aligned, verbatim).

## Measured (BACE1 × Alzheimer's, live sources, mocked LLM)

149 evidence items from 73 sources; 71 edges (4 targets, 13 indicated_for, 1 associated_with, 7 stopped_testing,
1 tests, 20 studies, 25 reports_on). `retrieve("BACE1 Phase 3 terminated")` returns the terminated Phase 3 trials of
lanabecestat and verubecestat (NCT01953601); "verubecestat futility" returns the verbatim `whyStopped` texts.
