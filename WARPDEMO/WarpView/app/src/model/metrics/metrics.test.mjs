import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeMetrics, utilization } from "./metrics.mjs";
import { assignBlocks } from "../blocks/blocks.mjs";
import { catOf, normStatus } from "../../core/status.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const load = (p) => JSON.parse(readFileSync(join(FIX, p), "utf8"));
const list = (v) => (Array.isArray(v) ? v : []).map(String);
const NOW = Date.parse("2026-10-12T20:00:00Z");
const SIZE_HOURS = { S: 4, M: 7, L: 11, XL: 16 };

const ticket = (raw, id) => {
  const status = normStatus(raw.status);
  const size = raw.size in SIZE_HOURS ? raw.size : null;
  const own = typeof raw.hours === "number" && raw.hours > 0 ? raw.hours : null;
  const usage = raw.usage || {};
  return {
    id: String(raw.id || id),
    size,
    status,
    cat: catOf(status),
    hours: own != null ? own : SIZE_HOURS[size || "M"],
    hoursFrom: own != null ? "ticket" : size ? "size " + size : "default M",
    autoMerge: typeof raw.autoMerge === "boolean" ? raw.autoMerge : size ? size === "S" || size === "M" : true,
    deps: list(raw.deps).concat(list(raw.after)),
    gate: raw.gate || "",
    critical: !!raw.critical,
    agent: raw.agent || null,
    minutes: Number(raw.minutes) || 0,
    tokens: Number(raw.tokens) || 0,
    cost: typeof usage.cost === "number" ? usage.cost : null,
  };
};

const fromBeam = (b, plan) => {
  const cfg = b.config || {};
  const est = (b.program && b.program.estimate) || null;
  const run = {
    kind: "beam",
    runState: b.runState,
    cap: cfg.maxAgents || 18,
    estimate: est,
    metrics: b.metrics || null,
    gates: (b.gates || []).map((g) => ({ ...g, members: list(g.members) })),
    tickets: Object.entries(b.tickets).map(([id, t]) => ticket(t, id)),
    runStartedAt: Date.parse(b.runStartedAt),
    runEndedAt: b.runEndedAt ? Date.parse(b.runEndedAt) : null,
    updated: Date.parse(b.checkpointAt),
    finish: plan ? plan.finish : null,
  };
  assignBlocks(run);
  return run;
};

const fromStatus = (s, finish) => ({
  kind: "status",
  runState: s.runState,
  cap: 18,
  estimate: null,
  metrics: s.metrics || null,
  gates: [],
  tickets: [].concat(s.done, s.working, s.left).map((r) => ticket(r, r.id)),
  runStartedAt: null,
  runEndedAt: null,
  updated: Date.parse(s.updatedAt),
  finish,
});

const view = () => fromBeam(load("beam.sample.json"), load("expected/view.plan.json"));
const big = () => fromBeam(load("big/beam.sample.json"), load("expected/big.plan.json"));

test("AC-1: sample beam metrics equal view.metrics.json", () => {
  assert.deepEqual(computeMetrics([view()], NOW), load("expected/view.metrics.json"));
});

test("AC-2: big beam gives estimate 105.5, 752 agent hours, 25 people hours, 68 tickets with 25 completed", () => {
  const m = computeMetrics([big()], NOW);
  assert.equal(m.estTotal, 105.5);
  assert.equal(m.agentTotal, 752);
  assert.equal(m.humanTotal, 25);
  assert.equal(m.ticketTotal, 68);
  assert.equal(m.count.done, 25);
  assert.deepEqual(m, load("expected/big.metrics.json"));
});

test("AC-3: a status file alone has no estimate or shares but has agent hours and tickets", () => {
  const m = computeMetrics([fromStatus(load("status.sample.json"), 16.5)], NOW);
  assert.equal(m.estTotal, null);
  assert.deepEqual(m.share, { done: null, prog: null, err: null, todo: null });
  assert.equal(m.humanPlan, null);
  assert.equal(m.agentTotal, 127);
  assert.equal(m.ticketTotal, 16);
  assert.deepEqual(m, load("expected/status-only.metrics.json"));
});

test("AC-4: status teleporting with no size counts as to do with 7 h and nothing throws", () => {
  const run = {
    runState: "running",
    gates: [],
    tickets: [ticket({ id: "X-1", status: "teleporting" }, "X-1")],
  };
  let m;
  assert.doesNotThrow(() => {
    m = computeMetrics([run], NOW);
  });
  assert.equal(m.count.todo, 1);
  assert.equal(m.agent.todo, 7);
  assert.equal(m.agentTotal, 7);
  assert.doesNotThrow(() => computeMetrics([{ tickets: [{ id: "X-2", status: "teleporting" }] }], NOW));
  assert.doesNotThrow(() => computeMetrics([{}, null], NOW));
  assert.doesNotThrow(() => computeMetrics(undefined, NOW));
  const raw = computeMetrics([{ tickets: [{ id: "X-2", status: "teleporting" }] }], NOW);
  assert.equal(raw.count.todo, 1);
  assert.equal(raw.agent.todo, 7);
});

test("AC-5: utilization reports active over cap, spent over estimate, and rows by size and agent", () => {
  const u = utilization([view()]);
  assert.equal(u.cap, 18);
  assert.equal(u.active, 4);
  assert.equal(u.total, 16);
  assert.equal(u.done, 9);
  assert.equal(u.estH, 127);
  assert.equal(u.spentH, 34.166666666666664);
  assert.equal(u.tokens, 7421045);
  assert.deepEqual(
    u.bySize.map((r) => r.key),
    ["S", "M", "L", "XL"],
  );
  assert.equal(u.bySize.reduce((a, r) => a + r.n, 0), 16);
  assert.equal(u.byAgent.reduce((a, r) => a + r.minutes, 0), 2050);
  const none = utilization([fromStatus(load("status.sample.json"), null)]);
  assert.equal(none.estH, null);
  assert.deepEqual(utilization([]), {
    active: 0,
    cap: null,
    spentH: 0,
    estH: null,
    tokens: 0,
    done: 0,
    total: 0,
    bySize: [],
    byAgent: [],
  });
});

test("AC-1: elapsed hours read ISO strings and stop at runEndedAt or updated when the run is not running", () => {
  const base = { tickets: [], gates: [], runStartedAt: "2026-10-11T14:00:00Z" };
  assert.equal(computeMetrics([{ ...base, runState: "running" }], NOW).elapsed, 30);
  assert.equal(computeMetrics([{ ...base, runState: "paused", updated: "2026-10-11T16:00:00Z" }], NOW).elapsed, 2);
  assert.equal(computeMetrics([{ ...base, runState: "running", runEndedAt: "2026-10-11T15:30:00Z" }], NOW).elapsed, 1.5);
});

test("AC-1: a resumed run whose runEndedAt predates its last activity runs on to that activity", () => {
  const done = [ticket({ id: "X-1", status: "merged" }, "X-1")];
  const base = { gates: [], runStartedAt: "2026-10-11T14:00:00Z", runEndedAt: "2026-10-11T15:00:00Z", updated: "2026-10-11T18:00:00Z" };
  assert.equal(computeMetrics([{ ...base, runState: "running", tickets: done }], NOW).elapsed, 4);
  assert.equal(computeMetrics([{ ...base, runState: "stopped", tickets: done }], NOW).elapsed, 4);
  const open = [ticket({ id: "X-2", status: "coding" }, "X-2")];
  assert.equal(computeMetrics([{ ...base, runState: "running", tickets: open }], NOW).elapsed, 30, "a live run with open work runs to now");
});

test("AC-1: ETA left is 0 when every ticket is terminal, even if beam.metrics.etaHours is stale", () => {
  const tickets = [ticket({ id: "X-1", status: "merged", critical: true }, "X-1"), ticket({ id: "X-2", status: "done" }, "X-2")];
  assert.equal(computeMetrics([{ gates: [], tickets, metrics: { etaHours: 11 } }], NOW).eta, 0);
  const open = [...tickets, ticket({ id: "X-3", status: "coding" }, "X-3")];
  assert.equal(computeMetrics([{ gates: [], tickets: open, metrics: { etaHours: 11 } }], NOW).eta, 11);
});

test("AC-2: across runs the estimate, elapsed, ETA left and swimlane finish are added, not the longest run", () => {
  const a = { gates: [], tickets: [ticket({ id: "A-1", status: "coding" }, "A-1")], estimate: { elapsedHours: 69 }, metrics: { etaHours: 3 }, finish: 76, runStartedAt: "2026-10-11T14:00:00Z", runEndedAt: "2026-10-11T18:00:00Z" };
  const b = { gates: [], tickets: [ticket({ id: "B-1", status: "coding" }, "B-1")], estimate: { elapsedHours: 57 }, metrics: { etaHours: 2 }, finish: 58, runStartedAt: "2026-10-11T10:00:00Z", runEndedAt: "2026-10-11T11:00:00Z" };
  const m = computeMetrics([a, b], NOW);
  assert.equal(m.estTotal, 126);
  assert.equal(m.elapsed, 5);
  assert.equal(m.eta, 5);
  assert.equal(m.finish, 134);
  assert.equal(computeMetrics([a], NOW).estTotal, 69);
  assert.equal(computeMetrics([{ ...a, estimate: null }, { ...b, estimate: null }], NOW).estTotal, null);
});
