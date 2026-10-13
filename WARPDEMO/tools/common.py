"""Shared model for the WARPDEMO packs: modules, paths, and the ticket helper.

Every path in a ticket is repo-root-relative. Pack documents (spec, plan, tickets,
fixtures, ui) are read-only during the build; code goes under <module>/app/ and
the released single file sits at <module>/<product>.
"""

from __future__ import annotations

import re

REPO = "smlsr/WarpDemo"
REPO_URL = "https://github.com/smlsr/WarpDemo"
BROWSE = REPO_URL + "/blob/main/"
PROJECT_KEY = "WAR"
PROJECT_NAME = "Warp Demo"
ROOT = "WARPDEMO"
SIZE_HOURS = {"S": 4, "M": 7, "L": 11, "XL": 16}
AUTO_MERGE_SIZES = ("S", "M")          # Warp's default autoMergeSizes
APPROVAL_HOURS = 0.5
SLOTS = 18                             # Warp's default maxAgents

MODULES = {
    "view": {
        "name": "WarpView", "run": "view", "prefix": "WV", "dir": f"{ROOT}/WarpView", "product": "viewer.html",
        "title": "WarpView — read-only Warp run dashboard",
        "job": "Open a Warp run's files from disk and show every ticket on a slot swimlane, a board and a table, colored by status, with run totals.",
        "startAfter": None, "paths": [f"{ROOT}/WarpView"],
    },
    "edit": {
        "name": "WarpEdit", "run": "edit", "prefix": "WE", "dir": f"{ROOT}/WarpEdit", "product": "editor.html",
        "title": "WarpEdit — reset a ticket's phase on the WarpView screens",
        "job": "The WarpView screens plus one change: put a ticket back on an earlier phase, keep its history, and save the run in the shape it was loaded.",
        "startAfter": "view:G2", "paths": [f"{ROOT}/WarpEdit"],
    },
}

LANES = ["platform", "model", "console", "quality", "release"]


def words(text: str) -> int:
    return len(re.findall(r"\S+", text))


class Pack:
    def __init__(self, key: str):
        self.key = key
        self.m = MODULES[key]
        self.d = self.m["dir"]
        self.app = self.d + "/app"
        self.tickets: list[dict] = []
        self.gates: list[dict] = []

    # pack documents every ticket may link
    def spec(self, anchor: str = "") -> dict:
        return {"title": "SPEC" + (f" §{anchor}" if anchor else ""), "url": f"{self.d}/spec/SPEC.md"}

    def links(self, *extra: dict) -> list:
        base = [
            {"title": "Agent rules (preamble)", "url": f"{ROOT}/AGENTS.md"},
            {"title": "SPEC", "url": f"{self.d}/spec/SPEC.md"},
            {"title": "Acceptance queries", "url": f"{self.d}/spec/ACCEPTANCE.md"},
            {"title": "Runbook", "url": f"{self.d}/plan/BUILD_PLAN.md"},
            {"title": "Plan and waves", "url": f"{self.d}/plan/CURSOR_PLAN.md"},
        ]
        seen = {l["url"] for l in base}
        for l in extra:
            if l["url"] not in seen:
                base.append(l)
                seen.add(l["url"])
        return base

    def T(self, tid, summary, *, size, lane, gate, deps, locks, why, what, acs, layer="ui",
          critical_hint=False, screens=None, out=None, notes="", test_data=None, config_keys=None,
          links=None, risks="", component=None, release=None):
        assert re.fullmatch(self.m["prefix"] + r"-\d\d", tid), tid
        assert len(summary) <= 80, (tid, len(summary))
        assert 40 <= words(why) <= 150, (tid, "why", words(why))
        assert words(what) >= 60, (tid, "what", words(what))
        assert len(acs) >= 3, tid
        kinds = [k for k, _ in acs]
        assert any(k in ("negative", "edge") for k in kinds), (tid, "needs a negative or edge AC")
        tests = [t for _, t in acs if f"npm --prefix {self.app} test`" in t]
        assert len(tests) == 1, (tid, "exactly one AC names the test command", len(tests))
        assert size in SIZE_HOURS and lane in LANES, tid
        for p in locks:
            assert p.startswith(self.d + "/"), (tid, p)
            for zone in ("spec/", "plan/", "tickets/", "fixtures/", "ui/"):
                assert not p.startswith(f"{self.d}/{zone}"), (tid, "lock inside the pack zone", p)
        screens = screens or []
        ui = None
        if screens:
            ui = {
                "screens": [s["title"] for s in screens],
                "routes": ["file://…/" + self.m["product"]],
                "designLink": screens[0]["png"],
                "states": sorted({st for s in screens for st in s.get("states", [])}),
                "accessibility": "Every control is a button, link, input or select with a visible label or aria-label; focus is visible; Escape closes overlays; contrast meets WCAG AA in both themes.",
                "browsers": ["Chrome 120+", "Edge 120+", "Safari 17+", "Firefox 121+"],
                "visualBaseline": " · ".join(s["png"] for s in screens),
            }
        t = {
            "tempId": tid,
            "summary": summary,
            "issueType": "Story",
            "priority": "High" if critical_hint else "Medium",
            "labels": [f"size:{size}", f"gate:{gate}", f"lane:{lane}", f"run:{self.m['run']}", "warp-demo"],
            "layer": layer,
            "systems": [{"system": self.m["name"], "component": component or lane}],
            "areasProposed": [lane],
            "forgeRepo": REPO,
            "forgeMode": None,
            "parentTempId": None,
            "blockedByTempIds": list(deps),
            "why": why.strip(),
            "what": what.strip(),
            "outOfScope": list(out or []),
            "acceptanceCriteria": [{"id": f"AC-{i + 1}", "kind": k, "text": x} for i, (k, x) in enumerate(acs)],
            "nfrs": [{"id": "NFR-1", "text": "No network calls: the built file loads nothing from outside itself."}],
            "technicalDetails": {
                "services": list(locks),
                "apiContract": "none (static page; module exports listed in SPEC §11)",
                "dataMigration": "none",
                "idempotency": "Rendering is a pure function of the loaded files and the view state; loading the same files twice gives the same screen.",
                "configKeys": list(config_keys or []),
                "vendors": [],
                "implementerNotes": (
                    f"Repo layout: `{self.d}/spec|plan|tickets|fixtures|ui` is the read-only pack; write code only under the lock "
                    f"folders above (inside `{self.app}/`). Start with `Implement {tid}`. Run `npm --prefix {self.app} ci` once, "
                    f"then `npm --prefix {self.app} test`. " + notes
                ).strip(),
            },
            "featureFlag": None,
            "releaseNotes": release or {"title": summary, "description": summary[:200], "impacts": [], "audience": "internal", "visibility": "silent"},
            "userInterface": ui,
            "logging": {
                "events": [{"name": "load.failed", "level": "error", "when": "a file cannot be read or parsed", "fields": ["path", "reason"]}],
                "requiredFieldsEveryLine": ["path"],
                "neverLog": ["file contents", "tokens or keys found in config"],
                "retention": "browser console only",
            },
            "metrics": {"metrics": [], "dashboard": "none", "alerts": [], "sloTouched": "none"},
            "analyticsEvents": [],
            "environment": {"name": "local browser + node 22", "testData": test_data or f"{self.d}/fixtures/beam.sample.json"},
            "dependenciesRisks": {"dependsOn": list(deps), "vendorsInTest": [], "risks": risks or "Low: one module folder, covered by its own tests.", "rollback": "Revert the PR; the module folder is self-contained."},
            "notes": f"Run `{self.m['run']}` · gate {gate} · lane {lane}. Product code under `{self.app}/`; the pack folders are read-only.",
            "links": self.links(*(links or []), *[{"title": s["title"], "url": s["png"]} for s in screens]),
            # plan fields (not in the Jira schema; read by the schedule generator)
            "_size": size, "_h": SIZE_HOURS[size], "_lane": lane, "_gate": gate, "_locks": list(locks),
        }
        self.tickets.append(t)
        return t

    def gate(self, key, name, members, checks, if_red, blocking=True):
        self.gates.append({"key": key, "name": name, "blocking": blocking, "members": list(members), "checks": list(checks), "if_red": if_red})
