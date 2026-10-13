# WarpView — SPEC

Normative. Tickets may only reference what this file, `ACCEPTANCE.md`, the fixtures and the screens define. The design of record is `WARPDEMO/WarpView/ui/reference/warp-dashboard.html` (Warp 1.6.1's run dashboard loaded with `fixtures/beam.sample.json`) and the PNGs in `WARPDEMO/WarpView/ui/screens/`. Where this text and the reference disagree, this text wins and the disagreement is a bug in the pack.

## 1. What it is

One HTML file, `WARPDEMO/WarpView/viewer.html`, opened from disk. No server, no install, no network. It reads a Warp run's files and shows every ticket on a slot swimlane (like the plan's CURSOR_SWIMLANE.pdf), a board and a table, colored by status, with run totals in the header.

It is **read-only**. No control changes a ticket's status or writes a file. Resetting a phase is WarpEdit (`WARPDEMO/WarpEdit/`), which imports these modules and adds controls through the hooks of §11.

Not in scope: talking to Jira, GitHub or Warp; editing; accounts; charts beyond the ones below.

## 2. Layout and commands

```
WARPDEMO/WarpView/
  spec/ plan/ tickets/ fixtures/ ui/      the pack: read-only while the run builds
  app/                                    product code (agents write here, inside their lock paths)
    package.json build.mjs .gitignore
    src/shell.html  src/main.mjs  src/core/  src/load/  src/model/  src/view/  src/store/  src/styles/
    test/                                 shared test helpers (jsdom loader)
    README.md                             product README (WV-16)
    dist/viewer.html                      local build output, git-ignored (app/.gitignore: node_modules/, dist/)
  viewer.html                             released single file (WV-16 only)
```

| Command | Does |
|---|---|
| `npm --prefix WARPDEMO/WarpView/app ci` | install the two pinned dev dependencies (esbuild 0.24.0, jsdom 25.0.1) |
| `npm --prefix WARPDEMO/WarpView/app test` | `node --test`: every `*.test.mjs` under `app/` |
| `npm --prefix WARPDEMO/WarpView/app run build` | write `app/dist/viewer.html` |
| `npm --prefix WARPDEMO/WarpView/app run release` | write `viewer.html` (WV-16) |

Modules are ES modules (`.mjs`). Views are pure: `render…(state) → HTML string`; only `main.mjs` touches the DOM. Every module has its tests beside it (`x.test.mjs`). Node 22.

## 3. Inputs

### 3.1 Classification (by content, never by name)

| Kind | Rule |
|---|---|
| beam | object with `tickets` (object or array) and any of `gates`, `program`, `runState`, `config`, `instance`; or any object with `tickets` |
| status | object with an array `done`, `working` or `left` (Warp's `.warp/status.json`) |
| ticket | object with a string `state` and an `id`, no `tickets` (Warp's `.warp/tickets/<id>/state.json`) |
| other | skipped and counted |

A Warp export (`kind: "warp-plan"`, from `/warp-export`) is a beam: tickets as an array, `estimate` at the top level, `exportedAt`.

### 3.2 Runs

1. One run per beam. Key: `run` name, else `instance.id`, else the folder path.
2. Two beams with one key (a run's local `.warp/beam.json` and its mirror `.warp/runs/<name>/beam.json`) are one run: the newer wins (`updated`, §4.1).
3. A status.json joins the run with the same instance id or folder and only moves `updated`; alone it makes a run of kind `status` (no gates, no estimate, hours from size).
4. A ticket state attaches to the run whose folder holds `tickets/<id>/`, else to any run with that id.
5. Repo label: the embedded `repo`, else `owner/name` from the first pull request URL (`github.com/<o>/<r>/pull/`, GitLab merge_requests, Bitbucket pull-requests).
6. Runs sort by name in natural order.

### 3.3 Ticket state overlay

Only for a ticket that is not merged, done or skipped, and only when the state's `updatedAt` (else `heartbeatAt`) is newer than the ticket's `updatedAt`. The state maps through §5.3; a parked ticket keeps parked. It copies `pr.url` when the ticket has none, `alarm` when missing, `agent` when missing. It sets `stateNote: "state.json: <state> (beam said <status>)"`.

### 3.4 Sources

- Open status files: `showOpenFilePicker({multiple:true, types: json})`, else a hidden `<input type=file multiple accept=.json>`.
- Open .warp folder: `showDirectoryPicker({mode:'read'})`, else `<input webkitdirectory>`. When the folder has a `.warp` child, read only that. Read files whose path matches `/(^|\/)(beam|status|state)[^/]*\.json$/i`. Skip `.git node_modules __pycache__ .venv venv dist build previous previous-*`. Depth ≤ 7. With an input that lists a whole repo, keep only paths containing `.warp/` when any do.
- Drop: `getAsFileSystemHandle` when offered (files and folders), else `webkitGetAsEntry` traversal.
- Embedded: `<script id="warp-data" type="application/json">` holds `null` or `{generatedAt, repo, jiraSite, files:[{path, data}]}` (written by Warp's `/warp-dashboard`).
- Reload re-reads handles; embedded pages reload the page; plain input files are re-read and, if that fails, the toast says to open them again. Auto-reload every 30 s while the tab is visible.
- localStorage keys are prefixed `warp-dash:` and every access is inside try/catch.

## 4. Model

### 4.1 Run

`kind` (beam | status) · `export` (bool) · `exportedAt` · `path` · `dir` · `name` · `instance` · `host` · `runState` · `paused` · `pauseReason` · `range` · `owner` · `gateOrder` (beam → config → `strict`) · `startAfter` · `gates[]` (`key name status blocking members greenAt evidence checks ifRed`) · `tickets[]` · `critical[]` (program.criticalPath, else top-level criticalPath) · `estimate` (program.estimate, else top-level estimate) · `metrics` (beam.metrics) · `cap` (config.maxAgents, default 18) · `jiraSite` · `project` · `runStartedAt` · `runEndedAt` · `updated` (max of checkpointAt, exportedAt, every ticket updatedAt, else the file's modified time) · `repo`.

Computed: `blockRank`, `waves`, `finish`, `peak`, `slots`, `critHours`, `critCount`, `gateAt` (§6–§7).

### 4.2 Ticket

`id` · `title` (summary, else title) · `size` (S/M/L/XL from the leading token, else null) · `status` (normStatus) · `cat` · `hours` (ticket hours when > 0, else S=4, M=7, L=11, XL=16, else 7) · `hoursFrom` ("ticket" | "size X" | "default M") · `autoMerge` (field when boolean, else size S or M) · `deps` (deps + after, strings) · `locks` · `gate` · `module` · `layer` · `critical` · `starred` · `rank` · `priority` · `pr` {`url ci bugbot sha via openedAt reviewedAt approvedAt mergedAt`} · `jiraKey` (jiraKey, else jira.key) · `jiraStatus` · `jiraDone` (jira.doneAt or jiraDone) · `jiraCommentAt` (jira.lastCommentAt) · `alarm` · `agent` · `attempts` · `recoveries` · `minutes` · `tokens` · `cost` (usage.cost) · `claimedAt` · `updatedAt` · `events[]` · `stateNote`.

Computed: `block`, `slot`, `start`, `end`, `mergeAt`, `unplaced`.

### 4.6 Helpers (`src/core/util.mjs`)

`esc` (HTML-escape `& < > " '`) · `num` (finite number or null) · `fmtH(h, dp=1)` (`—` for null; ≥ 100 rounds; else `+h.toFixed(dp)`; locale digits; suffix `h`) · `fmtN` · `pct(a, b)` (`n%` or "") · `parseTime` (ms or null) · `ago(ms)` (just now, Nm, Nh, Nd ago) · `stamp(ms)` (month day, hour:minute) · `natKey/natCmp` (digit runs padded to 8) · `hashHue` (31-multiplier string hash mod 360).

## 5. Status

### 5.1 Warp statuses → six categories

| Category (key) | Label | Color token | Warp statuses |
|---|---|---|---|
| done | Completed | `--c-done` | merged, done, skipped |
| err | Errored / Parked | `--c-err` | alarm, parked, blocked |
| prog | In Progress | `--c-prog` | claimed, recovering, planning, coding, fix |
| rev | In Review | `--c-rev` | review, bugbot_running, merging |
| qa | QA Ready | `--c-qa` | awaiting_approval |
| todo | To Do | `--c-todo` | queued, and anything unknown |

Totals use four buckets: done, prog (= prog + rev + qa), err, todo.

### 5.2 Aliases

`normStatus`: lower-case, spaces and hyphens → `_`; then in_progress/inprogress → coding, in_review → review, qa_ready/qa → awaiting_approval, to_do/todo/ready → queued, completed/complete → done, errored/error/failed → alarm, bugbot → bugbot_running. Empty or null → queued.

### 5.3 Ticket states (state.json) → statuses

started → claimed, planning, coding, review, bugbot → bugbot_running, fix, pr-opened → review, check-red → fix, check-green → review, lock-escape → alarm, alarm, failed → alarm. heartbeat and done do not move a ticket.

## 6. Gate blocks (port of Warp's scripts/blocks.py)

Keys in run order: `G<n>` keys by number, then other keys in plan order. A ticket's block: its own `gate` when that gate exists; else the lowest gate listing it in `members`; else the highest block among its in-run dependencies (cycles cut); else the first key. No gates → every block is null. A block is cleared when every ticket in it is merged, done or skipped and its gate is not red.

## 7. Planned layout (`plan(run)`)

Estimate-hour clock, continuous. `cap = min(run.cap, 64)` slots. Approval wait = `estimate.approvalHours`, default 0.5. A ticket's merge = its end + the approval wait when `autoMerge` is false. Priority order: critical, starred, rank (null last), longest downstream chain (hours), natural id. A ticket is critical when the run's critical list names it.

Loop from t = 0: release tickets whose merge ≤ t (their block's open count falls); ready = pending tickets whose in-run dependencies have merged by t and — when `gateOrder` is not `deps`, the run is a beam and has more than one block — every earlier block has no open ticket and its last merge ≤ t; sort ready by priority; give each the lowest slot free at t (slot frees at the ticket's end); next t = the smallest future slot-free time or merge. If nothing can happen and tickets remain (cycle or a blocker that never merges), lay the rest one after another on the earliest free slots and flag them `unplaced`.

Outputs: per ticket `slot start end mergeAt`; per run `finish` (max mergeAt), `peak` (most slots busy at once), `slots` (highest slot used + 1), `waves` (longest dependency level), `critHours`, `critCount`, `gateAt` (per gate: max mergeAt of its block's tickets and its members).

## 8. Layouts for drawing

`layoutPlan(run)` → `{prefix:"T+", label:"Slot", rows: slots, span: finish, now: null, items: [{t, row: slot, s: start, e: start + hours, sz: true}], gates: [{k, at: gateAt, g}]}`.

`layoutActual(run, now)` → hours since `runStartedAt` (else the earliest start). Start = claimedAt, else pr.openedAt, else the first status event into claimed…merging, merged or done. A ticket with none of these is not drawn (`unstarted`), even when it is blocked or parked. End = pr.mergedAt, else updatedAt when terminal, else now (now = runEndedAt, else the current time while running and not paused, else `updated`). End < start → start. Sort by start then id; each item takes the lowest row free at its start. Gates at `greenAt`. `unstarted` = tickets without a start. `prefix "+"`, `label "Agent"`.

## 9. Totals

### 9.1 Formulas (`computeMetrics(runs)`)

- **Agent hours**: Σ ticket hours per bucket.
- **People hours**: 0.5 h (approvalHours) per ticket with autoMerge false, in its bucket; plus 0.5 h per blocking gate: done when green, err when red, prog when any ticket of its block is not To Do, else todo. `humanPlan` = Σ estimate.humanHours.
- **Run estimate**: `estTotal` = max over runs of estimate.elapsedHours (null when no run has it). Its split = estTotal × the agent-hour share of each bucket ("split by agent-hours").
- **Tickets**: count per bucket.
- **Elapsed**: hours from runStartedAt to runEndedAt, else now while running, else `updated`; max over runs.
- **ETA left**: beam.metrics.etaHours, else max(critical hours left, remaining hours ÷ min(cap, 8)) (Warp's beam.py rule); max over runs.
- **Swimlane finish**: max `finish`. **Assumptions**: union of estimate.assumptions.
- **Actual** hours = Σ minutes ÷ 60; tokens Σ; cost Σ usage.cost (null when none); `sizeDerived` = tickets whose hours came from size.
- A value the files do not have is null and shows `—`.

### 9.2 Cards

Four cards in a row (two under 1100 px, one under 640 px): **Run estimate** (sub "elapsed, plan"; foot: Elapsed, ETA left, Swimlane T+h, "split by agent-hours", Assumptions details), **Agent hours** ("estimate"; foot: Actual, Tokens, Cost, "n from size"), **People hours** ("approvals + gates"; foot: Plan, Gates green/total, "0.5h per review or gate"), **Tickets** ("n% complete"; foot: In review, QA ready, Coding). Each: big number, a stack bar (done, prog, err, todo colors), rows with swatch, label, value and percent (the err row only when > 0).

### 9.3 Utilization

`active` = tickets in claimed…merging; `cap` = Σ run caps; spent hours vs Σ estimate.agentHours; tokens and minutes by size (S, M, L, XL, —) and by agent (natural order, 8 rows then "n more").

## 10. Screens

Every screen has a PNG and an HTML capture in `ui/screens/` (index in `ui/screens/screens.json`). Match layout, order, spacing and color; font rendering differences are fine.

### 10.1 Regions (ids in `shell.html`)

`header.top` (brand, `#meta`, actions: File menu `#fileMenu`, `#reloadBtn`, `#themeBtn`, `#printBtn`; then `#actionsBar`, a second row that holds plugin header actions and is hidden when there are none) · `#emptyState` · `#app` (`#title`, `#subline`, `#chainline`, `#tabs`, `#metrics`, `#util`, controls with `#legend`, `#q`, `#viewSeg`, `#groupBy`, `#colorBy`, `#zoom`, `#view`, `#sources`, `#generated`) · `#scrim` · `#drawer` · drop overlay · `#tip` · `#toasts` · hidden `#fileInput`, `#dirInput` · `#warp-data`.

### 10.2 Meta chips

repo · run · `warp:<instance>` (mono) · state with dot (running: pulsing green; paused: amber; stopped: gray; done: brand) and pause reason · range spec · owner · "updated <ago> · <stamp>" (stamp hidden ≤ 640 px). All runs view: "n runs · m running". Chips with no value are omitted.

### 10.3 Headline

Title: "<run> — <repo> swimlane" (one run) or "<repo> — n runs". Subline: n tickets · w waves (beam) · agent-hours · cap agent slots · planned finish T+h · peak n in flight · critical chain h over n tickets · gate order · starts after. Chain line: "★ id → id → …" in planned start order.

### 10.4 Tabs

Shown with two or more runs: "All runs (n)", then one per run "label · done/total".

### 10.5 Controls

Legend chips (§5.1 order, with counts) are the status filter. Search box. View switch Swimlane / Board / Table. Lanes select (board): Gate block, Status, Module, Size. Color select: Status, Module (module hue from hashHue, lighter for UI layers). Zoom range 0–100 (swimlane).

### 10.6 Swimlane

Panel header: title, note, Plan/Actual switch. Sticky label column (76 px, 54 px ≤ 640 px) and sticky head rows (gates 38 px, axis 26 px). Rows 46 px. px per hour = max(7 when narrower than 700 px else 2, (width − label − 24) ÷ span) × 6^(zoom/100); print: (1020 − label) ÷ span. Tick step = first of 1,2,5,10,20,25,50,100,200 with step × pph ≥ 56. Gate labels sit left of their line; gates within 6 px share one label ("G1 · G2"); a label lifts to the upper row when there is no room (odd index); the gate name shows only when there is room. Bars: left 4 px accent and a tint of the status color (To Do lighter), 2 px ink outline for critical, "★ id", "S·4h" (plan) or the duration (actual), title on the second line, ⚠ for an alarm, ✗ for red CI; under 70 px only the id. Filtered-out bars dim to 14 %; search hits get the focus outline. Actual clock adds the dashed now line. Hover shows the tooltip; click opens the drawer. Foot text as in the reference.

### 10.7 Board

Lanes per §10.5 (block lanes prefixed by run label with several runs). Header: chevron, name, gate name, gate pill (status, greenAt; tooltip with evidence, checks, if-red), cleared pill, "n/m done", agent hours, "k shown" when filtered, stack bar. Cleared block lanes start collapsed when there is more than one lane. Cards in a grid (min 232 px): id with ★, size badge, status text in its color, two-line title, "est 7h", "spent 1.8h", "PR #n ↗", Jira key (link to `https://<jiraSite>/browse/<key>` when jiraSite is set), "CI ✓", alarm line.

### 10.8 Table

Columns: Ticket, Status, Summary, Size, Block, Est, Plan (T+start), Spent, Opened, Reviewed, Approved, Merged, Links. Sticky header; click or Enter sorts, again reverses; `aria-sort`. Default sort Plan ascending. Timestamps: stamp with the raw value as title; missing or invalid → `—`.

### 10.9 Empty state

Logo, "Open a Warp run", the two explanation paragraphs, buttons Open status files… and Open .warp folder…; a dashed panel. Dropping files anywhere shows the overlay "Drop beam.json, status.json, state.json, or a .warp folder".

### 10.10 Drawer

Right panel, 480 px (full width on phones), scrim behind. Header: 5 px status color bar, id with ★, title, close. Key list: Status (category in its color · status), Alarm (when present, second), Run, Block, Size (· auto-merge | needs approval), Estimate (hours and source), Planned (T+start → T+merge · slot n · unplaced note), Spent, Tokens / cost, Pull request, CI / Bugbot, Jira (key, status, Done), Merged (sha 10, via, mergedAt), Agent, Attempts (· recoveries), Module, Updated, Note. Then **Timestamps**: Claimed, PR opened, Reviewed, Approved, Merged, Jira last comment, Updated. Then Depends on, Locks (tags), Events (newest first, ≤ 25), then plugin sections (§11).

### 10.11 Phone (≤ 640 px)

16 px gutters; top bar non-sticky, brand and actions on one row, chips on the next; cards in one column; no horizontal page scroll (the swimlane scrolls inside its panel).

### 10.12 Print

Landscape, 10 mm margins, light tokens, exact colors; actions, search, selects, tabs, drawer and toasts hidden; utilization opened; swimlane fitted to 1020 px; panels and cards do not split.

### 10.13 Keys

`/` search · `o` open files · `O` open folder · `r` reload · `p` print · Escape closes menu, drawer · Enter/Space activate cards, rows, lane headers, sort headers. Keys are ignored while typing in an input or with Ctrl/Meta/Alt.

## 11. App and extension points (`src/main.mjs`, `src/store/`)

```js
createApp({ root = document, plugins = [] }) → app
app.store      // { getRuns(), replaceRuns(runs, reason), subscribe(fn), state }
app.recompute(run)   // blocks + plan again after a status change
app.hooks = {
  drawerSections:   [{ id, render(ticket, run) → html, bind(el, ctx) }],
  headerActions:    [{ id, render(state) → html, bind(el, ctx) }],   // rendered in #actionsBar, in order
  swimlaneOverlays: [{ id, render(layout, run, opts) → html, bind(el, ctx) }],
  keys:             [{ key, ctrl, shift, run(event, ctx) }],
}
```

A plugin is `{id, drawerSections?, headerActions?, swimlaneOverlays?, keys?, init?(app)}`. The viewer passes none. The viewer itself never assigns a ticket status outside `load/parse` (overlay, §3.3), never renders an element with `data-edit`, never writes a file.

## 12. Design tokens

### 12.1 Values (`src/styles/tokens.css`)

| Token | Light | Dark |
|---|---|---|
| --bg | #f4f6f7 | #0b1214 |
| --panel | #ffffff | #111b1e |
| --panel2 | #eef2f3 | #162327 |
| --ink | #0e1719 | #e7eff0 |
| --ink2 | #2b3a3e | #c8d5d8 |
| --muted | #5d6d72 | #8fa3a8 |
| --line | #dbe2e4 | #22343a |
| --line2 | #c6d0d3 | #2c434a |
| --brand | #0b6e6e | #43b3ad |
| --brand2 | #43b3ad | #6fd0ca |
| --c-done | #1f9d55 | #34c172 |
| --c-err | #d64545 | #f06363 |
| --c-prog | #2f6fde | #5b8ff0 |
| --c-rev | #8b5cf6 | #a587ff |
| --c-qa | #d99a00 | #f0b429 |
| --c-todo | #8c99a5 | #73828d |
| --tint | 16% | 24% |
| --tint-todo | 10% | 16% |

Dark values apply under `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`. Fills use `color-mix(in srgb, var(--c) var(--tint), var(--panel))`. Font: system UI stack; mono for ids and agents. Radius 8–12 px; card shadow as in the reference.

### 12.2 Logo

The Warp mark from the reference (inline SVG: dark rounded square, teal warp threads, white weft).

## 13. Acceptance

`ACCEPTANCE.md` lists the acceptance queries with exact inputs and expected numbers; `fixtures/expected/` holds the golden outputs produced by the reference.
