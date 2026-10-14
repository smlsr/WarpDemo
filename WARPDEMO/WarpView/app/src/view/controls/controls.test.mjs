import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildRuns } from "../../load/parse/parse.mjs";
import { CATS } from "../../core/status.mjs";
import {
  createPrefs,
  initialControls,
  isHit,
  keyAction,
  legendCounts,
  loadControls,
  matches,
  nextTheme,
  onlyCat,
  renderLegend,
  setColorBy,
  setGroupBy,
  setQuery,
  setZoom,
  switchView,
  toggleCat,
  toggleTheme,
  visibleControls,
  visibleTickets,
} from "./controls.mjs";

const PACK = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (rel) => JSON.parse(readFileSync(join(PACK, rel), "utf8"));
const runsOf = (rel) => buildRuns([{ path: "WARPDEMO/WarpView/" + rel, data: read(rel), modified: null }]).runs;

const ticket = (id, status, cat, extra = {}) => ({ id, title: "t " + id, status, cat, ...extra });

const page = (state, runs) => {
  const dom = new JSDOM(
    `<!doctype html><div id="legend">${renderLegend(runs, state)}</div><input id="q"><div class="tcard" tabindex="0"></div>`,
    { pretendToBeVisual: true }
  );
  return dom;
};

test("AC-1: clicking In Progress turns the chip off and hides those tickets on board and table", () => {
  const runs = runsOf("fixtures/beam.sample.json");
  const run = runs[0];
  const dom = page(initialControls(), runs);
  const doc = dom.window.document;
  let state = initialControls();
  const legend = doc.getElementById("legend");
  legend.addEventListener("click", (e) => {
    const chip = e.target.closest(".fchip");
    if (chip) state = toggleCat(state, chip.dataset.cat);
  });
  doc.querySelector('[data-cat="prog"]').click();
  assert.ok(state.off.has("prog"));
  legend.innerHTML = renderLegend(runs, state);
  assert.ok(legend.querySelector('[data-cat="prog"]').classList.contains("off"));
  assert.equal(legend.querySelector('[data-cat="prog"]').getAttribute("aria-pressed"), "false");
  assert.ok(!legend.querySelector('[data-cat="done"]').classList.contains("off"));
  const progIds = run.tickets.filter((t) => t.cat === "prog").map((t) => t.id);
  assert.ok(progIds.length > 0);
  const shown = visibleTickets(run.tickets, run, state);
  assert.equal(shown.length, run.tickets.length - progIds.length);
  for (const t of run.tickets) assert.equal(matches(t, run, state), t.cat !== "prog");
});

test("AC-1: in progress tickets dim on the swimlane (not a hit) while others stay lit", () => {
  const run = runsOf("fixtures/beam.sample.json")[0];
  const state = toggleCat(initialControls(), "prog");
  const dimmed = run.tickets.filter((t) => !matches(t, run, state));
  assert.ok(dimmed.length > 0 && dimmed.every((t) => t.cat === "prog"));
  assert.ok(run.tickets.filter((t) => t.cat !== "prog").every((t) => matches(t, run, state)));
  assert.ok(run.tickets.every((t) => !isHit(t, run, state)), "no query: nothing is a search hit");
});

test("AC-1: double-click on QA Ready leaves only QA Ready; again shows all", () => {
  const runs = runsOf("fixtures/beam.sample.json");
  const run = runs[0];
  let state = initialControls();
  state = onlyCat(state, "qa");
  assert.deepEqual([...state.off].sort(), CATS.map((c) => c.key).filter((k) => k !== "qa").sort());
  const shown = visibleTickets(run.tickets, run, state);
  assert.ok(shown.length > 0 && shown.every((t) => t.cat === "qa"));
  const html = renderLegend(runs, state);
  const doc = new JSDOM(html).window.document;
  for (const c of CATS) assert.equal(doc.querySelector(`[data-cat="${c.key}"]`).classList.contains("off"), c.key !== "qa");
  state = onlyCat(state, "qa");
  assert.equal(state.off.size, 0);
});

test("AC-1: a real double-click (two clicks then dblclick) ends with only that category", () => {
  const runs = runsOf("fixtures/beam.sample.json");
  const dom = page(initialControls(), runs);
  const doc = dom.window.document;
  let state = initialControls();
  doc.addEventListener("click", (e) => {
    const c = e.target.closest(".fchip");
    if (c) state = toggleCat(state, c.dataset.cat);
  });
  doc.addEventListener("dblclick", (e) => {
    const c = e.target.closest(".fchip");
    if (c) state = onlyCat(state, c.dataset.cat);
  });
  const chip = doc.querySelector('[data-cat="qa"]');
  chip.click();
  chip.click();
  chip.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
  assert.deepEqual([...state.off].sort(), CATS.map((c) => c.key).filter((k) => k !== "qa").sort());
});

test("AC-1: legend carries one chip per category with its count, labels escaped", () => {
  const runs = runsOf("fixtures/beam.sample.json");
  const counts = legendCounts(runs);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), runs[0].tickets.length);
  const doc = new JSDOM(renderLegend(runs, initialControls())).window.document;
  const chips = [...doc.querySelectorAll(".fchip")];
  assert.deepEqual(chips.map((c) => c.dataset.cat), CATS.map((c) => c.key));
  for (const c of chips) assert.equal(c.querySelector(".n").textContent, String(counts[c.dataset.cat]));
  assert.equal(doc.querySelector('[data-cat="prog"]').textContent.startsWith("In Progress"), true);
});

test("AC-2: search 'rubric merged' matches only tickets whose fields contain both words", () => {
  const run = runsOf("fixtures/big/beam.sample.json")[0];
  const rubricIds = run.tickets.filter((t) => matches(t, run, setQuery(initialControls(), "rubric"))).map((t) => t.id);
  assert.ok(rubricIds.length >= 2, "fixture has rubric tickets");
  const target = run.tickets.find((t) => t.id === rubricIds[0]);
  target.status = "merged";
  target.cat = "done";
  const state = setQuery(initialControls(), "rubric merged");
  const hits = run.tickets.filter((t) => matches(t, run, state));
  assert.ok(hits.length > 0 && hits.length < rubricIds.length + 1);
  assert.ok(hits.some((t) => t.id === target.id));
  for (const t of hits) {
    const hay = [t.id, t.title, t.jiraKey, t.module, t.layer, t.lane, t.repo, t.priorityGate, t.agent, t.status, t.block, t.size, run.name].join(" ").toLowerCase();
    assert.ok(hay.includes("rubric") && hay.includes("merged"));
  }
  const rubric = run.tickets.filter((t) => matches(t, run, setQuery(initialControls(), "rubric")));
  const merged = run.tickets.filter((t) => matches(t, run, setQuery(initialControls(), "merged")));
  const both = rubric.filter((t) => merged.includes(t));
  assert.deepEqual(hits.map((t) => t.id), both.map((t) => t.id));
  assert.ok(rubric.length > hits.length || merged.length > hits.length);
  assert.ok(hits.every((t) => isHit(t, run, state)));
});

test("AC-2: words are ANDed over every field, case-insensitive", () => {
  const run = { name: "View" };
  const t = ticket("WV-9", "merged", "done", {
    title: "Rubric store", jiraKey: "WAR-9", module: "core", layer: "ui", lane: "console", repo: "WarpDemo", priorityGate: "G-X", agent: "shuttle-1", block: "G2", size: "M",
  });
  for (const q of ["wv-9", "WAR-9", "core", "ui", "console", "warpdemo", "g-x", "shuttle-1", "g2", "m", "view", "merged", "RUBRIC Merged", "  rubric   war-9  "]) {
    assert.ok(matches(t, run, setQuery(initialControls(), q)), q);
  }
  assert.ok(!matches(t, run, setQuery(initialControls(), "rubric parked")));
  assert.ok(matches(t, run, setQuery(initialControls(), "")));
  assert.ok(!matches(t, run, { ...setQuery(initialControls(), "rubric"), off: new Set(["done"]) }));
});

test("AC-3: typing 'r' and 'o' in the search box types them and triggers no action", () => {
  const dom = new JSDOM(`<!doctype html><input id="q" type="search"><button class="tcard"></button>`, { pretendToBeVisual: true });
  const { document, KeyboardEvent } = dom.window;
  const actions = [];
  document.addEventListener("keydown", (e) => {
    const a = keyAction(e);
    if (a) actions.push(a);
  });
  const q = document.getElementById("q");
  q.focus();
  assert.equal(document.activeElement, q);
  for (const key of ["r", "o", "O", "p", "/"]) {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    q.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, false);
  }
  assert.deepEqual(actions, [], "no reload, open or print while typing");
  assert.equal(keyAction({ key: "r", target: q }), null);
  assert.equal(keyAction({ key: "o", target: q }), null);
  assert.equal(keyAction({ key: "O", target: { tagName: "SELECT" } }), null);
});

test("AC-3: outside an input the same keys map to their actions; modifiers are ignored", () => {
  const body = { tagName: "BODY" };
  assert.equal(keyAction({ key: "r", target: body }), "reload");
  assert.equal(keyAction({ key: "o", target: body }), "open-files");
  assert.equal(keyAction({ key: "O", target: body }), "open-folder");
  assert.equal(keyAction({ key: "p", target: body }), "print");
  assert.equal(keyAction({ key: "/", target: body }), "focus-search");
  assert.equal(keyAction({ key: "r", ctrlKey: true, target: body }), null);
  assert.equal(keyAction({ key: "r", metaKey: true, target: body }), null);
  assert.equal(keyAction({ key: "p", altKey: true, target: body }), null);
  assert.equal(keyAction({ key: "x", target: body }), null);
});

test("AC-3: Escape always closes; Enter and Space activate cards, rows, lane headers and sort headers", () => {
  const dom = new JSDOM(`<input id="q"><div class="tcard"></div><div class="lane-h"></div><div class="trow"></div><table><th data-sort="id"></th></table><button id="b"></button>`);
  const d = dom.window.document;
  const q = d.getElementById("q");
  assert.equal(keyAction({ key: "Escape", target: q }), "escape");
  for (const sel of [".tcard", ".lane-h", ".trow", "th[data-sort]"]) {
    assert.equal(keyAction({ key: "Enter", target: d.querySelector(sel) }), "activate", sel);
    assert.equal(keyAction({ key: " ", target: d.querySelector(sel) }), "activate", sel);
  }
  assert.equal(keyAction({ key: "Enter", target: d.getElementById("b") }), null);
});

const throwing = () => {
  throw new Error("SecurityError");
};

test("AC-4: with localStorage throwing, switching view and toggling theme work and do not throw", () => {
  const prefs = createPrefs(throwing);
  let state = initialControls();
  assert.doesNotThrow(() => {
    state = switchView(state, "board", prefs);
    state = switchView(state, "table", prefs);
    state = toggleTheme(state, prefs, false);
    state = setGroupBy(state, "module", prefs);
    state = setColorBy(state, "lane", prefs);
    state = setZoom(state, "40", prefs);
  });
  assert.equal(state.view, "table");
  assert.equal(state.theme, "dark");
  assert.equal(state.groupBy, "module");
  assert.equal(state.colorBy, "lane");
  assert.equal(state.zoom, 40);
  assert.equal(prefs.get("view"), null);
  assert.equal(prefs.set("view", "x"), false);
  assert.deepEqual(loadControls(prefs), initialControls());
  state = toggleTheme(state, prefs, false);
  assert.equal(state.theme, "light");
});

test("AC-4: a storage whose getItem and setItem throw, on a jsdom window, still switches and applies the theme", () => {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "file:///viewer.html" });
  const storage = { getItem: throwing, setItem: throwing };
  const prefs = createPrefs(() => storage);
  let state = loadControls(prefs);
  assert.doesNotThrow(() => {
    state = switchView(state, "board", prefs);
    state = toggleTheme(state, prefs, true);
    dom.window.document.documentElement.setAttribute("data-theme", state.theme);
  });
  assert.equal(state.view, "board");
  assert.equal(dom.window.document.documentElement.getAttribute("data-theme"), "light");
  assert.deepEqual(visibleControls(state), { groupBy: true, zoom: false, colorBy: true });
});

test("AC-4: when the storage object itself is unavailable, nothing throws", () => {
  const prefs = createPrefs(() => null);
  assert.equal(prefs.get("view"), null);
  assert.equal(prefs.set("view", "board"), false);
  assert.equal(switchView(initialControls(), "board", prefs).view, "board");
});

test("AC-4: working storage remembers choices under the warp-dash: prefix and rejects bad values", () => {
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
  const prefs = createPrefs(() => storage);
  let state = initialControls();
  state = switchView(state, "board", prefs);
  state = setGroupBy(state, "repo", prefs);
  state = setColorBy(state, "module", prefs);
  state = setZoom(state, "250", prefs);
  state = toggleTheme(state, prefs, true);
  assert.deepEqual([...map.keys()].sort(), ["warp-dash:colorBy", "warp-dash:groupBy", "warp-dash:theme", "warp-dash:view", "warp-dash:zoom"]);
  const loaded = loadControls(prefs);
  assert.equal(loaded.view, "board");
  assert.equal(loaded.groupBy, "repo");
  assert.equal(loaded.colorBy, "module");
  assert.equal(loaded.zoom, 100);
  assert.equal(loaded.theme, "light");
  map.set("warp-dash:view", "<script>");
  map.set("warp-dash:groupBy", "nope");
  assert.equal(loadControls(prefs).view, "timeline");
  assert.equal(loadControls(prefs).groupBy, "block");
  assert.equal(switchView(initialControls(), "bogus", prefs).view, "timeline");
});

test("AC-4: nextTheme follows the data-theme, else the system preference", () => {
  assert.equal(nextTheme(null, true), "light");
  assert.equal(nextTheme(null, false), "dark");
  assert.equal(nextTheme("dark", false), "light");
  assert.equal(nextTheme("light", true), "dark");
});

test("AC-1: lanes select shows on the board only, zoom on the swimlane only", () => {
  assert.deepEqual(visibleControls({ view: "timeline" }), { groupBy: false, zoom: true, colorBy: true });
  assert.deepEqual(visibleControls({ view: "board" }), { groupBy: true, zoom: false, colorBy: true });
  assert.deepEqual(visibleControls({ view: "table" }), { groupBy: false, zoom: false, colorBy: true });
});
