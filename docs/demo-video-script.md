# Demo video: shot list and voice-over (about 2:40)

Record at 1440 × 900 or larger, browser zoom 100 %, the app started from the demo data dir (README, "Demo on a clean
data dir") so the history holds only the three demo cases and every replay is instant. Voice-over is in quotes; keep it
plain. Do one dry run first: a replay comes from the cache only if the code has not changed since the demo dir was built.

## 0:00–0:15 The problem

Shot: Unobio home page, then click **Gravity**.

"Most drugs that enter trials fail, and some that get approved are never used enough to pay back. Before Unobio
licenses a stalled program, it has to answer four questions: will it work in people, will it get through trials and
regulators, will it be used, and is funding it to the next milestone worth it."

## 0:15–0:45 One input, a live run

Shot: type **Parkinson's disease** and **LRRK2 kinase inhibition**, open **Add details**, stage phase 2, small molecule,
oral. Press the arrow. Open **Graph** while it runs.

"We give it only what a licensing team knows on day one: the indication and the mechanism. It resolves both to
Open Targets ids, pulls public evidence from ClinicalTrials.gov, Europe PMC, openFDA and Open Targets, and freezes that
set. Every step after this works only on the frozen evidence. You can watch each step in the graph."

## 0:45–1:20 The call and why

Shot: the briefing in the thread, then **Open report**. Hover the probability bar. Scroll to **What carries it** and
**What holds it back**.

"The call is Conditional, with a 15 % probability of success and a wide range, 1 to 49 %. It is wide on purpose: no
LRRK2 drug has finished a trial, so the prior is the neurology base rate. Strong human genetics moves it up; no human
target engagement and no brain exposure data move it down. Each of those is a line in the ledger with its own ratio
and source."

## 1:20–1:50 Drill down to the source

Shot: open **Works**, expand a claim, open **Evidence**, click the source link (ClinicalTrials.gov or Europe PMC opens).

"Every claim has a label, extracted, inferred or hypothesis, and cites evidence that exists in this run. A quote that
does not appear word for word in its source is downgraded. If there is no evidence, the report says unknown; it does
not guess."

## 1:50–2:20 Change one fact, the verdict moves

Shot: **Graph**, click **Verdict**, **Correct** tab. Type: "Our Phase 2 interim analysis was stopped for futility: no
slowing of progression at 12 months." Re-run. Show the **What changed** banner and the v1 / v2 switch.

"Now the company tells us its phase 2 interim was stopped for futility. Only the decision step recomputes, two seconds,
no model call, and the call goes from Conditional to Do not invest. Everything else is reused, and both versions stay
side by side."

## 2:20–2:40 Hindsight check and the deck

Shot: in the history, open the BACE1 case (Do not invest, 6 %), then the PCSK9 case (Conditional, 47 %). Then
**Generate report → Investment committee deck** on one of them and scroll two slides.

"On programs whose outcome we know, the system agrees with history: BACE1 inhibitors failed in Alzheimer's, and it says
do not invest; PCSK9 antibodies work, and it rates the class strongly but still asks this new antibody to show its own
human data. For the committee, it writes a deck where every line cites a claim. A full run costs about twenty cents."

## Numbers to say (live runs, `gpt-6-luna`)

| Case | Call | PoS (range) |
|---|---|---|
| LRRK2 × Parkinson's, phase 2 | Conditional, low confidence | 14.8 % (1.0–48.9 %) |
| BACE1 × Alzheimer's, phase 2 | Do not invest, high confidence | 6.3 % (1.0–23.7 %) |
| Anti-PCSK9 antibody × hypercholesterolemia, phase 2 | Conditional, medium confidence | 46.8 % (20.1–73.7 %) |

If a number on screen differs, say the one on screen: the table comes from the README.
