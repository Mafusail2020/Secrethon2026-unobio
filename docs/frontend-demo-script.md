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
**Sources** and **Logs** buttons in the top bar. Each button opens that view as a tab in the panel area on the right (click it
again, or the ✕ on the tab, to close it). The views are draggable, see section 6b. Below 1280 px the panel area covers
the conversation; below 768 px the history is a drawer.

1. Open `/underwriting`: the greeting types itself out, character by character (all at once with "reduce motion" on), and the card
   below it does not move while it does. Type **Alzheimer's disease** as the indication and **BACE1 inhibition** as the mechanism. Nothing
   runs yet. Report, Sources and Logs are greyed out until there is a run; **Graph** already works.
2. Effort: hover **Panel** and read the hint ("Several models analyse independently…"), then click back to **Medium**.
3. Press **⌘/Ctrl+Enter** or the arrow button. The URL becomes `/underwriting/runs/<id>`; the run appears in the
   history on the left.
4. Conversation: the working is folded into one line that names the step in progress ("Gather public evidence:
   openFDA, Europe PMC …") with steps done and elapsed time. Click **Show steps** for the full list of phases; the usage
   line (model calls, tokens, cost; "mock model, no spend" in mock) is inside it. A **stub data** chip is expected: the
   nodes are still fixtures.
5. Click **Graph** in the top bar while it runs: the 32 steps are folded into nine boxes, each showing its progress and
   which steps are running. Click **Gather public evidence**: its seven steps glide out of the box. Click the title of the
   opened frame to fold them again; **Ungroup all** and **Group all** do every box at once (and the choice is
   remembered). Turn on **Follow running step**; the camera follows. Open **Legend**.
6. When it completes, a structured briefing appears in the thread (a smaller version of the report: Verdict, Why this
   call, What the report found, Funding, Risks and unknowns, What to do next). The small numbers are citations: a number
   opens the report at that claim, and **Claims cited** at the end lists them. Under it, the verdict card: click **Open
   report** (or **Report** in the top bar). Reload: the same text is there, it is written once per run. If the run read files, the briefing has a **Your documents** section: its grey numbers open the quote from the file (file and page), and the list at the end reads **Sources cited**.

## 2. Drill-down (recommendation → claims → evidence → sources)

1. Report view: it opens on the call (decision, probability, value, what carries it and what holds it back) and four
   question cards, each with a standing and a for/against scale. The header is one row: the chips jump between the questions and
   highlight where you are, and once you scroll past the call the first chip shows the decision and probability; the
   **Generate report** button sits at its right. **Expand all** opens every branch.
2. Open **Will it get through trials and regulators?**, then a claim from **Against**, then **▸ Evidence (2)** on the
   "TERMINATED" claim: the verbatim quote (`overallStatus: TERMINATED`), where it sits, the source type, and a working
   ClinicalTrials.gov link. **The numbers behind it** (closed) holds the evidence ledger, where the risk comes from, what the
   claims rest on, where the evidence comes from, similar programs and funding; the sections and all claims are under the
   closed **Full report**.
3. Hover the **extracted** chip: the tooltip explains the six labels.
4. A question with nothing to weigh says **Not enough evidence**, with what could not be established.
5. **All claims** → filter by stance *against* and search "terminated"; **Clear** resets.
6. Sources view: two cards. **Your documents** (blue edge) holds your files; **Found by the analysis** (grey edge,
   "Public sources") is closed and says how many sources there are and who from. Press **Show**: sort by **Cited by**, filter
   **trial**, click "1 claim" and open it in the report. Your uploaded files are not repeated in that table.
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
5. Alternative path: **Graph** → click **Quantify and decide** to open it → click **Verdict** → **Correct** tab. (Folded boxes
   ring in blue when the draft would recompute any step inside.) While the form is open the steps that would
   recompute are outlined and the rest dim.

## 3b. Your documents

1. In the new-chat card press **Add details**, then drop a PDF, TXT or MD file on the **Documents** area (up to five, 10 MB
   each). A file the server refuses shows why under the list; **×** removes one. Start the run.
2. Open **Sources** in the top bar. **Your documents** is the first card, above the closed **Found by the analysis**: one row per file with a tick box, its
   size, and whether the run read it ("23 passages read, cited by 2 claims", "…, no claim cites it", or "Could not be read, so
   nothing from it was used" for a scan or a broken file). **Open** shows the file itself.
3. Untick a file, or drop another one on the strip below the list: a bar says how many are selected. **Re-run with these**
   makes a new version that starts again from the user-input step (the steps before it are reused) and opens it on the Graph
   view. In the new version the left-out file is still listed, unticked and marked "Not in this version", so it can be put back.

## 4. Generate report

**Generate report** (report header, right of the chips) opens a menu:

1. **Investment committee deck**: opens a page of 12 landscape slides: title, our call, the four questions, how the chance of
   success was built, similar programs, funding, how solid the evidence is, key risks, our recommendation. With a live model it first
   writes the words (up to a minute the first time, kept after that); each slide then has an action headline, short bullets and a
   so-what line. **Rewrite** asks for new words, and the header says whether the words are the model's or the report's own. The
   figures and charts are always the report's. Every bullet cites a claim or a passage of your files, or restates the report's
   numbers, and each slide's footer lists the sources behind it. **Save as PDF** opens the print window: pick "Save as PDF" and
   turn on background graphics. The file has one 16:9 page per slide. On a synthetic report every slide carries a red
   synthetic-data line. **Back to the report** returns.
2. **Full report (PDF)**: prints the report page with every branch open.
3. **Copy as Markdown**: paste somewhere: verdict, sections, claims with source links, run details.
4. **Download the trace** (live only).

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
- Motion: the history slides in and out, views slide in from the right, **Add details** opens smoothly, and new messages,
  history rows and the finished call rise in once. With "reduce motion" on, all of it (and the spinners) stops; the home
  page is unaffected.

## 6b. Arrange the views

1. Open **Report** and **Graph**: they sit in one panel as two tabs.
2. Drag the **Graph** tab onto the right edge of the Report panel: the area splits and both are visible side by side.
   Drag **Logs** onto the bottom edge of the Report panel: three panels. Drop a tab on another panel's tab strip to stack
   them again.
3. Drag the thin bar between the conversation and the panels to give either side more room (focus it and use ←/→ too).
4. Reload: the arrangement is back. Close all views and reload: they stay closed.
5. Click a citation number in the briefing while Report is behind another tab: Report comes to the front at that claim.
6. **Print** from the Report with a split layout: only the report prints.

## 7. Automated checks

`make check` runs lint, backend tests, `tsc`, `eslint`, `vitest` (pure logic and render tests, including sparse,
degraded, panel and 200-claim reports) and the generated-types check.
