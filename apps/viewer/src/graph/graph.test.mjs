import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildGraph,
  openBlockers,
  transitiveBlockers,
  readySet,
  isReady,
  pathsOverlap,
  lockOverlaps,
} from './index.mjs';
import { buildModel } from '../parse/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = readFileSync(resolve(root, 'WarpView', 'fixtures', 'beam.sample.json'), 'utf8');
const SCHEDULE = readFileSync(resolve(root, 'WarpView', 'plan', 'schedule.json'), 'utf8');

const t = (id, deps = [], locks = [], status = 'queued') => ({ id, deps, locks, status });

// AC1: A ticket with an open blocker is not ready.
test('AC1: a ticket with an open blocker is not ready', () => {
  const tickets = [t('A', [], ['a']), t('B', ['A'], ['b'])];
  const r = readySet(tickets);
  assert.deepEqual(r.ready, ['A']);
  assert.equal(isReady('B', tickets), false);
  assert.deepEqual(r.queued, [{ id: 'B', reason: 'blocked', blockedBy: ['A'], lockedBy: [] }]);
});

test('AC1: a blocker that is started but not merged still blocks', () => {
  for (const status of ['claimed', 'planning', 'coding', 'review', 'fix', 'alarm', 'queued']) {
    const tickets = [t('A', [], ['a'], status), t('B', ['A'], ['b'])];
    assert.equal(isReady('B', tickets), false, `blocker status ${status}`);
    assert.deepEqual(openBlockers('B', tickets), ['A']);
  }
});

test('AC1: B becomes ready once its blocker is merged', () => {
  const tickets = [t('A', [], ['a'], 'merged'), t('B', ['A'], ['b'])];
  assert.deepEqual(readySet(tickets).ready, ['B']);
  assert.deepEqual(openBlockers('B', tickets), []);
});

test('AC1: every dep must be merged, one open dep is enough to block', () => {
  const tickets = [
    t('A', [], ['a'], 'merged'),
    t('B', [], ['b'], 'coding'),
    t('C', ['A', 'B'], ['c']),
  ];
  const r = readySet(tickets);
  assert.deepEqual(r.ready, []);
  assert.deepEqual(r.queued, [{ id: 'C', reason: 'blocked', blockedBy: ['B'], lockedBy: [] }]);
});

test('AC1: an unknown dep never closes, so the ticket is not ready', () => {
  const tickets = [t('B', ['GHOST'], ['b'])];
  assert.equal(isReady('B', tickets), false);
  assert.deepEqual(buildGraph(tickets).missing, [{ ticketId: 'B', dep: 'GHOST' }]);
});

test('AC1: a dependency cycle leaves every member not ready', () => {
  const tickets = [t('A', ['B'], ['a']), t('B', ['A'], ['b']), t('C', [], ['c'])];
  const g = buildGraph(tickets);
  assert.deepEqual(g.cyclic, ['A', 'B']);
  assert.deepEqual(readySet(tickets).ready, ['C']);
});

// AC2: Lock overlap keeps the second ticket queued.
test('AC2: lock overlap keeps the second ticket queued', () => {
  const tickets = [t('A', [], ['apps/viewer/src/graph']), t('B', [], ['apps/viewer/src/graph'])];
  const r = readySet(tickets);
  assert.deepEqual(r.ready, ['A']);
  assert.deepEqual(r.queued, [{ id: 'B', reason: 'lock', blockedBy: [], lockedBy: ['A'] }]);
});

test('AC2: a parent lock overlaps a child lock in both directions', () => {
  const parentFirst = [t('P', [], ['apps/viewer']), t('C', [], ['apps/viewer/styles'])];
  assert.deepEqual(readySet(parentFirst).ready, ['P']);
  const childFirst = [t('C', [], ['apps/viewer/styles']), t('P', [], ['apps/viewer'])];
  assert.deepEqual(readySet(childFirst).ready, ['C']);
});

test('AC2: a started ticket holds its locks against a ready candidate', () => {
  for (const status of ['claimed', 'coding', 'review', 'alarm']) {
    const tickets = [t('A', [], ['x/y'], status), t('B', [], ['x/y/z'])];
    const r = readySet(tickets);
    assert.deepEqual(r.ready, [], `holder status ${status}`);
    assert.deepEqual(r.queued[0].lockedBy, ['A']);
  }
});

test('AC2: the second ticket is released when the first merges', () => {
  const tickets = [t('A', [], ['x'], 'merged'), t('B', [], ['x'])];
  assert.deepEqual(readySet(tickets).ready, ['B']);
});

test('AC2: a blocked ticket is reported blocked, not lock-queued, and holds nothing', () => {
  const tickets = [t('A', [], ['a'], 'coding'), t('B', ['A'], ['x']), t('C', [], ['x'])];
  const r = readySet(tickets);
  assert.deepEqual(r.ready, ['C']);
  assert.equal(r.queued[0].reason, 'blocked');
});

test('paths overlap on segment boundaries only', () => {
  assert.equal(pathsOverlap('apps/viewer/src', 'apps/viewer/src/graph'), true);
  assert.equal(pathsOverlap('apps/viewer/src/graph/', './apps/viewer/src/graph'), true);
  assert.equal(pathsOverlap('apps/viewer/src', 'apps/viewer/src2'), false);
  assert.equal(pathsOverlap('docs', 'apps/viewer'), false);
  assert.equal(pathsOverlap('', 'apps'), false);
  assert.deepEqual(lockOverlaps(t('A', [], ['a', 'b/c']), t('B', [], ['b', 'z'])), [['b/c', 'b']]);
});

test('limit caps the ready set and queues the rest as cap', () => {
  const tickets = [t('A', [], ['a']), t('B', [], ['b']), t('C', [], ['c'])];
  const r = readySet(tickets, { limit: 2 });
  assert.deepEqual(r.ready, ['A', 'B']);
  assert.deepEqual(r.queued.map((q) => [q.id, q.reason]), [['C', 'cap']]);
});

test('graph: edges, dependents, topological order, and transitive blockers', () => {
  const tickets = [t('C', ['B']), t('B', ['A']), t('A'), t('D', ['A', 'C'])];
  const g = buildGraph(tickets);
  assert.deepEqual(g.edges, [
    { from: 'B', to: 'C' },
    { from: 'A', to: 'B' },
    { from: 'A', to: 'D' },
    { from: 'C', to: 'D' },
  ]);
  assert.deepEqual(g.dependents('A'), ['B', 'D']);
  assert.deepEqual(g.order, ['A', 'B', 'C', 'D']);
  assert.equal(g.depth.get('D'), 3);
  assert.deepEqual(g.cyclic, []);
  assert.deepEqual(transitiveBlockers('D', tickets), ['A', 'C', 'B']);
});

test('accepts a parse model as well as a bare ticket list', () => {
  const model = { tickets: [t('A', [], ['a']), t('B', ['A'], ['b'])] };
  assert.deepEqual(readySet(model).ready, ['A']);
});

// The real plan, through the real parser (WV-03).
test('plan: with nothing started only WV-01 is ready (its lock covers apps/viewer)', () => {
  const model = buildModel({ beam: FIXTURE, schedule: SCHEDULE });
  const g = buildGraph(model);
  assert.equal(g.ids.length, 16);
  assert.deepEqual(g.cyclic, []);
  assert.deepEqual(g.missing, []);
  const r = readySet(model);
  assert.deepEqual(r.ready, ['WV-01']);
  const wv02 = r.queued.find((q) => q.id === 'WV-02');
  assert.equal(wv02.reason, 'lock');
  assert.deepEqual(wv02.lockedBy, ['WV-01']);
  assert.equal(r.queued.find((q) => q.id === 'WV-04').reason, 'blocked');
});

test('plan: WV-04 is ready once WV-03 merges, and WV-07 stays blocked on WV-04 and WV-06', () => {
  const model = buildModel({ beam: FIXTURE, schedule: SCHEDULE });
  for (const id of ['WV-01', 'WV-02', 'WV-03', 'WV-05']) model.byId[id].status = 'merged';
  const r = readySet(model);
  assert.ok(r.ready.includes('WV-04'));
  assert.ok(r.ready.includes('WV-06'));
  const wv07 = readySet(model).queued.find((q) => q.id === 'WV-07');
  assert.deepEqual(wv07.blockedBy, ['WV-04', 'WV-06']);
  model.byId['WV-04'].status = 'coding';
  assert.equal(isReady('WV-04', model), false);
  assert.equal(isReady('WV-09', model), false);
});
