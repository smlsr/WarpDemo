import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { audit, report, VIEWER_HTML } from "./audit.mjs";
import { withData } from "./dom.mjs";
import { createEditStorePlugin, editStoreFor } from "../src/plugins.mjs";
import { createStore } from "../../../WarpView/app/src/store/store.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pack = resolve(appDir, "..");
const EDITOR = join(pack, "editor.html");
const FIX = join(pack, "fixtures");
const MAX_BYTES = 450 * 1000;

// fixtures/README.md: WV-07 reset to coding, note "flaky test", at this instant; saved.beam.json carries it as editedAt.
const AT = "2026-10-12T19:30:00Z";
const NOTE = "flaky test";
const AT2 = "2026-10-13T08:00:00Z";
const NOTE2 = "second pass";

const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const rowsOf = (data) => (Array.isArray(data.tickets) ? data.tickets : Object.entries(data.tickets).map(([id, t]) => ({ id, ...t })));
const ticketOf = (data, id) => (Array.isArray(data.tickets) ? data.tickets.find((t) => t.id === id) : data.tickets[id]);

let release;
before(() => {
  release = spawnSync(process.execPath, [join(appDir, "build.mjs"), "--release"], { cwd: appDir, encoding: "utf8" });
});

// The page's clock is pinned to `at`, Blob and createObjectURL are captured, and a download link's click
// records the file instead of navigating. Any script error or failing plugin is collected.
function open(file, data, { at = AT, path = ".warp/beam.json" } = {}) {
  const errors = [];
  const downloads = [];
  const vc = new VirtualConsole();
  vc.on("error", (...a) => errors.push(a.map((x) => (x && x.reason) || String(x)).join(" ")));
  vc.on("jsdomError", (e) => errors.push(e.message));
  const raw = readFileSync(file, "utf8");
  const html = data === undefined ? raw : withData(raw, { files: [{ path, data }] });
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: pathToFileURL(file).href,
    virtualConsole: vc,
    beforeParse(win) {
      const fixed = Date.parse(at);
      const Real = win.Date;
      win.Date = class extends Real {
        constructor(...a) {
          if (a.length) super(...a);
          else super(fixed);
        }
        static now() {
          return fixed;
        }
      };
      win.Blob = class {
        constructor(parts, opts = {}) {
          this.text = parts.join("");
          this.type = opts.type;
        }
      };
      const blobs = new Map();
      win.URL.createObjectURL = (blob) => {
        const url = `blob:warpedit/${blobs.size + 1}`;
        blobs.set(url, blob);
        return url;
      };
      win.URL.revokeObjectURL = () => {};
      win.HTMLAnchorElement.prototype.click = function click() {
        const blob = blobs.get(this.href);
        if (blob) downloads.push({ name: this.download, type: blob.type, text: blob.text });
      };
    },
  });
  const ctx = { dom, win: dom.window, doc: dom.window.document, errors, downloads };
  return ctx;
}

function openTicket(ctx, id) {
  const el = ctx.doc.querySelector(`#view .bar[data-id="${id}"], #view .tcard[data-id="${id}"], #view .trow[data-id="${id}"]`);
  assert.ok(el, `${id} is on screen`);
  el.click();
  assert.equal(ctx.doc.body.classList.contains("drawer-open"), true, `${id}'s drawer opened`);
  return ctx.doc.getElementById("drawer");
}

async function resetIn(ctx, id, to, note) {
  const drawer = openTicket(ctx, id);
  const sec = drawer.querySelector('[data-ed="reset"]');
  assert.ok(sec, "the drawer has the Reset phase section");
  const select = sec.querySelector('[data-ed="reset-to"]');
  select.value = to;
  select.dispatchEvent(new ctx.win.Event("change", { bubbles: true }));
  sec.querySelector('[data-ed="reset-go"]').click();
  const modal = ctx.doc.querySelector(".ed-confirm-modal");
  assert.ok(modal, "the confirm dialog opened");
  const area = modal.querySelector("textarea");
  area.value = note;
  area.dispatchEvent(new ctx.win.Event("input", { bubbles: true }));
  modal.querySelector('[data-ed="confirm-ok"]').click();
  await tick();
  assert.equal(ctx.doc.querySelector(".ed-confirm-modal"), null, "the dialog closed");
}

function save(ctx) {
  const btn = ctx.doc.querySelector('#actionsBar [data-save-ui="save"]');
  assert.ok(btn, "Save is in the actions bar");
  assert.equal(btn.disabled, false, `Save is enabled (${btn.getAttribute("title") || ""})`);
  const n = ctx.downloads.length;
  btn.click();
  assert.equal(ctx.downloads.length, n + 1, "Save started one download");
  const file = ctx.downloads[n];
  assert.equal(file.type, "application/json");
  return { name: file.name, text: file.text, data: JSON.parse(file.text) };
}

function noErrors(ctx) {
  assert.deepEqual(ctx.errors, [], "no script error and no failing plugin");
}

// What the drawer of a ticket shows in any build: its status, raw timestamps and recent events.
function drawerFacts(drawer) {
  const kv = {};
  const dts = [...drawer.querySelectorAll("dl.kv dt")];
  for (const dt of dts) if (!(dt.textContent in kv)) kv[dt.textContent] = dt.nextElementSibling.textContent;
  return {
    kv,
    raw: [...drawer.querySelectorAll(".dv-raw")].map((e) => e.textContent),
    events: [...drawer.querySelectorAll(".ev > span:not(.t)")].map((e) => e.textContent),
  };
}

const resetControls = (root) =>
  [...root.querySelectorAll("button, select, [role=button], input")].filter((el) =>
    /\breset\b/i.test(`${el.textContent} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`),
  );

test("AC-1: npm run release writes WARPDEMO/WarpEdit/editor.html, under 450 kB, and it opens from disk", () => {
  const pkg = json(join(appDir, "package.json"));
  assert.equal(pkg.scripts.release, "node build.mjs --release");
  assert.equal(release.status, 0, release.stderr);
  const m = /^editor: (.+) (\d+)\n$/.exec(release.stdout);
  assert.ok(m, release.stdout);
  assert.equal(resolve(m[1]), EDITOR);
  assert.ok(existsSync(EDITOR));
  const bytes = statSync(EDITOR).size;
  assert.equal(bytes, Number(m[2]));
  assert.ok(bytes < MAX_BYTES, `${bytes} bytes is under ${MAX_BYTES}`);

  const html = readFileSync(EDITOR, "utf8");
  assert.equal(html.replace(/(["'`])https:\/\/\1/g, "").match(/https?:\/\//), null, "no network reference");
  const empty = open(EDITOR);
  const doc = empty.doc;
  assert.equal(doc.title, "Warp Editor");
  assert.equal(doc.querySelector(".brand .ed-badge").textContent, "Editing");
  assert.equal(doc.querySelectorAll("script[src], link[rel=stylesheet], img[src^='http']").length, 0);
  assert.equal(doc.getElementById("emptyState").classList.contains("hidden"), false);
  assert.match(doc.getElementById("emptyState").textContent, /Open a Warp run/);
  noErrors(empty);
  empty.win.close();

  const loaded = open(EDITOR, json(join(FIX, "beam.sample.json")));
  assert.equal(loaded.doc.getElementById("app").classList.contains("hidden"), false);
  assert.ok(loaded.doc.querySelectorAll("#view [data-id]").length >= 16);
  const drawer = openTicket(loaded, "WV-07");
  assert.ok(drawer.querySelector('[data-ed="reset"]'), "one edit store reached the drawer on load");
  assert.ok(loaded.doc.querySelector('#actionsBar [data-save-ui="save"]'), "and the Save button");
  noErrors(loaded);
  loaded.win.close();
});

test("AC-2: beam round trip — reset WV-07 in the built editor, save, load the saved file, and status, resets, events, pr.mergedAt and jiraKey survive", async () => {
  const beam = json(join(FIX, "beam.sample.json"));
  const expected = json(join(FIX, "expected", "saved.beam.json"));
  const first = open(EDITOR, clone(beam));
  const $ = (s) => first.doc.querySelector(s);
  const before = { metrics: $("#metrics").innerHTML, bar: $('#view .bar[data-id="WV-07"]').outerHTML };
  await resetIn(first, "WV-07", "coding", NOTE);
  assert.match($("#drawer").textContent, /unsaved/);
  // The same store reached history and recompute: the chip counts the edit, totals and the bar follow it, undo restores.
  assert.equal($('#actionsBar [data-history="count"]').textContent, "1 unsaved");
  assert.notEqual($("#metrics").innerHTML, before.metrics, "totals follow the reset");
  assert.notEqual($('#view .bar[data-id="WV-07"]').outerHTML, before.bar, "the bar follows the reset");
  $('#actionsBar [data-history="undo"]').click();
  assert.equal($("#metrics").innerHTML, before.metrics, "undo restores the totals");
  assert.equal($('#actionsBar [data-save-ui="save"]').disabled, true);
  $('#actionsBar [data-history="redo"]').click();
  assert.notEqual($("#metrics").innerHTML, before.metrics);
  const saved = save(first);
  assert.equal($('#actionsBar [data-history="count"]'), null, "nothing is unsaved after Save");
  noErrors(first);
  first.win.close();

  assert.equal(saved.name, "beam.json");
  assert.deepEqual(saved.data, expected, "the saved file is fixtures/expected/saved.beam.json");
  const was = beam.tickets["WV-07"];
  const now = saved.data.tickets["WV-07"];
  assert.equal(now.status, "coding");
  assert.deepEqual(now.resets, [{ from: "merged", to: "coding", at: AT, note: NOTE }]);
  assert.deepEqual(now.events, [...was.events, { at: AT, type: "status", from: "merged", to: "coding", by: "warpedit", note: NOTE }]);
  assert.equal(now.pr.mergedAt, was.pr.mergedAt);
  assert.deepEqual(now.pr, was.pr);
  assert.equal(now.jiraKey, was.jiraKey);
  for (const id of ["WV-15", "WV-16"]) assert.equal(saved.data.tickets[id].status, "blocked");

  // Load the saved text: the editor shows the reset as filed, not unsaved, and a second reset keeps the first.
  const second = open(EDITOR, clone(saved.data), { at: AT2 });
  const drawer = openTicket(second, "WV-07");
  const facts = drawerFacts(drawer);
  assert.ok(facts.raw.includes(was.pr.mergedAt), "old pr.mergedAt shows");
  assert.ok(facts.raw.includes(was.claimedAt), "claimedAt shows");
  assert.equal(facts.events[0], "status merged → coding");
  assert.equal(drawer.querySelector('[data-ed="reset"]').getAttribute("data-status"), "coding");
  const log = drawer.querySelector(".ed-log");
  assert.ok(log, "the reset log lists the filed reset");
  assert.match(log.textContent, /Merged → Coding.*flaky test/i);
  assert.doesNotMatch(log.textContent, /unsaved/);
  await resetIn(second, "WV-07", "review", NOTE2);
  const again = save(second);
  noErrors(second);
  second.win.close();

  const t2 = again.data.tickets["WV-07"];
  assert.equal(t2.status, "review");
  assert.deepEqual(t2.resets, [...now.resets, { from: "coding", to: "review", at: AT2, note: NOTE2 }]);
  assert.deepEqual(t2.events, [...now.events, { at: AT2, type: "status", from: "coding", to: "review", by: "warpedit", note: NOTE2 }]);
  assert.deepEqual(t2.pr, was.pr);
  assert.equal(t2.jiraKey, was.jiraKey);
  assert.equal(again.data.editedAt, AT2);
  for (const id of Object.keys(beam.tickets)) {
    if (id !== "WV-07") assert.deepEqual(again.data.tickets[id], saved.data.tickets[id], `${id} is unchanged by the second reset`);
  }
});

test("AC-2: export round trip — reset WV-07 in a WARP_PLAN export, save, load it again, and status, resets, events, pr and jiraKey survive in the export's shape", async () => {
  const plan = json(join(FIX, "WARP_PLAN.sample.json"));
  const first = open(EDITOR, clone(plan), { path: "WARP_PLAN.json" });
  await resetIn(first, "WV-07", "coding", NOTE);
  const saved = save(first);
  noErrors(first);
  first.win.close();

  assert.equal(saved.name, "WARP_PLAN.json");
  const out = saved.data;
  assert.equal(out.kind, "warp-plan");
  assert.equal(out.exportedAt, AT);
  assert.equal("editedAt" in out, false);
  assert.deepEqual(Object.keys(out), Object.keys(plan));
  for (const k of Object.keys(plan)) if (k !== "tickets" && k !== "exportedAt") assert.deepEqual(out[k], plan[k], `${k} is kept`);
  assert.ok(Array.isArray(out.tickets));
  assert.deepEqual(out.tickets.map((t) => t.id), plan.tickets.map((t) => t.id));
  const was = ticketOf(plan, "WV-07");
  const now = ticketOf(out, "WV-07");
  assert.equal(now.status, "coding");
  assert.deepEqual(now.resets, [{ from: "merged", to: "coding", at: AT, note: NOTE }]);
  assert.equal(now.jiraKey, was.jiraKey);
  assert.deepEqual(now.events, was.events, "an export carries no events; none are added");
  assert.deepEqual(now.pr, was.pr, "an export carries no pr; none is added");
  // The export lists no deps or after links, so WV-07 has no dependents to block (SPEC §6).
  for (const t of plan.tickets) if (t.id !== "WV-07") assert.deepEqual(ticketOf(out, t.id), t, `${t.id} is unchanged`);

  const second = open(EDITOR, clone(out), { at: AT2, path: "WARP_PLAN.json" });
  const drawer = openTicket(second, "WV-07");
  assert.equal(drawer.querySelector('[data-ed="reset"]').getAttribute("data-status"), "coding");
  assert.match(drawer.querySelector(".ed-log").textContent, /Merged → Coding.*flaky test/i);
  await resetIn(second, "WV-07", "review", NOTE2);
  const again = save(second);
  noErrors(second);
  second.win.close();

  const t2 = ticketOf(again.data, "WV-07");
  assert.equal(t2.status, "review");
  assert.deepEqual(t2.resets, [...now.resets, { from: "coding", to: "review", at: AT2, note: NOTE2 }]);
  assert.equal(t2.jiraKey, was.jiraKey);
  assert.deepEqual(t2.pr, was.pr);
  assert.deepEqual(t2.events, was.events);
  assert.equal(again.data.exportedAt, AT2);
  assert.deepEqual(rowsOf(again.data).map((t) => t.id), plan.tickets.map((t) => t.id));
});

test("AC-2: one edit store per loaded beam or export reaches every plugin; a reload keeps unsaved resets, another file says they were dropped, clear detaches", () => {
  const beam = json(join(FIX, "beam.sample.json"));
  const plan = json(join(FIX, "WARP_PLAN.sample.json"));
  const seen = [];
  const recomputed = [];
  const toasts = [];
  const taker = (id) => ({ id, attach: (s) => seen.push([id, s]) });
  const list = [taker("history"), taker("save-ui"), taker("drawer-panel"), { ...taker("recompute"), recompute: () => recomputed.push(1) }, { id: "scrubber" }];
  const plugin = createEditStorePlugin(list);
  list.push(plugin);
  const store = createStore();
  plugin.init({ store, toast: (m, err) => toasts.push([m, err]), destroy: () => {} });
  const load = (docs, reason = "load") => {
    store.state.docs = docs;
    store.replaceRuns([], reason);
  };

  load([{ path: "status.json", data: json(join(FIX, "status.sample.json")) }, { path: ".warp/beam.json", data: beam }]);
  const edit = plugin.store;
  assert.ok(edit);
  assert.equal(edit.loaded, beam);
  assert.deepEqual(seen.map(([id, s]) => [id, s === edit]), [["history", true], ["save-ui", true], ["drawer-panel", true], ["recompute", true]]);

  edit.apply({ ticket: "WV-07", from: "merged", to: "coding", at: AT, note: NOTE, by: "warpedit", dependents: [] });
  const alarmed = clone(beam);
  Object.assign(alarmed.tickets["WV-09"], { status: "alarm", alarm: "stuck" });
  const healed = editStoreFor(alarmed);
  healed.apply({ ticket: "WV-09", from: "alarm", to: "coding", at: AT, note: "", by: "warpedit", dependents: [] });
  assert.equal(healed.working.tickets["WV-09"].alarm, null, "a reset out of alarm clears it (SPEC §5.5)");
  seen.length = 0;
  load([{ path: ".warp/beam.json", data: clone(beam) }], "reload");
  assert.equal(plugin.store, edit, "a reload keeps the store with its unsaved reset");
  assert.equal(seen.length, 0);
  assert.equal(recomputed.length, 1, "and lays the reset over what was read again");
  store.replaceRuns([], "edit");
  assert.equal(plugin.store, edit, "its own recompute does not replace the store");

  load([{ path: "WARP_PLAN.json", data: plan }]);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][0], /^1 unsaved change was dropped/);
  assert.equal(toasts[0][1], true);
  const exp = plugin.store;
  assert.notEqual(exp, edit);
  assert.equal(exp.loaded, plan, "an export's loaded copy is the file as read");
  assert.deepEqual(Object.keys(exp.working.tickets), plan.tickets.map((t) => t.id), "its working copy is keyed by id, in file order");
  assert.equal(seen.filter(([, s]) => s === exp).length, 4);

  const dup = { ...plan, tickets: [...plan.tickets, plan.tickets[0]] };
  assert.equal(editStoreFor(dup).working, dup, "duplicate ids are left for validation to report");

  seen.length = 0;
  store.set({ runs: [], docs: [] }, "clear");
  assert.equal(plugin.store, null);
  assert.deepEqual(seen.map(([id, s]) => [id, s]), [["history", null], ["save-ui", null], ["drawer-panel", null], ["recompute", null]]);
  load([{ path: "status.json", data: json(join(FIX, "status.sample.json")) }]);
  assert.equal(plugin.store, null, "status.json alone gives no edit store");
});

test("AC-3: WARPDEMO/WarpView/viewer.html, audited again, has no data-edit element and no Reset control", () => {
  assert.ok(existsSync(VIEWER_HTML), "the released viewer exists");
  const result = audit();
  assert.equal(result.html, true, "the audit read viewer.html");
  assert.equal(result.ok, true, report(result));
  assert.equal(result.phases.length, 13);

  const ctx = open(VIEWER_HTML, json(join(FIX, "beam.sample.json")));
  assert.equal(ctx.doc.title.includes("Editor"), false);
  assert.ok(ctx.doc.querySelectorAll("#view [data-id]").length >= 16);
  openTicket(ctx, "WV-07");
  assert.equal(ctx.doc.querySelectorAll("[data-edit]").length, 0);
  assert.deepEqual(resetControls(ctx.doc).map((e) => e.outerHTML), []);
  noErrors(ctx);
  ctx.win.close();
});

test("AC-4: a saved file loaded into the viewer shows the status and timestamps in the drawer and no reset control", () => {
  const savedBeam = json(join(FIX, "expected", "saved.beam.json"));
  const ctx = open(VIEWER_HTML, savedBeam);
  const drawer = openTicket(ctx, "WV-07");
  const facts = drawerFacts(drawer);
  const t = savedBeam.tickets["WV-07"];
  assert.equal(facts.kv.Status.trim().toLowerCase().includes("coding"), true, `status shows: ${facts.kv.Status}`);
  for (const at of [t.claimedAt, t.pr.openedAt, t.pr.reviewedAt, t.pr.approvedAt, t.pr.mergedAt, t.updatedAt]) {
    assert.ok(facts.raw.includes(at), `timestamp ${at} shows`);
  }
  assert.equal(facts.events[0], "status merged → coding");
  assert.equal(drawer.querySelectorAll("[data-ed], [data-hook], [data-edit]").length, 0);
  assert.deepEqual(resetControls(ctx.doc).map((e) => e.outerHTML), []);
  assert.doesNotMatch(drawer.textContent, /Reset log|Reset phase/);
  assert.equal(ctx.doc.querySelectorAll("[data-save-ui], [data-history]").length, 0);
  noErrors(ctx);
  ctx.win.close();
});

test("AC-5: npm test runs roundtrip.test.mjs", () => {
  const pkg = json(join(appDir, "package.json"));
  assert.equal(pkg.scripts.test, "node --test");
  assert.match(fileURLToPath(import.meta.url), /[\\/]test[\\/]roundtrip\.test\.mjs$/, "node --test picks up **/*.test.mjs");
});
