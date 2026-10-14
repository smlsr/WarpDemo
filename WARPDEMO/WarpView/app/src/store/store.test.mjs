import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuns } from "../load/parse/parse.mjs";
import { createStore, currentOf, prepareRun, runKey } from "./store.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const json = (p) => JSON.parse(readFileSync(join(FIX, p), "utf8"));
const runsOf = (...files) => buildRuns(files.map(([path, rel]) => ({ path, data: json(rel) }))).runs;
const beam = () => runsOf([".warp/beam.json", "beam.sample.json"]);
const two = () => runsOf([".warp/runs/view/beam.json", "runs/view/beam.json"], [".warp/runs/edit/beam.json", "runs/edit/beam.json"]);

test("AC-1: replaceRuns plans every run, so blocks, slots and finish match fixtures/expected/view.plan.json", () => {
  const store = createStore();
  store.replaceRuns(beam(), "load");
  const [run] = store.getRuns();
  const want = json("expected/view.plan.json");
  assert.equal(run.finish, want.finish);
  assert.equal(run.peak, want.peak);
  assert.equal(run.slots, want.slots);
  assert.ok(run.gateAt instanceof Map);
  assert.ok(run.tickets.every((t) => typeof t.block === "string" && Number.isInteger(t.slot)));
});

test("AC-1: subscribe hears every change with its reason; unsubscribe stops it; a failing subscriber does not stop the others", () => {
  const store = createStore();
  const heard = [];
  store.subscribe(() => {
    throw new Error("bad subscriber");
  });
  const off = store.subscribe((state, reason) => heard.push([reason, state.runs.length]));
  store.replaceRuns(beam(), "load");
  store.set({ view: "board" }, "view");
  off();
  store.set({ view: "table" }, "view");
  assert.deepEqual(heard, [["load", 1], ["view", 1]]);
  assert.equal(store.state.view, "table");
  assert.equal(store.subscribe(null)(), undefined);
});

test("AC-2: the tab picks one run; an unknown tab falls back to all", () => {
  const store = createStore();
  store.replaceRuns(two());
  assert.deepEqual(store.getRuns().map(runKey), ["edit", "view"]);
  store.set({ tab: "edit" }, "tab");
  assert.deepEqual(store.current().map(runKey), ["edit"]);
  assert.deepEqual(currentOf({ runs: store.getRuns(), tab: "nope" }).map(runKey), ["edit", "view"]);
  store.set({ tab: "nope" }, "tab");
  assert.equal(store.state.tab, "all");
  store.set({ tab: "view" }, "tab");
  store.replaceRuns(beam().map((r) => ({ ...r, name: "other" })), "load");
  assert.equal(store.state.tab, "all", "a reload without the chosen run resets the tab");
});

test("AC-3: findTicket looks a ticket up by run key and id; recompute re-plans after a plugin changes a status", () => {
  const store = createStore();
  store.replaceRuns(beam());
  const { run, ticket } = store.findTicket("view", "WV-16");
  assert.equal(ticket.id, "WV-16");
  assert.equal(store.findTicket("nope", "WV-16").ticket, null);
  assert.equal(store.findTicket("view", "nope").ticket, null);
  const reasons = [];
  store.subscribe((_, r) => reasons.push(r));
  ticket.status = "merged";
  store.recompute(run);
  assert.equal(ticket.cat, "done");
  assert.deepEqual(reasons, ["recompute"]);
  assert.ok(run.gateAt instanceof Map);
});

test("AC-4: the store never assigns a ticket status: replaceRuns, set and recompute leave every status as loaded", () => {
  const runs = beam();
  const before = runs.flatMap((r) => r.tickets.map((t) => t.id + "=" + t.status));
  const store = createStore();
  store.replaceRuns(runs);
  for (const view of ["timeline", "board", "table"]) store.set({ view, q: "wv", off: new Set(["done"]) }, "view");
  store.recompute();
  prepareRun(runs[0]);
  assert.deepEqual(store.getRuns().flatMap((r) => r.tickets.map((t) => t.id + "=" + t.status)), before);
});
