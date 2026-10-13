# WARPDEMO — rules for every agent

You are one agent implementing one ticket of WarpView (`WV-*`, run `view`) or WarpEdit (`WE-*`, run `edit`). Warp started you with `Implement <ID>`. Read the ticket in `WARPDEMO/<Module>/tickets/tickets.json` (or `TICKETS.md`), then the spec sections it links.

0. **What we build.** WarpView: one read-only HTML file that opens a Warp run's files from disk and shows every ticket on a slot swimlane, a board and a table, colored by status, with run totals. WarpEdit: the same screens plus resetting a ticket's phase, saved in the shape it was loaded. The look is fixed by `WARPDEMO/WarpView/ui/reference/warp-dashboard.html` and the PNGs in `ui/screens/`.

1. **Layout.** `WARPDEMO/<Module>/spec|plan|tickets|fixtures|ui` is the pack: read it, never edit it. Code goes only under your ticket's lock paths (`technicalDetails.services`), all inside `WARPDEMO/<Module>/app/`. The released files `WARPDEMO/WarpView/viewer.html` and `WARPDEMO/WarpEdit/editor.html` are written only by WV-16 and WE-14. One ticket = one branch = one PR titled `[<ID>] <summary>`.

2. **Locks.** Two agents never write the same path. Write only your lock paths. Append-only files (on conflict keep every line from both sides): `WARPDEMO/WarpEdit/app/src/plugins.mjs`. If you need a change outside your locks, stop and say so in the PR; do not make it.

3. **Stack, locked.** Plain JavaScript ES modules (`.mjs`), Node 22, `node --test`. Dev dependencies: exactly `esbuild` 0.24.0 and `jsdom` 25.0.1, pinned in `app/package.json` (WV-01, WE-01). Forbidden: frameworks (React, Vue, Svelte…), CSS frameworks, CDNs, fonts or images from the network, `fetch`/XHR, `eval`, `new Function`, service workers.

4. **Purity.** Model and view modules are pure: `render…(state) → HTML string`, no DOM access, no globals. Only `app/src/main.mjs` touches the DOM. WarpEdit reaches the screens only through the hooks of WarpView SPEC §11 and never edits `WARPDEMO/WarpView/`.

5. **Data.** The viewer never changes a ticket status and never writes a file (WarpView SPEC §1, §11). Numbers come from the files or from Warp's rules in the spec; a value the files do not carry shows `—`, never an invented number.

6. **Escaping.** Every value from a loaded file goes through `esc()` before it enters HTML, including titles, notes, ids, agent names and URLs (attribute-escaped). Links open with `target="_blank" rel="noopener"`.

7. **Storage.** localStorage only for view preferences, keys prefixed `warp-dash:`, every access inside try/catch; the page works when it throws.

8. **Look.** Colors only through the tokens of WarpView SPEC §12 (`var(--c-done)` and the rest); no new color literals outside `tokens.css`. Match the screen PNGs your ticket names: layout, order, spacing and color.

9. **Same PR or not done.** Tests for every AC beside the module (`<name>.test.mjs`), using the fixtures in `WARPDEMO/<Module>/fixtures/` and the golden outputs in `fixtures/expected/`. If the spec is wrong, say so in the PR; do not change the pack.

10. **Tests.** `npm --prefix WARPDEMO/<Module>/app test` green before you open the PR. One test per AC, named after it (`AC-3: …`). No network, no live services, no real Jira.

11. **Definition of done.** Every AC passes; the test command is green on the head of main; only your lock paths (plus append-only files) changed; the PR title is `[<ID>] <summary>`; the PR body lists each AC with the test that proves it.
