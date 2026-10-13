# WarpView fixtures

Made by `WARPDEMO/tools/gen_fixtures.py` with Warp's own scan from `plan/schedule.json`, then moved to 2026-10-12T20:00:00Z of a run that started at 2026-10-11T14:00:00Z.

| File | What |
|---|---|
| `beam.sample.json` | run `view`, 16 tickets, G0 and G1 green, G2 in flight: every status category is present |
| `tickets/WV-11/state.json` | a Shuttle state newer than the beam (claimed → coding) |
| `status.sample.json` | Warp's `status.json` for that beam (scan.py write_status) |
| `WARP_PLAN.sample.json` | Warp's export of that beam (`kind: warp-plan`) |
| `runs/view/beam.json`, `runs/edit/beam.json` | two named runs for the tabs |
| `big/beam.sample.json` | Warp's 68-ticket example (gates G0–G5) for layout and totals |
| `schedule/two-repos.json` | a build-schedule/2 file in the HOS-Admin shape: two repos (Demo-API, Demo-UI), cross-repo blockers, a named non-blocking priority gate G-RBAC that starts Demo-Portal, merge checks as objects, no `model.gate_order` |
| `expected/` | what the reference page computes for these files (categories, run, blocks, plan, actual, metrics, table); `fresh.plan.json` equals `plan/schedule.json`; `schedule.*.json` is `plan/schedule.json` opened directly; `two-repos.*.json` is the two-repo schedule |
