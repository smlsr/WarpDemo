# CURSOR_PLAN — WarpEdit

Day 0: WarpView already loads the sample export and cannot change a phase.

Editor adds reset from merged back to an earlier phase. Timestamps stay. Utilization updates.

## 1. Waves

### W0 base — 1 tickets

- **base**: WE-01

  **Gates before the next wave:**
  - *WE-01* — Viewer has no reset: `WarpView viewer.html loads the sample and cannot change a phase`

### W1 build — 13 tickets

- **api**: WE-02 (after WE-01)
- **console**: WE-03 (after WE-02)
- **console**: WE-04 (after WE-03)
- **api**: WE-05 (after WE-03)
- **api**: WE-06 (after WE-03)
- **console**: WE-07 (after WE-02)
- **platform**: WE-08 (after WE-05)
- **quality**: WE-09 (after WE-03, WE-06)
- **console**: WE-10 (after WE-03, WE-06)
- **api**: WE-11 (after WE-05, WE-09)
- **console**: WE-12 (after WE-11)
- **console**: WE-13 (after WE-08, WE-10)
- **quality**: WE-14 (after WE-11, WE-12, WE-13)

## 2. Phases

Viewer displays these. Editor may reset a ticket to any of them. History stays.

queued, claimed, planning, coding, review, fix, awaiting_approval, merging, merged, done, blocked, alarm, skipped

## 3. Ticket table

| id | size | locks | deps | summary |
|---|---|---|---|---|
| WE-01 | S | docs/audit |  | Audit that WarpView cannot change a phase |
| WE-02 | M | viewer.html | WE-01 | Phase menu matches the beam status list |
| WE-03 | L | viewer.html | WE-02 | Reset a merged ticket back to an earlier phase |
| WE-04 | S | viewer.html | WE-03 | Confirm names the from phase and the to phase |
| WE-05 | L | viewer.html | WE-03 | Reset appends an event and keeps old timestamps |
| WE-06 | M | viewer.html | WE-03 | Un-merge puts dependents back to blocked |
| WE-07 | S | viewer.html | WE-02 | Refuse a reset onto the same phase |
| WE-08 | M | viewer.html | WE-05 | Undo and redo a reset |
| WE-09 | M | viewer.html | WE-03, WE-06 | Validate the plan before save |
| WE-10 | L | viewer.html | WE-03, WE-06 | Utilization updates when a ticket leaves merged |
| WE-11 | M | viewer.html | WE-05, WE-09 | Save writes status and the reset log |
| WE-12 | S | viewer.html | WE-11 | Reload shows the reset phase and the event |
| WE-13 | XL | viewer.html | WE-08, WE-10 | Interactive phase scrubber on the timeline |
| WE-14 | L | viewer.html | WE-11, WE-12, WE-13 | Round trip reset, save, load, compare |
