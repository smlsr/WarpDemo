#!/usr/bin/env python3
"""Regenerate every generated file in WARPDEMO/ and check it all.

  python3 WARPDEMO/tools/make_all.py                 # tickets, schedules, plans, swimlanes, Jira, Linear
  python3 WARPDEMO/tools/make_all.py --warp <plugin>  # also check that Warp's scan reads each schedule
  python3 WARPDEMO/tools/make_all.py --strict         # also require fixtures, expected outputs and screens

Fixtures, expected outputs and screens come from gen_fixtures.py (needs the Warp plugin and Playwright).
Prints ALL CHECKS PASS or stops at the first failure.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402
import gen_docs  # noqa: E402
import gen_swimlane  # noqa: E402
import schedule  # noqa: E402
import tickets_edit  # noqa: E402
import tickets_view  # noqa: E402

GENERATED = "2026-10-13"
SCHEMA = json.loads((HERE / "ticket.schema.json").read_text())


def write(rel: str, text: str) -> None:
    p = REPO_ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text if text.endswith("\n") else text + "\n")


def dump(obj) -> str:
    return json.dumps(obj, indent=1, ensure_ascii=False) + "\n"


def check(cond, msg):
    if not cond:
        print("FAIL:", msg)
        sys.exit(1)


def clean_ticket(t):
    return {k: v for k, v in t.items() if not k.startswith("_") and k != "links"}


def natkey(s):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", s)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--warp", help="path to the Warp plugin (folder with scripts/scan.py)")
    ap.add_argument("--strict", action="store_true", help="require fixtures, expected outputs and screens")
    ap.add_argument("--no-pdf", action="store_true")
    args = ap.parse_args()

    packs = [tickets_view.P, tickets_edit.P]
    scheds = {}
    for pack in packs:
        d = pack.d
        sched = schedule.build(pack, GENERATED)
        scheds[pack.key] = sched
        rows = {t["id"]: t for t in sched["tickets"]}
        write(f"{d}/plan/schedule.json", dump(sched))
        write(f"{d}/tickets/tickets.json", dump(gen_docs.tickets_json(pack, GENERATED)))
        write(f"{d}/tickets/schema.json", dump(SCHEMA))
        write(f"{d}/tickets/TICKETS.md", gen_docs.tickets_md(pack, sched))
        write(f"{d}/tickets/jira-import.json", dump(gen_docs.jira_import([(pack, rows)])))
        write(f"{d}/tickets/JIRA_IMPORT.csv", gen_docs.jira_csv(pack, rows))
        write(f"{d}/tickets/linear-import.json", dump(gen_docs.linear_import(pack, rows)))
        write(f"{d}/tickets/IMPORT.md", gen_docs.import_md(pack))
        write(f"{d}/plan/CURSOR_PLAN.md", gen_docs.cursor_plan(pack, sched))
        write(f"{d}/plan/BUILD_PLAN.md", gen_docs.build_plan(pack, sched))
        if not args.no_pdf:
            work = REPO_ROOT / ".swimlane-work"
            work.mkdir(exist_ok=True)
            pdf = REPO_ROOT / d / "plan/CURSOR_SWIMLANE.pdf"
            pages = gen_swimlane.render(sched, str(pdf), str(work / pack.key), d)
            subprocess.run(["pdftoppm", "-r", "110", "-png", "-f", "1", "-l", "1", "-singlefile", str(pdf), str(REPO_ROOT / d / "plan/CURSOR_SWIMLANE")], check=True)
            for f in work.iterdir():
                f.unlink()
            work.rmdir()
            check(pages >= 2, f"{d} swimlane has {pages} pages")
    write("WARPDEMO/JIRA_IMPORT.json", dump(gen_docs.jira_import([(p, {t["id"]: t for t in scheds[p.key]["tickets"]}) for p in packs])))

    # ------------------------------------------------------------ checks
    import jsonschema

    all_ids = {}
    for pack in packs:
        for t in pack.tickets:
            all_ids[t["tempId"]] = pack.key
    for pack in packs:
        d = pack.d
        doc = json.loads((REPO_ROOT / d / "tickets/tickets.json").read_text())
        jsonschema.validate(doc, SCHEMA)
        ids = [t["tempId"] for t in doc["tickets"]]
        check(len(ids) == len(set(ids)), f"{d} duplicate ids")
        for t in pack.tickets:
            for dep in t["blockedByTempIds"]:
                if ":" in dep:
                    run, tid = dep.split(":", 1)
                    check(all_ids.get(tid) == run and run != pack.key, f"{t['tempId']} cross-run blocker {dep} must name a ticket of another run")
                else:
                    check(dep in ids, f"{t['tempId']} blocker {dep} missing")
            for l in t["links"]:
                if args.strict or not any(z in l["url"] for z in ("/ui/", "/fixtures/")):
                    check((REPO_ROOT / l["url"]).exists(), f"{t['tempId']} link target missing: {l['url']}")
        # schedule invariants
        S = scheds[pack.key]
        TK = {t["id"]: t for t in S["tickets"]}
        for t in TK.values():
            for dep in t["after"]:
                if dep in TK:
                    check(TK[dep]["merge"] <= t["start"] + 1e-9, f"{t['id']} starts before {dep} merges")
        for a in TK.values():
            for b in TK.values():
                if a["id"] < b["id"] and a["start"] < b["start"] + b["h"] - 1e-9 and b["start"] < a["start"] + a["h"] - 1e-9:
                    check(a["slot"] != b["slot"], f"{a['id']} and {b['id']} share slot {a['slot']}")
                    check(not any(schedule.overlap(x, y) for x in a["locks"] for y in b["locks"]), f"{a['id']} and {b['id']} share a lock while both run")
        check(max(len(s["running"]) for s in S["steps"]) <= S["model"]["slots"], "slot cap exceeded")
        check(S["lock_pairs"] == [], f"{d} lock pairs: {S['lock_pairs']}")
        # Jira import
        J = json.loads((REPO_ROOT / d / "tickets/jira-import.json").read_text())
        iss = J["projects"][0]["issues"]
        check(len(iss) == len(ids), "one Jira issue per ticket")
        ext = {i["externalId"] for i in iss}
        for l in J["links"]:
            check(l["sourceId"] in ext and l["destinationId"] in ext, f"Jira link {l} does not resolve")
        for i in iss:
            check(len(i["description"]) < 32767 and i["priority"] in ("Highest", "High", "Medium", "Low", "Lowest"), f"{i['externalId']} description or priority")
            for need in ("h2. Size", "h2. Locks", "h2. Blocked by", "h2. Acceptance"):
                check(need in i["description"], f"{i['externalId']} lacks {need} (Warp reads it)")
        # pack zone stays read-only
        for t in pack.tickets:
            for p in t["_locks"]:
                check(not re.match(rf"{re.escape(d)}/(spec|plan|tickets|fixtures|ui)/", p), f"{t['tempId']} locks the pack zone: {p}")
    # every SPEC section a ticket cites exists
    for pack in packs:
        heads = set()
        for line in (REPO_ROOT / pack.d / "spec/SPEC.md").read_text().splitlines():
            mm = re.match(r"#{2,4} (\d+(?:\.\d+)?)[ .]", line)
            if mm:
                heads.add(mm.group(1))
        for t in pack.tickets:
            text = json.dumps(clean_ticket(t))
            for ref in set(re.findall(r"§(\d+(?:\.\d+)?)", text)):
                if "WarpView SPEC" in text and pack.key == "edit" and ref not in heads:
                    continue
                check(ref in heads, f"{t['tempId']} cites SPEC §{ref}, which {pack.d}/spec/SPEC.md does not have")
    combined = json.loads((REPO_ROOT / "WARPDEMO/JIRA_IMPORT.json").read_text())
    check(any(l["sourceId"] == "WV-15" and l["destinationId"] == "WE-01" for l in combined["links"]), "combined import lacks WV-15 → WE-01")

    if args.warp:
        sys.path.insert(0, str(Path(args.warp) / "scripts"))
        scan = importlib.import_module("scan")
        for pack in packs:
            got = scan.from_schedule(REPO_ROOT / pack.d / "plan/schedule.json")
            check(got and got["format"] == "build-schedule/2", f"Warp did not read {pack.d}/plan/schedule.json as build-schedule/2")
            S = scheds[pack.key]
            byid = {t["id"]: t for t in got["tickets"]}
            check(set(byid) == {t["id"] for t in S["tickets"]}, "Warp ticket ids differ")
            for t in S["tickets"]:
                w = byid[t["id"]]
                check(w["after"] == t["after"] and w["hours"] == t["h"] and w["size"] == t["size"] and w["gate"] == t["gate"] and w["critical"] == t["critical"],
                      f"Warp reads {t['id']} differently: {w}")
            check(got["criticalPath"] == S["critical_chain"], "Warp critical path differs")
            check([g["key"] for g in got["gates"]] == [g["key"] for g in S["gates"]] and all(g.get("ifRed") for g in got["gates"]), "Warp gates differ")
            # build-schedule/2 extras (Warp 1.6.2+): plan, priority gates, merge checks, gate order and gate details
            meta = got.get("schedule") or {}
            check(meta.get("gateOrder") == S["model"]["gate_order"], f"Warp gate order {meta.get('gateOrder')} differs from model.gate_order {S['model']['gate_order']} (Warp 1.6.2+ needed)")
            for t in S["tickets"]:
                w = byid[t["id"]]
                pl = w.get("planned") or {}
                check((w.get("priorityGate") or "") == t["priority_gate"], f"Warp reads {t['id']} priority gate as {w.get('priorityGate')}")
                check(pl.get("slot") == t["slot"] and pl.get("start") == t["start"] and pl.get("merge") == t["merge"], f"Warp reads {t['id']} planned times as {pl}")
                check([c.get("check") for c in w.get("checks") or []] == [c["check"] for c in t["checks"]], f"Warp reads {t['id']} checks differently")
                check(w.get("lane") == t["lane"] and w.get("repo") == t["repo"], f"Warp reads {t['id']} lane/repo differently")
            for g, sg in zip(got["gates"], S["gates"]):
                check(g.get("at") == sg["at"] and g.get("onGreen") == sg["on_green"] and bool(g.get("priority")) == sg["priority"] and list(g.get("starts") or []) == sg["starts"],
                      f"Warp reads gate {sg['key']} differently: {g}")
                check(g.get("hold") == ("green" if S["model"]["gate_order"] == "strict" else "red"), f"gate {sg['key']} hold {g.get('hold')}")
        print("warp: scan reads both schedules (ids, blockers, hours, sizes, gates, critical chain, plan, priority gates, checks, gate order)")

    if args.strict:
        for pack in packs:
            exp = REPO_ROOT / pack.d / "fixtures/expected"
            check(exp.is_dir() and any(exp.iterdir()), f"{exp} missing (run gen_fixtures.py)")
            shots = json.loads((REPO_ROOT / pack.d / "ui/screens/screens.json").read_text())
            for s in shots["screens"]:
                check((REPO_ROOT / s["png"]).exists() and (REPO_ROOT / s["html"]).exists(), f"screen {s['id']} missing")
                check(s["tickets"], f"screen {s['id']} has no ticket")
            for t in pack.tickets:
                ui = t.get("userInterface")
                if ui:
                    for u in ui["visualBaseline"].split(" · "):
                        check((REPO_ROOT / u).exists(), f"{t['tempId']} names missing screen {u}")
        # numbers quoted in ACs equal the expected outputs
        big = json.loads((REPO_ROOT / tickets_view.P.d / "fixtures/expected/big.plan.json").read_text())
        bigm = json.loads((REPO_ROOT / tickets_view.P.d / "fixtures/expected/big.metrics.json").read_text())
        t07 = next(t for t in tickets_view.P.tickets if t["tempId"] == "WV-07")
        claim = f"finish T+{round(big['finish'])}, peak {big['peak']}, {big['slots']} slots"
        check(any(claim in a["text"] for a in t07["acceptanceCriteria"]), f"WV-07 AC must say '{claim}'")
        t08 = next(t for t in tickets_view.P.tickets if t["tempId"] == "WV-08")
        claim = f"run estimate is {bigm['estTotal']:g}, agent hours {bigm['agentTotal']:g}, people hours {bigm['humanTotal']:g} and tickets {bigm['ticketTotal']} with {bigm['count']['done']} completed"
        check(any(claim in a["text"] for a in t08["acceptanceCriteria"]), f"WV-08 AC must say '{claim}'")
    print("ALL CHECKS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
