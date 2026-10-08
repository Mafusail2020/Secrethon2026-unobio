from typing import Any

import pytest

from app.contracts import EntityRef, Evidence, SourceRef, utcnow
from app.nodes import evidence_normalizer
from app.nodes.knowledge_indexer import build_graph
from app.store import KGEdge
from app.store.db import Database
from app.store.retriever import RunRetriever
from app.store.sqlite_store import SqliteStore, build_store
from app.store.vector import fts_query

BACE1 = EntityRef(id="ENSG00000186318", label="BACE1", kind="target")
AD = EntityRef(id="MONDO_0004975", label="Alzheimer disease", kind="disease")


@pytest.fixture
async def store(tmp_path):
    db = Database(tmp_path / "app.db")
    await db.init()
    yield await build_store(db, 7)
    await db.dispose()


def _source(sid: str, title: str, type_: str = "trial", **identifiers: str) -> SourceRef:
    return SourceRef(
        id=sid, type=type_, title=title, publisher="test", retrieved_at=utcnow(),
        identifiers=identifiers,
    )  # fmt: skip


def _ev(eid: str, sid: str, excerpt: str, data: dict[str, Any] | None = None) -> Evidence:
    return Evidence(
        id=eid, source_id=sid, excerpt=excerpt,
        kind="structured" if data is not None else "text", data=data,
    )  # fmt: skip


async def test_evidence_store_round_trips_and_keeps_first_write(store: SqliteStore):
    await store.evidence.put_sources([_source("src_1", "Real trial")])
    await store.evidence.put_evidence([_ev("ev_1", "src_1", "status TERMINATED")])
    await store.evidence.put_evidence([_ev("ev_1", "src_1", "changed")])
    assert (await store.evidence.get_evidence("ev_1")).excerpt == "status TERMINATED"  # type: ignore[union-attr]
    assert [s.title for s in await store.evidence.get_sources(["nope", "src_1"])] == ["Real trial"]


async def test_a_real_source_replaces_a_fixture_copy_but_never_the_reverse(store: SqliteStore):
    await store.evidence.put_sources([_source("src_1", "FIXTURE: trial")])
    await store.evidence.put_sources([_source("src_1", "Real trial")])
    await store.evidence.put_sources([_source("src_1", "FIXTURE: trial again")])
    assert (await store.evidence.get_source("src_1")).title == "Real trial"  # type: ignore[union-attr]


def test_fts_query_quotes_terms_and_keeps_phases_as_phrases():
    assert fts_query('BACE1 Phase 3 "terminated"') == '"phase 3" OR "bace1" OR "terminated"'
    assert fts_query("the of and") is None


async def test_full_text_search_matches_both_phase_spellings_within_the_allowed_set(
    store: SqliteStore,
):
    docs = [
        _ev("ev_ct", "s1", "NCT01953601: PHASE3, status TERMINATED"),
        _ev("ev_ot", "s2", "VERUBECESTAT on BACE1: max clinical stage PHASE_3"),
        _ev("ev_x", "s3", "unrelated note about pricing"),
    ]
    await store.vectors.add(docs, {"ev_ct": "Verubecestat in prodromal Alzheimer's"})
    hits = await store.vectors.search("verubecestat phase 3", k=5)
    assert {i for i, _ in hits} == {"ev_ct", "ev_ot"} and all(s > 0 for _, s in hits)
    only = await store.vectors.search("verubecestat phase 3", k=5, evidence_ids={"ev_ot"})
    assert [i for i, _ in only] == ["ev_ot"]
    assert await store.vectors.search("verubecestat", k=5, evidence_ids=set()) == []


async def test_graph_neighbors_work_in_both_directions_and_filter_by_evidence(store: SqliteStore):
    await store.kg.add_edges(
        [
            KGEdge(source="CHEMBL1", target=BACE1.id, relation="targets", evidence_id="ev_a"),
            KGEdge(source=BACE1.id, target=AD.id, relation="associated_with", evidence_id="ev_b"),
        ]
    )
    assert {e.evidence_id for e in await store.kg.neighbors(BACE1.id)} == {"ev_a", "ev_b"}
    assert [e.evidence_id for e in await store.kg.neighbors(BACE1.id, evidence_ids={"ev_b"})] == [
        "ev_b"
    ]


async def test_retriever_boosts_evidence_linked_to_the_entity_and_falls_back_to_set_order(
    store: SqliteStore,
):
    await store.evidence.put_evidence(
        [_ev("ev_far", "s1", "trial terminated early"), _ev("ev_near", "s2", "trial terminated")]
    )
    await store.vectors.add(await store.evidence.get_many_evidence(["ev_far", "ev_near"]))
    await store.kg.add_edges(
        [KGEdge(source="NCT1", target=BACE1.id, relation="tests", evidence_id="ev_far")]
    )
    retriever = RunRetriever(store, ["ev_near", "ev_far"])
    plain = [e.id for e in await retriever.retrieve("terminated", k=2)]
    boosted = [e.id for e in await retriever.retrieve("terminated", [BACE1.id], k=2)]
    assert boosted[0] == "ev_far" and set(plain) == set(boosted)
    assert [e.id for e in await retriever.retrieve("zzz", k=1)] == ["ev_near"]


def test_build_graph_only_links_what_the_records_state():
    sources = {
        "s_ot": _source("s_ot", "OT drugs: BACE1", "db_record", opentargets=BACE1.id),
        "s_assoc": _source("s_assoc", "OT association", "db_record"),
        "s_trial": _source("s_trial", "Verubecestat in prodromal AD (NCT01953601)"),
        "s_paper": _source("s_paper", "BACE1 inhibitors failed", "paper"),
    }
    evidence = [
        _ev(
            "e1",
            "s_ot",
            "VERUBECESTAT on BACE1",
            {"drug_id": "CHEMBL3301601", "drug": "VERUBECESTAT"},
        ),
        _ev("e2", "s_assoc", "BACE1 x AD 0.42", {"overall": 0.42}),
        _ev(
            "e3",
            "s_trial",
            "NCT01953601: PHASE3, status TERMINATED",
            {
                "nct_id": "NCT01953601",
                "overall_status": "TERMINATED",
                "interventions": ["Verubecestat 12 mg"],
                "conditions": ["Alzheimer's Disease"],
            },
        ),
        _ev("e4", "s_paper", "Verubecestat did not slow decline."),
    ]
    nodes, edges = build_graph([AD, BACE1], evidence, sources)
    got = {(e.source, e.relation, e.target, e.evidence_id) for e in edges}
    assert got == {
        ("CHEMBL3301601", "targets", BACE1.id, "e1"),
        (BACE1.id, "associated_with", AD.id, "e2"),
        ("NCT01953601", "stopped_testing", "CHEMBL3301601", "e3"),
        ("NCT01953601", "studies", AD.id, "e3"),
        ("s_paper", "reports_on", BACE1.id, "e4"),
        ("s_paper", "reports_on", "CHEMBL3301601", "e4"),
    }
    assert {n.kind for n in nodes} == {"disease", "target", "drug", "trial", "paper"}


class _Ctx:
    def __init__(self, store: SqliteStore) -> None:
        self.store, self.node_id, self.logs = store, "evidence_normalizer", []

    def log(self, message: str, level: str = "info") -> None:
        self.logs.append((level, message))


async def test_normalizer_reports_orphans_and_records_split_across_source_ids(store: SqliteStore):
    await store.evidence.put_sources(
        [_source("s1", "a", nct="NCT1"), _source("s2", "b", nct="nct1")]
    )
    await store.evidence.put_evidence(
        [_ev("e1", "s1", "same text"), _ev("e2", "s2", "Same  text."), _ev("e3", "gone", "x")]
    )
    ctx = _Ctx(store)
    state = {"evidence_ids": ["e1", "e2", "e3"], "source_ids": ["s1", "s2"]}
    assert await evidence_normalizer.run(state, ctx) == {}  # type: ignore[arg-type]
    text = " ".join(m for _, m in ctx.logs)
    assert "1 evidence item(s) point at an unregistered source" in text
    assert "appear verbatim in more than one source" in text
    assert "nct nct1 is recorded under 2 source ids" in text
