# BUILD_PLAN — WarpView runbook

16 tickets for `WARPDEMO/WarpView`, run **view**, one orchestrator (Warp) driving up to 18 agents; each ticket merges when green. Rules: `WARPDEMO/WarpView/plan/CURSOR_PLAN.md`. Picture: `WARPDEMO/WarpView/plan/CURSOR_SWIMLANE.pdf`. Data: `WARPDEMO/WarpView/plan/schedule.json`.

## The numbers

| | |
|---|---|
| Tickets | 16 |
| Agent-hours | 127 h |
| Slots | 18 (Warp's default maxAgents) |
| Finish | **T+59h** |
| Critical chain | 56.5 h — WV-01 → WV-06 → WV-07 → WV-09 → WV-15 → WV-16 |
| Peak in flight | 6 |
| Waves (dependency levels) | 6 |
| Finish by slots | 1: T+127.5h · 2: T+83.5h · 4: T+60.5h · 6: T+59h · 8: T+59h · 12: T+59h · 18: T+59h |

The run is chain-bound, not agent-bound: past the slot count where the finish stops falling, more agents do not help; shortening the ★ chain does.

## How to read the clock

- `T+h` is estimate-hours on a continuous clock from the moment the run starts.
- Hours are the size estimates (S=4, M=7, L=11, XL=16). Real runs drift; the order does not.
- L and XL tickets wait 0.5 h for approval before their dependents start.
- A gate block (gateOrder strict) starts when every earlier block has merged.

## Gates

| Gate | Name | Reached | Closes with | Checks | If red |
|---|---|---|---|---|---|
| G0 | Skeleton builds | T+4h | WV-01 ★ | npm --prefix WARPDEMO/WarpView/app ci && npm --prefix WARPDEMO/WarpView/app test; npm --prefix WARPDEMO/WarpView/app run build writes app/dist/viewer.html and it opens empty | Stop: nothing else can be tested until the build and test runner work. |
| G1 | Data and model match the reference | T+22h | WV-05 | npm --prefix WARPDEMO/WarpView/app test (parse, blocks, plan and metrics equal fixtures/expected); tokens.css matches SPEC §12.1 | Do not start the views on a model that disagrees with fixtures/expected; fix the model first. |
| G2 | Panes agree | T+55h | WV-15 ★ | Legend, cards, swimlane, board and table counts agree on every fixture; No control changes a status; createApp hooks work with a test plugin | WarpEdit starts after this gate (startAfter view:G2). If red, the edit run keeps waiting. |
| G3 | Ship | T+59h | WV-16 ★ | viewer.html committed, under 400 kB, parity.test.mjs green | Do not announce the viewer until parity is green. |

## Day 0

1. Repo `smlsr/WarpDemo`, branch `main`, this pack at `WARPDEMO/WarpView/`.
2. `/warp-init view`; config: `paths: WARPDEMO/WarpView`.
3. Jira: import `WARPDEMO/WarpView/tickets/jira-import.json` (project WAR).
4. `/warp-scan WARPDEMO/WarpView` then `/warp-start`.

## Steps

### Step 0 — T+0h

- **Start:**
  - **WV-01 ★** → slot 1 · S·4h · merge ≈ T+4h · no blockers · rank 1
- **In flight:** 1 (WV-01 ★)

### Step 1 — T+4h · G0 reached

- **Merge:** WV-01 ★
- **Gate G0 Skeleton builds:** npm --prefix WARPDEMO/WarpView/app ci && npm --prefix WARPDEMO/WarpView/app test; npm --prefix WARPDEMO/WarpView/app run build writes app/dist/viewer.html and it opens empty
- **Start:**
  - **WV-06 ★** → slot 1 · S·4h · merge ≈ T+8h · unblocked by WV-01 · rank 2
  - **WV-03** → slot 2 · S·4h · merge ≈ T+8h · unblocked by WV-01 · rank 4
  - **WV-02** → slot 3 · S·4h · merge ≈ T+8h · unblocked by WV-01 · rank 5
- **In flight:** 3 (WV-06 ★, WV-03, WV-02)

### Step 2 — T+8h

- **Merge:** WV-02, WV-03, WV-06 ★
- **Start:**
  - **WV-07 ★** → slot 1 · L·11h · merge ≈ T+19.5h · unblocked by WV-06 · rank 3
  - **WV-08** → slot 2 · M·7h · merge ≈ T+15h · unblocked by WV-03, WV-06 · rank 6
  - **WV-04** → slot 3 · M·7h · merge ≈ T+15h · unblocked by WV-03 · rank 8
- **In flight:** 3 (WV-07 ★, WV-08, WV-04)

### Step 3 — T+15h

- **Merge:** WV-04, WV-08
- **Start:**
  - **WV-05** → slot 2 · M·7h · merge ≈ T+22h · unblocked by WV-04 · rank 11
- **In flight:** 2 (WV-07 ★, WV-05)

### Step 4 — T+19h

- **In flight:** 2 (WV-07 ★, WV-05)

### Step 5 — T+19.5h

- **Merge:** WV-07 ★
- **In flight:** 1 (WV-05)

### Step 6 — T+22h · G1 reached

- **Merge:** WV-05
- **Gate G1 Data and model match the reference:** npm --prefix WARPDEMO/WarpView/app test (parse, blocks, plan and metrics equal fixtures/expected); tokens.css matches SPEC §12.1
- **Start:**
  - **WV-09 ★** → slot 1 · XL·16h · merge ≈ T+38.5h · its gate block opened · rank 7
  - **WV-10** → slot 2 · L·11h · merge ≈ T+33.5h · its gate block opened · rank 9
  - **WV-13** → slot 3 · L·11h · merge ≈ T+33.5h · its gate block opened · rank 10
  - **WV-11** → slot 4 · M·7h · merge ≈ T+29h · its gate block opened · rank 12
  - **WV-12** → slot 5 · M·7h · merge ≈ T+29h · its gate block opened · rank 13
  - **WV-14** → slot 6 · M·7h · merge ≈ T+29h · its gate block opened · rank 14
- **In flight:** 6 (WV-09 ★, WV-10, WV-13, WV-11, WV-12, WV-14)

### Step 7 — T+29h

- **Merge:** WV-11, WV-12, WV-14
- **In flight:** 3 (WV-09 ★, WV-10, WV-13)

### Step 8 — T+33h

- **In flight:** 3 (WV-09 ★, WV-10, WV-13)

### Step 9 — T+33.5h

- **Merge:** WV-10, WV-13
- **In flight:** 1 (WV-09 ★)

### Step 10 — T+38h

- **In flight:** 1 (WV-09 ★)

### Step 11 — T+38.5h

- **Merge:** WV-09 ★
- **Start:**
  - **WV-15 ★** → slot 1 · XL·16h · merge ≈ T+55h · unblocked by WV-09 · rank 15
- **In flight:** 1 (WV-15 ★)

### Step 12 — T+54.5h

- **In flight:** 1 (WV-15 ★)

### Step 13 — T+55h · G2 reached

- **Merge:** WV-15 ★
- **Gate G2 Panes agree:** Legend, cards, swimlane, board and table counts agree on every fixture; No control changes a status; createApp hooks work with a test plugin
- **Start:**
  - **WV-16 ★** → slot 1 · S·4h · merge ≈ T+59h · unblocked by WV-15 · rank 16
- **In flight:** 1 (WV-16 ★)

### Step 14 — T+59h · G3 reached

- **Merge:** WV-16 ★
- **Gate G3 Ship:** viewer.html committed, under 400 kB, parity.test.mjs green
- **In flight:** 0 — done

## Trigger table

| Ticket | Rank | Gate | Size | Slot | Start | Merge | Starts when merged | Unlocks |
|---|---|---|---|---|---|---|---|---|
| WV-01 ★ | 1 | G0 | S·4h | 1 | T+0h | T+4h | — | WV-06, WV-03, WV-02 |
| WV-06 ★ | 2 | G1 | S·4h | 1 | T+4h | T+8h | WV-01 | WV-07, WV-08, WV-10 |
| WV-03 | 4 | G1 | S·4h | 2 | T+4h | T+8h | WV-01 | WV-08, WV-09, WV-04, WV-10, WV-11, WV-12, WV-14 |
| WV-02 | 5 | G1 | S·4h | 3 | T+4h | T+8h | WV-01 | WV-09, WV-10, WV-13, WV-11, WV-12, WV-14 |
| WV-07 ★ | 3 | G1 | L·11h | 1 | T+8h | T+19.5h | WV-06 | WV-09, WV-11 |
| WV-08 | 6 | G1 | M·7h | 2 | T+8h | T+15h | WV-03, WV-06 | WV-13 |
| WV-04 | 8 | G1 | M·7h | 3 | T+8h | T+15h | WV-03 | WV-05 |
| WV-05 | 11 | G1 | M·7h | 2 | T+15h | T+22h | WV-04 | WV-15 |
| WV-09 ★ | 7 | G2 | XL·16h | 1 | T+22h | T+38.5h | WV-02, WV-03, WV-07 | WV-15 |
| WV-10 | 9 | G2 | L·11h | 2 | T+22h | T+33.5h | WV-02, WV-03, WV-06 | WV-15 |
| WV-13 | 10 | G2 | L·11h | 3 | T+22h | T+33.5h | WV-02, WV-08 | WV-15 |
| WV-11 | 12 | G2 | M·7h | 4 | T+22h | T+29h | WV-02, WV-03, WV-07 | WV-15 |
| WV-12 | 13 | G2 | M·7h | 5 | T+22h | T+29h | WV-02, WV-03 | WV-15 |
| WV-14 | 14 | G2 | M·7h | 6 | T+22h | T+29h | WV-02, WV-03 | WV-15 |
| WV-15 ★ | 15 | G2 | XL·16h | 1 | T+38.5h | T+55h | WV-05, WV-09, WV-10, WV-11, WV-12, WV-13, WV-14 | WV-16 |
| WV-16 ★ | 16 | G3 | S·4h | 1 | T+55h | T+59h | WV-15 | — |
