# WarpEdit — SPEC

Normative. WarpEdit is the WarpView screens (`WARPDEMO/WarpView/spec/SPEC.md`, design of record `WARPDEMO/WarpView/ui/reference/warp-dashboard.html`) plus one change: a person can put a ticket back on another phase, keep its history, and save the run in the shape it was loaded. Screens for the additions are in `WARPDEMO/WarpEdit/ui/screens/`.

## 1. Layout, commands, and the other run

```
WARPDEMO/WarpEdit/
  spec/ plan/ tickets/ fixtures/ ui/      the pack: read-only
  app/
    package.json build.mjs .gitignore
    src/main.mjs                          createApp from WarpView + plugins
    src/plugins.mjs                       APPEND-ONLY plugin list (keep both sides on conflict)
    src/edit/<module>/                    one folder per ticket
    test/                                 audit, round trip, helpers
    README.md
    dist/editor.html                      local build, git-ignored
  editor.html                             released single file (WE-14 only)
```

Commands are WarpView's with `WARPDEMO/WarpEdit/app`: `ci`, `test`, `run build`, `run release`.

WarpEdit runs as Warp run **edit**, after run **view** reaches G2 (`startAfter: view:G2`); WE-01 is also blocked by `view:WV-15`. Everything under `WARPDEMO/WarpView/` is read-only for this run (`paths: WARPDEMO/WarpEdit`): import from it, never edit it. Missing hooks are a WarpView bug, filed against the view run.

The build takes CSS from `WARPDEMO/WarpView/app/src/**/*.css` (styles first) and then `WARPDEMO/WarpEdit/app/src/**/*.css`, and the shell from `WARPDEMO/WarpView/app/src/shell.html` with title "Warp Editor" and an "Editing" badge after the brand.

## 2. Read-only audit (WE-01, again in WE-14)

Over `WARPDEMO/WarpView/app/src/**/*.mjs` (tests excluded) and the released `viewer.html`: no assignment to `.status` of a ticket outside `load/parse/`; no `data-edit` attribute; no control labelled Reset; no download of a beam. The audit prints the thirteen phases of §3.

## 3. Phases

`PHASES` = queued, claimed, planning, coding, review, fix, awaiting_approval, merging, merged, done, blocked, alarm, skipped. (`recovering` and `bugbot_running` exist in beams and display, but are not targets.)

`targetsFrom(status)`:
- from merged, done or skipped: queued, claimed, planning, coding, review, fix, awaiting_approval, merging, blocked, alarm (in that order);
- from anything else: every phase in `PHASES` except the current one.

`check(from, to)`: `same` when equal ("WV-07 is already merged"), `unknown` when `to` is not in `PHASES` ("teleporting is not a Warp phase"), else `ok`.

## 4. Edit store

`createEditStore(beam)` keeps `loaded` (never mutated) and `working` (copy-on-write). A change is `{ticket, from, to, at, note, by: "warpedit", dependents: [{id, from, to, note}]}`. `apply(change)`, `undo()`, `redo()` (history 50; a new change clears redo), `dirty` (changes applied since load or `markSaved()`), `changes()`, `subscribe(fn)` called with `{reason: "apply"|"undo"|"redo"|"saved", change}`.

## 5. Reset

`applyReset(beam, change)` returns a new beam where, for `change.ticket`:
1. `status` = `to`.
2. `events` gains `{at, type: "status", from, to, by: "warpedit", note}` (Warp's event shape plus `by` and `note`).
3. `resets` (created when missing) gains `{from, to, at, note}`.
4. Unchanged: `pr` (all fields, including `mergedAt`), `jira`, `claimedAt`, `tokens`, `minutes`, `usage`, `attempts`, `recoveries`, every other field.
5. `alarm` is cleared only when `from` is alarm.
6. Each `change.dependents` entry sets that ticket's status and appends the same event (note "blocked by reset of <id>").

`revertReset` restores the exact prior tickets (events and resets entries removed). Golden output: `fixtures/expected/reset.WV-07.coding.json`.

### 5.4 What Warp does with it

Warp reads the saved beam on its next start: a ticket on queued, claimed or any open phase is worked again (Warp starts a new Shuttle on its branch), blocked tickets wait. Jira is not changed by WarpEdit; Warp moves the issue on its next status change. A green gate whose member left merged is recomputed by Warp's tick.

## 6. Dependents

Only when `from` is merged or done and `to` is not merged, done or skipped. Transitive dependents through `deps` and `after` (cross-run `run:id` ignored):
- queued → blocked;
- claimed … merging → unchanged, listed with the warning "in flight on top of <id>";
- merged, done → unchanged, listed "already merged on top".

Undo restores every dependent's prior status. Golden output: `fixtures/expected/dependents.WV-07.json`.

## 7. Screens

### 7.1 Drawer section "Reset phase" (`drawerSections`)

Phase select (`targetsFrom`), Reset button (primary), a preview line ("Blocks 2 queued dependents · 1 in flight · 1 already merged"), then "Reset log": entries from `resets[]` and unsaved session changes, newest first: "merged → coding · Oct 13, 08:00 · note", unsaved ones marked "unsaved". Screen: `ui/screens/edit-drawer.png`.

### 7.2 Confirm dialog

Modal over a scrim: title "Reset WV-07", phase chips "merged → coding" in their colors, dependents grouped (will be blocked / in flight / already merged), note textarea (500 characters max), buttons Cancel (focused first) and Reset. Tab cycles inside; Escape and the scrim cancel. Screen: `ui/screens/edit-confirm.png`.

### 7.3 History (`headerActions`, `keys`)

In WarpView's `#actionsBar` (the row under the top bar, tinted with `--c-qa` at 6 %): chip "n unsaved" (hidden at 0), Undo and Redo buttons (disabled when empty; tooltip "Undo WV-07 merged → coding"). Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z outside inputs. `beforeunload` asks only when unsaved. Screen: `ui/screens/edit-header.png`.

### 7.4 Save (`headerActions`)

Save button (primary; disabled when nothing is unsaved, when validation has errors, or for a status.json load with the tooltip "Open beam.json to save edits"); "Copy as commands" button. Validation banner under the header when errors exist: each error with its ticket id as a button that opens the drawer; warnings lighter. Toast "Saved beam.json (n changes)". Screen: `ui/screens/edit-validation.png`.

## 8. Validation

`validate(beam) → {errors, warnings}`, each `{code, ticket, message}`, message starting with the ticket id.

| Code | Kind | Rule |
|---|---|---|
| dep-missing | error | a dependency not in the run and not `run:id` — "WV-09 depends on WV-99, which is not in this run" |
| cycle | error | a dependency cycle — "WV-10 → WV-11 → WV-10" |
| duplicate-id | error | two tickets with one id |
| reset-log | error | the last `resets` entry's `to` differs from `status` |
| unknown-status | error | a status not in Warp's sixteen |
| merged-on-unmerged | warning | merged ticket with an in-run dependency not merged |
| in-flight-dependent | warning | a dependent in flight after a reset |

Fixtures: `fixtures/invalid/missing-dep.json`, `fixtures/invalid/cycle.json`.

## 9. Save

`serialize(loaded, working, kind)`:
- beam → every key of the loaded beam, tickets' `status`, `events`, `resets` from the working copy; top-level `editedAt` (ISO) and `editedBy: "warpedit"`. Golden: `fixtures/expected/saved.beam.json` (editedAt excepted).
- warp-plan export → same shape; each ticket's `status` and `resets`; `exportedAt` = now.
- status.json → refused: "Open beam.json to save edits".
- File name = the loaded name. Download through a Blob URL.

`asCommands(changes)`: one line per change, dependents after their reset, in order:
`python3 .cursor/plugins/warp/scripts/beam.py set --beam .warp/beam.json --id <id> --status <to>`

## 10. Live recompute

On every store event: buildRuns from the working copy (WarpView `load/parse`), `app.store.replaceRuns(runs, "edit")` — blocks, plan, metrics, legend, cards, utilization, swimlane, board and table all re-render. Tab, view, filters, sort, zoom and scroll are kept. A gate that was green and has a member no longer merged shows "pending (edited)". Tokens and minutes never change. Golden: `fixtures/expected/after-reset.metrics.json`.

## 11. Phase scrubber (`swimlaneOverlays`, actual clock only)

Slider from 0 to the now line, 0.25 h steps, label "+h · stamp". `phaseAt(ticket, t)`: replay `events` of type status with `at` ≤ t in time order; before the first such event, queued; if a ticket has no status events, queued before its claim and its status after. Bars recolor to `catColor(catOf(phaseAt))`; bars starting after t hide. Reset events (`by: "warpedit"`) draw a marker on the bar with the tooltip "from → to · note". "Back to now" resets the slider. Golden: `fixtures/expected/scrub.+20.json`. Screen: `ui/screens/edit-scrubber.png`.

## 12. Look

WarpView's tokens only (WarpView SPEC §12). The confirm dialog and banner use `--panel`, `--line2`, `--c-err` for errors, `--c-qa` for warnings, `--brand` for primary buttons.
