import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { plan, layoutPlan, layoutActual } from "./plan.mjs";
import { runFromBeam, runFromSchedule } from "../../load/parse/parse.mjs";
import { parseTime } from "../../core/util.mjs";

const PACK = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const load = (p) => JSON.parse(readFileSync(join(PACK, p), "utf8"));
const fromBeam = (doc) => runFromBeam(doc, "beam.json", null);
const fromSchedule = (doc) => runFromSchedule(doc, "schedule.json", null);

const r4 = (x) => +x.toFixed(4);
const planOf = (run) => ({
  planSource: run.planSource,
  finish: run.finish,
  peak: run.peak,
  slots: run.slots,
  waves: run.waves,
  critHours: run.critHours,
  critCount: run.critCount,
  gateAt: Object.fromEntries(run.gateAt),
  tickets: Object.fromEntries(
    run.tickets.map((t) => [t.id, { slot: t.slot, start: r4(t.start), end: r4(t.end), mergeAt: r4(t.mergeAt), unplaced: !!t.unplaced }]),
  ),
});

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("AC-1: sample beam plan equals view.plan.json to 0.01 h", () => {
  const run = plan(fromBeam(load("fixtures/beam.sample.json")));
  const exp = load("fixtures/expected/view.plan.json");
  assert.equal(run.planSource, exp.planSource);
  near(run.finish, exp.finish, 0.01, "finish");
  assert.equal(run.peak, exp.peak);
  assert.equal(run.slots, exp.slots);
  assert.deepEqual(Object.keys(Object.fromEntries(run.gateAt)), Object.keys(exp.gateAt));
  for (const [k, at] of Object.entries(exp.gateAt)) near(run.gateAt.get(k), at, 0.01, `gateAt ${k}`);
  assert.equal(run.tickets.length, Object.keys(exp.tickets).length);
  for (const t of run.tickets) {
    const e = exp.tickets[t.id];
    assert.ok(e, `expected row for ${t.id}`);
    assert.equal(t.slot, e.slot, `${t.id} slot`);
    near(t.start, e.start, 0.01, `${t.id} start`);
    near(t.mergeAt, e.mergeAt, 0.01, `${t.id} mergeAt`);
  }
  assert.deepEqual(planOf(run), exp);
});

test("AC-2: big beam plan equals big.plan.json (finish T+177, peak 10, 10 slots)", () => {
  const run = plan(fromBeam(load("fixtures/big/beam.sample.json")));
  assert.equal(run.planSource, "simulated");
  assert.equal(run.finish, 177);
  assert.equal(run.peak, 10);
  assert.equal(run.slots, 10);
  assert.deepEqual(planOf(run), load("fixtures/expected/big.plan.json"));
});

test("AC-3: schedule.json is drawn as written and equals schedule.plan.json", () => {
  const doc = load("plan/schedule.json");
  const run = plan(fromSchedule(doc));
  assert.equal(run.planSource, "schedule");
  assert.equal(run.finish, doc.numbers.finish_h);
  const byId = new Map(run.tickets.map((t) => [t.id, t]));
  for (const s of doc.tickets) {
    const t = byId.get(s.id);
    assert.equal(t.slot, s.slot - 1, `${s.id} slot`);
    assert.equal(t.start, s.start, `${s.id} start`);
    assert.equal(t.mergeAt, s.merge, `${s.id} mergeAt`);
    assert.equal(t.unplaced, false);
  }
  for (const g of doc.gates) assert.equal(run.gateAt.get(g.key), g.at, `gateAt ${g.key}`);
  assert.deepEqual(planOf(run), load("fixtures/expected/schedule.plan.json"));
});

test("AC-3: the two-repo schedule is drawn as written and equals two-repos.plan.json", () => {
  const run = plan(fromSchedule(load("fixtures/schedule/two-repos.json")));
  assert.deepEqual(planOf(run), load("fixtures/expected/two-repos.plan.json"));
});

test("AC-3: a gate without `at` is reached at the max mergeAt of its members", () => {
  const p = (slot, start, merge) => ({ slot, start, merge });
  const run = plan({
    kind: "schedule",
    gates: [{ key: "G0", members: ["A", "B"] }],
    tickets: [
      { id: "A", hours: 4, deps: [], planned: p(1, 0, 4) },
      { id: "B", hours: 7, deps: [], planned: p(2, 0, 7.5) },
    ],
  });
  assert.equal(run.planSource, "schedule");
  assert.equal(run.gateAt.get("G0"), 7.5);
  assert.equal(run.peak, 2);
  assert.equal(run.slots, 2);
});

test("AC-4: gateOrder deps on the big beam waits for no earlier block and finishes earlier", () => {
  const strict = plan(fromBeam(load("fixtures/big/beam.sample.json")));
  const run = fromBeam(load("fixtures/big/beam.sample.json"));
  run.gateOrder = "deps";
  plan(run);
  assert.equal(run.planSource, "simulated");
  assert.ok(run.finish < strict.finish, `deps finish ${run.finish} < strict finish ${strict.finish}`);

  const byId = new Map(run.tickets.map((t) => [t.id, t]));
  const cap = run.cap;
  for (const t of run.tickets) {
    const ready = Math.max(0, ...t.deps.filter((d) => byId.has(d)).map((d) => byId.get(d).mergeAt));
    assert.ok(t.start >= ready - 1e-9, `${t.id} starts after its dependencies merge`);
    if (t.start > ready + 1e-9) {
      const busy = run.tickets.filter((o) => o !== t && o.start < t.start - 1e-9 && o.end >= t.start - 1e-9).length;
      assert.equal(busy, cap, `${t.id} waited only because all ${cap} slots were busy`);
    }
  }

  const rank = run.blockRank;
  const blockEnd = new Map();
  for (const t of run.tickets) blockEnd.set(t.block, Math.max(blockEnd.get(t.block) || 0, t.mergeAt));
  const overlaps = run.tickets.filter((t) =>
    [...rank].some(([k, i]) => i < rank.get(t.block) && t.start < blockEnd.get(k) - 1e-9),
  );
  assert.ok(overlaps.length > 0, "some ticket starts before an earlier block has finished");
});

test("AC-4: a schedule run never applies strict block order", () => {
  const run = plan({
    kind: "schedule",
    gateOrder: "strict",
    gates: [{ key: "G0", members: ["A"] }, { key: "G1", members: ["B"] }],
    tickets: [
      { id: "A", hours: 4, deps: [], autoMerge: true },
      { id: "B", hours: 4, deps: [], autoMerge: true },
    ],
  });
  assert.equal(run.tickets[1].start, 0);
});

test("AC-5: actual layout of the sample beam at 2026-10-12T20:00:00Z equals view.actual.json", () => {
  const exp = load("fixtures/expected/view.actual.json");
  const run = plan(fromBeam(load("fixtures/beam.sample.json")));
  const lay = layoutActual(run, parseTime(exp.nowAt));
  assert.equal(lay.prefix, "+");
  assert.equal(lay.label, "Agent");
  assert.equal(lay.rows, exp.rows);
  assert.equal(lay.unstarted, exp.unstarted);
  near(lay.now, exp.now, 1e-4, "now");
  near(lay.span, exp.span, 1e-4, "span");
  assert.deepEqual(
    lay.items.map((i) => ({ id: i.t.id, row: i.row, s: r4(i.s), e: r4(i.e) })),
    exp.items,
  );
  assert.deepEqual(lay.gates.map((g) => ({ key: g.k, at: r4(g.at) })), exp.gates);
  assert.deepEqual(layoutActual(run, exp.nowAt).items.map((i) => i.row), exp.items.map((i) => i.row));
});

test("AC-5: actual bars pack into the lowest free row, clamp end to start and skip unstarted tickets", () => {
  const h = (n) => new Date(Date.UTC(2026, 0, 1, n)).toISOString();
  const run = {
    runState: "running",
    runStartedAt: Date.UTC(2026, 0, 1, 0),
    gates: [{ key: "G0", greenAt: Date.UTC(2026, 0, 1, 3) }],
    tickets: [
      { id: "A", status: "merged", claimedAt: h(0), pr: { mergedAt: h(2) } },
      { id: "B", status: "coding", claimedAt: h(1), pr: {} },
      { id: "C", status: "merged", claimedAt: h(2), pr: { mergedAt: h(1) } },
      { id: "D", status: "parked", pr: {}, events: [] },
      { id: "E", status: "review", pr: { openedAt: h(4) } },
      { id: "F", status: "fix", pr: {}, events: [{ type: "status", to: "coding", at: h(5) }] },
    ],
  };
  const lay = layoutActual(run, Date.UTC(2026, 0, 1, 6));
  const row = Object.fromEntries(lay.items.map((i) => [i.t.id, i]));
  assert.equal(lay.unstarted, 1);
  assert.equal(row.D, undefined);
  assert.deepEqual([row.A.row, row.B.row, row.C.row, row.E.row, row.F.row], [0, 1, 0, 0, 2]);
  assert.equal(row.C.e, 2.05);
  assert.equal(row.B.e, 6);
  assert.equal(row.F.s, 5);
  assert.equal(lay.now, 6);
  assert.equal(lay.rows, 3);
  assert.deepEqual(lay.gates.map((g) => [g.k, g.at]), [["G0", 3]]);

  const ended = layoutActual({ ...run, runEndedAt: Date.UTC(2026, 0, 1, 8) }, Date.UTC(2026, 0, 2));
  assert.equal(ended.now, null);
  assert.equal(ended.items.find((i) => i.t.id === "B").e, 8);

  const paused = layoutActual({ ...run, paused: true, updated: Date.UTC(2026, 0, 1, 7) }, Date.UTC(2026, 0, 2));
  assert.equal(paused.now, 7);
});

test("AC-5: layoutPlan draws one bar per ticket on its slot with gates at gateAt", () => {
  const run = plan(fromBeam(load("fixtures/big/beam.sample.json")));
  const lay = layoutPlan(run);
  assert.equal(lay.prefix, "T+");
  assert.equal(lay.label, "Slot");
  assert.equal(lay.rows, 10);
  assert.equal(lay.span, 177);
  assert.equal(lay.now, null);
  assert.equal(lay.items.length, 68);
  for (const i of lay.items) {
    assert.equal(i.row, i.t.slot);
    assert.equal(i.s, i.t.start);
    assert.equal(i.e, i.t.start + i.t.hours);
    assert.equal(i.sz, true);
  }
  assert.deepEqual(
    lay.gates.map((g) => [g.k, g.at, g.g.key]),
    Object.entries(load("fixtures/expected/big.plan.json").gateAt).map(([k, at]) => [k, at, k]),
  );
});

test("AC-6: a dependency cycle returns within 100 ms, every ticket gets a slot, cycle members are unplaced", () => {
  const tickets = [
    { id: "A", hours: 4, deps: ["B"], autoMerge: true },
    { id: "B", hours: 7, deps: ["C"], autoMerge: true },
    { id: "C", hours: 11, deps: ["A"], autoMerge: false },
    { id: "D", hours: 4, deps: [], autoMerge: true },
    { id: "E", hours: 7, deps: ["D"], autoMerge: true },
    { id: "F", hours: 4, deps: ["A"], autoMerge: true },
  ];
  for (let i = 0; i < 300; i++) tickets.push({ id: `X-${i}`, hours: 4, deps: [`X-${(i + 1) % 300}`], autoMerge: true });
  const run = { kind: "beam", gateOrder: "strict", cap: 4, gates: [], tickets };
  const t0 = performance.now();
  plan(run);
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `plan took ${ms.toFixed(1)} ms`);
  for (const t of run.tickets) {
    assert.ok(Number.isInteger(t.slot) && t.slot >= 0 && t.slot < 4, `${t.id} has a slot`);
    assert.ok(Number.isFinite(t.start) && Number.isFinite(t.mergeAt), `${t.id} has a time`);
  }
  const unplaced = run.tickets.filter((t) => t.unplaced).map((t) => t.id);
  assert.ok(["A", "B", "C", "F"].every((id) => unplaced.includes(id)));
  assert.ok(!unplaced.includes("D") && !unplaced.includes("E"));
  const placedEnd = Math.max(...run.tickets.filter((t) => !t.unplaced).map((t) => t.end));
  assert.ok(run.tickets.filter((t) => t.unplaced).every((t) => t.start >= placedEnd));
});

test("AC-6: a cycle inside an earlier block lays every later block out as unplaced, in strict order", () => {
  const run = plan({
    kind: "beam",
    gateOrder: "strict",
    cap: 2,
    gates: [{ key: "G0", members: ["A", "B"] }, { key: "G1", members: ["C"] }],
    tickets: [
      { id: "A", hours: 4, deps: ["B"], autoMerge: true },
      { id: "B", hours: 4, deps: ["A"], autoMerge: true },
      { id: "C", hours: 4, deps: [], autoMerge: true },
    ],
  });
  assert.ok(run.tickets.every((t) => t.unplaced && t.slot >= 0));
  assert.equal(run.finish, 8);
});

test("AC-6: an empty run plans to zero without throwing", () => {
  const run = plan({ kind: "beam", gates: [], tickets: [] });
  assert.equal(run.finish, 0);
  assert.equal(run.slots, 0);
  assert.equal(run.peak, 0);
  assert.equal(run.waves, 0);
  assert.equal(layoutPlan(run).rows, 1);
  assert.equal(layoutActual(run, 0).rows, 1);
});

test("AC-7: simulation honours the approval wait, priority order and the lowest free slot", () => {
  const run = plan({
    kind: "beam",
    gateOrder: "strict",
    cap: 2,
    critical: ["Z"],
    estimate: { approvalHours: 1 },
    gates: [],
    tickets: [
      { id: "A", hours: 4, deps: [], autoMerge: true, rank: 2 },
      { id: "B", hours: 4, deps: [], autoMerge: true, rank: 1 },
      { id: "Z", hours: 11, deps: [], autoMerge: false },
      { id: "Y", hours: 2, deps: ["Z"], autoMerge: true },
    ],
  });
  const t = Object.fromEntries(run.tickets.map((x) => [x.id, x]));
  assert.equal(t.Z.critical, true);
  assert.deepEqual([t.Z.slot, t.Z.start, t.Z.end, t.Z.mergeAt], [0, 0, 11, 12]);
  assert.deepEqual([t.B.slot, t.B.start], [1, 0]);
  assert.deepEqual([t.A.slot, t.A.start], [1, 4]);
  assert.deepEqual([t.Y.slot, t.Y.start], [0, 12]);
  assert.equal(run.finish, 14);
  assert.equal(run.peak, 2);
  assert.equal(run.critHours, 11);
  assert.equal(run.critCount, 1);
  assert.equal(run.waves, 2);
});
