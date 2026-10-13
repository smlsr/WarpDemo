# WarpEdit tickets (14)

Generated from `WARPDEMO/tools/tickets_edit.py`. The schema is `tickets/schema.json`. Paths are repo-root-relative.

## WE-01 — Editor scaffold on WarpView's modules, and the read-only audit

Size **S** (4h) · gate **G0** · lane platform · slot 1 · T+0h → T+4h · ★ critical · blocked by view:WV-15

**Why.** WarpEdit is the WarpView screens plus one change: reset a ticket's phase. Building it as a second copy of the viewer would fork the model and the screens on day one. It must import WarpView's modules, add its controls only through WarpView's hooks, and prove before any edit work starts that the viewer itself cannot change a phase, so the two products stay separate.

**What.**

1. `WARPDEMO/WarpEdit/app/package.json` with scripts `test` (`node --test`), `build` (`WARPDEMO/WarpEdit/app/dist/editor.html`) and `release` (`WARPDEMO/WarpEdit/editor.html`); devDependencies pinned like WarpView (esbuild 0.24.0, jsdom 25.0.1).
2. `WARPDEMO/WarpEdit/app/build.mjs`: entry `src/main.mjs`, CSS from `WARPDEMO/WarpView/app/src/**/*.css` (styles first) then `WARPDEMO/WarpEdit/app/src/**/*.css`, shell from `WARPDEMO/WarpView/app/src/shell.html` with the title 'Warp Editor' and the badge 'Editing'.
3. `src/main.mjs`: `createApp({root, plugins})` imported from `WARPDEMO/WarpView/app/src/main.mjs` with the plugins listed in `src/plugins.mjs` (append-only: each later ticket adds one import and one array entry).
4. `WARPDEMO/WarpEdit/app/test/audit.test.mjs`: the audit of SPEC §2 over `WARPDEMO/WarpView/app/src/`: no assignment to a ticket's status outside load/parse, no data-edit attribute, no 'Reset' label; it lists the thirteen phases of SPEC §3.

**Acceptance.**

- **AC-1** (happy) Given WarpView merged through WV-15, when `npm --prefix WARPDEMO/WarpEdit/app ci && npm --prefix WARPDEMO/WarpEdit/app run build` runs, then `WARPDEMO/WarpEdit/app/dist/editor.html` opens with the WarpView empty state, the title 'Warp Editor' and the 'Editing' badge.
- **AC-2** (happy) Given the audit, when run over WarpView's src, then it passes and prints the thirteen phases.
- **AC-3** (negative) Given a test copy of WarpView's drawer that sets ticket.status, when the audit runs on that copy, then it fails naming the file and line.
- **AC-4** (edge) Given plugins.mjs with an empty plugin list, when the editor builds, then it behaves exactly like the viewer (no edit control) — the plugins carry every edit feature.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then audit.test.mjs and the build test pass.

**Locks.** `WARPDEMO/WarpEdit/app/package.json`, `WARPDEMO/WarpEdit/app/build.mjs`, `WARPDEMO/WarpEdit/app/.gitignore`, `WARPDEMO/WarpEdit/app/src/main.mjs`, `WARPDEMO/WarpEdit/app/src/plugins.mjs`, `WARPDEMO/WarpEdit/app/test/`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [WarpView SPEC (model, screens, hooks)](../../../WARPDEMO/WarpView/spec/SPEC.md) · [WarpView design of record](../../../WARPDEMO/WarpView/ui/reference/warp-dashboard.html)

## WE-02 — Edit store: change log, undo and redo, unsaved count

Size **M** (7h) · gate **G1** · lane model · slot 1 · T+4h → T+11h · ★ critical · blocked by WE-01

**Why.** Every reset must be reversible until the file is saved, and the editor must always know what changed since load. Without a change log, undo would have to guess the old status, dependents' statuses would be lost, and save could not say how many changes it is writing. The store is the one place edits happen; screens only read it.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/store/store.mjs` per SPEC §4.
2. `createEditStore(beam)` keeps the loaded document untouched and a working copy.
3. `apply(change)` where a change is `{ticket, from, to, at, note, by, dependents:[{id, from, to}]}`; returns the new working copy.
4. `undo()` and `redo()` with a 50-step history; a new change after an undo clears the redo stack.
5. `dirty` count = changes applied and not undone since load or the last save; `markSaved()`.
6. `subscribe(fn)` called with `{reason, change}`.
7. Never mutate the loaded document or a previous working copy (copy-on-write, tested with Object.freeze).

**Acceptance.**

- **AC-1** (happy) Given `WARPDEMO/WarpEdit/fixtures/beam.sample.json`, when a change WV-07 merged→coding is applied, then working.tickets['WV-07'].status is coding, dirty is 1 and the loaded beam still says merged.
- **AC-2** (happy) Given two changes then undo, when redo runs, then the state equals the state after two changes and dirty is 2.
- **AC-3** (edge) Given 55 changes, when undo runs 60 times, then only 50 are undone and the 51st-oldest change remains.
- **AC-4** (negative) Given a frozen loaded beam, when apply runs, then nothing throws (no mutation of frozen objects).
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then store.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/store/`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md)

## WE-03 — Phase menu: allowed targets, same-phase and unknown refused

Size **S** (4h) · gate **G1** · lane model · slot 2 · T+4h → T+8h · blocked by WE-01

**Why.** A person must only be offered phases Warp understands, must not 'reset' a ticket onto the phase it is already in, and must get a clear message when a file carries a phase this editor does not know. The menu is used by the drawer, the confirm dialog and validation, so the rule belongs in one module.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/phases/phases.mjs` per SPEC §3.
2. `PHASES`: queued, claimed, planning, coding, review, fix, awaiting_approval, merging, merged, done, blocked, alarm, skipped (the thirteen the old WarpView listed; recovering and bugbot_running display but are not targets).
3. `targetsFrom(status)`: every phase except the current one; from merged, done or skipped the list is the earlier phases plus blocked and alarm (no other terminal phase).
4. `check(from, to)` returns ok, same (no-op with the message 'WV-07 is already merged'), or unknown (message names the phase).
5. Labels via WarpView's statusText and colors via catColor.

**Acceptance.**

- **AC-1** (happy) Given status merged, when targetsFrom runs, then it returns queued, claimed, planning, coding, review, fix, awaiting_approval, merging, blocked, alarm in that order.
- **AC-2** (happy) Given status coding, when targetsFrom runs, then it returns the twelve other phases including merged and done.
- **AC-3** (negative) Given from merged and to merged, when check runs, then it returns same with the message naming the ticket and the phase; skipped to skipped likewise.
- **AC-4** (edge) Given to 'teleporting', when check runs, then it returns unknown naming 'teleporting'.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then phases.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/phases/`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md)

## WE-04 — Reset a ticket's phase: event, reset log, timestamps kept

Size **L** (11h) · gate **G1** · lane model · slot 1 · T+11h → T+22.5h · ★ critical · blocked by WE-02, WE-03

**Why.** This is the product: put a merged ticket back on an earlier phase so Warp works it again, without losing what happened. Deleting timestamps or zeroing tokens would erase the record of the first attempt and make the totals lie. The reset must change only the status, record who, when and why in the same event shape Warp already writes, and leave everything else exactly as loaded.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/reset/reset.mjs` per SPEC §5.
2. `buildReset(beam, id, to, note, at, by)` returns a change for the store (from = current status) after `check`.
3. `applyReset(beam, change)` returns a new beam where: status = to; `events` gains `{at, type:'status', from, to, by:'warpedit', note}`; `resets` gains `{from, to, at, note}`; pr.*, jira.*, claimedAt, tokens, minutes, usage, attempts and every timestamp are unchanged; `alarm` is cleared only when leaving alarm.
4. `revertReset` for undo restores the exact prior ticket (events and resets entries removed).
5. Jira is not touched; SPEC §5.4 explains what Warp does next.

**Acceptance.**

- **AC-1** (happy) Given WV-07 merged in `WARPDEMO/WarpEdit/fixtures/beam.sample.json`, when reset to coding with note 'flaky test' at 2026-10-12T19:30:00Z, then the ticket equals `WARPDEMO/WarpEdit/fixtures/expected/reset.WV-07.coding.json`.
- **AC-2** (happy) Given the same reset, when compared field by field, then pr.mergedAt, pr.openedAt, tokens, minutes and usage are unchanged.
- **AC-3** (negative) Given to equal to the current status, when buildReset runs, then it returns the same-phase refusal and no change.
- **AC-4** (edge) Given a reset then revertReset, when compared with the loaded ticket, then they are deeply equal.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then reset.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/reset/`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [Expected output: reset.WV-07.coding.json](../../../WARPDEMO/WarpEdit/fixtures/expected/reset.WV-07.coding.json)

## WE-05 — Dependents of an un-merged ticket go back to blocked

Size **M** (7h) · gate **G1** · lane model · slot 1 · T+22.5h → T+29.5h · ★ critical · blocked by WE-04

**Why.** When a merged ticket goes back to coding, the tickets that depend on it are no longer unblocked. If they stay queued, Warp's ready set would start them on a base that is about to change. The editor must find every affected dependent, set the queued ones to blocked, warn about the ones already in flight or merged, and put all of them back on undo.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/dependents/dependents.mjs` per SPEC §6.
2. `dependentsOf(run, id)`: transitive dependents through deps and after (cross-run `run:id` entries ignored).
3. `planDependents(run, id, from, to)`: only when from is merged or done and to is not terminal: queued dependents → blocked; claimed through merging → unchanged with a warning; merged/done → unchanged and listed 'already merged on top'.
4. The result fills `change.dependents` (id, from, to) so the store applies and undoes them with the reset.
5. Uses WarpView's ready rule only to explain, never to start anything.

**Acceptance.**

- **AC-1** (happy) Given WV-07 merged and its queued dependents in `WARPDEMO/WarpEdit/fixtures/beam.sample.json`, when reset to coding, then exactly the ids in `WARPDEMO/WarpEdit/fixtures/expected/dependents.WV-07.json` go to blocked.
- **AC-2** (happy) Given a dependent already coding, when planned, then it is listed with a warning and its status is unchanged.
- **AC-3** (edge) Given reset from skipped to queued, when planned, then dependents are unchanged (skipped never unblocked them in Warp's merge sense).
- **AC-4** (negative) Given undo of that reset, when applied, then every dependent's status equals its status before the reset.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then dependents.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/dependents/`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [Expected output: dependents.WV-07.json](../../../WARPDEMO/WarpEdit/fixtures/expected/dependents.WV-07.json)

## WE-06 — Confirm dialog: ticket, from and to phase, dependents, note

Size **S** (4h) · gate **G1** · lane console · slot 2 · T+8h → T+12h · blocked by WE-03

**Why.** A reset is easy to make by accident and changes what Warp does next. The person must see exactly what will happen before it happens: which ticket, from which phase to which, which dependents it blocks, and room for a note that goes into the event. Cancel must leave nothing behind.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/confirm/confirm.mjs` and `confirm.css` per SPEC §7.2.
2. `confirmReset({ticket, from, to, dependents})` returns a promise of `{ok, note}`.
3. Modal: title 'Reset <id>', the sentence '<from> → <to>' with both phase chips in their colors, the dependents list (blocked, warned, already merged), a note textarea (optional, 500 characters), buttons Cancel and Reset.
4. Focus starts on Cancel, Tab cycles inside, Escape and the scrim cancel.
5. Uses WarpView tokens only.

**Acceptance.**

- **AC-1** (happy) Given WV-07 merged → coding with two blocked dependents, when the dialog opens, then it matches `WARPDEMO/WarpEdit/ui/screens/edit-confirm.png`.
- **AC-2** (happy) Given a note typed and Reset clicked, when resolved, then the promise gives ok true and the note.
- **AC-3** (negative) Given Escape, the scrim or Cancel, when pressed, then the promise gives ok false and no change reaches the store.
- **AC-4** (edge) Given a 600-character note, when typed, then it stops at 500 characters.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then confirm.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/confirm/`

**Screens.** `WARPDEMO/WarpEdit/ui/screens/edit-confirm.png`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [WarpView design of record](../../../WARPDEMO/WarpView/ui/reference/warp-dashboard.html) · [Confirm reset](../../../WARPDEMO/WarpEdit/ui/screens/edit-confirm.png)

## WE-07 — Undo, redo and unsaved count in the header

Size **M** (7h) · gate **G1** · lane console · slot 3 · T+11h → T+18h · blocked by WE-02

**Why.** People make several resets, change their mind, and close tabs. They need to see that there are unsaved changes, step back and forward through them with the usual keys, and be warned before losing them. Without this the store's undo exists but nobody can reach it.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/history/history.mjs` and `history.css` per SPEC §7.3, registered through WarpView's `headerActions` hook.
2. A chip 'n unsaved' (hidden at 0), buttons Undo and Redo (disabled when empty) with tooltips naming the change ('Undo WV-07 merged → coding').
3. Keys Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z through the `keys` hook, ignored while typing in an input.
4. beforeunload asks when unsaved changes exist.
5. A toast after each undo or redo.

**Acceptance.**

- **AC-1** (happy) Given one reset, when the header renders, then it matches `WARPDEMO/WarpEdit/ui/screens/edit-header.png` (1 unsaved, Undo enabled, Redo disabled).
- **AC-2** (happy) Given Ctrl+Z then Ctrl+Shift+Z, when pressed outside inputs, then the reset is undone and redone and the count goes 1 → 0 → 1.
- **AC-3** (edge) Given focus in the search box, when Ctrl+Z is pressed, then the browser's text undo runs and the store is unchanged.
- **AC-4** (negative) Given zero unsaved changes, when the page unloads, then no confirmation is asked.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then history.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/history/`

**Screens.** `WARPDEMO/WarpEdit/ui/screens/edit-header.png`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [WarpView SPEC (model, screens, hooks)](../../../WARPDEMO/WarpView/spec/SPEC.md) · [Unsaved changes](../../../WARPDEMO/WarpEdit/ui/screens/edit-header.png)

## WE-08 — Validate before save: missing ids, cycles, reset log

Size **M** (7h) · gate **G1** · lane quality · slot 2 · T+22.5h → T+29.5h · blocked by WE-04

**Why.** A saved file goes back into Warp. A dependency on an id that does not exist, a cycle, or a reset log that does not end at the ticket's status would make Warp hold tickets forever or start them too early. The editor must refuse to save such a file and name each problem and its ticket.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/validate/validate.mjs` per SPEC §8.
2. `validate(beam)` returns `{errors, warnings}`, each `{code, ticket, message}`.
3. Errors: dep-missing (a dep id not in the run and not of the form run:id), cycle (names the cycle path), duplicate-id, reset-log (the last resets entry's `to` differs from status), unknown-status.
4. Warnings: merged-on-unmerged (a merged ticket whose in-run dependency is not merged), dependents in flight after a reset.
5. Messages start with the ticket id.

**Acceptance.**

- **AC-1** (happy) Given `WARPDEMO/WarpEdit/fixtures/beam.sample.json` unchanged, when validated, then there are no errors.
- **AC-2** (negative) Given `WARPDEMO/WarpEdit/fixtures/invalid/missing-dep.json` (WV-09 depends on WV-99), when validated, then one error dep-missing says 'WV-09 depends on WV-99, which is not in this run'.
- **AC-3** (negative) Given `WARPDEMO/WarpEdit/fixtures/invalid/cycle.json`, when validated, then one error cycle names 'WV-10 → WV-11 → WV-10'.
- **AC-4** (edge) Given a dependency written view:WV-15 in the edit run, when validated, then it is not reported.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then validate.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/validate/`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md)

## WE-09 — Save in the loaded shape; copy the edits as Warp commands

Size **M** (7h) · gate **G1** · lane model · slot 1 · T+29.5h → T+36.5h · blocked by WE-04, WE-08

**Why.** An edit is worth nothing until Warp sees it. People load a beam.json from a .warp folder or a WARP_PLAN.json export; the saved file must have the same shape so it can go straight back, and must carry the status and the reset log. Some people would rather run Warp's own command than replace a file, so the same edits must be available as commands.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/save/save.mjs` per SPEC §9.
2. `serialize(loaded, working)`: a beam keeps every key of the loaded beam, with each ticket's status, events and resets from the working copy and `editedAt` and `editedBy: 'warpedit'` added at top level; a `kind: warp-plan` export keeps its shape, gets each ticket's status and resets and a new `exportedAt`.
3. status.json and a plan's schedule.json (build-schedule/2) cannot be saved (messages of SPEC §9); a beam scanned from a schedule keeps its lane, repo, priority gate, checks and planned fields untouched.
4. File name: the loaded name.
5. `download(name, text)` with a Blob.
6. `asCommands(changes)`: one line per change `python3 .cursor/plugins/warp/scripts/beam.py set --beam .warp/beam.json --id <id> --status <to>`, dependents included, in order.
7. Refuses when validate returns errors.

**Acceptance.**

- **AC-1** (happy) Given `WARPDEMO/WarpEdit/fixtures/beam.sample.json` with WV-07 reset to coding, when serialized, then the output equals `WARPDEMO/WarpEdit/fixtures/expected/saved.beam.json` apart from editedAt.
- **AC-2** (happy) Given `WARPDEMO/WarpEdit/fixtures/WARP_PLAN.sample.json` with the same reset, when serialized, then kind stays warp-plan, the ticket has status coding and resets, and jiraKey is kept.
- **AC-3** (happy) Given the reset and two blocked dependents, when asCommands runs, then three beam.py set lines result in that order.
- **AC-4** (negative) Given `WARPDEMO/WarpEdit/fixtures/status.sample.json` loaded, when Save is asked, then it refuses with 'Open beam.json to save edits'.
- **AC-5** (edge) Given `WARPDEMO/WarpView/plan/schedule.json` loaded, when Save is asked, then it refuses with 'schedule.json is the plan: open beam.json to save edits'; given `WARPDEMO/WarpEdit/fixtures/beam.sample.json`, the saved WV-07 keeps planned, lane and priorityGate as loaded.
- **AC-6** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then save.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/save/`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [Expected output: saved.beam.json](../../../WARPDEMO/WarpEdit/fixtures/expected/saved.beam.json)

## WE-10 — Drawer Reset section: phase menu, button and reset log

Size **M** (7h) · gate **G2** · lane console · slot 2 · T+36.5h → T+43.5h · blocked by WE-04, WE-05, WE-06

**Why.** The drawer is where people already look at a ticket, so it is where they reset it. The section must offer only allowed phases, go through the confirm dialog, and show the ticket's reset history both from this session and from a file saved earlier, so a reload shows what was done and why.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/drawer-panel/panel.mjs` and `panel.css` per SPEC §7.1, registered with WarpView's `drawerSections` hook and added to `WARPDEMO/WarpEdit/app/src/plugins.mjs` (append-only).
2. Section 'Reset phase': the phase select from targetsFrom, a Reset button, and the dependents preview.
3. Reset → confirmReset → store.apply with the dependents plan.
4. 'Reset log': every entry of resets[] (from the file) and session changes not yet saved, newest first, with from → to, time and note; unsaved entries marked.
5. The drawer re-renders after each change.
6. A run of kind schedule (a plan's schedule.json) shows only the line 'schedule.json is the plan: open beam.json to reset a phase'.

**Acceptance.**

- **AC-1** (happy) Given WV-07 merged, when its drawer opens, then the Reset section matches `WARPDEMO/WarpEdit/ui/screens/edit-drawer.png`.
- **AC-2** (happy) Given coding chosen and confirmed with a note, when applied, then the drawer shows status coding and a reset log entry with the note, marked unsaved.
- **AC-3** (edge) Given `WARPDEMO/WarpEdit/fixtures/expected/saved.beam.json` loaded, when WV-07's drawer opens, then the reset log lists the saved entry, not marked unsaved.
- **AC-4** (negative) Given the confirm dialog cancelled, when the drawer re-renders, then status and log are unchanged.
- **AC-5** (edge) Given `WARPDEMO/WarpView/plan/schedule.json` loaded, when WV-07's drawer opens, then the Reset section holds only 'schedule.json is the plan: open beam.json to reset a phase' and no select or button.
- **AC-6** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then panel.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/drawer-panel/`

**Screens.** `WARPDEMO/WarpEdit/ui/screens/edit-drawer.png`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [WarpView SPEC (model, screens, hooks)](../../../WARPDEMO/WarpView/spec/SPEC.md) · [Drawer with reset](../../../WARPDEMO/WarpEdit/ui/screens/edit-drawer.png)

## WE-11 — Totals, legend and every view follow each reset

Size **L** (11h) · gate **G2** · lane console · slot 1 · T+36.5h → T+48h · ★ critical · blocked by WE-04, WE-05

**Why.** After a reset the screens must tell the truth at once: the ticket moves out of Completed, its block is no longer cleared, the gate may go back to pending, totals and utilization shift, and the board and table follow. If any pane lags, people save a file they did not mean to. Tokens and minutes stay; they were spent.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/recompute/recompute.mjs` per SPEC §10.
2. Subscribe to the edit store; on each change build runs from the working copy with WarpView's buildRuns and call `store.replaceRuns(runs, 'edit')`, which reruns blocks, plan and metrics.
3. A block with a reset ticket is no longer cleared; a green gate whose member is no longer merged shows 'pending (edited)' until saved — Warp recomputes gates itself on the next tick.
4. Keep the current tab, view, filters, zoom and scroll.
5. Utilization: active rises when a ticket enters claimed through merging; tokens and minutes are unchanged.

**Acceptance.**

- **AC-1** (happy) Given `WARPDEMO/WarpEdit/fixtures/beam.sample.json` and WV-07 reset to coding, when panes re-render, then legend, cards and utilization equal `WARPDEMO/WarpEdit/fixtures/expected/after-reset.metrics.json`.
- **AC-2** (happy) Given the board by block, when WV-07 is reset, then its lane loses the cleared pill and shows one more in progress.
- **AC-3** (edge) Given the table sorted by Merged and a search typed, when a reset happens, then sort, search and scroll position are kept.
- **AC-4** (negative) Given any reset, when totals are compared, then total tokens and minutes are unchanged.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then recompute.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/recompute/`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [Expected output: after-reset.metrics.json](../../../WARPDEMO/WarpEdit/fixtures/expected/after-reset.metrics.json) · [WarpView SPEC (model, screens, hooks)](../../../WARPDEMO/WarpView/spec/SPEC.md)

## WE-12 — Phase scrubber on the actual swimlane

Size **XL** (16h) · gate **G2** · lane console · slot 1 · T+48h → T+64.5h · ★ critical · blocked by WE-11

**Why.** Before resetting a ticket people want to see the run as it was: what was merged when a bad change landed, and what started on top of it. A time slider over the actual clock that recolors each bar by its phase at that moment, with reset events marked, answers that without reading event logs, and shows the effect of the resets made in this session.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/scrubber/scrubber.mjs` and `scrubber.css` per SPEC §11, registered through WarpView's `swimlaneOverlays` hook (actual clock only).
2. A slider from 0 to the now line in 0.25 h steps with the time shown as '+h · stamp'.
3. `phaseAt(ticket, t)`: replay status events up to t; before the first event the ticket is queued.
4. Bars recolor by phaseAt; bars that start after t are hidden.
5. Reset events (by warpedit) draw a marker with a tooltip 'from → to, note'.
6. 'Back to now' resets the slider; leaving the actual clock hides it.

**Acceptance.**

- **AC-1** (happy) Given `WARPDEMO/WarpEdit/fixtures/beam.sample.json` with WV-07 reset, when the slider is at +20h, then the screen matches `WARPDEMO/WarpEdit/ui/screens/edit-scrubber.png` and each bar's color equals `WARPDEMO/WarpEdit/fixtures/expected/scrub.+20.json`.
- **AC-2** (happy) Given the slider at the now line, when compared, then every bar has its current status color.
- **AC-3** (edge) Given a ticket with no events, when scrubbed, then it shows queued before its claim and its current status after.
- **AC-4** (negative) Given the plan clock, when the swimlane renders, then no slider or reset marker appears.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then scrubber.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/scrubber/`

**Screens.** `WARPDEMO/WarpEdit/ui/screens/edit-scrubber.png`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [Expected output: scrub.+20.json](../../../WARPDEMO/WarpEdit/fixtures/expected/scrub.+20.json) · [WarpView SPEC (model, screens, hooks)](../../../WARPDEMO/WarpView/spec/SPEC.md) · [Phase scrubber](../../../WARPDEMO/WarpEdit/ui/screens/edit-scrubber.png)

## WE-13 — Save button, validation banner and Copy as commands

Size **M** (7h) · gate **G2** · lane console · slot 3 · T+36.5h → T+43.5h · blocked by WE-07, WE-09

**Why.** Save is the last step and the riskiest. People must see when it is blocked and why, which ticket to fix, get the file under the name they loaded, and have the commands to apply the same edits through Warp instead. Without this the save module has no button and validation has no voice.

**What.**

1. Create `WARPDEMO/WarpEdit/app/src/edit/save-ui/save-ui.mjs` and `save-ui.css` per SPEC §7.4, through the `headerActions` hook.
2. Save button: disabled when nothing is unsaved or validate has errors; on click serialize, download, `markSaved()` and toast 'Saved <name> (n changes)'.
3. Validation banner under the header when errors exist: each error with its ticket id as a button that opens the drawer; warnings in a lighter style.
4. 'Copy as commands' copies asCommands() to the clipboard and toasts the line count.
5. A status.json or schedule.json load shows Save disabled with the reason of SPEC §7.4 as tooltip.

**Acceptance.**

- **AC-1** (happy) Given one valid reset, when Save is clicked, then a download named beam.json starts, unsaved goes to 0 and the toast names the file.
- **AC-2** (happy) Given `WARPDEMO/WarpEdit/fixtures/invalid/missing-dep.json` loaded and edited, when the header renders, then Save is disabled and the banner matches `WARPDEMO/WarpEdit/ui/screens/edit-validation.png`.
- **AC-3** (happy) Given Copy as commands, when clicked, then the clipboard holds one beam.py line per change.
- **AC-4** (negative) Given clipboard access is denied, when Copy is clicked, then a toast says so and shows the commands in a dialog to copy by hand.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then save-ui.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/app/src/edit/save-ui/`

**Screens.** `WARPDEMO/WarpEdit/ui/screens/edit-header.png`, `WARPDEMO/WarpEdit/ui/screens/edit-validation.png`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [Unsaved changes](../../../WARPDEMO/WarpEdit/ui/screens/edit-header.png) · [Save blocked](../../../WARPDEMO/WarpEdit/ui/screens/edit-validation.png)

## WE-14 — Release editor.html: round trip, audit again, README

Size **L** (11h) · gate **G3** · lane release · slot 1 · T+64.5h → T+76h · ★ critical · blocked by WE-10, WE-11, WE-12, WE-13

**Why.** The editor ships as one file, and the only proof that it works is a round trip: reset, save, load the saved file, and see the same status, the reset log and every old timestamp. The viewer must still have no edit control after both runs have merged. The README must tell people how the edit reaches Warp.

**What.**

1. `npm --prefix WARPDEMO/WarpEdit/app run release` writes `WARPDEMO/WarpEdit/editor.html`; commit it.
2. `WARPDEMO/WarpEdit/app/test/roundtrip.test.mjs`: load `WARPDEMO/WarpEdit/fixtures/beam.sample.json` in the built editor (jsdom), reset WV-07 to coding with a note, save, load the saved text, compare status, events, resets, pr.mergedAt and jiraKey; repeat with `WARPDEMO/WarpEdit/fixtures/WARP_PLAN.sample.json`.
3. Re-run the WE-01 audit against `WARPDEMO/WarpView/viewer.html`.
4. `WARPDEMO/WarpEdit/app/README.md`: what the editor does and does not do, how to apply a saved beam (pause the run, replace .warp/beam.json, start) or run the copied commands, and that Jira is not changed by a reset.

**Acceptance.**

- **AC-1** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app run release`, when run, then `WARPDEMO/WarpEdit/editor.html` is written, under 450 kB, and opens from disk.
- **AC-2** (happy) Given the round trip on the beam and on the export, when compared, then status, resets, events, old pr.mergedAt and jiraKey survive.
- **AC-3** (negative) Given `WARPDEMO/WarpView/viewer.html`, when audited, then it still has no data-edit element and no Reset control.
- **AC-4** (edge) Given a saved file loaded into the viewer (not the editor), when its drawer opens, then the status and timestamps show and no reset control appears.
- **AC-5** (happy) Given `npm --prefix WARPDEMO/WarpEdit/app test`, when run, then roundtrip.test.mjs passes.

**Locks.** `WARPDEMO/WarpEdit/editor.html`, `WARPDEMO/WarpEdit/app/README.md`, `WARPDEMO/WarpEdit/app/test/roundtrip.test.mjs`

**Screens.** `WARPDEMO/WarpEdit/ui/screens/edit-drawer.png`, `WARPDEMO/WarpEdit/ui/screens/edit-confirm.png`, `WARPDEMO/WarpEdit/ui/screens/edit-header.png`, `WARPDEMO/WarpEdit/ui/screens/edit-validation.png`, `WARPDEMO/WarpEdit/ui/screens/edit-scrubber.png`

**Links.** [Agent rules (preamble)](../../../WARPDEMO/AGENTS.md) · [SPEC](../../../WARPDEMO/WarpEdit/spec/SPEC.md) · [Acceptance queries](../../../WARPDEMO/WarpEdit/spec/ACCEPTANCE.md) · [Runbook](../../../WARPDEMO/WarpEdit/plan/BUILD_PLAN.md) · [Plan and waves](../../../WARPDEMO/WarpEdit/plan/CURSOR_PLAN.md) · [WarpView design of record](../../../WARPDEMO/WarpView/ui/reference/warp-dashboard.html) · [Drawer with reset](../../../WARPDEMO/WarpEdit/ui/screens/edit-drawer.png) · [Confirm reset](../../../WARPDEMO/WarpEdit/ui/screens/edit-confirm.png) · [Unsaved changes](../../../WARPDEMO/WarpEdit/ui/screens/edit-header.png) · [Save blocked](../../../WARPDEMO/WarpEdit/ui/screens/edit-validation.png) · [Phase scrubber](../../../WARPDEMO/WarpEdit/ui/screens/edit-scrubber.png)
