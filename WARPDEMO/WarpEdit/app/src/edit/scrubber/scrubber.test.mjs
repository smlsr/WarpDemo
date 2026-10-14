import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "../../../build.mjs";
import { createApp } from "../../../../../WarpView/app/src/main.mjs";
import { buildRuns } from "../../../../../WarpView/app/src/load/parse/parse.mjs";
import { layoutActual, layoutPlan } from "../../../../../WarpView/app/src/model/plan/plan.mjs";
import { prepareRun } from "../../../../../WarpView/app/src/store/store.mjs";
import { catColor, catOf } from "../../../../../WarpView/app/src/core/status.mjs";
import { stamp } from "../../../../../WarpView/app/src/core/util.mjs";
import { renderSwimlanePanel } from "../../../../../WarpView/app/src/view/swimlane/swimlane.mjs";
import { loadBuilt, withData } from "../../../test/dom.mjs";
import { plugins } from "../../plugins.mjs";
import { createEditStore } from "../store/store.mjs";
import { buildReset, applyReset } from "../reset/reset.mjs";
import { planDependents } from "../dependents/dependents.mjs";
import { createRecomputePlugin } from "../recompute/recompute.mjs";
import {
  BACK,
  LABEL,
  OVERLAY_ID,
  STEP,
  baseOf,
  createScrubberPlugin,
  labelOf,
  markLeft,
  markTip,
  maxOf,
  phaseAt,
  renderScrubber,
  scrubFrame,
  scrubberPlugin,
} from "./scrubber.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..", "..", "..", "..");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const load = () => json(join(PACK, "fixtures", "beam.sample.json"));
const SAVED = json(join(PACK, "fixtures", "expected", "saved.beam.json"));
const SCRUB = json(join(PACK, "fixtures", "expected", "scrub.+20.json"));
const SCREEN = readFileSync(join(PACK, "ui", "screens", "edit-scrubber.html"), "utf8");
const CSS = readFileSync(join(HERE, "scrubber.css"), "utf8");
const NOW = Date.parse("2026-10-12T20:00:00Z");
const AT = "2026-10-12T19:30:00Z";
const PATH = ".warp/beam.json";
const H = 3600000;

let html;
let editorFile;
before(async () => {
  const tmp = mkdtempSync(join(tmpdir(), "we12-"));
  const out = join(tmp, "editor.html");
  await build({ noPlugins: true, out });
  html = readFileSync(out, "utf8");
  editorFile = join(tmp, "editor.plugins.html");
  await build({ out: editorFile });
  return () => rmSync(tmp, { recursive: true, force: true });
});

function resetOf(beam, id, to, note = "flaky test") {
  const built = buildReset(beam, id, to, note, AT);
  assert.equal(built.ok, true, built.message);
  built.change.dependents = planDependents(beam, id, built.change.from, to).dependents;
  return built.change;
}

const runOf = (beam) => prepareRun(buildRuns([{ path: PATH, data: beam }]).runs[0]);

// The editor as it runs: WarpView's app, WE-11's recompute on the edit store, and the scrubber overlay.
function mount({ beam = load(), reset = true, clock = "actual" } = {}) {
  const dom = new JSDOM(withData(html, null), { pretendToBeVisual: true, url: "file:///editor.html" });
  const edit = createEditStore(beam, { applyChange: applyReset });
  const recompute = createRecomputePlugin({ store: edit });
  const scrubber = createScrubberPlugin();
  const app = createApp({ root: dom.window.document, plugins: [recompute, scrubber], now: () => NOW });
  assert.ok(app.load([{ path: PATH, data: beam }], { quiet: true }) !== false);
  if (reset) edit.apply(resetOf(edit.working, "WV-07", "coding"));
  const doc = dom.window.document;
  if (clock === "actual") doc.querySelector('#view [data-clock="actual"]').click();
  return { dom, win: dom.window, doc, app, edit, scrubber };
}

const q = (m, s) => m.doc.querySelector(s);
const qa = (m, s) => [...m.doc.querySelectorAll(s)];
const bars = (m) => qa(m, "#view .tl-body .bar[data-id]");
const shown = (m) => bars(m).filter((b) => b.style.display !== "none");
const colorOf = (el) => el.style.getPropertyValue("--c").trim();
const catClass = (el) => (/\bc-(\w+)\b/.exec(el.className) || [])[1];

function slide(m, value) {
  const s = q(m, '[data-ed="scrub-t"]');
  s.value = String(value);
  s.dispatchEvent(new m.win.Event("input", { bubbles: true }));
  return s;
}

const currentLayout = (m) => layoutActual(m.app.store.getRuns()[0], NOW);

test("AC-1: beam.sample.json with WV-07 reset, slider at +20h — screen as edit-scrubber.png, bar colors from scrub.+20.json", () => {
  const m = mount();
  const run = m.app.store.getRuns()[0];
  assert.equal(run.tickets.find((t) => t.id === "WV-07").status, "coding", "the reset reached the swimlane");

  slide(m, 20);

  // Slider row under the panel header, above the gate and axis rows, as on the screen.
  const panel = q(m, "#view .panel.swimlane");
  const row = q(m, '[data-ed="scrub"]');
  assert.ok(row, "scrubber row is drawn");
  assert.equal(row.previousElementSibling, panel.querySelector(":scope > .panel-h"));
  assert.equal(row.nextElementSibling, panel.querySelector(":scope > .tl-scroll"));
  assert.equal(row.querySelector("b").textContent, LABEL);
  const slider = row.querySelector('input[type="range"]');
  assert.equal(slider.min, "0");
  assert.equal(slider.max, "30", "slider runs from 0 to the now line (+30h)");
  assert.equal(slider.step, String(STEP));
  assert.equal(slider.value, "20");
  const label = row.querySelector('[data-ed="scrub-at"]').textContent;
  assert.equal(label, `+20h · ${stamp(Date.parse(SCRUB.at))}`);
  assert.equal(Date.parse(SCRUB.at), run.runStartedAt + SCRUB.t * H);
  assert.equal(baseOf(run, layoutActual(run, NOW)), run.runStartedAt);
  const back = row.querySelector('[data-ed="scrub-now"]');
  assert.equal(back.textContent, BACK);
  assert.equal(back.disabled, false);

  // Each bar's color is the color of its phase in the golden file.
  const all = bars(m);
  assert.ok(all.length >= 12);
  for (const el of all) {
    const want = SCRUB.phase[el.dataset.id];
    assert.ok(want, `${el.dataset.id} is in scrub.+20.json`);
    assert.equal(el.dataset.edPhase, want, `${el.dataset.id} phase at +20h`);
    assert.equal(colorOf(el), catColor(catOf(want)), `${el.dataset.id} color at +20h`);
    assert.equal(catClass(el), catOf(want));
  }
  assert.equal(colorOf(q(m, '.bar[data-id="WV-07"]')), "var(--c-done)", "WV-07 was still merged at +20h");
  assert.equal(colorOf(q(m, '.bar[data-id="WV-09"]')), "var(--c-prog)");
  assert.equal(colorOf(q(m, '.bar[data-id="WV-13"]')), "var(--c-prog)", "WV-13 was coding at +20h, not QA ready");

  // Every phase of the golden file, drawn or not, comes out of the frame.
  const lay = currentLayout(m);
  assert.deepEqual(scrubFrame(lay, run, 20).phases, SCRUB.phase);
  assert.deepEqual(scrubFrame(layoutActual(runOf(SAVED), NOW), runOf(SAVED), 20).phases, SCRUB.phase, "same from the saved beam");

  // No bar starts after +20h in this run, so all stay; the time line is at +20h.
  const pph = (parseFloat(q(m, '.bar[data-id="WV-01"]').style.left) - 1) / lay.items.find((i) => i.t.id === "WV-01").s;
  assert.equal(shown(m).length, all.length);
  const line = q(m, '[data-ed="scrub-line"]');
  assert.equal(line.hidden, false);
  assert.ok(Math.abs(parseFloat(line.style.left) - 20 * pph) < 0.05);
  assert.ok(q(m, "#view .nowline"), "the dashed now line stays");

  // The reset is marked on WV-07's bar, with its tooltip.
  const marks = qa(m, '[data-ed="scrub-mark"]');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].dataset.id, "WV-07");
  assert.equal(marks[0].title, "merged → coding · flaky test");
  assert.equal(marks[0].hidden, false);
  const bar = q(m, '.bar[data-id="WV-07"]');
  const left = parseFloat(bar.style.left);
  const x = parseFloat(marks[0].style.left);
  assert.ok(x > left && x < left + parseFloat(bar.style.width), "marker sits on its bar");
  const item = lay.items.find((i) => i.t.id === "WV-07");
  assert.ok(marks[0].getAttribute("style").includes(`calc(var(--rowh, 46px) * ${item.row} + 1px)`), "marker on WV-07's row");

  // Earlier: bars that start after t hide, with their markers.
  slide(m, 5);
  for (const el of bars(m)) {
    const it = lay.items.find((i) => i.t.id === el.dataset.id);
    assert.equal(el.style.display === "none", it.s > 5, `${el.dataset.id} starts at +${it.s.toFixed(2)}h`);
  }
  assert.equal(q(m, '.bar[data-id="WV-09"]').style.display, "none");
  assert.equal(q(m, '[data-ed="scrub-mark"]').hidden, false, "WV-07 started before +5h");
  slide(m, 2);
  assert.equal(q(m, '.bar[data-id="WV-07"]').style.display, "none");
  assert.equal(q(m, '[data-ed="scrub-mark"]').hidden, true, "a hidden bar hides its marker");

  // Styles match the screen capture and use tokens only.
  assert.match(SCREEN, /\.ed-scrub\{display:flex;gap:12px;align-items:center;padding:8px 14px;border-bottom:1px solid var\(--line\);background:var\(--panel2\)/);
  assert.match(CSS, /\.ed-scrub \{ display: flex; gap: 12px; align-items: center; padding: 8px 14px; border-bottom: 1px solid var\(--line\); background: var\(--panel2\);/);
  assert.match(CSS, /\.ed-scrub input \{[^}]*accent-color: var\(--brand\)/);
  assert.match(CSS, /\.ed-scrubline \{[^}]*border-left: 2px solid var\(--c-qa\)/);
  assert.match(CSS, /\.ed-mark \{[^}]*width: 10px; height: 10px; border-radius: 50%; background: var\(--c-qa\); border: 2px solid var\(--panel\)/);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(CSS), "no color literals");
  assert.ok(html.includes(".ed-scrub {"), "the editor build carries scrubber.css");
});

test("AC-2: slider at the now line — every bar has its current status color", () => {
  const m = mount();
  const run = m.app.store.getRuns()[0];
  const status = new Map(run.tickets.map((t) => [t.id, t.status]));
  const check = (why) => {
    const all = bars(m);
    assert.ok(all.length >= 12);
    for (const el of all) {
      const s = status.get(el.dataset.id);
      assert.equal(colorOf(el), catColor(catOf(s)), `${el.dataset.id} ${why}`);
      assert.equal(catClass(el), catOf(s));
      assert.notEqual(el.style.display, "none");
    }
    assert.equal(q(m, '[data-ed="scrub-line"]').hidden, true, "no time line on top of the now line");
    assert.equal(q(m, '[data-ed="scrub-now"]').disabled, true);
    assert.equal(q(m, '[data-ed="scrub-at"]').textContent, `+30h · ${stamp(NOW)}`);
  };

  check("on first render");
  assert.equal(colorOf(q(m, '.bar[data-id="WV-07"]')), "var(--c-prog)", "WV-07 shows coding, its status after the reset");
  assert.equal(colorOf(q(m, '.bar[data-id="WV-13"]')), "var(--c-qa)");

  slide(m, 12);
  assert.equal(colorOf(q(m, '.bar[data-id="WV-07"]')), "var(--c-done)");
  slide(m, q(m, '[data-ed="scrub-t"]').max);
  check("after sliding to the end");

  slide(m, 12);
  q(m, '[data-ed="scrub-now"]').click();
  check("after Back to now");
  assert.equal(q(m, '[data-ed="scrub-t"]').value, "30");
  assert.equal(m.scrubber.timeOf("view"), null);

  // The model agrees: replaying every event up to now gives the current status.
  const lay = currentLayout(m);
  for (const t of run.tickets) assert.equal(phaseAt(t, NOW), t.status, `${t.id} replayed to now`);
  for (const b of scrubFrame(lay, run, null).bars) assert.equal(b.color, catColor(catOf(status.get(b.id))));
  for (const b of scrubFrame(lay, run, 31).bars) assert.equal(b.phase, status.get(b.id), "past the now line is the now line");
});

test("AC-3: a ticket with no events — queued before its claim, its current status after", () => {
  const beam = load();
  const wv09 = beam.tickets["WV-09"];
  delete wv09.events;
  const claim = Date.parse(wv09.claimedAt);

  const t = { id: "WV-09", status: "coding", claimedAt: wv09.claimedAt, events: [] };
  assert.equal(phaseAt(t, claim - 1), "queued");
  assert.equal(phaseAt(t, claim), "coding");
  assert.equal(phaseAt(t, NOW), "coding");
  assert.equal(phaseAt({ ...t, claimedAt: null, pr: { openedAt: wv09.claimedAt } }, claim - 1), "queued", "PR opened stands in for the claim");
  assert.equal(phaseAt({ id: "X", status: "queued" }, NOW), "queued");
  assert.equal(phaseAt({ id: "X", status: "skipped", events: [{ type: "bugbot", at: AT }] }, Date.parse(AT)), "skipped", "non-status events are not replayed");

  const m = mount({ beam, reset: false });
  const run = m.app.store.getRuns()[0];
  const base = run.runStartedAt;
  const claimH = (claim - base) / H;
  const before = Math.floor(claimH / STEP) * STEP;
  const after = Math.ceil(claimH / STEP) * STEP;
  const lay = currentLayout(m);
  assert.equal(scrubFrame(lay, run, before).phases["WV-09"], "queued");
  assert.equal(scrubFrame(lay, run, after).phases["WV-09"], "coding");

  slide(m, after);
  const bar = q(m, '.bar[data-id="WV-09"]');
  assert.notEqual(bar.style.display, "none");
  assert.equal(bar.dataset.edPhase, "coding");
  assert.equal(colorOf(bar), "var(--c-prog)");
  slide(m, before);
  assert.equal(bar.style.display, "none", "the bar starts at its claim");
  assert.equal(scrubFrame(lay, run, before).bars.find((b) => b.id === "WV-09").phase, "queued");
  slide(m, 20);
  assert.equal(bar.dataset.edPhase, "coding");
  assert.equal(colorOf(bar), "var(--c-prog)");
});

test("AC-4: the plan clock — no slider and no reset marker", () => {
  const m = mount({ clock: "plan" });
  assert.ok(qa(m, "#view .bar").length >= 16, "plan swimlane is drawn");
  assert.equal(q(m, '[data-ed="scrub"]'), null);
  assert.equal(q(m, '[data-ed="scrub-mark"]'), null);
  assert.equal(q(m, '[data-ed="scrub-line"]'), null);
  assert.equal(q(m, `[data-overlay="${OVERLAY_ID}"]`), null);
  assert.equal(q(m, '.bar[data-id="WV-07"]').dataset.edPhase, undefined, "bars are not repainted");

  q(m, '#view [data-clock="actual"]').click();
  slide(m, 20);
  assert.ok(q(m, '[data-ed="scrub-mark"]'));
  q(m, '#view [data-clock="plan"]').click();
  assert.equal(q(m, '[data-ed="scrub"]'), null, "leaving the actual clock hides the slider");
  assert.equal(q(m, '[data-ed="scrub-mark"]'), null);
  assert.equal(colorOf(q(m, '.bar[data-id="WV-07"]')), "var(--c-prog)", "plan bars show the status now");
  assert.equal(m.scrubber.timeOf("view"), null);
  q(m, '#view [data-clock="actual"]').click();
  assert.equal(q(m, '[data-ed="scrub-t"]').value, "30", "back on the actual clock the slider starts at now");

  const run = runOf(SAVED);
  assert.equal(renderScrubber(layoutPlan(run), run, { clock: "plan" }, 20), "");
  assert.equal(renderScrubber(layoutPlan(run), run, {}, 20), "", "a plan layout without a clock option");
  const panel = renderSwimlanePanel(run, layoutPlan(run), { clock: "plan", overlays: scrubberPlugin.swimlaneOverlays, width: 1200 });
  assert.ok(!/ed-scrub|ed-mark|data-overlay/.test(panel));
});

test("AC-5: scrubber.test.mjs runs under npm test — model, escaping and plugin shape", () => {
  // Plugin shape: one swimlane overlay, nothing else.
  assert.equal(scrubberPlugin.id, "scrubber");
  assert.deepEqual(scrubberPlugin.swimlaneOverlays.map((o) => o.id), [OVERLAY_ID]);
  assert.equal(typeof scrubberPlugin.swimlaneOverlays[0].render, "function");
  assert.equal(typeof scrubberPlugin.swimlaneOverlays[0].bind, "function");
  assert.equal(scrubberPlugin.headerActions, undefined);
  assert.equal(scrubberPlugin.drawerSections, undefined);
  assert.ok(plugins.includes(scrubberPlugin), "registered in plugins.mjs");
  assert.equal(plugins.filter((p) => p && p.id === "scrubber").length, 1);

  // Replay in time order, whatever the file order; ties keep file order.
  const t = {
    id: "A",
    status: "review",
    events: [
      { type: "status", at: "2026-10-11T12:00:00Z", from: "coding", to: "review" },
      { type: "status", at: "2026-10-11T10:00:00Z", from: "queued", to: "claimed" },
      { type: "status", at: "2026-10-11T11:00:00Z", from: "claimed", to: "planning" },
      { type: "status", at: "2026-10-11T11:00:00Z", from: "planning", to: "In Progress" },
      { type: "status", at: "not a time", to: "alarm" },
    ],
  };
  assert.equal(phaseAt(t, "2026-10-11T09:59:59Z"), "queued");
  assert.equal(phaseAt(t, "2026-10-11T10:30:00Z"), "claimed");
  assert.equal(phaseAt(t, "2026-10-11T11:00:00Z"), "coding", "aliases are normalized");
  assert.equal(phaseAt(t, "2026-10-11T12:00:00Z"), "review");
  assert.equal(phaseAt(t, null), "review");

  // Slider bounds snap to quarter hours and always reach now.
  assert.equal(maxOf(30), 30);
  assert.equal(maxOf(30.1), 30.25);
  assert.equal(maxOf(0), 0);

  // Labels and markers.
  assert.equal(labelOf({ h: 20.25, at: Date.parse("2026-10-12T10:15:00Z") }), `+20.25h · ${stamp(Date.parse("2026-10-12T10:15:00Z"))}`);
  assert.equal(markTip({ from: "merged", to: "awaiting_approval", note: "" }), "merged → awaiting approval");
  assert.equal(markLeft({ s: 0, e: 10, x: 50 }, 10), 1 + 98 - 6, "a reset after the bar lands on its end");
  assert.equal(markLeft({ s: 0, e: 10, x: -5 }, 10), 1 + 6);
  assert.equal(markLeft({ s: 0, e: 0.5, x: 3 }, 10), 1 + 1.5, "a tiny bar gets the marker in its middle");

  // Every value from the file is escaped, in the tooltip and the ids.
  const beam = load();
  const evil = '<img src=x onerror="alert(1)">';
  beam.tickets["WV-07"].events.push({ at: AT, type: "status", from: "merged", to: "coding", by: "warpedit", note: evil });
  const run = runOf(beam);
  const out = renderScrubber(layoutActual(run, NOW), run, { clock: "actual", width: 1200 }, 20);
  assert.ok(!out.includes("<img"), "note is escaped");
  assert.ok(out.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));

  // No base time: no stamp is invented.
  const bare = { tickets: [], runStartedAt: null };
  assert.equal(baseOf(bare, { items: [] }), null);
  assert.equal(labelOf(scrubFrame({ prefix: "+", items: [], now: 4, span: 4 }, bare, 2)), "+2h · —");

  // A run without runStartedAt starts at its first bar, as layoutActual does.
  const noStart = load();
  delete noStart.runStartedAt;
  const r2 = runOf(noStart);
  assert.equal(baseOf(r2, layoutActual(r2, NOW)), Date.parse(noStart.tickets["WV-01"].claimedAt));

  // The built editor, with the plugins of plugins.mjs, shows the scrubber on the actual clock only.
  const dom = loadBuilt(editorFile, { files: [{ path: PATH, data: load() }] });
  const doc = dom.window.document;
  assert.ok(doc.querySelector("#view .bar"), "the editor booted with the fixture");
  assert.equal(doc.querySelector('[data-ed="scrub"]'), null, "nothing on the plan clock");
  doc.querySelector('#view [data-clock="actual"]').click();
  const row = doc.querySelector('#view .panel.swimlane > .panel-h + [data-ed="scrub"]');
  assert.ok(row, "the registered scrubber draws its row under the swimlane header");
  dom.window.close();
});
