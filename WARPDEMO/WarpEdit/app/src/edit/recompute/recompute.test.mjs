import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "../../../build.mjs";
import { createApp } from "../../../../../WarpView/app/src/main.mjs";
import { computeMetrics, utilization } from "../../../../../WarpView/app/src/model/metrics/metrics.mjs";
import { renderCards, renderUtil } from "../../../../../WarpView/app/src/view/header/header.mjs";
import { renderLegend } from "../../../../../WarpView/app/src/view/controls/controls.mjs";
import { buildRuns } from "../../../../../WarpView/app/src/load/parse/parse.mjs";
import { prepareRun } from "../../../../../WarpView/app/src/store/store.mjs";
import { withData } from "../../../test/dom.mjs";
import { createEditStore } from "../store/store.mjs";
import { buildReset, applyReset } from "../reset/reset.mjs";
import { planDependents } from "../dependents/dependents.mjs";
import { targetsFrom } from "../phases/phases.mjs";
import {
  EDIT_REASON,
  PENDING_EDITED,
  createRecomputePlugin,
  docsWith,
  editedGates,
  markEditedGates,
  rebuild,
  renderPendingGates,
} from "./recompute.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..", "..", "..", "..");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const load = () => json(join(PACK, "fixtures", "beam.sample.json"));
const AFTER = json(join(PACK, "fixtures", "expected", "after-reset.metrics.json"));
const BEFORE = json(join(PACK, "fixtures", "expected", "before-reset.metrics.json"));
const NOW = Date.parse("2026-10-12T20:00:00Z");
const AT = "2026-10-12T19:30:00Z";
const PATH = ".warp/beam.json";

function resetOf(beam, id, to, note = "flaky test") {
  const built = buildReset(beam, id, to, note, AT);
  assert.equal(built.ok, true, built.message);
  built.change.dependents = planDependents(beam, id, built.change.from, to).dependents;
  return built.change;
}

const prepared = (runs) => runs.map(prepareRun);

let html;
before(async () => {
  const tmp = mkdtempSync(join(tmpdir(), "we11-"));
  const out = join(tmp, "editor.html");
  await build({ noPlugins: true, out });
  html = readFileSync(out, "utf8");
  return () => rmSync(tmp, { recursive: true, force: true });
});

function mount({ view, groupBy, attach = true } = {}) {
  const dom = new JSDOM(withData(html, null), { pretendToBeVisual: true, url: "file:///editor.html" });
  const beam = load();
  const edit = createEditStore(beam, { applyChange: applyReset });
  const plugin = createRecomputePlugin({ store: attach ? edit : null });
  const app = createApp({ root: dom.window.document, plugins: [plugin], now: () => NOW });
  assert.ok(app.load([{ path: PATH, data: beam }], { quiet: true }) !== false);
  if (view || groupBy) app.store.set({ ...(view ? { view } : {}), ...(groupBy ? { groupBy } : {}) }, "view");
  return { dom, win: dom.window, doc: dom.window.document, app, edit, plugin, beam, S: app.store.state };
}

const legendCounts = (doc) =>
  Object.fromEntries([...doc.querySelectorAll("#legend .fchip")].map((b) => [b.dataset.cat, Number(b.querySelector(".n").textContent)]));
const BUCKET = { done: "done", err: "err", prog: "prog", rev: "prog", qa: "prog", todo: "todo" };
const buckets = (byCat) => {
  const out = { done: 0, prog: 0, err: 0, todo: 0 };
  for (const [k, n] of Object.entries(byCat)) out[BUCKET[k]] += n;
  return out;
};

// ---- AC-1 ------------------------------------------------------------------------------------------

test("AC-1: WV-07 reset to coding: the rebuilt runs' metrics equal after-reset.metrics.json", () => {
  const beam = load();
  const working = applyReset(beam, resetOf(beam, "WV-07", "coding"));
  const runs = prepared(rebuild({ docs: [{ path: PATH, data: beam }], loaded: beam, working }));
  assert.deepEqual(computeMetrics(runs, NOW), AFTER);
  assert.deepEqual(computeMetrics(prepared(rebuild({ docs: [{ path: PATH, data: beam }], loaded: beam, working: beam })), NOW), BEFORE);
});

test("AC-1: when the panes re-render, legend, cards and utilization equal after-reset.metrics.json", () => {
  const { doc, app, edit, beam, S } = mount();
  assert.deepEqual(buckets(legendCounts(doc)), BEFORE.count);
  let reasons = [];
  app.store.subscribe((_, r) => reasons.push(r));
  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.deepEqual(reasons, [EDIT_REASON]);

  const runs = app.store.getRuns();
  assert.deepEqual(buckets(legendCounts(doc)), AFTER.count);
  assert.equal(doc.querySelector("#legend").innerHTML, renderLegend(runs, S));
  assert.deepEqual(legendCounts(doc), { done: 11, err: 2, prog: 2, rev: 0, qa: 1, todo: 0 });

  assert.equal(doc.querySelector("#metrics").innerHTML, renderCards(AFTER, runs));
  const cards = doc.querySelectorAll("#metrics .card");
  assert.equal(cards.length, 4);
  assert.match(cards[2].querySelector(".foot").textContent, /Gates 2\/4 green/);
  assert.equal(cards[3].querySelector(".big").textContent, String(AFTER.ticketTotal));

  const u = utilization(runs);
  assert.equal(u.tokens, AFTER.tokens);
  assert.equal(u.spentH, AFTER.actualH);
  assert.equal(u.done, AFTER.count.done);
  assert.equal(u.total, AFTER.ticketTotal);
  assert.equal(u.active, AFTER.count.prog);
  assert.equal(doc.querySelector("#util").innerHTML, renderUtil(u));
  assert.match(doc.querySelector("#util summary").textContent, /^Utilization 3 active of 18 agents/);
});

test("AC-1: undo puts every pane back on before-reset.metrics.json, redo on after", () => {
  const { doc, app, edit, beam } = mount();
  const first = doc.querySelector("#metrics").innerHTML;
  edit.apply(resetOf(beam, "WV-07", "coding"));
  edit.undo();
  assert.deepEqual(computeMetrics(app.store.getRuns(), NOW), BEFORE);
  assert.equal(doc.querySelector("#metrics").innerHTML, first);
  edit.redo();
  assert.deepEqual(computeMetrics(app.store.getRuns(), NOW), AFTER);
});

test("AC-1: blocks, plan and the swimlane follow: WV-07's bar and G1's block reflect the reset", () => {
  const { doc, app, edit, beam } = mount({ view: "timeline" });
  edit.apply(resetOf(beam, "WV-07", "coding"));
  const run = app.store.getRuns()[0];
  const t = run.tickets.find((x) => x.id === "WV-07");
  assert.equal(t.status, "coding");
  assert.equal(t.cat, "prog");
  assert.equal(t.block, "G1");
  assert.equal(typeof t.start, "number");
  const bar = doc.querySelector('#view .bar[data-id="WV-07"]');
  assert.ok(bar, "WV-07 bar is drawn");
  assert.match(bar.getAttribute("style"), /var\(--c-prog\)/);
});

test("AC-1: a green gate whose member is no longer merged reads 'pending (edited)', and keeps Warp's status", () => {
  const { doc, app, edit, beam } = mount({ view: "board", groupBy: "block" });
  assert.equal(doc.querySelector("#actionsBar [data-hook='recompute']"), null);
  edit.apply(resetOf(beam, "WV-07", "coding"));
  const g1 = app.store.getRuns()[0].gates.find((g) => g.key === "G1");
  assert.equal(g1.status, "green");
  assert.equal(g1.edited, PENDING_EDITED);
  assert.deepEqual(g1.editedTickets, ["WV-07"]);
  assert.match(g1.evidence, /^pending \(edited\): WV-07 no longer merged/);
  assert.equal(app.store.getRuns()[0].gates.find((g) => g.key === "G0").edited, undefined);
  const note = doc.querySelector("#actionsBar [data-recompute='gate']");
  assert.ok(note);
  assert.equal(note.textContent, "G1 gate pending (edited) · WV-07 not merged");
  const pill = doc.querySelector('#view .lane[data-lane="G1"] .lane-h .pill[title]');
  assert.match(pill.getAttribute("title"), /pending \(edited\): WV-07 no longer merged/);

  edit.markSaved();
  assert.equal(doc.querySelector("#actionsBar [data-recompute='gate']"), null);
  assert.equal(app.store.getRuns()[0].gates.find((g) => g.key === "G1").edited, undefined);
});

// ---- AC-2 ------------------------------------------------------------------------------------------

const laneOf = (doc, key) => doc.querySelector(`#view .lane[data-lane="${key}"]`);
const progCards = (lane) => [...lane.querySelectorAll(".tcard")].filter((c) => /--c:var\(--c-prog\)/.test(c.getAttribute("style"))).length;
const clearedPill = (lane) => [...lane.querySelectorAll(".lane-h .pill")].some((p) => p.textContent === "cleared");

test("AC-2: board by block: G1 loses the cleared pill and shows one more in progress", () => {
  const { doc, edit, beam, S } = mount({ view: "board", groupBy: "block" });
  let lane = laneOf(doc, "G1");
  assert.ok(clearedPill(lane));
  assert.match(lane.querySelector(".stat").textContent, /7\/7 done/);
  const prog = progCards(lane);
  assert.equal(lane.querySelector('.stack i[title="In progress"]'), null);

  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.equal(S.view, "board");
  assert.equal(S.groupBy, "block");
  lane = laneOf(doc, "G1");
  assert.ok(!clearedPill(lane));
  assert.equal(lane.classList.contains("closed"), false);
  assert.match(lane.querySelector(".stat").textContent, /6\/7 done/);
  assert.equal(progCards(lane), prog + 1);
  const seg = lane.querySelector('.stack i[title="In progress"]');
  assert.ok(seg);
  assert.match(seg.getAttribute("style"), new RegExp(`width:${100 / 7}%`));
  const card = lane.querySelector('.tcard[data-id="WV-07"] .st');
  assert.equal(card.textContent.toLowerCase(), "coding");
});

test("AC-2: the other lanes follow the dependents: G3's WV-16 goes to blocked", () => {
  const { doc, edit, beam } = mount({ view: "board", groupBy: "block" });
  edit.apply(resetOf(beam, "WV-07", "coding"));
  const card = laneOf(doc, "G3").querySelector('.tcard[data-id="WV-16"]');
  assert.match(card.getAttribute("style"), /var\(--c-err\)/);
  assert.ok(clearedPill(laneOf(doc, "G0")));
});

// ---- AC-3 ------------------------------------------------------------------------------------------

function typeSearch(win, doc, text) {
  const q = doc.querySelector("#q");
  q.value = text;
  q.dispatchEvent(new win.Event("input", { bubbles: true }));
  return q;
}

test("AC-3: table sorted by Merged with a search typed: sort, search and scroll are kept across a reset", () => {
  const { win, doc, app, edit, beam, S } = mount({ view: "table" });
  doc.querySelector('#view th[data-sort="merged"]').click();
  doc.querySelector('#view th[data-sort="merged"]').click();
  assert.deepEqual(S.sort, { key: "merged", dir: -1 });
  const q = typeSearch(win, doc, "WV-");
  q.focus();
  assert.equal(S.q, "wv-");
  const wrap = doc.querySelector("#view .tbl-wrap");
  wrap.scrollTop = 240;
  wrap.scrollLeft = 30;
  const order = () => [...doc.querySelectorAll("#view tbody tr:not([hidden])")].map((r) => r.dataset.id);
  const before = order();

  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.equal(S.view, "table");
  assert.deepEqual(S.sort, { key: "merged", dir: -1 });
  assert.equal(S.q, "wv-");
  assert.equal(doc.querySelector("#q").value, "WV-");
  assert.equal(doc.activeElement, q);
  assert.equal(doc.querySelector('#view th[data-sort="merged"]').getAttribute("aria-sort"), "descending");
  const after = doc.querySelector("#view .tbl-wrap");
  assert.notEqual(after, wrap, "the table was re-rendered");
  assert.equal(after.scrollTop, 240);
  assert.equal(after.scrollLeft, 30);
  assert.deepEqual(order(), before, "pr.mergedAt is kept, so the Merged order is the same");
  const row = doc.querySelector('#view tr[data-id="WV-07"]');
  assert.equal(row.querySelector(".chipst").textContent.toLowerCase(), "coding");
  assert.equal(app.store.getRuns().length, 1);
});

test("AC-3: a search that hides rows still hides them after the reset, and filters and tab stay", () => {
  const { win, doc, edit, beam, S } = mount({ view: "table" });
  typeSearch(win, doc, "WV-07");
  doc.querySelector('#legend .fchip[data-cat="todo"]').click();
  const visible = () => [...doc.querySelectorAll("#view tbody tr:not([hidden])")].map((r) => r.dataset.id);
  assert.deepEqual(visible(), ["WV-07"]);
  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.deepEqual(visible(), ["WV-07"]);
  assert.ok(S.off.has("todo"));
  assert.equal(S.tab, "all");
  assert.equal(doc.querySelector('#legend .fchip[data-cat="todo"]').classList.contains("off"), true);
});

test("AC-3: swimlane zoom, clock and horizontal scroll are kept", () => {
  const { doc, app, edit, beam, S } = mount({ view: "timeline" });
  app.store.set({ zoom: 40, clock: "actual" }, "zoom");
  const sc = doc.querySelector("#view .tl-scroll");
  sc.scrollLeft = 120;
  sc.scrollTop = 15;
  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.equal(S.zoom, 40);
  assert.equal(S.clock, "actual");
  const now = doc.querySelector("#view .tl-scroll");
  assert.notEqual(now, sc);
  assert.equal(now.scrollLeft, 120);
  assert.equal(now.scrollTop, 15);
});

test("AC-3: a focused table row is focused again after the re-render", () => {
  const { doc, edit, beam } = mount({ view: "table" });
  doc.querySelector('#view tr[data-id="WV-10"]').focus();
  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.equal(doc.activeElement.dataset.id, "WV-10");
  assert.ok(doc.activeElement.isConnected);
});

test("AC-3: an open drawer shows the edited ticket after the reset", () => {
  const { doc, app, edit, beam } = mount({ view: "board" });
  app.openDrawer(app.store.getRuns()[0].name, "WV-07");
  const status = () => [...doc.querySelectorAll("#drawer dt")].find((dt) => dt.textContent === "Status").nextElementSibling.textContent;
  assert.match(status(), /^Completed · merged$/i);
  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.match(status(), /^In Progress · coding$/i);
});

// ---- AC-4 ------------------------------------------------------------------------------------------

const perTicket = (runs) => Object.fromEntries(runs.flatMap((r) => r.tickets).map((t) => [t.id, [t.tokens, t.minutes]]));

test("AC-4: every reset of every ticket to every allowed phase keeps total tokens and minutes", () => {
  const beam = load();
  const docs = [{ path: PATH, data: beam }];
  const base = prepared(rebuild({ docs, loaded: beam, working: beam }));
  const m0 = computeMetrics(base, NOW);
  const u0 = utilization(base);
  let n = 0;
  for (const [id, t] of Object.entries(beam.tickets)) {
    for (const to of targetsFrom(t.status)) {
      const working = applyReset(beam, resetOf(beam, id, to));
      const runs = prepared(rebuild({ docs, loaded: beam, working }));
      const m = computeMetrics(runs, NOW);
      const u = utilization(runs);
      assert.equal(m.tokens, m0.tokens, `${id} → ${to} tokens`);
      assert.equal(m.actualH, m0.actualH, `${id} → ${to} minutes`);
      assert.equal(m.cost, m0.cost, `${id} → ${to} cost`);
      assert.equal(u.tokens, u0.tokens);
      assert.equal(u.spentH, u0.spentH);
      assert.deepEqual(perTicket(runs), perTicket(base));
      n++;
    }
  }
  assert.ok(n > 150, `checked ${n} resets`);
  assert.equal(m0.tokens, AFTER.tokens);
  assert.equal(m0.actualH, AFTER.actualH);
});

test("AC-4: through the screens, apply, undo and redo never move the Tokens and Actual figures", () => {
  const { doc, edit, beam } = mount();
  const foot = () => doc.querySelectorAll("#metrics .card")[1].querySelector(".foot").textContent;
  const head = () => doc.querySelector("#util summary").textContent.replace(/^Utilization \d+ active/, "");
  const f0 = foot();
  const h0 = head();
  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.equal(foot(), f0);
  assert.equal(head(), h0);
  edit.apply(resetOf(edit.working, "WV-13", "queued"));
  assert.equal(foot(), f0);
  edit.undo();
  edit.undo();
  edit.redo();
  assert.equal(foot(), f0);
  assert.equal(head(), h0);
});

// ---- module behaviour ------------------------------------------------------------------------------

test("docsWith swaps the loaded beam and keeps every other doc as read", () => {
  const beam = load();
  const status = { path: ".warp/status.json", data: { done: [], working: [], left: [] } };
  const working = { ...beam };
  const out = docsWith([{ path: PATH, data: beam }, status], beam, working);
  assert.equal(out.path, PATH);
  assert.equal(out.docs[0].data, working);
  assert.equal(out.docs[1], status);
  const copy = JSON.parse(JSON.stringify(beam));
  const bySame = docsWith([{ path: "x/beam.json", data: copy }], beam, working);
  assert.equal(bySame.docs.length, 1);
  assert.equal(bySame.docs[0].data, working);
  const none = docsWith([], beam, working);
  assert.deepEqual(none.docs, [{ path: "beam.json", data: working }]);
});

test("rebuild on the working copy builds the same run shape buildRuns builds from the file", () => {
  const beam = load();
  const fromFile = buildRuns([{ path: PATH, data: beam }]).runs;
  const rebuilt = rebuild({ docs: [{ path: PATH, data: beam }], loaded: beam, working: beam });
  assert.deepEqual(rebuilt, fromFile);
  assert.deepEqual(editedGates(rebuilt), []);
  assert.deepEqual(rebuild({ working: null }), []);
});

test("markEditedGates ignores a member that was never merged in the baseline", () => {
  const beam = load();
  const run = buildRuns([{ path: PATH, data: beam }]).runs[0];
  run.gates.find((g) => g.key === "G1").members.push("WV-09");
  assert.deepEqual(markEditedGates(run, beam), []);
  run.tickets.find((t) => t.id === "WV-02").status = "fix";
  assert.deepEqual(markEditedGates(run, beam), [{ key: "G1", name: "Data and model match the reference", tickets: ["WV-02"] }]);
});

test("renderPendingGates escapes gate keys and ticket ids", () => {
  const out = renderPendingGates({ runs: [{ gates: [{ key: '<G">', edited: PENDING_EDITED, editedTickets: ["<b>"] }] }] });
  assert.ok(!out.includes("<b>"));
  assert.ok(!out.includes('<G">'));
  assert.ok(out.includes("&lt;G&quot;&gt;"));
  assert.equal(renderPendingGates({ runs: [] }), "");
});

test("without an edit store the plugin does nothing; a later attach recomputes at once", () => {
  const { app, plugin, beam } = mount({ attach: false });
  const before = computeMetrics(app.store.getRuns(), NOW);
  assert.deepEqual(before, BEFORE);
  assert.equal(plugin.recompute(), false);
  const edit = createEditStore(beam, { applyChange: applyReset });
  edit.apply(resetOf(beam, "WV-07", "coding"));
  plugin.attach(edit);
  assert.deepEqual(computeMetrics(app.store.getRuns(), NOW), AFTER);
});

test("after destroy the plugin no longer replaces runs", () => {
  const { app, edit, beam } = mount();
  const runs = app.store.getRuns();
  app.destroy();
  edit.apply(resetOf(beam, "WV-07", "coding"));
  assert.equal(app.store.getRuns(), runs);
});

test("AC-5: recompute.test.mjs is picked up by the WarpEdit test command", () => {
  const pkg = json(join(HERE, "..", "..", "..", "package.json"));
  assert.equal(pkg.scripts.test, "node --test");
  assert.match(fileURLToPath(import.meta.url), /src\/edit\/recompute\/recompute\.test\.mjs$/);
});
