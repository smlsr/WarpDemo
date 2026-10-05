import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel } from '../parse/index.mjs';
import {
  emptyState,
  normalizeState,
  isReady,
  startNow,
  board,
  markStarted,
  markMerged,
  startNowHtml,
  boardHtml,
  createTracker,
} from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../../../../WarpView/fixtures/beam.sample.json'), 'utf8'));
const model = buildModel({ beam: fixture });
const ids = (list) => list.map((t) => t.id);
const stateOf = (tracker, id) => tracker.board().find((r) => r.ticket.id === id).state;

const T = (id, deps = [], status = 'queued') => ({ id, summary: `s ${id}`, deps, status, locks: [`l/${id}`], size: 'S' });

// AC 1: Start-now lists only ready tickets
test('start-now on the fixture beam lists only tickets with no deps', () => {
  assert.equal(model.tickets.length, 16);
  assert.deepEqual(ids(startNow(model.tickets)), ['WV-01', 'WV-02']);
});

test('start-now never lists a ticket with an unmerged dep', () => {
  const list = [T('A'), T('B', ['A']), T('C', ['B'])];
  assert.deepEqual(ids(startNow(list)), ['A']);
  assert.equal(isReady(list[1], list), false);
});

test('a running dep does not unblock its dependents', () => {
  const list = [T('A'), T('B', ['A'])];
  const s = markStarted(list, emptyState(), 'A');
  assert.deepEqual(ids(startNow(list, s)), []);
});

test('start-now needs every dep merged, not just one', () => {
  const list = [T('A', [], 'merged'), T('B'), T('C', ['A', 'B'])];
  assert.deepEqual(ids(startNow(list)), ['B']);
});

test('merging the last dep makes the dependent ready', () => {
  const list = [T('A'), T('B', ['A'])];
  let s = markStarted(list, emptyState(), 'A');
  s = markMerged(list, s, 'A');
  assert.deepEqual(ids(startNow(list, s)), ['B']);
});

test('merged and running tickets are not in start-now', () => {
  const list = [T('A', [], 'merged'), T('B', [], 'coding'), T('C')];
  assert.deepEqual(ids(startNow(list)), ['C']);
});

test('a dep missing from the list blocks', () => {
  assert.deepEqual(ids(startNow([T('A', ['GONE'])])), []);
});

test('start-now html has one row per ready ticket and a Mark started button', () => {
  const html = startNowHtml(model.tickets, emptyState());
  assert.equal((html.match(/class="row"/g) || []).length, 2);
  assert.match(html, /data-id="WV-01"/);
  assert.doesNotMatch(html, /data-id="WV-03"/);
  assert.equal((html.match(/data-act="start"/g) || []).length, 2);
});

test('start-now html says so when nothing is ready', () => {
  assert.match(startNowHtml([T('B', ['A'])], emptyState()), /Nothing ready/);
});

// AC 2: Mark started moves a row to running
test('mark started moves a ready row to running', () => {
  const s = markStarted(model.tickets, emptyState(), 'WV-01');
  assert.deepEqual(s.running, ['WV-01']);
  const row = board(model.tickets, s).find((r) => r.ticket.id === 'WV-01');
  assert.equal(row.state, 'run');
  assert.ok(!ids(startNow(model.tickets, s)).includes('WV-01'));
});

test('mark started does not mutate the previous state', () => {
  const before = emptyState();
  markStarted(model.tickets, before, 'WV-01');
  assert.deepEqual(before, { merged: [], running: [] });
});

test('mark started on a blocked, unknown, or already running ticket changes nothing', () => {
  const s0 = emptyState();
  assert.equal(markStarted(model.tickets, s0, 'WV-03'), s0);
  assert.equal(markStarted(model.tickets, s0, 'NOPE'), s0);
  const s1 = markStarted(model.tickets, s0, 'WV-01');
  assert.equal(markStarted(model.tickets, s1, 'WV-01'), s1);
});

test('the board row shows the running chip after mark started', () => {
  const s = markStarted(model.tickets, emptyState(), 'WV-02');
  const html = boardHtml(model.tickets, s);
  const row = html.split('<div class="row"').find((r) => r.includes('data-id="WV-02"'));
  assert.match(row, /data-state="run"/);
  assert.match(row, /class="chip run"[^>]*>running</);
  assert.doesNotMatch(row, /class="chip todo"/);
});

test('the board lists every ticket in plan order', () => {
  const html = boardHtml(model.tickets, emptyState());
  assert.equal((html.match(/class="row"/g) || []).length, 16);
  assert.deepEqual(
    [...html.matchAll(/data-id="(WV-\d+)"/g)].map((m) => m[1]),
    ids(model.tickets),
  );
});

test('controller: clicking Mark started updates both panes and calls onChange', () => {
  const els = { ready: { innerHTML: '' }, board: { innerHTML: '' } };
  const saved = [];
  const tracker = createTracker(model, els, { onChange: (s) => saved.push(s) });
  assert.match(els.ready.innerHTML, /data-id="WV-01"/);

  const row = { dataset: { id: 'WV-01' } };
  const button = { dataset: { act: 'start', start: 'WV-01' }, closest: () => row };
  assert.equal(tracker.handleClick({ target: button }), true);

  assert.equal(stateOf(tracker, 'WV-01'), 'run');
  assert.doesNotMatch(els.ready.innerHTML, /data-id="WV-01"/);
  assert.match(els.board.innerHTML, /data-id="WV-01"[^>]*data-state="run"/);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].running, ['WV-01']);
});

test('controller: clicks that are not Mark started do nothing', () => {
  const tracker = createTracker(model, { ready: { innerHTML: '' }, board: { innerHTML: '' } });
  assert.equal(tracker.handleClick({ target: { dataset: {}, closest: () => null } }), false);
  assert.equal(tracker.handleClick({}), false);
  assert.deepEqual(tracker.state.running, []);
});

test('controller: merging a running dep unblocks the next ticket on screen', () => {
  const els = { ready: { innerHTML: '' }, board: { innerHTML: '' } };
  const tracker = createTracker(model, els);
  tracker.markStarted('WV-01');
  assert.doesNotMatch(els.ready.innerHTML, /data-id="WV-03"/);
  tracker.markMerged('WV-01');
  assert.match(els.ready.innerHTML, /data-id="WV-03"/);
});

test('ticket status from the beam is honored: a coding ticket is running on the board', () => {
  const beam = { tickets: { A: { ...T('A', [], 'coding') }, B: T('B', ['A']) } };
  const m = buildModel({ beam });
  assert.equal(stateOf(createTracker(m, {}), 'A'), 'run');
  assert.deepEqual(ids(startNow(m.tickets)), []);
});

test('normalizeState repairs saved junk', () => {
  assert.deepEqual(normalizeState(null), { merged: [], running: [] });
  assert.deepEqual(normalizeState({ merged: ['A', 'A'], running: ['A', 'B'] }), { merged: ['A'], running: ['B'] });
  assert.deepEqual(normalizeState({ merged: 'x', running: 5 }), { merged: [], running: [] });
});

test('html escapes ticket text', () => {
  const html = boardHtml([{ ...T('A'), summary: '<b>"x"</b>' }], emptyState());
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /&lt;b&gt;&quot;x&quot;&lt;\/b&gt;/);
});
