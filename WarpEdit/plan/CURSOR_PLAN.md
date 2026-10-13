# CURSOR_PLAN — WarpEdit

The WarpView screens plus one change: put a ticket back on an earlier phase, keep its history, and save the run in the shape it was loaded.

One orchestrator (Warp, run **edit**) drives up to 18 agents; every ticket merges when green. The runbook is `WARPDEMO/WarpEdit/plan/BUILD_PLAN.md`, the picture `WARPDEMO/WarpEdit/plan/CURSOR_SWIMLANE.pdf`, the data `WARPDEMO/WarpEdit/plan/schedule.json` (build-schedule/2).

## Rules

1. One ticket = one agent = one branch = one PR. Start an agent with `Implement <ID>`. Branch `warp/edit/<ID>-<jira>` (Warp names it).
2. The pack (`WARPDEMO/WarpEdit/spec`, `plan`, `tickets`, `fixtures`, `ui`) is read-only. Code goes under the ticket's lock paths inside `WARPDEMO/WarpEdit/app/`.
3. Ready = every blocker merged; with `gateOrder: strict` (Warp's default) a gate block starts when every earlier block has merged.
4. Two tickets in flight never share a lock path. Append-only files (keep both sides on conflict): `WARPDEMO/WarpEdit/app/src/plugins.mjs`.
5. Sizes S, M auto-merge after Bugbot; L and XL wait for APPROVED (0.5 h in the plan).
6. Tests: `npm --prefix WARPDEMO/WarpEdit/app test` must be green before a PR is opened. Each AC has a test.
7. Priority: ★ critical chain first, then rank, then id.
8. This run starts after **view:G2** (`startAfter: view:G2` in its config). WE-01 is blocked by view:WV-15 in the other run.

## Day 0

1. `/warp-init edit` in this repo's checkout. Set in `.warp/config.yaml`: `paths: WARPDEMO/WarpEdit`, `startAfter: view:G2`, `appendOnlyPaths: WARPDEMO/WarpEdit/app/src/plugins.mjs`, `jiraProject: WAR`.
2. `/warp-scan WARPDEMO/WarpEdit` — Warp reads `plan/schedule.json` (build-schedule/2).
3. Import Jira from `tickets/jira-import.json` (see `tickets/IMPORT.md`), then `/warp-jira-check`.
4. `/warp-start` (or a range, for example `/warp-start G0-G1`).

## Numbers

14 tickets · 110 agent-hours · finish T+76h · critical chain 69h over 7 tickets · peak 3 in flight · 7 waves

★ WE-01 → WE-02 → WE-04 → WE-05 → WE-11 → WE-12 → WE-14

## Gates

| Gate | Name | Members | Reached | Checks | If red |
|---|---|---|---|---|---|
| G0 | Editor builds, viewer untouched | WE-01 | T+4h | npm --prefix WARPDEMO/WarpEdit/app ci && npm --prefix WARPDEMO/WarpEdit/app test (audit green); app/dist/editor.html opens with the Editing badge | Stop the edit run: the viewer can change a phase or the editor cannot import it. |
| G1 | Reset is safe | WE-02, WE-03, WE-04, WE-05, WE-06, WE-07, WE-08, WE-09 | T+36.5h | reset, dependents, validate and save equal fixtures/expected; undo restores the loaded ticket exactly | Do not build screens on a reset that loses data. |
| G2 | Editor screens | WE-10, WE-11, WE-12, WE-13 | T+64.5h | Drawer reset, header actions, banner and scrubber match ui/screens; Totals follow a reset | Fix before release. |
| G3 | Ship | WE-14 | T+76h | editor.html committed; round trip green; viewer audit green | Do not announce the editor until the round trip is green. |

## Dependency levels

Tickets in one level can run in parallel (∥) unless their gate block is not open yet.

### Level 1

- **WE-01** ★ Editor scaffold on WarpView's modules, and the read-only audit · S·4h · gate G0 · rank 1 · after view:WV-15 · locks `WARPDEMO/WarpEdit/app/package.json`, `WARPDEMO/WarpEdit/app/build.mjs`, `WARPDEMO/WarpEdit/app/.gitignore`, `WARPDEMO/WarpEdit/app/src/main.mjs`, `WARPDEMO/WarpEdit/app/src/plugins.mjs`, `WARPDEMO/WarpEdit/app/test/`

### Level 2

- **WE-02** ★ Edit store: change log, undo and redo, unsaved count · M·7h · gate G1 · rank 2 · after WE-01 · locks `WARPDEMO/WarpEdit/app/src/edit/store/`
- **WE-03** Phase menu: allowed targets, same-phase and unknown refused · S·4h · gate G1 · rank 3 · after WE-01 · locks `WARPDEMO/WarpEdit/app/src/edit/phases/`

### Level 3

- **WE-04** ★ Reset a ticket's phase: event, reset log, timestamps kept · L·11h · gate G1 · rank 4 · after WE-02, WE-03 · locks `WARPDEMO/WarpEdit/app/src/edit/reset/`
- **WE-07** Undo, redo and unsaved count in the header · M·7h · gate G1 · rank 9 · after WE-02 · locks `WARPDEMO/WarpEdit/app/src/edit/history/`
- **WE-06** Confirm dialog: ticket, from and to phase, dependents, note · S·4h · gate G1 · rank 11 · after WE-03 · locks `WARPDEMO/WarpEdit/app/src/edit/confirm/`

### Level 4

- **WE-05** ★ Dependents of an un-merged ticket go back to blocked · M·7h · gate G1 · rank 5 · after WE-04 · locks `WARPDEMO/WarpEdit/app/src/edit/dependents/`
- **WE-08** Validate before save: missing ids, cycles, reset log · M·7h · gate G1 · rank 7 · after WE-04 · locks `WARPDEMO/WarpEdit/app/src/edit/validate/`

### Level 5

- **WE-11** ★ Totals, legend and every view follow each reset · L·11h · gate G2 · rank 6 · after WE-04, WE-05 · locks `WARPDEMO/WarpEdit/app/src/edit/recompute/`
- **WE-09** Save in the loaded shape; copy the edits as Warp commands · M·7h · gate G1 · rank 10 · after WE-04, WE-08 · locks `WARPDEMO/WarpEdit/app/src/edit/save/`
- **WE-10** Drawer Reset section: phase menu, button and reset log · M·7h · gate G2 · rank 12 · after WE-04, WE-05, WE-06 · locks `WARPDEMO/WarpEdit/app/src/edit/drawer-panel/`

### Level 6

- **WE-12** ★ Phase scrubber on the actual swimlane · XL·16h · gate G2 · rank 8 · after WE-11 · locks `WARPDEMO/WarpEdit/app/src/edit/scrubber/`
- **WE-13** Save button, validation banner and Copy as commands · M·7h · gate G2 · rank 13 · after WE-07, WE-09 · locks `WARPDEMO/WarpEdit/app/src/edit/save-ui/`

### Level 7

- **WE-14** ★ Release editor.html: round trip, audit again, README · L·11h · gate G3 · rank 14 · after WE-10, WE-11, WE-12, WE-13 · locks `WARPDEMO/WarpEdit/editor.html`, `WARPDEMO/WarpEdit/app/README.md`, `WARPDEMO/WarpEdit/app/test/roundtrip.test.mjs`

## Ticket table

| id | size | gate | after | summary |
|---|---|---|---|---|
| WE-01 | S | G0 | view:WV-15 | Editor scaffold on WarpView's modules, and the read-only audit |
| WE-02 | M | G1 | WE-01 | Edit store: change log, undo and redo, unsaved count |
| WE-03 | S | G1 | WE-01 | Phase menu: allowed targets, same-phase and unknown refused |
| WE-04 | L | G1 | WE-02, WE-03 | Reset a ticket's phase: event, reset log, timestamps kept |
| WE-05 | M | G1 | WE-04 | Dependents of an un-merged ticket go back to blocked |
| WE-06 | S | G1 | WE-03 | Confirm dialog: ticket, from and to phase, dependents, note |
| WE-07 | M | G1 | WE-02 | Undo, redo and unsaved count in the header |
| WE-08 | M | G1 | WE-04 | Validate before save: missing ids, cycles, reset log |
| WE-09 | M | G1 | WE-04, WE-08 | Save in the loaded shape; copy the edits as Warp commands |
| WE-10 | M | G2 | WE-04, WE-05, WE-06 | Drawer Reset section: phase menu, button and reset log |
| WE-11 | L | G2 | WE-04, WE-05 | Totals, legend and every view follow each reset |
| WE-12 | XL | G2 | WE-11 | Phase scrubber on the actual swimlane |
| WE-13 | M | G2 | WE-07, WE-09 | Save button, validation banner and Copy as commands |
| WE-14 | L | G3 | WE-10, WE-11, WE-12, WE-13 | Release editor.html: round trip, audit again, README |
