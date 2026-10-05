import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel } from '../parse/index.mjs';
import { createTracker } from '../tracker/index.mjs';
import { STORAGE_KEY, loadState, saveState, resetState, createStore } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../../../../WarpView/fixtures/beam.sample.json'), 'utf8'));
const model = buildModel({ beam: fixture });

// A localStorage stand-in that outlives a "reload" because the test keeps it.
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    has: (k) => m.has(k),
  };
}
const els = () => ({ ready: { innerHTML: '' }, board: { innerHTML: '' } });
const boot = (storage) => {
  const store = createStore(storage);
  return { store, tracker: createTracker(model, els(), { state: store.load(), onChange: store.onChange }) };
};

// AC 1: Reload keeps merged ids
test('reload keeps merged ids and started ids', () => {
  const storage = fakeStorage();
  const first = boot(storage);
  assert.ok(first.tracker.markStarted('WV-01'));
  assert.ok(first.tracker.markMerged('WV-01'));
  assert.ok(first.tracker.markStarted('WV-02'));
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), { merged: ['WV-01'], running: ['WV-02'] });

  const second = boot(storage); // reload: new store and tracker, same storage
  assert.deepEqual(second.tracker.state, { merged: ['WV-01'], running: ['WV-02'] });
  const rows = second.tracker.board();
  assert.equal(rows.find((r) => r.ticket.id === 'WV-01').state, 'done');
  assert.equal(rows.find((r) => r.ticket.id === 'WV-02').state, 'run');
});

test('reload keeps merged ids so dependents become ready', () => {
  const storage = fakeStorage();
  const first = boot(storage);
  first.tracker.markStarted('WV-01');
  first.tracker.markMerged('WV-01');
  const before = first.tracker.startNow().map((t) => t.id);
  const second = boot(storage);
  assert.deepEqual(second.tracker.startNow().map((t) => t.id), before);
  assert.ok(before.includes('WV-03') || before.includes('WV-02'));
});

test('loadState returns what saveState wrote', () => {
  const storage = fakeStorage();
  assert.equal(saveState({ merged: ['A', 'B'], running: ['C'] }, storage), true);
  assert.deepEqual(loadState(storage), { merged: ['A', 'B'], running: ['C'] });
});

// AC 2: Reset clears both lists
test('reset clears both lists in memory and in storage', () => {
  const storage = fakeStorage();
  const first = boot(storage);
  first.tracker.markStarted('WV-01');
  first.tracker.markMerged('WV-01');
  first.tracker.markStarted('WV-02');
  assert.ok(storage.has(STORAGE_KEY));

  const cleared = first.store.reset();
  assert.deepEqual(cleared, { merged: [], running: [] });
  assert.equal(storage.has(STORAGE_KEY), false);

  const second = boot(storage); // reload after reset
  assert.deepEqual(second.tracker.state, { merged: [], running: [] });
  assert.deepEqual(resetState(storage), { merged: [], running: [] });
});

// Edge cases: storage is never trusted.
test('missing, empty, or corrupt storage gives an empty state', () => {
  assert.deepEqual(loadState(fakeStorage()), { merged: [], running: [] });
  assert.deepEqual(loadState(fakeStorage({ [STORAGE_KEY]: '' })), { merged: [], running: [] });
  assert.deepEqual(loadState(fakeStorage({ [STORAGE_KEY]: '{not json' })), { merged: [], running: [] });
  assert.deepEqual(loadState(fakeStorage({ [STORAGE_KEY]: '42' })), { merged: [], running: [] });
  assert.deepEqual(loadState(fakeStorage({ [STORAGE_KEY]: 'null' })), { merged: [], running: [] });
});

test('saved junk is cleaned: dedupe, strings only, merged wins over running', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ merged: ['A', 'A', 1], running: ['A', 'B', 'B'] }) });
  assert.deepEqual(loadState(storage), { merged: ['A', '1'], running: ['B'] });
});

test('no storage or a throwing storage never throws', () => {
  const boom = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.deepEqual(loadState(boom), { merged: [], running: [] });
  assert.equal(saveState({ merged: ['A'], running: [] }, boom), false);
  assert.deepEqual(resetState(boom), { merged: [], running: [] });
  assert.equal(saveState({ merged: ['A'], running: [] }, null), false);
  assert.deepEqual(resetState(null), { merged: [], running: [] });
  const t = createTracker(model, els(), { state: loadState(boom), onChange: createStore(boom).onChange });
  assert.ok(t.markStarted('WV-01'));
  assert.deepEqual(t.state.running, ['WV-01']);
});

test('a custom key keeps stores apart', () => {
  const storage = fakeStorage();
  saveState({ merged: ['A'], running: [] }, storage, 'k1');
  assert.deepEqual(loadState(storage, 'k2'), { merged: [], running: [] });
  assert.deepEqual(loadState(storage, 'k1'), { merged: ['A'], running: [] });
});
