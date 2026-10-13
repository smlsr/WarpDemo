"""tickets.json, TICKETS.md, Jira and Linear imports, CURSOR_PLAN.md and BUILD_PLAN.md for one module."""

from __future__ import annotations

import csv
import io
import json
import re

from common import APPROVAL_HOURS, AUTO_MERGE_SIZES, BROWSE, PROJECT_KEY, PROJECT_NAME, REPO, ROOT, SLOTS


def g(x):
    return "%g" % x


def clean(t):
    return {k: v for k, v in t.items() if not k.startswith("_")}


def tickets_json(pack, generated):
    return {
        "projectKey": PROJECT_KEY,
        "defaultIssueType": "Story",
        "defaultLabels": ["warp-demo", f"run:{pack.m['run']}"],
        "source": {"prdTitle": f"{pack.m['name']} spec ({pack.d}/spec/SPEC.md)", "prdVersion": "2", "generatedAt": generated},
        "tickets": [clean(t) for t in pack.tickets],
    }


# ---------------------------------------------------------------- Jira wiki markup
def wiki_escape(text: str) -> str:
    out = []
    for part in re.split(r"(`[^`]+`)", text):
        if part.startswith("`") and part.endswith("`") and len(part) > 1:
            inner = part[1:-1].replace("{", "\\{").replace("}", "\\}")
            out.append("{{" + inner + "}}")
        else:
            out.append(re.sub(r"([*_{}\[\]|^~+#!])", r"\\\1", part))
    return "".join(out)


def flat(text):
    return re.sub(r"\s+", " ", text).strip()


def numbered(text):
    """'1. a 2. b' -> ['a', 'b'] (deliverables written inline)."""
    parts = re.split(r"(?:(?<=\s)|^)(\d{1,2})\.\s", " " + flat(text))
    items, cur = [], None
    for p in parts:
        if re.fullmatch(r"\d{1,2}", p or ""):
            cur = []
            items.append(cur)
        elif cur is not None:
            cur.append(p.strip())
        elif p.strip():
            items.append([p.strip()])
    return [" ".join(i).strip() for i in items if " ".join(i).strip()]


def jira_description(pack, t, row):
    m = pack.m
    lines = [
        "{panel:title=Start|borderStyle=solid}",
        f"Repo *{REPO}* · run *{m['run']}* · pack {{{{{pack.d}/}}}} (read-only) · code under {{{{{pack.app}/}}}}",
        f"Start a Cursor agent with: *Implement {t['tempId']}*",
        "{panel}",
        "",
        "h2. Plan",
        "||Run||Size||Gate||Slot||Start||Merge||Critical||Merge rule||",
        f"|{m['run']}|{t['_size']} · {t['_h']}h|{t['_gate']}|{row['slot']}|T+{g(row['start'])}h|T+{g(row['merge'])}h|{'yes' if row['critical'] else 'no'}|{'auto-merge after Bugbot' if t['_size'] in AUTO_MERGE_SIZES else 'wait for APPROVED'}|",
        "",
        "h2. Size",
        f"{t['_size']} — {'auto-merge after Bugbot' if t['_size'] in AUTO_MERGE_SIZES else 'wait for APPROVED'}",
        "",
        "h2. Locks",
        *[f"{{{{{p}}}}}" for p in t["_locks"]],
        "",
        "h2. Blocked by",
        ", ".join(t["blockedByTempIds"]) or "none",
        "",
        "h2. Why",
        wiki_escape(flat(t["why"])),
        "",
        "h2. What",
        *[f"# {wiki_escape(x)}" for x in numbered(t["what"])],
        "",
        "h2. Acceptance",
        *[f"* *{a['id']}* ({a['kind']}) {wiki_escape(a['text'])}" for a in t["acceptanceCriteria"]],
    ]
    if t["outOfScope"]:
        lines += ["", "h2. Out of scope", *[f"* {wiki_escape(x)}" for x in t["outOfScope"]]]
    ui = t.get("userInterface")
    if ui:
        lines += ["", "h2. UI design files", *[f"* [{s}|{BROWSE}{u}] ({{{{{u}}}}})" for s, u in zip(ui["screens"], ui["visualBaseline"].split(" · "))]]
    lines += [
        "", "h2. Test data", wiki_escape(t["environment"]["testData"]),
        "", "h2. Risks and rollback", wiki_escape(t["dependenciesRisks"]["risks"]) + " " + wiki_escape(t["dependenciesRisks"]["rollback"]),
        "", "h2. References", *[f"* [{l['title']}|{BROWSE}{l['url']}] ({{{{{l['url']}}}}})" for l in t["links"]],
        "", "h2. Definition of done",
        f"* Every AC passes; {{{{npm --prefix {pack.app} test}}}} is green on the head of main.",
        "* One PR titled {{[" + t["tempId"] + "] " + t["summary"].replace("{", "").replace("}", "") + "}}; only the lock paths above changed (plus append-only files named in AGENTS.md).",
        "* Screens named above match within layout and color.",
        "", "h2. External ID", t["tempId"],
    ]
    text = "\n".join(lines)
    assert len(text) < 32000, t["tempId"]
    return text


def jira_issue(pack, t, row):
    size = t["_size"]
    labels = [f"ext:{t['tempId']}", f"warp:{t['tempId']}", f"size:{size}", "auto-merge" if size in AUTO_MERGE_SIZES else "needs-approval",
              f"gate:{t['_gate']}", f"lane:{t['_lane']}", f"run:{pack.m['run']}", "warp-demo"] + (["critical-path"] if row["critical"] else [])
    return {
        "externalId": t["tempId"],
        "issueType": "Story",
        "status": "To Do",
        "priority": t["priority"],
        "summary": t["summary"],
        "description": jira_description(pack, t, row),
        "labels": labels,
        "components": [pack.m["name"]],
        "customFieldValues": [{"fieldName": "External ID", "fieldType": "com.atlassian.jira.plugin.system.customfieldtypes:textfield", "value": t["tempId"]}],
    }


def jira_import(packs_rows, cross=True):
    issues, links, comps = [], [], []
    ids = set()
    for pack, rows in packs_rows:
        comps.append(pack.m["name"])
        for t in pack.tickets:
            issues.append(jira_issue(pack, t, rows[t["tempId"]]))
            ids.add(t["tempId"])
    for pack, rows in packs_rows:
        for t in pack.tickets:
            for d in t["blockedByTempIds"]:
                dep = d.split(":", 1)[1] if ":" in d else d
                if dep in ids:
                    links.append({"name": "Blocks", "sourceId": dep, "destinationId": t["tempId"]})
    return {"users": [], "links": links, "projects": [{
        "name": PROJECT_NAME, "key": PROJECT_KEY, "type": "software",
        "description": "WarpView and WarpEdit, the WARPDEMO packs run by Warp (runs view and edit).",
        "components": comps, "issues": issues}]}


def jira_csv(pack, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    maxl = max(len(jira_issue(pack, t, rows[t["tempId"]])["labels"]) for t in pack.tickets)
    maxb = max(len(t["blockedByTempIds"]) for t in pack.tickets) or 1
    w.writerow(["Issue ID", "Issue Type", "Summary", "Priority", "Status", "Component"] + ["Labels"] * maxl + ["Blocked By"] * maxb + ["External ID", "Description"])
    for t in pack.tickets:
        iss = jira_issue(pack, t, rows[t["tempId"]])
        labs = iss["labels"] + [""] * (maxl - len(iss["labels"]))
        bl = list(t["blockedByTempIds"]) + [""] * (maxb - len(t["blockedByTempIds"]))
        w.writerow([t["tempId"], "Story", t["summary"], t["priority"], "To Do", pack.m["name"]] + labs + bl + [t["tempId"], iss["description"]])
    return buf.getvalue()


def linear_import(pack, rows):
    return {
        "team": PROJECT_KEY,
        "project": pack.m["name"],
        "issues": [{"externalId": t["tempId"], "title": f"[{t['tempId']}] {t['summary']}", "priority": 2 if t["priority"] == "High" else 3,
                    "estimate": t["_h"], "labels": [f"size:{t['_size']}", f"gate:{t['_gate']}", f"lane:{t['_lane']}"],
                    "description": f"{flat(t['why'])}\n\n**What**\n\n" + "\n".join(f"{n + 1}. {x}" for n, x in enumerate(numbered(t['what']))) +
                                   "\n\n**Acceptance**\n\n" + "\n".join(f"- {a['id']} ({a['kind']}): {a['text']}" for a in t["acceptanceCriteria"]) +
                                   "\n\n**Locks**: " + ", ".join(f"`{p}`" for p in t["_locks"]),
                    "blockedBy": list(t["blockedByTempIds"])} for t in pack.tickets],
        "relations": [{"type": "blocks", "from": d, "to": t["tempId"]} for t in pack.tickets for d in t["blockedByTempIds"]],
        "note": "Create issues with issueCreate, then relations with issueRelationCreate (type blocks). CSV import drops blockers.",
    }


def import_md(pack):
    m = pack.m
    other = [d for t in pack.tickets for d in t["blockedByTempIds"] if ":" in d]
    return f"""# Import {m['name']} tickets

Project **{PROJECT_KEY}** ({PROJECT_NAME}), component **{m['name']}**. {len(pack.tickets)} issues.

## Jira (recommended): JSON importer

1. Jira settings → System → External system import → JSON. Upload `tickets/jira-import.json`.
2. Map the custom field **External ID** (text). If the site has no such field, the labels `ext:<id>` and `warp:<id>` carry the plan id; Warp finds issues by External ID first, then by the `warp:<id>` label.
3. The importer creates the **Blocks** links listed under `links` (blocker → blocked).
{"4. Cross-run blocker: " + ", ".join(other) + f" lives in the other pack. Import `{ROOT}/JIRA_IMPORT.json` instead (both packs and that link), or add the link by hand after importing both." if other else "4. No blocker in another pack."}

Already imported the old WarpView/WarpEdit packs into {PROJECT_KEY}? Those issues carry the same External IDs with old summaries. Archive or delete them first, or Warp will map the plan ids to the old issues.

## Jira: CSV fallback

`tickets/JIRA_IMPORT.csv`: one row per ticket; repeated **Labels** and **Blocked By** columns; External ID and the full description. Map Issue ID to the issue id column so Blocked By resolves.

## Linear

`tickets/linear-import.json`: issueCreate for each issue, then issueRelationCreate (type blocks) for each relation. Linear's CSV import drops blockers.

## After import

Nothing to assign: Warp dispatches by plan, not by person. Run `/warp-init {m['run']}`, `/warp-scan {pack.d}`, then `/warp-start` (see `{ROOT}/README.md`).
"""


def tickets_md(pack, sched):
    rows = {t["id"]: t for t in sched["tickets"]}
    out = [f"# {pack.m['name']} tickets ({len(pack.tickets)})", "",
           f"Generated from `{ROOT}/tools/tickets_{pack.key}.py`. The schema is `tickets/schema.json`. Paths are repo-root-relative.", ""]
    for t in pack.tickets:
        r = rows[t["tempId"]]
        out += [f"## {t['tempId']} — {t['summary']}", "",
                f"Size **{t['_size']}** ({t['_h']}h) · gate **{t['_gate']}** · lane {t['_lane']} · slot {r['slot']} · T+{g(r['start'])}h → T+{g(r['merge'])}h" + (" · ★ critical" if r["critical"] else "") +
                f" · blocked by {', '.join(t['blockedByTempIds']) or 'nothing'}", "",
                "**Why.** " + flat(t["why"]), "", "**What.**", ""]
        out += [f"{n + 1}. {x}" for n, x in enumerate(numbered(t["what"]))]
        out += ["", "**Acceptance.**", ""] + [f"- **{a['id']}** ({a['kind']}) {a['text']}" for a in t["acceptanceCriteria"]]
        out += ["", "**Locks.** " + ", ".join(f"`{p}`" for p in t["_locks"])]
        if t.get("userInterface"):
            out += ["", "**Screens.** " + ", ".join(f"`{u}`" for u in t["userInterface"]["visualBaseline"].split(" · "))]
        out += ["", "**Links.** " + " · ".join(f"[{l['title']}]({'../../../' + l['url']})" for l in t["links"]), ""]
    return "\n".join(out)


# ---------------------------------------------------------------- plans
def cursor_plan(pack, sched):
    m = pack.m
    T = {t["id"]: t for t in sched["tickets"]}
    n = sched["numbers"]
    waves = {}
    for t in sched["tickets"]:
        waves.setdefault(t["wave"], []).append(t["id"])
    o = [f"# CURSOR_PLAN — {m['name']}", "",
         f"{m['job']}", "",
         f"One orchestrator (Warp, run **{m['run']}**) drives up to {SLOTS} agents; every ticket merges when green. "
         f"The runbook is `{pack.d}/plan/BUILD_PLAN.md`, the picture `{pack.d}/plan/CURSOR_SWIMLANE.pdf`, the data `{pack.d}/plan/schedule.json` (build-schedule/2).", "",
         "## Rules", "",
         f"1. One ticket = one agent = one branch = one PR. Start an agent with `Implement <ID>`. Branch `warp/{m['run']}/<ID>-<jira>` (Warp names it).",
         f"2. The pack (`{pack.d}/spec`, `plan`, `tickets`, `fixtures`, `ui`) is read-only. Code goes under the ticket's lock paths inside `{pack.app}/`.",
         "3. Ready = every blocker merged; a gate block starts when every earlier block has merged. The schedule says so (`model.gate_order: strict`), so Warp 1.6.2 keeps its block order for this build-schedule/2 file instead of treating gates as milestones.",
         "4. Two tickets in flight never share a lock path. Append-only files (keep both sides on conflict): " + (f"`{pack.app}/src/plugins.mjs`." if pack.key == "edit" else "none."),
         f"5. Sizes {', '.join(AUTO_MERGE_SIZES)} auto-merge after Bugbot; L and XL wait for APPROVED ({APPROVAL_HOURS} h in the plan).",
         f"6. Tests: `npm --prefix {pack.app} test` must be green before a PR is opened. Each AC has a test.",
         "7. Priority: ★ critical chain first, then the members and ancestors of a priority gate" + (f" ({', '.join(g_['key'] for g_ in sched['gates'] if g_['priority'])})" if any(g_["priority"] for g_ in sched["gates"]) else " (none in this run)") + ", then rank, then id.",
         "8. When a gate turns green Warp prints its `on_green` command for the parent to run (`blocks.py show`, the block summary) and the programs it starts.",
         ]
    if m["startAfter"]:
        o += [f"9. This run starts after **{m['startAfter']}** (`startAfter: {m['startAfter']}` in its config). WE-01 is blocked by view:WV-15 in the other run."]
    o += ["", "## Day 0", "",
          f"1. `/warp-init {m['run']}` in this repo's checkout. Set in `.warp/config.yaml`: `paths: {m['paths'][0]}`" + (f", `startAfter: {m['startAfter']}`" if m["startAfter"] else "") +
          (f", `appendOnlyPaths: {pack.app}/src/plugins.mjs`" if pack.key == "edit" else "") + ", `jiraProject: WAR`.",
          f"2. `/warp-scan {pack.d}` — Warp reads `plan/schedule.json` (build-schedule/2).",
          f"3. Import Jira from `tickets/jira-import.json` (see `tickets/IMPORT.md`), then `/warp-jira-check`.",
          "4. `/warp-start` (or a range, for example `/warp-start G0-G1`).", "",
          "## Numbers", "",
          f"{n['tickets']} tickets · {n['agent_hours']} agent-hours · finish T+{g(n['finish_h'])}h · critical chain {g(n['critical_path_h'])}h over {n['critical_tickets']} tickets · peak {n['peak']} in flight · {n['waves']} waves", "",
          "★ " + " → ".join(sched["critical_chain"]), "",
          "## Gates", "", "| Gate | Name | Members | Reached | Checks | If red | Priority · starts |", "|---|---|---|---|---|---|---|"]
    for gt in sched["gates"]:
        extra = " · ".join(x for x in (("priority" if gt["priority"] else ""), ("starts " + ", ".join(gt["starts"]) if gt["starts"] else "")) if x) or "—"
        o.append(f"| {gt['key']} | {gt['name']} | {', '.join(gt['members'])} | T+{g(gt['at'])}h | {'; '.join(gt['checks'])} | {gt['if_red']} | {extra} |")
    o += ["", "## Dependency levels", "", "Tickets in one level can run in parallel (∥) unless their gate block is not open yet.", ""]
    for w in sorted(waves):
        o.append(f"### Level {w}")
        o.append("")
        for i in sorted(waves[w], key=lambda i: T[i]["rank"]):
            t = T[i]
            o.append(f"- **{i}**{' ★' if t['critical'] else ''} {t['summary']} · {t['size']}·{g(t['h'])}h · gate {t['gate']} · rank {t['rank']} · after {', '.join(t['after']) or '—'} · locks {', '.join('`' + p + '`' for p in t['locks'])}")
        o.append("")
    o += ["## Ticket table", "", "| id | size | gate | after | summary |", "|---|---|---|---|---|"]
    for t in sorted(sched["tickets"], key=lambda t: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", t["id"])]):
        o.append(f"| {t['id']} | {t['size']} | {t['gate']} | {', '.join(t['after']) or '—'} | {t['summary']} |")
    o.append("")
    return "\n".join(o)


def build_plan(pack, sched):
    m = pack.m
    T = {t["id"]: t for t in sched["tickets"]}
    n = sched["numbers"]
    tp = lambda x: f"T+{g(x)}h"
    tid = lambda i: f"{i}{' ★' if T[i]['critical'] else ''}" if i in T else i
    ids = lambda xs: ", ".join(tid(i) for i in xs) if xs else "—"
    o = [f"# BUILD_PLAN — {m['name']} runbook", "",
         f"{n['tickets']} tickets for `{pack.d}`, run **{m['run']}**, one orchestrator (Warp) driving up to {SLOTS} agents; each ticket merges when green. "
         f"Rules: `{pack.d}/plan/CURSOR_PLAN.md`. Picture: `{pack.d}/plan/CURSOR_SWIMLANE.pdf`. Data: `{pack.d}/plan/schedule.json`.", "",
         "## The numbers", "", "| | |", "|---|---|",
         f"| Tickets | {n['tickets']} |", f"| Agent-hours | {n['agent_hours']} h |", f"| Slots | {SLOTS} (Warp's default maxAgents) |",
         f"| Finish | **{tp(n['finish_h'])}** |", f"| Critical chain | {g(n['critical_path_h'])} h — {' → '.join(sched['critical_chain'])} |",
         f"| Peak in flight | {n['peak']} |", f"| Waves (dependency levels) | {n['waves']} |",
         f"| Finish by slots | " + " · ".join(f"{k}: {tp(v)}" for k, v in n["finish_by_slots"].items()) + " |", "",
         "The run is chain-bound, not agent-bound: past the slot count where the finish stops falling, more agents do not help; shortening the ★ chain does.", "",
         "## How to read the clock", "",
         "- `T+h` is estimate-hours on a continuous clock from the moment the run starts" + (f" (this run starts when {m['startAfter']} is reached)." if m["startAfter"] else "."),
         "- Hours are the size estimates (S=4, M=7, L=11, XL=16). Real runs drift; the order does not.",
         f"- L and XL tickets wait {APPROVAL_HOURS} h for approval before their dependents start.",
         "- A gate block starts when every earlier block has merged (`model.gate_order: strict` in schedule.json).",
         "- Priority: ★ critical chain, then tickets on a priority gate's path (`priority_gate`), then rank.", "",
         "## Gates", "", "| Gate | Name | Reached | Closes with | Checks | If red |", "|---|---|---|---|---|---|"]
    for gt in sched["gates"]:
        o.append(f"| {gt['key']} | {gt['name']} | {tp(gt['at'])} | {ids(gt['closes_with'])} | {'; '.join(gt['checks'])} | {gt['if_red']} |")
    o += ["", "## Day 0", "",
          f"1. Repo `{REPO}`, branch `main`, this pack at `{pack.d}/`.",
          f"2. `/warp-init {m['run']}`; config: `paths: {m['paths'][0]}`" + (f", `startAfter: {m['startAfter']}`" if m["startAfter"] else "") + ".",
          f"3. Jira: import `{pack.d}/tickets/jira-import.json` (project WAR).",
          f"4. `/warp-scan {pack.d}` then `/warp-start`.", "",
          "## Steps", ""]
    for s in sched["steps"]:
        head = f"### Step {s['n']} — {tp(s['t'])}" + (" · " + ", ".join(s["gates"]) + " reached" if s["gates"] else "")
        o += [head, ""]
        if s["merges"]:
            o.append(f"- **Merge:** {ids(s['merges'])}")
        for k in s["gates"]:
            gt = next(x for x in sched["gates"] if x["key"] == k)
            o.append(f"- **Gate {k} {gt['name']}:** {'; '.join(gt['checks'])}")
        if s["starts"]:
            o.append("- **Start:**")
            for i in s["starts"]:
                t = T[i]
                o.append(f"  - **{tid(i)}** → slot {t['slot']} · {t['size']}·{g(t['h'])}h · merge ≈ {tp(t['merge'])} · {t['why']} · rank {t['rank']}")
        if s["queued"]:
            o.append(f"- **Queued:** {ids(s['queued'])}")
        o.append(f"- **In flight:** {len(s['running'])}" + (f" ({ids(s['running'])})" if s["running"] else " — done" if not s["starts"] else ""))
        o.append("")
    o += ["## Trigger table", "", "| Ticket | Rank | Gate | Size | Slot | Start | Merge | Starts when merged | Unlocks |", "|---|---|---|---|---|---|---|---|---|"]
    for t in sched["tickets"]:
        o.append(f"| {tid(t['id'])} | {t['rank']} | {t['gate']} | {t['size']}·{g(t['h'])}h | {t['slot']} | {tp(t['start'])} | {tp(t['merge'])} | {', '.join(t['after']) or '—'} | {', '.join(t['unlocks']) or '—'} |")
    o.append("")
    return "\n".join(o)
