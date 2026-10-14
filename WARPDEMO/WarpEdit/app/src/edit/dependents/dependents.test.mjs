import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dependentsOf, planDependents } from "./dependents.mjs";
import { buildReset } from "../reset/reset.mjs";
import { createEditStore } from "../store/store.mjs";

const fixture = (name) => fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));
const read = (name) => JSON.parse(readFileSync(fixture(name), "utf8"));
const load = () => read("beam.sample.json");
const golden = () => read("expected/dependents.WV-07.json");
const AT = "2026-10-12T19:30:00Z";

function statuses(beam) {
  return Object.fromEntries(Object.entries(beam.tickets).map(([id, t]) => [id, t.status]));
}

function resetWV07(beam, to = "coding") {
  const from = beam.tickets["WV-07"].status;
  const built = buildReset(beam, "WV-07", to, "flaky test", AT);
  assert.equal(built.ok, true);
  const plan = planDependents(beam, "WV-07", from, to);
  built.change.dependents = plan.dependents;
  return { change: built.change, plan };
}

test("AC-1: WV-07 merged reset to coding blocks exactly the ids in dependents.WV-07.json", () => {
  const beam = load();
  const want = golden();
  const plan = planDependents(beam, "WV-07", "merged", "coding");
  assert.deepEqual(plan.blocked, want.blocked);
  assert.deepEqual(plan.inFlight, want.inFlight);
  assert.deepEqual(plan.alreadyMerged, want.alreadyMerged);
  assert.equal(plan.ticket, want.ticket);
  assert.equal(plan.from, want.from_);
  assert.equal(plan.to, want.to);
  assert.deepEqual(plan.dependents, want.blocked.map((id) => ({
    id, from: "queued", to: "blocked", note: "blocked by reset of WV-07",
  })));

  const store = createEditStore(beam);
  store.apply(resetWV07(beam).change);
  const after = statuses(store.working);
  for (const id of want.blocked) assert.equal(after[id], "blocked");
  const changed = Object.keys(after).filter((id) => after[id] !== statuses(beam)[id]);
  assert.deepEqual(changed.sort(), ["WV-07", ...want.blocked].sort());
});

test("AC-1: dependentsOf is transitive through deps and after and ignores cross-run entries", () => {
  assert.deepEqual(dependentsOf(load(), "WV-07"), ["WV-09", "WV-11", "WV-15", "WV-16"]);
  const run = {
    tickets: {
      A: { id: "A", status: "merged", deps: [], after: [] },
      B: { id: "B", status: "queued", deps: ["A"], after: [] },
      C: { id: "C", status: "queued", deps: [], after: ["B"] },
      D: { id: "D", status: "queued", deps: ["other:A"], after: [] },
      E: { id: "E", status: "queued", deps: ["C"], after: ["E"] },
    },
  };
  assert.deepEqual(dependentsOf(run, "A"), ["B", "C", "E"]);
  assert.deepEqual(dependentsOf({ tickets: { A: { id: "A", deps: ["B"] }, B: { id: "B", deps: ["A"] } } }, "A"), ["B"]);
  assert.deepEqual(dependentsOf({}, "A"), []);
});

test("AC-2: a dependent already coding is listed with a warning and its status is unchanged", () => {
  const beam = load();
  assert.equal(beam.tickets["WV-09"].status, "coding");
  const { change, plan } = resetWV07(beam);
  assert.deepEqual(plan.inFlight, ["WV-09"]);
  assert.deepEqual(plan.warnings.find((w) => w.id === "WV-09"), {
    id: "WV-09", status: "coding", message: "in flight on top of WV-07",
  });
  assert.deepEqual(plan.warnings.find((w) => w.id === "WV-11"), {
    id: "WV-11", status: "merged", message: "already merged on top",
  });
  assert.equal(plan.dependents.some((d) => d.id === "WV-09" || d.id === "WV-11"), false);
  const store = createEditStore(beam);
  store.apply(change);
  assert.equal(store.working.tickets["WV-09"].status, "coding");
  assert.equal(store.working.tickets["WV-11"].status, "merged");
  assert.equal(store.working.tickets["WV-09"], beam.tickets["WV-09"]);
});

test("AC-2: every phase from claimed through merging is warned, done counts as already merged", () => {
  for (const status of ["claimed", "planning", "coding", "review", "fix", "awaiting_approval", "merging"]) {
    const run = { tickets: { A: { id: "A", status: "merged" }, B: { id: "B", status, after: ["A"] } } };
    const plan = planDependents(run, "A", "merged", "coding");
    assert.deepEqual(plan.inFlight, ["B"], status);
    assert.deepEqual(plan.dependents, [], status);
  }
  const run = { tickets: { A: { id: "A", status: "done" }, B: { id: "B", status: "done", deps: ["A"] } } };
  assert.deepEqual(planDependents(run, "A", "done", "queued").alreadyMerged, ["B"]);
});

test("AC-3: reset from skipped to queued leaves dependents unchanged", () => {
  const beam = load();
  const run = { ...beam, tickets: { ...beam.tickets, "WV-07": { ...beam.tickets["WV-07"], status: "skipped" } } };
  const plan = planDependents(run, "WV-07", "skipped", "queued");
  assert.deepEqual(plan, {
    ticket: "WV-07", from: "skipped", to: "queued", blocked: [], inFlight: [], alreadyMerged: [], dependents: [], warnings: [],
  });
  const store = createEditStore(run);
  const { change } = resetWV07(run, "queued");
  assert.deepEqual(change.dependents, []);
  store.apply(change);
  for (const id of Object.keys(run.tickets)) {
    if (id !== "WV-07") assert.equal(store.working.tickets[id], run.tickets[id]);
  }
});

test("AC-3: from a non-merged phase, or to a terminal phase, nothing is planned", () => {
  const beam = load();
  for (const [from, to] of [["coding", "queued"], ["queued", "blocked"], ["merged", "done"], ["merged", "skipped"], ["done", "merged"]]) {
    const plan = planDependents(beam, "WV-07", from, to);
    assert.deepEqual([plan.blocked, plan.inFlight, plan.alreadyMerged, plan.dependents, plan.warnings], [[], [], [], [], []], `${from}→${to}`);
  }
});

test("AC-4: undo of the reset restores every dependent's status", () => {
  const beam = load();
  const before = statuses(beam);
  const { change } = resetWV07(beam);
  const store = createEditStore(beam);
  store.apply(change);
  assert.equal(store.working.tickets["WV-15"].status, "blocked");
  assert.equal(store.working.tickets["WV-16"].status, "blocked");
  store.undo();
  assert.deepEqual(statuses(store.working), before);
  assert.deepEqual(store.working, beam);
  store.redo();
  assert.equal(store.working.tickets["WV-15"].status, "blocked");
  store.undo();
  assert.deepEqual(statuses(store.working), before);
});

test("AC-4: planning does not mutate the run it reads", () => {
  const beam = load();
  const snapshot = JSON.stringify(beam);
  planDependents(beam, "WV-07", "merged", "coding");
  assert.equal(JSON.stringify(beam), snapshot);
});
