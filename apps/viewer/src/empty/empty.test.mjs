import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel } from '../parse/index.mjs';
import { emptyState, markStarted, markMerged, startNow } from '../tracker/index.mjs';
import { EMPTY_KINDS, isPaused, readyRows, emptyKind, emptyHtml, startNowPaneHtml } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../../../../WarpView/fixtures/beam.sample.json'), 'utf8'));
const model = buildModel({ beam: fixture });
const T = (id, deps = [], status = 'queued') => ({ id, summary: `s ${id}`, deps, status, locks: [`l/${id}`], size: 'S' });
const rows = (html) => (html.match(/class="row"/g) || []).length;

// AC 1: Paused beam shows the paused empty state
test('a paused beam shows the paused empty state', () => {
  assert.equal(emptyKind(model.tickets, emptyState(), 'paused'), 'paused');
  const html = startNowPaneHtml(model.tickets, emptyState(), { runState: 'paused' });
  assert.match(html, /data-empty="paused"/);
  assert.match(html, /Beam paused/);
});

test('paused is matched without regard to case or spaces', () => {
  assert.equal(isPaused(' Paused '), true);
  assert.equal(emptyKind(model.tickets, emptyState(), 'PAUSED'), 'paused');
});

test('the paused state wins over every other reason, including an all-merged beam', () => {
  const merged = [T('A', [], 'merged')];
  assert.equal(emptyKind(merged, emptyState(), 'paused'), 'paused');
  assert.equal(emptyKind([], emptyState(), 'paused'), 'paused');
});

test('the same beam is not paused when runState is running, null, or missing', () => {
  for (const rs of ['running', null, undefined, '']) {
    assert.equal(emptyKind(model.tickets, emptyState(), rs), null);
  }
});

test('the paused state comes from the parsed model runState', () => {
  const m = buildModel({ beam: { ...fixture, runState: 'paused' } });
  assert.equal(m.runState, 'paused');
  const html = startNowPaneHtml(m.tickets, emptyState(), { runState: m.runState });
  assert.match(html, /data-empty="paused"/);
});

// AC 2: No false ready rows
test('a paused beam lists no ready rows even though tickets are ready', () => {
  assert.deepEqual(startNow(model.tickets, emptyState()).map((t) => t.id), ['WV-01', 'WV-02']);
  assert.deepEqual(readyRows(model.tickets, emptyState(), 'paused'), []);
  const html = startNowPaneHtml(model.tickets, emptyState(), { runState: 'paused' });
  assert.equal(rows(html), 0);
  assert.doesNotMatch(html, /data-id=/);
  assert.doesNotMatch(html, /data-act="start"/);
});

test('an unpaused beam still lists exactly the ready rows', () => {
  const html = startNowPaneHtml(model.tickets, emptyState(), { runState: 'running' });
  assert.equal(rows(html), 2);
  assert.match(html, /data-id="WV-01"/);
  assert.match(html, /data-id="WV-02"/);
  assert.doesNotMatch(html, /data-empty/);
});

test('an empty state never carries a row or a start button', () => {
  const cases = [
    [[], emptyState()],
    [[T('A', [], 'merged')], emptyState()],
    [[T('A', [], 'coding')], emptyState()],
    [[T('B', ['A'])].concat(T('A', [], 'coding')), emptyState()],
    [[T('B', ['GONE'])], emptyState()],
  ];
  for (const [list, st] of cases) {
    const html = startNowPaneHtml(list, st);
    assert.match(html, /data-empty=/);
    assert.equal(rows(html), 0);
    assert.doesNotMatch(html, /data-act="start"/);
  }
});

test('blocked tickets are not shown as ready: the pane says blocked', () => {
  const list = [T('A', [], 'coding'), T('B', ['A'])];
  assert.equal(emptyKind(list, emptyState()), 'blocked');
  assert.doesNotMatch(startNowPaneHtml(list, emptyState()), /data-id="B"/);
});

test('a running dep keeps its dependent out of the ready rows', () => {
  const list = [T('A'), T('B', ['A'])];
  const s = markStarted(list, emptyState(), 'A');
  assert.equal(emptyKind(list, s), 'blocked');
  assert.equal(readyRows(list, s).length, 0);
});

test('merging unblocks a dependent and the empty state gives way to a row', () => {
  const list = [T('A'), T('B', ['A'])];
  let s = markStarted(list, emptyState(), 'A');
  s = markMerged(list, s, 'A');
  assert.equal(emptyKind(list, s), null);
  assert.deepEqual(readyRows(list, s).map((t) => t.id), ['B']);
});

// Reasons the pane can be empty
test('empty reasons: none, done, running, blocked', () => {
  assert.equal(emptyKind([], emptyState()), 'none');
  assert.equal(emptyKind([T('A', [], 'merged'), T('B', [], 'merged')], emptyState()), 'done');
  assert.equal(emptyKind([T('A', [], 'coding'), T('B', [], 'review')], emptyState()), 'running');
  assert.equal(emptyKind([T('A', [], 'coding'), T('B', ['A'])], emptyState()), 'blocked');
});

test('browser state counts: all tickets merged in state is the done state', () => {
  const list = [T('A'), T('B')];
  assert.equal(emptyKind(list, { merged: ['A', 'B'], running: [] }), 'done');
});

test('every empty kind has copy and unknown kinds render nothing', () => {
  for (const k of EMPTY_KINDS) assert.match(emptyHtml(k), new RegExp(`data-empty="${k}"`));
  assert.equal(emptyHtml('bogus'), '');
});
