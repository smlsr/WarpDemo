import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CHIP_KINDS, stateKind, chipsFor, chipsHtml } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const kinds = (t, o) => chipsFor(t, o).map((c) => c.kind);

// AC 1: Critical tickets show the crit chip
test('critical ticket shows the crit chip', () => {
  assert.ok(kinds({ id: 'WV-04', status: 'queued', critical: true }).includes('crit'));
  assert.match(chipsHtml({ id: 'WV-04', status: 'queued', critical: true }), /class="chip crit"[^>]*>critical</);
});

test('critical path membership also shows the crit chip', () => {
  const o = { criticalPath: ['WV-07'] };
  assert.ok(kinds({ id: 'WV-07', status: 'queued' }, o).includes('crit'));
  assert.ok(!kinds({ id: 'WV-08', status: 'queued' }, o).includes('crit'));
});

test('non-critical ticket has no crit chip', () => {
  assert.ok(!kinds({ id: 'WV-08', status: 'queued', critical: false }).includes('crit'));
});

// AC 2: Merged tickets show the done chip
test('merged ticket shows the done chip', () => {
  assert.deepEqual(kinds({ id: 'WV-01', status: 'merged' }), ['done']);
  assert.match(chipsHtml({ id: 'WV-01', status: 'merged' }), /class="chip done"[^>]*>merged</);
});

test('merged critical ticket shows done and crit', () => {
  assert.deepEqual(kinds({ id: 'WV-04', status: 'merged', critical: true }), ['done', 'crit']);
});

test('unmerged tickets never show the done chip', () => {
  for (const status of ['queued', 'claimed', 'coding', 'review', 'alarm', undefined]) {
    assert.ok(!kinds({ id: 'X-1', status }).includes('done'), String(status));
  }
});

test('state chip is todo or run', () => {
  assert.equal(stateKind('queued'), 'todo');
  assert.equal(stateKind(undefined), 'todo');
  for (const s of ['claimed', 'planning', 'coding', 'review', 'fix', 'running']) {
    assert.equal(stateKind(s), 'run', s);
  }
  assert.equal(stateKind('Merged'), 'done');
});

test('gate chip from ticket gate or gate members', () => {
  assert.deepEqual(kinds({ id: 'WV-03', status: 'queued', gate: 'G0' }), ['todo', 'gate']);
  const o = { gates: [{ key: 'G1', members: ['WV-07'] }] };
  const chips = chipsFor({ id: 'WV-07', status: 'queued' }, o);
  assert.deepEqual(chips.map((c) => c.kind), ['todo', 'gate']);
  assert.deepEqual(chips[1].gates, ['G1']);
  assert.ok(!kinds({ id: 'WV-08', status: 'queued' }, o).includes('gate'));
});

test('every kind is one of the five chips, with a class from the build map', () => {
  assert.deepEqual([...CHIP_KINDS], ['todo', 'run', 'done', 'crit', 'gate']);
  const all = chipsFor({ id: 'A', status: 'coding', critical: true, gate: 'G0' });
  assert.deepEqual(all.map((c) => c.kind), ['run', 'crit', 'gate']);
});

test('chip html escapes gate titles', () => {
  assert.ok(!chipsHtml({ id: 'A', status: 'queued', gate: '"><b>' }).includes('<b>'));
});

test('chips.css styles every kind with theme tokens only', () => {
  const css = readFileSync(resolve(here, 'chips.css'), 'utf8');
  for (const k of CHIP_KINDS) assert.match(css, new RegExp(`\\.chip\\.${k}\\s*\\{[^}]*var\\(--`));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(css), 'no hard-coded colors');
});
