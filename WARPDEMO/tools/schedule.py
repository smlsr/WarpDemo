"""plan/schedule.json in build-schedule/2 for one module.

Same dispatch rule as Warp and as the viewer's plan (SPEC §7): `slots` agents, a ready ticket takes the
lowest free slot; ready = every in-run blocker merged and, with gate_order strict, every earlier gate block
merged; priority = critical chain first, then the members and ancestors of priority gates, then rank
(ascending latest_start), then natural id (Warp's orchestrator.sort_key). A ticket
whose size is not auto-merged waits APPROVAL_HOURS after it finishes before its dependents may start.
Cross-run blockers (`run:id`) are met before T+0: the run starts after its startAfter gate.
"""

from __future__ import annotations

import re
from collections import defaultdict

from common import APPROVAL_HOURS, AUTO_MERGE_SIZES, GATE_ORDER, MODULES, REPO, SLOTS, LANES

FIELDS = {
    "schema": "Format name and version (build-schedule/2), shared by every program's schedule.json.",
    "model": "How the run works: orchestrators, slots, merge rule, clock, priority rule, gate_order. gate_order strict: gate blocks run in order and a pending blocking gate holds the tickets that need its members (Warp's gateOrder strict); absent or deps: gates are milestones and nothing waits for a gate to be reached.",
    "numbers": "Totals for the run. finish_by_slots = finish in estimate-hours at other slot caps. old_plan = the plan this replaces (null where unknown).",
    "critical_chain": "Ticket ids on the longest blocker chain, in order.",
    "lanes": "Lane names; ticket.lane is one of these.",
    "repos": "Repositories; ticket.repo is one of these. One serial merge queue per repository.",
    "gates": "Milestones, checked the moment the last member merges. blocking=true: a red gate stops everyone; false: it stops only `scope`. behind = tickets that must be merged for it to be reached. on_green = the command the orchestrator runs when the checks pass (null when none). siblings = the sibling programs that start at this gate ([{program, prefix, relation}]; `sibling` = its first entry, null otherwise). starts = the program names that start at this gate. priority = members and their ancestors dispatch ahead of rank. With model.gate_order strict, a gate's members are its block and a block starts when the blocks before it have merged.",
    "lock_pairs": "Pairs of tickets that share a lock folder and have no blocker between them; never in flight together. Empty when every overlap is already ordered by a blocker.",
    "tickets": {
        "id / summary / module / layer / lane / wave / repo / file": "Identity. wave = dependency level (longest chain of blockers under the ticket). file is the main file the ticket writes, null when it owns a folder.",
        "size / h": "T-shirt size and estimate-hours (S=4, M=7, L=11, XL=16).",
        "rank / latest_start / critical / priority_gate": "Dispatch priority (1 first), the latest start in estimate-hours that still finishes on time, whether the ticket is on the critical chain, and the priority gate whose path the ticket is on ('' if none): such tickets dispatch after the critical chain and ahead of rank. Rank is ascending latest_start.",
        "slot / start / merge / ready / waited / why": "Simulated run: slot 1..slots, start and merge in estimate-hours, when the last blocker merged (or its block opened), hours spent ready but waiting, and why it could start then.",
        "after / after_other_modules / unlocks": "Blockers (Warp reads `after` as blockers; `run:id` names a ticket in another run), the subset in another run, and the tickets this one blocks.",
        "gate / first_gate / checks": "Gate the ticket is a member of ('' if none), the earliest gate that needs it ('' if none), and checks to run when this ticket merges: [{name, check, wave}], the checks of each gate this ticket closes.",
        "locks / locks_more / lock_pairs": "Lock folders and files (repo-root-relative), how many more were truncated (0 = complete), and lock-pair partners.",
        "screens / mock": "UI design files the ticket must match (empty / null when none).",
    },
    "steps": "One entry per moment something merges (step 0 = start). merges, starts, queued (ready, no slot), held (ready, lock partner in flight -> holders), running, free slots, gates reached.",
}


def natkey(s):
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", s)]


def overlap(a, b):
    a, b = a.rstrip("/"), b.rstrip("/")
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


def _graph(pack):
    T = {t["tempId"]: t for t in pack.tickets}
    deps = {i: [d for d in t["blockedByTempIds"] if d in T] for i, t in T.items()}
    ext = {i: [d for d in t["blockedByTempIds"] if d not in T] for i, t in T.items()}
    for i, ds in ext.items():
        for d in ds:
            assert ":" in d, (i, d, "an out-of-run blocker must be written run:id")
    kids = defaultdict(list)
    for i, ds in deps.items():
        for d in ds:
            kids[d].append(i)
    return T, deps, ext, kids


def wait_of(t):
    return 0.0 if t["_size"] in AUTO_MERGE_SIZES else APPROVAL_HOURS


def priority_paths(pack, deps):
    """ticket id -> the first priority gate (plan order) whose members or ancestors include it."""
    anc = {}

    def A(i):
        if i not in anc:
            s = set()
            for d in deps[i]:
                s |= {d} | A(d)
            anc[i] = s
        return anc[i]

    out = {}
    for g in pack.gates:
        if not g.get("priority"):
            continue
        for m in g["members"]:
            for i in {m} | A(m):
                out.setdefault(i, g["key"])
    return out


def simulate(pack, slots, strict=GATE_ORDER == "strict"):
    T, deps, _, kids = _graph(pack)
    pgate = priority_paths(pack, deps)
    order = [g["key"] for g in pack.gates]
    block = {i: T[i]["_gate"] for i in T}
    rankb = {k: n for n, k in enumerate(order)}
    # longest remaining chain (h + approval wait) -> latest start
    tail = {}

    def tl(i):
        if i not in tail:
            tail[i] = T[i]["_h"] + wait_of(T[i]) + max((tl(k) for k in kids[i]), default=0.0)
        return tail[i]

    for i in T:
        tl(i)
    cp_len = max(tail.values())
    latest = {i: cp_len - tail[i] for i in T}
    # critical chain: from the longest head, follow the child with the longest tail
    heads = [i for i in T if not deps[i]]
    cur = max(heads, key=lambda i: (tail[i], [-x for x in []], natkey(i)))
    chain = [cur]
    while kids[cur]:
        cur = max(kids[cur], key=lambda k: (tail[k], [-n for n in natkey(k) if isinstance(n, int)]))
        chain.append(cur)
    crit = set(chain)
    rank = {i: n + 1 for n, i in enumerate(sorted(T, key=lambda i: (latest[i], natkey(i))))}
    prio = lambda i: (0 if i in crit else 1, 0 if i in pgate else 1, rank[i], natkey(i))

    pending = set(T)
    start, end, merge, slot, ready_at, why = {}, {}, {}, {}, {}, {}
    free = [0.0] * slots
    left = defaultdict(int)
    for i in T:
        left[block[i]] += 1
    block_end = defaultdict(float)
    running = []
    now = 0.0
    steps = []
    guard = 0
    while pending and guard < 10000:
        guard += 1
        merged_now = []
        for r in list(running):
            if merge[r] <= now + 1e-9:
                running.remove(r)
                left[block[r]] -= 1
                block_end[block[r]] = max(block_end[block[r]], merge[r])
                merged_now.append(r)

        def open_block(i):
            if not strict or len(order) < 2:
                return True
            return all(left[k] == 0 for k in order if rankb[k] < rankb[block[i]])

        ready = [i for i in pending if all(d in merge and merge[d] <= now + 1e-9 for d in deps[i]) and open_block(i)]
        for i in ready:
            if i not in ready_at:
                ready_at[i] = now
        ready.sort(key=prio)
        starts = []
        held = {}
        for i in ready:
            s = next((n for n, f in enumerate(free) if f <= now + 1e-9), None)
            if s is None:
                break
            holders = [r for r in running if any(overlap(a, b) for a in T[i]["_locks"] for b in T[r]["_locks"])]
            if holders:
                held[i] = holders
                continue
            slot[i] = s + 1
            start[i] = now
            end[i] = now + T[i]["_h"]
            merge[i] = end[i] + wait_of(T[i])
            free[s] = end[i]
            running.append(i)
            pending.discard(i)
            starts.append(i)
            dd = [d for d in deps[i] if abs(merge[d] - now) < 1e-9]
            if not deps[i] and not T[i]["blockedByTempIds"]:
                why[i] = "no blockers"
            elif now - ready_at[i] > 1e-9:
                why[i] = f"queued since T+{ready_at[i]:g}h"
            elif dd:
                why[i] = "unblocked by " + ", ".join(dd)
            elif not deps[i]:
                why[i] = "blocker in another run, met when this run starts"
            else:
                why[i] = "its gate block opened"
        queued = sorted([i for i in ready if i in pending and i not in held], key=prio)
        steps.append({"t": now, "merges": sorted(merged_now, key=natkey), "starts": starts, "queued": queued, "held": held,
                      "running": sorted(running, key=lambda r: slot[r]), "free": sum(1 for f in free if f <= now + 1e-9)})
        nxt = [f for f in free if f > now + 1e-9] + [merge[r] for r in running if merge[r] > now + 1e-9]
        if not nxt:
            assert not pending, ("stuck", sorted(pending))
            break
        now = min(nxt)
    # drain remaining merges as steps
    while running:
        now = min(merge[r] for r in running)
        merged_now = [r for r in running if abs(merge[r] - now) < 1e-9]
        for r in merged_now:
            running.remove(r)
            left[block[r]] -= 1
            block_end[block[r]] = max(block_end[block[r]], merge[r])
        steps.append({"t": now, "merges": sorted(merged_now, key=natkey), "starts": [], "queued": [], "held": {},
                      "running": sorted(running, key=lambda r: slot[r]), "free": slots - len(running)})
    # merge consecutive entries at the same time
    out = []
    for s in steps:
        if out and abs(out[-1]["t"] - s["t"]) < 1e-9:
            o = out[-1]
            o["merges"] += [m for m in s["merges"] if m not in o["merges"]]
            o["starts"] += s["starts"]
            o["queued"], o["held"], o["running"], o["free"] = s["queued"], s["held"], s["running"], s["free"]
        else:
            out.append(s)
    finish = max(merge.values())
    return dict(T=T, deps=deps, kids=kids, start=start, end=end, merge=merge, slot=slot, ready=ready_at, why=why, rank=rank,
                latest=latest, chain=chain, crit=crit, steps=out, finish=finish, cp_len=cp_len, block=block, pgate=pgate)


def build(pack, generated):
    m = pack.m
    T, deps, ext, kids = _graph(pack)
    sim = simulate(pack, SLOTS)
    wave = {}

    def wv(i):
        if i not in wave:
            wave[i] = 1 + max((wv(d) for d in deps[i]), default=0)
        return wave[i]

    for i in T:
        wv(i)
    gates = []
    anc = {}

    def A(i):
        if i not in anc:
            s = set()
            for d in deps[i]:
                s |= {d} | A(d)
            anc[i] = s
        return anc[i]

    for g in pack.gates:
        mem = sorted(g["members"], key=natkey)
        at = max(sim["merge"][x] for x in mem)
        behind = set(mem)
        for x in mem:
            behind |= A(x)
        sib = list(g.get("siblings") or [])
        gates.append({"key": g["key"], "name": g["name"], "blocking": g["blocking"], "scope": g.get("scope") or ("everyone" if g["blocking"] else "members"),
                      "members": mem, "behind": len(behind), "at": round(at, 2),
                      "closes_with": sorted([x for x in mem if abs(sim["merge"][x] - at) < 1e-9], key=natkey),
                      "checks": g["checks"], "if_red": g["if_red"], "on_green": g.get("on_green"),
                      "sibling": sib[0] if sib else None, "siblings": sib, "priority": bool(g.get("priority")), "starts": list(g.get("starts") or []),
                      "old_reached": None})
    first_gate = {}
    for g in gates:
        clo = set(g["members"])
        for x in g["members"]:
            clo |= A(x)
        for i in clo:
            first_gate.setdefault(i, g["key"])
    pairs = []
    ids = sorted(T, key=natkey)
    for a_i, a in enumerate(ids):
        for b in ids[a_i + 1:]:
            if a in A(b) or b in A(a):
                continue
            if any(overlap(x, y) for x in T[a]["_locks"] for y in T[b]["_locks"]):
                pairs.append([a, b])
    tickets = []
    for i in sorted(T, key=lambda i: (sim["start"][i], sim["slot"][i])):
        t = T[i]
        locks = t["_locks"]
        files = [p for p in locks if not p.endswith("/")]
        scr = [l["url"] for l in t["links"] if l["url"].endswith(".png")]
        tickets.append({
            "id": i, "summary": t["summary"], "module": m["name"], "layer": t["layer"], "lane": t["_lane"], "wave": wave[i],
            "repo": REPO, "file": files[0] if len(locks) == 1 and files else None,
            "size": t["_size"], "h": t["_h"], "rank": sim["rank"][i], "latest_start": round(sim["latest"][i], 2), "critical": i in sim["crit"],
            "priority_gate": sim["pgate"].get(i, ""),
            "slot": sim["slot"][i], "start": round(sim["start"][i], 2), "merge": round(sim["merge"][i], 2), "ready": round(sim["ready"][i], 2),
            "waited": round(sim["start"][i] - sim["ready"][i], 2), "why": sim["why"][i],
            "after": list(t["blockedByTempIds"]), "after_other_modules": list(ext[i]),
            "unlocks": sorted(kids[i], key=lambda k: sim["rank"][k]),
            "gate": t["_gate"], "first_gate": first_gate.get(i, ""),
            "checks": [{"name": f"{g['name']} ({g['key']})", "check": c, "wave": wave[i]} for g in gates if i in g["closes_with"] for c in g["checks"]],
            "locks": locks, "locks_more": 0, "lock_pairs": sorted({b if a == i else a for a, b in pairs if i in (a, b)}, key=natkey),
            "screens": scr, "mock": scr[0] if scr else None,
        })
    steps = []
    gate_at = {g["key"]: g["at"] for g in gates}
    for n, s in enumerate(sim["steps"]):
        steps.append({"n": n, "t": round(s["t"], 2), "merges": s["merges"], "starts": s["starts"], "queued": s["queued"], "held": s["held"],
                      "running": s["running"], "free": s["free"], "gates": [k for k, at in gate_at.items() if abs(at - s["t"]) < 1e-9]})
    agent_h = sum(t["_h"] for t in T.values())
    finish = sim["finish"]
    at_cap = sum(b["t"] - a["t"] for a, b in zip(steps, steps[1:]) if len(a["running"]) >= SLOTS)
    by_slots = {}
    for k in (1, 2, 4, 6, 8, 12, 18):
        by_slots[str(k)] = round(simulate(pack, k)["finish"], 2)
    numbers = {
        "tickets": len(T), "waves": max(wave.values()), "agent_hours": agent_h, "finish_h": round(finish, 2),
        "critical_path_h": round(sim["cp_len"], 2), "critical_tickets": len(sim["chain"]),
        "peak": max(len(s["running"]) for s in steps), "utilisation": round(agent_h / (SLOTS * finish), 3),
        "hours_at_cap": round(at_cap, 2), "delayed_by_cap": sum(1 for x in tickets if x["waited"] > 1e-9), "steps": len(steps),
        "max_queue": max(len(s["queued"]) for s in steps), "finish_by_slots": by_slots, "lock_pairs": len(pairs),
        "old_plan": {"finish": None, "people": None, "agents_per_person": None, "merge_windows": None, "hours_per_day": None},
    }
    return {
        "schema": "build-schedule/2",
        "program": m["name"],
        "rebuilt": generated,
        "source": {"from": f"WARPDEMO/tools/tickets_{pack.key}.py (ticket graph, sizes, gates, locks)", "generated": generated, "tool": "WARPDEMO/tools/make_all.py"},
        "model": {"orchestrators": 1, "slots": SLOTS,
                  "merge": f"continuous: each PR merges when green; sizes outside autoMergeSizes ({', '.join(AUTO_MERGE_SIZES)}) wait {APPROVAL_HOURS} h for approval before dependents start",
                  "clock": "estimate hours (S=4, M=7, L=11, XL=16), continuous: no working day, no merge windows",
                  "priority": "critical chain first, then the members and ancestors of priority gates"
                              + (f" ({', '.join(g['key'] for g in gates if g['priority'])})" if any(g["priority"] for g in gates) else "")
                              + ", then rank (ascending latest_start), then natural id"
                              + ("; gate_order strict: a gate block starts when every earlier block has merged" if GATE_ORDER == "strict" else "; gates are milestones: nothing waits for a gate to be reached")
                              + (f"; the run starts after {m['startAfter']}" if m["startAfter"] else ""),
                  "gate_order": GATE_ORDER},
        "numbers": numbers,
        "critical_chain": sim["chain"],
        "lanes": LANES,
        "repos": [REPO],
        "gates": gates,
        "lock_pairs": pairs,
        "tickets": tickets,
        "steps": steps,
        "fields": FIELDS,
    }
