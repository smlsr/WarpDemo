import { gateKeys, assignBlocks } from "../blocks/blocks.mjs";
import { ACTIVE, TERMINAL, catOf } from "../../core/status.mjs";
import { natCmp, num, parseTime } from "../../core/util.mjs";

export const DEFAULT_CAP = 18;
export const DEFAULT_APPROVAL = 0.5;
const MAX_SLOTS = 64;
const EPS = 1e-9;

const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const flag = (v) => (v ? 1 : 0);

const toMs = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "number") return isFinite(v) ? v : null;
  return parseTime(v);
};

const gateOf = (run, key) => (run.gates || []).find((g) => g && String(g.key) === key) || null;

const hasPlanned = (t) =>
  t.planned && typeof t.planned.slot === "number" && typeof t.planned.start === "number" && typeof t.planned.merge === "number";

function chainWeights(ts, byId, deps) {
  const kids = new Map();
  for (const t of ts) for (const d of deps(t)) {
    if (!kids.has(d)) kids.set(d, []);
    kids.get(d).push(t.id);
  }
  const tail = new Map();
  const weight = (id, seen) => {
    if (tail.has(id)) return tail.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const w = byId.get(id).hours + Math.max(0, ...(kids.get(id) || []).map((k) => weight(k, seen)));
    seen.delete(id);
    tail.set(id, w);
    return w;
  };
  for (const t of ts) weight(t.id, new Set());
  return tail;
}

function waveCount(ts, byId, deps) {
  const depth = new Map();
  const lvl = (id, seen) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const v = 1 + Math.max(0, ...deps(byId.get(id)).map((d) => lvl(d, seen)));
    seen.delete(id);
    depth.set(id, v);
    return v;
  };
  for (const t of ts) lvl(t.id, new Set());
  return ts.length ? Math.max(...depth.values()) : 0;
}

function asWritten(run, ts, byId) {
  for (const t of ts) {
    t.slot = t.planned.slot - 1;
    t.start = t.planned.start;
    t.end = t.planned.start + t.hours;
    t.mergeAt = Math.max(t.planned.merge, t.end);
    t.unplaced = false;
  }
  const evs = [];
  for (const t of ts) evs.push([t.start, 1], [t.end, -1]);
  evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let pk = 0;
  for (const e of evs) {
    cur += e[1];
    pk = Math.max(pk, cur);
  }
  run.planSource = "schedule";
  run.finish = Math.max(0, ...ts.map((t) => t.mergeAt));
  run.peak = pk;
  run.slots = Math.max(...ts.map((t) => t.slot)) + 1;
  run.gateAt = new Map();
  for (const k of gateKeys(run)) {
    const g = gateOf(run, k);
    if (typeof g.at === "number" && isFinite(g.at)) {
      run.gateAt.set(k, g.at);
      continue;
    }
    const ids = (g.members || []).map(String).filter((m) => byId.has(m));
    if (ids.length) run.gateAt.set(k, Math.max(...ids.map((id) => byId.get(id).mergeAt)));
  }
}

function simulate(run, ts, byId, deps, tail) {
  run.planSource = "simulated";
  const rank = run.blockRank || new Map();
  const strict = run.gateOrder !== "deps" && run.kind === "beam" && rank.size > 1;
  const cap = Math.max(1, Math.min(num(run.cap) || DEFAULT_CAP, MAX_SLOTS));
  const approval = num(run.estimate && run.estimate.approvalHours) || DEFAULT_APPROVAL;
  const prio = (a, b) =>
    flag(b.critical) - flag(a.critical) ||
    flag(b.starred) - flag(a.starred) ||
    flag(b.priorityGate) - flag(a.priorityGate) ||
    (a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank) ||
    tail.get(b.id) - tail.get(a.id) ||
    natCmp(a.id, b.id);

  const pending = new Set(ts.map((t) => t.id));
  const mergeAt = new Map();
  const slotFree = new Array(cap).fill(0);
  const blockLeft = new Map();
  for (const t of ts) blockLeft.set(t.block, (blockLeft.get(t.block) || 0) + 1);
  const blockEnd = new Map();
  const blockOpen = (t, now) => {
    if (!strict) return true;
    const r = rank.get(t.block);
    for (const [k, i] of rank) if (i < r && (blockLeft.get(k) || 0) > 0) return false;
    for (const [k, i] of rank) if (i < r && blockEnd.has(k) && blockEnd.get(k) > now) return false;
    return true;
  };

  const layRest = (now) => {
    const t0 = Math.max(now, ...slotFree);
    for (const id of [...pending].sort(natCmp)) {
      const t = byId.get(id);
      const slot = slotFree.indexOf(Math.min(...slotFree));
      t.slot = slot;
      t.start = Math.max(t0, slotFree[slot]);
      t.end = t.start + t.hours;
      t.mergeAt = t.end;
      t.unplaced = true;
      slotFree[slot] = t.end;
      mergeAt.set(id, t.end);
      pending.delete(id);
      blockLeft.set(t.block, blockLeft.get(t.block) - 1);
    }
  };

  let now = 0;
  let peak = 0;
  let guard = 0;
  const limit = 4 * ts.length + 64;
  const running = [];
  while (pending.size) {
    if (guard++ > limit) {
      layRest(now);
      break;
    }
    for (let i = running.length - 1; i >= 0; i--) {
      if (running[i].merge > now) continue;
      const t = running[i].t;
      blockLeft.set(t.block, blockLeft.get(t.block) - 1);
      blockEnd.set(t.block, Math.max(blockEnd.get(t.block) || 0, running[i].merge));
      running.splice(i, 1);
    }
    const ready = [...pending]
      .map((id) => byId.get(id))
      .filter((t) => deps(t).every((d) => mergeAt.has(d) && mergeAt.get(d) <= now) && blockOpen(t, now))
      .sort(prio);
    for (const t of ready) {
      const slot = slotFree.findIndex((f) => f <= now + EPS);
      if (slot < 0) break;
      const end = now + t.hours;
      const merge = end + (t.autoMerge ? 0 : approval);
      t.slot = slot;
      t.start = now;
      t.end = end;
      t.mergeAt = merge;
      t.unplaced = false;
      slotFree[slot] = end;
      mergeAt.set(t.id, merge);
      running.push({ t, merge });
      pending.delete(t.id);
    }
    peak = Math.max(peak, slotFree.filter((f) => f > now + EPS).length);
    const next = [
      ...slotFree.filter((f) => f > now + EPS),
      ...running.map((r) => r.merge).filter((m) => m > now + EPS),
    ];
    if (!next.length) {
      if (pending.size) layRest(now);
      break;
    }
    now = Math.min(...next);
  }

  run.finish = Math.max(0, ...ts.map((t) => t.mergeAt || 0));
  run.peak = peak;
  run.slots = ts.length ? Math.max(...ts.map((t) => t.slot)) + 1 : 0;
  run.gateAt = new Map();
  for (const k of gateKeys(run)) {
    const g = gateOf(run, k);
    const ids = new Set(
      ts
        .filter((t) => t.block === k)
        .map((t) => t.id)
        .concat((g.members || []).map(String).filter((m) => byId.has(m))),
    );
    if (!ids.size) continue;
    run.gateAt.set(k, Math.max(...[...ids].map((id) => byId.get(id).mergeAt || 0)));
  }
}

export function plan(run) {
  if (!Array.isArray(run.tickets)) run.tickets = [];
  if (!Array.isArray(run.gates)) run.gates = [];
  assignBlocks(run);
  const ts = run.tickets;
  const byId = new Map(ts.map((t) => [t.id, t]));
  const crit = new Set((run.critical || []).map(String));
  for (const t of ts) if (crit.has(t.id)) t.critical = true;
  const deps = (t) => (t.deps || []).filter((d) => byId.has(d) && d !== t.id);
  const tail = chainWeights(ts, byId, deps);
  run.waves = waveCount(ts, byId, deps);

  if (ts.length && ts.every(hasPlanned)) asWritten(run, ts, byId);
  else simulate(run, ts, byId, deps, tail);

  const critical = ts.filter((t) => t.critical);
  run.critHours = sum(critical.map((t) => t.hours));
  run.critCount = critical.length;
  return run;
}

export function layoutPlan(run) {
  if (!(run.gateAt instanceof Map)) plan(run);
  const gates = gateKeys(run)
    .filter((k) => run.gateAt.has(k))
    .map((k) => ({ k, at: run.gateAt.get(k), g: gateOf(run, k) }));
  return {
    prefix: "T+",
    label: "Slot",
    rows: Math.max(1, run.slots),
    span: run.finish,
    now: null,
    unstarted: 0,
    items: run.tickets.map((t) => ({ t, row: t.slot, s: t.start, e: t.start + t.hours, sz: true })),
    gates,
  };
}

const startedInto = (to) => ACTIVE.has(to) || to === "merged" || to === "done";

function firstEvent(t) {
  const ts = (Array.isArray(t.events) ? t.events : [])
    .filter((e) => e && e.type === "status" && startedInto(e.to))
    .map((e) => parseTime(e.at))
    .filter((x) => x != null);
  return ts.length ? Math.min(...ts) : null;
}

function startOf(t) {
  const pr = t.pr || {};
  const cat = t.cat || catOf(t.status);
  return toMs(t.claimedAt) ?? toMs(pr.openedAt) ?? (cat !== "todo" ? firstEvent(t) : null);
}

export function layoutActual(run, now = Date.now()) {
  const clock = toMs(now) ?? Date.now();
  const ended = toMs(run.runEndedAt);
  const endNow = ended ?? (run.runState === "running" && !run.paused ? clock : toMs(run.updated) ?? clock);
  const tickets = run.tickets || [];
  const raw = [];
  for (const t of tickets) {
    const s0 = startOf(t);
    if (s0 == null) continue;
    const pr = t.pr || {};
    let e0 = toMs(pr.mergedAt) ?? (TERMINAL.has(t.status) ? toMs(t.updatedAt) : null) ?? endNow;
    if (e0 < s0) e0 = s0;
    raw.push({ t, s0, e0 });
  }
  const base = toMs(run.runStartedAt) ?? (raw.length ? Math.min(...raw.map((x) => x.s0)) : clock);
  const H = (ms) => Math.max(0, (ms - base) / 3600000);
  raw.sort((a, b) => a.s0 - b.s0 || natCmp(a.t.id, b.t.id));
  const free = [];
  const items = raw.map((x) => {
    const s = H(x.s0);
    const e = Math.max(H(x.e0), s + 0.05);
    let row = free.findIndex((f) => f <= s + EPS);
    if (row < 0) {
      row = free.length;
      free.push(e);
    } else free[row] = e;
    return { t: x.t, row, s, e, sz: false };
  });
  const gates = (run.gates || [])
    .filter((g) => g && toMs(g.greenAt) != null)
    .map((g) => ({ k: String(g.key), at: H(toMs(g.greenAt)), g }));
  const nowH = ended != null ? null : H(endNow);
  const span = Math.max(1, nowH || 0, ...items.map((i) => i.e), ...gates.map((g) => g.at));
  return {
    prefix: "+",
    label: "Agent",
    rows: Math.max(1, free.length),
    span,
    now: nowH,
    unstarted: tickets.length - items.length,
    items,
    gates,
  };
}
