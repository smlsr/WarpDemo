# CURSOR_PLAN — WarpView

Day 0: empty repo. This pack is the spec. No product code yet.

## 1. Waves

### W0 base — 2 tickets

- **base**: WV-01 ∥ WV-02

  **Gates before the next wave:**
  - *WV-01* — Model loads: `Open ui/build-map.html and read 16 tickets from the fixture beam`

### W1 build — 14 tickets

- **api**: WV-03 (after WV-01)
- **api**: WV-04 (after WV-03)
- **console**: WV-05 (after WV-02)
- **console**: WV-06 (after WV-03, WV-05)
- **console**: WV-07 (after WV-04, WV-06)
- **console**: WV-08 (after WV-06)
- **quality**: WV-09 (after WV-04)
- **console**: WV-10 (after WV-06)
- **console**: WV-11 (after WV-06)
- **console**: WV-12 (after WV-06)
- **quality**: WV-13 (after WV-07, WV-09, WV-10, WV-11)
- **platform**: WV-14 (after WV-06)
- **quality**: WV-15 (after WV-13)
- **install**: WV-16 (after WV-13)

## 2. Ticket table

| id | size | locks | deps | summary |
|---|---|---|---|---|
| WV-01 | S | apps/viewer |  | Viewer repo skeleton and static host |
| WV-02 | S | apps/viewer/styles |  | Theme tokens matching the build-map palette |
| WV-03 | M | apps/viewer/src/parse | WV-01 | Parse beam.json, STATUS, and schedule into one model |
| WV-04 | L | apps/viewer/src/graph | WV-03 | Dependency graph and ready-set from blockers |
| WV-05 | S | apps/viewer/src/chips | WV-02 | Status chips: todo, running, merged, critical, gate |
| WV-06 | M | apps/viewer/src/tracker | WV-03, WV-05 | Tracker: start-now queue and board |
| WV-07 | L | apps/viewer/src/timeline | WV-04, WV-06 | Agent timeline with day columns and gate lines |
| WV-08 | S | apps/viewer/src/search | WV-06 | Ticket search across id, summary, and locks |
| WV-09 | M | apps/viewer/src/gates | WV-04 | Gates pane with checks and if-red text |
| WV-10 | L | apps/viewer/src/drawer | WV-06 | Ticket drawer: locks, blockers, acceptance criteria |
| WV-11 | M | apps/viewer/src/table | WV-06 | Ticket table sorted by forecast start |
| WV-12 | S | apps/viewer/src/empty | WV-06 | Empty states for a beam with nothing ready |
| WV-13 | XL | apps/viewer/src | WV-07, WV-09, WV-10, WV-11 | Wire all panes to the fixture beam offline |
| WV-14 | M | apps/viewer/src/state | WV-06 | Persist started and merged in localStorage |
| WV-15 | L | apps/viewer/src/a11y | WV-13 | Keyboard path through tabs, rows, and drawer |
| WV-16 | S | docs | WV-13 | Viewer README and fixture pointer |
