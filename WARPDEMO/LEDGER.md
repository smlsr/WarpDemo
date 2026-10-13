# Ledger — the old WarpView and WarpEdit packs, and where each requirement went

Sources read: `WarpView/` and `WarpEdit/` in this repo's working copy (Oct 5, viewer.html-based), the same packs in `WarpTest`, the earlier packs on `origin/main` (`apps/viewer` tickets.json), and the viewer Warp built in WarpTest (`WarpView/viewer.html`, WV-01…16). New packs: `WarpView/` and `WarpEdit/` under `WARPDEMO/`.

## Contradictions found in the old packs

| # | Problem | Resolution |
|---|---|---|
| C1 | `tickets/tickets.json` described another product (apps/viewer, build-map palette, localStorage tracker) than the schedule and Jira import (viewer.html, timestamps, utilization) | One generator writes tickets.json, schedule.json and every import from the same ticket list |
| C2 | WarpEdit tickets locked `viewer.html` while its spec said the viewer must not gain the reset control | WarpEdit builds its own `editor.html` from WarpView's modules and adds controls through hooks; it never edits WarpView |
| C3 | WarpEdit's Jira key was WAR in one copy and WED in the other | WAR for both, one component per module |
| C4 | Every WarpView ticket locked the same file `viewer.html`, so 16 tickets ran one at a time | Modules under `app/src/<area>/`, one folder per ticket; only the release ticket writes `viewer.html`. Peak 6 agents, finish T+59h |
| C5 | The old viewer's look (plain tables) did not match Warp's dashboard | The Warp 1.6.1 run dashboard is the design of record; every screen has a PNG |
| C6 | `.warp/scan.json` and `_ingested_schedule.json` inside the packs pointed at `/workspace/artifacts/...` | Removed; Warp writes those in `.warp/` |
| C7 | Old schedule.json in Warp's legacy shape | build-schedule/2 (the FORGEQA/HOS format); Warp 1.6.1 reads it |
| C8 | The HOS-Admin schedule.json added fields the packs did not write or read (priority gates, merge checks as objects, gate on_green/starts/siblings, two repos, gates as milestones) | Warp 1.6.2 reads them. The packs write them (`priority_gate`, `checks [{name, check, wave}]`, G2 `priority` + `starts WarpEdit`, `on_green`) and say `model.gate_order: strict`, so Warp keeps running block by block. WarpView opens a schedule.json directly (SPEC §3.5, WV-04/06/07/09/10/12/13/14, `fixtures/schedule/two-repos.json`); WarpEdit treats it as read-only (WE-09/10/13) |

## Requirements

| R | Requirement (old) | Source | Now |
|---|---|---|---|
| R1 | Single HTML, starts empty, loads a Warp export (kind warp-plan) | WV-01 | WV-01 (empty state), WV-04 (exports are beams) |
| R2 | Save downloads the same shape (viewer) | WV-01, WV-13 | Superseded: the viewer is read-only; saving in the loaded shape is WarpEdit WE-09 |
| R3 | Show exportedAt, updatedAt, pr.openedAt/reviewedAt/approvedAt/mergedAt, jira.lastCommentAt, gate.greenAt; missing = em dash | WV-02 | WV-12 (drawer timestamps), WV-11 (table), WV-10/WV-09 (gate greenAt), WV-13 (exported time) |
| R4 | Drawer lists timestamps in order; jiraKey shown | WV-03 | WV-12 |
| R5 | Utilization: tokens, minutes, active over maxAgents bar, agent hours spent vs estimate bar | WV-04 | WV-08 (numbers), WV-13 (utilization panel) |
| R6 | A chip per phase; merged and done share the done color; alarm distinct | WV-05 | WV-03 (six categories over sixteen statuses), WV-14 (legend chips) |
| R7 | Interactive tracker: filter, hover, click | WV-06 | WV-14 (filters), WV-09 (hover), WV-15 (click → drawer) |
| R8 | Timeline with timestamp markers; bar from openedAt to mergedAt; scrub a day | WV-07 | WV-07/WV-09 actual clock (claim → merge, now line); scrubbing by time is WarpEdit WE-12 |
| R9 | Search id, summary, jiraKey, lock | WV-08 | WV-14 (plus module, layer, agent, status, block, size, run) |
| R10 | Gates pane: status, greenAt, evidence | WV-09 | WV-10 lane pill with tooltip; WV-09 gate labels |
| R11 | Utilization board by phase, size, agent | WV-10 | WV-13 (by size, by agent), WV-10 (lanes by status) |
| R12 | Table with status and four PR timestamps, sort by mergedAt | WV-11 | WV-11 |
| R13 | Empty and partial-timestamp states | WV-12 | WV-01, WV-11, WV-12 |
| R14 | Panes agree; no control changes status | WV-13 | WV-15 |
| R15 | Estimate block with assumptions | WV-14 | WV-13 (Assumptions in the run estimate card) |
| R16 | Keyboard path across filter, table, drawer | WV-15 | WV-14, WV-15 |
| R17 | README: viewer is read-only; sample path | WV-16 | WV-16 |
| R18 | Dependency graph, ready set, start-now queue, mark started (localStorage) | old tickets.json WV-04, WV-06, WV-14 | Superseded: Warp is the tracker; the viewer shows the plan (WV-07) and never marks work |
| R19 | Audit that WarpView cannot change a phase | WE-01 | WE-01, WE-14 |
| R20 | Phase menu = beam status list; unknown refused | WE-02 | WE-03 |
| R21 | Reset merged → earlier phase; dependents not unblocked | WE-03 | WE-04, WE-05 |
| R22 | Confirm names from and to | WE-04 | WE-06 |
| R23 | Reset appends {from,to,at,note}; timestamps kept | WE-05 | WE-04 |
| R24 | Un-merge → dependents blocked | WE-06 | WE-05 |
| R25 | Same-phase reset refused | WE-07 | WE-03 |
| R26 | Undo/redo | WE-08 | WE-02, WE-07 |
| R27 | Validate before save; error names the ticket | WE-09 | WE-08, WE-13 |
| R28 | Utilization updates; tokens and minutes kept | WE-10 | WE-11 |
| R29 | Save writes status and reset log; kind warp-plan; jiraKey survives | WE-11 | WE-09 (beam or export, same shape) |
| R30 | Reload shows reset and event | WE-12 | WE-10 (reset log from file), WE-14 (round trip) |
| R31 | Phase scrubber on the timeline | WE-13 | WE-12 |
| R32 | Drag a merged bar to reset; drop past a dependent snaps back | WE-13 | Superseded by the drawer reset (WE-10): one way to reset, always through the confirm dialog. Flag if drag is wanted |
| R33 | Round trip reset, save, load, compare | WE-14 | WE-14 |
| R34 | Plan editing: summary, deps, locks, size, forecast drag | old WarpEdit tickets.json | Deferred: not in the newest WarpEdit spec. Say if you want a WarpPlan module |
| R35 | Linear import with blockers | IMPORT.md | `tickets/linear-import.json` |
| R36 | Jira External ID custom field and ext: label | IMPORT.md | Kept, plus the `warp:<id>` label Warp falls back to |
