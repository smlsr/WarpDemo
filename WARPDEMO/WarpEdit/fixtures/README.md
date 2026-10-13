# WarpEdit fixtures

The run being edited is WarpView near the end of G2 (`beam.sample.json`, made like WarpView's fixtures). WV-07 is merged; its dependents are WV-09 (coding), WV-11 (merged), WV-15 and WV-16 (queued).

| File | What |
|---|---|
| `beam.sample.json`, `status.sample.json`, `WARP_PLAN.sample.json` | the subject run in Warp's three shapes |
| `invalid/missing-dep.json` | WV-09 depends on WV-99 |
| `invalid/cycle.json` | WV-10 ↔ WV-11 |
| `expected/reset.WV-07.coding.json` | WV-07 after reset to coding, note "flaky test", at 2026-10-12T19:30:00Z |
| `expected/dependents.WV-07.json` | blocked, in flight, already merged |
| `expected/saved.beam.json` | the saved beam after that reset (editedAt = 2026-10-12T19:30:00Z) |
| `expected/after-reset.metrics.json`, `before-reset.metrics.json` | totals before and after |
| `expected/scrub.+20.json` | each ticket's phase at +20 h |
