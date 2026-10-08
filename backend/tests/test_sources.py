import httpx
import pytest
import respx

from app.core.settings import get_settings
from app.sources.base import HttpSource, SourceError
from app.sources.clinicaltrials import flatten_study
from app.sources.factory import build_sources
from app.sources.openfda import OpenFDAClient
from app.sources.records import parent_name, trial_records
from app.store.db import Database
from app.store.fakes import InMemorySourceCache
from app.store.source_cache import SqliteSourceCache

BASE = "https://api.example.org"


class Probe(HttpSource):
    name = "probe"
    min_interval_s = 0.0


def probe(attempts: int = 3) -> Probe:
    return Probe(BASE, InMemorySourceCache(), attempts=attempts)


@respx.mock
async def test_second_call_is_served_from_cache_and_force_refresh_refetches():
    route = respx.get(f"{BASE}/items").mock(return_value=httpx.Response(200, json={"n": 1}))
    client = probe()
    assert await client.get_json("items", {"q": "x"}) == {"n": 1}
    assert await client.get_json("items", {"q": "x"}) == {"n": 1}
    assert route.call_count == 1
    await client.get_json("items", {"q": "x"}, force_refresh=True)
    assert route.call_count == 2
    await client.aclose()


@respx.mock
async def test_not_found_is_none_and_cached():
    route = respx.get(f"{BASE}/missing").mock(return_value=httpx.Response(404))
    client = probe()
    assert await client.get_json("missing") is None
    assert await client.get_json("missing") is None
    assert route.call_count == 1
    await client.aclose()


@respx.mock
async def test_server_errors_are_retried_then_raised_as_source_error():
    route = respx.get(f"{BASE}/flaky").mock(
        side_effect=[httpx.Response(503), httpx.Response(200, json={"ok": True})]
    )
    client = probe()
    assert await client.get_json("flaky") == {"ok": True}
    assert route.call_count == 2

    respx.get(f"{BASE}/down").mock(return_value=httpx.Response(500))
    with pytest.raises(SourceError):
        await probe(attempts=2).get_json("down")
    await client.aclose()


@respx.mock
async def test_client_errors_are_not_retried():
    route = respx.get(f"{BASE}/bad").mock(return_value=httpx.Response(400))
    with pytest.raises(SourceError):
        await probe().get_json("bad")
    assert route.call_count == 1


async def test_sqlite_cache_survives_a_new_instance_and_expires(tmp_path):
    db = Database(tmp_path / "app.db")
    await db.init()
    await SqliteSourceCache(db).put("probe:k", {"v": 1})
    fresh = SqliteSourceCache(db)
    assert await fresh.get("probe:k") == {"v": 1}
    assert await fresh.get("probe:k", force_refresh=True) is None
    await fresh.put("probe:old", {"v": 2}, ttl_days=-1)
    assert await fresh.get("probe:old") is None
    await db.dispose()


@respx.mock
async def test_openfda_spells_out_or_and_maps_no_match_to_empty():
    route = respx.get("https://api.fda.gov/drug/label.json").mock(
        return_value=httpx.Response(404, json={"error": {"code": "NOT_FOUND"}})
    )
    client = OpenFDAClient("https://api.fda.gov", InMemorySourceCache(), min_interval_s=0)
    assert await client.labels("verubecestat") == []
    search = route.calls[0].request.url.params["search"]
    assert " OR " in search and "+" not in search
    await client.aclose()


def test_build_sources_has_no_clients_in_fixture_mode_and_all_in_live(monkeypatch):
    assert build_sources(get_settings(), InMemorySourceCache()).names() == []
    monkeypatch.setenv("SOURCES_MODE", "live")
    get_settings.cache_clear()
    names = build_sources(get_settings(), InMemorySourceCache()).names()
    assert names == ["clinicaltrials", "europepmc", "openfda", "opentargets", "web"]


def test_trial_records_keep_why_stopped_verbatim_and_cap_outcomes():
    study = {
        "protocolSection": {
            "identificationModule": {"nctId": "NCT02783573", "briefTitle": "AMARANTH"},
            "statusModule": {"overallStatus": "TERMINATED", "whyStopped": "Futility."},
            "designModule": {"phases": ["PHASE3"], "enrollmentInfo": {"count": 1772}},
            "outcomesModule": {"primaryOutcomes": [{"measure": f"m{i}"} for i in range(5)]},
        }
    }
    trial = flatten_study(study)
    source, evidence = trial_records(trial, ["ENSG00000186318"])
    assert source.identifiers == {"nct": "NCT02783573"}
    assert evidence[0].data and evidence[0].data["nct_id"] == "NCT02783573"
    assert "status TERMINATED" in evidence[0].excerpt
    assert [e.excerpt for e in evidence[1:]] == ["Futility.", "m0", "m1"]
    # ids are content-addressed, so a re-fetch produces the same evidence ids
    assert trial_records(trial, [])[1][1].id == evidence[1].id


@pytest.mark.parametrize(
    ("name", "parent"),
    [
        ("INCLISIRAN SODIUM", "inclisiran"),
        ("DONEPEZIL HYDROCHLORIDE", "donepezil"),
        ("SODIUM", "sodium"),
        ("evolocumab", "evolocumab"),
    ],
)
def test_parent_name_strips_salt_forms(name, parent):
    assert parent_name(name) == parent
