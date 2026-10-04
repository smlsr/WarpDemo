# CURSOR_PLAN — WarpEdit

Day 0: WarpView is merged (WV-13). This pack is the edit work on that viewer.

## 1. Waves

### W0 base — 1 tickets

- **base**: WE-01

  **Gates before the next wave:**
  - *WE-01* — WarpView shipped: `WarpView WV-13 is merged and the read-only map opens`

### W1 build — 13 tickets

- **api**: WE-02 (after WE-01)
- **api**: WE-03 (after WE-02)
- **console**: WE-04 (after WE-02)
- **console**: WE-05 (after WE-02)
- **console**: WE-06 (after WE-02)
- **console**: WE-07 (after WE-02)
- **platform**: WE-08 (after WE-04, WE-05)
- **quality**: WE-09 (after WE-03, WE-05, WE-06)
- **quality**: WE-10 (after WE-05, WE-06)
- **api**: WE-11 (after WE-09)
- **console**: WE-12 (after WE-03)
- **console**: WE-13 (after WE-08, WE-10)
- **quality**: WE-14 (after WE-11, WE-12, WE-13)

## 2. Ticket table

| id | size | locks | deps | summary |
|---|---|---|---|---|
| WE-01 | S | docs/audit |  | Audit WarpView read-only contract before editing |
| WE-02 | M | apps/viewer/src/edit/dirty | WE-01 | Dirty-state model over the loaded beam |
| WE-03 | L | apps/viewer/src/edit/save | WE-02 | Save writer for beam.json and schedule.json |
| WE-04 | S | apps/viewer/src/edit/summary | WE-02 | Inline edit of ticket summary |
| WE-05 | L | apps/viewer/src/edit/deps | WE-02 | Dependency editor with cycle refusal |
| WE-06 | M | apps/viewer/src/edit/locks | WE-02 | Lock-path editor |
| WE-07 | S | apps/viewer/src/edit/size | WE-02 | Size editor S M L XL and auto-merge flag |
| WE-08 | M | apps/viewer/src/edit/undo | WE-04, WE-05 | Undo stack for the last 20 edits |
| WE-09 | M | apps/viewer/src/edit/validate | WE-03, WE-05, WE-06 | Validate deps, locks, and sizes before save |
| WE-10 | L | apps/viewer/src/edit/conflicts | WE-05, WE-06 | Warn when two ready tickets share a lock |
| WE-11 | M | apps/viewer/src/edit/export | WE-09 | Export WARP_PLAN.json from the edited graph |
| WE-12 | S | apps/viewer/src/edit/reload | WE-03 | Save confirmation and reload of the saved beam |
| WE-13 | XL | apps/viewer/src/edit/timeline | WE-08, WE-10 | Drag a timeline bar to change forecast start |
| WE-14 | L | apps/viewer/src/edit/roundtrip | WE-11, WE-12, WE-13 | Round trip: edit, save, reload, compare |
