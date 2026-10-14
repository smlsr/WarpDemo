import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../build.mjs";
import { withData } from "../test/dom.mjs";
import { CATS } from "./core/status.mjs";
import { swimlaneScale, LABEL_W, PRINT_W } from "./view/swimlane/swimlane.mjs";
import { createApp } from "./main.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..", "..");
const FIX = join(PACK, "fixtures");
const BUILT = join(HERE, "..", "dist", "viewer.html");
const NOW = Date.parse("2026-10-12T20:00:00Z");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const CAT_KEYS = CATS.map((c) => c.key);
const CATEGORIES = json(join(FIX, "expected", "categories.json"));

const file = (path, rel) => ({ path, data: json(join(PACK, rel)) });
const BEAM = [file(".warp/beam.json", "fixtures/beam.sample.json"), file(".warp/tickets/WV-11/state.json", "fixtures/tickets/WV-11/state.json")];
const TWO_RUNS = [file(".warp/runs/view/beam.json", "fixtures/runs/view/beam.json"), file(".warp/runs/edit/beam.json", "fixtures/runs/edit/beam.json")];
const FIXTURES = {
  "beam.sample.json + state.json": BEAM,
  "big/beam.sample.json": [file(".warp/beam.json", "fixtures/big/beam.sample.json")],
  "status.sample.json": [file(".warp/status.json", "fixtures/status.sample.json")],
  "WARP_PLAN.sample.json": [file("WARP_PLAN.json", "fixtures/WARP_PLAN.sample.json")],
  "runs/view + runs/edit": TWO_RUNS,
  "schedule/two-repos.json": [file("schedule.json", "fixtures/schedule/two-repos.json")],
  "plan/schedule.json": [file("schedule.json", "plan/schedule.json")],
};

let html;
before(async () => {
  await build();
  html = readFileSync(BUILT, "utf8");
});

// jsdom reports "Not implemented" for print and page reload; anything else it reports is a real error.
function console_() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (!/Not implemented/.test(e.message)) errors.push(e.message + (e.detail ? " " + e.detail : ""));
  });
  vc.on("error", (...a) => {
    if (a[0] !== "load.failed") errors.push(a.map(String).join(" "));
  });
  return { vc, errors };
}

// The built file running its own script, as a user opens it.
function bundle(files) {
  const { vc, errors } = console_();
  const dom = new JSDOM(withData(html, { generatedAt: "2026-10-12T20:00:00Z", files }), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "file:///viewer.html",
    virtualConsole: vc,
  });
  return { dom, win: dom.window, doc: dom.window.document, errors };
}

// The built page with createApp imported, so a test can pass plugins and read the store.
function module_(files, plugins = []) {
  const { vc, errors } = console_();
  const dom = new JSDOM(withData(html, { generatedAt: "2026-10-12T20:00:00Z", files }), {
    pretendToBeVisual: true,
    url: "file:///viewer.html",
    virtualConsole: vc,
  });
  const app = createApp({ root: dom.window.document, plugins, now: () => NOW });
  return { dom, win: dom.window, doc: dom.window.document, app, errors };
}

const $ = (doc, s) => doc.querySelector(s);
const $$ = (doc, s) => [...doc.querySelectorAll(s)];
const int = (s) => parseInt(String(s).replace(/[^\d]/g, ""), 10);
const fire = (win, el, type, init = {}) => el.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true, ...init }));
const key = (win, el, k, init = {}) => el.dispatchEvent(new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const view = (doc, v) => $(doc, `#viewSeg [data-view="${v}"]`).click();
const zero = () => Object.fromEntries(CAT_KEYS.map((k) => [k, 0]));
const catOfVar = (style) => (/var\(--c-(\w+)\)/.exec(style || "") || [])[1];

function legend(doc) {
  const out = zero();
  for (const b of $$(doc, "#legend .fchip")) out[b.dataset.cat] = int($(b, ".n").textContent);
  return out;
}

function ticketsCard(doc) {
  const card = $$(doc, "#metrics .card").find((c) => /^Tickets/.test($(c, "h3").textContent));
  const rows = {};
  for (const r of $$(card, ".rows > div")) rows[r.childNodes[1].textContent.trim()] = int($(r, ".v").textContent);
  const foot = {};
  for (const s of $$(card, ".foot span")) foot[s.childNodes[0].textContent.trim()] = int($(s, "b").textContent);
  return { total: int($(card, ".big").textContent), rows, foot };
}

function boardByStatus(win, doc) {
  const sel = $(doc, "#groupBy");
  sel.value = "status";
  fire(win, sel, "change");
  const out = zero();
  for (const lane of $$(doc, "#view .lane")) {
    const m = /(\d+)\/(\d+) done/.exec($(lane, ".stat").textContent);
    const n = int(m[2]);
    assert.equal($$(lane, ".tcard").length, n, `lane ${lane.dataset.lane}: cards = header count`);
    out[lane.dataset.lane] = n;
  }
  return out;
}

function tableByCat(doc) {
  const out = zero();
  for (const tr of $$(doc, "#view tr.trow")) out[catOfVar($(tr, ".chipst").getAttribute("style"))]++;
  return out;
}

function barsByCat(doc) {
  const out = zero();
  for (const b of $$(doc, "#view .bar")) out[[...b.classList].find((c) => c.startsWith("c-")).slice(2)]++;
  return out;
}

function storeByCat(runs) {
  const out = zero();
  for (const r of runs) for (const t of r.tickets) out[t.cat]++;
  return out;
}

// Every pane's per-category count, taken from the DOM after showing each view.
function panes(win, doc) {
  view(doc, "timeline");
  const lg = legend(doc);
  const card = ticketsCard(doc);
  const bars = barsByCat(doc);
  view(doc, "board");
  const board = boardByStatus(win, doc);
  view(doc, "table");
  const table = tableByCat(doc);
  return { lg, card, bars, board, table };
}

function assertAgree({ lg, card, bars, board, table }, label) {
  const total = Object.values(lg).reduce((a, b) => a + b, 0);
  for (const k of CAT_KEYS) {
    assert.equal(board[k], lg[k], `${label}: board lane ${k} = legend`);
    assert.equal(table[k], lg[k], `${label}: table rows ${k} = legend`);
    assert.equal(bars[k], lg[k], `${label}: swimlane bars ${k} = legend`);
  }
  assert.equal(card.total, total, `${label}: Tickets card total = legend total`);
  assert.equal(card.rows["Completed"], lg.done, `${label}: card Completed = legend`);
  assert.equal(card.rows["In progress"], lg.prog + lg.rev + lg.qa, `${label}: card In progress = prog + rev + qa`);
  assert.equal(card.rows["Errored / parked"] ?? 0, lg.err, `${label}: card Errored = legend`);
  assert.equal(card.rows["To do"], lg.todo, `${label}: card To do = legend`);
  assert.equal(card.foot["In review"], lg.rev, `${label}: card In review = legend`);
  assert.equal(card.foot["QA ready"], lg.qa, `${label}: card QA ready = legend`);
  assert.equal(card.foot["Coding"], lg.prog, `${label}: card Coding = legend`);
}

// ---- AC-1 ----------------------------------------------------------------------------------------

test("AC-1: beam.sample.json — legend, Tickets card, board lanes and table rows agree for every category", () => {
  const { dom, win, doc, errors } = bundle(BEAM);
  const p = panes(win, doc);
  assert.deepEqual(p.lg, { done: 9, err: 1, prog: 2, rev: 1, qa: 1, todo: 2 });
  assertAgree(p, "beam.sample");
  assert.deepEqual(p.card.rows, { Completed: 9, "In progress": 4, "Errored / parked": 1, "To do": 2 });
  assert.equal(p.card.total, 16);
  assert.deepEqual(errors, []);
  dom.window.close();
});

test("AC-1: the panes agree with the store, and stay in step when a category is filtered out", () => {
  const { dom, win, doc, app, errors } = module_(BEAM);
  const p = panes(win, doc);
  assert.deepEqual(p.lg, storeByCat(app.store.getRuns()));
  assertAgree(p, "module");

  $(doc, '#legend .fchip[data-cat="done"]').click();
  assert.equal($(doc, '#legend .fchip[data-cat="done"]').classList.contains("off"), true);
  assert.equal(legend(doc).done, 9, "the legend still counts a hidden category");
  view(doc, "table");
  assert.equal($$(doc, "#view tr.trow:not([hidden])").length, 7);
  view(doc, "board");
  const shown = $$(doc, "#view .lane .stat").map((s) => s.textContent).join(" ");
  assert.match(shown, /0 shown/);
  view(doc, "timeline");
  assert.equal($$(doc, "#view .bar.dim").length, 9);
  assert.deepEqual(errors, []);
  dom.window.close();
});

// ---- AC-2 ----------------------------------------------------------------------------------------

test("AC-2: two runs — the edit tab shows only the edit run in every pane and the meta says run edit", () => {
  const { dom, win, doc, errors } = bundle(TWO_RUNS);
  const tabs = $$(doc, "#tabs .tab").map((b) => b.textContent);
  assert.deepEqual(tabs, ["All runs (2)", "edit · 0/14", "view · 9/16"]);
  assert.match($(doc, "#meta").textContent, /2 runs · \d running/);

  $(doc, '#tabs [data-tab="edit"]').click();
  assert.equal($(doc, '#tabs [data-tab="edit"]').classList.contains("on"), true);
  const meta = $$(doc, "#meta .chip").map((c) => c.textContent);
  assert.ok(meta.includes("run edit"), meta.join(" | "));
  assert.ok(!meta.some((c) => /run view/.test(c)));
  assert.match($(doc, "#title").textContent, /^edit — /);
  assert.match($(doc, "#subline").textContent, /^14 tickets/);

  const lg = legend(doc);
  assert.equal(Object.values(lg).reduce((a, b) => a + b, 0), 14);
  assert.equal(ticketsCard(doc).total, 14);
  assert.match($(doc, "#util summary").textContent, /active of 18 agents/);

  view(doc, "timeline");
  const panels = $$(doc, "#view .swimlane");
  assert.deepEqual(panels.map((p) => p.dataset.run), ["edit"]);
  const bars = $$(doc, "#view .bar");
  assert.ok(bars.length > 0);
  assert.ok(bars.every((b) => b.dataset.run === "edit"));

  view(doc, "board");
  const cards = $$(doc, "#view .tcard");
  assert.equal(cards.length, 14);
  assert.ok(cards.every((c) => c.dataset.run === "edit"));
  assert.ok(!/view/.test($$(doc, "#view .lane").map((l) => l.dataset.lane).join(" ")));

  view(doc, "table");
  const rows = $$(doc, "#view tr.trow");
  assert.equal(rows.length, 14);
  assert.ok(rows.every((r) => r.dataset.run === "edit"));

  rows[0].click();
  assert.match($(doc, "#drawer").textContent, /Run\s*edit/);

  $(doc, '#tabs [data-tab="all"]').click();
  assert.equal($$(doc, "#view tr.trow").length, 30);
  assert.deepEqual(errors, []);
  dom.window.close();
});

// ---- AC-3 ----------------------------------------------------------------------------------------

test("AC-3: a drawerSections plugin puts #p in the drawer; without plugins it is not there", () => {
  const bound = [];
  const plugin = { id: "t", drawerSections: [{ id: "p", render: () => "<b id=p>P</b>", bind: (el, ctx) => bound.push([el, ctx.ticket.id]) }] };
  const withP = module_(BEAM, [plugin]);
  $(withP.doc, "#view .bar").click();
  assert.equal(withP.doc.body.classList.contains("drawer-open"), true);
  const p = $(withP.doc, "#drawer #p");
  assert.ok(p, "#p is in the drawer");
  assert.equal(p.textContent, "P");
  assert.equal(bound.length, 1);
  assert.ok(bound[0][0].contains(p), "bind gets the section element");
  assert.equal(withP.app.hooks.drawerSections.length, 1);
  assert.deepEqual(withP.errors, []);
  withP.dom.window.close();

  for (const none of [module_(BEAM), bundle(BEAM)]) {
    $(none.doc, "#view .bar").click();
    assert.equal(none.doc.body.classList.contains("drawer-open"), true);
    assert.ok($(none.doc, "#drawer .drawer-h"));
    assert.equal($(none.doc, "#drawer #p"), null);
    assert.equal($(none.doc, "#p"), null);
    assert.deepEqual(none.errors, []);
    none.dom.window.close();
  }
});

test("AC-3: headerActions, swimlaneOverlays, keys and init hooks reach the page; a failing plugin does not break it", () => {
  const seen = { init: 0, key: 0, actionBind: 0, overlayBind: 0 };
  const plugin = {
    id: "t",
    init: (app) => {
      seen.init++;
      assert.equal(typeof app.recompute, "function");
      assert.equal(typeof app.store.subscribe, "function");
    },
    headerActions: [{ id: "a", render: (state) => `<button id="hdr">${state.runs.length} runs</button>`, bind: () => seen.actionBind++ }],
    swimlaneOverlays: [{ id: "o", render: (lay, run) => `<i id="ov">${run.name}:${lay.items.length}</i>`, bind: () => seen.overlayBind++ }],
    keys: [{ key: "x", run: (e, ctx) => (seen.key++, assert.ok(ctx.store)) }],
    drawerSections: [{ id: "boom", render: () => { throw new Error("plugin bug"); } }],
  };
  const { dom, win, doc, errors } = module_(BEAM, [plugin]);
  assert.equal(seen.init, 1);
  assert.equal($(doc, "#actionsBar").hidden, false);
  assert.equal($(doc, "#actionsBar #hdr").textContent, "1 runs");
  assert.equal(seen.actionBind, 1);
  assert.equal($(doc, '#view [data-overlay="o"] #ov').textContent, "view:16");
  assert.ok(seen.overlayBind >= 1);
  key(win, doc.body, "x");
  assert.equal(seen.key, 1);
  key(win, $(doc, "#q"), "x");
  assert.equal(seen.key, 1, "plugin keys are ignored while typing");
  $(doc, "#view .bar").click();
  assert.ok($(doc, "#drawer .drawer-h"), "the drawer opens even when a plugin section throws");
  assert.deepEqual(errors, []);
  dom.window.close();

  const bare = module_(BEAM);
  assert.equal($(bare.doc, "#actionsBar").hidden, true);
  assert.equal($(bare.doc, "#actionsBar").innerHTML, "");
  assert.equal($$(bare.doc, "[data-overlay]").length, 0);
  bare.dom.window.close();
});

// ---- AC-4 ----------------------------------------------------------------------------------------

function exercise(win, doc) {
  const click = (el) => el && el.click();
  const dbl = (el) => el && el.dispatchEvent(new win.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  for (const v of ["timeline", "board", "table"]) {
    view(doc, v);
    for (const k of CAT_KEYS) {
      click($(doc, `#legend .fchip[data-cat="${k}"]`));
      click($(doc, `#legend .fchip[data-cat="${k}"]`));
    }
    dbl($(doc, '#legend .fchip[data-cat="prog"]'));
    dbl($(doc, '#legend .fchip[data-cat="prog"]'));
    const q = $(doc, "#q");
    for (const s of ["wv-1", "coding", ""]) {
      q.value = s;
      fire(win, q, "input");
    }
    key(win, doc.body, "/");
    key(win, q, "Escape");
    for (const id of ["groupBy", "colorBy"]) {
      const sel = $(doc, "#" + id);
      for (const o of [...sel.options]) {
        sel.value = o.value;
        fire(win, sel, "change");
      }
    }
    const z = $(doc, "#zoom");
    for (const n of ["100", "50", "0"]) {
      z.value = n;
      fire(win, z, "input");
    }
    for (const c of ["actual", "plan"]) click($(doc, `#view [data-clock="${c}"]`));
    for (const th of $$(doc, "#view th[data-sort]").map((t) => t.dataset.sort)) {
      click($(doc, `#view th[data-sort="${th}"]`));
      key(win, $(doc, `#view th[data-sort="${th}"]`), "Enter");
    }
    for (const lane of $$(doc, "#view .lane-h")) {
      click(lane);
      key(win, lane, " ");
    }
    for (const sel of ["#view .bar", "#view .tcard", "#view .trow"]) {
      const el = $(doc, sel);
      if (!el) continue;
      click(el);
      for (const b of $$(doc, "#drawer button, #drawer a")) if (b.id !== "drawerClose") b.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
      key(win, doc.body, "Escape");
      key(win, el.isConnected ? el : doc.body, "Enter");
      click($(doc, "#drawerClose"));
      click($(doc, "#scrim"));
    }
    const bar = $(doc, "#view .bar");
    if (bar) {
      bar.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true, clientX: 10, clientY: 10 }));
      bar.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true, clientX: 12, clientY: 12 }));
      doc.body.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true }));
    }
    for (const t of $$(doc, "#tabs [data-tab]").map((b) => b.dataset.tab).concat("all")) click($(doc, `#tabs [data-tab="${t}"]`));
  }
  click($(doc, "#fileBtn"));
  for (const item of $$(doc, '#fileMenu [role="menuitem"]')) {
    if (item.dataset.act === "clear") continue;
    click($(doc, "#fileBtn"));
    click(item);
  }
  const auto = $(doc, "#autoRefresh");
  click(auto);
  click(auto);
  for (const id of ["reloadBtn", "themeBtn", "themeBtn", "printBtn"]) click($(doc, "#" + id));
  for (const k of ["r", "p", "o", "O", "Escape"]) key(win, doc.body, k);
  win.dispatchEvent(new win.Event("beforeprint"));
  win.dispatchEvent(new win.Event("afterprint"));
  win.dispatchEvent(new win.Event("resize"));
  for (let i = 0; i < doc.querySelectorAll("button").length; i++) {
    const b = doc.querySelectorAll("button")[i];
    if (b.dataset.act !== "clear") click(b);
  }
}

const statuses = (runs) => runs.flatMap((r) => r.tickets.map((t) => `${r.name}/${t.id}=${t.status}/${t.cat}`));

test("AC-4: exercising every control leaves every ticket status in the store unchanged and adds no data-edit", () => {
  for (const files of [BEAM, TWO_RUNS]) {
    const { dom, win, doc, app, errors } = module_(files);
    const runs = app.store.getRuns();
    const tickets = runs.flatMap((r) => r.tickets);
    const before = statuses(runs);
    exercise(win, doc);
    assert.equal(app.store.getRuns(), runs, "the store still holds the loaded runs");
    assert.deepEqual(statuses(app.store.getRuns()), before);
    assert.equal(doc.querySelectorAll("[data-edit]").length, 0);
    assert.equal(/data-edit/.test(doc.documentElement.outerHTML), false);

    $(doc, '[data-act="clear"]').click();
    assert.equal(app.store.getRuns().length, 0);
    assert.equal($(doc, "#emptyState").hidden, false);
    assert.deepEqual(statuses(runs), before, "closing the files does not touch a ticket");
    assert.equal(tickets.every((t) => runs.some((r) => r.tickets.includes(t))), true);
    assert.deepEqual(errors, []);
    dom.window.close();
  }
});

test("AC-4: Clear disarms the embedded load — reload is disabled and does nothing until files are opened again", async () => {
  const { dom, doc, app, errors } = module_(BEAM);
  assert.equal($(doc, "#reloadBtn").disabled, false, "an embedded page can reload");
  $(doc, '[data-act="clear"]').click();
  assert.equal(app.store.getRuns().length, 0);
  assert.equal(app.store.state.embedded, null, "clear drops the embedded load");
  assert.equal($(doc, "#reloadBtn").disabled, true, "nothing left to reload");
  assert.equal(await app.reload(), false, "reload after clear does not re-read the embedded files");
  assert.equal(app.store.getRuns().length, 0);
  assert.deepEqual(errors, []);
  dom.window.close();
});

test("AC-4: the built viewer, every control exercised — table statuses unchanged, no data-edit", () => {
  const { dom, win, doc, errors } = bundle(BEAM);
  const rows = () => {
    view(doc, "table");
    return $$(doc, "#view tr.trow").map((r) => `${r.dataset.run}/${r.dataset.id}=${$(r, ".chipst").textContent}`).sort();
  };
  const before = rows();
  assert.equal(before.length, 16);
  exercise(win, doc);
  assert.deepEqual(rows(), before);
  assert.equal(doc.querySelectorAll("[data-edit]").length, 0);
  assert.equal(/data-edit/.test(html), false, "the built file has no data-edit anywhere");
  assert.deepEqual(errors, []);
  dom.window.close();
});

// ---- AC-5 ----------------------------------------------------------------------------------------

const tlWidth = (doc) => int(/width:(\d+)px/.exec($(doc, "#view .tl").getAttribute("style"))[1]);
const trackWidth = (doc) => int(/width:(\d+)px/.exec($(doc, "#view .tl-track").getAttribute("style"))[1]);

test("AC-5: beforeprint fits the swimlane to 1020 px with the label column; afterprint restores the zoomed width", () => {
  for (const make of [() => bundle(BEAM), () => module_(BEAM)]) {
    const { dom, win, doc, errors } = make();
    view(doc, "timeline");
    const z = $(doc, "#zoom");
    z.value = "100";
    fire(win, z, "input");
    const zoomed = tlWidth(doc);
    const util = $(doc, "#util");
    assert.equal(util.open, false);

    win.dispatchEvent(new win.Event("beforeprint"));
    const span = swimlaneScale({ span: 59 }).span;
    const pph = (PRINT_W - LABEL_W) / span;
    const hours = Math.ceil(span * pph);
    assert.equal(hours + LABEL_W, PRINT_W, "hour axis plus the label column is 1020 px");
    assert.equal(trackWidth(doc), hours + 16);
    assert.equal(tlWidth(doc), PRINT_W + 16, "the swimlane is 1020 px plus its 16 px end pad");
    assert.notEqual(tlWidth(doc), zoomed);
    assert.equal(util.open, true, "utilization opens for print");

    win.dispatchEvent(new win.Event("afterprint"));
    assert.equal(tlWidth(doc), zoomed, "afterprint restores the zoomed width");
    assert.equal(util.open, false);
    assert.deepEqual(errors, []);
    dom.window.close();
  }
});

test("AC-5: print fit ignores zoom, and beforeprint on another view leaves it alone", () => {
  const { dom, win, doc, app } = module_(BEAM);
  const widths = [];
  const zoomed = [];
  for (const n of ["0", "100"]) {
    const z = $(doc, "#zoom");
    z.value = n;
    fire(win, z, "input");
    zoomed.push(tlWidth(doc));
    win.dispatchEvent(new win.Event("beforeprint"));
    widths.push(tlWidth(doc));
    win.dispatchEvent(new win.Event("afterprint"));
    assert.equal(tlWidth(doc), zoomed[zoomed.length - 1]);
  }
  assert.deepEqual(widths, [PRINT_W + 16, PRINT_W + 16]);
  assert.ok(zoomed[1] > zoomed[0], "zoom widens the swimlane");
  view(doc, "table");
  win.dispatchEvent(new win.Event("beforeprint"));
  assert.equal(app.store.state.printing, false, "only the swimlane is refitted");
  assert.ok($(doc, "#view table.grid"));
  win.dispatchEvent(new win.Event("afterprint"));
  view(doc, "timeline");
  assert.equal(tlWidth(doc), zoomed[1]);
  dom.window.close();
});

// ---- AC-6 ----------------------------------------------------------------------------------------

for (const [name, files] of Object.entries(FIXTURES)) {
  test(`AC-6: ${name} — the built page loads it and every pane agrees`, () => {
    const { dom, win, doc, errors } = bundle(files);
    assert.equal($(doc, "#app").hidden, false);
    assert.equal($(doc, "#emptyState").hidden, true);
    const p = panes(win, doc);
    assertAgree(p, name);
    const statusesOk = $$(doc, "#view tr.trow .chipst").every((c) => {
      const st = c.textContent.replace(/ /g, "_");
      return (CATEGORIES[st] || "todo") === catOfVar(c.getAttribute("style"));
    });
    assert.ok(statusesOk, "every row's color is its status category");
    assert.deepEqual(errors, []);
    dom.window.close();
  });
}

test("AC-6: the empty page shows the empty state, and opening nothing keeps it", () => {
  const { dom, doc, errors } = bundle([]);
  assert.equal($(doc, "#emptyState").hidden, false);
  assert.equal($(doc, "#app").hidden, true);
  assert.match($(doc, "#meta").textContent, /No run loaded/);
  assert.equal($(doc, "#reloadBtn").disabled, true);
  assert.deepEqual(errors, []);
  dom.window.close();
});
