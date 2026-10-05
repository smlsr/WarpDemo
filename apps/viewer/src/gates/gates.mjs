// Gates pane (WV-09): each gate with its check commands and its if-red text.
//
// Gates come from the parse model (WV-03). A gate is reached when every member
// ticket is merged, using the tracker's effective state (browser list first,
// then the ticket's own status). Nothing here writes to disk.
import { emptyState, ticketState } from '../tracker/index.mjs';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const list = (v) => (Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)]);

// Member ids merged / still open. A member missing from the ticket list is open.
export function memberStatus(gate, tickets, state = emptyState()) {
  const byId = new Map((tickets || []).map((t) => [t.id, t]));
  const members = list(gate?.members);
  const merged = members.filter((id) => byId.has(id) && ticketState(byId.get(id), state) === 'done');
  return { members, merged, open: members.filter((id) => !merged.includes(id)) };
}

// Reached: every member is merged. A gate with no members is never reached.
export function isReached(gate, tickets, state = emptyState()) {
  const { members, open } = memberStatus(gate, tickets, state);
  return members.length > 0 && open.length === 0;
}

// Plain descriptor for one gate.
export function gateView(gate, tickets, state = emptyState()) {
  const { members, merged, open } = memberStatus(gate, tickets, state);
  return {
    key: String(gate?.key ?? ''),
    name: String(gate?.name ?? ''),
    blocking: gate?.blocking === true,
    members,
    merged,
    open,
    checks: list(gate?.checks),
    ifRed: gate?.ifRed ? String(gate.ifRed) : '',
    reached: members.length > 0 && open.length === 0,
  };
}

export function gates(model, state = emptyState()) {
  const tickets = model?.tickets || [];
  return (model?.gates || []).map((g) => gateView(g, tickets, state));
}

export function gateHtml(view) {
  const state = view.reached ? 'reached' : 'open';
  const label = view.reached ? 'Reached' : `Open · ${view.merged.length}/${view.members.length} merged`;
  const checks = view.checks.length
    ? `<ul class="checks">${view.checks.map((c) => `<li><code class="check">${esc(c)}</code></li>`).join('')}</ul>`
    : '<p class="note none">No checks listed.</p>';
  const ifRed = view.ifRed ? `<p class="ifred"><b>If red:</b> ${esc(view.ifRed)}</p>` : '';
  return (
    `<article class="gate" data-gate="${esc(view.key)}" data-state="${state}"${view.blocking ? ' data-blocking="true"' : ''}>` +
    `<h4>${esc(view.key)} · ${esc(view.name)}</h4>` +
    `<p class="state ${state}">${esc(label)}</p>` +
    `<p class="note members">${view.members.map(esc).join(', ')}</p>` +
    checks +
    ifRed +
    `</article>`
  );
}

export function gatesHtml(model, state = emptyState()) {
  const views = gates(model, state);
  if (!views.length) return '<p class="note">No gates.</p>';
  return views.map(gateHtml).join('');
}

// Controller. Re-renders the pane when the run state changes.
export function createGates(model, el, { state = emptyState() } = {}) {
  let current = state;
  const render = () => {
    if (el) el.innerHTML = gatesHtml(model, current);
  };
  render();
  return {
    setState(next) {
      current = next;
      render();
    },
    render,
    views: () => gates(model, current),
  };
}
