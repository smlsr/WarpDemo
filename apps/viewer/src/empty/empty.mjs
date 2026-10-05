// Empty states (WV-12): what the start-now pane says when nothing is ready.
//
// Built on the tracker (WV-06). A paused beam shows the paused empty state and
// never lists a ready row, even when the dependency math would call a ticket
// ready: while paused, no ticket may be started, so a row would be a false one.
import { startNow, ticketState, emptyState, startNowHtml } from '../tracker/index.mjs';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const EMPTY_KINDS = Object.freeze(['paused', 'none', 'done', 'running', 'blocked']);

const COPY = Object.freeze({
  paused: ['Beam paused', 'Warp is paused. Nothing is ready to start until it resumes.'],
  none: ['No tickets', 'The beam has no tickets yet.'],
  done: ['All merged', 'Every ticket is merged. Nothing is left to start.'],
  running: ['Nothing ready', 'Every open ticket is already running. Wait for a merge to unblock more.'],
  blocked: ['Nothing ready', 'Every open ticket waits on an unmerged dependency.'],
});

export function isPaused(runState) {
  return String(runState ?? '').trim().toLowerCase() === 'paused';
}

// Ready rows for display. A paused beam has none.
export function readyRows(tickets, state = emptyState(), runState = null) {
  return isPaused(runState) ? [] : startNow(tickets, state);
}

// Why the start-now pane is empty, or null when it has rows to show.
export function emptyKind(tickets, state = emptyState(), runState = null) {
  if (isPaused(runState)) return 'paused';
  if (readyRows(tickets, state, runState).length) return null;
  if (!tickets.length) return 'none';
  const kinds = tickets.map((t) => ticketState(t, state));
  if (kinds.every((k) => k === 'done')) return 'done';
  if (!kinds.includes('todo')) return 'running';
  return 'blocked';
}

export function emptyHtml(kind) {
  const copy = COPY[kind];
  if (!copy) return '';
  return (
    `<div class="empty" data-empty="${esc(kind)}" role="status">` +
    `<p class="title">${esc(copy[0])}</p><p class="note">${esc(copy[1])}</p></div>`
  );
}

// The start-now pane: ready rows, or the empty state that explains why not.
export function startNowPaneHtml(tickets, state = emptyState(), { runState = null, ...opts } = {}) {
  const kind = emptyKind(tickets, state, runState);
  return kind ? emptyHtml(kind) : startNowHtml(tickets, state, opts);
}
