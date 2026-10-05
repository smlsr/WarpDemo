// Merge beam.json, STATUS.md, and schedule.json into one model.
//
// Precedence per field:
//   plan shape  (deps, locks, size, hours, ac ...) : beam, then schedule
//   run state   (status, agent, branch, pr ...)    : beam, then STATUS.md, then "queued"
// The id universe is the union of all sources. Every dep must name a ticket in it.
import { parseStatus } from './status.mjs';

export class ModelError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'ModelError';
    this.problems = problems;
    // Ticket ids named by the failure, in order, without repeats.
    this.ticketIds = [...new Set(problems.map((p) => p.ticketId))];
  }
}

const asObject = (value, label) => {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (e) {
      throw new ModelError(`${label} is not valid JSON: ${e.message}`, [
        { code: 'bad-json', source: label, ticketId: null },
      ]);
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelError(`${label} must be a JSON object`, [
      { code: 'bad-shape', source: label, ticketId: null },
    ]);
  }
  return value;
};

// beam.json keeps tickets in an object keyed by id; schedule and fixtures use an array.
function ticketList(source, label) {
  const t = source.tickets;
  if (t == null) return [];
  const list = Array.isArray(t) ? t : typeof t === 'object' ? Object.values(t) : null;
  if (!list) {
    throw new ModelError(`${label}.tickets must be an array or an object`, [
      { code: 'bad-shape', source: label, ticketId: null },
    ]);
  }
  const bad = list.findIndex((x) => !x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id);
  if (bad >= 0) {
    throw new ModelError(`${label}.tickets[${bad}] has no id`, [
      { code: 'missing-id', source: label, ticketId: null },
    ]);
  }
  return list;
}

const strings = (v) => (Array.isArray(v) ? v.map(String) : []);
const pick = (...vals) => vals.find((v) => v !== undefined && v !== null);

function prUrl(pr) {
  if (!pr) return null;
  return typeof pr === 'string' ? pr : pr.url || null;
}

function mergeTicket(id, beam, sched, stat) {
  const b = beam || {};
  const s = sched || {};
  const st = stat || {};
  const ac = pick(b.ac, s.ac);
  const acs = Array.isArray(ac) ? ac.length : pick(b.acs, s.acs, 0);
  return {
    id,
    summary: pick(b.summary, s.summary, st.summary, ''),
    size: pick(b.size, s.size, st.size, null),
    hours: pick(b.hours, s.hours, null),
    area: pick(b.area, s.area, null),
    module: pick(b.module, s.module, null),
    layer: pick(b.layer, s.layer, null),
    priority: pick(b.priority, s.priority, null),
    deps: strings(pick(b.deps, s.deps, [])),
    unlocks: strings(pick(b.unlocks, s.unlocks, [])),
    locks: strings(pick(b.locks, s.locks, [])),
    critical: Boolean(pick(b.critical, s.critical, false)),
    rankDays: pick(b.rankDays, s.rankDays, null),
    gate: pick(b.gate, s.gate, null),
    ac: Array.isArray(ac) ? ac.map(String) : [],
    acs,
    autoMerge: pick(b.autoMerge, null),
    status: pick(b.status, st.status, 'queued'),
    agent: pick(b.agent, st.agent, null),
    branch: pick(b.branch, null),
    pr: prUrl(b.pr) || st.pr || null,
    jiraKey: pick(b.jiraKey, null),
    alarm: pick(b.alarm, null),
  };
}

// Collect every problem so one failure names all the tickets that need a fix.
export function validate(tickets, duplicates = []) {
  const ids = new Set(tickets.map((t) => t.id));
  const problems = [];
  for (const id of duplicates) {
    problems.push({
      code: 'duplicate-ticket',
      ticketId: id,
      message: `Ticket ${id} is defined more than once`,
    });
  }
  for (const t of tickets) {
    for (const dep of t.deps) {
      if (dep === t.id) {
        problems.push({
          code: 'self-dep',
          ticketId: t.id,
          dep,
          message: `Ticket ${t.id} depends on itself`,
        });
      } else if (!ids.has(dep)) {
        problems.push({
          code: 'missing-dep',
          ticketId: t.id,
          dep,
          message: `Ticket ${t.id} depends on ${dep}, which is not in the plan`,
        });
      }
    }
  }
  return problems;
}

export function buildModel({ beam = null, status = null, schedule = null } = {}) {
  const beamObj = asObject(beam, 'beam.json');
  const schedObj = asObject(schedule, 'schedule.json');
  const stat = typeof status === 'string' ? parseStatus(status) : status || null;
  if (!beamObj && !schedObj && !(stat && Object.keys(stat.tickets || {}).length)) {
    throw new ModelError('No tickets: give beam.json, schedule.json, or STATUS.md', [
      { code: 'no-input', ticketId: null },
    ]);
  }

  const beamTickets = new Map();
  const schedTickets = new Map();
  const duplicates = [];
  const index = (map, list) => {
    for (const t of list) {
      if (map.has(t.id)) duplicates.push(t.id);
      map.set(t.id, t);
    }
  };
  // The beam fixture and a live beam.json both land here; a fixture has no run state.
  if (beamObj) index(beamTickets, ticketList(beamObj, 'beam.json'));
  if (schedObj) index(schedTickets, ticketList(schedObj, 'schedule.json'));

  const order = [];
  const seen = new Set();
  const add = (id) => {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  // Order: schedule (plan order), then the beam, then any ticket only STATUS.md names.
  for (const id of schedTickets.keys()) add(id);
  for (const id of beamTickets.keys()) add(id);
  for (const id of Object.keys(stat?.tickets || {})) add(id);

  const tickets = order.map((id) =>
    mergeTicket(id, beamTickets.get(id), schedTickets.get(id), stat?.tickets?.[id]),
  );

  const problems = validate(tickets, [...new Set(duplicates)]);
  if (problems.length) {
    throw new ModelError(problems.map((p) => p.message).join('; '), problems);
  }

  const byId = Object.fromEntries(tickets.map((t) => [t.id, t]));
  // Fill unlocks from deps when the sources do not carry them.
  for (const t of tickets) {
    for (const dep of t.deps) {
      if (!byId[dep].unlocks.includes(t.id)) byId[dep].unlocks.push(t.id);
    }
  }

  const gates = pick(beamObj?.gates, schedObj?.gates, []);
  const criticalPath = strings(
    pick(schedObj?.criticalPath, beamObj?.program?.criticalPath, beamObj?.criticalPath, []),
  );

  return {
    tickets,
    byId,
    gates: Array.isArray(gates) ? gates : [],
    criticalPath,
    runState: pick(beamObj?.runState, stat?.runState, null),
    version: pick(stat?.version, null),
    updatedAt: pick(stat?.updatedAt, beamObj?.generatedAt, schedObj?.generated, null),
    module: pick(schedObj?.module, beamObj?.source?.module, null),
    sources: {
      beam: Boolean(beamObj),
      status: Boolean(stat),
      schedule: Boolean(schedObj),
    },
  };
}
