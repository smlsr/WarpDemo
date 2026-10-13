# WarpView

Open a Warp run's files from disk and show every ticket on a slot swimlane, a board and a table, colored by status, with run totals. 

Read in this order:

1. `spec/SPEC.md` — the normative spec; `spec/ACCEPTANCE.md` — the acceptance queries with expected numbers.
2. `../AGENTS.md` — rules for every agent.
3. `plan/CURSOR_PLAN.md` (rules, gates, levels), `plan/BUILD_PLAN.md` (every step), `plan/CURSOR_SWIMLANE.pdf` (the picture), `plan/schedule.json` (build-schedule/2, what Warp scans).
4. `tickets/TICKETS.md` (or `tickets/tickets.json`) — every ticket with why, what, acceptance, locks, screens.
5. `ui/screens/` — what each screen must look like; `ui/reference/warp-dashboard.html` is the design of record (open it).
6. `fixtures/` — Warp files to test against; `fixtures/expected/` the golden outputs.

Run: `/warp-init view`, `/warp-scan WARPDEMO/WarpView`, `/warp-start` (details in `../README.md`). Product code goes under `app/`; the release ticket writes `viewer.html`.
