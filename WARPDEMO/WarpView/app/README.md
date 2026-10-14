# WarpView app

WarpView is one read-only HTML file, `WARPDEMO/WarpView/viewer.html`. It opens a Warp run's files from disk and shows every ticket on a slot swimlane, a board and a table, colored by status, with run totals. Nothing is uploaded and nothing is written: the files are read in the browser and the page makes no network request.

## Open it

Open `WARPDEMO/WarpView/viewer.html` in a browser from disk (double-click, or `file://`). It starts on the empty state. Then:

- **Open status files…** and pick one or more files, or **Open .warp folder…** and pick the whole folder.
- Or drop files or a folder anywhere on the page.
- A sample to try first: `fixtures/beam.sample.json` (in `WARPDEMO/WarpView/`). Drop it on the page: 16 tickets, G0 and G1 green, G2 in flight, every status category present. `fixtures/tickets/WV-11/state.json` is a newer ticket state to drop with it.

## What it reads

- `.warp/beam.json` — a run's beam.
- `.warp/status.json` — Warp's status file. Alone, it gives tickets and agent hours but no estimate or shares.
- `.warp/tickets/<id>/state.json` — a Shuttle state. A state newer than the beam wins.
- `WARP_PLAN.json` — Warp's plan export.
- `schedule.json` — a build-schedule/2 plan, drawn as written.
- A whole `.warp` folder, including named runs in `.warp/runs/<name>/`. Several runs open side by side as tabs, with an All runs tab.

Use **Reload** (`r`) to read the same files again, and **Auto-reload every 30s** (file menu) to do it on a timer in a browser that keeps file access.

## Screens

- **Swimlane** — one row per slot, one bar per ticket, gates as vertical lines. Two clocks: **Plan** (estimate-hours, colored by status now) and **Actual** (hours since the run started, claimed to merged). Zoom slides the scale.
- **Board** — lanes grouped by block, status, module, lane, repo or size.
- **Table** — one sortable row per ticket with its plan start, spent time, PR dates and links.
- A header with the four totals (run estimate, agent hours, people hours, tickets) and a utilization panel. Click a ticket anywhere to open its drawer.

Colors come from the status tokens: done, in progress, in review, QA ready, errored or parked, to do. The legend counts each one and toggles it; double-click a chip to show only that status.

## Keys

| Key | Does |
|---|---|
| `/` | Focus the search box |
| `Esc` | Close the drawer or menu, leave the search box |
| `r` | Reload the files |
| `o` / `O` | Open files / open a folder |
| `p` | Print |
| `Enter` / `Space` | Open a ticket or fold a lane when it has focus |

The theme button switches light and dark. Preferences (view, grouping, zoom, theme, clock) are kept in `localStorage` under `warp-dash:` keys, and the page works when storage is blocked.

## Read-only

The viewer never changes a ticket status and never writes a file. It has no edit controls. To reset a ticket's phase, use WarpEdit: `WARPDEMO/WarpEdit/editor.html`. It shows the same screens and saves the file in the shape it was loaded.

## Build and test

```
npm --prefix WARPDEMO/WarpView/app ci
npm --prefix WARPDEMO/WarpView/app test
npm --prefix WARPDEMO/WarpView/app run build     # writes app/dist/viewer.html
npm --prefix WARPDEMO/WarpView/app run release   # writes WARPDEMO/WarpView/viewer.html
```

`test/parity.test.mjs` loads the released `viewer.html` in jsdom with each fixture and compares blocks, plan, metrics and table order with `fixtures/expected/`.
