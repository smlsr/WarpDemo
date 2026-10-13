# WARPDEMO

Two small products, built by Warp as two named runs in this repo. They are the demo for Warp 1.6: named runs, gate blocks, `startAfter`, cross-run blockers, and the run dashboard.

| Module | Run | What it builds | Tickets | Plan finish | Starts |
|---|---|---|---|---|---|
| [WarpView](WarpView/) | `view` | `WarpView/viewer.html`: a read-only page that opens a Warp run's files and shows the slot swimlane, board and table, colored by status, with run totals | 16 (WV-01…16) | T+59h | at once |
| [WarpEdit](WarpEdit/) | `edit` | `WarpEdit/editor.html`: the same screens plus resetting a ticket's phase, saved in the shape it was loaded | 14 (WE-01…14) | T+76h after it starts | after `view:G2` |

The look of both is fixed by Warp's run dashboard: `WarpView/ui/reference/warp-dashboard.html` (open it — it carries sample data) and the screens in `WarpView/ui/screens/` and `WarpEdit/ui/screens/`.

## Folders

```
WARPDEMO/
  AGENTS.md              rules every agent follows (layout, locks, stack, tests, definition of done)
  JIRA_IMPORT.json       both packs in one Jira import, with the cross-run link WV-15 → WE-01
  bootstrap.sh           installs the Cursor rule in .cursor/rules/warpdemo/ (never overwrites)
  repo-root/             the rule template bootstrap.sh installs
  LEDGER.md              what the old WarpView/WarpEdit packs asked for, and where it went
  tools/                 generators: make_all.py, gen_fixtures.py, tickets_*.py, schedule.py …
  WarpView/  WarpEdit/   one pack each:
    README.md
    spec/SPEC.md         normative spec; spec/ACCEPTANCE.md the acceptance queries
    plan/                schedule.json (build-schedule/2), CURSOR_PLAN.md, BUILD_PLAN.md, CURSOR_SWIMLANE.pdf/.png
    tickets/             tickets.json (+ schema.json), TICKETS.md, jira-import.json, JIRA_IMPORT.csv, linear-import.json, IMPORT.md
    fixtures/            Warp files to test against, and expected/ golden outputs
    ui/                  screens/ (PNG + HTML per screen, screens.json); WarpView also reference/
    app/                 product code — written by the run, not part of the pack
```

The pack folders (`spec plan tickets fixtures ui`) are read-only while a run builds; agents write only under `app/` inside their ticket's lock paths.

## Run it with Warp (1.6.1 or later)

Day 0, once per repo: `sh WARPDEMO/bootstrap.sh`, then import Jira: `WARPDEMO/JIRA_IMPORT.json` (project **WAR**, see `WarpView/tickets/IMPORT.md`). If the old packs were imported into WAR before, archive those issues first: they carry the same External IDs.

**Developer 1 — run `view`** (one checkout or cloud agent):

```
/warp-init view
```
In `.warp/config.yaml`: `paths: WARPDEMO/WarpView`, `jiraProject: WAR`.
```
/warp-scan WARPDEMO/WarpView
/warp-start
```
`/warp-start G0-G1` runs only the first two gate blocks and pauses when they are cleared.

**Developer 2 — run `edit`** (another checkout):

```
/warp-init edit
```
In `.warp/config.yaml`: `paths: WARPDEMO/WarpEdit`, `startAfter: view:G2`, `appendOnlyPaths: WARPDEMO/WarpEdit/app/src/plugins.mjs`, `jiraProject: WAR`.
```
/warp-scan WARPDEMO/WarpEdit
/warp-start
```
It refuses with `refuse: edit starts after view:G2` until view's G2 is green (`--now` overrides). WE-01 also waits for `view:WV-15`.

Watch both: `/warp-runs`, or `/warp-dashboard` in either checkout and open `.warp/dashboard.html` — with the other run's mirror under `.warp/runs/`, it shows both as tabs.

## Regenerate

```
python3 WARPDEMO/tools/make_all.py --warp <Warp plugin folder>            # tickets, schedules, plans, swimlanes, Jira, Linear; checks
python3 WARPDEMO/tools/gen_fixtures.py --warp <Warp plugin folder>        # fixtures, expected outputs, reference page, screens (Playwright)
python3 WARPDEMO/tools/make_all.py --warp <Warp plugin folder> --strict   # all of the above must agree: prints ALL CHECKS PASS
```

Ticket content lives in `tools/tickets_view.py` and `tools/tickets_edit.py`; everything else is generated from them.
