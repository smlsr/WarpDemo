# WarpEdit

The WarpView screens plus one change: put a ticket back on an earlier phase, keep its history, and save the run in the shape it was loaded. It starts after run view reaches G2 and imports WarpView's modules read-only.

Read in this order:

1. `spec/SPEC.md` — the normative spec; `spec/ACCEPTANCE.md` — the acceptance queries with expected numbers.
2. `../AGENTS.md` — rules for every agent.
3. `plan/CURSOR_PLAN.md` (rules, gates, levels), `plan/BUILD_PLAN.md` (every step), `plan/CURSOR_SWIMLANE.pdf` (the picture), `plan/schedule.json` (build-schedule/2, what Warp scans).
4. `tickets/TICKETS.md` (or `tickets/tickets.json`) — every ticket with why, what, acceptance, locks, screens.
5. `ui/screens/` — what each screen must look like.
6. `fixtures/` — Warp files to test against; `fixtures/expected/` the golden outputs.

Run: `/warp-init edit`, `/warp-scan WARPDEMO/WarpEdit`, `/warp-start` (details in `../README.md`). Product code goes under `app/`; the release ticket writes `editor.html`.
