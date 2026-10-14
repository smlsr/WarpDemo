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
import { createHistoryPlugin } from "../history/history.mjs";
import { asCommands } from "../save/save.mjs";
import { BLOCKED_TIP, DENIED_TOAST, createSaveUiPlugin, renderBanner, saveInfo } from "./save-ui.mjs";
import { plugins } from "../../plugins.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..", "..", "..", "..");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const BEAM = json(join(PACK, "fixtures", "beam.sample.json"));
const MISSING = json(join(PACK, "fixtures", "invalid", "missing-dep.json"));
const STATUS = json(join(PACK, "fixtures", "status.sample.json"));
const SCHEDULE = json(join(PACK, "..", "WarpView", "plan", "schedule.json"));
const NOW = Date.parse("2026-10-12T20:00:00Z");
const RESET = { ticket: "WV-07", from: "merged", to: "coding", at: "2026-10-13T08:00:00Z", note: "flaky test", by: "warpedit", dependents: [] };
const RESET2 = { ticket: "WV-08", from: "merged", to: "coding", at: "2026-10-13T08:05:00Z", note: "", by: "warpedit", dependents: [{ id: "WV-15", from: "queued", to: "blocked", note: "blocked by reset of WV-08" }] };
const SCREEN = readFileSync(join(PACK, "ui", "screens", "edit-validation.html"), "utf8");
const CSS = readFileSync(join(HERE, "save-ui.css"), "utf8");

let html;
let tmp;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "we13-"));
  const out = join(tmp, "editor.html");
  await build({ noPlugins: true, out });
  html = readFileSync(out, "utf8");
  return () => rmSync(tmp, { recursive: true, force: true });
});

function mount({ beam = BEAM, path = ".warp/beam.json", data = beam, edit = true, clipboard = "ok", options = {} } = {}) {
  const dom = new JSDOM(withData(html, null), { pretendToBeVisual: true, url: "file:///editor.html" });
  const win = dom.window;
  const downloads = [];
  const written = [];
  const RealBlob = win.Blob;
  win.Blob = class extends RealBlob {
    constructor(parts, opts) {
      super(parts, opts);
      this.parts = parts;
    }
  };
  win.URL.createObjectURL = (blob) => {
    downloads.push({ blob });
    return "blob:test";
  };
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function click() {
    downloads.push({ name: this.download, href: this.href });
  };
  if (clipboard === "ok") Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText: (t) => (written.push(t), Promise.resolve()) } });
  else if (clipboard === "denied") Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new win.DOMException("denied", "NotAllowedError")) } });
  else if (clipboard === "throws") Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText: () => { throw new Error("blocked"); } } });
  const store = edit ? createEditStore(beam) : null;
  const history = createHistoryPlugin({ store });
  const saveUi = createSaveUiPlugin({ store, now: NOW, ...options });
  const app = createApp({ root: win.document, plugins: [history, saveUi], now: () => NOW });
  assert.ok(app.load([{ path, data: JSON.parse(JSON.stringify(data)) }], { quiet: true }) !== false);
  return { dom, win, doc: win.document, store, saveUi, app, downloads, written };
}

const q = (doc, s) => doc.querySelector(s);
const saveBtn = (doc) => q(doc, '#actionsBar [data-save-ui="save"]');
const copyBtn = (doc) => q(doc, '#actionsBar [data-save-ui="copy"]');
const toasts = (doc) => [...doc.querySelectorAll("#toasts .toast")].map((t) => t.textContent);
const cssRule = (text, selector) => {
  const e = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${e}\\s*\\{([^}]*)\\}`).exec(text);
  assert.ok(m, `rule ${selector}`);
  return m[1].split(";").map((d) => d.trim().replace(/\s*:\s*/g, ":").replace(/\s*,\s*/g, ",")).filter(Boolean).sort();
};

test("the plugin list carries history before save-ui, whatever other plugins are appended", () => {
  const ids = plugins.map((p) => p.id);
  assert.ok(ids.includes("history") && ids.includes("save-ui"));
  assert.ok(ids.indexOf("history") < ids.indexOf("save-ui"));
  assert.equal(new Set(ids).size, ids.length);
});

test("AC-1: one valid reset, Save downloads beam.json, unsaved goes to 0 and the toast names the file", () => {
  const { doc, store, downloads } = mount();
  assert.equal(saveBtn(doc).disabled, true);
  store.apply(RESET);
  assert.equal(store.dirty, 1);
  assert.equal(saveBtn(doc).disabled, false);
  assert.equal(saveBtn(doc).textContent, "Save");
  assert.equal(saveBtn(doc).classList.contains("primary"), true);
  saveBtn(doc).click();
  const link = downloads.find((d) => d.name);
  assert.equal(link.name, "beam.json");
  assert.equal(downloads.some((d) => d.blob && d.blob.type === "application/json"), true);
  assert.equal(store.dirty, 0);
  assert.equal(q(doc, "#actionsBar .ed-unsaved"), null);
  assert.equal(saveBtn(doc).disabled, true);
  assert.deepEqual(toasts(doc), ["Saved beam.json (1 change)"]);
});

test("AC-1: the file keeps the name it was loaded under and counts every change", () => {
  const { doc, store, downloads } = mount({ path: "runs/view/mine.beam.json" });
  store.apply(RESET);
  store.apply(RESET2);
  saveBtn(doc).click();
  assert.equal(downloads.find((d) => d.name).name, "mine.beam.json");
  assert.deepEqual(toasts(doc), ["Saved mine.beam.json (2 changes)"]);
  assert.equal(store.dirty, 0);
});

test("AC-1: the downloaded text is the serialized working copy", () => {
  const { doc, store, downloads } = mount();
  store.apply(RESET);
  saveBtn(doc).click();
  const data = JSON.parse(downloads.find((d) => d.blob).blob.parts.join(""));
  assert.equal(data.tickets["WV-07"].status, "coding");
  assert.equal(data.tickets["WV-07"].resets.length, 1);
  assert.equal(data.editedBy, "warpedit");
  assert.equal(data.editedAt, "2026-10-12T20:00:00Z");
});

test("AC-1: a failed download keeps the changes unsaved and says so", () => {
  const { doc, store, win } = mount();
  store.apply(RESET);
  win.HTMLAnchorElement.prototype.click = () => {
    throw new Error("no download");
  };
  saveBtn(doc).click();
  assert.equal(store.dirty, 1);
  assert.deepEqual(toasts(doc), ["Could not save beam.json: the download did not start"]);
});

test("AC-2: missing-dep.json edited, Save is disabled with the tooltip and the banner names the errors", () => {
  const { doc, store, downloads } = mount({ beam: MISSING });
  store.apply(RESET);
  const save = saveBtn(doc);
  assert.equal(save.disabled, true);
  assert.equal(save.getAttribute("title"), BLOCKED_TIP);
  save.click();
  assert.equal(store.dirty, 1);
  assert.equal(downloads.length, 0);
  const banner = q(doc, '.ed-banner[data-save-ui="banner"]');
  assert.ok(banner);
  assert.equal(banner.previousElementSibling.className, "headline");
  assert.equal(q(banner, "b").textContent, "Save is blocked — 1 error");
  const rows = banner.innerHTML.split("<br>");
  assert.match(rows[1], /^<button type="button" data-save-ui="ticket" data-ticket="WV-09">WV-09<\/button> depends on WV-99, which is not in this run\.$/);
  assert.deepEqual(
    [...banner.querySelectorAll("button")].slice(0, 1).map((b) => b.textContent),
    ["WV-09"],
  );
  assert.equal(banner.getAttribute("role"), "alert");
});

test("AC-2: the banner shows warnings in the lighter style after the errors, as edit-validation.png", () => {
  const info = {
    errors: [{ code: "dep-missing", ticket: "WV-09", message: "WV-09 depends on WV-99, which is not in this run" }],
    warnings: [{ code: "in-flight-dependent", ticket: "WV-09", message: "WV-09 is in flight on top of WV-07, which was reset" }],
  };
  const out = renderBanner(info);
  const want = SCREEN.match(/class="ed-banner">([\s\S]*?)<\/div>`/)[1];
  assert.equal(out.replace(/ type="button" data-save-ui="ticket" data-ticket="WV-09"/g, ""), want);
});

test("AC-2: a ticket id button opens the drawer of that ticket", () => {
  const { doc, store } = mount({ beam: MISSING });
  store.apply(RESET);
  assert.equal(q(doc, "#drawer").getAttribute("aria-hidden"), "true");
  q(doc, '.ed-banner [data-save-ui="ticket"]').click();
  assert.equal(q(doc, "#drawer").getAttribute("aria-hidden"), "false");
  assert.match(q(doc, "#drawer").textContent, /WV-09/);
});

test("AC-2: the banner goes away when the errors do, and with nothing wrong there is none", () => {
  const { doc, store } = mount({ beam: MISSING });
  store.apply(RESET);
  assert.ok(q(doc, ".ed-banner"));
  store.undo();
  assert.ok(q(doc, ".ed-banner"));
  const clean = mount();
  clean.store.apply(RESET);
  assert.equal(q(clean.doc, ".ed-banner"), null);
});

test("AC-2: the banner and dialog styles are the declarations of the screen's CSS", () => {
  for (const sel of [".ed-banner", ".ed-banner b", ".ed-banner .w", ".ed-banner button"]) {
    assert.deepEqual(cssRule(CSS, sel), cssRule(SCREEN, sel), sel);
  }
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(CSS), "no color literals");
});

test("AC-2: the buttons follow the screen's order after Undo and Redo: Copy as commands, then Save", () => {
  const { doc, store } = mount();
  store.apply(RESET);
  const names = [...doc.querySelectorAll("#actionsBar button")].map((b) => b.textContent);
  assert.deepEqual(names, ["↶ Undo", "↷ Redo", "Copy as commands", "Save"]);
});

test("AC-3: Copy as commands puts one beam.py line per change on the clipboard and toasts the count", async () => {
  const { doc, store, saveUi, written } = mount();
  store.apply(RESET);
  store.apply(RESET2);
  copyBtn(doc).click();
  assert.equal(await saveUi.pending, true);
  assert.equal(written.length, 1);
  const lines = written[0].split("\n");
  assert.deepEqual(lines, asCommands(store.changes()));
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "python3 .cursor/plugins/warp/scripts/beam.py set --beam .warp/beam.json --id WV-07 --status coding");
  assert.ok(lines.every((l) => l.startsWith("python3 .cursor/plugins/warp/scripts/beam.py set --beam .warp/beam.json --id ")));
  assert.deepEqual(toasts(doc), ["Copied 3 commands"]);
  assert.equal(q(doc, '[data-save-ui="dialog"]'), null);
});

test("AC-3: one change copies one line and the toast is singular", async () => {
  const { doc, store, saveUi, written } = mount();
  store.apply(RESET);
  copyBtn(doc).click();
  await saveUi.pending;
  assert.equal(written[0].split("\n").length, 1);
  assert.deepEqual(toasts(doc), ["Copied 1 command"]);
});

test("AC-3: with no changes there is nothing to copy and the clipboard is untouched", async () => {
  const { doc, saveUi, written } = mount();
  copyBtn(doc).click();
  assert.equal(await saveUi.pending, false);
  assert.deepEqual(written, []);
  assert.deepEqual(toasts(doc), ["No changes to copy"]);
});

for (const mode of ["denied", "throws", "none"]) {
  test(`AC-4: clipboard ${mode}: a toast says so and a dialog shows the commands to copy by hand`, async () => {
    const { doc, store, saveUi, win } = mount({ clipboard: mode });
    if (mode === "none") Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: undefined });
    store.apply(RESET);
    store.apply(RESET2);
    copyBtn(doc).click();
    assert.equal(await saveUi.pending, false);
    const t = [...doc.querySelectorAll("#toasts .toast")];
    assert.equal(t.length, 1);
    assert.equal(t[0].textContent, DENIED_TOAST);
    assert.equal(t[0].classList.contains("err"), true);
    const dlg = q(doc, '[data-save-ui="dialog"] [role="dialog"]');
    assert.ok(dlg);
    assert.equal(dlg.getAttribute("aria-modal"), "true");
    const area = q(dlg, "textarea");
    assert.equal(area.readOnly, true);
    assert.equal(area.value, asCommands(store.changes()).join("\n"));
    assert.equal(doc.activeElement, area);
  });
}

test("AC-4: the dialog closes with Close, Escape and the scrim, and returns focus to the button", async () => {
  const { doc, win, store, saveUi } = mount({ clipboard: "denied" });
  store.apply(RESET);
  const open = async () => {
    copyBtn(doc).focus();
    copyBtn(doc).click();
    await saveUi.pending;
    return q(doc, '[data-save-ui="dialog"]');
  };
  let m = await open();
  q(m, '[data-save-ui="close"]').click();
  assert.equal(q(doc, '[data-save-ui="dialog"]'), null);
  assert.equal(doc.activeElement.getAttribute("data-save-ui"), "copy");
  m = await open();
  q(m, "textarea").dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(q(doc, '[data-save-ui="dialog"]'), null);
  m = await open();
  m.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
  assert.equal(q(doc, '[data-save-ui="dialog"]'), null);
  m = await open();
  q(m, '[role="dialog"]').dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
  assert.ok(q(doc, '[data-save-ui="dialog"]'));
});

test("AC-4: Tab cycles inside the dialog", async () => {
  const { doc, win, store, saveUi } = mount({ clipboard: "denied" });
  store.apply(RESET);
  copyBtn(doc).click();
  await saveUi.pending;
  const press = (init = {}) => (doc.activeElement || doc.body).dispatchEvent(new win.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, ...init }));
  press();
  assert.equal(doc.activeElement.getAttribute("data-save-ui"), "close");
  press();
  assert.equal(doc.activeElement.tagName, "TEXTAREA");
  press({ shiftKey: true });
  assert.equal(doc.activeElement.getAttribute("data-save-ui"), "close");
});

test("a status.json load shows Save disabled with the tooltip of SPEC §7.4", () => {
  const { doc } = mount({ edit: false, path: ".warp/status.json", data: STATUS });
  const save = saveBtn(doc);
  assert.equal(save.disabled, true);
  assert.equal(save.getAttribute("title"), "Open beam.json to save edits");
  assert.equal(copyBtn(doc), null);
});

test("a schedule.json load shows Save disabled with the tooltip of SPEC §7.4", () => {
  const { doc } = mount({ edit: false, path: "plan/schedule.json", data: SCHEDULE });
  const save = saveBtn(doc);
  assert.equal(save.disabled, true);
  assert.equal(save.getAttribute("title"), "schedule.json is the plan: open beam.json to save edits");
});

test("without an edit store and a beam loaded the plugin renders nothing", () => {
  const { doc } = mount({ edit: false });
  assert.equal(q(doc, "#actionsBar [data-hook='save-ui']"), null);
  assert.equal(q(doc, ".ed-banner"), null);
});

test("the working copy of a warp-plan export saves under its own name", () => {
  const plan = json(join(PACK, "fixtures", "WARP_PLAN.sample.json"));
  const info = saveInfo(createEditStore(plan), { docs: [{ path: "export/WARP_PLAN.json", data: plan }] });
  assert.equal(info.kind, "warp-plan");
  assert.equal(info.name, "WARP_PLAN.json");
});

test("every loaded value is escaped in the banner", () => {
  const out = renderBanner({ errors: [{ code: "x", ticket: "<b>T</b>", message: '<b>T</b> "bad" <img src=x onerror=1>' }], warnings: [] });
  assert.ok(!/<img/.test(out));
  assert.ok(!/<b>T<\/b>/.test(out));
});

test("after destroy the banner and dialog are gone", async () => {
  const { doc, store, app, saveUi } = mount({ beam: MISSING, clipboard: "denied" });
  store.apply(RESET);
  copyBtn(doc).click();
  await saveUi.pending;
  app.destroy();
  assert.equal(q(doc, ".ed-banner"), null);
  assert.equal(q(doc, '[data-save-ui="dialog"]'), null);
});
