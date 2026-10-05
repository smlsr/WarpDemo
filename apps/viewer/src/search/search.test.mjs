import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel } from '../parse/index.mjs';
import { boardHtml, emptyState } from '../tracker/index.mjs';
import { filterTickets, matchTicket, queryTerms, countLabel, createSearch } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../../../../WarpView/fixtures/beam.sample.json'), 'utf8'));
const model = buildModel({ beam: fixture });
const ids = (list) => list.map((t) => t.id);
const rowIds = (html) => [...html.matchAll(/class="row" data-id="([^"]+)"/g)].map((m) => m[1]);

test('fixture has 16 tickets', () => {
  assert.equal(model.tickets.length, 16);
});

// AC 1: Query WV-07 filters the table to that id
test('query WV-07 filters the list to that id', () => {
  assert.deepEqual(ids(filterTickets(model.tickets, 'WV-07')), ['WV-07']);
});

test('query WV-07 filters the rendered table to that id', () => {
  const table = { innerHTML: '' };
  createSearch(model.tickets, { table }, {
    renderRows: (list) => boardHtml(list, emptyState()),
    query: 'WV-07',
  });
  assert.deepEqual(rowIds(table.innerHTML), ['WV-07']);
});

test('typing WV-07 into the input filters the table', () => {
  const table = { innerHTML: '' };
  const count = { textContent: '' };
  let onInput;
  const input = { value: '', addEventListener: (ev, fn) => ev === 'input' && (onInput = fn) };
  createSearch(model.tickets, { input, table, count }, { renderRows: (l) => boardHtml(l, emptyState()) });
  assert.equal(rowIds(table.innerHTML).length, 16);
  input.value = 'WV-07';
  onInput();
  assert.deepEqual(rowIds(table.innerHTML), ['WV-07']);
  assert.equal(count.textContent, '1 of 16 tickets');
});

test('id match ignores case and surrounding spaces', () => {
  assert.deepEqual(ids(filterTickets(model.tickets, '  wv-07 ')), ['WV-07']);
});

// AC 2: Empty query shows every ticket
test('empty query returns every ticket in plan order', () => {
  assert.deepEqual(ids(filterTickets(model.tickets, '')), ids(model.tickets));
  assert.deepEqual(ids(filterTickets(model.tickets, '   ')), ids(model.tickets));
  assert.deepEqual(ids(filterTickets(model.tickets, undefined)), ids(model.tickets));
});

test('empty query renders every row and clearing restores them', () => {
  const table = { innerHTML: '' };
  const count = { textContent: '' };
  const s = createSearch(model.tickets, { table, count }, { renderRows: (l) => boardHtml(l, emptyState()) });
  assert.deepEqual(rowIds(table.innerHTML), ids(model.tickets));
  assert.equal(count.textContent, '16 tickets');
  s.setQuery('WV-07');
  assert.equal(rowIds(table.innerHTML).length, 1);
  s.clear();
  assert.deepEqual(rowIds(table.innerHTML), ids(model.tickets));
  assert.equal(count.textContent, '16 tickets');
});

// Summary and locks
test('matches the summary, case-insensitive', () => {
  const t = model.tickets.find((x) => x.id === 'WV-08');
  assert.ok(matchTicket(t, 'SEARCH ACROSS'));
  assert.ok(ids(filterTickets(model.tickets, 'ticket search')).includes('WV-08'));
});

test('matches a lock path', () => {
  assert.deepEqual(ids(filterTickets(model.tickets, 'apps/viewer/src/search')), ['WV-08']);
});

test('every word must match, across id, summary, and locks', () => {
  const list = [
    { id: 'A-1', summary: 'Alpha pane', locks: ['x/one'] },
    { id: 'A-2', summary: 'Beta pane', locks: ['x/two'] },
  ];
  assert.deepEqual(ids(filterTickets(list, 'pane')), ['A-1', 'A-2']);
  assert.deepEqual(ids(filterTickets(list, 'pane two')), ['A-2']);
  assert.deepEqual(ids(filterTickets(list, 'A-1 two')), []);
});

test('no match gives an empty list and a note', () => {
  const table = { innerHTML: '' };
  createSearch(model.tickets, { table }, { renderRows: () => 'x', query: 'zzz-nothing' });
  assert.deepEqual(filterTickets(model.tickets, 'zzz-nothing'), []);
  assert.match(table.innerHTML, /No tickets match/);
});

test('tolerates tickets without locks or summary', () => {
  assert.deepEqual(ids(filterTickets([{ id: 'X-1' }], 'x-1')), ['X-1']);
  assert.deepEqual(filterTickets([{ id: 'X-1' }], 'nope'), []);
});

test('helpers', () => {
  assert.deepEqual(queryTerms('  A  b '), ['a', 'b']);
  assert.equal(countLabel(3, 16), '3 of 16 tickets');
});
