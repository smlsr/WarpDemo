import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { asCommands, download, fileName, serialize } from "./save.mjs";
import { applyReset, buildReset } from "../reset/reset.mjs";
import { planDependents } from "../dependents/dependents.mjs";

const fixture = (name) => fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));
const read = (name) => JSON.parse(readFileSync(fixture(name), "utf8"));
const schedule = () => JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../WarpView/plan/schedule.json", import.meta.url)), "utf8"));
const AT = "2026-10-12T19:30:00Z";
const COMMAND = "python3 .cursor/plugins/warp/scripts/beam.py set --beam .warp/beam.json";

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function resetWV07(beam) {
  const built = buildReset(beam, "WV-07", "coding", "flaky test", AT);
  assert.equal(built.ok, true);
  built.change.dependents = planDependents(beam, "WV-07", "merged", "coding").dependents;
  return { change: built.change, after: applyReset(beam, built.change) };
}

test("AC-1: beam.sample.json with WV-07 reset to coding serializes to saved.beam.json apart from editedAt", () => {
  const loaded = deepFreeze(read("beam.sample.json"));
  const { after } = resetWV07(loaded);
  const out = serialize(loaded, after, "beam", { now: AT });
  assert.equal(out.ok, true);
  const expected = read("expected/saved.beam.json");
  const { editedAt, ...got } = out.data;
  const { editedAt: _skip, ...want } = expected;
  assert.deepEqual(got, want);
  assert.equal(editedAt, AT);
  assert.equal(out.data.editedBy, "warpedit");
  assert.deepEqual(JSON.parse(out.text), out.data);
  assert.deepEqual(Object.keys(out.data).slice(0, Object.keys(loaded).length), Object.keys(loaded));
});

test("AC-1: kind is detected, loaded is left untouched and editedAt defaults to now", () => {
  const loaded = deepFreeze(read("beam.sample.json"));
  const out = serialize(loaded, resetWV07(loaded).after);
  assert.equal(out.kind, "beam");
  assert.match(out.data.editedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(loaded.tickets["WV-07"].status, "merged");
  assert.equal(out.text.endsWith("\n"), true);
});

test("AC-2: WARP_PLAN.sample.json with the same reset stays warp-plan with status, resets and jiraKey", () => {
  const plan = deepFreeze(read("WARP_PLAN.sample.json"));
  const keyed = { ...plan, tickets: Object.fromEntries(plan.tickets.map((t) => [t.id, t])) };
  const { after } = resetWV07(keyed);
  const out = serialize(plan, after, undefined, { now: "2026-10-13T15:00:00Z" });
  assert.equal(out.ok, true);
  assert.equal(out.kind, "warp-plan");
  assert.equal(out.data.kind, "warp-plan");
  assert.equal(out.data.exportedAt, "2026-10-13T15:00:00Z");
  assert.equal("editedAt" in out.data, false);
  assert.equal(Array.isArray(out.data.tickets), true);
  assert.equal(out.data.tickets.length, plan.tickets.length);
  const t = out.data.tickets.find((x) => x.id === "WV-07");
  assert.equal(t.status, "coding");
  assert.deepEqual(t.resets, [{ from: "merged", to: "coding", at: AT, note: "flaky test" }]);
  assert.equal(t.jiraKey, "WAR-105");
  assert.deepEqual(out.data.estimate, plan.estimate);
  const untouched = out.data.tickets.find((x) => x.id === "WV-15");
  assert.deepEqual(untouched, plan.tickets.find((x) => x.id === "WV-15"));
});

test("AC-3: the reset and two blocked dependents give three beam.py set lines in order", () => {
  const loaded = read("beam.sample.json");
  const { change } = resetWV07(loaded);
  assert.deepEqual(change.dependents.map((d) => d.id), ["WV-15", "WV-16"]);
  assert.deepEqual(asCommands([change]), [
    `${COMMAND} --id WV-07 --status coding`,
    `${COMMAND} --id WV-15 --status blocked`,
    `${COMMAND} --id WV-16 --status blocked`,
  ]);
  assert.deepEqual(asCommands([]), []);
});

test("AC-3: ids and statuses that are not shell-safe are quoted", () => {
  const [l] = asCommands([{ ticket: "A; rm -rf /", to: "it's", dependents: [] }]);
  assert.equal(l, `${COMMAND} --id 'A; rm -rf /' --status 'it'\\''s'`);
});

test("AC-4: status.sample.json refuses with 'Open beam.json to save edits'", () => {
  const status = read("status.sample.json");
  for (const out of [serialize(status, status), serialize(status, status, "status")]) {
    assert.equal(out.ok, false);
    assert.equal(out.message, "Open beam.json to save edits");
    assert.equal("text" in out, false);
  }
});

test("AC-5: schedule.json refuses with 'schedule.json is the plan: open beam.json to save edits'", () => {
  const sched = schedule();
  for (const out of [serialize(sched, sched), serialize(sched, sched, "schedule")]) {
    assert.equal(out.ok, false);
    assert.equal(out.message, "schedule.json is the plan: open beam.json to save edits");
  }
});

test("AC-5: the saved WV-07 keeps planned, lane and priorityGate as loaded", () => {
  const loaded = deepFreeze(read("beam.sample.json"));
  const out = serialize(loaded, resetWV07(loaded).after, "beam", { now: AT });
  const before = loaded.tickets["WV-07"];
  const after = out.data.tickets["WV-07"];
  assert.deepEqual(after.planned, before.planned);
  assert.equal(after.lane, "model");
  assert.equal(after.priorityGate, "G2");
  assert.equal(after.lane, before.lane);
  assert.equal(after.priorityGate, before.priorityGate);
  assert.deepEqual(after.locks, before.locks);
});

test("Refuses when validate returns errors", () => {
  const loaded = read("invalid/missing-dep.json");
  const out = serialize(loaded, loaded, "beam");
  assert.equal(out.ok, false);
  assert.equal(out.errors.length, 1);
  assert.match(out.message, /WV-09 depends on WV-99/);
  const cycle = read("invalid/cycle.json");
  assert.equal(serialize(cycle, cycle).ok, false);
});

test("File name is the loaded name, defaulting to beam.json", () => {
  assert.equal(fileName("beam.json"), "beam.json");
  assert.equal(fileName("run/.warp/beam.json"), "beam.json");
  assert.equal(fileName("WARP_PLAN.json"), "WARP_PLAN.json");
  assert.equal(fileName(""), "beam.json");
  assert.equal(fileName(null), "beam.json");
});

test("download hands a Blob URL to an anchor named after the file and revokes it", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const { window } = dom;
  const clicks = [];
  const revoked = [];
  const blobs = [];
  window.HTMLAnchorElement.prototype.click = function () {
    clicks.push({ href: this.href, download: this.download, inBody: window.document.body.contains(this) });
  };
  const env = {
    document: window.document,
    Blob: class { constructor(parts, opts) { blobs.push({ parts, opts }); } },
    URL: { createObjectURL: () => "blob:test/1", revokeObjectURL: (u) => revoked.push(u) },
    setTimeout: (fn) => fn(),
  };
  const name = download("beam.json", "{}\n", env);
  assert.equal(name, "beam.json");
  assert.deepEqual(blobs, [{ parts: ["{}\n"], opts: { type: "application/json" } }]);
  assert.deepEqual(clicks, [{ href: "blob:test/1", download: "beam.json", inBody: true }]);
  assert.deepEqual(revoked, ["blob:test/1"]);
  assert.equal(window.document.querySelector("a"), null);
});
