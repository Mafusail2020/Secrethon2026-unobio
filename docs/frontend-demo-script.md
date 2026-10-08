# Underwriting workspace: demo and verification script

A walk-through to rehearse the demo and to check the workspace by hand. About 10 minutes. Do the same checks at 1440
and 1024 px wide; keep screenshots out of git.

## 0. Start

| Mode | Command | Use it for |
|---|---|---|
| Mock (no backend) | `cd frontend && VITE_API_MODE=mock npm run dev` | rehearsing, messy data, no server needed |
| Live backend, mock LLM | `make dev` (keep `LLM_MODE=mock`) | the real flow end to end, free |

The backend dev server on :8000 is `uv run uvicorn ... --reload`; if it stops answering the page shows a red
"Cannot reach the backend" bar and recovers by itself when it is back. Another dev setup on other ports:
`API_PROXY_TARGET=http://localhost:8001 npx vite --port 5180`.

The home page (`/`) is a locked copy of unobio.com. Only its logo (home) and **Gravity** (the workspace) are links.

## 1. The main flow (BACE1)

The screen is laid out like a chat app: history on the left, the conversation in the middle, and **Report**, **Graph**,
**Sources** and **Logs** buttons in the top bar. Each button opens that view in a panel on the right (click it again, or
the ✕, to close it). Below 1280 px the panel covers the conversation; below 768 px the history is a drawer.

1. Open `/underwriting`. Click the **BACE1 inhibition for Alzheimer's disease** pill under the input. Fields fill; nothing
   runs. Report, Sources and Logs are greyed out until there is a run; **Graph** already works.
2. Effort: hover **Panel** and read the hint ("Several models analyse independently…"), then click back to **Medium**.
3. Press **⌘/Ctrl+Enter** or the arrow button. The URL becomes `/underwriting/runs/<id>`; the run appears in the
   history on the left.
4. Conversation: the working is folded into one line that names the step in progress ("Gather public evidence:
   openFDA, Europe PMC …") with steps done and elapsed time. Click **Show steps** for the full list of phases; the usage
   line (model calls, tokens, cost; "mock model, no spend" in mock) is inside it. A **stub data** chip is expected: the
   nodes are still fixtures.
5. Click **Graph** in the top bar while it runs: turn on **Follow running step**; the camera follows. Open **Legend**.
6. When it completes, a structured briefing appears in the thread (a smaller version of the report: Verdict, Why this
   call, What the report found, Funding, Risks and unknowns, What to do next). The small numbers are citations: a number
   opens the report at that claim, and **Claims cited** at the end lists them. Under it, the verdict card: click **Open
   report** (or **Report** in the top bar). Reload: the same text is there, it is written once per run.

## 2. Drill-down (recommendation → claims → evidence → sources)

1. Report view: the sticky header keeps the decision and probability in view; the chips below it jump between
   sections and highlight where you are.
2. In **Clinical plan**, open **▸ Evidence (2)** on the "TERMINATED" claim: the verbatim quote
   (`overallStatus: TERMINATED`), where it sits, the source type, and a working ClinicalTrials.gov link.
3. Hover the **extracted** chip: the tooltip explains the six labels.
4. **Commercial adoption** shows "Not enough public evidence", with what could not be established.
5. **All claims** → filter by stance *against* and search "terminated"; **Clear** resets.
6. Sources view: sort by **Cited by**, filter **trial**, click "1 claim" and open it in the report.
7. Logs view: filter by step, search, **Group by step**, **Copy**.

8. Back in the conversation, ask **Why is this conditional and not a no?** in the box at the bottom (it opens once the
   run completes). The answer comes with claim chips; click one and the Report view opens at that claim. Reload the page: the exchange is still there.
   Ask something the report does not cover (for example a drug price) on a live run: it says it cannot tell from the
   report instead of guessing. After 20 questions the box locks with a note.

## 3. Correction → verdict flip

1. On the "TERMINATED" claim click **This is wrong**. The dialog is pre-filled with the claim text and the two trial
   records pre-selected for exclusion, and a note says the correction goes to the **Bear claim writer** (a gate only
   re-checks drafts).
2. **Re-run with correction**. You land on the child run with the Graph view open, showing "Re-running: N steps reused, M
   recomputing"; the history lists the run once with **v1** and **v2** links.
3. Report view: the **What changed after your correction** banner shows Conditional → Do not invest, the PoS change,
   the changed sections and the added and removed claims (click to jump).
4. Graph view: version bar switches between v1 and v2; reused steps are dashed blue.
5. Alternative path: **Graph** → click **Verdict** → **Correct** tab. While the form is open the steps that would
   recompute are outlined and the rest dim.

## 4. Export

Report header: **Copy as Markdown** (paste somewhere: verdict, sections, claims with source links, run details),
**Download trace** (live only), **Print** (preview: only the report prints, no site chrome).

## 5. Messy data (mock only)

Add `?scenario=` to `/underwriting` before starting a run:

| Scenario | What to check |
|---|---|
| `sparse` | no twin stats, ledger or valuation (each says why); sections without enough evidence; a "Degraded run: fetch_literature" warning; the thread names the failed fetch |
| `large` | 161 claims; the All claims filter responds immediately and scrolling stays smooth |
| `failed` | the run stops at the question planner: the thread names the step and reason, **Run again with the same input** works, the Report view explains there is no report |
| `slow` | elapsed time keeps counting in the status line |
| `broken` | a malformed section: the report panel shows "This panel hit an unexpected error" while the conversation, header and other views keep working |

## 6. Keyboard and layout

- Tab from the history through the top bar buttons (they are toggle buttons: Enter or Space opens or closes the view) and
  the conversation. Inside the graph and the report, the usual controls apply.
- Graph steps are buttons: Enter opens the drawer, Esc closes it and returns focus to the step.
- The correction dialog traps focus; Esc closes it and returns focus to **This is wrong**.
- 1024 px: the view panel covers the conversation; ✕ brings it back. Below 768 px: the history is a drawer (the sidebar
  button in the top bar), no horizontal scrolling.
- With "reduce motion" on, spinners and transitions in the workspace stop animating; the home page is unaffected.

## 7. Automated checks

`make check` runs lint, backend tests, `tsc`, `eslint`, `vitest` (pure logic and render tests, including sparse,
degraded, panel and 200-claim reports) and the generated-types check.
