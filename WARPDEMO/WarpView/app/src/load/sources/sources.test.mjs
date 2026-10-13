import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import {
  createAutoReload,
  embeddedDocs,
  openFiles,
  openFolder,
  readSources,
  reload,
  sourcesFromDrop,
  walkDirectoryHandle,
} from "./sources.mjs";
import { buildRuns } from "../parse/parse.mjs";

const BEAM = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../fixtures/beam.sample.json", import.meta.url)), "utf8"));
const STATE = { id: "WV-11", state: "coding", updatedAt: "2099-01-01T00:00:00Z" };

const fakeFile = (name, content, lastModified = 1700000000000) => ({
  kind: "file",
  name,
  async getFile() {
    return { name, lastModified, text: async () => (typeof content === "string" ? content : JSON.stringify(content)) };
  },
});
const fakeDir = (name, children) => ({
  kind: "directory",
  name,
  async *values() {
    for (const c of children) yield c;
  },
});

const repoTree = () =>
  fakeDir("proj", [
    fakeDir(".warp", [
      fakeFile("beam.json", BEAM),
      fakeFile("agents.json", { agents: [] }),
      fakeDir("tickets", [fakeDir("WV-11", [fakeFile("state.json", STATE), fakeFile("log.jsonl", "")])]),
    ]),
    fakeDir("node_modules", [fakeDir("x", [fakeFile("beam.json", BEAM)])]),
    fakeFile("status.json", { done: [] }),
  ]);

const page = (data = null) => {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return new JSDOM(
    `<!doctype html><body><script id="warp-data" type="application/json">${json}</script>
     <input type="file" id="fileInput" multiple hidden><input type="file" id="dirInput" webkitdirectory multiple hidden></body>`,
    { url: "file:///viewer.html", pretendToBeVisual: true },
  ).window;
};

test("AC-1: a folder read returns exactly the beam and the state file, with the folder name first", async () => {
  const sources = await walkDirectoryHandle(repoTree());
  assert.deepEqual(
    sources.map((s) => s.path),
    ["proj/.warp/beam.json", "proj/.warp/tickets/WV-11/state.json"],
  );
  const { docs, errors } = await readSources(sources);
  assert.equal(errors.length, 0);
  assert.equal(docs.length, 2);
  assert.ok(docs.every((d) => d.path.startsWith("proj/")));
  assert.equal(docs[0].modified, 1700000000000);
  assert.equal(docs[1].data.id, "WV-11");
  assert.ok(buildRuns(docs).runs.length >= 1);
});

test("AC-1: showDirectoryPicker is used when present, a .warp-less folder is walked whole, skip lists and depth apply", async () => {
  const deep = (n, leaf) => (n === 0 ? leaf : fakeDir("d" + n, [deep(n - 1, leaf)]));
  const tree = fakeDir("plain", [
    fakeFile("beam.json", BEAM),
    fakeDir("previous-1", [fakeFile("beam.json", BEAM)]),
    fakeDir(".git", [fakeFile("state.json", STATE)]),
    fakeDir("dist", [fakeFile("status.json", {})]),
    fakeDir("runs", [fakeDir("edit", [fakeFile("beam-edit.json", BEAM)])]),
    deep(7, fakeFile("state.json", STATE)),
    deep(8, fakeFile("state.json", STATE)),
  ]);
  const calls = [];
  const win = { showDirectoryPicker: async (o) => (calls.push(o), tree) };
  const sources = await openFolder({ win, doc: null });
  assert.deepEqual(calls, [{ mode: "read" }]);
  const paths = sources.map((s) => s.path);
  assert.ok(paths.includes("plain/beam.json"));
  assert.ok(paths.includes("plain/runs/edit/beam-edit.json"));
  assert.ok(paths.some((p) => p.split("/").length === 9 && p.endsWith("state.json")));
  assert.equal(paths.filter((p) => p.endsWith("state.json")).length, 1);
  assert.ok(!paths.some((p) => /previous|\.git|dist/.test(p)));
});

test("AC-1: a cancelled picker returns no sources", async () => {
  const win = { showDirectoryPicker: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } };
  assert.deepEqual(await openFolder({ win, doc: null }), []);
});

test("AC-1: a webkitdirectory input list keeps only .warp paths and skips node_modules", async () => {
  const w = page();
  const mk = (p) => new File([JSON.stringify(BEAM)], p.split("/").pop());
  const files = ["repo/.warp/beam.json", "repo/.warp/tickets/WV-11/state.json", "repo/beam.json", "repo/node_modules/x/beam.json", "repo/.warp/agents.json"].map(
    (p) => Object.defineProperty(mk(p), "webkitRelativePath", { value: p }),
  );
  const input = w.document.getElementById("dirInput");
  let clicked = 0;
  input.click = () => clicked++;
  const p = openFolder({ win: w, doc: w.document });
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new w.Event("change"));
  const sources = await p;
  assert.equal(clicked, 1);
  assert.deepEqual(
    sources.map((s) => s.path),
    ["repo/.warp/beam.json", "repo/.warp/tickets/WV-11/state.json"],
  );
});

test("AC-1: a dropped folder is walked through webkitGetAsEntry and re-read through its entries", async () => {
  const fileEntry = (name, data) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(new File([JSON.stringify(data)], name)) });
  const dirEntry = (name, kids) => {
    return { isFile: false, isDirectory: true, name, createReader: () => { let sent = false; return { readEntries: (ok) => { const out = sent ? [] : kids; sent = true; ok(out); } }; } };
  };
  const root = dirEntry("drop", [dirEntry(".warp", [fileEntry("beam.json", BEAM), fileEntry("agents.json", {})]), dirEntry("node_modules", [fileEntry("beam.json", BEAM)])]);
  const sources = await sourcesFromDrop({ items: [{ kind: "file", webkitGetAsEntry: () => root }], files: [] });
  assert.deepEqual(sources.map((s) => s.path), ["drop/.warp/beam.json"]);
  const { docs } = await readSources(sources);
  assert.equal(docs.length, 1);
});

test("AC-1: a dropped handle is requested before any await, and files fall back to dataTransfer.files", async () => {
  const order = [];
  const mkItem = (h) => ({ kind: "file", getAsFileSystemHandle: () => (order.push("req"), Promise.resolve(h)) });
  const sources = await sourcesFromDrop({ items: [mkItem(repoTree()), mkItem(fakeFile("schedule.json", { x: 1 }))], files: [] });
  assert.deepEqual(order, ["req", "req"]);
  assert.deepEqual(sources.map((s) => s.path), ["proj/.warp/beam.json", "proj/.warp/tickets/WV-11/state.json", "schedule.json"]);
  const w = page();
  const f = new w.File(["{}"], "beam.json");
  const viaFiles = await sourcesFromDrop({ items: [], files: [f] });
  assert.deepEqual(viaFiles.map((s) => s.path), ["beam.json"]);
});

test("AC-2: embeddedDocs returns the warp-data files and reload() calls location.reload", async () => {
  const files = [{ path: ".warp/beam.json", data: BEAM }, { path: ".warp/tickets/WV-11/state.json", data: STATE }];
  const w = page({ generatedAt: "2026-05-01T10:00:00Z", repo: "demo", files });
  const docs = embeddedDocs(w.document);
  assert.deepEqual(docs.map((d) => d.path), files.map((f) => f.path));
  assert.deepEqual(docs[0].data, BEAM);
  assert.equal(docs[0].modified, Date.parse("2026-05-01T10:00:00Z"));
  let reloads = 0;
  const win = { location: { reload: () => reloads++ } };
  const r = await reload({ win, doc: w.document, sources: [] });
  assert.equal(reloads, 1);
  assert.equal(r.mode, "page");
});

test("AC-2: an empty or broken warp-data slot gives no docs and no page reload", async () => {
  assert.deepEqual(embeddedDocs(page(null).document), []);
  const w = page();
  w.document.getElementById("warp-data").textContent = "{not json";
  assert.deepEqual(embeddedDocs(w.document), []);
  assert.deepEqual(embeddedDocs({ getElementById: () => null }), []);
  let reloads = 0;
  const r = await reload({ win: { location: { reload: () => reloads++ } }, doc: w.document, sources: [] });
  assert.equal(reloads, 0);
  assert.equal(r.mode, "none");
});

test("AC-2: reload re-reads handles and picks up a changed file", async () => {
  let content = { ...BEAM };
  const handle = { kind: "file", name: "beam.json", getFile: async () => ({ lastModified: Date.now(), text: async () => JSON.stringify(content) }) };
  const sources = [{ path: "beam.json", handle }];
  const w = page();
  const a = await reload({ win: w, doc: w.document, sources });
  content = { ...BEAM, runState: "stopped" };
  const b = await reload({ win: w, doc: w.document, sources });
  assert.equal(a.docs[0].data.runState, BEAM.runState);
  assert.equal(b.docs[0].data.runState, "stopped");
});

test("AC-3: without showOpenFilePicker the hidden file input is clicked and its files are read on change", async () => {
  const w = page();
  assert.equal(typeof w.showOpenFilePicker, "undefined");
  const input = w.document.getElementById("fileInput");
  let clicked = 0;
  input.click = () => clicked++;
  const p = openFiles({ win: w, doc: w.document });
  assert.equal(clicked, 1);
  const f = new File([JSON.stringify(BEAM)], "beam.json", { lastModified: 1700000000000 });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  const sources = await p;
  assert.deepEqual(sources.map((s) => s.path), ["beam.json"]);
  const { docs, errors } = await readSources(sources);
  assert.equal(errors.length, 0);
  assert.equal(docs[0].data.tickets !== undefined, true);
  assert.equal(docs[0].modified, 1700000000000);
});

test("AC-3: with showOpenFilePicker the picker gets multiple:true and json types, and a cancel returns nothing", async () => {
  let opts;
  const win = { showOpenFilePicker: async (o) => ((opts = o), [fakeFile("beam.json", BEAM)]) };
  const sources = await openFiles({ win, doc: null });
  assert.equal(opts.multiple, true);
  assert.ok(JSON.stringify(opts.types).includes(".json"));
  assert.equal(sources.length, 1);
  const cancel = { showOpenFilePicker: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } };
  assert.deepEqual(await openFiles({ win: cancel, doc: null }), []);
});

test("AC-3: a plain input file that can no longer be read says to open it again", async () => {
  const bad = { path: "gone.json", file: { text: async () => { throw new Error("NotReadableError"); } } };
  const junk = { path: "junk.json", file: { text: async () => "{nope" } };
  const w = page();
  const r = await reload({ win: w, doc: w.document, sources: [bad, junk] });
  assert.equal(r.docs.length, 0);
  assert.equal(r.errors.length, 2);
  assert.equal(r.errors[0].reopen, true);
  assert.match(r.message, /Open them again/);
});

const throwingWin = () => {
  const w = page();
  const timers = [];
  Object.defineProperty(w, "localStorage", { get() { throw new Error("SecurityError"); }, configurable: true });
  const win = {
    setInterval: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearInterval: (id) => { timers[id - 1] = null; },
  };
  Object.defineProperty(win, "localStorage", { get() { throw new Error("SecurityError"); } });
  return { w, timers, win };
};

test("AC-4: with localStorage throwing, toggling auto-reload never throws and still works for the session", () => {
  const { w, timers, win } = throwingWin();
  let ticks = 0;
  const ctl = createAutoReload({ win, doc: w.document, onTick: () => ticks++ });
  assert.equal(ctl.enabled, false);
  assert.doesNotThrow(() => ctl.toggle());
  assert.equal(ctl.enabled, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 30000);
  timers[0].fn();
  assert.equal(ticks, 1);
  assert.doesNotThrow(() => ctl.toggle());
  assert.equal(ctl.enabled, false);
  assert.equal(timers[0], null);
});

test("AC-4: auto-reload remembers its setting under a warp-dash: key and skips ticks while the tab is hidden", () => {
  const store = new Map();
  const timers = [];
  const win = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    setInterval: (fn) => (timers.push(fn), timers.length),
    clearInterval() {},
  };
  const doc = { visibilityState: "visible" };
  let ticks = 0;
  const ctl = createAutoReload({ win, doc, onTick: () => ticks++ });
  ctl.set(true);
  assert.deepEqual([...store.keys()], ["warp-dash:autoReload"]);
  timers[0]();
  doc.visibilityState = "hidden";
  timers[0]();
  assert.equal(ticks, 1);
  const again = createAutoReload({ win, doc, onTick() {} });
  assert.equal(again.enabled, true);
});

test("AC-4: a failing tick does not stop the timer or throw", async () => {
  const timers = [];
  const win = { setInterval: (fn) => (timers.push(fn), 1), clearInterval() {} };
  const ctl = createAutoReload({ win, doc: null, onTick: () => Promise.reject(new Error("x")) });
  ctl.set(true);
  assert.doesNotThrow(() => timers[0]());
  createAutoReload({ win, doc: null, onTick: () => { throw new Error("y"); } }).set(true);
  assert.doesNotThrow(() => timers[1]());
});
