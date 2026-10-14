import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "../../../build.mjs";
import { createApp } from "../../../../../WarpView/app/src/main.mjs";
import { withData } from "../../../test/dom.mjs";
import { createEditStore } from "../store/store.mjs";
import { createHistoryPlugin, historyInfo, renderHistory } from "./history.mjs";
import { plugins } from "../../plugins.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..", "..", "..", "..");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const BEAM = json(join(PACK, "fixtures", "beam.sample.json"));
const FILES = [{ path: ".warp/beam.json", data: BEAM }];
const NOW = Date.parse("2026-10-12T20:00:00Z");
const RESET = { ticket: "WV-07", from: "merged", to: "coding", at: "2026-10-13T08:00:00Z", note: "flaky test", by: "warpedit", dependents: [] };
const SCREEN = readFileSync(join(PACK, "ui", "screens", "edit-header.html"), "utf8");
const CSS = readFileSync(join(HERE, "history.css"), "utf8");

let html;
let tmp;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "we07-"));
  const out = join(tmp, "editor.html");
  await build({ noPlugins: true, out });
  html = readFileSync(out, "utf8");
  return () => rmSync(tmp, { recursive: true, force: true });
});

function mount({ edit = true } = {}) {
  const dom = new JSDOM(withData(html, null), { pretendToBeVisual: true, url: "file:///editor.html" });
  const store = createEditStore(BEAM);
  const history = createHistoryPlugin({ store: edit ? store : null });
  const app = createApp({ root: dom.window.document, plugins: [history], now: () => NOW });
  assert.ok(app.load(FILES.map((f) => ({ ...f })), { quiet: true }) !== false);
  return { dom, win: dom.window, doc: dom.window.document, store, history, app };
}

const bar = (doc) => doc.querySelector("#actionsBar");
const btn = (doc, k) => doc.querySelector(`#actionsBar [data-history="${k}"]`);
const chip = (doc) => doc.querySelector("#actionsBar .ed-unsaved");
const press = (win, el, key, init = {}) => {
  const ev = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
};
const cssRule = (text, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(text);
  assert.ok(m, `rule ${selector}`);
  return m[1].split(";").map((d) => d.trim().replace(/\s*:\s*/g, ":").replace(/\s*,\s*/g, ",")).filter(Boolean).sort();
};

test("AC-1: one reset renders 1 unsaved, Undo enabled with a tooltip, Redo disabled, as edit-header.png", () => {
  const { doc, store } = mount();
  store.apply(RESET);
  assert.equal(chip(doc).textContent, "1 unsaved");
  assert.equal(doc.querySelector("#actionsBar .ed-note").textContent, "WV-07 merged → coding");
  assert.equal(btn(doc, "undo").disabled, false);
  assert.equal(btn(doc, "undo").textContent, "↶ Undo");
  assert.equal(btn(doc, "undo").getAttribute("title"), "Undo WV-07 merged → coding");
  assert.equal(btn(doc, "redo").disabled, true);
  assert.equal(btn(doc, "redo").textContent, "↷ Redo");
  assert.equal(bar(doc).classList.contains("hidden"), false);
  const kids = [...doc.querySelectorAll("#actionsBar [data-hook='history'] > *")].map((e) => e.className || e.tagName.toLowerCase());
  assert.deepEqual(kids, ["ed-unsaved", "ed-note", "ed-grow", "btn", "btn"]);
});

test("AC-1: the chip and note styles are the declarations of the screen's CSS", () => {
  for (const sel of [".ed-note", ".ed-unsaved"]) {
    assert.deepEqual(cssRule(CSS, sel), cssRule(SCREEN, sel), sel);
  }
  assert.deepEqual(cssRule(CSS, "#actionsBar"), ["align-items:center", "background:color-mix(in srgb,var(--c-qa) 6%,var(--panel))", "border-top:1px solid var(--line)", "display:flex", "flex-wrap:wrap", "gap:8px", "min-height:46px"].sort());
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(CSS), "no color literals");
});

test("AC-1: with nothing unsaved the chip is hidden and both buttons are disabled", () => {
  const { doc } = mount();
  assert.equal(chip(doc), null);
  assert.equal(doc.querySelector("#actionsBar .ed-note").textContent, "No unsaved changes");
  assert.equal(btn(doc, "undo").disabled, true);
  assert.equal(btn(doc, "redo").disabled, true);
});

test("AC-2: Ctrl+Z then Ctrl+Shift+Z undoes and redoes the reset, count 1 → 0 → 1, with a toast each time", () => {
  const { doc, win, store } = mount();
  store.apply(RESET);
  assert.equal(store.dirty, 1);
  const z = press(win, doc.body, "z", { ctrlKey: true });
  assert.equal(z.defaultPrevented, true);
  assert.equal(store.dirty, 0);
  assert.equal(store.working, store.loaded);
  assert.equal(chip(doc), null);
  assert.equal(btn(doc, "redo").disabled, false);
  assert.equal(btn(doc, "redo").getAttribute("title"), "Redo WV-07 merged → coding");
  assert.match(doc.querySelector("#toasts").textContent, /Undid WV-07 merged → coding/);
  press(win, doc.body, "Z", { ctrlKey: true, shiftKey: true });
  assert.equal(store.dirty, 1);
  assert.equal(store.working.tickets["WV-07"].status, "coding");
  assert.equal(chip(doc).textContent, "1 unsaved");
  assert.match(doc.querySelector("#toasts").textContent, /Redid WV-07 merged → coding/);
});

test("AC-2: the Cmd key and the buttons do the same", () => {
  const { doc, win, store } = mount();
  store.apply(RESET);
  press(win, doc.body, "z", { metaKey: true });
  assert.equal(store.dirty, 0);
  press(win, doc.body, "Z", { metaKey: true, shiftKey: true });
  assert.equal(store.dirty, 1);
  btn(doc, "undo").click();
  assert.equal(store.dirty, 0);
  btn(doc, "redo").click();
  assert.equal(store.dirty, 1);
});

test("AC-2: Ctrl+Z with nothing to undo changes nothing and shows no toast", () => {
  const { doc, win, store } = mount();
  press(win, doc.body, "z", { ctrlKey: true });
  assert.equal(store.dirty, 0);
  assert.equal(doc.querySelector("#toasts").textContent, "");
});

test("AC-3: Ctrl+Z in the search box is left to the browser and the store is unchanged", () => {
  const { doc, win, store } = mount();
  store.apply(RESET);
  const q = doc.querySelector("#q");
  q.focus();
  const ev = press(win, q, "z", { ctrlKey: true });
  assert.equal(ev.defaultPrevented, false);
  assert.equal(store.dirty, 1);
  assert.equal(store.canUndo, true);
  press(win, q, "Z", { ctrlKey: true, shiftKey: true });
  assert.equal(store.dirty, 1);
});

test("AC-3: the key handler itself ignores an input, a textarea and a contenteditable target", () => {
  const store = createEditStore(BEAM);
  store.apply(RESET);
  const plugin = createHistoryPlugin({ store });
  plugin.attach(store);
  const undo = plugin.keys[0];
  const toasts = [];
  for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
    undo.run({ target }, { toast: (m) => toasts.push(m) });
  }
  assert.equal(store.dirty, 1);
  assert.deepEqual(toasts, []);
  undo.run({ target: { tagName: "BODY" } }, { toast: (m) => toasts.push(m) });
  assert.equal(store.dirty, 0);
  assert.equal(toasts.length, 1);
});

test("AC-4: with zero unsaved changes, unloading asks for nothing", () => {
  const { win, store } = mount();
  let ev = new win.Event("beforeunload", { cancelable: true });
  win.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  store.apply(RESET);
  store.undo();
  ev = new win.Event("beforeunload", { cancelable: true });
  win.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
});

test("AC-4: with an unsaved change, unloading asks, and saving clears it", () => {
  const { win, store } = mount();
  store.apply(RESET);
  let ev = new win.Event("beforeunload", { cancelable: true });
  win.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  store.markSaved();
  ev = new win.Event("beforeunload", { cancelable: true });
  win.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
});

test("AC-4: after destroy the page no longer asks", () => {
  const { win, store, app } = mount();
  store.apply(RESET);
  app.destroy();
  const ev = new win.Event("beforeunload", { cancelable: true });
  win.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
});

test("without an edit store the bar renders nothing and keys do nothing", () => {
  const { doc, win } = mount({ edit: false });
  assert.equal(doc.querySelector("#actionsBar [data-hook='history']"), null);
  assert.equal(bar(doc).classList.contains("hidden"), true);
  press(win, doc.body, "z", { ctrlKey: true });
});

test("a later attach subscribes to the new store", () => {
  const { doc, history } = mount({ edit: false });
  const store = createEditStore(BEAM);
  history.attach(store);
  store.apply(RESET);
  assert.equal(chip(doc).textContent, "1 unsaved");
});

test("renderHistory escapes the ticket and phase names", () => {
  const out = renderHistory(historyInfo({
    dirty: 1, canUndo: true, canRedo: false,
    nextUndo: () => ({ ticket: '<b>"x"', from: "a&b", to: "c" }), nextRedo: () => null,
    changes: () => [{ ticket: "<i>", from: "a", to: "b" }],
  }));
  assert.ok(!out.includes("<b>"));
  assert.ok(!out.includes("<i>"));
  assert.ok(out.includes("&lt;b&gt;&quot;x&quot;"));
});

test("the history plugin is registered in plugins.mjs", () => {
  assert.ok(plugins.some((p) => p.id === "history" && p.headerActions.length === 1 && p.keys.length >= 2));
});
