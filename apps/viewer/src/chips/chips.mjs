// Status chips (WV-05): todo, run, done, crit, gate.
//
// A ticket always gets exactly one state chip (todo, run, or done) and may also
// get crit and gate chips. Class names match the .chip rules in
// WarpView/ui/build-map.html; colors come from styles/tokens.css only.

const DONE = new Set(['merged', 'done']);
const RUNNING = new Set(['claimed', 'planning', 'coding', 'review', 'fix', 'running', 'working']);

export const CHIP_KINDS = Object.freeze(['todo', 'run', 'done', 'crit', 'gate']);

const LABELS = Object.freeze({
  todo: 'todo',
  run: 'running',
  done: 'merged',
  crit: 'critical',
  gate: 'gate',
});

const norm = (s) => String(s ?? '').trim().toLowerCase();

// State chip kind from a ticket status. Unknown and queued statuses are todo.
export function stateKind(status) {
  const s = norm(status);
  if (DONE.has(s)) return 'done';
  if (RUNNING.has(s)) return 'run';
  return 'todo';
}

// opts.criticalPath: ids on the critical path; opts.gates: [{ key, members }].
export function isCritical(ticket, opts = {}) {
  return Boolean(ticket.critical) || (opts.criticalPath || []).includes(ticket.id);
}

// A ticket is a gate member when it names a gate or a gate lists it as a member.
export function gateKeys(ticket, opts = {}) {
  const keys = [];
  if (ticket.gate) keys.push(typeof ticket.gate === 'object' ? ticket.gate.key || 'gate' : String(ticket.gate));
  for (const g of opts.gates || []) {
    if ((g.members || []).includes(ticket.id) && !keys.includes(g.key)) keys.push(g.key);
  }
  return keys;
}

// Ordered chip descriptors for one ticket: state first, then crit, then gate.
export function chipsFor(ticket, opts = {}) {
  const chips = [];
  const kind = stateKind(ticket.status);
  chips.push({ kind, label: LABELS[kind], className: `chip ${kind}` });
  if (isCritical(ticket, opts)) {
    chips.push({ kind: 'crit', label: LABELS.crit, className: 'chip crit' });
  }
  const keys = gateKeys(ticket, opts);
  if (keys.length) {
    chips.push({ kind: 'gate', label: LABELS.gate, className: 'chip gate', gates: keys });
  }
  return chips;
}

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function chipHtml(chip) {
  const title = chip.gates ? ` title="${esc(chip.gates.join(', '))}"` : '';
  return `<span class="${chip.className}" data-chip="${chip.kind}"${title}>${esc(chip.label)}</span>`;
}

export function chipsHtml(ticket, opts = {}) {
  return chipsFor(ticket, opts).map(chipHtml).join('');
}
