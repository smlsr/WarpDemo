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
import { withData } from "../../../test/dom.mjs";
import { createEditStore } from "../store/store.mjs";
import { createPanelPlugin, logEntries, previewText, renderPanel, SCHEDULE_LINE } from "./panel.mjs";
import { plugins } from "../../plugins.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..", "..", "..", "..");
const VIEW = join(PACK, "..", "WarpView");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const BEAM = json(join(PACK, "fixtures", "beam.sample.json"));
const SAVED = json(join(PACK, "fixtures", "expected", "saved.beam.json"));
const SCHEDULE = json(join(VIEW, "plan", "schedule.json"));
const SCREEN = readFileSync(join(PACK, "ui", "screens", "edit-drawer.html"), "utf8");
const CSS = readFileSync(join(HERE, "panel.css"), "utf8");
const NOW = Date.parse("2026-10-13T08:00:00Z");

let html;
let tmp;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "we10-"));
  const out = join(tmp, "editor.html");
  await build({ noPlugins: true, out });
  html = readFileSync(out, "utf8");
  return () => rmSync(tmp, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const runKey = (r) => r.name || r.instance || r.dir || "run";

// Stands in for WE-11: every store event rebuilds the runs from the working copy, before the panel re-renders the drawer.
function mount(beam, { attach = true, files = null } = {}) {
  const dom = new JSDOM(withData(html, null), { pretendToBeVisual: true, url: "file:///editor.html" });
  const store = createEditStore(beam);
  let app = null;
  const docs = () => files || [{ path: ".warp/beam.json", data: store.working }];
  if (attach) {
    store.subscribe(() => {
      if (!app) return;
      const built = buildRuns(docs().map((d) => ({ ...d, modified: null })));
      app.store.replaceRuns(built.runs, "edit");
    });
  }
  const panel = createPanelPlugin({ store: attach ? store : null, now: () => NOW });
  app = createApp({ root: dom.window.document, plugins: [panel], now: () => NOW });
  assert.ok(app.load(docs().map((d) => ({ ...d })), { quiet: true }) !== false);
  return { dom, win: dom.window, doc: dom.window.document, store, panel, app };
}

function open(m, id = "WV-07") {
  const run = m.app.store.getRuns()[0];
  assert.equal(m.app.openDrawer(runKey(run), id), true);
  return m.doc.querySelector('#drawer [data-hook="reset"]');
}

const q = (doc, s) => doc.querySelector(s);
const choose = (win, select, value) => {
  select.value = value;
  select.dispatchEvent(new win.Event("change", { bubbles: true }));
};
async function resetTo(m, to, note, { cancel = false } = {}) {
  const sec = open(m);
  choose(m.win, sec.querySelector("select"), to);
  sec.querySelector('[data-ed="reset-go"]').click();
  await tick();
  const dlg = m.doc.querySelector(".ed-confirm-dlg");
  assert.ok(dlg, "confirm dialog is open");
  if (note) m.doc.querySelector(".ed-confirm-note").value = note;
  m.doc.querySelector(cancel ? '[data-ed="confirm-cancel"]' : '[data-ed="confirm-ok"]').click();
  await tick();
}
const cssRule = (text, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(text);
  assert.ok(m, `rule ${selector}`);
  return m[1].split(";").map((d) => d.trim().replace(/\s*:\s*/g, ":").replace(/\s*,\s*/g, ",")).filter(Boolean).sort();
};
const logText = (sec) => [...sec.querySelectorAll(".ed-log > span")].map((s) => s.textContent);

test("AC-1: the Reset section of a merged WV-07 has the parts of edit-drawer.png in order", () => {
  const m = mount(BEAM);
  const sec = open(m);
  const kids = [...sec.querySelector(".ed-sec").children].map((e) => `${e.tagName.toLowerCase()}${e.className ? "." + e.className : ""}`);
  assert.deepEqual(kids, ["h4", "div.ed-row", "div.ed-prev", "h4.ed-logh", "div.ed-empty"]);
  assert.equal(sec.querySelector("h4").textContent, "Reset phase");
  const select = sec.querySelector(".ed-row select");
  const options = [...select.options].map((o) => o.textContent);
  assert.deepEqual(options, ["queued", "claimed", "planning", "coding", "review", "fix", "awaiting approval", "merging", "blocked", "alarm"]);
  assert.equal(select.value, "coding");
  assert.equal(sec.querySelector(".ed-row button").textContent, "Reset…");
  assert.ok(sec.querySelector(".ed-row button").classList.contains("primary"));
  assert.equal(
    sec.querySelector(".ed-prev").textContent,
    "Blocks 2 queued dependents (WV-15, WV-16) · 1 in flight on top (WV-09) · 1 already merged on top (WV-11)",
  );
  assert.equal(sec.querySelectorAll("h4")[1].textContent, "Reset log");
});

test("AC-1: markup, options and preview text are the ones in the screen's own HTML", () => {
  const m = mount(BEAM);
  const sec = open(m);
  const row = /<div class="ed-sec"><h4>([^<]*)<\/h4><div class="ed-row"><select>([\s\S]*?)<\/select><button class="btn primary">([^<]*)<\/button><\/div><div class="ed-prev">([^<]*)<\/div>/.exec(SCREEN);
  assert.ok(row, "the screen's Reset section");
  assert.equal(sec.querySelector("h4").textContent, row[1]);
  const want = [...row[2].matchAll(/<option>([^<]*)<\/option>/g)].map((x) => x[1]);
  assert.deepEqual([...sec.querySelectorAll("option")].map((o) => o.textContent).sort(), want.sort());
  assert.equal(sec.querySelector(".ed-row button").textContent, row[3]);
  assert.equal(sec.querySelector(".ed-prev").textContent, row[4]);
});

test("AC-1: the section's styles are the declarations of the screen's CSS, tokens only", () => {
  for (const sel of [".ed-sec", ".ed-row", ".ed-row select", ".ed-prev", ".ed-log", ".ed-log .u"]) {
    assert.deepEqual(cssRule(CSS, sel), cssRule(SCREEN, sel), sel);
  }
  assert.deepEqual(cssRule(CSS, ".ed-sec h4"), cssRule(SCREEN, ".ed-sec h4"));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(CSS), "no color literals");
});

test("AC-1: the preview follows the chosen phase and is empty of dependents for a ticket with none", () => {
  const m = mount(BEAM);
  const sec = open(m);
  choose(m.win, sec.querySelector("select"), "queued");
  assert.match(sec.querySelector(".ed-prev").textContent, /^Blocks 2 queued dependents/);
  const other = open(m, "WV-16");
  assert.equal(other.querySelector(".ed-prev").textContent.startsWith("Blocks"), false);
  assert.equal(previewText({ blocked: [], inFlight: [], alreadyMerged: [] }), "No other ticket is affected.");
  assert.equal(previewText({ blocked: ["A"], inFlight: [], alreadyMerged: [] }), "Blocks 1 queued dependent (A)");
});

test("AC-2: coding chosen and confirmed with a note: status coding, a reset log entry with the note, marked unsaved", async () => {
  const m = mount(BEAM);
  await resetTo(m, "coding", "flaky test");
  assert.equal(m.store.working.tickets["WV-07"].status, "coding");
  const drawer = q(m.doc, "#drawer");
  assert.match(drawer.textContent, /Status\s*In Progress · coding/);
  const sec = q(m.doc, '#drawer [data-hook="reset"] .ed-sec');
  assert.equal(sec.getAttribute("data-status"), "coding");
  assert.equal([...sec.querySelectorAll("option")].some((o) => o.value === "coding"), false);
  const [lead, text] = logText(sec);
  assert.equal(lead, "unsaved");
  assert.match(text, /^merged → coding · .+ · flaky test$/);
  assert.equal(sec.querySelectorAll(".ed-log .u").length, 1);
  assert.equal(m.store.working.tickets["WV-07"].resets.at(-1).note, "flaky test");
  assert.equal(m.store.working.tickets["WV-15"].status, "blocked");
});

test("AC-2: an entry made in the session is no longer unsaved after markSaved", async () => {
  const m = mount(BEAM);
  await resetTo(m, "coding", "flaky test");
  m.store.markSaved();
  const sec = q(m.doc, '#drawer [data-hook="reset"] .ed-sec');
  assert.equal(sec.querySelectorAll(".ed-log .u").length, 0);
  assert.match(logText(sec)[1], /^merged → coding · .+ · flaky test$/);
});

test("AC-2: undo removes the entry from the log", async () => {
  const m = mount(BEAM);
  await resetTo(m, "coding", "flaky test");
  m.store.undo();
  const sec = q(m.doc, '#drawer [data-hook="reset"] .ed-sec');
  assert.equal(sec.querySelector(".ed-empty").textContent, "No resets yet");
  assert.equal(sec.getAttribute("data-status"), "merged");
});

test("AC-2: the newest entry is first, with the file's older entry below it", async () => {
  const m = mount(SAVED, { files: [{ path: ".warp/beam.json", data: SAVED }] });
  m.store.apply({ ticket: "WV-07", from: "coding", to: "review", at: "2026-10-14T08:00:00Z", note: "second", by: "warpedit", dependents: [] });
  const sec = open(m);
  const rows = logText(sec);
  assert.equal(rows[0], "unsaved");
  assert.match(rows[1], /^coding → review · .+ · second$/);
  assert.match(rows[3], /^merged → coding · .+ · flaky test$/);
});

test("AC-3: saved.beam.json loaded: the reset log lists the saved entry, not marked unsaved", () => {
  const m = mount(SAVED);
  const sec = open(m);
  const rows = logText(sec);
  assert.equal(rows.length, 2);
  assert.match(rows[1], /^merged → coding · .+ · flaky test$/);
  assert.equal(rows[0], new Date("2026-10-12T19:30:00Z").toLocaleDateString([], { month: "short", day: "numeric" }));
  assert.equal(sec.querySelectorAll(".ed-log .u").length, 0);
  assert.equal(sec.textContent.includes("unsaved"), false);
  assert.equal(sec.querySelector(".ed-sec").getAttribute("data-status"), "coding");
});

test("AC-3: the entries come from the loaded file when no session change was made", () => {
  const store = createEditStore(SAVED);
  assert.deepEqual(logEntries(store, "WV-07"), [{ from: "merged", to: "coding", at: "2026-10-12T19:30:00Z", note: "flaky test", unsaved: false }]);
});

test("AC-4: the confirm dialog cancelled: status and log are unchanged", async () => {
  const m = mount(BEAM);
  await resetTo(m, "coding", "never saved", { cancel: true });
  assert.equal(m.store.working, m.store.loaded);
  assert.equal(m.store.dirty, 0);
  assert.equal(m.doc.querySelector(".ed-confirm-dlg"), null);
  const sec = q(m.doc, '#drawer [data-hook="reset"] .ed-sec');
  assert.equal(sec.getAttribute("data-status"), "merged");
  assert.equal(sec.querySelector(".ed-empty").textContent, "No resets yet");
  assert.match(q(m.doc, "#drawer").textContent, /Status\s*Completed · merged/);
});

test("AC-4: Escape on the dialog is a cancel too", async () => {
  const m = mount(BEAM);
  const sec = open(m);
  sec.querySelector('[data-ed="reset-go"]').click();
  await tick();
  m.doc.dispatchEvent(new m.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await tick();
  assert.equal(m.store.working, m.store.loaded);
  assert.equal(m.doc.querySelector(".ed-confirm-dlg"), null);
});

test("AC-5: schedule.json loaded: the Reset section holds only the schedule line, no select, no button", () => {
  const m = mount(BEAM, { files: [{ path: "plan/schedule.json", data: SCHEDULE }] });
  assert.equal(m.app.store.getRuns()[0].kind, "schedule");
  const sec = open(m);
  assert.equal(sec.textContent.trim(), SCHEDULE_LINE);
  assert.equal(SCHEDULE_LINE, "schedule.json is the plan: open beam.json to reset a phase");
  assert.equal(sec.querySelector("select"), null);
  assert.equal(sec.querySelector("button"), null);
  assert.equal(sec.querySelector("h4"), null);
});

test("AC-5: a schedule run shows the line even when no edit store is attached", () => {
  const html5 = renderPanel({ ticket: { id: "WV-07" }, run: { kind: "schedule" }, edit: null });
  assert.match(html5, /schedule\.json is the plan: open beam\.json to reset a phase/);
  assert.equal(/<select|<button/.test(html5), false);
});

test("AC-1: with no edit store attached the section is absent", () => {
  const m = mount(BEAM, { attach: false });
  assert.equal(open(m), null);
});

test("AC-2: every value from a file is escaped in the log", () => {
  const evil = structuredClone(BEAM);
  evil.tickets["WV-07"].resets = [{ from: "merged", to: "coding", at: "2026-10-12T19:30:00Z", note: '<img src=x onerror="alert(1)">' }];
  evil.tickets["WV-07"].status = "coding";
  const m = mount(evil);
  const sec = open(m);
  assert.equal(sec.querySelector("img"), null);
  assert.match(sec.querySelector(".ed-log").textContent, /<img src=x onerror="alert\(1\)">/);
});

test("AC-6: the panel is registered in plugins.mjs", () => {
  assert.ok(plugins.some((p) => p.id === "drawer-panel" && Array.isArray(p.drawerSections) && p.drawerSections[0].id === "reset"));
});
