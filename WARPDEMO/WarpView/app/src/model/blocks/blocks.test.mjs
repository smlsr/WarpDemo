import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gateKeys, assignBlocks, blockStates } from "./blocks.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const load = (p) => JSON.parse(readFileSync(join(FIX, p), "utf8"));
const list = (v) => (Array.isArray(v) ? v : []).map(String);

const fromBeam = (b) => ({
  gates: (b.gates || []).map((g) => ({ ...g, members: list(g.members) })),
  tickets: Object.entries(b.tickets || {}).map(([id, t]) => ({
    id,
    gate: t.gate || "",
    status: t.status || "queued",
    deps: list(t.deps).concat(list(t.after)),
  })),
});

const fromSchedule = (s) => ({
  gates: (s.gates || []).map((g) => ({ ...g, members: list(g.members), status: "pending" })),
  tickets: (s.tickets || []).map((t) => ({ id: t.id, gate: t.gate || "", status: "queued", deps: list(t.after) })),
});

const blocksOf = (run) => Object.fromEntries(run.tickets.map((t) => [t.id, t.block]));

test("AC-1: sample beam blocks equal view.blocks.json", () => {
  const run = fromBeam(load("beam.sample.json"));
  const result = assignBlocks(run);
  const expected = load("expected/view.blocks.json");
  assert.deepEqual(blocksOf(run), expected);
  assert.deepEqual(result, expected);
});

test("AC-2: big beam (68 tickets, G0-G5) blocks equal big.blocks.json", () => {
  const run = fromBeam(load("big/beam.sample.json"));
  assert.equal(run.tickets.length, 68);
  assignBlocks(run);
  assert.deepEqual(blocksOf(run), load("expected/big.blocks.json"));
  assert.deepEqual([...run.blockRank.keys()], ["G0", "G1", "G2", "G3", "G4", "G5"]);
});

test("AC-3: gates with `at` order by at, and blocks equal two-repos.blocks.json", () => {
  const run = fromSchedule(load("schedule/two-repos.json"));
  assert.ok(run.gates.every((g) => typeof g.at === "number"));
  assert.deepEqual(gateKeys(run), ["G0", "G-RBAC", "G1", "G2"]);
  assignBlocks(run);
  assert.deepEqual(blocksOf(run), load("expected/two-repos.blocks.json"));
  assert.equal(run.blockRank.get("G-RBAC"), 1);
});

test("AC-3: without `at`, G-number keys come first, then other keys in plan order", () => {
  const gates = ["G2", "Z-late", "G10", "A-first", "G1"].map((key) => ({ key, members: [] }));
  assert.deepEqual(gateKeys({ gates }), ["G1", "G2", "G10", "Z-late", "A-first"]);
});

test("AC-3: equal `at` ties break by G-number, then plan order", () => {
  const gates = [
    { key: "G-B", at: 5, members: [] },
    { key: "G2", at: 5, members: [] },
    { key: "G-A", at: 5, members: [] },
    { key: "G1", at: 5, members: [] },
  ];
  assert.deepEqual(gateKeys({ gates }), ["G1", "G2", "G-B", "G-A"]);
});

test("AC-4: a dependency cycle with no gate or membership terminates", () => {
  const run = {
    gates: [
      { key: "G0", members: ["X"] },
      { key: "G1", members: ["Y"] },
    ],
    tickets: [
      { id: "X", status: "queued", deps: [] },
      { id: "Y", status: "queued", deps: [] },
      { id: "A", status: "queued", deps: ["B", "Y"] },
      { id: "B", status: "queued", deps: ["A", "Y"] },
    ],
  };
  assignBlocks(run);
  assert.equal(run.tickets.find((t) => t.id === "A").block, "G1");
  assert.equal(run.tickets.find((t) => t.id === "B").block, "G1");
});

test("AC-4: a pure cycle with no other dependencies gets the first block", () => {
  const run = {
    gates: [{ key: "G0", members: ["X"] }, { key: "G1", members: [] }],
    tickets: [
      { id: "X", status: "queued", deps: [] },
      { id: "A", status: "queued", deps: ["B"] },
      { id: "B", status: "queued", deps: ["A"] },
      { id: "S", status: "queued", deps: ["S"] },
    ],
  };
  assignBlocks(run);
  assert.deepEqual(blocksOf(run), { X: "G0", A: "G0", B: "G0", S: "G0" });
});

test("AC-4: own gate beats membership, lowest member gate wins, unknown gate falls through", () => {
  const run = {
    gates: [
      { key: "G0", members: [] },
      { key: "G1", members: ["M", "U"] },
      { key: "G2", members: ["M", "G"] },
    ],
    tickets: [
      { id: "M", status: "queued", deps: [] },
      { id: "G", gate: "G0", status: "queued", deps: [] },
      { id: "U", gate: "nope", status: "queued", deps: [] },
    ],
  };
  assignBlocks(run);
  assert.deepEqual(blocksOf(run), { M: "G1", G: "G0", U: "G1" });
});

test("AC-5: a run with no gates has no block states and every block is null", () => {
  const run = { gates: [], tickets: [{ id: "A", status: "merged", deps: [] }, { id: "B", status: "queued", deps: ["A"] }] };
  assert.deepEqual(blockStates(run), []);
  assert.deepEqual(assignBlocks(run), { A: null, B: null });
  assert.ok(run.tickets.every((t) => t.block === null));
  assert.deepEqual(blockStates(run), []);
});

test("AC-1: block states count merged, open, parked and queued and clear finished blocks", () => {
  const run = fromBeam(load("beam.sample.json"));
  const rows = blockStates(run);
  assert.deepEqual(rows.map((r) => r.key), ["G0", "G1", "G2", "G3"]);
  for (const r of rows) {
    assert.equal(r.total, r.tickets.length);
    assert.equal(r.total, r.merged + r.open + r.parked + r.queued);
    assert.equal(r.tickets.length, run.tickets.filter((t) => t.block === r.key).length);
  }
  assert.equal(rows[0].cleared, rows[0].gate !== "red" && rows[0].merged === rows[0].total);
});

test("AC-1: a block is cleared only when all tickets are terminal and the gate is not red", () => {
  const mk = (statuses, gateStatus) => ({
    gates: [{ key: "G0", status: gateStatus, members: statuses.map((_, i) => "T" + i) }],
    tickets: statuses.map((s, i) => ({ id: "T" + i, status: s, deps: [] })),
  });
  const row = (run) => blockStates(run)[0];
  assert.equal(row(mk(["merged", "done", "skipped"], "green")).cleared, true);
  assert.equal(row(mk(["merged", "done", "skipped"], "pending")).cleared, true);
  assert.equal(row(mk(["merged", "done"], "red")).cleared, false);
  assert.equal(row(mk(["merged", "coding"], "green")).cleared, false);
  assert.equal(row(mk(["merged", "parked"], "green")).cleared, false);
  const r = row(mk(["merged", "coding", "parked", "queued", "blocked", "alarm"], "pending"));
  assert.deepEqual([r.merged, r.open, r.parked, r.queued], [1, 2, 1, 2]);
  assert.equal(r.gate, "pending");
});

test("AC-1: blockStates sets blockRank in run order", () => {
  const run = fromSchedule(load("schedule/two-repos.json"));
  blockStates(run);
  assert.deepEqual([...run.blockRank.entries()], [["G0", 0], ["G-RBAC", 1], ["G1", 2], ["G2", 3]]);
});
