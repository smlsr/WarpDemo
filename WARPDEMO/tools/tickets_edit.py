"""WarpEdit tickets (run `edit`, prefix WE). Starts after view:G2."""

from common import Pack
from screens import EDIT, VIEW, catalog
import tickets_view

P = Pack("edit")
S = catalog(P, EDIT)
V = catalog(tickets_view.P, VIEW)
A = P.app
F = P.d + "/fixtures"
VA = tickets_view.P.app
TEST = f"npm --prefix {A} test"
REF = {"title": "WarpView design of record", "url": f"{tickets_view.P.d}/ui/reference/warp-dashboard.html"}
VSPEC = {"title": "WarpView SPEC (model, screens, hooks)", "url": f"{tickets_view.P.d}/spec/SPEC.md"}
EXP = lambda name: {"title": f"Expected output: {name}", "url": f"{F}/expected/{name}"}

P.T("WE-01", "Editor scaffold on WarpView's modules, and the read-only audit",
    size="S", lane="platform", gate="G0", deps=["view:WV-15"], critical_hint=True,
    locks=[f"{A}/package.json", f"{A}/build.mjs", f"{A}/.gitignore", f"{A}/src/main.mjs", f"{A}/src/plugins.mjs", f"{A}/test/"],
    why="""WarpEdit is the WarpView screens plus one change: reset a ticket's phase. Building it as a second copy of
    the viewer would fork the model and the screens on day one. It must import WarpView's modules, add its controls
    only through WarpView's hooks, and prove before any edit work starts that the viewer itself cannot change a
    phase, so the two products stay separate.""",
    what=f"""1. `{A}/package.json` with scripts `test` (`node --test`), `build` (`{A}/dist/editor.html`) and
    `release` (`{P.d}/editor.html`); devDependencies pinned like WarpView (esbuild 0.24.0, jsdom 25.0.1). 2.
    `{A}/build.mjs`: entry `src/main.mjs`, CSS from `{VA}/src/**/*.css` (styles first) then `{A}/src/**/*.css`,
    shell from `{VA}/src/shell.html` with the title 'Warp Editor' and the badge 'Editing'. 3. `src/main.mjs`:
    `createApp({{root, plugins}})` imported from `{VA}/src/main.mjs` with the plugins listed in `src/plugins.mjs`
    (append-only: each later ticket adds one import and one array entry). 4. `{A}/test/audit.test.mjs`: the audit of
    SPEC §2 over `{VA}/src/`: no assignment to a ticket's status outside load/parse, no data-edit attribute, no
    'Reset' label; it lists the thirteen phases of SPEC §3.""",
    acs=[
        ("happy", f"Given WarpView merged through WV-15, when `npm --prefix {A} ci && npm --prefix {A} run build` runs, then `{A}/dist/editor.html` opens with the WarpView empty state, the title 'Warp Editor' and the 'Editing' badge."),
        ("happy", "Given the audit, when run over WarpView's src, then it passes and prints the thirteen phases."),
        ("negative", f"Given a test copy of WarpView's drawer that sets ticket.status, when the audit runs on that copy, then it fails naming the file and line."),
        ("edge", "Given plugins.mjs with an empty plugin list, when the editor builds, then it behaves exactly like the viewer (no edit control) — the plugins carry every edit feature."),
        ("happy", f"Given `{TEST}`, when run, then audit.test.mjs and the build test pass."),
    ],
    links=[P.spec("2"), VSPEC, REF], notes=f"Read-only for this run: everything under `{tickets_view.P.d}/`. Import from it; never edit it.")

P.T("WE-02", "Edit store: change log, undo and redo, unsaved count",
    size="M", lane="model", gate="G1", deps=["WE-01"], critical_hint=True,
    locks=[f"{A}/src/edit/store/"],
    why="""Every reset must be reversible until the file is saved, and the editor must always know what changed
    since load. Without a change log, undo would have to guess the old status, dependents' statuses would be lost,
    and save could not say how many changes it is writing. The store is the one place edits happen; screens only
    read it.""",
    what=f"""Create `{A}/src/edit/store/store.mjs` per SPEC §4. 1. `createEditStore(beam)` keeps the loaded document
    untouched and a working copy. 2. `apply(change)` where a change is `{{ticket, from, to, at, note, by,
    dependents:[{{id, from, to}}]}}`; returns the new working copy. 3. `undo()` and `redo()` with a 50-step history;
    a new change after an undo clears the redo stack. 4. `dirty` count = changes applied and not undone since load
    or the last save; `markSaved()`. 5. `subscribe(fn)` called with `{{reason, change}}`. 6. Never mutate the
    loaded document or a previous working copy (copy-on-write, tested with Object.freeze).""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json`, when a change WV-07 merged→coding is applied, then working.tickets['WV-07'].status is coding, dirty is 1 and the loaded beam still says merged."),
        ("happy", "Given two changes then undo, when redo runs, then the state equals the state after two changes and dirty is 2."),
        ("edge", "Given 55 changes, when undo runs 60 times, then only 50 are undone and the 51st-oldest change remains."),
        ("negative", "Given a frozen loaded beam, when apply runs, then nothing throws (no mutation of frozen objects)."),
        ("happy", f"Given `{TEST}`, when run, then store.test.mjs passes."),
    ],
    links=[P.spec("4")])

P.T("WE-03", "Phase menu: allowed targets, same-phase and unknown refused",
    size="S", lane="model", gate="G1", deps=["WE-01"],
    locks=[f"{A}/src/edit/phases/"],
    why="""A person must only be offered phases Warp understands, must not 'reset' a ticket onto the phase it is
    already in, and must get a clear message when a file carries a phase this editor does not know. The menu is used
    by the drawer, the confirm dialog and validation, so the rule belongs in one module.""",
    what=f"""Create `{A}/src/edit/phases/phases.mjs` per SPEC §3. 1. `PHASES`: queued, claimed, planning, coding,
    review, fix, awaiting_approval, merging, merged, done, blocked, alarm, skipped (the thirteen the old WarpView
    listed; recovering and bugbot_running display but are not targets). 2. `targetsFrom(status)`: every phase except
    the current one; from merged, done or skipped the list is the earlier phases plus blocked and alarm (no other
    terminal phase). 3. `check(from, to)` returns ok, same (no-op with the message 'WV-07 is already merged'), or
    unknown (message names the phase). 4. Labels via WarpView's statusText and colors via catColor.""",
    acs=[
        ("happy", "Given status merged, when targetsFrom runs, then it returns queued, claimed, planning, coding, review, fix, awaiting_approval, merging, blocked, alarm in that order."),
        ("happy", "Given status coding, when targetsFrom runs, then it returns the twelve other phases including merged and done."),
        ("negative", "Given from merged and to merged, when check runs, then it returns same with the message naming the ticket and the phase; skipped to skipped likewise."),
        ("edge", "Given to 'teleporting', when check runs, then it returns unknown naming 'teleporting'."),
        ("happy", f"Given `{TEST}`, when run, then phases.test.mjs passes."),
    ],
    links=[P.spec("3")])

P.T("WE-04", "Reset a ticket's phase: event, reset log, timestamps kept",
    size="L", lane="model", gate="G1", deps=["WE-02", "WE-03"], critical_hint=True,
    locks=[f"{A}/src/edit/reset/"],
    why="""This is the product: put a merged ticket back on an earlier phase so Warp works it again, without losing
    what happened. Deleting timestamps or zeroing tokens would erase the record of the first attempt and make the
    totals lie. The reset must change only the status, record who, when and why in the same event shape Warp
    already writes, and leave everything else exactly as loaded.""",
    what=f"""Create `{A}/src/edit/reset/reset.mjs` per SPEC §5. 1. `buildReset(beam, id, to, note, at, by)` returns a
    change for the store (from = current status) after `check`. 2. `applyReset(beam, change)` returns a new beam
    where: status = to; `events` gains `{{at, type:'status', from, to, by:'warpedit', note}}`; `resets` gains
    `{{from, to, at, note}}`; pr.*, jira.*, claimedAt, tokens, minutes, usage, attempts and every timestamp are
    unchanged; `alarm` is cleared only when leaving alarm. 3. `revertReset` for undo restores the exact prior ticket
    (events and resets entries removed). 4. Jira is not touched; SPEC §5.4 explains what Warp does next.""",
    acs=[
        ("happy", f"Given WV-07 merged in `{F}/beam.sample.json`, when reset to coding with note 'flaky test' at 2026-10-12T19:30:00Z, then the ticket equals `{F}/expected/reset.WV-07.coding.json`."),
        ("happy", "Given the same reset, when compared field by field, then pr.mergedAt, pr.openedAt, tokens, minutes and usage are unchanged."),
        ("negative", "Given to equal to the current status, when buildReset runs, then it returns the same-phase refusal and no change."),
        ("edge", "Given a reset then revertReset, when compared with the loaded ticket, then they are deeply equal."),
        ("happy", f"Given `{TEST}`, when run, then reset.test.mjs passes."),
    ],
    links=[P.spec("5"), EXP("reset.WV-07.coding.json")])

P.T("WE-05", "Dependents of an un-merged ticket go back to blocked",
    size="M", lane="model", gate="G1", deps=["WE-04"],
    locks=[f"{A}/src/edit/dependents/"],
    why="""When a merged ticket goes back to coding, the tickets that depend on it are no longer unblocked. If they
    stay queued, Warp's ready set would start them on a base that is about to change. The editor must find every
    affected dependent, set the queued ones to blocked, warn about the ones already in flight or merged, and put all
    of them back on undo.""",
    what=f"""Create `{A}/src/edit/dependents/dependents.mjs` per SPEC §6. 1. `dependentsOf(run, id)`: transitive
    dependents through deps and after (cross-run `run:id` entries ignored). 2. `planDependents(run, id, from, to)`:
    only when from is merged or done and to is not terminal: queued dependents → blocked; claimed through merging →
    unchanged with a warning; merged/done → unchanged and listed 'already merged on top'. 3. The result fills
    `change.dependents` (id, from, to) so the store applies and undoes them with the reset. 4. Uses WarpView's
    ready rule only to explain, never to start anything.""",
    acs=[
        ("happy", f"Given WV-07 merged and its queued dependents in `{F}/beam.sample.json`, when reset to coding, then exactly the ids in `{F}/expected/dependents.WV-07.json` go to blocked."),
        ("happy", "Given a dependent already coding, when planned, then it is listed with a warning and its status is unchanged."),
        ("edge", "Given reset from skipped to queued, when planned, then dependents are unchanged (skipped never unblocked them in Warp's merge sense)."),
        ("negative", "Given undo of that reset, when applied, then every dependent's status equals its status before the reset."),
        ("happy", f"Given `{TEST}`, when run, then dependents.test.mjs passes."),
    ],
    links=[P.spec("6"), EXP("dependents.WV-07.json")])

P.T("WE-06", "Confirm dialog: ticket, from and to phase, dependents, note",
    size="S", lane="console", gate="G1", deps=["WE-03"],
    locks=[f"{A}/src/edit/confirm/"],
    why="""A reset is easy to make by accident and changes what Warp does next. The person must see exactly what
    will happen before it happens: which ticket, from which phase to which, which dependents it blocks, and room for
    a note that goes into the event. Cancel must leave nothing behind.""",
    what=f"""Create `{A}/src/edit/confirm/confirm.mjs` and `confirm.css` per SPEC §7.2. 1. `confirmReset({{ticket,
    from, to, dependents}})` returns a promise of `{{ok, note}}`. 2. Modal: title 'Reset <id>', the sentence
    '<from> → <to>' with both phase chips in their colors, the dependents list (blocked, warned, already merged),
    a note textarea (optional, 500 characters), buttons Cancel and Reset. 3. Focus starts on Cancel, Tab cycles
    inside, Escape and the scrim cancel. 4. Uses WarpView tokens only.""",
    acs=[
        ("happy", f"Given WV-07 merged → coding with two blocked dependents, when the dialog opens, then it matches `{P.d}/ui/screens/edit-confirm.png`."),
        ("happy", "Given a note typed and Reset clicked, when resolved, then the promise gives ok true and the note."),
        ("negative", "Given Escape, the scrim or Cancel, when pressed, then the promise gives ok false and no change reaches the store."),
        ("edge", "Given a 600-character note, when typed, then it stops at 500 characters."),
        ("happy", f"Given `{TEST}`, when run, then confirm.test.mjs passes."),
    ],
    screens=[S["edit-confirm"]], links=[P.spec("7.2"), REF])

P.T("WE-07", "Undo, redo and unsaved count in the header",
    size="M", lane="console", gate="G1", deps=["WE-02"],
    locks=[f"{A}/src/edit/history/"],
    why="""People make several resets, change their mind, and close tabs. They need to see that there are unsaved
    changes, step back and forward through them with the usual keys, and be warned before losing them. Without this
    the store's undo exists but nobody can reach it.""",
    what=f"""Create `{A}/src/edit/history/history.mjs` and `history.css` per SPEC §7.3, registered through WarpView's
    `headerActions` hook. 1. A chip 'n unsaved' (hidden at 0), buttons Undo and Redo (disabled when empty) with
    tooltips naming the change ('Undo WV-07 merged → coding'). 2. Keys Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z through the
    `keys` hook, ignored while typing in an input. 3. beforeunload asks when unsaved changes exist. 4. A toast after
    each undo or redo.""",
    acs=[
        ("happy", f"Given one reset, when the header renders, then it matches `{P.d}/ui/screens/edit-header.png` (1 unsaved, Undo enabled, Redo disabled)."),
        ("happy", "Given Ctrl+Z then Ctrl+Shift+Z, when pressed outside inputs, then the reset is undone and redone and the count goes 1 → 0 → 1."),
        ("edge", "Given focus in the search box, when Ctrl+Z is pressed, then the browser's text undo runs and the store is unchanged."),
        ("negative", "Given zero unsaved changes, when the page unloads, then no confirmation is asked."),
        ("happy", f"Given `{TEST}`, when run, then history.test.mjs passes."),
    ],
    screens=[S["edit-header"]], links=[P.spec("7.3"), VSPEC])

P.T("WE-08", "Validate before save: missing ids, cycles, reset log",
    size="M", lane="quality", gate="G1", deps=["WE-04"],
    locks=[f"{A}/src/edit/validate/"],
    why="""A saved file goes back into Warp. A dependency on an id that does not exist, a cycle, or a reset log that
    does not end at the ticket's status would make Warp hold tickets forever or start them too early. The editor must
    refuse to save such a file and name each problem and its ticket.""",
    what=f"""Create `{A}/src/edit/validate/validate.mjs` per SPEC §8. 1. `validate(beam)` returns `{{errors,
    warnings}}`, each `{{code, ticket, message}}`. 2. Errors: dep-missing (a dep id not in the run and not of the form
    run:id), cycle (names the cycle path), duplicate-id, reset-log (the last resets entry's `to` differs from status),
    unknown-status. 3. Warnings: merged-on-unmerged (a merged ticket whose in-run dependency is not merged), dependents
    in flight after a reset. 4. Messages start with the ticket id.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json` unchanged, when validated, then there are no errors."),
        ("negative", f"Given `{F}/invalid/missing-dep.json` (WV-09 depends on WV-99), when validated, then one error dep-missing says 'WV-09 depends on WV-99, which is not in this run'."),
        ("negative", f"Given `{F}/invalid/cycle.json`, when validated, then one error cycle names 'WV-10 → WV-11 → WV-10'."),
        ("edge", "Given a dependency written view:WV-15 in the edit run, when validated, then it is not reported."),
        ("happy", f"Given `{TEST}`, when run, then validate.test.mjs passes."),
    ],
    test_data=f"{F}/beam.sample.json, {F}/invalid/",
    links=[P.spec("8")])

P.T("WE-09", "Save in the loaded shape; copy the edits as Warp commands",
    size="M", lane="model", gate="G1", deps=["WE-04", "WE-08"], critical_hint=True,
    locks=[f"{A}/src/edit/save/"],
    why="""An edit is worth nothing until Warp sees it. People load a beam.json from a .warp folder or a WARP_PLAN.json
    export; the saved file must have the same shape so it can go straight back, and must carry the status and the
    reset log. Some people would rather run Warp's own command than replace a file, so the same edits must be
    available as commands.""",
    what=f"""Create `{A}/src/edit/save/save.mjs` per SPEC §9. 1. `serialize(loaded, working)`: a beam keeps every
    key of the loaded beam, with each ticket's status, events and resets from the working copy and `editedAt` and
    `editedBy: 'warpedit'` added at top level; a `kind: warp-plan` export keeps its shape, gets each ticket's status
    and resets and a new `exportedAt`. 2. status.json and a plan's schedule.json (build-schedule/2) cannot be saved
    (messages of SPEC §9); a beam scanned from a schedule keeps its lane, repo, priority gate, checks and planned
    fields untouched. 3. File name:
    the loaded name. 4. `download(name, text)` with a Blob. 5. `asCommands(changes)`: one line per change
    `python3 .cursor/plugins/warp/scripts/beam.py set --beam .warp/beam.json --id <id> --status <to>`, dependents
    included, in order. 6. Refuses when validate returns errors.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json` with WV-07 reset to coding, when serialized, then the output equals `{F}/expected/saved.beam.json` apart from editedAt."),
        ("happy", f"Given `{F}/WARP_PLAN.sample.json` with the same reset, when serialized, then kind stays warp-plan, the ticket has status coding and resets, and jiraKey is kept."),
        ("happy", "Given the reset and two blocked dependents, when asCommands runs, then three beam.py set lines result in that order."),
        ("negative", f"Given `{F}/status.sample.json` loaded, when Save is asked, then it refuses with 'Open beam.json to save edits'."),
        ("edge", f"Given `{tickets_view.P.d}/plan/schedule.json` loaded, when Save is asked, then it refuses with 'schedule.json is the plan: open beam.json to save edits'; given `{F}/beam.sample.json`, the saved WV-07 keeps planned, lane and priorityGate as loaded."),
        ("happy", f"Given `{TEST}`, when run, then save.test.mjs passes."),
    ],
    test_data=f"{F}/beam.sample.json, {F}/WARP_PLAN.sample.json, {F}/status.sample.json, {tickets_view.P.d}/plan/schedule.json",
    links=[P.spec("9"), EXP("saved.beam.json")])

P.T("WE-10", "Drawer Reset section: phase menu, button and reset log",
    size="M", lane="console", gate="G2", deps=["WE-04", "WE-05", "WE-06"],
    locks=[f"{A}/src/edit/drawer-panel/"],
    why="""The drawer is where people already look at a ticket, so it is where they reset it. The section must offer
    only allowed phases, go through the confirm dialog, and show the ticket's reset history both from this session
    and from a file saved earlier, so a reload shows what was done and why.""",
    what=f"""Create `{A}/src/edit/drawer-panel/panel.mjs` and `panel.css` per SPEC §7.1, registered with WarpView's
    `drawerSections` hook and added to `{A}/src/plugins.mjs` (append-only). 1. Section 'Reset phase': the phase select
    from targetsFrom, a Reset button, and the dependents preview. 2. Reset → confirmReset → store.apply with the
    dependents plan. 3. 'Reset log': every entry of resets[] (from the file) and session changes not yet saved,
    newest first, with from → to, time and note; unsaved entries marked. 4. The drawer re-renders after each change.
    5. A run of kind schedule (a plan's schedule.json) shows only the line 'schedule.json is the plan: open beam.json
    to reset a phase'.""",
    acs=[
        ("happy", f"Given WV-07 merged, when its drawer opens, then the Reset section matches `{P.d}/ui/screens/edit-drawer.png`."),
        ("happy", "Given coding chosen and confirmed with a note, when applied, then the drawer shows status coding and a reset log entry with the note, marked unsaved."),
        ("edge", f"Given `{F}/expected/saved.beam.json` loaded, when WV-07's drawer opens, then the reset log lists the saved entry, not marked unsaved."),
        ("negative", "Given the confirm dialog cancelled, when the drawer re-renders, then status and log are unchanged."),
        ("edge", f"Given `{tickets_view.P.d}/plan/schedule.json` loaded, when WV-07's drawer opens, then the Reset section holds only 'schedule.json is the plan: open beam.json to reset a phase' and no select or button."),
        ("happy", f"Given `{TEST}`, when run, then panel.test.mjs passes."),
    ],
    screens=[S["edit-drawer"]], links=[P.spec("7.1"), VSPEC])

P.T("WE-11", "Totals, legend and every view follow each reset",
    size="L", lane="console", gate="G2", deps=["WE-04", "WE-05"],
    locks=[f"{A}/src/edit/recompute/"],
    why="""After a reset the screens must tell the truth at once: the ticket moves out of Completed, its block is no
    longer cleared, the gate may go back to pending, totals and utilization shift, and the board and table follow.
    If any pane lags, people save a file they did not mean to. Tokens and minutes stay; they were spent.""",
    what=f"""Create `{A}/src/edit/recompute/recompute.mjs` per SPEC §10. 1. Subscribe to the edit store; on each
    change build runs from the working copy with WarpView's buildRuns and call `store.replaceRuns(runs, 'edit')`,
    which reruns blocks, plan and metrics. 2. A block with a reset ticket is no longer cleared; a green gate whose
    member is no longer merged shows 'pending (edited)' until saved — Warp recomputes gates itself on the next tick.
    3. Keep the current tab, view, filters, zoom and scroll. 4. Utilization: active rises when a ticket enters
    claimed through merging; tokens and minutes are unchanged.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json` and WV-07 reset to coding, when panes re-render, then legend, cards and utilization equal `{F}/expected/after-reset.metrics.json`."),
        ("happy", "Given the board by block, when WV-07 is reset, then its lane loses the cleared pill and shows one more in progress."),
        ("edge", "Given the table sorted by Merged and a search typed, when a reset happens, then sort, search and scroll position are kept."),
        ("negative", "Given any reset, when totals are compared, then total tokens and minutes are unchanged."),
        ("happy", f"Given `{TEST}`, when run, then recompute.test.mjs passes."),
    ],
    links=[P.spec("10"), EXP("after-reset.metrics.json"), VSPEC])

P.T("WE-12", "Phase scrubber on the actual swimlane",
    size="XL", lane="console", gate="G2", deps=["WE-11"], critical_hint=True,
    locks=[f"{A}/src/edit/scrubber/"],
    why="""Before resetting a ticket people want to see the run as it was: what was merged when a bad change landed,
    and what started on top of it. A time slider over the actual clock that recolors each bar by its phase at that
    moment, with reset events marked, answers that without reading event logs, and shows the effect of the resets
    made in this session.""",
    what=f"""Create `{A}/src/edit/scrubber/scrubber.mjs` and `scrubber.css` per SPEC §11, registered through
    WarpView's `swimlaneOverlays` hook (actual clock only). 1. A slider from 0 to the now line in 0.25 h steps with
    the time shown as '+h · stamp'. 2. `phaseAt(ticket, t)`: replay status events up to t; before the first event the
    ticket is queued. 3. Bars recolor by phaseAt; bars that start after t are hidden. 4. Reset events (by warpedit)
    draw a marker with a tooltip 'from → to, note'. 5. 'Back to now' resets the slider; leaving the actual clock
    hides it.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json` with WV-07 reset, when the slider is at +20h, then the screen matches `{P.d}/ui/screens/edit-scrubber.png` and each bar's color equals `{F}/expected/scrub.+20.json`."),
        ("happy", "Given the slider at the now line, when compared, then every bar has its current status color."),
        ("edge", "Given a ticket with no events, when scrubbed, then it shows queued before its claim and its current status after."),
        ("negative", "Given the plan clock, when the swimlane renders, then no slider or reset marker appears."),
        ("happy", f"Given `{TEST}`, when run, then scrubber.test.mjs passes."),
    ],
    screens=[S["edit-scrubber"]], links=[P.spec("11"), EXP("scrub.+20.json"), VSPEC])

P.T("WE-13", "Save button, validation banner and Copy as commands",
    size="M", lane="console", gate="G2", deps=["WE-07", "WE-09"],
    locks=[f"{A}/src/edit/save-ui/"],
    why="""Save is the last step and the riskiest. People must see when it is blocked and why, which ticket to fix,
    get the file under the name they loaded, and have the commands to apply the same edits through Warp instead.
    Without this the save module has no button and validation has no voice.""",
    what=f"""Create `{A}/src/edit/save-ui/save-ui.mjs` and `save-ui.css` per SPEC §7.4, through the `headerActions`
    hook. 1. Save button: disabled when nothing is unsaved or validate has errors; on click serialize, download,
    `markSaved()` and toast 'Saved <name> (n changes)'. 2. Validation banner under the header when errors exist:
    each error with its ticket id as a button that opens the drawer; warnings in a lighter style. 3. 'Copy as
    commands' copies asCommands() to the clipboard and toasts the line count. 4. A status.json or schedule.json
    load shows Save disabled with the reason of SPEC §7.4 as tooltip.""",
    acs=[
        ("happy", f"Given one valid reset, when Save is clicked, then a download named beam.json starts, unsaved goes to 0 and the toast names the file."),
        ("happy", f"Given `{F}/invalid/missing-dep.json` loaded and edited, when the header renders, then Save is disabled and the banner matches `{P.d}/ui/screens/edit-validation.png`."),
        ("happy", "Given Copy as commands, when clicked, then the clipboard holds one beam.py line per change."),
        ("negative", "Given clipboard access is denied, when Copy is clicked, then a toast says so and shows the commands in a dialog to copy by hand."),
        ("happy", f"Given `{TEST}`, when run, then save-ui.test.mjs passes."),
    ],
    screens=[S["edit-header"], S["edit-validation"]], links=[P.spec("7.4")])

P.T("WE-14", "Release editor.html: round trip, audit again, README",
    size="L", lane="release", gate="G3", deps=["WE-10", "WE-11", "WE-12", "WE-13"], critical_hint=True,
    locks=[f"{P.d}/editor.html", f"{A}/README.md", f"{A}/test/roundtrip.test.mjs"],
    why="""The editor ships as one file, and the only proof that it works is a round trip: reset, save, load the saved
    file, and see the same status, the reset log and every old timestamp. The viewer must still have no edit control
    after both runs have merged. The README must tell people how the edit reaches Warp.""",
    what=f"""1. `npm --prefix {A} run release` writes `{P.d}/editor.html`; commit it. 2.
    `{A}/test/roundtrip.test.mjs`: load `{F}/beam.sample.json` in the built editor (jsdom), reset WV-07 to coding
    with a note, save, load the saved text, compare status, events, resets, pr.mergedAt and jiraKey; repeat with
    `{F}/WARP_PLAN.sample.json`. 3. Re-run the WE-01 audit against `{tickets_view.P.d}/viewer.html`. 4.
    `{A}/README.md`: what the editor does and does not do, how to apply a saved beam (pause the run, replace
    .warp/beam.json, start) or run the copied commands, and that Jira is not changed by a reset.""",
    acs=[
        ("happy", f"Given `npm --prefix {A} run release`, when run, then `{P.d}/editor.html` is written, under 450 kB, and opens from disk."),
        ("happy", "Given the round trip on the beam and on the export, when compared, then status, resets, events, old pr.mergedAt and jiraKey survive."),
        ("negative", f"Given `{tickets_view.P.d}/viewer.html`, when audited, then it still has no data-edit element and no Reset control."),
        ("edge", "Given a saved file loaded into the viewer (not the editor), when its drawer opens, then the status and timestamps show and no reset control appears."),
        ("happy", f"Given `{TEST}`, when run, then roundtrip.test.mjs passes."),
    ],
    screens=list(S.values()), links=[REF])

P.gate("G0", "Editor builds, viewer untouched", ["WE-01"],
       [f"npm --prefix {A} ci && npm --prefix {A} test (audit green)", "app/dist/editor.html opens with the Editing badge"],
       "Stop the edit run: the viewer can change a phase or the editor cannot import it.")
P.gate("G1", "Reset is safe", ["WE-02", "WE-03", "WE-04", "WE-05", "WE-06", "WE-07", "WE-08", "WE-09"],
       ["reset, dependents, validate and save equal fixtures/expected", "undo restores the loaded ticket exactly"],
       "Do not build screens on a reset that loses data.")
P.gate("G2", "Editor screens", ["WE-10", "WE-11", "WE-12", "WE-13"],
       ["Drawer reset, header actions, banner and scrubber match ui/screens", "Totals follow a reset"], "Fix before release.")
P.gate("G3", "Ship", ["WE-14"], ["editor.html committed; round trip green; viewer audit green"], "Do not announce the editor until the round trip is green.")
