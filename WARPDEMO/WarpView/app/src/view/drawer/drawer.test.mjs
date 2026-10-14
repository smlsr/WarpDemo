import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { buildRuns } from "../../load/parse/parse.mjs";
import { plan } from "../../model/plan/plan.mjs";
import { parseTime, stamp } from "../../core/util.mjs";
import { renderDrawer, renderTooltip, recentEvents } from "./drawer.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const NOW = Date.parse("2026-10-12T20:00:00Z");

function open(file, id) {
  const data = JSON.parse(readFileSync(join(FIX, file), "utf8"));
  const { runs } = buildRuns([{ path: ".warp/" + file.split("/").pop(), data }]);
  const run = runs[0];
  plan(run);
  return { run, ticket: run.tickets.find((t) => t.id === id) };
}

const dom = (html) => new JSDOM(`<body><aside class="drawer">${html}</aside></body>`).window.document;

function pairs(dl) {
  const out = [];
  for (const dt of dl.querySelectorAll("dt")) out.push([dt.textContent, dt.nextElementSibling.textContent]);
  return out;
}

const lists = (doc) => doc.querySelectorAll("dl.kv");
const heads = (doc) => [...doc.querySelectorAll("h4")].map((h) => h.textContent);

test("AC-1: WV-05 fields and timestamps match drawer.png in order and value", () => {
  const { run, ticket } = open("beam.sample.json", "WV-05");
  const doc = dom(renderDrawer(ticket, run, [], NOW));
  assert.equal(doc.querySelector(".drawer-h .id").textContent, "WV-05");
  assert.equal(doc.querySelector(".drawer-h .tt").textContent, "Open files and folders, drag and drop, reload and auto-reload");
  assert.equal(doc.querySelector(".drawer-h").getAttribute("style"), "--c:var(--c-done)");
  assert.ok(doc.querySelector("#drawerClose"));
  const kv = pairs(lists(doc)[0]);
  assert.deepEqual(kv, [
    ["Status", "Completed · merged"],
    ["Run", "view"],
    ["Block", "G1"],
    ["Size", "M · auto-merge"],
    ["Estimate", "7h (ticket)"],
    ["Planned", "T+15h → T+22h · slot 2"],
    ["Spent", "2.6h"],
    ["Tokens / cost", "479,846 / $2.02"],
    ["Pull request", "https://github.com/smlsr/WarpDemo/pull/57"],
    ["CI / Bugbot", "green / pass"],
    ["Jira", "WAR-108 · QA Ready"],
    ["Merged", "0023b682af connected 2026-10-11T23:05:56Z"],
    ["Agent", "bc-62f28d"],
    ["Attempts", "1"],
    ["Module", "WarpView · ui"],
    ["Lane / repo", "platform · smlsr/WarpDemo"],
    ["Priority gate", "G2 · dispatched after the critical chain, ahead of rank"],
    ["Schedule", "slot 2 · T+15h → T+22h · latest start T+29h"],
    ["Updated", `${stamp(parseTime("2026-10-11T23:05:56Z"))} (21h ago)`],
  ]);
  const st = (iso) => `${stamp(parseTime(iso))} ${iso}`;
  assert.deepEqual(pairs(lists(doc)[1]), [
    ["Claimed", st("2026-10-11T20:27:36Z")],
    ["PR opened", st("2026-10-11T22:30:56Z")],
    ["Reviewed", st("2026-10-11T22:50:56Z")],
    ["Approved", "—"],
    ["Merged", st("2026-10-11T23:05:56Z")],
    ["Jira last comment", st("2026-10-11T23:05:56Z")],
    ["Updated", st("2026-10-11T23:05:56Z")],
  ]);
  assert.deepEqual(heads(doc), ["Timestamps", "Checks when it merges", "Depends on", "Locks", "Events"]);
  const sections = [...doc.querySelectorAll("h4")];
  assert.deepEqual(
    [...sections[2].nextElementSibling.querySelectorAll(".tag")].map((e) => e.textContent),
    ["WV-04"],
  );
  assert.deepEqual(
    [...sections[3].nextElementSibling.querySelectorAll(".tag")].map((e) => e.textContent),
    ["WARPDEMO/WarpView/app/src/load/sources/"],
  );
  assert.equal(doc.querySelectorAll(".dv-checks li").length, 2);
  assert.equal(doc.querySelector(".dv-checks li b").textContent, "Data and model match the reference (G1)");
  const ev = [...doc.querySelectorAll(".ev > span")].map((e) => e.textContent);
  assert.equal(ev.length, 10);
  assert.match(ev[1], /^status review → merged$/);
  assert.match(ev[3], /^bugbot · pass$/);
  const link = doc.querySelector('a[href="https://github.com/smlsr/WarpDemo/pull/57"]');
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener");
});

test("AC-1: alarm is the second field and a state note is last", () => {
  const { run, ticket } = open("beam.sample.json", "WV-05");
  const t = { ...ticket, alarm: "lock-escape: wrote x", stateNote: "state.json: coding" };
  const kv = pairs(lists(dom(renderDrawer(t, run, [], NOW)))[0]);
  assert.deepEqual(kv[1], ["Alarm", "lock-escape: wrote x"]);
  assert.deepEqual(kv[kv.length - 1], ["Note", "state.json: coding"]);
});

test("AC-2: an extra section lands after Events and nothing else changes", () => {
  const { run, ticket } = open("beam.sample.json", "WV-05");
  const base = renderDrawer(ticket, run, [], NOW);
  const x = { id: "x", render: () => '<p id="x">X</p>' };
  const html = renderDrawer(ticket, run, [x], NOW);
  assert.equal(html.replace('<p id="x">X</p>', ""), base);
  const doc = dom(html);
  const p = doc.querySelector("#x");
  assert.equal(p.textContent, "X");
  assert.equal(p.previousElementSibling.className, "ev");
  assert.equal(p.nextElementSibling, null);
  const y = { id: "y", render: (t) => `<p id="y">${t.id}</p>` };
  const two = dom(renderDrawer(ticket, run, [x, y], NOW));
  assert.deepEqual([...two.querySelectorAll(".drawer-b > p")].map((e) => e.id), ["x", "y"]);
  const bad = renderDrawer(ticket, run, [{ id: "b", render: () => { throw new Error("no"); } }, x], NOW);
  assert.equal(bad, html);
});

test("AC-3: AD-02 shows lane/repo, priority gate, schedule and checks", () => {
  const { run, ticket } = open("schedule/two-repos.json", "AD-02");
  const doc = dom(renderDrawer(ticket, run, [], NOW));
  const kv = new Map(pairs(lists(doc)[0]));
  assert.equal(kv.get("Lane / repo"), "1 API · Demo-API");
  assert.ok(kv.get("Priority gate").startsWith("G-RBAC"));
  assert.equal(kv.get("Schedule"), "slot 2 · T+7h → T+14h · latest start T+11h");
  assert.equal(kv.get("Jira"), "—");
  assert.deepEqual(heads(doc).slice(0, 2), ["Timestamps", "Checks when it merges"]);
  assert.deepEqual([...doc.querySelectorAll(".dv-checks li")].map((e) => e.textContent), ["Roles live (G-RBAC) — make rbac-ready"]);
  assert.equal(pairs(lists(doc)[1]).every(([, v]) => v === "—"), true);
});

test("AC-3: Lane / repo, Priority gate and Schedule are omitted when the ticket has none", () => {
  const { run, ticket } = open("beam.sample.json", "WV-05");
  const t = { ...ticket, lane: null, repo: null, priorityGate: null, planned: null, checks: [], deps: [], locks: [], events: [] };
  const doc = dom(renderDrawer(t, run, [], NOW));
  const keys = pairs(lists(doc)[0]).map(([k]) => k);
  for (const k of ["Lane / repo", "Priority gate", "Schedule"]) assert.ok(!keys.includes(k), k);
  assert.deepEqual(heads(doc), ["Timestamps"]);
});

test("AC-4: 40 events list 25, newest first", () => {
  const { run, ticket } = open("beam.sample.json", "WV-05");
  const events = Array.from({ length: 40 }, (_, i) => ({
    at: new Date(Date.UTC(2026, 9, 11, 0, i)).toISOString(),
    type: "note",
    detail: "e" + i,
  }));
  const doc = dom(renderDrawer({ ...ticket, events }, run, [], NOW));
  const rows = [...doc.querySelectorAll(".ev > span:nth-child(even)")].map((e) => e.textContent);
  assert.equal(rows.length, 25);
  assert.equal(rows[0], "note · e39");
  assert.equal(rows[24], "note · e15");
  const shuffled = events.slice().reverse();
  assert.deepEqual(recentEvents(shuffled).map((e) => e.detail), rows.map((r) => r.slice(7)));
});

test("AC-5: a hostile title is escaped in the header, the tooltip and the key list", () => {
  const { run, ticket } = open("beam.sample.json", "WV-05");
  const bad = "<img src=x onerror=alert(1)>";
  const t = { ...ticket, title: bad, alarm: bad, stateNote: bad, agent: bad, lane: bad, jiraKey: bad, pr: { ...ticket.pr, url: "javascript:" + bad } };
  const html = renderDrawer(t, run, [], NOW);
  assert.ok(!html.includes("<img"));
  const doc = dom(html);
  assert.equal(doc.querySelector("img"), null);
  assert.equal(doc.querySelector(".drawer-h .tt").textContent, bad);
  const kv = new Map(pairs(lists(doc)[0]));
  assert.equal(kv.get("Alarm"), bad);
  assert.equal(kv.get("Note"), bad);
  assert.ok(kv.get("Agent").includes(bad));
  assert.ok(kv.get("Lane / repo").includes(bad));
  assert.equal(doc.querySelector("a[href^='javascript:']"), null);
  const tip = renderTooltip(t);
  assert.ok(!tip.includes("<img"));
  const tdoc = dom(tip);
  assert.equal(tdoc.querySelector("img"), null);
  assert.ok(tdoc.body.textContent.includes(bad));
  assert.equal(dom(renderDrawer({ ...t, id: bad }, run, [], NOW)).querySelector("img"), null);
});

test("tooltip: id, status, title, size, estimate, window, block, PR and Jira", () => {
  const { ticket } = open("beam.sample.json", "WV-05");
  const doc = dom(renderTooltip(ticket));
  assert.equal(doc.querySelector("b").textContent, "WV-05");
  assert.equal(
    doc.querySelector("aside").textContent,
    "WV-05 · mergedOpen files and folders, drag and drop, reload and auto-reloadM · est 7h · T+15→22h · G1 · PR #57 · WAR-108",
  );
  assert.equal(renderTooltip({ id: "Q-1", title: "t", status: "queued", hours: null }).includes("T+"), false);
});
