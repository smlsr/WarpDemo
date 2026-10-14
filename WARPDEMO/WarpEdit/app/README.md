# WarpEdit app

`WARPDEMO/WarpEdit/editor.html` is one self-contained HTML file: the WarpView screens plus a way to put a ticket back on another phase and save the run in the shape it was loaded. Open it from disk in a browser. Nothing is fetched and nothing is uploaded.

## Commands

Run from the repo root (Node 22):

```bash
npm --prefix WARPDEMO/WarpEdit/app ci        # once: esbuild 0.24.0 and jsdom 25.0.1
npm --prefix WARPDEMO/WarpEdit/app test      # every module test, the audit and the round trip
npm --prefix WARPDEMO/WarpEdit/app run build # app/dist/editor.html, for local use (git-ignored)
npm --prefix WARPDEMO/WarpEdit/app run release # WARPDEMO/WarpEdit/editor.html, the file that is committed
```

The build takes WarpView's shell, CSS and modules from `WARPDEMO/WarpView/app/src/` and adds the plugins listed in `src/plugins.mjs`. When a beam or a Warp export is loaded, one edit store is made from it and shared by every plugin: the drawer's Reset phase section, Undo and Redo, live totals and Save all work on the same edits.

## What the editor does

- Opens `.warp/beam.json`, a Warp export (`WARP_PLAN.json`), `status.json`, `schedule.json` or a whole `.warp` folder, exactly as the viewer does.
- In a ticket's drawer, **Reset phase** moves the ticket to another phase after a confirm dialog with an optional note. Only the status moves: Warp gets a status event (`by: "warpedit"`, with the note) and a `resets` entry. `pr` (including `mergedAt`), `jira`, `claimedAt`, tokens, minutes, attempts and every other field are kept. A reset of a merged ticket blocks its queued dependents and lists the ones in flight or already merged.
- Totals, legend, gates, swimlane, board and table follow each edit. A gate that was green and lost a merged member reads "pending (edited)" until Warp recomputes it.
- Undo and Redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z), an unsaved count, and a warning before the page closes with unsaved edits.
- The phase scrubber replays each ticket's phase along the actual timeline.
- **Save** downloads the run under the name it was loaded with: a beam stays a beam (with `editedAt` and `editedBy: "warpedit"`), an export stays an export (status and resets only, `exportedAt` set to now). Save is blocked while validation finds an error (a missing dependency, a cycle, a duplicate id, a reset log that disagrees with the status, an unknown status); the banner names each ticket.
- **Copy as commands** copies one `beam.py set` line per change instead.

## What it does not do

- It does not write to `.warp/` or any file in place, and it does not talk to Warp, Git, GitHub or Jira. Save is a browser download.
- It does not change Jira. A reset leaves the Jira issue where it is; Warp moves the issue on its next status change for that ticket.
- It does not save `status.json` or `schedule.json`. Those are views of a run and the plan; open `beam.json` to save edits.
- It does not change tokens, minutes, timestamps or pull-request facts, and it does not start, stop or merge anything.
- It does not edit the WarpView screens. `WARPDEMO/WarpView/viewer.html` stays read-only: no Reset control and no `data-edit` element.

## Getting an edit into Warp

Either way, Warp reads the change on its next start: a ticket on an open phase is worked again on its branch, a blocked ticket waits for its blockers.

**Replace the beam.**

1. Pause the run: `/warp-pause`. Nothing is dispatched while the beam is swapped.
2. Replace `.warp/beam.json` with the saved file.
3. Start again: `/warp-start` (or `/warp-resume`).

**Or run the commands.** Use **Copy as commands** and run the lines from the repo root while the run is paused, then start it again. Each line is

```bash
python3 .cursor/plugins/warp/scripts/beam.py set --beam .warp/beam.json --id <id> --status <to>
```

A reset's dependents come right after it. The commands set the status only; the reset note and `resets` log are in the saved beam, not in the commands.

A saved file opens in the viewer as well. It shows the new status, the reset's status event and every old timestamp, with no edit controls.
