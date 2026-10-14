// Reset (SPEC §5): only the status moves; every timestamp, count and the first attempt's record stay as loaded.
import { check } from "../phases/phases.mjs";

const BY = "warpedit";

function ticketOf(beam, id) {
  const tickets = beam && beam.tickets;
  return tickets && Object.prototype.hasOwnProperty.call(tickets, id) ? tickets[id] : null;
}

function withTickets(beam, updates) {
  const ids = Object.keys(updates);
  if (!ids.length) return beam;
  return { ...beam, tickets: { ...beam.tickets, ...updates } };
}

function statusEvent(change, from, to, note) {
  return { at: change.at, type: "status", from, to, by: change.by || BY, note };
}

function resetEntry(change) {
  return { from: change.from, to: change.to, at: change.at, note: change.note };
}

function dependentNote(change, d) {
  return d.note || `blocked by reset of ${change.ticket}`;
}

export function buildReset(beam, id, to, note, at, by) {
  const ticket = ticketOf(beam, id);
  if (!ticket) {
    return { ok: false, result: "missing", message: `${id} is not in this run`, change: null };
  }
  const from = ticket.status;
  const verdict = check(from, to, id);
  if (!verdict.ok) return { ok: false, result: verdict.result, message: verdict.message, change: null };
  return {
    ok: true,
    result: "ok",
    message: "",
    change: {
      ticket: id,
      from,
      to,
      at,
      note: note == null ? "" : String(note),
      by: by || BY,
      dependents: [],
    },
  };
}

export function applyReset(beam, change) {
  const ticket = change && ticketOf(beam, change.ticket);
  if (!ticket || !check(change.from, change.to).ok) return beam;
  const next = {
    ...ticket,
    status: change.to,
    events: [...(ticket.events || []), statusEvent(change, change.from, change.to, change.note)],
    resets: [...(ticket.resets || []), resetEntry(change)],
  };
  if (change.from === "alarm") next.alarm = null;
  const updates = { [change.ticket]: next };
  for (const d of change.dependents || []) {
    const dep = updates[d.id] || ticketOf(beam, d.id);
    if (!dep || d.id === change.ticket) continue;
    updates[d.id] = {
      ...dep,
      status: d.to,
      events: [...(dep.events || []), statusEvent(change, d.from, d.to, dependentNote(change, d))],
    };
  }
  return withTickets(beam, updates);
}

function sameEntry(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if ((a || {})[k] !== (b || {})[k]) return false;
  return true;
}

function withoutLast(list, entry) {
  if (!Array.isArray(list)) return list;
  for (let i = list.length - 1; i >= 0; i--) {
    if (sameEntry(list[i], entry)) return [...list.slice(0, i), ...list.slice(i + 1)];
  }
  return list;
}

function dropResetsIfEmpty(obj, list) {
  if (Array.isArray(list) && list.length === 0) delete obj.resets;
  else if (list !== undefined) obj.resets = list;
}

// With `before` (the beam the reset was applied to) the prior tickets come back exactly.
// Without it the reset is inverted from the change alone, assuming Warp's beam shape: `events` is always
// present (kept even when empty) and `resets` exists only after an edit (dropped when emptied).
// An alarm cleared on leaving alarm cannot be recovered that way.
export function revertReset(beam, change, before) {
  if (!change || !ticketOf(beam, change.ticket)) return beam;
  const ids = [change.ticket, ...(change.dependents || []).map((d) => d.id)];
  const updates = {};
  if (before && before.tickets) {
    for (const id of ids) {
      const prior = ticketOf(before, id);
      if (prior && ticketOf(beam, id)) updates[id] = prior;
    }
    return withTickets(beam, updates);
  }
  const ticket = ticketOf(beam, change.ticket);
  if (ticket.status !== change.to) return beam;
  const main = {
    ...ticket,
    status: change.from,
    events: withoutLast(ticket.events, statusEvent(change, change.from, change.to, change.note)),
  };
  dropResetsIfEmpty(main, withoutLast(ticket.resets, resetEntry(change)));
  updates[change.ticket] = main;
  for (const d of change.dependents || []) {
    const dep = ticketOf(beam, d.id);
    if (!dep || d.id === change.ticket) continue;
    updates[d.id] = {
      ...dep,
      status: d.from,
      events: withoutLast(dep.events, statusEvent(change, d.from, d.to, dependentNote(change, d))),
    };
  }
  return withTickets(beam, updates);
}
