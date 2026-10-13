"""Screen catalog: one PNG (and an HTML capture) per screen under <module>/ui/screens/."""

VIEW = [
    ("swimlane-plan", "Swimlane, plan clock", "Header, totals and the slot swimlane on the estimate-hour clock", ["loaded", "filtered", "search hit"]),
    ("swimlane-actual", "Swimlane, actual clock", "Bars from claim to merge on hours since the run started, with the now line", ["loaded", "running"]),
    ("board", "Board", "Lanes by gate block with ticket cards; cleared lanes collapsed", ["loaded", "lane collapsed"]),
    ("table", "Table", "Sortable table with status and the four pull request timestamps", ["loaded", "sorted"]),
    ("drawer", "Ticket drawer", "Every field of one ticket, its timestamps, dependencies, locks and events", ["open"]),
    ("utilization", "Utilization", "Active agents over maxAgents, hours spent over the estimate, tokens and minutes by size and agent", ["expanded"]),
    ("multi-run", "Several runs", "Two runs opened side by side; tabs and summed totals", ["all runs", "one run"]),
    ("empty", "Empty state", "Nothing loaded: open or drop files", ["empty"]),
    ("dark", "Dark theme", "The swimlane screen in the dark theme", ["dark"]),
    ("phone", "Phone width", "390 px: stacked totals, scrollable swimlane, no page scroll sideways", ["narrow"]),
    ("print", "Print", "Landscape page: header, totals and the swimlane fitted to the page width", ["print"]),
]

EDIT = [
    ("edit-drawer", "Drawer with reset", "The WarpView drawer plus the Reset section: phase menu, Reset button and the reset log", ["merged ticket", "after a reset"]),
    ("edit-confirm", "Confirm reset", "Names the ticket, the from phase and the to phase, the dependents it blocks, and a note", ["open", "with dependents"]),
    ("edit-header", "Unsaved changes", "Header actions: unsaved count, Undo, Redo, Save, Copy as commands", ["dirty", "clean"]),
    ("edit-validation", "Save blocked", "Validation banner naming each problem and its ticket; Save disabled", ["errors"]),
    ("edit-scrubber", "Phase scrubber", "Time slider over the actual swimlane; each bar shows its phase at that time; reset markers", ["scrubbing"]),
]


def catalog(pack, rows):
    out = {}
    for sid, title, job, states in rows:
        out[sid] = {"id": sid, "title": title, "job": job, "states": states,
                    "png": f"{pack.d}/ui/screens/{sid}.png", "html": f"{pack.d}/ui/screens/{sid}.html"}
    return out
