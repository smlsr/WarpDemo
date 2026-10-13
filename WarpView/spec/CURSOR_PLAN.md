# CURSOR_PLAN — WarpView

Day 0: one empty HTML file. Sample export is fixtures/WARP_PLAN.sample.json.

Viewer is read-only. It shows timestamps and utilization. It does not reset a phase.

## 1. Waves

### W0 base — 1 tickets

- **base**: WV-01

  **Gates before the next wave:**
  - *WV-01* — Timestamps load: `Open viewer.html empty`

### W1 build — 15 tickets

- **api**: WV-02 (after WV-01)
- **console**: WV-03 (after WV-02)
- **api**: WV-04 (after WV-02)
- **console**: WV-05 (after WV-02)
- **console**: WV-06 (after WV-03, WV-05)
- **console**: WV-07 (after WV-04, WV-06)
- **console**: WV-08 (after WV-06)
- **quality**: WV-09 (after WV-02)
- **console**: WV-10 (after WV-04, WV-06)
- **console**: WV-11 (after WV-03)
- **console**: WV-12 (after WV-01)
- **quality**: WV-13 (after WV-07, WV-09, WV-10, WV-11)
- **platform**: WV-14 (after WV-04)
- **quality**: WV-15 (after WV-13)
- **install**: WV-16 (after WV-13)

## 2. Phases

Viewer displays these. Editor may reset a ticket to any of them. History stays.

queued, claimed, planning, coding, review, fix, awaiting_approval, merging, merged, done, blocked, alarm, skipped

## 3. Ticket table

| id | size | locks | deps | summary |
|---|---|---|---|---|
| WV-01 | S | viewer.html |  | Single HTML starts empty and loads a Warp export |
| WV-02 | S | viewer.html | WV-01 | Read every timestamp the export and beam can carry |
| WV-03 | M | viewer.html | WV-02 | Ticket drawer lists those timestamps in order |
| WV-04 | L | viewer.html | WV-02 | Utilization from tokens, minutes, and maxAgents |
| WV-05 | S | viewer.html | WV-02 | Chip for each beam phase |
| WV-06 | M | viewer.html | WV-03, WV-05 | Interactive tracker: filter, hover, click |
| WV-07 | L | viewer.html | WV-04, WV-06 | Interactive timeline with timestamp markers |
| WV-08 | S | viewer.html | WV-06 | Search id, summary, jiraKey, lock |
| WV-09 | M | viewer.html | WV-02 | Gates pane shows status, greenAt, and evidence |
| WV-10 | L | viewer.html | WV-04, WV-06 | Utilization board by phase, size, and agent |
| WV-11 | M | viewer.html | WV-03 | Table columns for status and the four PR timestamps |
| WV-12 | S | viewer.html | WV-01 | Empty and partial-timestamp states |
| WV-13 | XL | viewer.html | WV-07, WV-09, WV-10, WV-11 | Wire panes so tracker, timeline, and utilization agree |
| WV-14 | M | viewer.html | WV-04 | Estimate block with assumptions |
| WV-15 | L | viewer.html | WV-13 | Keyboard path across filter, table, and drawer |
| WV-16 | S | docs | WV-13 | README: viewer is read-only |
