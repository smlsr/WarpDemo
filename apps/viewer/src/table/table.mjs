// Ticket table (WV-11): every ticket in one table, sorted by forecast start.
//
// Forecast start is a day offset from today, worked out from the plan alone:
//   start(t)  = latest finish among t's deps; a merged dep finishes at day 0.
//   finish(t) = start(t) + hours(t) / HOURS_PER_DAY; a merged ticket finishes at 0.
// Ties keep plan order. Columns: id, summary, size, deps, unlocks, forecast, state.
// Row click opens the drawer (WV-10). The drawer is not in this lock, so the
// table only reports the id through onOpen(id); the caller wires the drawer.
// Run state comes from the tracker (WV-06); chips come from WV-05.
import { chipsHtml } from '../chips/index.mjs';
import { emptyState, normalizeState, ticketState } from '../tracker/index.mjs';

export const HOURS_PER_DAY = 8;

export const COLUMNS = Object.freeze([
  { key: 'id', label: 'ID' },
  { key: 'summary', label: 'Summary' },
  { key: 'size', label: 'Size' },
  { key: 'deps', label: 'Deps' },
  { key: 'unlocks', label: 'Unlocks' },
  { key: 'start', label: 'Forecast start' },
  { key: 'state', label: 'State' },
]);

const KIND_TO_STATUS = Object.freeze({ done: 'merged', run: 'running', todo: 'queued' });
const DASH = '\u2014';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const round = (n) => Math.round(n * 100) / 100;

// Map of id -> forecast start in days. A dep cycle or a dep outside the list
// counts as day 0 for that edge, so the table still renders.
export function forecastStarts(tickets, state = emptyState(), hoursPerDay = HOURS_PER_DAY) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const start = new Map();
  const finish = new Map();
  const visiting = new Set();

  const startOf = (id) => {
    if (start.has(id)) return start.get(id);
    const t = byId.get(id);
    if (!t || visiting.has(id)) return 0;
    visiting.add(id);
    let s = 0;
    for (const d of t.deps || []) s = Math.max(s, finishOf(d));
    visiting.delete(id);
    start.set(id, s);
    return s;
  };
  const finishOf = (id) => {
    if (finish.has(id)) return finish.get(id);
    const t = byId.get(id);
    if (!t || visiting.has(id)) return 0;
    const f = ticketState(t, state) === 'done' ? 0 : startOf(id) + (Number(t.hours) || 0) / hoursPerDay;
    finish.set(id, f);
    return f;
  };

  const out = new Map();
  for (const t of tickets) out.set(t.id, round(startOf(t.id)));
  return out;
}

// Rows sorted by forecast start, ties in plan order.
export function tableRows(tickets, state = emptyState(), opts = {}) {
  const starts = forecastStarts(tickets, state, opts.hoursPerDay);
  return tickets
    .map((ticket, i) => ({ ticket, state: ticketState(ticket, state), start: starts.get(ticket.id), i }))
    .sort((a, b) => a.start - b.start || a.i - b.i)
    .map(({ i, ...row }) => row);
}

const startLabel = (d) => (d === 0 ? 'Day 0' : `Day ${d}`);

function rowHtml(row, opts) {
  const { ticket, state, start } = row;
  const shown = { ...ticket, status: KIND_TO_STATUS[state] };
  const area = ticket.area ? ` style="--gc:var(--c-${esc(ticket.area)})"` : '';
  const list = (v) => esc((v || []).join(', ') || DASH);
  return (
    `<tr class="trow" tabindex="0" data-id="${esc(ticket.id)}" data-state="${state}" data-start="${start}"${area}>` +
    `<td class="c-id">${esc(ticket.id)}</td>` +
    `<td class="c-summary">${esc(ticket.summary)}</td>` +
    `<td class="c-size">${esc(ticket.size ?? DASH)}</td>` +
    `<td class="c-deps">${list(ticket.deps)}</td>` +
    `<td class="c-unlocks">${list(ticket.unlocks)}</td>` +
    `<td class="c-start">${startLabel(start)}</td>` +
    `<td class="c-state"><span class="chips">${chipsHtml(shown, opts)}</span></td>` +
    `</tr>`
  );
}

export function tableHtml(tickets, state = emptyState(), opts = {}) {
  const head = COLUMNS.map((c) => `<th scope="col" data-col="${c.key}">${esc(c.label)}</th>`).join('');
  const rows = tableRows(tickets, state, opts).map((r) => rowHtml(r, opts));
  if (!rows.length) return '<p class="note">No tickets.</p>';
  return `<table class="ticket-table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// Controller. `model` is the buildModel() result (or { tickets, gates, criticalPath }).
// `el` is any object with an innerHTML property. onOpen(id) opens the drawer.
export function createTable(model, el, { state = emptyState(), onOpen = () => {} } = {}) {
  const tickets = model.tickets;
  const opts = { gates: model.gates || [], criticalPath: model.criticalPath || [] };
  let current = normalizeState(state);

  const render = () => {
    if (el) el.innerHTML = tableHtml(tickets, current, opts);
  };

  const api = {
    get state() {
      return current;
    },
    rows: () => tableRows(tickets, current),
    // Replace the run state (from the tracker) and redraw.
    setState(next) {
      current = normalizeState(next);
      render();
    },
    open(id) {
      if (!tickets.some((t) => t.id === id)) return false;
      onOpen(id);
      return true;
    },
    // Click or Enter/Space on a row opens the drawer for that ticket.
    handleClick(event) {
      const id = event?.target?.closest?.('[data-id]')?.dataset?.id;
      return id ? api.open(id) : false;
    },
    handleKey(event) {
      if (event?.key !== 'Enter' && event?.key !== ' ') return false;
      const handled = api.handleClick(event);
      if (handled) event.preventDefault?.();
      return handled;
    },
    render,
  };
  render();
  return api;
}
