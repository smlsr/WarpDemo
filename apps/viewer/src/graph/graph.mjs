// Dependency graph and ready-set (WV-04).
//
// Input is the model from src/parse (or any { tickets: [...] } with id, deps, locks, status).
// Pure functions only: nothing here reads files, the clock, or the DOM.
//
// Rules, matching the Warp dispatcher:
//   - A dep is closed only when its ticket is merged. Anything else is an open blocker.
//   - A ticket is ready when it is not started, has no open blocker, and holds no lock
//     that overlaps a lock held by a started ticket or by a ready ticket ahead of it.
//   - Order is plan order, so the earlier ticket of an overlapping pair is ready and
//     the later one stays queued with reason "lock".

const DONE = new Set(['merged', 'done']);
// A claimed ticket owns its locks until it merges. alarm keeps them too.
const ACTIVE = new Set([
  'claimed',
  'planning',
  'coding',
  'review',
  'fix',
  'running',
  'working',
  'alarm',
]);

const norm = (s) => String(s ?? '').trim().toLowerCase();

export const isDone = (ticket) => DONE.has(norm(ticket?.status));
export const isActive = (ticket) => ACTIVE.has(norm(ticket?.status));
// Not merged and not started: the only state a ticket can be dispatched from.
export const isQueued = (ticket) => !isDone(ticket) && !isActive(ticket);

const asList = (model) => (Array.isArray(model) ? model : model?.tickets || []);

const cleanPath = (p) =>
  String(p ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');

// Two locks overlap when they are the same path or one contains the other.
// apps/viewer/src overlaps apps/viewer/src/graph, but not apps/viewer/src2.
export function pathsOverlap(a, b) {
  const x = cleanPath(a);
  const y = cleanPath(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

// The locks of a and b that collide, as [lockA, lockB] pairs. Empty when they do not.
export function lockOverlaps(a, b) {
  const out = [];
  for (const la of a?.locks || []) {
    for (const lb of b?.locks || []) {
      if (pathsOverlap(la, lb)) out.push([la, lb]);
    }
  }
  return out;
}

export const locksConflict = (a, b) => lockOverlaps(a, b).length > 0;

// Build the graph. Edges run blocker -> dependent. Unknown deps are kept as blockers
// (they can never close) and listed in `missing`, so a bad plan reads as not ready.
export function buildGraph(model) {
  const tickets = asList(model);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const blockersOf = new Map();
  const dependentsOf = new Map(tickets.map((t) => [t.id, []]));
  const edges = [];
  const missing = [];

  for (const t of tickets) {
    const deps = [...new Set(t.deps || [])];
    blockersOf.set(t.id, deps);
    for (const dep of deps) {
      edges.push({ from: dep, to: t.id });
      if (byId.has(dep)) dependentsOf.get(dep).push(t.id);
      else missing.push({ ticketId: t.id, dep });
    }
  }

  // Kahn's algorithm. Whatever never reaches indegree 0 is on or behind a cycle.
  const indegree = new Map();
  for (const t of tickets) {
    indegree.set(t.id, blockersOf.get(t.id).filter((d) => byId.has(d)).length);
  }
  const queue = tickets.filter((t) => indegree.get(t.id) === 0).map((t) => t.id);
  const order = [];
  const depth = new Map();
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    const d = blockersOf.get(id).reduce((m, b) => Math.max(m, (depth.get(b) ?? -1) + 1), 0);
    depth.set(id, d);
    for (const next of dependentsOf.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  const cyclic = tickets.map((t) => t.id).filter((id) => !order.includes(id));

  return {
    ids: tickets.map((t) => t.id),
    byId,
    edges,
    missing,
    order,
    depth,
    cyclic,
    blockers: (id) => [...(blockersOf.get(id) || [])],
    dependents: (id) => [...(dependentsOf.get(id) || [])],
  };
}

// Deps of a ticket that are not merged yet, in dep order. Unknown deps count as open.
export function openBlockers(ticketOrId, model) {
  const graph = model?.byId instanceof Map && model.blockers ? model : buildGraph(model);
  const id = typeof ticketOrId === 'string' ? ticketOrId : ticketOrId.id;
  return graph.blockers(id).filter((dep) => {
    const t = graph.byId.get(dep);
    return !t || !isDone(t);
  });
}

// Every ticket that must merge before `id`, nearest first, without repeats.
export function transitiveBlockers(id, model) {
  const graph = model?.byId instanceof Map && model.blockers ? model : buildGraph(model);
  const seen = new Set();
  const out = [];
  const queue = [...graph.blockers(id)];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next) || next === id) continue;
    seen.add(next);
    out.push(next);
    queue.push(...graph.blockers(next));
  }
  return out;
}

// Ready set, with a reason for every ticket that is left queued.
//
//   ready:  ids that can start now, in plan order
//   queued: [{ id, reason: 'blocked' | 'lock' | 'cap', blockedBy: [ids], lockedBy: [ids] }]
//   active: ids that hold locks now
//   done:   ids already merged
//
// opts.limit caps how many tickets may be ready at once (maxAgents minus active, by caller).
export function readySet(model, opts = {}) {
  const graph = buildGraph(model);
  const tickets = graph.ids.map((id) => graph.byId.get(id));
  const holders = tickets.filter(isActive);
  const claimed = [...holders];
  const ready = [];
  const queued = [];
  const limit = Number.isFinite(opts.limit) ? Math.max(0, opts.limit) : Infinity;

  for (const t of tickets) {
    if (!isQueued(t)) continue;
    const blockedBy = openBlockers(t, graph);
    if (blockedBy.length) {
      queued.push({ id: t.id, reason: 'blocked', blockedBy, lockedBy: [] });
      continue;
    }
    // Locks are held by started tickets and by ready tickets earlier in plan order.
    const lockedBy = claimed.filter((c) => locksConflict(t, c)).map((c) => c.id);
    if (lockedBy.length) {
      queued.push({ id: t.id, reason: 'lock', blockedBy: [], lockedBy });
      continue;
    }
    if (ready.length >= limit) {
      queued.push({ id: t.id, reason: 'cap', blockedBy: [], lockedBy: [] });
      continue;
    }
    ready.push(t.id);
    claimed.push(t);
  }

  return {
    ready,
    queued,
    active: holders.map((t) => t.id),
    done: tickets.filter(isDone).map((t) => t.id),
  };
}

export const isReady = (id, model, opts) => readySet(model, opts).ready.includes(id);
