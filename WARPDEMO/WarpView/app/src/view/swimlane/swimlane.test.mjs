import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildRuns, runFromBeam } from "../../load/parse/parse.mjs";
import { plan, layoutPlan, layoutActual } from "../../model/plan/plan.mjs";
import {
  barColor,
  gateLabels,
  gateTooltip,
  renderSwimlane,
  renderSwimlanePanel,
  swimlaneNote,
  swimlaneScale,
  tooltipFor,
} from "./swimlane.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PACK = join(here, "../../../..");
const load = (p) => JSON.parse(readFileSync(join(PACK, p), "utf8"));
const SNAP = join(here, "snapshots");

// The screens are 1600 px viewports; the swimlane view sits inside 20 px gutters.
const VIEW_W = 1560;
const NOW = Date.parse("2026-10-12T20:00:00Z");
const CATEGORIES = load("fixtures/expected/categories.json");

function sampleRun() {
  const { runs } = buildRuns(
    [
      { path: ".warp/beam.json", data: load("fixtures/beam.sample.json"), modified: NOW },
      { path: ".warp/tickets/WV-11/state.json", data: load("fixtures/tickets/WV-11/state.json"), modified: NOW },
    ],
    { repo: "smlsr/WarpDemo", jiraSite: "example.atlassian.net" },
  );
  return plan(runs[0]);
}

const refCache = new Map();
async function referenceTl(clock) {
  if (refCache.has(clock)) return refCache.get(clock);
  const html = readFileSync(join(PACK, `ui/screens/swimlane-${clock}.html`), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    // an http origin gives the page localStorage, where the screen's preset stores its clock
    url: "http://localhost/reference.html",
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      Object.defineProperty(w.HTMLElement.prototype, "clientWidth", { get() { return this.id === "view" ? VIEW_W : 1600; } });
    },
  });
  for (let i = 0; i < 50 && !dom.window.document.querySelector(".tl .bar"); i++) await new Promise((r) => setTimeout(r, 20));
  const tl = dom.window.document.querySelector(".tl");
  assert.ok(tl, `reference swimlane-${clock} drew a swimlane`);
  refCache.set(clock, tl);
  return tl;
}

const parse = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const px = (el, prop) => parseFloat(el.style.getPropertyValue(prop));
const classes = (el) => [...el.classList].sort();

function picture(tl) {
  const head = tl.querySelector(".tl-head");
  const body = tl.querySelector(".tl-body");
  const rows = [...body.children].filter((el) => el.classList.contains("tl-row"));
  const bars = [];
  rows.forEach((row, r) =>
    row.querySelectorAll(".bar").forEach((b) =>
      bars.push({
        id: b.dataset.id,
        row: r,
        left: px(b, "left"),
        width: px(b, "width"),
        cls: classes(b),
        color: b.style.getPropertyValue("--c").trim(),
        id1: b.querySelector(".id").textContent,
        sz: b.querySelector(".sz") ? b.querySelector(".sz").textContent : null,
        tt: b.querySelector(".tt") ? b.querySelector(".tt").textContent : null,
      }),
    ),
  );
  return {
    width: px(tl, "width"),
    rowLabels: rows.map((r) => r.querySelector(".tl-lab").textContent),
    axis: [...head.querySelectorAll(".tl-axis span")].map((s) => ({ text: s.textContent, left: px(s, "left") })),
    gates: [...head.querySelectorAll(".gl")].map((g) => ({
      text: g.firstChild.textContent,
      name: g.querySelector("small") ? g.querySelector("small").textContent : "",
      left: px(g, "left"),
      lift: g.getAttribute("style").includes("bottom:17px"),
      cls: classes(g),
      title: g.getAttribute("title"),
    })),
    glines: [...body.querySelectorAll(".gline")].map((g) => ({ left: px(g, "left"), cls: classes(g) })),
    grid: [...body.querySelectorAll(".grid-v")].map((g) => px(g, "left")),
    now: body.querySelector(".nowline") ? px(body.querySelector(".nowline"), "left") : null,
    bars,
  };
}

function assertParity(mine, ref) {
  assert.equal(mine.width, ref.width, "swimlane width");
  assert.deepEqual(mine.rowLabels, ref.rowLabels, "same rows");
  assert.deepEqual(mine.axis.map((a) => a.text), ref.axis.map((a) => a.text), "axis labels");
  mine.axis.forEach((a, i) => assert.ok(Math.abs(a.left - ref.axis[i].left) <= 1, `axis ${a.text}`));
  assert.deepEqual(mine.gates.map((g) => [g.text, g.name, g.lift, g.cls]), ref.gates.map((g) => [g.text, g.name, g.lift, g.cls]), "gate labels");
  mine.gates.forEach((g, i) => {
    assert.ok(Math.abs(g.left - ref.gates[i].left) <= 1, `gate ${g.text} position`);
    assert.equal(g.title, ref.gates[i].title, `gate ${g.text} tooltip`);
  });
  assert.deepEqual(mine.glines.map((g) => g.cls), ref.glines.map((g) => g.cls), "gate line colors");
  mine.glines.forEach((g, i) => assert.ok(Math.abs(g.left - ref.glines[i].left) <= 1, "gate line position"));
  assert.equal(mine.grid.length, ref.grid.length, "grid lines");
  assert.equal(mine.now == null, ref.now == null, "now line presence");
  if (ref.now != null) assert.ok(Math.abs(mine.now - ref.now) <= 1, "now line position");
  assert.equal(mine.bars.length, ref.bars.length, "bar count");
  const byId = new Map(ref.bars.map((b) => [b.id, b]));
  for (const b of mine.bars) {
    const r = byId.get(b.id);
    assert.ok(r, `${b.id} drawn by the reference`);
    assert.equal(b.row, r.row, `${b.id} row`);
    assert.ok(Math.abs(b.left - r.left) <= 1, `${b.id} left ${b.left} vs ${r.left}`);
    assert.ok(Math.abs(b.width - r.width) <= 1, `${b.id} width ${b.width} vs ${r.width}`);
    assert.deepEqual(b.cls, r.cls, `${b.id} classes`);
    assert.equal(b.color, r.color, `${b.id} color`);
    assert.equal(b.id1, r.id1, `${b.id} id text`);
    if (!b.cls.includes("tiny")) {
      assert.equal(b.sz, r.sz, `${b.id} size·hours`);
      assert.equal(b.tt, r.tt, `${b.id} title`);
    }
  }
}

test("AC-1: sample beam at 1600 px with layoutPlan matches swimlane-plan.png: rows, bars to 1 px, gates G0–G3, status colors", async () => {
  const run = sampleRun();
  const lay = layoutPlan(run);
  const html = renderSwimlane(run, lay, { width: VIEW_W });
  const mine = picture(parse(html).querySelector(".tl"));
  assertParity(mine, picture(await referenceTl("plan")));

  assert.deepEqual(mine.rowLabels, ["Slot 1", "Slot 2", "Slot 3", "Slot 4", "Slot 5", "Slot 6"]);
  assert.deepEqual(mine.gates.map((g) => g.text), ["G0", "G1", "G2", "G3"]);
  assert.deepEqual(mine.gates.map((g) => g.cls.join(" ")), ["gl green", "gl green", "gl", "gl"]);

  const exp = load("fixtures/expected/view.plan.json");
  const pph = (VIEW_W - 76 - 24) / 60;
  for (const b of mine.bars) {
    const e = exp.tickets[b.id];
    assert.equal(b.row, e.slot, `${b.id} slot`);
    assert.ok(Math.abs(b.left - (e.start * pph + 1)) <= 1, `${b.id} at T+${e.start}`);
    assert.ok(Math.abs(b.width - ((e.end - e.start) * pph - 2)) <= 1, `${b.id} width`);
  }
  for (const [k, at] of Object.entries(exp.gateAt)) {
    const g = mine.gates.find((x) => x.text === k);
    assert.ok(Math.abs(g.left - at * pph) <= 1, `${k} line at T+${at}`);
  }
  for (const t of run.tickets) {
    const b = mine.bars.find((x) => x.id === t.id);
    const cat = CATEGORIES[t.status] || "todo";
    assert.ok(b.cls.includes("c-" + cat), `${t.id} ${t.status} is ${cat}`);
    assert.equal(b.color, `var(--c-${cat})`);
  }
  assert.equal(mine.bars.find((b) => b.id === "WV-11").color, "var(--c-prog)", "state.json overlay colors WV-11 as coding");
  assert.ok(mine.bars.find((b) => b.id === "WV-09").cls.includes("crit"));
  assert.equal(mine.bars.find((b) => b.id === "WV-09").id1, "★ WV-09");
  assert.equal(mine.bars.find((b) => b.id === "WV-09").sz, "XL·16h");
});

test("AC-2: actual clock at the expected now matches swimlane-actual.png with the dashed now line", async () => {
  const run = sampleRun();
  const lay = layoutActual(run, NOW);
  const html = renderSwimlane(run, lay, { width: VIEW_W });
  const doc = parse(html);
  const mine = picture(doc.querySelector(".tl"));
  assertParity(mine, picture(await referenceTl("actual")));

  const exp = load("fixtures/expected/view.actual.json");
  const pph = (VIEW_W - 76 - 24) / (Math.ceil(exp.span / 5) * 5);
  assert.equal(mine.rowLabels.length, exp.rows);
  assert.ok(mine.rowLabels.every((l, i) => l === `Agent ${i + 1}`));
  assert.equal(mine.axis[0].text, "+0");
  assert.equal(mine.bars.length, exp.items.length);
  for (const e of exp.items) {
    const b = mine.bars.find((x) => x.id === e.id);
    assert.equal(b.row, e.row, `${e.id} row`);
    assert.ok(Math.abs(b.left - (e.s * pph + 1)) <= 1, `${e.id} start`);
  }
  assert.deepEqual(mine.gates.map((g) => g.text), exp.gates.map((g) => g.key));
  const nowEl = doc.querySelector(".nowline");
  assert.ok(nowEl, "now line drawn");
  assert.ok(Math.abs(mine.now - exp.now * pph) <= 1, "now line at +30h");
  const css = readFileSync(join(here, "swimlane.css"), "utf8");
  assert.match(css, /\.nowline\s*\{[^}]*border-left:\s*2px dashed var\(--c-prog\)/);
  assert.equal(mine.bars.find((b) => b.id === "WV-09").sz, "20.7h");
  assert.equal(swimlaneNote(run, lay, "actual"), "6 agents in use · 14 started · 2 not started · now +30h");
});

function boxes(labels) {
  // lower label: band A; a name adds band B; a lifted label sits in band B.
  return labels.map((l) => ({ text: l.text, left: l.x - l.w, right: l.x, bands: l.lift ? ["B"] : l.name ? ["A", "B"] : ["A"] }));
}
function overlaps(labels) {
  const bs = boxes(labels);
  const out = [];
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      if (a.bands.some((x) => b.bands.includes(x)) && a.left < b.right && b.left < a.right) out.push(`${a.text} / ${b.text}`);
    }
  return out;
}

test("AC-3: two gates reached at the same hour share one label 'G1 · G2' and no labels overlap at any zoom 0–100", () => {
  const g = (key, at, status = "pending", name = "") => ({ k: key, at, g: { key, name, status, blocking: true, checks: [] } });
  const lay = {
    prefix: "T+",
    label: "Slot",
    rows: 1,
    span: 60,
    now: null,
    items: [],
    gates: [g("G0", 4, "green", "Skeleton builds"), g("G1", 22, "green", "Data"), g("G2", 22, "pending", "Panes"), g("G3", 59, "pending", "Ship")],
  };
  for (let zoom = 0; zoom <= 100; zoom++) {
    const html = renderSwimlane({ name: "t", tickets: [] }, lay, { width: VIEW_W, zoom });
    const doc = parse(html);
    const texts = [...doc.querySelectorAll(".gl")].map((el) => el.firstChild.textContent);
    assert.equal(texts.filter((t) => t === "G1 · G2").length, 1, `zoom ${zoom}: one shared label`);
    assert.ok(!texts.includes("G1") && !texts.includes("G2"), `zoom ${zoom}: no separate G1 or G2`);
    assert.equal(doc.querySelectorAll(".gline").length, 3, `zoom ${zoom}: G1 and G2 share one line`);
    const { pph } = swimlaneScale(lay, { width: VIEW_W, zoom });
    assert.deepEqual(overlaps(gateLabels(lay.gates, pph)), [], `zoom ${zoom}`);
  }
  const shared = [...parse(renderSwimlane({ tickets: [] }, lay, { width: VIEW_W })).querySelectorAll(".gl")].find((el) => el.firstChild.textContent === "G1 · G2");
  assert.ok(!shared.classList.contains("green"), "G1 green + G2 pending is not drawn green");
  assert.match(shared.getAttribute("title"), /^G1 Data — green[\s\S]*\n\nG2 Panes — pending/);

  const crowd = {
    span: 200,
    gates: [
      g("G0", 10, "green", "Skeleton builds"),
      g("G1", 11, "green", "Data and model match the reference"),
      g("G2", 12, "red", "Panes agree"),
      g("G-RBAC", 12.6, "pending", "Role based access control"),
      g("G3", 13.5, "pending", "Ship"),
      g("G4", 14, "pending", "Docs"),
      g("G5", 40, "pending", "Release candidate"),
      g("G6", 41, "pending", "Release"),
    ],
  };
  for (const width of [390, 900, VIEW_W]) {
    for (let zoom = 0; zoom <= 100; zoom++) {
      const { pph } = swimlaneScale(crowd, { width, zoom });
      const labels = gateLabels(crowd.gates, pph);
      assert.deepEqual(overlaps(labels), [], `width ${width} zoom ${zoom}`);
      const keys = labels.flatMap((l) => l.items.map((x) => x.k));
      assert.deepEqual(keys.slice().sort(), crowd.gates.map((x) => x.k).sort(), `width ${width} zoom ${zoom}: every gate keeps a label`);
    }
  }
  const { pph } = swimlaneScale(crowd, { width: VIEW_W, zoom: 0 });
  const html = renderSwimlane({ tickets: [] }, { ...crowd, rows: 1 }, { width: VIEW_W, zoom: 0 });
  assert.equal(parse(html).querySelectorAll(".gl").length, gateLabels(crowd.gates, pph).length);
  assert.ok(parse(html).querySelector(".gline.red"), "a red gate line is drawn red");
});

test("AC-4: a bar under 70 px shows only its id; a search hit gets the outline and every other bar is dimmed", () => {
  const run = sampleRun();
  const lay = layoutActual(run, NOW);
  const plain = parse(renderSwimlane(run, lay, { width: VIEW_W }));
  const wv01 = plain.querySelector('.bar[data-id="WV-01"]');
  assert.ok(px(wv01, "width") < 70, "WV-01 is narrower than 70 px on the actual clock");
  assert.ok(wv01.classList.contains("tiny"));
  assert.equal(wv01.textContent.trim(), "★ WV-01", "only the id shows");
  assert.equal(wv01.querySelector(".sz"), null);
  assert.equal(wv01.querySelector(".tt"), null);
  assert.equal(plain.querySelectorAll(".bar.dim, .bar.hit").length, 0, "no search: nothing dimmed or outlined");

  const doc = parse(renderSwimlane(run, lay, { width: VIEW_W, query: "wv-01" }));
  const bars = [...doc.querySelectorAll(".bar")];
  const hit = doc.querySelector('.bar[data-id="WV-01"]');
  assert.ok(hit.classList.contains("hit") && hit.classList.contains("tiny"));
  assert.ok(!hit.classList.contains("dim"));
  for (const b of bars.filter((x) => x !== hit)) assert.ok(b.classList.contains("dim") && !b.classList.contains("hit"), `${b.dataset.id} dimmed`);

  const css = readFileSync(join(here, "swimlane.css"), "utf8");
  assert.match(css, /\.bar\.hit\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  assert.match(css, /\.bar\.dim\s*\{\s*opacity:\s*\.14;/);

  const off = parse(renderSwimlane(run, lay, { width: VIEW_W, off: new Set(["done"]) }));
  for (const b of off.querySelectorAll(".bar.c-done")) assert.ok(b.classList.contains("dim"), "filtered-out category is dimmed");
  assert.equal(off.querySelectorAll(".bar.hit").length, 0, "a category filter alone does not outline");

  const tinyRun = { name: "t", tickets: [] };
  const t = { id: "X-1", title: "Narrow <b>bar</b>", status: "alarm", cat: "err", size: "S", hours: 4, alarm: "lock-escape", pr: { ci: "red" } };
  const one = parse(renderSwimlane(tinyRun, { rows: 1, span: 100, items: [{ t, row: 0, s: 0, e: 1, sz: true }], gates: [] }, { width: 800 }));
  const bar = one.querySelector(".bar");
  assert.ok(bar.classList.contains("tiny"));
  assert.equal(bar.textContent, "X-1");
  assert.equal(one.querySelector(".flag"), null);
  const wide = parse(renderSwimlane(tinyRun, { rows: 1, span: 10, items: [{ t, row: 0, s: 0, e: 8, sz: true }], gates: [] }, { width: 800 }));
  assert.equal(wide.querySelector(".flag").textContent, "⚠", "alarm flag on a wide bar");
  assert.equal(wide.querySelector(".tt").innerHTML, "Narrow &lt;b&gt;bar&lt;/b&gt;", "titles are escaped");
});

test("AC-5: a run with zero tickets renders one empty slot row and the axis, and nothing throws", () => {
  const run = plan(runFromBeam({ run: "empty", tickets: {}, gates: [] }, ".warp/beam.json", NOW));
  for (const lay of [layoutPlan(run), layoutActual(run, NOW)]) {
    let html;
    assert.doesNotThrow(() => {
      html = renderSwimlanePanel(run, lay, { width: VIEW_W });
    });
    const doc = parse(html);
    const rows = [...doc.querySelector(".tl-body").children].filter((el) => el.classList.contains("tl-row"));
    assert.equal(rows.length, 1, "one slot row");
    assert.equal(rows[0].querySelectorAll(".bar").length, 0);
    assert.match(rows[0].querySelector(".tl-lab").textContent, /^(Slot|Agent) 1$/);
    const axis = [...doc.querySelectorAll(".tl-axis span")].map((s) => s.textContent);
    assert.ok(axis.length >= 2, "the axis renders");
    assert.equal(axis[0], lay.prefix + "0");
  }
  assert.doesNotThrow(() => renderSwimlane({}, null, {}));
  assert.doesNotThrow(() => renderSwimlane({ tickets: [] }, { rows: 0, span: NaN, items: [null, { row: 0 }], gates: [null, { k: "G0", at: NaN }] }, { width: -5, zoom: 900 }));
  assert.equal(swimlaneNote(run, layoutPlan(run), "plan"), "0 of 18 slots · planned finish T+0h · blocks finish in order");
});

function snapshot(name, html) {
  const file = join(SNAP, name);
  if (process.env.UPDATE_SNAPSHOTS) {
    mkdirSync(SNAP, { recursive: true });
    writeFileSync(file, html);
  }
  assert.ok(existsSync(file), `${name} snapshot exists (UPDATE_SNAPSHOTS=1 writes it)`);
  assert.equal(html, readFileSync(file, "utf8"), `${name} snapshot`);
}

test("AC-6: swimlane HTML snapshots for the expected plan and actual layouts", () => {
  const run = sampleRun();
  snapshot("plan.html", renderSwimlanePanel(run, layoutPlan(run), { width: VIEW_W, clock: "plan" }) + "\n");
  snapshot("actual.html", renderSwimlanePanel(run, layoutActual(run, NOW), { width: VIEW_W, clock: "actual" }) + "\n");
});

test("AC-6: zoom fits to width times 6^(zoom/100), print fits 1020 px, ticks stay 56 px apart", () => {
  const lay = { span: 59 };
  const fit = (VIEW_W - 76 - 24) / 60;
  assert.equal(swimlaneScale(lay, { width: VIEW_W, zoom: 0 }).pph, fit);
  assert.ok(Math.abs(swimlaneScale(lay, { width: VIEW_W, zoom: 100 }).pph - fit * 6) < 1e-9);
  assert.ok(Math.abs(swimlaneScale(lay, { width: VIEW_W, zoom: 50 }).pph - fit * Math.sqrt(6)) < 1e-9);
  assert.equal(swimlaneScale(lay, { width: 390, narrow: true }).pph, 7, "phone: at least 7 px per hour");
  assert.equal(swimlaneScale(lay, { width: 390, narrow: true }).lab, 54);
  const print = swimlaneScale(lay, { width: VIEW_W, zoom: 80, print: true });
  assert.equal(print.pph, (1020 - 76) / 60);
  assert.equal(print.W + print.lab, Math.ceil(60 * print.pph) + 16 + 76);
  for (let zoom = 0; zoom <= 100; zoom += 5) {
    const s = swimlaneScale({ span: 177 }, { width: VIEW_W, zoom });
    assert.ok(s.step * s.pph >= 56, `zoom ${zoom}`);
    const smaller = [1, 2, 5, 10, 20, 25, 50, 100, 200].filter((x) => x < s.step);
    assert.ok(smaller.every((x) => x * s.pph < 56), `zoom ${zoom}: the first step that fits`);
  }
});

test("AC-6: panel header carries the Plan/Actual toggle and the note; a schedule plan says 'as written in schedule.json'", () => {
  const run = sampleRun();
  const doc = parse(renderSwimlanePanel(run, layoutPlan(run), { width: VIEW_W }));
  assert.equal(doc.querySelector(".panel-h .muted").textContent, "6 of 18 slots · planned finish T+59h · as written in schedule.json");
  assert.equal(doc.querySelector('[data-clock="plan"]').className, "on");
  assert.equal(doc.querySelector('[data-clock="plan"]').getAttribute("aria-pressed"), "true");
  assert.equal(doc.querySelector('[data-clock="actual"]').getAttribute("aria-pressed"), "false");
  assert.match(doc.querySelector(".tl-foot").textContent, /^Estimate-hours on a continuous clock/);
  const act = parse(renderSwimlanePanel(run, layoutActual(run, NOW), { width: VIEW_W, clock: "actual" }));
  assert.equal(act.querySelector('[data-clock="actual"]').className, "on");
  assert.match(act.querySelector(".tl-foot").textContent, /^Hours since the run started/);
  const deps = { ...run, planSource: "simulated", kind: "beam", gateOrder: "deps" };
  assert.match(swimlaneNote(deps, null, "plan"), / · dependency order$/);
});

test("AC-6: tooltips, color by lane and escaping of every file value", () => {
  const run = sampleRun();
  const t = run.tickets.find((x) => x.id === "WV-14");
  const tip = tooltipFor(t);
  assert.match(tip, /^<b>WV-14<\/b> · alarm<br>Filters, search/);
  assert.match(tip, /M · est 7h · T\+22→29h · G2/);
  assert.match(tip, /<br>⚠ lock-escape: wrote/);
  const crit = tooltipFor(run.tickets.find((x) => x.id === "WV-01"));
  assert.match(crit, /^<b>★ WV-01<\/b> · done/);
  assert.match(crit, /PR #42 · WAR-101/);

  const g2 = run.gates.find((g) => g.key === "G2");
  const gt = gateTooltip({ k: "G2", g: g2 }).split("\n");
  assert.equal(gt[0], "G2 Panes agree — pending");
  assert.ok(gt.includes("blocking: a red gate stops everyone"));
  assert.ok(gt.includes("priority gate: its path dispatches ahead of rank"));
  assert.ok(gt.includes("starts: WarpEdit"));
  assert.ok(gt.some((l) => l.startsWith("on green: ")));
  assert.ok(gt.some((l) => l.startsWith("if red: WarpEdit starts after")));
  assert.equal(gt.filter((l) => l.startsWith("check: ")).length, 3);
  const scoped = gateTooltip({ k: "G-RBAC", g: { name: "RBAC", status: "pending", blocking: false, scope: "Demo-UI" } });
  assert.equal(scoped, "G-RBAC RBAC — pending\nscope: Demo-UI");

  const lane = barColor({ lane: "console", module: "WarpView", layer: "ui" }, "lane");
  const mod = barColor({ lane: "console", module: "WarpView", layer: "ui" }, "module");
  assert.notEqual(lane, mod);
  assert.equal(barColor({ module: "WarpView", layer: "ui" }, "lane"), mod, "no lane: the module's hue");
  assert.equal(barColor({ cat: "qa" }, "status"), "var(--c-qa)");
  const doc = parse(renderSwimlane(run, layoutPlan(run), { width: VIEW_W, colorBy: "lane" }));
  assert.match(doc.querySelector('.bar[data-id="WV-09"]').style.getPropertyValue("--c"), /^hsl\(/);

  const evil = '"><img src=x onerror=alert(1)>';
  const bad = { name: evil, tickets: [] };
  const item = { t: { id: evil, title: evil, status: evil, cat: "todo", size: evil, hours: 4, pr: {} }, row: 0, s: 0, e: 10, sz: true };
  const gate = { k: evil, at: 5, g: { key: evil, name: evil, status: evil, checks: [evil] } };
  const html = renderSwimlanePanel(bad, { prefix: "T+", label: evil, rows: 1, span: 20, items: [item], gates: [gate] }, { width: 900, title: evil });
  const out = parse(html);
  assert.equal(out.querySelector("img"), null, "no injected element");
  assert.equal(out.querySelector(".bar").dataset.id, evil);
  assert.equal(out.querySelector(".bar").dataset.run, evil);
  assert.ok(!/<img/i.test(tooltipFor(item.t)));
});

test("AC-6: swimlaneOverlays render inside the body with the scale", () => {
  const run = sampleRun();
  const seen = [];
  const overlays = [{ id: "ov", render: (lay, r, o) => (seen.push([lay.rows, r.name, o.scale.pph]), '<b class="ov-mark">x</b>') }, { id: "none", render: () => "" }];
  const doc = parse(renderSwimlane(run, layoutPlan(run), { width: VIEW_W, overlays }));
  assert.ok(doc.querySelector('.tl-body .tl-overlay[data-overlay="ov"] .ov-mark'));
  assert.equal(doc.querySelector('[data-overlay="none"]'), null);
  assert.deepEqual(seen, [[6, "view", (VIEW_W - 100) / 60]]);
});
