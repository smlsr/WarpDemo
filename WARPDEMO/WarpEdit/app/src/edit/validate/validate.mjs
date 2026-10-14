// Validation before save (SPEC §8): validate(beam) → {errors, warnings}.
import { ACTIVE, STATUS_CAT, TERMINAL } from "../../../../../WarpView/app/src/core/status.mjs";

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function ticketList(beam) {
  const t = beam && beam.tickets;
  if (Array.isArray(t)) return t.filter((x) => x && typeof x === "object").map((x) => ({ id: x.id == null ? "" : String(x.id), ticket: x }));
  if (t && typeof t === "object") {
    return Object.keys(t)
      .filter((k) => t[k] && typeof t[k] === "object")
      .map((k) => ({ id: t[k].id == null ? k : String(t[k].id), ticket: t[k] }));
  }
  return [];
}

function depsOf(ticket) {
  const out = [];
  for (const key of ["deps", "after"]) {
    const v = ticket[key];
    if (v == null) continue;
    for (const d of Array.isArray(v) ? v : [v]) {
      const s = String(d);
      if (s !== "" && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

const isOtherRun = (dep) => dep.includes(":");

function natural(a, b) {
  return a.localeCompare(b, "en", { numeric: true });
}

function findCycles(ids, graph) {
  const color = new Map();
  const stack = [];
  const seen = new Set();
  const cycles = [];
  const visit = (id) => {
    color.set(id, 1);
    stack.push(id);
    for (const d of graph.get(id)) {
      const c = color.get(d) || 0;
      if (c === 0) visit(d);
      else if (c === 1) {
        const loop = stack.slice(stack.indexOf(d));
        const start = loop.reduce((m, x, i) => (natural(x, loop[m]) < 0 ? i : m), 0);
        const ring = loop.slice(start).concat(loop.slice(0, start));
        const key = ring.join("\u0000");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(ring);
        }
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of ids) if (!color.get(id)) visit(id);
  return cycles;
}

export function validate(beam) {
  const errors = [];
  const warnings = [];
  const list = ticketList(beam);
  const byId = new Map();
  const dupes = new Set();

  for (const { id, ticket } of list) {
    if (byId.has(id)) {
      if (!dupes.has(id)) {
        dupes.add(id);
        errors.push({ code: "duplicate-id", ticket: id, message: `${id} appears more than once in this run` });
      }
    } else byId.set(id, ticket);
  }

  const ids = [...byId.keys()].sort(natural);
  const graph = new Map();

  for (const id of ids) {
    const ticket = byId.get(id);
    const inRun = [];
    for (const dep of depsOf(ticket)) {
      if (byId.has(dep)) inRun.push(dep);
      else if (!isOtherRun(dep)) {
        errors.push({ code: "dep-missing", ticket: id, message: `${id} depends on ${dep}, which is not in this run` });
      }
    }
    graph.set(id, inRun.sort(natural));
  }

  for (const ring of findCycles(ids, graph)) {
    const path = ring.concat(ring[0]);
    errors.push({ code: "cycle", ticket: ring[0], message: path.join(" → ") });
  }

  for (const id of ids) {
    const ticket = byId.get(id);
    const status = ticket.status;
    if (status != null && status !== "" && !has(STATUS_CAT, status)) {
      errors.push({ code: "unknown-status", ticket: id, message: `${id} has status ${status}, which is not a Warp status` });
    }
    const resets = Array.isArray(ticket.resets) ? ticket.resets : [];
    if (resets.length) {
      const last = resets[resets.length - 1];
      if (last && last.to !== status) {
        errors.push({
          code: "reset-log",
          ticket: id,
          message: `${id} is ${status} but its last reset went to ${last.to}`,
        });
      }
    }
  }

  for (const id of ids) {
    const ticket = byId.get(id);
    if (ticket.status === "merged") {
      const open = graph.get(id).filter((d) => byId.get(d).status !== "merged");
      if (open.length) {
        warnings.push({
          code: "merged-on-unmerged",
          ticket: id,
          message: `${id} is merged but depends on ${open.join(", ")}, which ${open.length === 1 ? "is" : "are"} not merged`,
        });
      }
    }
    for (const dep of graph.get(id)) {
      const root = byId.get(dep);
      const resets = Array.isArray(root.resets) ? root.resets : [];
      if (resets.length && !TERMINAL.has(root.status) && ACTIVE.has(ticket.status)) {
        warnings.push({
          code: "in-flight-dependent",
          ticket: id,
          message: `${id} is ${ticket.status} although its dependency ${dep} was reset to ${root.status}`,
        });
      }
    }
  }

  return { errors, warnings };
}
