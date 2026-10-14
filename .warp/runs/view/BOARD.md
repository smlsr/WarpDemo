# Warp board

Updated 2026-10-13T23:40:51Z · paused=True

- Tickets: **8/16** (50.0%)
- Tokens: **0** · agent minutes: **0**
- Remaining agent-hours: **79** · critical path left: **36h** · ETA ~**36h** at current cap
- Cap: 18 agents · model `claude-sonnet-5-5-high`

## Status

| status | n |
|---|---|
| queued | 2 |
| coding | 6 |
| merged | 8 |

## Gates

| gate | status | members |
|---|---|---|
| G0 Skeleton builds | green | WV-01 |
| G1 Data and model match the reference | green | WV-02, WV-03, WV-04, WV-05, WV-06, WV-07, WV-08 |
| G2 Panes agree | pending | WV-09, WV-10, WV-11, WV-12, WV-13, WV-14, WV-15 |
| G3 Ship | pending | WV-16 |

## Alarms

None.

## Awaiting approval

None.

## In flight

- **WV-09** coding agent=subagent:WV-09 locks=WARPDEMO/WarpView/app/src/view/swimlane
- **WV-10** coding agent=subagent:WV-10 locks=WARPDEMO/WarpView/app/src/view/board
- **WV-13** coding agent=subagent:WV-13 locks=WARPDEMO/WarpView/app/src/view/header
- **WV-11** coding agent=subagent:WV-11 locks=WARPDEMO/WarpView/app/src/view/table
- **WV-12** coding agent=subagent:WV-12 locks=WARPDEMO/WarpView/app/src/view/drawer
- **WV-14** coding agent=subagent:WV-14 locks=WARPDEMO/WarpView/app/src/view/controls

## Merged

- **WV-01** sha=7deac0f2c9f3001ffbad450d9b9ee0dd35e36afa via=none jira=Done — App scaffold: one-file build, test runner, empty page
- **WV-02** sha=ed50e5770838fed2c7e7c2dffa3127e87a5a4567 via=none jira=Done — Theme tokens, layout styles, dark mode, phone width and print
- **WV-03** sha=f4ee7516425b44367b99a73b761f1276a9863c3e via=none jira=Done — Status model: sixteen Warp statuses on six colors
- **WV-04** sha=f7d9a65bedd6e2f42b290ef470af3676c02195d1 via=none jira=Done — Read beam, status, ticket state and export files into runs
- **WV-05** sha=18e622d607be9bdd4f9dbaa63b59e6295e6dbe42 via=none jira=Done — Open files and folders, drag and drop, reload and auto-reload
- **WV-06** sha=4afb35661595ba46dd68ee09735629832e8ceaa7 via=none jira=Done — Gate blocks: assign each ticket to a block and clear blocks
- **WV-07** sha=6706dbfa56de188d5a96aa9c1b0b810f9cd0e08a via=none jira=Done — Planned swimlane and actual timeline layouts
- **WV-08** sha=6104d7c7bfecb3f0a08d8cc0550764641dc7ea6c via=none jira=Done — Run totals: estimate, agent hours, people hours, tickets

## Next ready (starred, then rank)

None — paused, capped, gated, or lock-blocked.
