# BUILD_PLAN — WarpEdit runbook

14 tickets for `WARPDEMO/WarpEdit`, run **edit**, one orchestrator (Warp) driving up to 18 agents; each ticket merges when green. Rules: `WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md`. Picture: `WARPDEMO/WarpEdit/plan/CURSOR_SWIMLANE.pdf`. Data: `WARPDEMO/WarpEdit/plan/schedule.json`.

## The numbers

| | |
|---|---|
| Tickets | 14 |
| Agent-hours | 110 h |
| Slots | 18 (Warp's default maxAgents) |
| Finish | **T+76h** |
| Critical chain | 69 h — WE-01 → WE-02 → WE-04 → WE-05 → WE-11 → WE-12 → WE-14 |
| Peak in flight | 3 |
| Waves (dependency levels) | 7 |
| Finish by slots | 1: T+110.5h · 2: T+76h · 4: T+76h · 6: T+76h · 8: T+76h · 12: T+76h · 18: T+76h |

The run is chain-bound, not agent-bound: past the slot count where the finish stops falling, more agents do not help; shortening the ★ chain does.

## How to read the clock

- `T+h` is estimate-hours on a continuous clock from the moment the run starts (this run starts when view:G2 is reached).
- Hours are the size estimates (S=4, M=7, L=11, XL=16). Real runs drift; the order does not.
- L and XL tickets wait 0.5 h for approval before their dependents start.
- A gate block (gateOrder strict) starts when every earlier block has merged.

## Gates

| Gate | Name | Reached | Closes with | Checks | If red |
|---|---|---|---|---|---|
| G0 | Editor builds, viewer untouched | T+4h | WE-01 ★ | npm --prefix WARPDEMO/WarpEdit/app ci && npm --prefix WARPDEMO/WarpEdit/app test (audit green); app/dist/editor.html opens with the Editing badge | Stop the edit run: the viewer can change a phase or the editor cannot import it. |
| G1 | Reset is safe | T+36.5h | WE-09 | reset, dependents, validate and save equal fixtures/expected; undo restores the loaded ticket exactly | Do not build screens on a reset that loses data. |
| G2 | Editor screens | T+64.5h | WE-12 ★ | Drawer reset, header actions, banner and scrubber match ui/screens; Totals follow a reset | Fix before release. |
| G3 | Ship | T+76h | WE-14 ★ | editor.html committed; round trip green; viewer audit green | Do not announce the editor until the round trip is green. |

## Day 0

1. Repo `smlsr/WarpDemo`, branch `main`, this pack at `WARPDEMO/WarpEdit/`.
2. `/warp-init edit`; config: `paths: WARPDEMO/WarpEdit`, `startAfter: view:G2`.
3. Jira: import `WARPDEMO/WarpEdit/tickets/jira-import.json` (project WAR).
4. `/warp-scan WARPDEMO/WarpEdit` then `/warp-start`.

## Steps

### Step 0 — T+0h

- **Start:**
  - **WE-01 ★** → slot 1 · S·4h · merge ≈ T+4h · blocker in another run, met when this run starts · rank 1
- **In flight:** 1 (WE-01 ★)

### Step 1 — T+4h · G0 reached

- **Merge:** WE-01 ★
- **Gate G0 Editor builds, viewer untouched:** npm --prefix WARPDEMO/WarpEdit/app ci && npm --prefix WARPDEMO/WarpEdit/app test (audit green); app/dist/editor.html opens with the Editing badge
- **Start:**
  - **WE-02 ★** → slot 1 · M·7h · merge ≈ T+11h · unblocked by WE-01 · rank 2
  - **WE-03** → slot 2 · S·4h · merge ≈ T+8h · unblocked by WE-01 · rank 3
- **In flight:** 2 (WE-02 ★, WE-03)

### Step 2 — T+8h

- **Merge:** WE-03
- **Start:**
  - **WE-06** → slot 2 · S·4h · merge ≈ T+12h · unblocked by WE-03 · rank 11
- **In flight:** 2 (WE-02 ★, WE-06)

### Step 3 — T+11h

- **Merge:** WE-02 ★
- **Start:**
  - **WE-04 ★** → slot 1 · L·11h · merge ≈ T+22.5h · unblocked by WE-02 · rank 4
  - **WE-07** → slot 3 · M·7h · merge ≈ T+18h · unblocked by WE-02 · rank 9
- **In flight:** 3 (WE-04 ★, WE-06, WE-07)

### Step 4 — T+12h

- **Merge:** WE-06
- **In flight:** 2 (WE-04 ★, WE-07)

### Step 5 — T+18h

- **Merge:** WE-07
- **In flight:** 1 (WE-04 ★)

### Step 6 — T+22h

- **In flight:** 1 (WE-04 ★)

### Step 7 — T+22.5h

- **Merge:** WE-04 ★
- **Start:**
  - **WE-05 ★** → slot 1 · M·7h · merge ≈ T+29.5h · unblocked by WE-04 · rank 5
  - **WE-08** → slot 2 · M·7h · merge ≈ T+29.5h · unblocked by WE-04 · rank 7
- **In flight:** 2 (WE-05 ★, WE-08)

### Step 8 — T+29.5h

- **Merge:** WE-05 ★, WE-08
- **Start:**
  - **WE-09** → slot 1 · M·7h · merge ≈ T+36.5h · unblocked by WE-08 · rank 10
- **In flight:** 1 (WE-09)

### Step 9 — T+36.5h · G1 reached

- **Merge:** WE-09
- **Gate G1 Reset is safe:** reset, dependents, validate and save equal fixtures/expected; undo restores the loaded ticket exactly
- **Start:**
  - **WE-11 ★** → slot 1 · L·11h · merge ≈ T+48h · its gate block opened · rank 6
  - **WE-10** → slot 2 · M·7h · merge ≈ T+43.5h · its gate block opened · rank 12
  - **WE-13** → slot 3 · M·7h · merge ≈ T+43.5h · unblocked by WE-09 · rank 13
- **In flight:** 3 (WE-11 ★, WE-10, WE-13)

### Step 10 — T+43.5h

- **Merge:** WE-10, WE-13
- **In flight:** 1 (WE-11 ★)

### Step 11 — T+47.5h

- **In flight:** 1 (WE-11 ★)

### Step 12 — T+48h

- **Merge:** WE-11 ★
- **Start:**
  - **WE-12 ★** → slot 1 · XL·16h · merge ≈ T+64.5h · unblocked by WE-11 · rank 8
- **In flight:** 1 (WE-12 ★)

### Step 13 — T+64h

- **In flight:** 1 (WE-12 ★)

### Step 14 — T+64.5h · G2 reached

- **Merge:** WE-12 ★
- **Gate G2 Editor screens:** Drawer reset, header actions, banner and scrubber match ui/screens; Totals follow a reset
- **Start:**
  - **WE-14 ★** → slot 1 · L·11h · merge ≈ T+76h · unblocked by WE-12 · rank 14
- **In flight:** 1 (WE-14 ★)

### Step 15 — T+76h · G3 reached

- **Merge:** WE-14 ★
- **Gate G3 Ship:** editor.html committed; round trip green; viewer audit green
- **In flight:** 0 — done

## Trigger table

| Ticket | Rank | Gate | Size | Slot | Start | Merge | Starts when merged | Unlocks |
|---|---|---|---|---|---|---|---|---|
| WE-01 ★ | 1 | G0 | S·4h | 1 | T+0h | T+4h | view:WV-15 | WE-02, WE-03 |
| WE-02 ★ | 2 | G1 | M·7h | 1 | T+4h | T+11h | WE-01 | WE-04, WE-07 |
| WE-03 | 3 | G1 | S·4h | 2 | T+4h | T+8h | WE-01 | WE-04, WE-06 |
| WE-06 | 11 | G1 | S·4h | 2 | T+8h | T+12h | WE-03 | WE-10 |
| WE-04 ★ | 4 | G1 | L·11h | 1 | T+11h | T+22.5h | WE-02, WE-03 | WE-05, WE-11, WE-08, WE-09, WE-10 |
| WE-07 | 9 | G1 | M·7h | 3 | T+11h | T+18h | WE-02 | WE-13 |
| WE-05 ★ | 5 | G1 | M·7h | 1 | T+22.5h | T+29.5h | WE-04 | WE-11, WE-10 |
| WE-08 | 7 | G1 | M·7h | 2 | T+22.5h | T+29.5h | WE-04 | WE-09 |
| WE-09 | 10 | G1 | M·7h | 1 | T+29.5h | T+36.5h | WE-04, WE-08 | WE-13 |
| WE-11 ★ | 6 | G2 | L·11h | 1 | T+36.5h | T+48h | WE-04, WE-05 | WE-12, WE-14 |
| WE-10 | 12 | G2 | M·7h | 2 | T+36.5h | T+43.5h | WE-04, WE-05, WE-06 | WE-14 |
| WE-13 | 13 | G2 | M·7h | 3 | T+36.5h | T+43.5h | WE-07, WE-09 | WE-14 |
| WE-12 ★ | 8 | G2 | XL·16h | 1 | T+48h | T+64.5h | WE-11 | WE-14 |
| WE-14 ★ | 14 | G3 | L·11h | 1 | T+64.5h | T+76h | WE-10, WE-11, WE-12, WE-13 | — |
