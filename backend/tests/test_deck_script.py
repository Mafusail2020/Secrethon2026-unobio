import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app.chat.context import usable_claims
from app.chat.documents import Passage
from app.contracts import DeckBullet, DeckScript, SlideScript, UnderwritingReport
from app.deck.numbers import number_checker, numbers_block, pct, usd
from app.deck.script import (
    GROUPS,
    NUMERIC,
    SYSTEM,
    DeckDraft,
    DraftBullet,
    DraftSlide,
    gate_script,
    write_script,
)
from app.llm.backend import RawCompletion
from app.llm.limits import GATEWAY_PROMPT_CHARS
from app.llm.registry import ModelRegistry
from app.llm.service import LLMService
from app.llm.types import LLMTask
from app.main import create_app
from tests.test_fixtures import FIXTURES

REPORT = UnderwritingReport.model_validate_json(
    (FIXTURES / "report_bace1_alzheimers.json").read_text()
)
CLAIMS = [c.id for c in usable_claims(REPORT)]
NUMBERS = numbers_block(REPORT)


def bullet(text: str, claim: str | None = None, **kw) -> DraftBullet:
    return DraftBullet(text=text, claim_ids=[claim] if claim else [], **kw)


def slide(name: str, headline: str = "A clear point about the program", **kw) -> DraftSlide:
    return DraftSlide(slide=name, headline=headline, **kw)


def gate(script: DeckDraft, passages=(), *texts: str) -> DeckScript:
    return gate_script(script, set(CLAIMS), passages, NUMBERS, *texts)


def test_numbers_are_written_the_way_the_deck_writes_them():
    assert pct(0.043) == "4.3%" and pct(0.463) == "46%" and pct(0.0) == "0.0%"
    assert usd(-133e6) == "-$133.0M" and usd(1171e6) == "$1.2B" and usd(12e3) == "$12K"
    block = numbers_block(REPORT)
    assert f"PROBABILITY OF SUCCESS: {pct(REPORT.pos.base)} (range {pct(REPORT.pos.low)}" in block
    assert REPORT.valuation and usd(REPORT.valuation.capital_to_milestone.base) in block
    assert "STEP POINTS" in block and "points" in block and "CLAIMS:" in block


def test_a_sentence_may_only_use_numbers_the_report_holds_or_small_counts():
    ok = number_checker("PoS 4.3% (range 1.0% to 13%). Capital $12.0M over 18 months.")
    assert ok("The chance is 4.3%, with a range of 1.0% to 13%.")
    assert ok("Two of the 5 steps hold; $12.0M is needed over 18 months.")
    assert not ok("The chance is 73%.")
    assert not ok("It needs $40.0M.")
    assert ok("No numbers at all here.")
    assert number_checker("62 percent")("Abeta fell 62 percent")  # figures from a file are fine


def test_the_gate_drops_unknown_and_repeated_slides_and_keeps_the_rest_in_order():
    claim = CLAIMS[0]
    script = DeckDraft(
        subtitle="A short tagline",
        slides=[
            slide("works", bullets=[bullet("The target is linked to the disease.", claim)]),
            slide("ghost_slide", bullets=[bullet("x", claim)]),
            slide("works", bullets=[bullet("A second try at the same slide.", claim)]),
            slide("risks", bullets=[bullet("Efficacy may not translate.", claim)]),
        ],
    )
    out = gate(script)
    assert [s.slide for s in out.slides] == ["works", "risks"]
    assert out.slides[0].bullets[0].text == "The target is linked to the disease."
    assert out.subtitle == "A short tagline"


def test_a_bullet_about_a_claim_must_cite_a_real_one_and_invented_ids_are_removed():
    claim = CLAIMS[0]
    out = gate(
        DeckDraft(
            slides=[
                slide(
                    "works",
                    bullets=[
                        bullet("Backed by a claim.", claim, stance="for"),
                        bullet("Backed by nothing.", stance="against"),
                        bullet("Backed by a ghost.", "clm_ghost"),
                        DraftBullet(text="One real, one ghost.", claim_ids=["clm_ghost", claim]),
                    ],
                )
            ]
        )
    )
    texts = [b.text for b in out.slides[0].bullets]
    assert texts == ["Backed by a claim.", "One real, one ghost."]
    assert out.slides[0].bullets[1].claim_ids == [claim]
    assert out.slides[0].bullets[0].stance == "for"


def test_a_claim_slide_with_no_bullet_that_holds_up_is_left_to_the_report():
    out = gate(DeckDraft(slides=[slide("uptake", bullets=[bullet("Uncited opinion.")])]))
    assert out.slides == []


def test_a_numeric_slide_may_restate_numbers_without_a_claim_but_not_invent_them():
    pos = f"The chance of success is {pct(REPORT.pos.base)}."
    out = gate(
        DeckDraft(
            slides=[
                slide(
                    "probability",
                    bullets=[
                        bullet(pos),
                        bullet("The chance of success is 73%."),
                        bullet("Nothing numeric."),
                    ],
                )
            ]
        )
    )
    assert [b.text for b in out.slides[0].bullets] == [pos, "Nothing numeric."]
    assert "probability" in NUMERIC


def test_a_headline_or_takeaway_with_an_invented_number_does_not_survive():
    claim = CLAIMS[0]
    bad_headline = DeckDraft(
        slides=[slide("works", "Success odds are 88% here", bullets=[bullet("Fine.", claim)])]
    )
    assert gate(bad_headline).slides == []
    bad_takeaway = DeckDraft(
        slides=[slide("works", bullets=[bullet("Fine.", claim)], takeaway="That is a 91% bet.")]
    )
    kept = gate(bad_takeaway).slides[0]
    assert kept.takeaway is None and kept.headline == "A clear point about the program"
    assert gate(DeckDraft(subtitle="Odds of 77% on the call")).subtitle is None


def test_passages_of_the_users_files_count_only_if_they_were_shown():
    evidence = next(iter(REPORT.evidence.values())).model_copy(
        update={
            "id": "ev_0123456789abcdef",
            "excerpt": "Abeta42 fell 62 percent.",
            "locator": "p. 3",
        }
    )
    shown = Passage(evidence, "study.pdf")
    script = DeckDraft(
        slides=[
            slide(
                "works",
                bullets=[
                    DraftBullet(text="The file shows a drop.", evidence_ids=[evidence.id]),
                    DraftBullet(text="A file never shown.", evidence_ids=["ev_ffffffffffffffff"]),
                ],
            )
        ]
    )
    out = gate(script, [shown], "Abeta42 fell 62 percent.")
    assert [b.text for b in out.slides[0].bullets] == ["The file shows a drop."]
    assert gate(script, []).slides == []


def test_a_long_sentence_or_an_odd_stance_costs_that_item_not_the_reply():
    claim = CLAIMS[0]
    out = gate(
        DeckDraft(
            slides=[
                slide(
                    "works",
                    bullets=[
                        bullet("x" * 300, claim),
                        bullet("Short and cited.", claim, stance="sideways"),
                    ],
                ),
                slide("uptake", "h" * 200, bullets=[bullet("Fine.", claim)]),
            ]
        )
    )
    assert [s.slide for s in out.slides] == ["works"]
    assert [(b.text, b.stance) for b in out.slides[0].bullets] == [("Short and cited.", "neutral")]


def test_a_slide_keeps_at_most_six_bullets():
    claim = CLAIMS[0]
    many = [bullet(f"Point {i}.", claim) for i in range(6)]
    out = gate(DeckDraft(slides=[slide("works", bullets=many)]))
    assert len(out.slides[0].bullets) == 6


class Scripted:
    """A backend that answers each half of the deck with its own script, or fails one half."""

    cacheable = False
    is_mock = False

    def __init__(self, halves: dict[str, DeckDraft | Exception]) -> None:
        self.halves = halves
        self.tasks: list[LLMTask] = []

    async def complete(self, task: LLMTask, model: str) -> RawCompletion:
        self.tasks.append(task)
        key = "a" if "Write these slides: call" in task.user else "b"
        answer = self.halves[key]
        if isinstance(answer, Exception):
            raise answer
        return RawCompletion(answer.model_dump_json(), answer, 800, 600)


def _service(backend: Scripted) -> LLMService:
    return LLMService(backend, ModelRegistry([]), None, cache_enabled=False)


def _halves(claim: str) -> dict[str, DeckDraft | Exception]:
    return {
        "a": DeckDraft(
            subtitle="BACE1 in Alzheimer's: conditional",
            slides=[
                slide("call", bullets=[bullet("The thesis is plausible.", claim, stance="for")]),
                slide("works", bullets=[bullet("The link is unproven.", claim, stance="against")]),
                # the model wandered into the other half: that is not its job here
                slide("risks", bullets=[bullet("Out of its half.", claim)]),
            ],
        ),
        "b": DeckDraft(
            slides=[
                slide("risks", bullets=[bullet("Efficacy may not translate.", claim)]),
                slide("recommendation", bullets=[bullet("Proceed only on engagement data.")]),
            ]
        ),
    }


async def test_the_deck_is_written_in_parallel_calls_over_different_slides_and_merged():
    backend = Scripted(_halves(CLAIMS[0]))
    script, results = await write_script(_service(backend), "m", REPORT)
    assert len(results) == len(GROUPS) and len(backend.tasks) == len(GROUPS)
    first, *rest = backend.tasks
    for group, task in zip(GROUPS, backend.tasks, strict=True):
        assert f"Write these slides: {', '.join(group)}." in task.user
        assert task.purpose == "deck.script" and task.schema is DeckDraft and task.system == SYSTEM
        assert "NUMBERS" in task.user and task.user.startswith("<report>")
        assert len(task.system) + len(task.user) <= GATEWAY_PROMPT_CHARS + 1_000
    assert "`subtitle`" in first.user and all("`subtitle`" not in t.user for t in rest)
    assert [s.slide for s in script.slides] == ["call", "works", "risks", "recommendation"]
    assert script.subtitle == "BACE1 in Alzheimer's: conditional"
    assert (
        next(s for s in script.slides if s.slide == "risks").bullets[0].text
        == "Efficacy may not translate."
    )


async def test_a_half_that_fails_is_left_out_and_the_other_half_still_counts():
    halves = _halves(CLAIMS[0])
    halves["b"] = RuntimeError("gateway refused")
    script, results = await write_script(_service(Scripted(halves)), "m", REPORT)
    assert len(results) == 1 and [s.slide for s in script.slides] == ["call", "works"]
    both = {"a": RuntimeError("one"), "b": RuntimeError("two")}
    empty, none = await write_script(_service(Scripted(both)), "m", REPORT)
    assert empty.slides == [] and none == []


async def test_passages_of_the_files_go_into_the_prompt_and_may_be_cited():
    evidence = next(iter(REPORT.evidence.values())).model_copy(
        update={
            "id": "ev_0123456789abcdef",
            "excerpt": "Abeta42 fell 62 percent.",
            "locator": "p. 3",
        }
    )
    halves = _halves(CLAIMS[0])
    halves["a"] = DeckDraft(
        slides=[
            slide(
                "works",
                bullets=[
                    DraftBullet(
                        text="The mouse study shows 62 percent.", evidence_ids=[evidence.id]
                    )
                ],
            )
        ]
    )
    backend = Scripted(halves)
    script, _ = await write_script(_service(backend), "m", REPORT, [Passage(evidence, "study.pdf")])
    assert all("<documents>" in t.user and f"[{evidence.id}]" in t.user for t in backend.tasks)
    assert script.slides[0].bullets[0].evidence_ids == [evidence.id]


# ---- the endpoint


@pytest.fixture
def client():
    with TestClient(create_app()) as client:
        yield client


BODY = {"program": {"indication": "Alzheimer's disease", "mechanism": "BACE1 inhibition"}}


def _finished(client: TestClient) -> str:
    run_id = client.post("/api/runs", json=BODY).json()["id"]
    for _ in range(400):
        if client.get(f"/api/runs/{run_id}").json()["summary"]["status"] == "completed":
            return run_id
        time.sleep(0.03)
    raise AssertionError("run did not finish")


def test_in_mock_mode_the_deck_has_no_script_and_nothing_is_stored(client):
    run_id = _finished(client)
    first = client.post(f"/api/runs/{run_id}/deck")
    assert first.status_code == 200 and first.json() == {"subtitle": None, "slides": []}
    services = client.app.state.services
    assert asyncio.run(services.chat.get_deck(run_id)) is None


def test_the_deck_waits_for_the_report_and_needs_a_run(client):
    early = client.post("/api/runs", json=BODY).json()["id"]
    refused = client.post(f"/api/runs/{early}/deck")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "run_not_completed"
    assert client.post("/api/runs/run_missing/deck").status_code == 404


def test_live_the_script_is_written_once_kept_and_its_cost_is_logged(client, monkeypatch):
    from app.api import deck as deck_api
    from app.llm.types import LLMResult

    run_id = _finished(client)
    services = client.app.state.services
    services.settings.llm_mode = "live"
    calls: list[int] = []

    async def fake(llm, model, report, passages):
        calls.append(1)
        script = DeckScript(
            subtitle="Tagline",
            slides=[
                SlideScript(
                    slide="works",
                    headline="A clear point about the program",
                    bullets=[DeckBullet(text="A cited point.", claim_ids=[CLAIMS[0]])],
                )
            ],
        )
        result = LLMResult("gw", "", script, 900, 700, 0.0042, False, 500)
        return script, [result, result]

    monkeypatch.setattr(deck_api, "write_script", fake)
    first = client.post(f"/api/runs/{run_id}/deck").json()
    second = client.post(f"/api/runs/{run_id}/deck").json()
    assert first == second and first["slides"][0]["slide"] == "works" and len(calls) == 1
    rewritten = client.post(f"/api/runs/{run_id}/deck?rewrite=true").json()
    assert rewritten["subtitle"] == "Tagline" and len(calls) == 2
    logged = [
        c for c in asyncio.run(services.llm_repo.calls_for_run(run_id)) if c.node_id == "deck"
    ]
    assert len(logged) == 4 and {c.purpose for c in logged} == {"deck.script"}
    assert logged[0].tokens_in == 900 and logged[0].cost_usd == pytest.approx(0.0042)


def test_live_a_failed_or_empty_script_is_not_kept_so_it_can_be_tried_again(client, monkeypatch):
    from app.api import deck as deck_api

    run_id = _finished(client)
    services = client.app.state.services
    services.settings.llm_mode = "live"

    async def boom(llm, model, report, passages):
        raise RuntimeError("gateway down")

    monkeypatch.setattr(deck_api, "write_script", boom)
    assert client.post(f"/api/runs/{run_id}/deck").json()["slides"] == []

    async def nothing_held_up(llm, model, report, passages):
        return DeckScript(), []

    monkeypatch.setattr(deck_api, "write_script", nothing_held_up)
    assert client.post(f"/api/runs/{run_id}/deck").json()["slides"] == []
    assert asyncio.run(services.chat.get_deck(run_id)) is None
