import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { buildRuns } from "../../load/parse/parse.mjs";
import { plan } from "../../model/plan/plan.mjs";
import { computeMetrics, utilization } from "../../model/metrics/metrics.mjs";
import { stamp } from "../../core/util.mjs";
import {
  currentRuns,
  renderActions,
  renderCards,
  renderHeader,
  renderHeadline,
  renderMeta,
  renderTabs,
  renderUtil,
  runKey,
  runLabel,
} from "./header.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "../../../..");
const FIX = join(PACK, "fixtures");
const SCREENS = join(PACK, "ui/screens");
const NOW = Date.parse("2026-10-12T20:00:00Z");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const fixture = (p) => json(join(FIX, p));
const expected = (name) => fixture(join("expected", name));
const norm = (s) => String(s).replace(/>\s+</g, "><").trim();

const frag = new JSDOM("").window.document;
function dom(html) {
  const el = frag.createElement("div");
  el.innerHTML = html;
  return el;
}
const text = (html) => dom(html).textContent;

function load(docs, extra) {
  const { runs } = buildRuns(
    docs.map((d) => ({ modified: NOW, ...d })),
    extra,
  );
  runs.forEach(plan);
  return runs;
}

const sampleRuns = () =>
  load([
    { path: ".warp/beam.json", data: fixture("beam.sample.json") },
    { path: ".warp/tickets/WV-11/state.json", data: fixture("tickets/WV-11/state.json") },
  ]);
const twoRuns = () =>
  load([
    { path: ".warp/runs/view/beam.json", data: fixture("runs/view/beam.json") },
    { path: ".warp/runs/edit/beam.json", data: fixture("runs/edit/beam.json") },
  ]);
const scheduleRuns = () => load([{ path: "WARPDEMO/WarpView/plan/schedule.json", data: json(join(PACK, "plan/schedule.json")) }]);

function header(runs, tab = "all") {
  const cur = currentRuns(runs, tab);
  return renderHeader({ runs, tab, metrics: computeMetrics(cur, NOW), util: utilization(cur), now: NOW });
}

const refCache = new Map();
async function reference(screen) {
  if (refCache.has(screen)) return refCache.get(screen);
  const page = new JSDOM(readFileSync(join(SCREENS, screen + ".html"), "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "file:///viewer.html",
  });
  const w = page.window;
  if (w.document.readyState !== "complete") await new Promise((r) => w.addEventListener("load", r));
  const d = w.document;
  for (let i = 0; i < 250 && !d.getElementById("generated").textContent; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(d.getElementById("generated").textContent, `${screen}.html did not finish rendering`);
  const out = {
    meta: d.getElementById("meta").innerHTML,
    title: d.getElementById("title").textContent,
    subline: d.getElementById("subline").textContent,
    chain: d.getElementById("chainline").textContent,
    tabs: [...d.querySelectorAll("#tabs .tab")].map((b) => b.textContent),
    metrics: d.getElementById("metrics").innerHTML,
    util: d.getElementById("util").innerHTML,
  };
  w.close();
  refCache.set(screen, out);
  return out;
}

const cards = (html) => [...dom(html).querySelectorAll(".card")];
const rowsOf = (card) =>
  [...card.querySelectorAll(".rows > div")].map((r) => [r.childNodes[1].textContent, r.querySelector(".v").textContent, r.querySelector(".p").textContent]);
const chipTexts = (html) => [...dom(html).querySelectorAll(".chip")].map((c) => c.textContent);

// AC-1

test("AC-1: beam.sample.json totals equal fixtures/expected/view.metrics.json", () => {
  const runs = sampleRuns();
  assert.deepEqual(JSON.parse(JSON.stringify(computeMetrics(runs, NOW))), expected("view.metrics.json"));
});

test("AC-1: beam.sample.json meta chips match swimlane-plan (repo, run, warp:id, running, owner, updated)", async () => {
  const runs = sampleRuns();
  const h = header(runs);
  assert.equal(norm(h.meta), norm((await reference("swimlane-plan")).meta));
  assert.deepEqual(chipTexts(h.meta), [
    "repo smlsr/WarpDemo",
    "run view",
    "warp:4e7a21",
    "running",
    "owner Dev One",
    `updated 3m ago · ${stamp(Date.parse("2026-10-12T19:57:00Z"))}`,
  ]);
  const el = dom(h.meta);
  assert.ok(el.querySelector(".chip.mono"), "instance chip is mono");
  assert.ok(el.querySelector(".dot.running"), "running dot");
  assert.ok(el.querySelector(".hide-sm"), "stamp is hidden on phones");
});

test("AC-1: beam.sample.json title, subline and critical chain match swimlane-plan", async () => {
  const runs = sampleRuns();
  const h = header(runs);
  const ref = await reference("swimlane-plan");
  assert.equal(text(h.title), "view — smlsr/WarpDemo swimlane");
  assert.equal(text(h.subline), ref.subline);
  assert.equal(
    text(h.subline),
    "16 tickets · 6 waves · 127 agent-hours · 18 agent slots · planned finish T+59h · peak 6 in flight · critical chain 55h over 6 tickets · gate order strict · plan as written in schedule.json",
  );
  assert.equal(text(h.chain), ref.chain);
  assert.equal(text(h.chain), "★ WV-01 → WV-06 → WV-07 → WV-09 → WV-15 → WV-16");
  assert.equal(h.tabs, "", "one run shows no tabs");
});

test("AC-1: the four cards match swimlane-plan markup and carry view.metrics.json numbers", async () => {
  const runs = sampleRuns();
  const m = expected("view.metrics.json");
  const h = header(runs);
  assert.equal(norm(h.metrics), norm((await reference("swimlane-plan")).metrics));

  const [run, agent, human, tick] = cards(h.metrics);
  assert.deepEqual(
    cards(h.metrics).map((c) => c.querySelector("h3").firstChild.textContent.trim()),
    ["Run estimate", "Agent hours", "People hours", "Tickets"],
  );
  assert.equal(run.querySelector(".big").textContent, `${m.estTotal}h`);
  assert.equal(agent.querySelector(".big").textContent, `${m.agentTotal}h`);
  assert.equal(human.querySelector(".big").textContent, `${m.humanTotal}h`);
  assert.equal(tick.querySelector(".big").textContent, String(m.ticketTotal));

  assert.deepEqual(rowsOf(run), [
    ["Completed", "25.3h", "43%"],
    ["In progress", "20.7h", "35%"],
    ["Errored / parked", "3.2h", "6%"],
    ["To do", "9.2h", "16%"],
  ]);
  assert.deepEqual(rowsOf(agent), [
    ["Completed", `${m.agent.done}h`, "43%"],
    ["In progress", `${m.agent.prog}h`, "35%"],
    ["Errored / parked", `${m.agent.err}h`, "6%"],
    ["To do", `${m.agent.todo}h`, "16%"],
  ]);
  assert.deepEqual(rowsOf(human), [
    ["Completed", `${m.human.done}h`, "33%"],
    ["In progress", `${m.human.prog}h`, "44%"],
    ["To do", `${m.human.todo}h`, "22%"],
  ], "the err row is left out when it is 0");
  assert.deepEqual(rowsOf(tick), [
    ["Completed", String(m.count.done), "56%"],
    ["In progress", String(m.count.prog), "25%"],
    ["Errored / parked", String(m.count.err), "6%"],
    ["To do", String(m.count.todo), "13%"],
  ]);

  assert.equal(run.querySelector(".foot").textContent, "Elapsed 30hETA left ~55hSwimlane T+59hsplit by agent-hours");
  assert.equal(run.querySelectorAll(".assume li").length, m.assumptions.length);
  assert.equal(agent.querySelector(".foot").textContent, "Actual 34.2hTokens 7,421,045Cost $31.18");
  assert.equal(human.querySelector(".foot").textContent, `Plan 4.5hGates ${m.gatesGreen}/${m.gatesTotal} green0.5h per review or gate`);
  assert.equal(tick.querySelector("h3 span").textContent, "56% complete");
  assert.equal(tick.querySelector(".foot").textContent, "In review 1QA ready 1Coding 2");

  const segs = [...run.querySelectorAll(".stack i")].map((i) => i.getAttribute("style"));
  assert.deepEqual(
    segs.map((s) => s.split("background:")[1]),
    ["var(--c-done)", "var(--c-prog)", "var(--c-err)", "var(--c-todo)"],
  );
});

test("AC-1: the utilization panel matches utilization.png: summary, three meters, by-size and by-agent (8 rows, 'n more')", async () => {
  const runs = sampleRuns();
  const h = header(runs);
  assert.equal(norm(h.util), norm((await reference("utilization")).util));
  const el = dom(h.util);
  assert.equal(
    el.querySelector("summary").textContent,
    "Utilization 4 active of 18 agents · 34.2h spent of 127h estimated · 7,421,045 tokens",
  );
  assert.deepEqual(
    [...el.querySelectorAll(".meter .row .v")].map((v) => v.textContent),
    ["4 / 18", "34.2h / 127h", "9 / 16"],
  );
  const [size, agent] = el.querySelectorAll("table.mini");
  assert.deepEqual([...size.querySelectorAll("tbody td:first-child")].map((td) => td.textContent), ["S", "M", "L", "XL"]);
  assert.equal(agent.querySelectorAll("tbody tr").length, 8);
  assert.equal(agent.nextElementSibling.textContent, "7 more");
});

// AC-2

test("AC-2: both beams in fixtures/runs/ give tabs 'All runs (2)', 'edit · 0/14', 'view · 9/16'", async () => {
  const runs = twoRuns();
  const h = header(runs);
  const tabs = [...dom(h.tabs).querySelectorAll("button.tab")];
  assert.deepEqual(
    tabs.map((b) => b.textContent),
    ["All runs (2)", "edit · 0/14", "view · 9/16"],
  );
  assert.deepEqual(tabs.map((b) => b.textContent), (await reference("multi-run")).tabs);
  assert.deepEqual(tabs.map((b) => b.dataset.tab), ["all", "edit", "view"]);
  assert.deepEqual(tabs.map((b) => b.classList.contains("on")), [true, false, false]);
});

test("AC-2: all runs meta shows '2 runs · 1 running' and matches multi-run", async () => {
  const runs = twoRuns();
  const h = header(runs);
  const ref = await reference("multi-run");
  assert.equal(norm(h.meta), norm(ref.meta));
  assert.deepEqual(chipTexts(h.meta).slice(0, 2), ["repo smlsr/WarpDemo", "2 runs · 1 running"]);
  assert.equal(text(h.title), "smlsr/WarpDemo — 2 runs");
  assert.equal(text(h.subline), ref.subline);
  const [, ...rest] = cards(h.metrics);
  const [, ...refRest] = cards(ref.metrics);
  assert.deepEqual(rest.map((c) => norm(c.outerHTML)), refRest.map((c) => norm(c.outerHTML)));
});

test("AC-2: with all runs selected the run estimate adds every run: estimate, elapsed, ETA left and swimlane finish", () => {
  const runs = twoRuns();
  const per = runs.map((r) => computeMetrics([r], NOW));
  const all = computeMetrics(runs, NOW);
  const add = (k) => per.reduce((a, m) => a + (m[k] || 0), 0);
  assert.equal(all.estTotal, 129.5);
  assert.equal(all.estTotal, add("estTotal"));
  assert.equal(all.elapsed, add("elapsed"));
  assert.equal(all.eta, add("eta"));
  assert.equal(all.finish, add("finish"));
  const sum = Object.values(all.share).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - all.estTotal) < 1e-9, "the split still adds up to the estimate");

  const [run] = cards(header(runs).metrics);
  assert.equal(run.querySelector("h3 span").textContent, "all runs, added");
  assert.equal(run.querySelector(".big").textContent, "130h");
  assert.equal(run.querySelector(".foot").textContent, "Elapsed 30hETA left ~122hSwimlane T+135hsplit by agent-hours");

  const [one] = cards(header(runs, "edit").metrics);
  assert.equal(one.querySelector("h3 span").textContent, "elapsed, plan");
  assert.equal(one.querySelector(".big").textContent, `${per[runs.findIndex((r) => r.name === "edit")].estTotal}h`);
});

test("AC-2: picking a run tab shows that run's own chips and marks the tab", () => {
  const runs = twoRuns();
  const h = header(runs, "edit");
  assert.deepEqual(
    [...dom(h.tabs).querySelectorAll(".tab.on")].map((b) => b.textContent),
    ["edit · 0/14"],
  );
  const chips = chipTexts(h.meta);
  assert.ok(chips.includes("run edit"));
  assert.ok(chips.includes("warp:9c3b05"));
  assert.ok(chips.includes("stopped"));
  assert.ok(chips.includes("owner Dev Two"));
  assert.ok(!chips.some((c) => /runs ·/.test(c)));
  assert.match(text(h.title), /^edit — .* swimlane$/);
  assert.match(text(h.subline), /starts after view:G2/);
  assert.equal(runKey(runs[0]), "edit");
  assert.equal(runLabel({ instance: "abc" }), "warp:abc");
});

// AC-3

test("AC-3: estTotal null: the run estimate big number and every row read '—' and the bar is empty", () => {
  const runs = load([{ path: ".warp/status.json", data: fixture("status.sample.json") }]);
  const m = computeMetrics(runs, NOW);
  assert.equal(m.estTotal, null);
  const run = cards(renderCards(m, runs))[0];
  assert.equal(run.querySelector(".big").textContent, "—");
  const rows = rowsOf(run);
  assert.ok(rows.length >= 3);
  for (const [, v, p] of rows) {
    assert.equal(v, "—");
    assert.equal(p, "");
  }
  const bar = run.querySelector(".stack");
  assert.equal(bar.children.length, 0);
  assert.equal(bar.innerHTML, "");
});

test("AC-3: a synthetic metrics object with estTotal null renders the same empty estimate card", () => {
  const m = {
    ...expected("view.metrics.json"),
    estTotal: null,
    share: { done: null, prog: null, err: null, todo: null },
  };
  const run = cards(renderCards(m, []))[0];
  assert.equal(run.querySelector(".big").textContent, "—");
  assert.deepEqual(rowsOf(run).map((r) => r[1]), ["—", "—", "—"]);
  assert.equal(run.querySelector(".stack").children.length, 0);
});

// AC-4

test("AC-4: plan/schedule.json alone: the state chip reads plan with the plan dot", async () => {
  const runs = scheduleRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, "schedule");
  const h = header(runs);
  const el = dom(h.meta);
  const state = [...el.querySelectorAll(".chip")].find((c) => c.querySelector(".dot"));
  assert.equal(state.textContent, "plan");
  assert.ok(state.querySelector(".dot.plan"));
  assert.equal(norm(h.meta), norm((await reference("schedule-plan")).meta));
});

test("AC-4: plan/schedule.json alone: the subline ends with 'plan as written in schedule.json' and matches schedule-plan", async () => {
  const runs = scheduleRuns();
  const h = header(runs);
  const ref = await reference("schedule-plan");
  assert.ok(text(h.subline).endsWith(" · plan as written in schedule.json"));
  assert.equal(text(h.subline), ref.subline);
  assert.equal(text(h.title), "WarpView — smlsr/WarpDemo swimlane");
  assert.equal(text(h.title), ref.title);
  assert.equal(text(h.chain), ref.chain);
  assert.equal(norm(h.metrics), norm(ref.metrics));
  assert.equal(norm(h.util), norm(ref.util));
});

test("AC-4: 'plan as written' stays last when a schedule-planned run also has starts after", () => {
  const runs = scheduleRuns();
  runs[0].startAfter = "view:G2";
  const sub = text(renderHeadline(runs).subline);
  assert.ok(sub.endsWith("gate order strict · starts after view:G2 · plan as written in schedule.json"), sub);
});

// AC-5

test("AC-5: a run with no repo, no instance and no owner omits those chips instead of showing them empty", () => {
  const run = { kind: "beam", name: "solo", instance: null, repo: null, owner: null, range: null, runState: "running", paused: false, updated: NOW - 60000, tickets: [] };
  const html = renderMeta([run], "all", { now: NOW });
  const chips = chipTexts(html);
  assert.deepEqual(chips, ["run solo", "running", `updated 1m ago · ${stamp(NOW - 60000)}`]);
  assert.ok(!/repo|warp:|owner/.test(html));
  assert.ok(!/<b><\/b>/.test(html), "no empty value");
});

test("AC-5: a run with nothing at all still renders, and every value-less chip is left out", () => {
  const run = { kind: "beam", tickets: [] };
  const html = renderMeta([run], "all", { now: NOW });
  assert.equal(chipTexts(html).length, 0);
  assert.equal(renderMeta([], "all", { now: NOW }), '<span class="chip">No run loaded</span>');
  const owner = renderMeta([{ ...run, owner: { machine: "bc-1" }, range: {} }], "all", { now: NOW });
  assert.ok(!/owner|range/.test(owner));
});

// AC-6

test("AC-6: header.test.mjs covers pause reason, range spec and the export chip", () => {
  const run = {
    kind: "beam",
    name: "r",
    runState: "running",
    paused: true,
    pauseReason: "lunch",
    range: { spec: "G0-G2" },
    owner: "Ann",
    export: true,
    exportedAt: Date.parse("2026-10-13T14:26:05Z"),
    updated: NOW,
    tickets: [],
  };
  const el = dom(renderMeta([run], "all", { now: NOW }));
  const chips = [...el.querySelectorAll(".chip")].map((c) => c.textContent);
  assert.ok(el.querySelector(".dot.paused"));
  assert.ok(chips.includes("paused · lunch"));
  assert.ok(chips.includes("range G0-G2"));
  assert.ok(chips.includes("owner Ann"));
  assert.ok(chips.includes(`exported ${stamp(run.exportedAt)}`));
});

test("AC-6: ISO-string times are read as times and out-of-range times are dropped, not thrown", () => {
  const iso = "2026-10-12T19:00:00Z";
  const base = { kind: "beam", name: "r", export: true, tickets: [] };
  const chips = chipTexts(renderMeta([{ ...base, exportedAt: iso, updated: iso }], "all", { now: NOW }));
  assert.ok(chips.includes(`exported ${stamp(Date.parse(iso))}`), chips.join(" | "));
  assert.ok(chips.includes(`updated 1h ago · ${stamp(Date.parse(iso))}`), chips.join(" | "));
  const huge = renderMeta([{ ...base, exportedAt: 1e300, updated: 1e300 }], "all", { now: NOW });
  assert.deepEqual(chipTexts(huge), ["run r"]);
});

test("AC-6: the export fixture shows its exported time", () => {
  const runs = load([{ path: "WARP_PLAN.json", data: fixture("WARP_PLAN.sample.json") }]);
  assert.equal(runs[0].export, true);
  const chips = chipTexts(renderMeta(runs, "all", { now: NOW }));
  assert.ok(chips.includes(`exported ${stamp(Date.parse("2026-10-13T14:26:05Z"))}`), chips.join(" | "));
});

test("AC-6: every loaded value is escaped in chips, headline, tabs, cards and the utilization panel", () => {
  const bad = '<img src=x onerror="alert(1)">';
  const mk = (name) => ({
    kind: "beam",
    name,
    instance: bad,
    repo: bad,
    owner: { by: bad },
    range: { spec: bad },
    runState: bad,
    pauseReason: bad,
    updated: NOW,
    cap: 18,
    estimate: { assumptions: [bad] },
    tickets: [{ id: bad, critical: true, start: 0, hours: 4, cat: "done", status: "done", size: "S", agent: bad }],
  });
  const runs = [mk(bad), mk("b")];
  const parts = [
    renderMeta(runs, bad, { now: NOW }),
    renderMeta(runs, "all", { now: NOW }),
    ...Object.values(renderHeadline([runs[0]])),
    renderTabs(runs, "all"),
    renderCards(computeMetrics(runs, NOW), runs),
    renderUtil(utilization(runs)),
  ];
  for (const html of parts) {
    assert.ok(!html.includes("<img"), html);
    assert.equal(dom(html).querySelector("img"), null);
  }
});

test("AC-6: plugin header actions render in order, skip failures and are empty with none", () => {
  const state = { runs: [] };
  assert.equal(renderActions([], state), "");
  assert.equal(renderActions(undefined, state), "");
  const html = renderActions(
    [
      { id: "a", render: () => '<button type="button">A</button>' },
      { id: "boom", render: () => { throw new Error("x"); } },
      { id: "empty", render: () => "" },
      { id: '"b"', render: (s) => `<button type="button">${s === state ? "B" : "?"}</button>` },
    ],
    state,
  );
  const el = dom(html);
  assert.deepEqual([...el.querySelectorAll(".hdr-act")].map((s) => s.dataset.hook), ["a", '"b"']);
  assert.equal(el.textContent, "AB");
  const h = renderHeader({ runs: [], actions: [{ id: "x", render: () => "<b>x</b>" }] });
  assert.equal(h.actions, '<span class="hdr-act" data-hook="x"><b>x</b></span>');
});

test("AC-6: header.mjs is pure: no DOM or global access, same input gives the same output", () => {
  const src = readFileSync(join(HERE, "header.mjs"), "utf8");
  assert.ok(!/\b(document|window|localStorage|globalThis|fetch|XMLHttpRequest|eval)\b/.test(src));
  const a = header(sampleRuns());
  const b = header(sampleRuns());
  assert.deepEqual(a, b);
});

test("AC-6: header.css uses only tokens, no color literal", () => {
  const css = readFileSync(join(HERE, "header.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false);
  assert.equal(/\b(?:rgba?|hsla?)\(/.test(css), false);
  assert.match(css, /\.dot\.done\s*\{\s*background:\s*var\(--brand\)/);
});
