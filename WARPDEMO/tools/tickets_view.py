"""WarpView tickets (run `view`, prefix WV)."""

from common import Pack
from screens import VIEW, catalog

P = Pack("view")
S = catalog(P, VIEW)
A = P.app
F = P.d + "/fixtures"
TEST = f"npm --prefix {A} test"
REF = {"title": "Design of record (reference page)", "url": f"{P.d}/ui/reference/warp-dashboard.html"}
EXP = lambda name: {"title": f"Expected output: {name}", "url": f"{F}/expected/{name}"}

P.T("WV-01", "App scaffold: one-file build, test runner, empty page",
    size="S", lane="platform", gate="G0", deps=[], critical_hint=True,
    locks=[f"{A}/package.json", f"{A}/build.mjs", f"{A}/.gitignore", f"{A}/src/shell.html", f"{A}/src/main.mjs", f"{A}/src/core/util.mjs", f"{A}/test/"],
    why="""Every other WarpView ticket writes a module under app/src and needs one way to test it and one way to turn the
    modules into the single viewer file. Without a fixed build, folder layout and test command, sixteen agents invent
    sixteen conventions, imports break across modules, and the release cannot produce a file that opens from disk
    with no server and no network.""",
    what=f"""1. `{A}/package.json`: `"type": "module"`, scripts `test` = `node --test`, `build` = `node build.mjs`
    (writes `{A}/dist/viewer.html`), `release` = `node build.mjs --release` (writes `{P.d}/viewer.html`);
    devDependencies pinned exactly: `esbuild` 0.24.0 and `jsdom` 25.0.1. 2. `{A}/build.mjs`: bundle `src/main.mjs`
    with esbuild (format iife, target es2020, no minify), inline the bundle and every `src/**/*.css` (files under
    `src/styles/` first, then path order) into `src/shell.html`, and print `viewer: <path> <bytes>`. 3. `src/shell.html`:
    the regions of SPEC §10.1 with their ids and the data slot `<script id="warp-data" type="application/json">null</script>`.
    4. `src/main.mjs`: export `createApp({{root, plugins}})`; for now it renders the empty state of SPEC §10.9.
    5. `src/core/util.mjs`: the helpers of SPEC §4.6 (esc, num, fmtH, fmtN, pct, parseTime, ago, stamp, natKey,
    natCmp, hashHue) with tests beside them. 6. `{A}/.gitignore`: `node_modules/` and `dist/`. 7. `{A}/test/dom.mjs`:
    a helper that loads a built HTML file in jsdom with a given fixture placed in the data slot.""",
    acs=[
        ("happy", f"Given a clean checkout, when `npm --prefix {A} ci && npm --prefix {A} run build` runs, then `{A}/dist/viewer.html` exists, has exactly one inline <script> without src, no <link rel=stylesheet>, and shows the text 'Open a Warp run' when opened."),
        ("happy", "Given util.mjs, when called, then fmtH(null) is '—', fmtH(7) is '7h', fmtH(105.5) is '106h', fmtH(36.24) is '36.2h', natCmp('WV-2','WV-10') < 0 and esc('<a href=\"x\">') is '&lt;a href=&quot;x&quot;&gt;'."),
        ("negative", "Given the built file, when searched for 'http://' and 'https://', then neither appears outside string literals that the spec allows (none in the scaffold): the page fetches nothing."),
        ("edge", "Given a CSS file that fails to parse or a missing src/main.mjs, when build runs, then it exits with status 1 and prints the file name; no partial viewer.html is left behind."),
        ("happy", f"Given `{TEST}`, when run, then the util and build tests pass."),
    ],
    out=["Any screen beyond the empty state", "Loading files"],
    screens=[S["empty"]], links=[P.spec("10.1"), REF],
    notes="esbuild and jsdom are the only dependencies the app may have. Do not add others.")

P.T("WV-02", "Theme tokens, layout styles, dark mode, phone width and print",
    size="S", lane="platform", gate="G1", deps=["WV-01"],
    locks=[f"{A}/src/styles/"],
    why="""The viewer must look like the reference page in both themes, at phone width and on paper. If each view
    picks its own colors and spacing, the six status colors drift, dark mode loses contrast, the page scrolls
    sideways on a phone and printing cuts the swimlane. One owned set of tokens and layout rules keeps every
    view consistent and lets the view tickets run in parallel without touching shared CSS.""",
    what=f"""Create `{A}/src/styles/tokens.css` and `{A}/src/styles/layout.css` from SPEC §12 and the reference page
    `{P.d}/ui/reference/warp-dashboard.html`. 1. Tokens on `:root` exactly as SPEC §12.1: surface, ink, line and brand
    colors and the six status colors `--c-done --c-err --c-prog --c-rev --c-qa --c-todo`, plus `--tint` and `--tint-todo`.
    2. Dark values under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and again
    under `:root[data-theme="dark"]`. 3. Layout for the top bar, chips, buttons, menu, headline, tabs, metric cards,
    stack bars, legend chips, search, segmented controls, panels, toasts, drop overlay, empty state (SPEC §10).
    4. `@media (max-width: 640px)` rules of SPEC §10.11 (16 px gutter, cards in one column, top bar wraps).
    5. `@media print` rules of SPEC §10.12 (light tokens, controls hidden, exact colors).""",
    acs=[
        ("happy", "Given tokens.css, when parsed, then every custom property listed in SPEC §12.1 is defined on :root with the listed light value and redefined in both dark blocks with the listed dark value."),
        ("happy", f"Given the built page with `{F}/beam.sample.json`, when rendered at 1600 px, then cards, chips and panels match `{P.d}/ui/screens/swimlane-plan.png` in order, spacing and color (same tokens, no new colors)."),
        ("edge", "Given a 390 px wide viewport, when the page renders, then document.documentElement.scrollWidth equals the viewport width (no sideways scroll) and metric cards are in one column."),
        ("negative", "Given any CSS file in src/, when searched, then no color literal for a status appears outside tokens.css (views use var(--c-*) only)."),
        ("happy", f"Given `{TEST}`, when run, then the tokens test (parses tokens.css and compares to SPEC §12.1) passes."),
    ],
    screens=[S["swimlane-plan"], S["dark"], S["phone"], S["print"]], links=[P.spec("12"), REF])

P.T("WV-03", "Status model: sixteen Warp statuses on six colors",
    size="S", lane="model", gate="G1", deps=["WV-01"], critical_hint=True,
    locks=[f"{A}/src/core/status.mjs", f"{A}/src/core/status.test.mjs"],
    why="""Warp has sixteen ticket statuses and the screens show six categories. If the mapping lives in each view,
    the swimlane, board, table, legend and totals disagree about what is in progress, and a status Warp adds later
    silently becomes invisible. One module owns the mapping, the aliases for hand-written files and the
    ticket state.json states, and the rule for unknown values.""",
    what=f"""Create `{A}/src/core/status.mjs` per SPEC §5. Export: 1. `CATS` — the six categories in display order
    with keys `done err prog rev qa todo` and labels Completed, Errored / Parked, In Progress, In Review, QA Ready,
    To Do. 2. `STATUS_CAT` — the sixteen Warp statuses of SPEC §5.1 to a category key. 3. `STATUS_ALIAS` for labels
    found in hand-written files (in_progress, qa_ready, to_do, completed, errored, failed, bugbot and the others in
    §5.2). 4. `STATE_STATUS` — ticket state.json states to beam statuses (§5.3). 5. `TERMINAL`, `ACTIVE`,
    `normStatus(raw)` (lower-case, spaces and hyphens to underscores, alias, empty to queued), `catOf(status)`
    (unknown to todo), `bucketOf(cat)` (rev and qa count as prog in totals), `catColor(cat)` returning the CSS
    variable, and `statusText(status)`.""",
    acs=[
        ("happy", "Given each of the sixteen statuses in SPEC §5.1, when catOf runs, then it returns the category listed there; merged, done and skipped are 'done'; awaiting_approval is 'qa'; alarm, parked and blocked are 'err'."),
        ("happy", "Given 'In Progress', 'QA-Ready' and 'to do', when normStatus runs, then it returns coding, awaiting_approval and queued."),
        ("edge", "Given an empty string, null or 'teleporting', when normStatus and catOf run, then empty and null become queued and 'teleporting' stays as is with category todo."),
        ("negative", "Given STATE_STATUS, when asked for 'heartbeat' or 'done', then it returns undefined: those states never move a ticket."),
        ("happy", f"Given `{TEST}`, when run, then status.test.mjs passes and checks every key in `{F}/expected/categories.json`."),
    ],
    links=[P.spec("5"), EXP("categories.json")])

P.T("WV-04", "Read beam, status, ticket state and export files into runs",
    size="M", lane="model", gate="G1", deps=["WV-03"],
    locks=[f"{A}/src/load/parse/"],
    why="""The viewer is only as good as what it reads. Warp writes a beam, a status file, one state file per ticket,
    a plan export and, for named runs, a mirror per run. File names change between Warp versions, so the reader must
    classify by content, merge the copies of one run, and let a newer ticket state move an open ticket. Getting this
    wrong shows stale or doubled tickets and wrong totals.""",
    what=f"""Create `{A}/src/load/parse/parse.mjs` per SPEC §3 and §4. 1. `classify(data)` returns beam, status, ticket
    or null by content (§3.1). 2. `runFromBeam(doc)` builds the Run model of §4 from a beam or a `kind: warp-plan`
    export (estimate at top level, exportedAt), including gate greenAt, evidence, checks and if-red. 3. `runFromStatus`
    for status.json alone (no gates, hours from size). 4. `applyState(ticket, state)` per §3.3: only an open ticket,
    only when newer, never undoes a merge, copies the PR url and alarm. 5. `buildRuns(docs, extra)` per §3.2: one
    run per name, else instance, else folder; the newer copy wins; status.json joins its run; ticket states attach by
    folder then by id; repo from the first PR url; returns `{{runs, skipped, overlaid, states}}`.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json`, when buildRuns runs, then one run named view with 16 tickets results and every ticket field of SPEC §4.2 is filled as in `{F}/expected/view.run.json`."),
        ("happy", f"Given `{F}/beam.sample.json` and `{F}/tickets/WV-11/state.json` (state coding, newer), when buildRuns runs, then WV-11 has status coding, stateNote set, and overlaid is 1."),
        ("edge", f"Given `{F}/runs/view/beam.json` and `{F}/runs/edit/beam.json` plus an older copy of the view beam, when buildRuns runs, then two runs result, sorted by name, and the newer view copy is kept."),
        ("edge", f"Given only `{F}/status.sample.json`, when buildRuns runs, then one run of kind status results with no gates and hours taken from size (S=4, M=7, L=11, XL=16)."),
        ("negative", "Given a JSON file with neither tickets nor done/working/left nor id+state, when buildRuns runs, then it is counted in skipped and creates no run; a merged ticket with a newer state.json saying coding stays merged."),
        ("happy", f"Given `{TEST}`, when run, then parse.test.mjs passes against every fixture under `{F}/`."),
    ],
    test_data=f"{F}/beam.sample.json, {F}/status.sample.json, {F}/tickets/WV-11/state.json, {F}/WARP_PLAN.sample.json, {F}/runs/",
    links=[P.spec("3"), P.spec("4"), EXP("view.run.json")])

P.T("WV-05", "Open files and folders, drag and drop, reload and auto-reload",
    size="M", lane="platform", gate="G1", deps=["WV-04"],
    locks=[f"{A}/src/load/sources/"],
    why="""People open the viewer from disk and point it at a .warp folder that keeps changing while the run goes.
    If reading a folder pulls in the whole repo, if dropping a folder does nothing, or if reload makes them pick the
    files again every time, they stop using it. The loader has to find the right files, remember how to re-read
    them, and keep working in browsers without the File System Access API.""",
    what=f"""Create `{A}/src/load/sources/sources.mjs` per SPEC §3.4. 1. `openFiles()` and `openFolder()` using
    showOpenFilePicker / showDirectoryPicker when present, else the hidden inputs (multiple, webkitdirectory).
    2. Folder walk: prefer a `.warp` child; read only files matching `(beam|status|state)*.json`; skip `.git`,
    `node_modules`, `__pycache__`, `dist`, `build` and `previous-*`; depth 7. 3. Drop: file system handles when
    offered, else webkitGetAsEntry traversal. 4. `readSources(sources)` returns docs `{{path, data, modified}}`
    and errors per file. 5. `reload()`: re-read handles; a page with embedded data reloads the page; plain input
    files say to open again. 6. Auto-reload every 30 s when the tab is visible, remembered in localStorage inside
    try/catch. 7. `embeddedDocs(document)` reads the warp-data slot written by Warp's /warp-dashboard.""",
    acs=[
        ("happy", f"Given a fake directory handle holding `.warp/beam.json`, `.warp/tickets/WV-11/state.json`, `.warp/agents.json` and `node_modules/x/beam.json`, when the folder is read, then exactly the beam and the state file are returned with paths starting with the folder name."),
        ("happy", "Given the warp-data slot holds {files:[{path,data}]}, when embeddedDocs runs, then it returns those docs and reload() calls location.reload."),
        ("edge", "Given a browser without showOpenFilePicker, when Open status files is chosen, then the hidden file input is clicked and its files are read on change."),
        ("negative", "Given localStorage throws on access, when auto-reload is toggled, then no exception escapes and the toggle still works for the session."),
        ("happy", f"Given `{TEST}`, when run, then sources.test.mjs passes using fake handles and jsdom."),
    ],
    screens=[S["empty"]], links=[P.spec("3.4")])

P.T("WV-06", "Gate blocks: assign each ticket to a block and clear blocks",
    size="S", lane="model", gate="G1", deps=["WV-01"], critical_hint=True,
    locks=[f"{A}/src/model/blocks/"],
    why="""Warp runs a plan in gate blocks and, by default, starts a block only when the blocks before it are
    cleared. The swimlane, the board lanes and the people-hour totals all depend on which block a ticket belongs to.
    If the viewer assigns blocks differently from Warp, the plan it draws is not the plan Warp runs and the gate
    lines land in the wrong place.""",
    what=f"""Create `{A}/src/model/blocks/blocks.mjs`, a port of Warp's scripts/blocks.py as specified in SPEC §6.
    1. `gateKeys(run)`: G-number keys in numeric order, then other keys in plan order. 2. `assignBlocks(run)`: a
    ticket's block is its own gate when that gate exists, else the lowest gate that lists it as a member, else the
    highest block among its dependencies (cycles cut), else the first block; with no gates every block is null.
    3. `blockStates(run)`: per block the ticket ids, counts of merged, open, parked and queued, the gate status and
    `cleared` (every ticket merged, done or skipped and the gate not red). 4. Sets `run.blockRank`.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json`, when assignBlocks runs, then every ticket's block equals `{F}/expected/view.blocks.json`."),
        ("happy", f"Given `{F}/big/beam.sample.json` (68 tickets, gates G0–G5), when assignBlocks runs, then the result equals `{F}/expected/big.blocks.json`."),
        ("edge", "Given a ticket with no gate, no membership and a dependency cycle A→B→A, when assignBlocks runs, then it terminates and both get the highest block of their other dependencies or the first block."),
        ("negative", "Given a run with no gates, when blockStates runs, then it returns an empty list and every ticket's block is null."),
        ("happy", f"Given `{TEST}`, when run, then blocks.test.mjs passes."),
    ],
    test_data=f"{F}/beam.sample.json, {F}/big/beam.sample.json",
    links=[P.spec("6"), EXP("view.blocks.json"), EXP("big.blocks.json")])

P.T("WV-07", "Planned swimlane and actual timeline layouts",
    size="L", lane="model", gate="G1", deps=["WV-06"], critical_hint=True,
    locks=[f"{A}/src/model/plan/"],
    why="""The swimlane is the main screen: one row per agent slot on an estimate-hour clock, like the plan's swimlane
    PDF, and an actual clock of what happened. Both are computed, not drawn by hand. If the simulation differs from
    Warp's dispatch rule the picture lies about the finish and the critical chain; if the actual layout overlaps bars
    nobody can read it. This ticket owns both layouts as pure functions with golden outputs.""",
    what=f"""Create `{A}/src/model/plan/plan.mjs` per SPEC §7 and §8. 1. `plan(run)`: list scheduling with
    `run.cap` slots (maxAgents, default 18); a ticket is ready when every in-run dependency has merged (merge = end
    plus 0.5 h when its size is not auto-merged) and, with gateOrder strict, every earlier block has merged; ready
    tickets sorted critical first, starred, rank, longest downstream chain, natural id; lowest free slot. Sets
    `slot start end mergeAt` per ticket and `finish peak slots waves critHours critCount gateAt` on the run; tickets
    that can never be ready are laid after everything and flagged `unplaced`. 2. `layoutPlan(run)` and
    `layoutActual(run, now)` returning `{{prefix, label, rows, span, now, unstarted, items, gates}}` (§8): actual
    bars run from claimedAt (else PR opened, else first event) to mergedAt (else now) and pack into the lowest free row.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json`, when plan runs, then slot, start and mergeAt of every ticket and finish, peak, slots and gateAt equal `{F}/expected/view.plan.json` to 0.01 h."),
        ("happy", f"Given `{F}/big/beam.sample.json`, when plan runs, then the result equals `{F}/expected/big.plan.json` (finish T+177, peak 10, 10 slots)."),
        ("edge", "Given gateOrder deps on the same big beam, when plan runs, then no block waits for an earlier block and the finish is earlier than the strict finish."),
        ("edge", f"Given `{F}/beam.sample.json` and now = 2026-10-12T20:00:00Z, when layoutActual runs, then items, rows, unstarted and the now line equal `{F}/expected/view.actual.json`."),
        ("negative", "Given a dependency cycle, when plan runs, then it returns within 100 ms, every ticket has a slot and the cycle members are flagged unplaced."),
        ("happy", f"Given `{TEST}`, when run, then plan.test.mjs passes."),
    ],
    test_data=f"{F}/beam.sample.json, {F}/big/beam.sample.json",
    screens=[S["swimlane-plan"], S["swimlane-actual"]],
    links=[P.spec("7"), P.spec("8"), EXP("view.plan.json"), EXP("big.plan.json"), EXP("view.actual.json")])

P.T("WV-08", "Run totals: estimate, agent hours, people hours, tickets",
    size="M", lane="model", gate="G1", deps=["WV-03", "WV-06"],
    locks=[f"{A}/src/model/metrics/"],
    why="""The header answers how big the run is and how far it has got: the run estimate, agent hours, people
    hours and tickets, each split into completed, in progress, errored or parked, and to do. People use these numbers
    to decide whether to add agents or chase reviews, so they must follow Warp's own estimate rules and show a dash
    when the files do not carry a value, never an invented number.""",
    what=f"""Create `{A}/src/model/metrics/metrics.mjs` per SPEC §9. 1. `computeMetrics(runs)` returning the four
    totals and their bucket splits: agent hours from ticket hours (S=4, M=7, L=11, XL=16 unless the ticket has hours);
    people hours 0.5 h per ticket whose size is not auto-merged plus 0.5 h per blocking gate, a gate counted done when
    green, err when red, in progress when its block has started; run estimate = program.estimate.elapsedHours split by
    agent-hour share; tickets by bucket. 2. Elapsed hours since runStartedAt, ETA left (beam metrics.etaHours, else
    max(critical hours left, remaining hours / min(cap, 8))), swimlane finish, assumptions, actual hours, tokens,
    cost. 3. `utilization(runs)`: active (claimed through merging) over summed cap, hours spent over estimate.agentHours,
    tokens and minutes by size and by agent. Missing values are null.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json`, when computeMetrics runs, then every number equals `{F}/expected/view.metrics.json`."),
        ("happy", f"Given `{F}/big/beam.sample.json`, when computeMetrics runs, then run estimate is 105.5, agent hours 752, people hours 25 and tickets 68 with 25 completed, as in `{F}/expected/big.metrics.json`."),
        ("edge", f"Given `{F}/status.sample.json` alone (no estimate), when computeMetrics runs, then estTotal and every share are null while agent hours and tickets are computed."),
        ("negative", "Given a ticket with status teleporting and no size, when computeMetrics runs, then it counts as to do with 7 h and nothing throws."),
        ("happy", f"Given `{TEST}`, when run, then metrics.test.mjs passes."),
    ],
    test_data=f"{F}/beam.sample.json, {F}/big/beam.sample.json, {F}/status.sample.json",
    links=[P.spec("9"), EXP("view.metrics.json"), EXP("big.metrics.json")])

P.T("WV-09", "Swimlane view: slots, time axis, gates, bars, zoom, actual clock",
    size="XL", lane="console", gate="G2", deps=["WV-02", "WV-03", "WV-07"], critical_hint=True,
    locks=[f"{A}/src/view/swimlane/"],
    why="""This is the screen people open the viewer for: the run as a swimlane of agent slots like the plan's PDF,
    colored by each ticket's status now, with gate lines and the critical chain. It must stay readable from 16 to
    400 tickets, at any zoom, on a phone and on paper, and switch to the actual clock without changing what a color
    means. Without it the viewer is a list.""",
    what=f"""Create `{A}/src/view/swimlane/swimlane.mjs` and `swimlane.css` per SPEC §10.6. 1. `renderSwimlane(run,
    layout, opts)` returns HTML: sticky slot labels, a gate row with labels left of each line (labels that collide
    lift to a second row; names only when there is room; gates reached together share 'G2 · G8'), an axis row
    (T+ or + labels at steps 1,2,5,10,20,25,50,100,200 so ticks are at least 56 px apart), grid lines, gate lines
    (red bold when red, green when green), the now line on the actual clock, and one bar per item: left accent and
    tint in the status color, id with ★ for critical, size·hours, title, ⚠ for an alarm, ✗ for red CI, a tiny form
    under 70 px, dim when filtered out, outline when a search hits. 2. Zoom: fit to width times 6^(zoom/100);
    print width fit. 3. The Plan/Actual toggle in the panel header. 4. `tooltipFor(ticket)`.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json` at 1600 px, when rendered with layoutPlan, then it matches `{P.d}/ui/screens/swimlane-plan.png`: same rows, bar positions to 1 px, gate labels G0–G3 and colors by status."),
        ("happy", f"Given the actual clock, when rendered with layoutActual at the expected now, then it matches `{P.d}/ui/screens/swimlane-actual.png` with the dashed now line."),
        ("edge", "Given two gates reached at the same hour, when rendered, then one label 'G1 · G2' is drawn and no two labels overlap at any zoom from 0 to 100."),
        ("edge", "Given a bar narrower than 70 px, when rendered, then only the id shows; given a search that matches it, then it gets the hit outline and every non-matching bar is dimmed."),
        ("negative", "Given a run with zero tickets, when rendered, then one empty slot row and the axis render and nothing throws."),
        ("happy", f"Given `{TEST}`, when run, then swimlane.test.mjs passes (HTML snapshot against the expected layouts)."),
    ],
    screens=[S["swimlane-plan"], S["swimlane-actual"], S["print"], S["phone"]],
    links=[P.spec("10.6"), REF, EXP("view.plan.json")])

P.T("WV-10", "Board view: lanes by block, status, module or size",
    size="L", lane="console", gate="G2", deps=["WV-02", "WV-03", "WV-06"],
    locks=[f"{A}/src/view/board/"],
    why="""The swimlane shows time; the board shows where each ticket stands and lets people scan a block or a status
    at a glance, open the pull request and the Jira issue in one click, and see alarms. Cleared blocks fold away so
    the open work stays on screen. Without it people go back to reading Warp's STATUS.md.""",
    what=f"""Create `{A}/src/view/board/board.mjs` and `board.css` per SPEC §10.7. 1. `lanesFor(runs, groupBy)`
    for block (gate order, or 'All tickets' without gates), status (the six categories), module (natural order)
    and size (S, M, L, XL, No size); with several runs the block lanes are prefixed by run label. 2. Lane header:
    chevron, name and gate name, gate pill (status and greenAt, tooltip with evidence, checks and if-red), cleared
    pill, 'n/m done', agent hours, a stack bar, 'k shown' when filtered. Cleared block lanes start collapsed when
    there is more than one lane; the person's choice wins after that. 3. Card: id with ★, size badge, status text in
    its color, two-line title, est, spent, 'PR #n ↗', Jira key linked to `<jiraSite>/browse/<key>` when jiraSite is
    set, CI, alarm line.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json`, when rendered by block, then four lanes G0–G3 appear, G0 is collapsed and cleared, and the result matches `{P.d}/ui/screens/board.png`."),
        ("happy", "Given groupBy status, when rendered, then six lanes appear in the CATS order with counts that equal the legend counts."),
        ("edge", "Given jiraSite is empty, when a card renders, then the Jira key is plain text, not a link; given 'acme.atlassian.net', then the link is https://acme.atlassian.net/browse/<key>."),
        ("negative", "Given a filter that hides every ticket in a lane, when rendered, then the lane shows '0 shown' and no cards, and the other lanes are unchanged."),
        ("happy", f"Given `{TEST}`, when run, then board.test.mjs passes."),
    ],
    screens=[S["board"]], links=[P.spec("10.7"), REF])

P.T("WV-11", "Table view: sortable columns with the four PR timestamps",
    size="M", lane="console", gate="G2", deps=["WV-02", "WV-03", "WV-07"],
    locks=[f"{A}/src/view/table/"],
    why="""Some questions are about time, not layout: what merged last, which pull request has waited longest for
    review, which approvals are missing. The table puts status, plan start, time spent and the four pull request
    timestamps side by side and sorts on any of them. Missing timestamps must read as a dash, not as zero or as
    the epoch.""",
    what=f"""Create `{A}/src/view/table/table.mjs` and `table.css` per SPEC §10.8. 1. `renderTable(runs, sort,
    matches)`: thirteen columns — Ticket, Status, Summary, Size, Block, Est, Plan, Spent, Opened, Reviewed,
    Approved, Merged, Links — with a sticky header. 2. Header click or Enter sorts by that column; a second click
    reverses; aria-sort reflects the state; ties fall back to natural id order. 3. Timestamps render with stamp()
    and the raw value in the title; null renders '—'. 4. Rows filtered out are hidden; a row click or Enter opens the
    drawer. 5. With several runs the run label follows the id.""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json`, when sorted by Merged descending, then the first rows are the most recently merged tickets as listed in `{F}/expected/view.table.json` and the screen matches `{P.d}/ui/screens/table.png`."),
        ("happy", "Given a click on Status, when sorted, then rows follow the category order Completed, Errored / Parked, In Progress, In Review, QA Ready, To Do."),
        ("edge", "Given a ticket with pr.openedAt but no reviewedAt, approvedAt or mergedAt, when rendered, then those three cells read '—' and sorting by Merged puts it last ascending."),
        ("negative", "Given a timestamp value 'not-a-date', when rendered, then the cell reads '—' and nothing throws."),
        ("happy", f"Given `{TEST}`, when run, then table.test.mjs passes."),
    ],
    screens=[S["table"]], links=[P.spec("10.8"), EXP("view.table.json")])

P.T("WV-12", "Ticket drawer, timestamps and bar tooltip",
    size="M", lane="console", gate="G2", deps=["WV-02", "WV-03"],
    locks=[f"{A}/src/view/drawer/"],
    why="""Every bar, card and row leads to one place that answers everything about a ticket: status, estimate,
    plan, time and cost spent, pull request, CI and Bugbot, Jira, agent, attempts, every timestamp in order, what it
    depends on, what it locks and what happened. The drawer is also where WarpEdit adds its reset section, so it
    must take extra sections without being edited.""",
    what=f"""Create `{A}/src/view/drawer/drawer.mjs` and `drawer.css` per SPEC §10.10. 1. `renderDrawer(ticket, run,
    sections)`: header with the status color bar, id with ★ and title; key/value list in the order of §10.10 (alarm
    first when present); 'Timestamps' with Claimed, PR opened, Reviewed, Approved, Merged, Jira last comment,
    Updated (each stamp() plus the raw value, '—' when missing); Depends on and Locks as tags; Events, newest first,
    at most 25. 2. Extra sections: for each `{{id, render(ticket, run)}}` in `sections`, append its HTML under the
    events in registration order. 3. `renderTooltip(ticket)` for bars. 4. Close button; Escape and the scrim close
    it (wired by WV-15).""",
    acs=[
        ("happy", f"Given WV-05 in `{F}/beam.sample.json`, when the drawer renders, then the fields and the timestamp list match `{P.d}/ui/screens/drawer.png` in order and value."),
        ("happy", "Given one extra section {id:'x', render: () => '<p id=\"x\">X</p>'}, when the drawer renders, then the paragraph appears after Events and nothing else changes."),
        ("edge", "Given a ticket with 40 events, when rendered, then 25 are listed, newest first."),
        ("negative", "Given a title containing '<img src=x onerror=alert(1)>', when rendered, then it shows as text (escaped) in the header, the tooltip and the key list."),
        ("happy", f"Given `{TEST}`, when run, then drawer.test.mjs passes."),
    ],
    screens=[S["drawer"]], links=[P.spec("10.10"), P.spec("11")])

P.T("WV-13", "Header, run tabs, the four totals and utilization panel",
    size="L", lane="console", gate="G2", deps=["WV-02", "WV-08"],
    locks=[f"{A}/src/view/header/"],
    why="""The header is the summary a lead reads first: which repo, run and instance, whether it is running, when it
    last changed, and the four totals with their splits and bars. With several runs open it switches between them.
    The utilization panel answers whether the agents are busy and where tokens went. If these disagree with the
    swimlane or with Warp, people stop trusting the page.""",
    what=f"""Create `{A}/src/view/header/header.mjs` and `header.css` per SPEC §10.2–§10.4. 1. `renderMeta(runs, tab)`:
    chips for repo, run, instance (warp:<id>), state with dot (running pulses, paused, stopped, done), pause reason,
    range, owner, exported time for an export, and 'updated <ago> · <stamp>' (stamp hidden under 640 px). 2.
    `renderHeadline(runs)`: title, the subline of §10.3 and the ★ critical chain line. 3. `renderTabs(runs, tab)`:
    'All runs (n)' plus one tab per run with done/total. 4. `renderCards(metrics)`: the four cards of §9.2 with big
    number, stack bar, rows with value and percent, foot line and an Assumptions details list. 5. `renderUtil(util)`:
    a collapsed details panel with the summary line, three meters and the by-size and by-agent tables (8 rows, 'n more').
    6. A slot for header actions registered by plugins (§11).""",
    acs=[
        ("happy", f"Given `{F}/beam.sample.json`, when the header renders, then chips, subline, chain and the four cards match `{P.d}/ui/screens/swimlane-plan.png` and the numbers equal `{F}/expected/view.metrics.json`."),
        ("happy", f"Given both beams in `{F}/runs/`, when rendered, then tabs read 'All runs (2)', 'edit · d/t' and 'view · d/t' and the meta shows '2 runs · n running'."),
        ("edge", "Given estTotal null, when the run estimate card renders, then the big number and every row read '—' and the bar is empty."),
        ("negative", "Given a run with no repo, no instance and no owner, when the meta renders, then those chips are omitted, not shown empty."),
        ("happy", f"Given `{TEST}`, when run, then header.test.mjs passes."),
    ],
    screens=[S["swimlane-plan"], S["utilization"], S["multi-run"]], links=[P.spec("9"), P.spec("10.2"), EXP("view.metrics.json")])

P.T("WV-14", "Filters, search, view switch, theme, keyboard and File menu",
    size="M", lane="console", gate="G2", deps=["WV-02", "WV-03"],
    locks=[f"{A}/src/view/controls/"],
    why="""People narrow a run of hundreds of tickets to what matters now: the errored ones, one module, one Jira key.
    The status chips are both the legend and the filter, search covers every field people quote, and every action has
    a key so the page works without a mouse. Theme and the File menu live here too. Without them the views are a
    wall of color.""",
    what=f"""Create `{A}/src/view/controls/controls.mjs` and `controls.css` per SPEC §10.5 and §10.13. 1. Legend chips
    with counts per category; click toggles, double-click shows only that category (again: all). 2. Search: words
    are ANDed over id, title, Jira key, module, layer, agent, status, block, size and run name, case-insensitive.
    3. Segmented control Swimlane / Board / Table, Lanes select (board only), Color select (status or module), Zoom
    range (swimlane only); choices remembered in localStorage inside try/catch. 4. Theme toggle setting data-theme.
    5. File menu: Open status files (O), Open .warp folder (Shift+O), Reload (R), Auto-reload, Print (P), Close all
    files. 6. Keys: '/' focuses search, Escape closes menu and drawer, Enter/Space activate cards, rows, lane headers
    and sortable headers. 7. Export `matches(ticket, run, state)`.""",
    acs=[
        ("happy", "Given the legend, when In Progress is clicked, then those tickets dim on the swimlane and hide on the board and table, and the chip shows as off; a double-click on QA Ready leaves only QA Ready."),
        ("happy", "Given search 'rubric merged', when typed, then only tickets whose fields contain both words match."),
        ("edge", "Given focus in the search box, when 'r' and 'o' are typed, then they go into the box and do not reload or open files."),
        ("negative", "Given localStorage throws, when the view is switched and the theme toggled, then both work and nothing throws."),
        ("happy", f"Given `{TEST}`, when run, then controls.test.mjs passes."),
    ],
    screens=[S["swimlane-plan"], S["dark"]], links=[P.spec("10.5"), P.spec("10.13")])

P.T("WV-15", "Wire the app: store, render loop, drawer, tabs, print, plugin hooks",
    size="XL", lane="quality", gate="G2", deps=["WV-05", "WV-09", "WV-10", "WV-11", "WV-12", "WV-13", "WV-14"], critical_hint=True,
    locks=[f"{A}/src/main.mjs", f"{A}/src/store/", f"{A}/src/app.test.mjs"],
    why="""The modules only become a viewer when one store feeds them and one render loop keeps them in step:
    the legend, totals, swimlane, board and table must agree on every count. This ticket also fixes the extension
    points WarpEdit builds on, so the editor can add controls without touching viewer code, and proves the viewer
    itself has no control that changes a status.""",
    what=f"""Complete `{A}/src/main.mjs` and create `{A}/src/store/store.mjs` per SPEC §11. 1. Store: docs, runs,
    tab, view, groupBy, colorBy, zoom, clock, sort, off categories, query, closed lanes; `subscribe(fn)`,
    `replaceRuns(runs, reason)` and `recompute(run)` (blocks + plan again after a status change). 2. Render loop:
    meta, headline, tabs, cards, utilization, legend, then the active view; one delegated click/keydown/dblclick
    handler; drawer open/close; toasts; drop overlay; reload; auto-reload. 3. Print: beforeprint fits the swimlane to
    1020 px and opens utilization, afterprint restores. 4. `createApp({{root, plugins}})` with hooks `drawerSections`,
    `headerActions`, `swimlaneOverlays`, `keys`; the viewer passes no plugins. 5. `app.test.mjs`: jsdom on the built
    page with each fixture.""",
    acs=[
        ("happy", f"Given the built page with `{F}/beam.sample.json`, when each view is shown, then legend counts, card ticket counts, board lane counts and table row counts agree for every category."),
        ("happy", f"Given both run beams in `{F}/runs/`, when the edit tab is chosen, then every pane shows only the edit run and the meta shows run edit."),
        ("happy", "Given a plugin {drawerSections:[{id:'p', render:() => '<b id=p>P</b>'}]} passed to createApp, when a drawer opens, then #p is in it; with no plugins it is not."),
        ("negative", "Given the built viewer, when every button, select, input and menu item is exercised, then no ticket status in the store changes and the page contains no element with data-edit."),
        ("edge", "Given print is triggered on the swimlane, when beforeprint fires, then the swimlane width is 1020 px plus the label column, and afterprint restores the zoomed width."),
        ("happy", f"Given `{TEST}`, when run, then app.test.mjs passes on every fixture."),
    ],
    screens=[S["swimlane-plan"], S["board"], S["table"], S["multi-run"], S["print"]],
    links=[P.spec("11"), REF], risks="Medium: integration of seven modules; agreement test guards it.")

P.T("WV-16", "Release viewer.html, README and parity check",
    size="S", lane="release", gate="G3", deps=["WV-15"], critical_hint=True,
    locks=[f"{P.d}/viewer.html", f"{A}/README.md", f"{A}/test/parity.test.mjs"],
    why="""The deliverable is one file people open from disk. It must be built from the merged modules, committed,
    match the design of record on every fixture, and say clearly that it never changes a run: resetting a ticket
    is WarpEdit. Without a release ticket the repo holds modules nobody can open.""",
    what=f"""1. Run `npm --prefix {A} run release` to write `{P.d}/viewer.html` and commit it. 2. Write
    `{A}/README.md`: what the viewer is, how to open it, what it reads (beam.json, status.json, ticket state.json,
    WARP_PLAN.json exports, a .warp folder, several runs), the keys, the three views and the two clocks, and that it
    is read-only (resetting a phase is WarpEdit, `{P.d.replace('WarpView', 'WarpEdit')}/editor.html`). 3.
    `{A}/test/parity.test.mjs`: load viewer.html in jsdom with each fixture and compare blocks, plan, metrics and
    the table order with `{F}/expected/`; assert no element with data-edit and no text 'Reset'. 4. Capture the
    eleven screens and compare them with `{P.d}/ui/screens/*.png` (layout and color; small font differences pass).""",
    acs=[
        ("happy", f"Given `npm --prefix {A} run release`, when run, then `{P.d}/viewer.html` is written, is under 400 kB and opens from disk with the empty state."),
        ("happy", f"Given viewer.html with `{F}/beam.sample.json` dropped on it, when compared, then blocks, plan, metrics and table order equal `{F}/expected/`."),
        ("negative", "Given viewer.html, when searched, then it has no element with data-edit, no 'Reset' control and no network URL in markup or script."),
        ("edge", "Given the README, when read, then it names WarpEdit for resets and gives the sample path fixtures/beam.sample.json."),
        ("happy", f"Given `{TEST}`, when run, then parity.test.mjs passes."),
    ],
    screens=list(S.values()), links=[REF])

P.gate("G0", "Skeleton builds", ["WV-01"],
       [f"npm --prefix {A} ci && npm --prefix {A} test", f"npm --prefix {A} run build writes app/dist/viewer.html and it opens empty"],
       "Stop: nothing else can be tested until the build and test runner work.")
P.gate("G1", "Data and model match the reference", ["WV-02", "WV-03", "WV-04", "WV-05", "WV-06", "WV-07", "WV-08"],
       [f"npm --prefix {A} test (parse, blocks, plan and metrics equal fixtures/expected)", "tokens.css matches SPEC §12.1"],
       "Do not start the views on a model that disagrees with fixtures/expected; fix the model first.")
P.gate("G2", "Panes agree", ["WV-09", "WV-10", "WV-11", "WV-12", "WV-13", "WV-14", "WV-15"],
       ["Legend, cards, swimlane, board and table counts agree on every fixture", "No control changes a status", "createApp hooks work with a test plugin"],
       "WarpEdit starts after this gate (startAfter view:G2). If red, the edit run keeps waiting.")
P.gate("G3", "Ship", ["WV-16"], ["viewer.html committed, under 400 kB, parity.test.mjs green"], "Do not announce the viewer until parity is green.")
