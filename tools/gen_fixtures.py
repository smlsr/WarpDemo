#!/usr/bin/env python3
"""Fixtures, golden outputs, reference page and screens for both packs.

  python3 WARPDEMO/tools/gen_fixtures.py --warp <Warp plugin folder>

Needs the Warp plugin (1.6.1+: scripts/scan.py, scripts/dashboard.py, assets/warp-dashboard.html,
examples/beam.sample.json) and Python Playwright with Chromium. Beams are made by Warp's own scan from
each pack's plan/schedule.json, then moved to a fixed moment of a run. Golden outputs are what the
reference page computes for those files; screens are the reference page in each state.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402
import screens as SCR  # noqa: E402
import tickets_edit  # noqa: E402
import tickets_view  # noqa: E402

NOW = datetime(2026, 10, 12, 20, 0, tzinfo=timezone.utc)
START = NOW - timedelta(hours=30)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
VIEW_D = REPO_ROOT / tickets_view.P.d
EDIT_D = REPO_ROOT / tickets_edit.P.d
PR = "https://github.com/smlsr/WarpDemo/pull/%d"
JIRA_SITE = "example.atlassian.net"


def dump(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def warp_scan(warp: Path, folder: str, run: str, extra: str = "") -> dict:
    tmp = Path(tempfile.mkdtemp(prefix="wd-"))
    try:
        subprocess.run(["git", "init", "-q"], cwd=tmp, check=True)
        shutil.copytree(REPO_ROOT / "WARPDEMO", tmp / "WARPDEMO")
        (tmp / ".warp").mkdir()
        (tmp / ".warp/config.yaml").write_text(f'run: {run}\nmaxAgents: 18\njiraProject: "WAR"\njiraSite: "{JIRA_SITE}"\n{extra}')
        subprocess.run(["git", "add", "-A"], cwd=tmp, check=True)
        subprocess.run(["git", "-c", "user.email=demo@example.com", "-c", "user.name=demo", "commit", "-qm", "init"], cwd=tmp, check=True)
        out = subprocess.run([sys.executable, str(warp / "scripts/scan.py"), "scan", "--folder", folder, "--out", ".warp/beam.json"], cwd=tmp, capture_output=True, text=True)
        assert out.returncode == 0, out.stdout + out.stderr
        assert "format=build-schedule/2" in out.stdout, out.stdout
        return json.loads((tmp / ".warp/beam.json").read_text())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def scrub_beam(b: dict) -> dict:
    """Drop machine-specific paths Warp records."""
    b = copy.deepcopy(b)
    src = b.get("source") or {}
    for k in ("schedule", "plan"):
        if src.get(k):
            src[k] = ".warp/_ingested_schedule.json" if k == "schedule" else src[k].split("/WARPDEMO/", 1)[-1] and "WARPDEMO/" + src[k].split("/WARPDEMO/", 1)[-1]
    if isinstance(src.get("scan"), dict):
        src["scan"]["root"] = "."
    return b


def live(beam: dict, plan: dict, statuses: dict, run: str, instance: str, seed: int, pr0: int, jira0: int) -> dict:
    """Move a fresh beam to a moment of a run: statuses, times, PRs, Jira keys, usage, events, gates."""
    rnd = random.Random(seed)
    b = copy.deepcopy(beam)
    sched = {t["id"]: t for t in plan["tickets"]}
    b.update({"run": run, "runState": "running", "paused": False, "pauseReason": None, "gateOrder": "strict",
              "runStartedAt": iso(START), "checkpointAt": iso(NOW - timedelta(minutes=4)),
              "instance": {"id": instance, "host": "cursor-cloud", "machine": "bc-" + instance, "createdAt": iso(START)},
              "owner": {"by": "Dev One" if run == "view" else "Dev Two", "machine": "bc-" + instance, "host": "cursor-cloud", "at": iso(START)}})
    b["config"]["jiraSite"] = JIRA_SITE
    order = sorted(b["tickets"], key=lambda i: (sched[i]["start"], sched[i]["slot"]))
    pr_n, jira_n = pr0, jira0
    for tid in order:
        t = b["tickets"][tid]
        st = statuses.get(tid, "queued")
        jira_n += 1
        t["jiraKey"] = f"WAR-{jira_n}"
        t["jiraKeySource"] = "external"
        t["status"] = st
        t["updatedAt"] = None
        if st == "queued":
            t["jira"] = {"status": "To Do"}
            continue
        s = START + timedelta(hours=sched[tid]["start"] * 0.42 + rnd.uniform(0, 0.4))
        dur = timedelta(hours=sched[tid]["h"] * rnd.uniform(0.25, 0.4))
        e = s + dur
        t["claimedAt"] = iso(s)
        t["agent"] = "bc-%06x" % rnd.getrandbits(24)
        t["attempts"] = 2 if st == "fix" else 1
        events = [{"at": iso(s), "type": "status", "from": "queued", "to": "claimed"},
                  {"at": iso(s + timedelta(minutes=6)), "type": "status", "from": "claimed", "to": "coding"}]
        if st in ("merged", "done"):
            pr_n += rnd.randint(1, 3)
            opened = e - timedelta(minutes=35)
            t["pr"] = {"url": PR % pr_n, "id": pr_n, "openedAt": iso(opened), "reviewedAt": iso(e - timedelta(minutes=15)),
                       "bugbot": "pass", "bugbotEvidence": "no findings", "ci": "green",
                       "approvedAt": None if t.get("autoMerge") else iso(e - timedelta(minutes=6)), "mergedAt": iso(e),
                       "sha": "%040x" % rnd.getrandbits(160), "via": "connected", "mergeMethod": "squash"}
            t["jira"] = {"status": "Done" if st == "done" else "QA Ready", "doneAt": iso(e) if st == "done" else None, "lastCommentAt": iso(e)}
            events += [{"at": iso(opened), "type": "status", "from": "coding", "to": "review"},
                       {"at": iso(e - timedelta(minutes=15)), "type": "bugbot", "detail": "pass"},
                       {"at": iso(e), "type": "status", "from": "review", "to": st}]
            t["minutes"] = int(dur.total_seconds() // 60)
            t["updatedAt"] = iso(e)
        else:
            t["minutes"] = int(min(dur, NOW - s).total_seconds() // 60)
            t["updatedAt"] = iso(NOW - timedelta(minutes=rnd.randint(3, 25)))
            t["jira"] = {"status": "In Progress", "lastCommentAt": iso(s)}
            if st in ("review", "bugbot_running", "awaiting_approval", "fix"):
                pr_n += 2
                opened = NOW - timedelta(minutes=rnd.randint(40, 90))
                t["pr"] = {"url": PR % pr_n, "id": pr_n, "openedAt": iso(opened), "reviewedAt": iso(opened + timedelta(minutes=20)) if st != "review" else None,
                           "ci": "red" if st == "fix" else "green", "bugbot": "pass" if st == "awaiting_approval" else None}
                t["jira"] = {"status": "QA Ready" if st == "awaiting_approval" else "In Review", "lastCommentAt": iso(opened)}
                events.append({"at": iso(opened), "type": "status", "from": "coding", "to": "review"})
                if st == "awaiting_approval":
                    events.append({"at": iso(opened + timedelta(minutes=25)), "type": "status", "from": "review", "to": "awaiting_approval"})
            if st == "alarm":
                t["alarm"] = "lock-escape: wrote WARPDEMO/WarpView/app/src/view/header/ outside its lock"
                t["escaped"] = ["WARPDEMO/WarpView/app/src/view/header/"]
                events.append({"at": t["updatedAt"], "type": "alarm", "detail": "lock-escape"})
            if st == "parked":
                t["alarm"] = "worker-died"
                t["recoveries"] = 5
        t["tokens"] = t["minutes"] * rnd.randint(2600, 4200)
        t["usage"] = {"tokensIn": int(t["tokens"] * 0.8), "tokensOut": int(t["tokens"] * 0.2), "tokensCached": 0, "cost": round(t["tokens"] / 1e6 * 4.2, 2)}
        t["events"] = events
    for g in b["gates"]:
        mem = [b["tickets"][m] for m in g["members"]]
        if all(m["status"] in ("merged", "done") for m in mem):
            g["status"] = "green"
            g["evidence"] = "members merged: " + ", ".join(g["members"])
            g["greenAt"] = max(m["pr"]["mergedAt"] for m in mem)
    return b


VIEW_NOW = {"WV-01": "done", "WV-02": "merged", "WV-03": "done", "WV-04": "merged", "WV-05": "merged", "WV-06": "done", "WV-07": "merged",
            "WV-08": "merged", "WV-09": "coding", "WV-10": "review", "WV-11": "claimed", "WV-12": "merged", "WV-13": "awaiting_approval",
            "WV-14": "alarm", "WV-15": "queued", "WV-16": "queued"}
EDIT_SUBJECT = dict(VIEW_NOW, **{"WV-10": "merged", "WV-11": "merged", "WV-13": "awaiting_approval", "WV-14": "merged"})


# ------------------------------------------------------------ WarpEdit rules in Python (SPEC §3, §5, §6, §11)
TERMINAL = {"merged", "done", "skipped"}
INFLIGHT = {"claimed", "recovering", "planning", "coding", "review", "bugbot_running", "fix", "awaiting_approval", "merging"}


def dependents(beam, tid):
    kids = {}
    for i, t in beam["tickets"].items():
        for d in list(t.get("deps") or []) + list(t.get("after") or []):
            if ":" not in d:
                kids.setdefault(d, []).append(i)
    seen, stack = [], list(kids.get(tid, []))
    while stack:
        k = stack.pop(0)
        if k in seen:
            continue
        seen.append(k)
        stack += kids.get(k, [])
    out = {"blocked": [], "inFlight": [], "alreadyMerged": []}
    for k in sorted(seen, key=lambda s: int(s.split("-")[1])):
        st = beam["tickets"][k]["status"]
        if st == "queued":
            out["blocked"].append(k)
        elif st in INFLIGHT:
            out["inFlight"].append(k)
        elif st in ("merged", "done"):
            out["alreadyMerged"].append(k)
    return out


def apply_reset(beam, tid, to, note, at):
    b = copy.deepcopy(beam)
    t = b["tickets"][tid]
    frm = t["status"]
    t["status"] = to
    t.setdefault("events", []).append({"at": at, "type": "status", "from": frm, "to": to, "by": "warpedit", "note": note})
    t.setdefault("resets", []).append({"from": frm, "to": to, "at": at, "note": note})
    if frm == "alarm":
        t["alarm"] = None
    dep = dependents(beam, tid) if frm in ("merged", "done") and to not in TERMINAL else {"blocked": []}
    for k in dep["blocked"]:
        d = b["tickets"][k]
        d.setdefault("events", []).append({"at": at, "type": "status", "from": d["status"], "to": "blocked", "by": "warpedit", "note": f"blocked by reset of {tid}"})
        d["status"] = "blocked"
    return b


def phase_at(t, at_ms):
    ev = sorted([e for e in t.get("events") or [] if e.get("type") == "status"], key=lambda e: e["at"])
    if not ev:
        c = t.get("claimedAt")
        if c and datetime.fromisoformat(c.replace("Z", "+00:00")).timestamp() * 1000 <= at_ms:
            return t["status"]
        return "queued"
    cur = "queued"
    for e in ev:
        if datetime.fromisoformat(e["at"].replace("Z", "+00:00")).timestamp() * 1000 <= at_ms:
            cur = e["to"]
    return cur


# ------------------------------------------------------------ the reference page
EVAL_MODEL = """async ([docs, nowMs]) => {
  Date.now = () => nowMs;
  const built = buildRuns(docs.map((d) => ({path: d.path, data: d.data, modified: null})), null);
  const r = built.runs[0];
  const m = computeMetrics(built.runs);
  const act = layoutActual(r);
  const pick = (t) => ({id: t.id, title: t.title, size: t.size, status: t.status, cat: t.cat, hours: t.hours, hoursFrom: t.hoursFrom, autoMerge: t.autoMerge,
    deps: t.deps, gate: t.gate, critical: t.critical, jiraKey: t.jiraKey, prUrl: t.pr.url, minutes: t.minutes, tokens: t.tokens, cost: t.cost, stateNote: t.stateNote});
  const rows = r.tickets.slice();
  const col = COLS.find((c) => c.key === "merged");
  rows.sort((a, b) => { const x = col.val(a), y = col.val(b); return (x < y ? -1 : x > y ? 1 : natCmp(a.id, b.id)) * -1; });
  return {
    run: {name: r.name, instance: r.instance, runState: r.runState, cap: r.cap, gateOrder: r.gateOrder, repo: r.repo, updated: r.updated ? new Date(r.updated).toISOString() : null,
          overlaid: built.overlaid, skipped: built.skipped, tickets: r.tickets.map(pick)},
    blocks: Object.fromEntries(r.tickets.map((t) => [t.id, t.block])),
    plan: {finish: r.finish, peak: r.peak, slots: r.slots, waves: r.waves, critHours: r.critHours, critCount: r.critCount,
           gateAt: Object.fromEntries([...r.gateAt.entries()]),
           tickets: Object.fromEntries(r.tickets.map((t) => [t.id, {slot: t.slot, start: +t.start.toFixed(4), end: +t.end.toFixed(4), mergeAt: +t.mergeAt.toFixed(4), unplaced: !!t.unplaced}]))},
    actual: {now: act.now, rows: act.rows, span: act.span, unstarted: act.unstarted,
             items: act.items.map((i) => ({id: i.t.id, row: i.row, s: +i.s.toFixed(4), e: +i.e.toFixed(4)})), gates: act.gates.map((g) => ({key: g.k, at: +g.at.toFixed(4)}))},
    metrics: m,
    table: rows.map((t) => t.id),
    categories: STATUS_CAT,
  };
}"""


async def model_of(page, docs, now_ms):
    return await page.evaluate(EVAL_MODEL, [docs, now_ms])


def embed(warp: Path, files: list, repo="smlsr/WarpDemo") -> str:
    sys.path.insert(0, str(warp / "scripts"))
    import dashboard  # Warp's own embedder
    page = (warp / "assets/warp-dashboard.html").read_text()
    return dashboard.embed(page, {"generatedAt": iso(NOW), "repo": repo, "jiraSite": JIRA_SITE, "files": files})


PRESET = """<script>
(function(){
  const p = %s;
  window.__preset = p;
  try { if (p.view) localStorage.setItem('warp-dash:view', p.view); if (p.clock) localStorage.setItem('warp-dash:clock', p.clock);
        if (p.groupBy) localStorage.setItem('warp-dash:groupBy', p.groupBy); localStorage.setItem('warp-dash:util', p.util ? '1' : '');
        if (p.theme) localStorage.setItem('warp-dash:theme', p.theme); } catch (e) {}
  if (p.now) { const n = p.now; Date.now = () => n; }
  window.addEventListener('load', () => setTimeout(() => {
    if (p.sort) for (let i = 0; i < p.sort[1]; i++) document.querySelector('th[data-sort="' + p.sort[0] + '"]')?.click();
    if (p.drawer) { const el = document.querySelector('[data-id="' + p.drawer + '"]'); if (el) el.click(); }
    if (p.mock) window.__mock && window.__mock(p.mock);
  }, 60));
})();
</script>"""


def preset_html(base: str, preset: dict, mock_js: str = "") -> str:
    inject = (PRESET % json.dumps(preset)) + (f"<script>{mock_js}</script>" if mock_js else "")
    return base.replace("<!-- /warp-dashboard (scripts/dashboard.py)", inject + "\n<!-- /warp-dashboard (scripts/dashboard.py)", 1)


EDIT_MOCK = r"""
window.__mock = function (what) {
  const css = document.createElement('style');
  css.textContent = `
  .ed-badge{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,var(--c-qa) 20%,transparent);color:var(--c-qa);margin-left:8px}
  .ed-bar{border-top:1px solid var(--line);background:color-mix(in srgb,var(--c-qa) 6%,var(--panel))}
  .ed-bar .wrap{display:flex;gap:8px;align-items:center;min-height:46px;flex-wrap:wrap}
  .ed-note{font-size:12px;color:var(--muted)}
  .ed-unsaved{font-size:12px;font-weight:600;padding:3px 9px;border-radius:99px;background:color-mix(in srgb,var(--c-qa) 18%,var(--panel));border:1px solid color-mix(in srgb,var(--c-qa) 40%,var(--line));color:var(--ink)}
  .ed-sec{margin-top:18px;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)}
  .ed-sec h4{margin:0 0 8px}
  .ed-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .ed-row select{height:32px;border-radius:8px;border:1px solid var(--line2);background:var(--panel);padding:0 8px}
  .ed-prev{font-size:12px;color:var(--muted);margin-top:8px}
  .ed-log{font-size:12px;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin-top:6px}
  .ed-log .u{color:var(--c-qa);font-weight:700}
  .ed-modal{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(5,10,12,.4)}
  .ed-dlg{width:min(520px,92vw);background:var(--panel);border:1px solid var(--line2);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:20px}
  .ed-dlg h3{margin:0 0 6px;font-size:18px}
  .ed-chip{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:13px;color:var(--c)}
  .ed-chip:before{content:"";width:10px;height:10px;border-radius:3px;background:var(--c)}
  .ed-dlg ul{margin:6px 0 10px;padding-left:18px;font-size:13px}
  .ed-dlg textarea{width:100%;min-height:70px;border-radius:8px;border:1px solid var(--line2);background:var(--panel);padding:8px;font:inherit}
  .ed-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
  .ed-banner{margin:12px 0 0;padding:10px 14px;border-radius:10px;border:1px solid color-mix(in srgb,var(--c-err) 45%,var(--line));background:color-mix(in srgb,var(--c-err) 10%,var(--panel));font-size:13px}
  .ed-banner b{color:var(--c-err)} .ed-banner .w{color:var(--c-qa)}
  .ed-banner button{border:0;background:none;color:var(--brand);font-weight:700;cursor:pointer;padding:0}
  .ed-scrub{display:flex;gap:12px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel2);font-size:12px}
  .ed-scrub input{flex:1;accent-color:var(--brand)}
  .ed-mark{position:absolute;top:-3px;width:10px;height:10px;border-radius:50%;background:var(--c-qa);border:2px solid var(--panel);transform:translateX(-50%);z-index:7}`;
  document.head.appendChild(css);
  const brand = document.querySelector('.brand small'); if (brand) brand.insertAdjacentHTML('afterend', '<span class="ed-badge">Editing</span>');
  document.title = 'Warp Editor';
  const top = document.querySelector('header.top');
  const unsaved = what === 'clean' ? '<span class="ed-note">No unsaved changes</span>' : '<span class="ed-unsaved">1 unsaved</span><span class="ed-note">WV-07 merged → coding</span>';
  top.insertAdjacentHTML('beforeend', `<div class="ed-bar"><div class="wrap">${unsaved}<span style="flex:1"></span><button class="btn" title="Undo WV-07 merged → coding">↶ Undo</button><button class="btn" disabled>↷ Redo</button><button class="btn">Copy as commands</button><button class="btn primary" ${what === 'validation' ? 'disabled title="Fix the errors below to save"' : ''}>Save</button></div></div>`);
  if (what === 'drawer' || what === 'confirm') {
    const t = document.querySelector('#drawer .drawer-b');
    if (t) t.insertAdjacentHTML('beforeend', `<div class="ed-sec"><h4>Reset phase</h4><div class="ed-row"><select><option>coding</option><option>queued</option><option>claimed</option><option>planning</option><option>review</option><option>fix</option><option>awaiting approval</option><option>merging</option><option>blocked</option><option>alarm</option></select><button class="btn primary">Reset…</button></div><div class="ed-prev">Blocks 2 queued dependents (WV-15, WV-16) · 1 in flight on top (WV-09) · 1 already merged on top (WV-11)</div><h4 style="margin-top:14px">Reset log</h4><div class="ed-log"><span class="u">unsaved</span><span>merged → coding · Oct 13, 08:00 AM · flaky test in plan.test.mjs</span><span>Oct 12</span><span>coding → merged · merged by Warp (from events)</span></div></div>`);
  }
  if (what === 'confirm') {
    document.body.insertAdjacentHTML('beforeend', `<div class="ed-modal"><div class="ed-dlg" role="dialog" aria-modal="true"><h3>Reset WV-07</h3><div><span class="ed-chip" style="--c:var(--c-done)">merged</span> → <span class="ed-chip" style="--c:var(--c-prog)">coding</span></div><p style="font-size:13px;color:var(--muted);margin:12px 0 4px">Will be blocked</p><ul><li><b>WV-15</b> Wire the app: store, render loop, drawer, tabs, print, plugin hooks</li><li><b>WV-16</b> Release viewer.html, README and parity check</li></ul><p style="font-size:13px;color:var(--muted);margin:4px 0">In flight on top · already merged on top</p><ul><li><b>WV-09</b> coding — keeps its status, warned</li><li><b>WV-11</b> merged — keeps its status</li></ul><textarea placeholder="Note (optional, saved in the event)">flaky test in plan.test.mjs</textarea><div class="ed-foot"><button class="btn">Cancel</button><button class="btn primary">Reset</button></div></div></div>`);
  }
  if (what === 'validation') {
    document.querySelector('.headline').insertAdjacentHTML('afterend', `<div class="ed-banner"><b>Save is blocked — 1 error</b><br><button>WV-09</button> depends on WV-99, which is not in this run.<br><span class="w">Warning:</span> <button>WV-09</button> is in flight on top of WV-07, which was reset.</div>`);
  }
  if (what === 'scrubber') {
    const panel = document.querySelector('#view .panel');
    const head = panel && panel.querySelector('.panel-h');
    if (head) head.insertAdjacentHTML('afterend', `<div class="ed-scrub"><b>Phase at</b><input type="range" min="0" max="30" value="20" step="0.25"><span>+20h · Oct 12, 10:00 AM</span><button class="btn">Back to now</button></div>`);
    // phase at +20h: replay status events (WarpEdit SPEC §11)
    const run = S.runs[0], T = 20, base = run.runStartedAt, at = base + T * 3600000;
    const lay = run._layout, pph = (() => { const b = document.querySelector('.bar'); const it = lay.items.find((x) => x.t.id === b.dataset.id); return (parseFloat(b.style.left) - 1) / it.s; })();
    for (const it of lay.items) {
      const el = document.querySelector('.bar[data-id="' + it.t.id + '"]'); if (!el) continue;
      if (it.s > T) { el.style.display = 'none'; continue; }
      const ev = it.t.events.filter((e) => e.type === 'status' && Date.parse(e.at) <= at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const ph = ev.length ? ev[ev.length - 1].to : 'queued';
      el.style.setProperty('--c', catColor(catOf(ph)));
      el.className = el.className.replace(/c-\w+/, 'c-' + catOf(ph));
      if (it.t.events.some((e) => e.by === 'warpedit')) { el.style.overflow = 'visible'; el.insertAdjacentHTML('beforeend', '<i class="ed-mark" style="left:92%" title="merged → coding · flaky test"></i>'); }
    }
    const body = document.querySelector('#view .tl-body > div');
    if (body) body.insertAdjacentHTML('beforeend', '<i style="position:absolute;top:0;bottom:0;left:' + (T * pph) + 'px;border-left:2px solid var(--c-qa);z-index:4"></i>');
  }
};
"""


async def shots(warp: Path, view_beam, view_state, view_status, view_plan, edit_beam_view, edit_run_beam, big, edit_after, edit_invalid):
    from playwright.async_api import async_playwright

    ui_v = VIEW_D / "ui"
    ui_e = EDIT_D / "ui"
    for d in (ui_v / "screens", ui_v / "reference", ui_e / "screens"):
        d.mkdir(parents=True, exist_ok=True)
    now_ms = NOW.timestamp() * 1000
    ref_files = [{"path": ".warp/beam.json", "data": view_beam}, {"path": ".warp/tickets/WV-11/state.json", "data": view_state}]
    reference = embed(warp, ref_files)
    (ui_v / "reference/warp-dashboard.html").write_text(reference)
    multi = embed(warp, [{"path": ".warp/runs/view/beam.json", "data": view_beam}, {"path": ".warp/runs/edit/beam.json", "data": edit_run_beam}])
    edit_ref = embed(warp, [{"path": ".warp/beam.json", "data": edit_beam_view}])
    edit_scrub = embed(warp, [{"path": ".warp/beam.json", "data": edit_after}])
    edit_bad = embed(warp, [{"path": ".warp/beam.json", "data": edit_invalid}])
    empty = (warp / "assets/warp-dashboard.html").read_text()
    V = [
        ("swimlane-plan", reference, {"view": "timeline", "clock": "plan", "now": now_ms}, 1600, None, False),
        ("swimlane-actual", reference, {"view": "timeline", "clock": "actual", "now": now_ms}, 1600, None, False),
        ("board", reference, {"view": "board", "groupBy": "block", "now": now_ms}, 1600, None, True),
        ("table", reference, {"view": "table", "sort": ["merged", 2], "now": now_ms}, 1600, None, False),
        ("drawer", reference, {"view": "board", "groupBy": "status", "drawer": "WV-05", "now": now_ms}, 1600, None, False),
        ("utilization", reference, {"view": "timeline", "util": True, "now": now_ms}, 1600, None, False),
        ("multi-run", multi, {"view": "timeline", "clock": "plan", "now": now_ms}, 1600, None, False),
        ("empty", empty, {}, 1600, None, False),
        ("dark", reference, {"view": "timeline", "theme": "dark", "now": now_ms}, 1600, "dark", False),
        ("phone", reference, {"view": "timeline", "now": now_ms}, 390, None, True),
    ]
    E = [
        ("edit-drawer", edit_ref, {"view": "board", "groupBy": "block", "drawer": "WV-07", "mock": "drawer", "now": now_ms}),
        ("edit-confirm", edit_ref, {"view": "board", "groupBy": "block", "drawer": "WV-07", "mock": "confirm", "now": now_ms}),
        ("edit-header", edit_scrub, {"view": "timeline", "mock": "header", "now": now_ms}),
        ("edit-validation", edit_bad, {"view": "timeline", "mock": "validation", "now": now_ms}),
        ("edit-scrubber", edit_scrub, {"view": "timeline", "clock": "actual", "mock": "scrubber", "now": now_ms}),
    ]
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for sid, html, preset, width, scheme, full in V:
            path = ui_v / "screens" / f"{sid}.html"
            path.write_text(preset_html(html, preset))
            pg = await b.new_page(viewport={"width": width, "height": 1100}, device_scale_factor=2 if width < 500 else 1, color_scheme=scheme or "light")
            pg.on("pageerror", lambda e, s=sid: errs.append(f"{s}: {e}"))
            await pg.goto(path.as_uri())
            await pg.wait_for_timeout(500)
            await pg.screenshot(path=str(ui_v / "screens" / f"{sid}.png"), full_page=full or sid in ("table", "utilization", "swimlane-plan", "swimlane-actual", "multi-run", "dark"))
            await pg.close()
        # print: render the PDF and keep page 1 as the PNG
        pg = await b.new_page(viewport={"width": 1400, "height": 1000})
        path = ui_v / "screens/print.html"
        path.write_text(preset_html(reference, {"view": "timeline", "now": now_ms}))
        await pg.goto(path.as_uri())
        await pg.wait_for_timeout(400)
        await pg.emulate_media(media="print")
        pdf = ui_v / "screens/print.pdf"
        await pg.pdf(path=str(pdf), landscape=True, print_background=True)
        await pg.close()
        subprocess.run(["pdftoppm", "-r", "80", "-png", "-f", "1", "-l", "2", str(pdf), str(ui_v / "screens/print-page")], check=True)
        pdf.unlink()
        from PIL import Image
        pages = [Image.open(f) for f in sorted((ui_v / "screens").glob("print-page*.png"))]
        sheet = Image.new("RGB", (max(i.width for i in pages), sum(i.height for i in pages) + 16 * (len(pages) - 1)), (200, 200, 200))
        y = 0
        for im in pages:
            sheet.paste(im, (0, y)); y += im.height + 16
        sheet.save(ui_v / "screens/print.png")
        for f in (ui_v / "screens").glob("print-page*.png"):
            f.unlink()
        for sid, html, preset in E:
            path = ui_e / "screens" / f"{sid}.html"
            path.write_text(preset_html(html, preset, EDIT_MOCK))
            pg = await b.new_page(viewport={"width": 1600, "height": 1100})
            pg.on("pageerror", lambda e, s=sid: errs.append(f"{s}: {e}"))
            await pg.goto(path.as_uri())
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=str(ui_e / "screens" / f"{sid}.png"))
            await pg.close()
        # golden outputs
        pg = await b.new_page()
        await pg.goto((ui_v / "reference/warp-dashboard.html").as_uri())
        await pg.wait_for_timeout(200)
        view_m = await model_of(pg, ref_files, now_ms)
        big_m = await model_of(pg, [{"path": ".warp/beam.json", "data": big}], now_ms)
        dep_m = await model_of(pg, [{"path": ".warp/beam.json", "data": edit_beam_view}], now_ms)
        after_m = await model_of(pg, [{"path": ".warp/beam.json", "data": edit_after}], now_ms)
        status_m = await model_of(pg, [{"path": ".warp/status.json", "data": view_status}], now_ms)
        plan_m = await model_of(pg, [{"path": ".warp/beam.json", "data": view_plan}], now_ms)
        await b.close()
    assert not errs, errs
    return view_m, big_m, dep_m, after_m, status_m, plan_m


def write_acceptance(view_m, big_m, status_m, plan_m, vplan, dep, after_m, dep_m):
    g = lambda x: "—" if x is None else ("%g" % round(x, 2))
    vm, bm, sm = view_m["metrics"], big_m["metrics"], status_m["metrics"]
    cnt = lambda m: f"{m['count']['done']} completed, {m['count']['prog']} in progress, {m['count']['err']} errored or parked, {m['count']['todo']} to do"
    (VIEW_D / "spec/ACCEPTANCE.md").write_text(f"""# WarpView — acceptance queries

Generated by `WARPDEMO/tools/gen_fixtures.py` from what the reference page computes. Fixtures are in `WARPDEMO/WarpView/fixtures/`; golden files in `fixtures/expected/`. Times are fixed: now = {iso(NOW)}.

| # | Input | Query | Expected |
|---|---|---|---|
| Q1 | `beam.sample.json` + `tickets/WV-11/state.json` | runs, tickets, overlay | 1 run `view`, 16 tickets, overlaid 1 (WV-11 claimed → coding) — `view.run.json` |
| Q2 | `beam.sample.json` | categories in legend order | {", ".join(f"{k} {v}" for k, v in _legend(view_m).items())} |
| Q3 | `beam.sample.json` | totals | run estimate {g(vm['estTotal'])} h · agent hours {g(vm['agentTotal'])} · people hours {g(vm['humanTotal'])} · tickets {vm['ticketTotal']} ({cnt(vm)}) — `view.metrics.json` |
| Q4 | `beam.sample.json` | planned swimlane | finish T+{g(view_m['plan']['finish'])}h, peak {view_m['plan']['peak']}, {view_m['plan']['slots']} slots, gates {", ".join(f"{k} T+{g(v)}h" for k, v in view_m['plan']['gateAt'].items())} — `view.plan.json` |
| Q5 | a fresh beam from `plan/schedule.json` (all queued) | planned swimlane | identical to `plan/schedule.json`: finish T+{g(vplan['numbers']['finish_h'])}h, every start and merge — `fresh.plan.json` |
| Q6 | `beam.sample.json` | actual clock at now | {view_m['actual']['rows']} agent rows, {len(view_m['actual']['items'])} bars, {view_m['actual']['unstarted']} unstarted, now line at +{g(view_m['actual']['now'])}h — `view.actual.json` |
| Q7 | `big/beam.sample.json` | totals | run estimate {g(bm['estTotal'])} · agent hours {g(bm['agentTotal'])} · people hours {g(bm['humanTotal'])} · tickets {bm['ticketTotal']} ({cnt(bm)}) — `big.metrics.json` |
| Q8 | `big/beam.sample.json` | planned swimlane | finish T+{g(big_m['plan']['finish'])}h, peak {big_m['plan']['peak']}, {big_m['plan']['slots']} slots — `big.plan.json` |
| Q9 | `status.sample.json` alone | totals | run estimate — (no estimate in status.json), agent hours {g(sm['agentTotal'])}, tickets {sm['ticketTotal']} — `status-only.metrics.json` |
| Q10 | `beam.sample.json`, table sorted by Merged descending | row order | {", ".join(view_m['table'][:5])}, … — `view.table.json` |
| Q11 | `runs/view/beam.json` + `runs/edit/beam.json` | tabs | All runs (2), edit · 0/14, view · 9/16 |
| Q12 | the built viewer, every control exercised | statuses | unchanged; no element with data-edit |
""")
    am, bm2 = after_m["metrics"], dep_m["metrics"]
    (EDIT_D / "spec/ACCEPTANCE.md").write_text(f"""# WarpEdit — acceptance queries

Generated by `WARPDEMO/tools/gen_fixtures.py`. Subject: `fixtures/beam.sample.json` (run view near the end of G2). Reset: WV-07 merged → coding, note "flaky test", at {iso(NOW - timedelta(minutes=30))}.

| # | Query | Expected |
|---|---|---|
| Q1 | targetsFrom('merged') | queued, claimed, planning, coding, review, fix, awaiting_approval, merging, blocked, alarm |
| Q2 | reset WV-07 → coding | ticket equals `expected/reset.WV-07.coding.json`: status coding, one event by warpedit, one resets entry, pr.mergedAt kept |
| Q3 | dependents of WV-07 | blocked {", ".join(dep['blocked'])}; in flight {", ".join(dep['inFlight'])}; already merged {", ".join(dep['alreadyMerged'])} |
| Q4 | totals before → after | tickets completed {bm2['count']['done']} → {am['count']['done']}, errored or parked {bm2['count']['err']} → {am['count']['err']}; tokens {bm2['tokens']:,} → {am['tokens']:,} (unchanged) — `expected/after-reset.metrics.json` |
| Q5 | save after the reset | equals `expected/saved.beam.json` (editedAt aside) |
| Q6 | undo the reset | the working copy equals the loaded beam |
| Q7 | validate `invalid/missing-dep.json` | error dep-missing: "WV-09 depends on WV-99, which is not in this run" |
| Q8 | validate `invalid/cycle.json` | error cycle naming WV-10 → WV-11 → WV-10 |
| Q9 | scrubber at +20 h | each bar's phase equals `expected/scrub.+20.json` |
| Q10 | asCommands after the reset | 3 lines: WV-07 coding, WV-15 blocked, WV-16 blocked |
| Q11 | `WARPDEMO/WarpView/viewer.html` after both runs | no data-edit element, no Reset control |
""")


def _legend(m):
    order = ["done", "err", "prog", "rev", "qa", "todo"]
    labels = {"done": "Completed", "err": "Errored / Parked", "prog": "In Progress", "rev": "In Review", "qa": "QA Ready", "todo": "To Do"}
    counts = {k: 0 for k in order}
    for t in m["run"]["tickets"]:
        counts[t["cat"]] += 1
    return {labels[k]: counts[k] for k in order}


def screens_json(pack, rows):
    by = {}
    for t in pack.tickets:
        for l in t["links"]:
            if l["url"].endswith(".png"):
                by.setdefault(l["url"], []).append(t["tempId"])
    cat = SCR.catalog(pack, rows)
    return {"screens": [dict(s, tickets=by.get(s["png"], [])) for s in cat.values()]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--warp", required=True)
    a = ap.parse_args()
    warp = Path(a.warp).resolve()
    vplan = json.loads((VIEW_D / "plan/schedule.json").read_text())
    eplan = json.loads((EDIT_D / "plan/schedule.json").read_text())
    fresh_view = scrub_beam(warp_scan(warp, "WARPDEMO/WarpView", "view"))
    fresh_edit = scrub_beam(warp_scan(warp, "WARPDEMO/WarpEdit", "edit", "startAfter: view:G2\npaths: WARPDEMO/WarpEdit\n"))

    FV = VIEW_D / "fixtures"
    FE = EDIT_D / "fixtures"
    for d in (FV, FE):
        if d.exists():
            shutil.rmtree(d)
    view_beam = live(fresh_view, vplan, VIEW_NOW, "view", "4e7a21", 11, 40, 100)
    dump(FV / "beam.sample.json", view_beam)
    state = {"id": "WV-11", "state": "coding", "startedAt": view_beam["tickets"]["WV-11"]["claimedAt"], "updatedAt": iso(NOW - timedelta(minutes=1)),
             "heartbeatAt": iso(NOW - timedelta(minutes=1)), "agent": view_beam["tickets"]["WV-11"]["agent"]}
    dump(FV / "tickets/WV-11/state.json", state)
    # Warp's own status and export writers
    sys.path.insert(0, str(warp / "scripts"))
    import scan  # noqa: E402
    import contextlib, io
    with tempfile.TemporaryDirectory() as td:
        wdir = Path(td) / ".warp"
        wdir.mkdir()
        (wdir / "beam.json").write_text(json.dumps(view_beam))
        with contextlib.redirect_stdout(io.StringIO()):
            scan.write_status(wdir / "beam.json")
            scan.export_plan(wdir / "beam.json", wdir / "WARP_PLAN.json")
        status = json.loads((wdir / "status.json").read_text())
        export = json.loads((wdir / "WARP_PLAN.json").read_text())
    dump(FV / "status.sample.json", status)
    dump(FV / "WARP_PLAN.sample.json", export)
    edit_run = copy.deepcopy(fresh_edit)
    edit_run.update({"run": "edit", "runState": "stopped", "instance": {"id": "9c3b05", "host": "cursor-cloud", "machine": "bc-9c3b05", "createdAt": iso(NOW)},
                     "owner": {"by": "Dev Two", "machine": "bc-9c3b05", "host": "cursor-cloud", "at": iso(NOW)}, "checkpointAt": iso(NOW - timedelta(minutes=2))})
    edit_run["config"]["startAfter"] = "view:G2"
    edit_run["config"]["jiraSite"] = JIRA_SITE
    dump(FV / "runs/view/beam.json", view_beam)
    dump(FV / "runs/edit/beam.json", edit_run)
    big = json.loads((warp / "examples/beam.sample.json").read_text())
    dump(FV / "big/beam.sample.json", big)
    view_plan = copy.deepcopy(fresh_view)  # every ticket queued: the planned picture equals plan/schedule.json

    # WarpEdit: the subject run (WarpView near the end of G2)
    subject = live(fresh_view, vplan, EDIT_SUBJECT, "view", "4e7a21", 23, 40, 100)
    dump(FE / "beam.sample.json", subject)
    with tempfile.TemporaryDirectory() as td:
        wdir = Path(td) / ".warp"
        wdir.mkdir()
        (wdir / "beam.json").write_text(json.dumps(subject))
        with contextlib.redirect_stdout(io.StringIO()):
            scan.write_status(wdir / "beam.json")
            scan.export_plan(wdir / "beam.json", wdir / "WARP_PLAN.json")
        dump(FE / "status.sample.json", json.loads((wdir / "status.json").read_text()))
        dump(FE / "WARP_PLAN.sample.json", json.loads((wdir / "WARP_PLAN.json").read_text()))
    bad = copy.deepcopy(subject)
    bad["tickets"]["WV-09"]["after"] = list(bad["tickets"]["WV-09"].get("after") or []) + ["WV-99"]
    dump(FE / "invalid/missing-dep.json", bad)
    cyc = copy.deepcopy(subject)
    cyc["tickets"]["WV-10"]["after"] = list(cyc["tickets"]["WV-10"].get("after") or []) + ["WV-11"]
    cyc["tickets"]["WV-11"]["after"] = list(cyc["tickets"]["WV-11"].get("after") or []) + ["WV-10"]
    dump(FE / "invalid/cycle.json", cyc)
    at = iso(NOW - timedelta(minutes=30))
    after = apply_reset(subject, "WV-07", "coding", "flaky test", at)
    dep = dependents(subject, "WV-07")
    saved = copy.deepcopy(after)
    saved["editedAt"] = at
    saved["editedBy"] = "warpedit"
    E_ = FE / "expected"
    dump(E_ / "reset.WV-07.coding.json", after["tickets"]["WV-07"])
    dump(E_ / "dependents.WV-07.json", dict(dep, ticket="WV-07", from_="merged", to="coding"))
    dump(E_ / "saved.beam.json", saved)
    base = START.timestamp() * 1000
    dump(E_ / "scrub.+20.json", {"t": 20, "at": iso(START + timedelta(hours=20)),
                                 "phase": {i: phase_at(t, base + 20 * 3600e3) for i, t in sorted(after["tickets"].items())}})

    view_m, big_m, dep_m, after_m, status_m, plan_m = asyncio.run(
        shots(warp, view_beam, state, status, view_plan, subject, edit_run, big, after, bad))
    EV = FV / "expected"
    dump(EV / "categories.json", view_m["categories"])
    dump(EV / "view.run.json", view_m["run"])
    dump(EV / "view.blocks.json", view_m["blocks"])
    dump(EV / "big.blocks.json", big_m["blocks"])
    dump(EV / "view.plan.json", view_m["plan"])
    dump(EV / "big.plan.json", big_m["plan"])
    dump(EV / "view.actual.json", dict(view_m["actual"], nowAt=iso(NOW)))
    dump(EV / "view.metrics.json", view_m["metrics"])
    dump(EV / "big.metrics.json", big_m["metrics"])
    dump(EV / "status-only.metrics.json", status_m["metrics"])
    dump(EV / "view.table.json", {"sort": "merged", "dir": "descending", "ids": view_m["table"]})
    dump(EV / "fresh.plan.json", plan_m["plan"])
    dump(E_ / "after-reset.metrics.json", after_m["metrics"])
    dump(E_ / "before-reset.metrics.json", dep_m["metrics"])
    # the planned picture of a fresh beam equals the schedule
    sched = {t["id"]: t for t in vplan["tickets"]}
    for tid, row in plan_m["plan"]["tickets"].items():
        assert abs(row["start"] - sched[tid]["start"]) < 1e-6 and abs(row["mergeAt"] - sched[tid]["merge"]) < 1e-6, (tid, row, sched[tid])
    assert abs(plan_m["plan"]["finish"] - vplan["numbers"]["finish_h"]) < 1e-6
    write_acceptance(view_m, big_m, status_m, plan_m, vplan, dep, after_m, dep_m)
    dump(VIEW_D / "ui/screens/screens.json", screens_json(tickets_view.P, SCR.VIEW))
    dump(EDIT_D / "ui/screens/screens.json", screens_json(tickets_edit.P, SCR.EDIT))
    # README for fixtures
    (FV / "README.md").write_text(f"""# WarpView fixtures

Made by `WARPDEMO/tools/gen_fixtures.py` with Warp's own scan from `plan/schedule.json`, then moved to {iso(NOW)} of a run that started at {iso(START)}.

| File | What |
|---|---|
| `beam.sample.json` | run `view`, 16 tickets, G0 and G1 green, G2 in flight: every status category is present |
| `tickets/WV-11/state.json` | a Shuttle state newer than the beam (claimed → coding) |
| `status.sample.json` | Warp's `status.json` for that beam (scan.py write_status) |
| `WARP_PLAN.sample.json` | Warp's export of that beam (`kind: warp-plan`) |
| `runs/view/beam.json`, `runs/edit/beam.json` | two named runs for the tabs |
| `big/beam.sample.json` | Warp's 68-ticket example (gates G0–G5) for layout and totals |
| `expected/` | what the reference page computes for these files (categories, run, blocks, plan, actual, metrics, table); `fresh.plan.json` equals `plan/schedule.json` |
""")
    (FE / "README.md").write_text(f"""# WarpEdit fixtures

The run being edited is WarpView near the end of G2 (`beam.sample.json`, made like WarpView's fixtures). WV-07 is merged; its dependents are WV-09 (coding), WV-11 (merged), WV-15 and WV-16 (queued).

| File | What |
|---|---|
| `beam.sample.json`, `status.sample.json`, `WARP_PLAN.sample.json` | the subject run in Warp's three shapes |
| `invalid/missing-dep.json` | WV-09 depends on WV-99 |
| `invalid/cycle.json` | WV-10 ↔ WV-11 |
| `expected/reset.WV-07.coding.json` | WV-07 after reset to coding, note "flaky test", at {at} |
| `expected/dependents.WV-07.json` | blocked, in flight, already merged |
| `expected/saved.beam.json` | the saved beam after that reset (editedAt = {at}) |
| `expected/after-reset.metrics.json`, `before-reset.metrics.json` | totals before and after |
| `expected/scrub.+20.json` | each ticket's phase at +20 h |
""")
    print("fixtures, expected outputs, reference and screens written")


if __name__ == "__main__":
    main()
