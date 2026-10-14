// Dependents of an un-merged ticket (SPEC §6). Pure: plans the cascade, never starts or changes anything.
const MERGED = new Set(["merged", "done"]);
const TERMINAL_TARGETS = new Set(["merged", "done", "skipped"]);
const IN_FLIGHT = new Set([
  "claimed",
  "planning",
  "coding",
  "review",
  "fix",
  "awaiting_approval",
  "merging",
  "recovering",
  "bugbot_running",
]);

function ticketList(run) {
  const tickets = run && run.tickets;
  if (Array.isArray(tickets)) return tickets.filter((t) => t && t.id != null);
  if (tickets && typeof tickets === "object") return Object.values(tickets).filter((t) => t && t.id != null);
  return [];
}

function localRefs(t) {
  const out = [];
  for (const key of ["deps", "after"]) {
    const list = t[key];
    if (!Array.isArray(list)) continue;
    for (const ref of list) {
      if (typeof ref === "string" && ref !== "" && !ref.includes(":")) out.push(ref);
    }
  }
  return out;
}

// Transitive dependents through deps and after, in the order the run lists its tickets.
export function dependentsOf(run, id) {
  const tickets = ticketList(run);
  const children = new Map();
  for (const t of tickets) {
    for (const ref of localRefs(t)) {
      if (!children.has(ref)) children.set(ref, []);
      children.get(ref).push(t.id);
    }
  }
  const seen = new Set();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const child of children.get(cur) || []) {
      if (child === id || seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return tickets.filter((t) => seen.has(t.id)).map((t) => t.id);
}

export function planDependents(run, id, from, to) {
  const plan = { ticket: id, from, to, blocked: [], inFlight: [], alreadyMerged: [], dependents: [], warnings: [] };
  if (!MERGED.has(from) || TERMINAL_TARGETS.has(to)) return plan;
  const byId = new Map(ticketList(run).map((t) => [t.id, t]));
  for (const depId of dependentsOf(run, id)) {
    const status = byId.get(depId).status;
    if (status === "queued") {
      plan.blocked.push(depId);
      plan.dependents.push({ id: depId, from: status, to: "blocked", note: `blocked by reset of ${id}` });
    } else if (IN_FLIGHT.has(status)) {
      plan.inFlight.push(depId);
      plan.warnings.push({ id: depId, status, message: `in flight on top of ${id}` });
    } else if (MERGED.has(status)) {
      plan.alreadyMerged.push(depId);
      plan.warnings.push({ id: depId, status, message: "already merged on top" });
    }
  }
  return plan;
}
