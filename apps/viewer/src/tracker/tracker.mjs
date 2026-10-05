// Tracker (WV-06): the start-now queue and the board.
//
// Tickets come from the parse model (WV-03). Run state is kept in the browser
// only, as two id lists, the same shape as the build-map: { merged, running }.
// A ticket's effective state is the browser list first, then its own status.
// Chips come from WV-05; nothing here writes to disk.
import { stateKind, chipsHtml } from '../chips/index.mjs';

const KIND_TO_STATUS = Object.freeze({ done: 'merged', run: 'running', todo: 'queued' });

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function emptyState() {
  return { merged: [], running: [] };
}

// Accepts a parsed localStorage value or junk and returns a clean state.
export function normalizeState(raw) {
  const list = (v) => (Array.isArray(v) ? [...new Set(v.map(String))] : []);
  const s = raw && typeof raw === 'object' ? raw : {};
  const merged = list(s.merged);
  return { merged, running: list(s.running).filter((id) => !merged.includes(id)) };
}

// 'done' | 'run' | 'todo'
export function ticketState(ticket, state = emptyState()) {
  if (state.merged.includes(ticket.id)) return 'done';
  if (state.running.includes(ticket.id)) return 'run';
  return stateKind(ticket.status);
}

// A ticket is ready when it is still todo and every dep is merged.
// A dep that is not in the ticket list is never merged, so it blocks.
export function isReady(ticket, tickets, state = emptyState()) {
  if (ticketState(ticket, state) !== 'todo') return false;
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return (ticket.deps || []).every((d) => byId.has(d) && ticketState(byId.get(d), state) === 'done');
}

// Start-now queue: ready tickets only, in plan order.
export function startNow(tickets, state = emptyState()) {
  return tickets.filter((t) => isReady(t, tickets, state));
}

// Board: every ticket, in plan order, with its effective state.
export function board(tickets, state = emptyState()) {
  return tickets.map((t) => ({ ticket: t, state: ticketState(t, state) }));
}

// Mark started: a ready row moves to running. Returns a new state, or the same
// object when the ticket is unknown, blocked, or already started.
export function markStarted(tickets, state, id) {
  const t = tickets.find((x) => x.id === id);
  if (!t || !isReady(t, tickets, state)) return state;
  return { merged: state.merged, running: [...state.running, id] };
}

// Mark merged: a running row moves to merged. Returns a new state or the same one.
export function markMerged(tickets, state, id) {
  const t = tickets.find((x) => x.id === id);
  if (!t || ticketState(t, state) !== 'run') return state;
  return { merged: [...state.merged, id], running: state.running.filter((x) => x !== id) };
}

// Row markup. The chip row reflects the effective state, not the raw status.
export function rowHtml(ticket, state, opts = {}) {
  const kind = ticketState(ticket, state);
  const shown = { ...ticket, status: KIND_TO_STATUS[kind] };
  const area = ticket.area ? ` style="--gc:var(--c-${esc(ticket.area)})"` : '';
  const deps = (ticket.deps || []).join(', ') || '\u2014';
  const lock = (ticket.locks || [])[0] || '\u2014';
  const button = opts.startButton
    ? `<button type="button" data-act="start" data-start="${esc(ticket.id)}">Mark started</button>`
    : '';
  return (
    `<div class="row" data-id="${esc(ticket.id)}" data-state="${kind}"${area}>` +
    `<span class="id">${esc(ticket.id)}</span><span>${esc(ticket.summary)}</span>` +
    `<span class="chips">${chipsHtml(shown, opts)}</span>` +
    `<span class="meta">${esc(ticket.size ?? '')} \u00b7 ${esc(lock)} \u00b7 deps ${esc(deps)}</span>` +
    `${button}</div>`
  );
}

export function startNowHtml(tickets, state, opts = {}) {
  const rows = startNow(tickets, state).map((t) => rowHtml(t, state, { ...opts, startButton: true }));
  return rows.join('') || '<p class="note">Nothing ready.</p>';
}

export function boardHtml(tickets, state, opts = {}) {
  return tickets.map((t) => rowHtml(t, state, opts)).join('');
}

// Controller. `model` is the buildModel() result (or { tickets, gates, criticalPath }).
// `els` is { ready, board } (any objects with an innerHTML property).
// onChange(state) is called after every change, so the caller can persist it.
export function createTracker(model, els, { state = emptyState(), onChange = () => {} } = {}) {
  const tickets = model.tickets;
  const opts = { gates: model.gates || [], criticalPath: model.criticalPath || [] };
  let current = normalizeState(state);

  const render = () => {
    if (els.ready) els.ready.innerHTML = startNowHtml(tickets, current, opts);
    if (els.board) els.board.innerHTML = boardHtml(tickets, current, opts);
  };
  const apply = (next) => {
    if (next === current) return false;
    current = next;
    onChange(current);
    render();
    return true;
  };

  const api = {
    get state() {
      return current;
    },
    startNow: () => startNow(tickets, current),
    board: () => board(tickets, current),
    markStarted: (id) => apply(markStarted(tickets, current, id)),
    markMerged: (id) => apply(markMerged(tickets, current, id)),
    render,
    // Click handler for the tracker pane: a "Mark started" button starts its row.
    handleClick(event) {
      const el = event?.target;
      const id = el?.dataset?.act === 'start' ? el.closest?.('[data-id]')?.dataset?.id || el.dataset.start : null;
      return id ? api.markStarted(id) : false;
    },
  };
  render();
  return api;
}
