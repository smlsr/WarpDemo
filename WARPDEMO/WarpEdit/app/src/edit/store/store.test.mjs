import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEditStore } from "./store.mjs";

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/beam.sample.json", import.meta.url));
const load = () => JSON.parse(readFileSync(FIXTURE, "utf8"));

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const change = (ticket, from, to, n = 0, extra = {}) => ({
  ticket, from, to, at: `2026-10-12T19:${String(n % 60).padStart(2, "0")}:00Z`, note: `n${n}`, by: "warpedit", dependents: [], ...extra,
});

test("AC-1: applying WV-07 merged→coding leaves the loaded beam alone and counts one unsaved change", () => {
  const beam = load();
  assert.equal(beam.tickets["WV-07"].status, "merged");
  const store = createEditStore(beam);
  store.apply(change("WV-07", "merged", "coding"));
  assert.equal(store.working.tickets["WV-07"].status, "coding");
  assert.equal(store.dirty, 1);
  assert.equal(store.loaded.tickets["WV-07"].status, "merged");
  assert.equal(beam.tickets["WV-07"].status, "merged");
  assert.equal(store.working.tickets["WV-07"].events.at(-1).by, "warpedit");
  assert.equal(store.working.tickets["WV-07"].resets.at(-1).to, "coding");
  assert.notEqual(store.working, store.loaded);
  assert.equal(store.working.tickets["WV-06"], store.loaded.tickets["WV-06"]);
});

test("AC-2: redo after undo restores the state of two changes and dirty is 2", () => {
  const store = createEditStore(load());
  store.apply(change("WV-07", "merged", "coding", 1));
  store.apply(change("WV-06", "done", "review", 2));
  const afterTwo = store.working;
  store.undo();
  assert.equal(store.dirty, 1);
  assert.equal(store.working.tickets["WV-06"].status, "done");
  store.redo();
  assert.deepEqual(store.working, afterTwo);
  assert.equal(store.dirty, 2);
  assert.deepEqual(store.changes().map((c) => c.ticket), ["WV-07", "WV-06"]);
});

test("AC-2: a new change after an undo clears the redo stack", () => {
  const store = createEditStore(load());
  store.apply(change("WV-07", "merged", "coding", 1));
  store.undo();
  assert.equal(store.canRedo, true);
  store.apply(change("WV-07", "merged", "review", 2));
  assert.equal(store.canRedo, false);
  const state = store.working;
  store.redo();
  assert.equal(store.working, state);
});

test("AC-2: undo restores dependents and redo reapplies them", () => {
  const store = createEditStore(load());
  const deps = Object.values(load().tickets).filter((t) => t.id !== "WV-07").slice(0, 2);
  const c = change("WV-07", "merged", "coding", 1, {
    dependents: deps.map((d) => ({ id: d.id, from: d.status, to: "blocked", note: "blocked by reset of WV-07" })),
  });
  store.apply(c);
  for (const d of deps) assert.equal(store.working.tickets[d.id].status, "blocked");
  store.undo();
  assert.deepEqual(store.working, store.loaded);
  assert.equal(store.dirty, 0);
});

test("AC-3: 55 changes, 60 undos: only 50 are undone and the oldest 5 remain", () => {
  const store = createEditStore(load());
  const cycle = ["coding", "review", "fix", "queued", "claimed"];
  let from = "merged";
  const states = [store.working];
  for (let i = 0; i < 55; i++) {
    const to = cycle[i % cycle.length];
    store.apply(change("WV-07", from, to, i));
    from = to;
    states.push(store.working);
  }
  assert.equal(store.dirty, 55);
  let undone = 0;
  for (let i = 0; i < 60; i++) {
    const before = store.working;
    store.undo();
    if (store.working !== before) undone++;
  }
  assert.equal(undone, 50);
  assert.equal(store.canUndo, false);
  assert.equal(store.dirty, 5);
  assert.equal(store.working, states[5]);
  assert.deepEqual(store.changes().map((c) => c.note), ["n0", "n1", "n2", "n3", "n4"]);
});

test("AC-4: a deeply frozen loaded beam never throws on apply, undo or redo", () => {
  const beam = deepFreeze(load());
  const store = createEditStore(beam);
  assert.doesNotThrow(() => {
    store.apply(change("WV-07", "merged", "coding", 1));
    store.apply(change("WV-07", "coding", "review", 2, { dependents: [{ id: "WV-09", from: "x", to: "blocked" }] }));
    store.undo();
    store.redo();
    store.markSaved();
  });
  assert.equal(store.loaded.tickets["WV-07"].status, "merged");
  assert.equal(store.loaded.tickets["WV-07"].events.length, beam.tickets["WV-07"].events.length);
});

test("subscribe is called with reason and change; markSaved resets dirty", () => {
  const store = createEditStore(load());
  const seen = [];
  const off = store.subscribe((e) => seen.push(e));
  const c = change("WV-07", "merged", "coding", 1);
  store.apply(c);
  store.undo();
  store.redo();
  store.markSaved();
  assert.deepEqual(seen.map((e) => e.reason), ["apply", "undo", "redo", "saved"]);
  assert.equal(seen[0].change, c);
  assert.equal(store.dirty, 0);
  off();
  store.undo();
  assert.equal(seen.length, 4);
  assert.equal(store.dirty, 1);
});

test("an unknown ticket id changes nothing but the log", () => {
  const store = createEditStore(load());
  store.apply(change("NOPE-1", "a", "b"));
  assert.deepEqual(store.working.tickets, store.loaded.tickets);
});

test("AC-5: undo and redo on empty history are no-ops", () => {
  const store = createEditStore(load());
  assert.equal(store.undo(), store.loaded);
  assert.equal(store.redo(), store.loaded);
  assert.equal(store.dirty, 0);
});

test("AC-1: after markSaved, undo then a different change still reports unsaved work", () => {
  const store = createEditStore(load());
  store.apply(change("WV-07", "merged", "coding", 1));
  store.markSaved();
  assert.equal(store.dirty, 0);
  store.undo();
  assert.equal(store.dirty, 1);
  store.apply(change("WV-07", "merged", "review", 2));
  assert.notEqual(store.dirty, 0);
  assert.equal(store.dirty, 2);
});

test("AC-2: undo then redo back to the saved point is clean again", () => {
  const store = createEditStore(load());
  store.apply(change("WV-07", "merged", "coding", 1));
  store.markSaved();
  store.undo();
  store.redo();
  assert.equal(store.dirty, 0);
});

test("AC-1: re-applying the very same change object after undo past a save point is still unsaved", () => {
  const store = createEditStore(load());
  const c = change("WV-07", "merged", "coding", 1);
  store.apply(c);
  store.markSaved();
  store.undo();
  store.apply(c);
  assert.equal(store.dirty, 2);
});
