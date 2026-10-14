import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { JSDOM, VirtualConsole } from "jsdom";
import { withData } from "./dom.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACK = join(APP, "..");
const VIEWER = join(PACK, "viewer.html");
const README = join(APP, "README.md");
const NOW = Date.parse("2026-10-12T20:00:00Z");

const json = (rel) => JSON.parse(readFileSync(join(PACK, rel), "utf8"));
const expected = (name) => json(`fixtures/expected/${name}.json`);

let html;
before(() => {
  html = readFileSync(VIEWER, "utf8");
});

// The released file running its own script, as a user opens it, with the clock held at the fixtures' "now".
function open(files) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (!/Not implemented/.test(e.message)) errors.push(e.message);
  });
  vc.on("error", (...a) => errors.push(a.map(String).join(" ")));
  const dom = new JSDOM(withData(html, files === null ? null : { generatedAt: "2026-10-12T20:00:00Z", files }), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "file:///viewer.html",
    virtualConsole: vc,
    beforeParse(win) {
      const Real = win.Date;
      class Fixed extends Real {
        constructor(...a) {
          super(...(a.length ? a : [NOW]));
        }
        static now() {
          return NOW;
        }
      }
      win.Date = Fixed;
    },
  });
  return { dom, doc: dom.window.document, win: dom.window, errors };
}

const BEAM = (rel) => [{ path: ".warp/beam.json", data: json(rel) }];
const SCHEDULE = (rel) => [{ path: "schedule.json", data: json(rel) }];
const STATUS = (rel) => [{ path: ".warp/status.json", data: json(rel) }];

const $ = (doc, s) => doc.querySelector(s);
const $$ = (doc, s) => [...doc.querySelectorAll(s)];
const num = (s) => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(s));
  return m ? parseFloat(m[0].replace(/,/g, "")) : null;
};
const view = (doc, v) => $(doc, `#viewSeg [data-view="${v}"]`).click();

// ---- what the page shows, read back from its DOM ---------------------------------------------------

function tableRows(doc) {
  view(doc, "table");
  const heads = $$(doc, "#view thead th").map((th) => th.textContent.trim());
  const at = (label) => heads.indexOf(label);
  return $$(doc, "#view tbody tr.trow").map((tr) => ({
    id: tr.dataset.id,
    block: tr.children[at("Block")].textContent.trim(),
  }));
}

function blocksFromTable(doc) {
  return Object.fromEntries(tableRows(doc).map((r) => [r.id, r.block]));
}

function blocksFromBoard(doc) {
  view(doc, "board");
  const sel = $(doc, "#groupBy");
  sel.value = "block";
  sel.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
  const out = {};
  for (const lane of $$(doc, "#view .lane")) for (const card of $$(lane, ".tcard")) out[card.dataset.id] = lane.dataset.lane;
  return out;
}

function tableOrder(doc, key, dir) {
  view(doc, "table");
  for (let i = 0; i < 3; i++) {
    const th = $(doc, `#view th[data-sort="${key}"]`);
    if (th.getAttribute("aria-sort") === dir) break;
    th.click();
  }
  return $$(doc, "#view tbody tr.trow").map((tr) => tr.dataset.id);
}

// Slot, start and gate lines come off the swimlane: bars sit at start * hours-per-pixel, rows are slots.
function planFromSwimlane(doc) {
  view(doc, "timeline");
  const panel = $(doc, "#view .swimlane");
  const ticks = $$(panel, ".tl-axis .tl-track span");
  const tick = ticks.find((s) => num(s.textContent) > 0);
  const pph = parseFloat(tick.style.left) / num(tick.textContent);
  const tickets = {};
  for (const row of $$(panel, ".tl-body .tl-row")) {
    const slot = num($(row, ".tl-lab").textContent) - 1;
    for (const bar of $$(row, ".bar")) tickets[bar.dataset.id] = { slot, start: (parseFloat(bar.style.left) - 1) / pph };
  }
  const lines = $$(panel, ".tl-lines .gline").map((i) => parseFloat(i.style.left) / pph);
  const head = $(panel, ".panel-h .muted").textContent;
  return {
    pph,
    tickets,
    lines,
    slots: num(/(\d+) of \d+ slots/.exec(head)[1]),
    finish: num(/planned finish T\+(\d+(?:\.\d+)?)h/.exec(head)[1]),
  };
}

function cards(doc) {
  const out = {};
  for (const c of $$(doc, "#metrics .card")) {
    const rows = {};
    for (const r of $$(c, ".rows > div")) rows[r.childNodes[1].textContent.trim()] = num($(r, ".v").textContent);
    const foot = {};
    for (const s of $$(c, ".foot span")) {
      const b = $(s, "b");
      if (b) foot[s.childNodes[0].textContent.trim()] = b.textContent.trim();
    }
    out[$(c, "h3").childNodes[0].textContent.trim()] = { big: $(c, ".big").textContent.trim(), rows, foot };
  }
  return out;
}

const CATS = { done: "Completed", prog: "In progress", err: "Errored / parked", todo: "To do" };
const byCat = (rows) => Object.fromEntries(Object.keys(CATS).map((k) => [k, rows[CATS[k]] ?? 0]));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// ---- comparisons against fixtures/expected/ --------------------------------------------------------

function assertBlocks(files, name) {
  const { dom, doc, errors } = open(files);
  const exp = expected(name);
  assert.deepEqual(blocksFromTable(doc), exp, `${name}: table Block column`);
  assert.deepEqual(blocksFromBoard(doc), exp, `${name}: board lanes`);
  assert.deepEqual(errors, []);
  dom.window.close();
}

function assertPlan(files, name) {
  const { dom, doc, errors } = open(files);
  const exp = expected(name);
  const got = planFromSwimlane(doc);
  const tol = 1 / got.pph;
  assert.deepEqual(Object.keys(got.tickets).sort(), Object.keys(exp.tickets).sort(), `${name}: bars are the planned tickets`);
  for (const [id, e] of Object.entries(exp.tickets)) {
    assert.equal(got.tickets[id].slot, e.slot, `${name} ${id} slot`);
    close(got.tickets[id].start, e.start, tol, `${name} ${id} start`);
  }
  assert.equal(got.finish, Math.round(exp.finish), `${name}: planned finish`);
  assert.equal(got.slots, exp.slots, `${name}: slots`);
  const expLines = [...new Set(Object.values(exp.gateAt))].sort((a, b) => a - b);
  const gotLines = [...new Set(got.lines.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
  assert.equal(gotLines.length, expLines.length, `${name}: one gate line per gate time`);
  expLines.forEach((at, i) => close(gotLines[i], at, tol, `${name} gate line ${i}`));
  assert.deepEqual(errors, []);
  dom.window.close();
}

function assertMetrics(files, name, { people = true } = {}) {
  const { dom, doc, errors } = open(files);
  const exp = expected(name);
  const c = cards(doc);

  assert.deepEqual(byCat(c["Agent hours"].rows), exp.agent, `${name}: agent hours by status`);
  assert.equal(num(c["Agent hours"].big), exp.agentTotal, `${name}: agent hours total`);
  assert.deepEqual(byCat(c["Tickets"].rows), exp.count, `${name}: tickets by status`);
  assert.equal(num(c["Tickets"].big), exp.ticketTotal, `${name}: ticket total`);
  assert.equal(num(c["Agent hours"].foot["Actual"]), Math.round(exp.actualH * 10) / 10, `${name}: actual hours`);
  assert.equal(num(c["Agent hours"].foot["Tokens"]), exp.tokens, `${name}: tokens`);
  if (exp.cost == null) assert.equal(c["Agent hours"].foot["Cost"] ?? "—", "—", `${name}: cost`);
  else assert.equal(num(c["Agent hours"].foot["Cost"]), Math.round(exp.cost * 100) / 100, `${name}: cost`);

  assert.deepEqual(byCat(c["People hours"].rows), exp.human, `${name}: people hours by status`);
  assert.equal(num(c["People hours"].big), exp.humanTotal, `${name}: people hours total`);
  if (people && exp.humanPlan != null) assert.equal(num(c["People hours"].foot["Plan"]), exp.humanPlan, `${name}: people plan`);
  assert.equal(c["People hours"].foot["Gates"], exp.gatesTotal ? `${exp.gatesGreen}/${exp.gatesTotal}` : "—", `${name}: gates green`);

  const est = c["Run estimate"];
  if (exp.estTotal == null) {
    assert.equal(est.big, "—", `${name}: no estimate without a plan`);
  } else {
    close(num(est.big), exp.estTotal, 0.5, `${name}: estimate`);
    for (const k of Object.keys(CATS)) close(est.rows[CATS[k]] ?? 0, exp.share[k], 0.051, `${name}: estimate ${k}`);
  }
  if (exp.eta != null) close(num(est.foot["ETA left"]), exp.eta, 0.5, `${name}: ETA left`);
  assert.deepEqual(errors, []);
  dom.window.close();
}

// ---- AC-1: the release file ------------------------------------------------------------------------

test("AC-1: release writes viewer.html beside app/, under 400 kB, and it opens empty from disk", () => {
  const committed = readFileSync(VIEWER, "utf8");
  const r = spawnSync("npm", ["--prefix", APP, "run", "release"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /viewer: .*viewer\.html \d+/);
  const bytes = readFileSync(VIEWER).length;
  assert.ok(bytes > 0 && bytes < 400 * 1024, `viewer.html is ${bytes} bytes`);
  assert.equal(r.stdout.includes("dist"), false, "release does not write under dist/");
  html = readFileSync(VIEWER, "utf8");
  assert.equal(html, committed, "the committed viewer.html is what release builds");

  const { dom, doc, errors } = open(null);
  assert.match(doc.body.textContent, /Open a Warp run/);
  assert.equal($(doc, "#emptyState").hidden, false);
  assert.equal($(doc, "#app").hidden, true);
  assert.equal(doc.getElementById("warp-data").textContent, "null");
  assert.equal($$(doc, "script[src], link[rel=stylesheet]").length, 0);
  assert.deepEqual(errors, []);
  dom.window.close();
});

// ---- AC-2: parity with the design of record --------------------------------------------------------

test("AC-2: beam.sample.json — blocks equal view.blocks.json", () => {
  assertBlocks(BEAM("fixtures/beam.sample.json"), "view.blocks");
});

test("AC-2: beam.sample.json — plan equals view.plan.json", () => {
  assertPlan(BEAM("fixtures/beam.sample.json"), "view.plan");
});

test("AC-2: beam.sample.json — metrics equal view.metrics.json", () => {
  assertMetrics(BEAM("fixtures/beam.sample.json"), "view.metrics");
});

test("AC-2: beam.sample.json — table order sorted by Merged descending equals view.table.json", () => {
  const { dom, doc, errors } = open(BEAM("fixtures/beam.sample.json"));
  const exp = expected("view.table");
  assert.deepEqual(tableOrder(doc, exp.sort, exp.dir), exp.ids);
  assert.deepEqual(errors, []);
  dom.window.close();
});

test("AC-2: the 68-ticket big beam — blocks, plan and metrics equal big.*.json", () => {
  const files = BEAM("fixtures/big/beam.sample.json");
  assertBlocks(files, "big.blocks");
  assertPlan(files, "big.plan");
  assertMetrics(files, "big.metrics");
});

test("AC-2: schedule files — plan equals schedule.plan.json; two repos blocks and plan equal two-repos.*.json", () => {
  assertPlan(SCHEDULE("plan/schedule.json"), "schedule.plan");
  assertBlocks(SCHEDULE("fixtures/schedule/two-repos.json"), "two-repos.blocks");
  assertPlan(SCHEDULE("fixtures/schedule/two-repos.json"), "two-repos.plan");
});

test("AC-2: status.sample.json alone — metrics equal status-only.metrics.json", () => {
  assertMetrics(STATUS("fixtures/status.sample.json"), "status-only.metrics");
});

// ---- AC-3: read-only and offline -------------------------------------------------------------------

test("AC-3: viewer.html has no data-edit, no Reset control and no network URL in markup or script", () => {
  assert.equal(/data-edit/i.test(html), false);
  assert.equal(/\bReset\b/.test(html), false);
  assert.equal(/https?:\/\/[^\s"'`)\\]/i.test(html), false, "no host after a scheme");
  assert.equal(/(?:src|href|action)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html), false);
  assert.equal(/url\(\s*["']?(?:https?:)?\/\//i.test(html), false);
  assert.equal(/@import/i.test(html), false);
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|\beval\s*\(|new Function|serviceWorker/.test(html), false);

  const { dom, doc, win, errors } = open(BEAM("fixtures/beam.sample.json"));
  for (const v of ["timeline", "board", "table"]) {
    view(doc, v);
    assert.equal(doc.querySelectorAll("[data-edit]").length, 0, `${v}: no data-edit`);
    assert.equal(/\bReset\b/.test(doc.body.textContent), false, `${v}: no Reset text`);
    assert.equal($$(doc, "button, [role=button], a, input[type=button]").some((el) => /reset/i.test(el.textContent + (el.getAttribute("aria-label") || ""))), false, `${v}: no reset control`);
  }
  $(doc, "#view tr.trow, #view .bar, #view .tcard").click();
  assert.equal(doc.querySelectorAll("[data-edit]").length, 0, "drawer: no data-edit");
  assert.equal(/\bReset\b/.test($(doc, "#drawer").textContent), false, "drawer: no Reset text");
  assert.deepEqual(errors, []);
  win.close();
  assert.ok(dom);
});

// ---- AC-4: the README ------------------------------------------------------------------------------

test("AC-4: README names WarpEdit for resets and gives fixtures/beam.sample.json", () => {
  const text = readFileSync(README, "utf8");
  assert.match(text, /WarpEdit/);
  assert.match(text, /WARPDEMO\/WarpEdit\/editor\.html/);
  assert.match(text, /reset/i);
  assert.match(text, /fixtures\/beam\.sample\.json/);
  assert.match(text, /read-only/i);
  for (const word of ["beam.json", "status.json", "state.json", "WARP_PLAN.json", ".warp", "swimlane", "board", "table"]) {
    assert.ok(text.includes(word), `README mentions ${word}`);
  }
});
