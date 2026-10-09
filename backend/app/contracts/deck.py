from typing import Literal

from pydantic import Field

from app.contracts.common import Contract

# the slides a model writes prose for; the title slide only gets a subtitle
DeckSlideId = Literal[
    "call",
    "works",
    "approval",
    "uptake",
    "funding",
    "probability",
    "twins",
    "money",
    "evidence",
    "risks",
    "recommendation",
]
DECK_SLIDE_IDS: tuple[str, ...] = (
    "call",
    "works",
    "approval",
    "uptake",
    "funding",
    "probability",
    "twins",
    "money",
    "evidence",
    "risks",
    "recommendation",
)


class DeckBullet(Contract):
    text: str = Field(min_length=1, max_length=240)
    stance: Literal["for", "against", "neutral"] = "neutral"
    # what the line rests on: claims of the report, passages of the user's files (both gated)
    claim_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)


class SlideScript(Contract):
    slide: DeckSlideId
    headline: str = Field(min_length=1, max_length=160)
    bullets: list[DeckBullet] = Field(default_factory=list, max_length=6)
    takeaway: str | None = Field(default=None, max_length=220)


class DeckScript(Contract):
    """The words of the investment-committee deck. Empty `slides` means no script: the deck is then
    written from the report's own wording."""

    subtitle: str | None = Field(default=None, max_length=180)
    slides: list[SlideScript] = Field(default_factory=list, max_length=len(DECK_SLIDE_IDS))
