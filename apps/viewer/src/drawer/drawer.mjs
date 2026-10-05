// Ticket drawer (WV-10): locks, blockers, and acceptance criteria for one ticket.
//
// Tickets come from the parse model (WV-03). Effective state and chips come from
// the tracker (WV-06) and chips (WV-05), so the drawer agrees with the board.
// Nothing here writes to disk or touches the network.
import { chipsHtml } from '../chips/index.mjs';
import { emptyState, normalizeState, ticketState } from '../tracker/index.mjs';

const KIND_TO_STATUS = Object.freeze({ done: 'merged', run: 'running', todo: 'queued' });

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Lock folders for a ticket, in plan order, without repeats.
export function locksOf(ticket) {
  return [...new Set((ticket?.locks || []).map(String))];
}

// Blockers: one entry per dep, in plan order. A dep that is not in the ticket
// list has no ticket to open, so it is `missing` and always blocks.
// `blocking` is true unless the blocker is merged.
export function blockersOf(ticket, tickets, state = emptyState()) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return [...new Set((ticket?.deps || []).map(String))].map((id) => {
    const dep = byId.get(id);
    if (!dep) return { id, ticket: null, missing: true, state: 'todo', blocking: true };
    const st = ticketState(dep, state);
    return { id, ticket: dep, missing: false, state: st, blocking: st !== 'done' };
  });
}

// Acceptance criteria as strings. Falls back to nothing when the plan has none.
export function criteriaOf(ticket) {
  return (ticket?.ac || []).map(String);
}

// The drawer view model for one ticket: plain data, no markup.
export function drawerModel(ticket, tickets, state = emptyState()) {
  return {
    id: ticket.id,
    summary: ticket.summary,
    state: ticketState(ticket, state),
    locks: locksOf(ticket),
    blockers: blockersOf(ticket, tickets, state),
    criteria: criteriaOf(ticket),
  };
}

function blockerHtml(b, opts) {
  if (b.missing) {
    return (
      `<li class="blocker missing" data-blocker="${esc(b.id)}" data-blocking="true">` +
      `<span class="id">${esc(b.id)}</span><span class="note">not in the plan</span></li>`
    );
  }
  const shown = { ...b.ticket, status: KIND_TO_STATUS[b.state] };
  return (
    `<li class="blocker" data-blocker="${esc(b.id)}" data-blocking="${b.blocking}" data-state="${b.state}">` +
    `<a href="#ticket=${encodeURIComponent(b.id)}" data-act="open" data-open="${esc(b.id)}">` +
    `<span class="id">${esc(b.id)}</span> ${esc(b.ticket.summary)}</a>` +
    `<span class="chips">${chipsHtml(shown, opts)}</span></li>`
  );
}

// Drawer markup for one ticket.
export function drawerHtml(ticket, tickets, state = emptyState(), opts = {}) {
  const m = drawerModel(ticket, tickets, state);
  const shown = { ...ticket, status: KIND_TO_STATUS[m.state] };
  const locks = m.locks.length
    ? `<ul class="locks">${m.locks.map((l) => `<li class="lock" data-lock="${esc(l)}"><code>${esc(l)}</code></li>`).join('')}</ul>`
    : '<p class="note">No lock folders.</p>';
  const blockers = m.blockers.length
    ? `<ul class="blockers">${m.blockers.map((b) => blockerHtml(b, opts)).join('')}</ul>`
    : '<p class="note">No blockers.</p>';
  const criteria = m.criteria.length
    ? `<ol class="criteria">${m.criteria.map((c) => `<li class="ac">${esc(c)}</li>`).join('')}</ol>`
    : '<p class="note">No acceptance criteria.</p>';
  return (
    `<aside class="drawer" data-id="${esc(m.id)}" data-state="${m.state}" role="dialog" aria-label="Ticket ${esc(m.id)}">` +
    `<header><span class="id">${esc(m.id)}</span><span class="title">${esc(m.summary)}</span>` +
    `<span class="chips">${chipsHtml(shown, opts)}</span>` +
    `<button type="button" data-act="close" aria-label="Close drawer">Close</button></header>` +
    `<section class="sec" data-sec="locks"><h3>Locks</h3>${locks}</section>` +
    `<section class="sec" data-sec="blockers"><h3>Blockers</h3>${blockers}</section>` +
    `<section class="sec" data-sec="criteria"><h3>Acceptance criteria</h3>${criteria}</section>` +
    `</aside>`
  );
}

// Controller. `model` is the buildModel() result (or { tickets, gates, criticalPath }).
// `els` is { drawer } (any object with an innerHTML property).
// onOpen(id | null) is called after the open ticket changes.
export function createDrawer(model, els, { state = emptyState(), onOpen = () => {} } = {}) {
  const tickets = model.tickets;
  const opts = { gates: model.gates || [], criticalPath: model.criticalPath || [] };
  let current = normalizeState(state);
  let openId = null;

  const render = () => {
    if (!els.drawer) return;
    const t = openId && tickets.find((x) => x.id === openId);
    els.drawer.innerHTML = t ? drawerHtml(t, tickets, current, opts) : '';
  };

  const api = {
    get openId() {
      return openId;
    },
    // Open a ticket by id. Unknown ids change nothing. Returns true when it changed.
    open(id) {
      if (!tickets.some((t) => t.id === id) || id === openId) return false;
      openId = id;
      render();
      onOpen(openId);
      return true;
    },
    close() {
      if (openId === null) return false;
      openId = null;
      render();
      onOpen(null);
      return true;
    },
    // Tracker state changed: redraw so blocker chips stay in step with the board.
    setState(next) {
      current = normalizeState(next);
      render();
    },
    model: () => (openId ? drawerModel(tickets.find((t) => t.id === openId), tickets, current) : null),
    render,
    // Click handler for the drawer pane and for any row: a blocker link opens the
    // blocker ticket, a row opens its ticket, Close closes. Returns true when handled.
    handleClick(event) {
      const el = event?.target;
      const act = el?.dataset?.act;
      if (act === 'close') return api.close();
      const link = act === 'open' ? el : el?.closest?.('[data-act="open"]');
      const id = link?.dataset?.open;
      if (!id) return false;
      event.preventDefault?.();
      return api.open(id);
    },
  };
  render();
  return api;
}
