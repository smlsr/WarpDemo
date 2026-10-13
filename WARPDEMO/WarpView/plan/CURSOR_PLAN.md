# CURSOR_PLAN — WarpView

Open a Warp run's files from disk and show every ticket on a slot swimlane, a board and a table, colored by status, with run totals.

One orchestrator (Warp, run **view**) drives up to 18 agents; every ticket merges when green. The runbook is `WARPDEMO/WarpView/plan/BUILD_PLAN.md`, the picture `WARPDEMO/WarpView/plan/CURSOR_SWIMLANE.pdf`, the data `WARPDEMO/WarpView/plan/schedule.json` (build-schedule/2).

## Rules

1. One ticket = one agent = one branch = one PR. Start an agent with `Implement <ID>`. Branch `warp/view/<ID>-<jira>` (Warp names it).
2. The pack (`WARPDEMO/WarpView/spec`, `plan`, `tickets`, `fixtures`, `ui`) is read-only. Code goes under the ticket's lock paths inside `WARPDEMO/WarpView/app/`.
3. Ready = every blocker merged; with `gateOrder: strict` (Warp's default) a gate block starts when every earlier block has merged.
4. Two tickets in flight never share a lock path. Append-only files (keep both sides on conflict): none.
5. Sizes S, M auto-merge after Bugbot; L and XL wait for APPROVED (0.5 h in the plan).
6. Tests: `npm --prefix WARPDEMO/WarpView/app test` must be green before a PR is opened. Each AC has a test.
7. Priority: ★ critical chain first, then rank, then id.

## Day 0

1. `/warp-init view` in this repo's checkout. Set in `.warp/config.yaml`: `paths: WARPDEMO/WarpView`, `jiraProject: WAR`.
2. `/warp-scan WARPDEMO/WarpView` — Warp reads `plan/schedule.json` (build-schedule/2).
3. Import Jira from `tickets/jira-import.json` (see `tickets/IMPORT.md`), then `/warp-jira-check`.
4. `/warp-start` (or a range, for example `/warp-start G0-G1`).

## Numbers

16 tickets · 127 agent-hours · finish T+59h · critical chain 56.5h over 6 tickets · peak 6 in flight · 6 waves

★ WV-01 → WV-06 → WV-07 → WV-09 → WV-15 → WV-16

## Gates

| Gate | Name | Members | Reached | Checks | If red |
|---|---|---|---|---|---|
| G0 | Skeleton builds | WV-01 | T+4h | npm --prefix WARPDEMO/WarpView/app ci && npm --prefix WARPDEMO/WarpView/app test; npm --prefix WARPDEMO/WarpView/app run build writes app/dist/viewer.html and it opens empty | Stop: nothing else can be tested until the build and test runner work. |
| G1 | Data and model match the reference | WV-02, WV-03, WV-04, WV-05, WV-06, WV-07, WV-08 | T+22h | npm --prefix WARPDEMO/WarpView/app test (parse, blocks, plan and metrics equal fixtures/expected); tokens.css matches SPEC §12.1 | Do not start the views on a model that disagrees with fixtures/expected; fix the model first. |
| G2 | Panes agree | WV-09, WV-10, WV-11, WV-12, WV-13, WV-14, WV-15 | T+55h | Legend, cards, swimlane, board and table counts agree on every fixture; No control changes a status; createApp hooks work with a test plugin | WarpEdit starts after this gate (startAfter view:G2). If red, the edit run keeps waiting. |
| G3 | Ship | WV-16 | T+59h | viewer.html committed, under 400 kB, parity.test.mjs green | Do not announce the viewer until parity is green. |

## Dependency levels

Tickets in one level can run in parallel (∥) unless their gate block is not open yet.

### Level 1

- **WV-01** ★ App scaffold: one-file build, test runner, empty page · S·4h · gate G0 · rank 1 · after — · locks `WARPDEMO/WarpView/app/package.json`, `WARPDEMO/WarpView/app/build.mjs`, `WARPDEMO/WarpView/app/.gitignore`, `WARPDEMO/WarpView/app/src/shell.html`, `WARPDEMO/WarpView/app/src/main.mjs`, `WARPDEMO/WarpView/app/src/core/util.mjs`, `WARPDEMO/WarpView/app/test/`

### Level 2

- **WV-06** ★ Gate blocks: assign each ticket to a block and clear blocks · S·4h · gate G1 · rank 2 · after WV-01 · locks `WARPDEMO/WarpView/app/src/model/blocks/`
- **WV-03** Status model: sixteen Warp statuses on six colors · S·4h · gate G1 · rank 4 · after WV-01 · locks `WARPDEMO/WarpView/app/src/core/status.mjs`, `WARPDEMO/WarpView/app/src/core/status.test.mjs`
- **WV-02** Theme tokens, layout styles, dark mode, phone width and print · S·4h · gate G1 · rank 5 · after WV-01 · locks `WARPDEMO/WarpView/app/src/styles/`

### Level 3

- **WV-07** ★ Planned swimlane and actual timeline layouts · L·11h · gate G1 · rank 3 · after WV-06 · locks `WARPDEMO/WarpView/app/src/model/plan/`
- **WV-08** Run totals: estimate, agent hours, people hours, tickets · M·7h · gate G1 · rank 6 · after WV-03, WV-06 · locks `WARPDEMO/WarpView/app/src/model/metrics/`
- **WV-04** Read beam, status, ticket state and export files into runs · M·7h · gate G1 · rank 8 · after WV-03 · locks `WARPDEMO/WarpView/app/src/load/parse/`
- **WV-10** Board view: lanes by block, status, module or size · L·11h · gate G2 · rank 9 · after WV-02, WV-03, WV-06 · locks `WARPDEMO/WarpView/app/src/view/board/`
- **WV-12** Ticket drawer, timestamps and bar tooltip · M·7h · gate G2 · rank 13 · after WV-02, WV-03 · locks `WARPDEMO/WarpView/app/src/view/drawer/`
- **WV-14** Filters, search, view switch, theme, keyboard and File menu · M·7h · gate G2 · rank 14 · after WV-02, WV-03 · locks `WARPDEMO/WarpView/app/src/view/controls/`

### Level 4

- **WV-09** ★ Swimlane view: slots, time axis, gates, bars, zoom, actual clock · XL·16h · gate G2 · rank 7 · after WV-02, WV-03, WV-07 · locks `WARPDEMO/WarpView/app/src/view/swimlane/`
- **WV-13** Header, run tabs, the four totals and utilization panel · L·11h · gate G2 · rank 10 · after WV-02, WV-08 · locks `WARPDEMO/WarpView/app/src/view/header/`
- **WV-05** Open files and folders, drag and drop, reload and auto-reload · M·7h · gate G1 · rank 11 · after WV-04 · locks `WARPDEMO/WarpView/app/src/load/sources/`
- **WV-11** Table view: sortable columns with the four PR timestamps · M·7h · gate G2 · rank 12 · after WV-02, WV-03, WV-07 · locks `WARPDEMO/WarpView/app/src/view/table/`

### Level 5

- **WV-15** ★ Wire the app: store, render loop, drawer, tabs, print, plugin hooks · XL·16h · gate G2 · rank 15 · after WV-05, WV-09, WV-10, WV-11, WV-12, WV-13, WV-14 · locks `WARPDEMO/WarpView/app/src/main.mjs`, `WARPDEMO/WarpView/app/src/store/`, `WARPDEMO/WarpView/app/src/app.test.mjs`

### Level 6

- **WV-16** ★ Release viewer.html, README and parity check · S·4h · gate G3 · rank 16 · after WV-15 · locks `WARPDEMO/WarpView/viewer.html`, `WARPDEMO/WarpView/app/README.md`, `WARPDEMO/WarpView/app/test/parity.test.mjs`

## Ticket table

| id | size | gate | after | summary |
|---|---|---|---|---|
| WV-01 | S | G0 | — | App scaffold: one-file build, test runner, empty page |
| WV-02 | S | G1 | WV-01 | Theme tokens, layout styles, dark mode, phone width and print |
| WV-03 | S | G1 | WV-01 | Status model: sixteen Warp statuses on six colors |
| WV-04 | M | G1 | WV-03 | Read beam, status, ticket state and export files into runs |
| WV-05 | M | G1 | WV-04 | Open files and folders, drag and drop, reload and auto-reload |
| WV-06 | S | G1 | WV-01 | Gate blocks: assign each ticket to a block and clear blocks |
| WV-07 | L | G1 | WV-06 | Planned swimlane and actual timeline layouts |
| WV-08 | M | G1 | WV-03, WV-06 | Run totals: estimate, agent hours, people hours, tickets |
| WV-09 | XL | G2 | WV-02, WV-03, WV-07 | Swimlane view: slots, time axis, gates, bars, zoom, actual clock |
| WV-10 | L | G2 | WV-02, WV-03, WV-06 | Board view: lanes by block, status, module or size |
| WV-11 | M | G2 | WV-02, WV-03, WV-07 | Table view: sortable columns with the four PR timestamps |
| WV-12 | M | G2 | WV-02, WV-03 | Ticket drawer, timestamps and bar tooltip |
| WV-13 | L | G2 | WV-02, WV-08 | Header, run tabs, the four totals and utilization panel |
| WV-14 | M | G2 | WV-02, WV-03 | Filters, search, view switch, theme, keyboard and File menu |
| WV-15 | XL | G2 | WV-05, WV-09, WV-10, WV-11, WV-12, WV-13, WV-14 | Wire the app: store, render loop, drawer, tabs, print, plugin hooks |
| WV-16 | S | G3 | WV-15 | Release viewer.html, README and parity check |
