// Agent timeline (WV-07): bars on agent rows, day columns, and gate lines.
//
// Everything is forecast from the plan alone, on the same clock as the ticket
// table (WV-11): start(t) comes from forecastStarts, finish(t) = start + hours/8,
// and a merged ticket finishes at day 0.
//   Rows: one per agent. A ticket with an `agent` goes on that agent's row.
//         A ticket with none is packed onto numbered lanes ("Agent 1", ...) so
//         no two bars on a lane overlap. Merged tickets have no time left and
//         draw no bar.
//   Columns: one per day, Day 0 .. Day N-1, wide enough for the last bar or gate.
//   Gate lines: a gate sits at the latest finish of its members (its `members`
//         plus any ticket whose `gate` is its key). A blocking gate draws a
//         solid line; a gate with blocking:false draws a dashed one. A gate
//         with no known member has no forecast and draws nothing.
// Run state comes from the tracker (WV-06). Nothing here writes to disk.
import { HOURS_PER_DAY } from '../table/index.mjs';
import { emptyState, normalizeState, ticketState } from '../tracker/index.mjs';

export { HOURS_PER_DAY };

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const round = (n) => Math.round(n * 100) / 100;
const EPS = 1e-9;

// Forecast { start, end } in days for every ticket still to do, keyed by id.
// Same rule as forecastStarts (WV-11), kept unrounded here so a bar never starts
// before the end of its dep; rounding is only for output, and a rounded start
// equals the table's. Merged tickets are left out. A dep cycle or a dep outside
// the list counts as day 0 for that edge.
export function forecastSpans(tickets, state = emptyState(), hoursPerDay = HOURS_PER_DAY) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const raw = new Map();
  const visiting = new Set();
  const spanOf = (id) => {
    if (raw.has(id)) return raw.get(id);
    const t = byId.get(id);
    if (!t || visiting.has(id)) return { start: 0, end: 0 };
    visiting.add(id);
    let start = 0;
    for (const d of t.deps || []) start = Math.max(start, spanOf(d).end);
    visiting.delete(id);
    const done = ticketState(t, state) === 'done';
    const span = { start, end: done ? 0 : start + (Number(t.hours) || 0) / hoursPerDay };
    raw.set(id, span);
    return span;
  };
  const spans = new Map();
  for (const t of tickets) {
    if (ticketState(t, state) === 'done') continue;
    const { start, end } = spanOf(t.id);
    spans.set(t.id, { start, end });
  }
  return spans;
}

// Rows of { agent, bars: [{ ticket, state, start, end }] }. Named agents come
// first in the order they appear, then the packed lanes.
export function agentRows(tickets, state = emptyState(), opts = {}) {
  const spans = forecastSpans(tickets, state, opts.hoursPerDay);
  const order = new Map(tickets.map((t, i) => [t.id, i]));
  const bars = tickets
    .filter((t) => spans.has(t.id))
    .map((ticket) => ({ ticket, state: ticketState(ticket, state), ...spans.get(ticket.id) }))
    .sort((a, b) => a.start - b.start || order.get(a.ticket.id) - order.get(b.ticket.id));

  const named = new Map();
  const lanes = [];
  for (const bar of bars) {
    const name = bar.ticket.agent;
    if (name) {
      if (!named.has(name)) named.set(name, []);
      named.get(name).push(bar);
      continue;
    }
    let lane = lanes.find((l) => l.end <= bar.start + EPS);
    if (!lane) {
      lane = { bars: [], end: 0 };
      lanes.push(lane);
    }
    lane.bars.push(bar);
    lane.end = Math.max(bar.end, bar.start);
  }
  return [
    ...[...named].map(([agent, list]) => ({ agent, bars: list })),
    ...lanes.map((l, i) => ({ agent: `Agent ${i + 1}`, bars: l.bars })),
  ];
}

// Gate forecasts: [{ key, name, blocking, day, members, passed }], in gate order.
// day is the latest finish among the gate's members; a merged member counts as 0.
export function gateForecasts(tickets, gates = [], state = emptyState(), opts = {}) {
  const hoursPerDay = opts.hoursPerDay ?? HOURS_PER_DAY;
  const spans = forecastSpans(tickets, state, hoursPerDay);
  const known = new Set(tickets.map((t) => t.id));
  const out = [];
  for (const g of gates || []) {
    const key = g?.key;
    if (!key) continue;
    const members = [
      ...new Set([...(g.members || []).map(String), ...tickets.filter((t) => t.gate === key).map((t) => t.id)]),
    ].filter((id) => known.has(id));
    if (!members.length) continue;
    const day = Math.max(0, ...members.map((id) => spans.get(id)?.end ?? 0));
    out.push({
      key,
      name: g.name ?? '',
      blocking: g.blocking !== false,
      day: round(day),
      members,
      passed: members.every((id) => !spans.has(id)),
    });
  }
  return out;
}

// Number of day columns: enough for the last bar end and the last gate line, at least 1.
export function dayCount(rows, gates) {
  const ends = [...rows.flatMap((r) => r.bars.map((b) => b.end)), ...gates.map((g) => g.day)];
  return Math.max(1, Math.ceil(Math.max(0, ...ends) - EPS));
}

function barHtml(bar, agent) {
  const { ticket, state } = bar;
  const start = round(bar.start);
  const end = round(bar.end);
  const area = ticket.area ? ` --gc:var(--c-${esc(ticket.area)});` : '';
  return (
    `<div class="tl-bar" data-id="${esc(ticket.id)}" data-agent="${esc(agent)}" data-state="${state}" ` +
    `data-start="${start}" data-end="${end}" title="${esc(ticket.id)}: ${esc(ticket.summary)}" ` +
    `style="--s:${start};--w:${round(end - start)};${area}">${esc(ticket.id)}</div>`
  );
}

function gateHtml(g) {
  const line = g.blocking ? 'solid' : 'dashed';
  return (
    `<div class="tl-gate" data-gate="${esc(g.key)}" data-blocking="${g.blocking}" data-line="${line}" ` +
    `data-day="${g.day}" data-passed="${g.passed}" style="--s:${g.day}" ` +
    `title="${esc(g.key)} ${esc(g.name)}: day ${g.day}">` +
    `<span class="tl-gate-label">${esc(g.key)}</span></div>`
  );
}

export function timelineHtml(tickets, gates = [], state = emptyState(), opts = {}) {
  const rows = agentRows(tickets, state, opts);
  const lines = gateForecasts(tickets, gates, state, opts);
  if (!rows.length && !lines.length) return '<p class="note">Nothing left to schedule.</p>';
  const days = dayCount(rows, lines);
  const head = Array.from({ length: days }, (_, d) => `<span class="tl-day" data-day="${d}">Day ${d}</span>`).join('');
  const body = rows
    .map(
      (r) =>
        `<div class="tl-row" data-agent="${esc(r.agent)}"><span class="tl-label">${esc(r.agent)}</span>` +
        `<div class="tl-track">${r.bars.map((b) => barHtml(b, r.agent)).join('')}</div></div>`,
    )
    .join('');
  return (
    `<div class="timeline" style="--days:${days}">` +
    `<div class="tl-head"><span class="tl-corner">Agent</span><div class="tl-days">${head}</div></div>` +
    `<div class="tl-body">${body}<div class="tl-gates">${lines.map(gateHtml).join('')}</div></div>` +
    `</div>`
  );
}

// Controller. `model` is the buildModel() result (or { tickets, gates }).
// `el` is any object with an innerHTML property.
export function createTimeline(model, el, { state = emptyState(), hoursPerDay = HOURS_PER_DAY } = {}) {
  const tickets = model.tickets;
  const gates = model.gates || [];
  const opts = { hoursPerDay };
  let current = normalizeState(state);

  const render = () => {
    if (el) el.innerHTML = timelineHtml(tickets, gates, current, opts);
  };

  const api = {
    get state() {
      return current;
    },
    rows: () => agentRows(tickets, current, opts),
    gates: () => gateForecasts(tickets, gates, current, opts),
    // Replace the run state (from the tracker) and redraw.
    setState(next) {
      current = normalizeState(next);
      render();
    },
    render,
  };
  render();
  return api;
}
