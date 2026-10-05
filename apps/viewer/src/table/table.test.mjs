import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel } from '../parse/index.mjs';
import { markStarted, markMerged, emptyState } from '../tracker/index.mjs';
import { COLUMNS, forecastStarts, tableRows, tableHtml, createTable } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../../../../WarpView/fixtures/beam.sample.json'), 'utf8'));
const model = buildModel({ beam: fixture });
const ids = (rows) => rows.map((r) => r.ticket.id);

const T = (id, deps = [], hours = 8, status = 'queued') => ({
  id, summary: `s ${id}`, deps, unlocks: [], status, locks: [`l/${id}`], size: 'S', hours,
});
const fakeEl = () => ({ innerHTML: '' });
const clickOn = (id) => ({ target: { closest: () => ({ dataset: { id } }) } });

// AC 1: Columns include size, deps, and unlocks
test('columns include size, deps, and unlocks', () => {
  const keys = COLUMNS.map((c) => c.key);
  for (const k of ['size', 'deps', 'unlocks']) assert.ok(keys.includes(k), k);
});

test('rendered header has size, deps, and unlocks columns', () => {
  const html = tableHtml(model.tickets);
  for (const label of ['Size', 'Deps', 'Unlocks', 'Forecast start']) {
    assert.match(html, new RegExp(`<th scope="col" data-col="[a-z]+">${label}</th>`));
  }
});

test('a row shows size, its deps, and what it unlocks', () => {
  const list = [T('A'), T('B', ['A']), T('C', ['A', 'B'])];
  list[0].unlocks = ['B', 'C'];
  list[1].unlocks = ['C'];
  list[2].size = 'M';
  const html = tableHtml(list);
  const row = (id) => html.match(new RegExp(`<tr[^>]*data-id="${id}".*?</tr>`))[0];
  assert.match(row('C'), /<td class="c-size">M<\/td>/);
  assert.match(row('C'), /<td class="c-deps">A, B<\/td>/);
  assert.match(row('A'), /<td class="c-unlocks">B, C<\/td>/);
  assert.match(row('A'), /<td class="c-deps">\u2014<\/td>/);
  assert.match(row('C'), /<td class="c-unlocks">\u2014<\/td>/);
});

test('fixture rows carry size, deps, and unlocks from the model', () => {
  const html = tableHtml(model.tickets);
  const wv06 = html.match(/<tr[^>]*data-id="WV-06".*?<\/tr>/)[0];
  assert.match(wv06, /<td class="c-size">M<\/td>/);
  assert.match(wv06, /<td class="c-deps">WV-03, WV-05<\/td>/);
  assert.match(wv06, /<td class="c-unlocks">[^<]*WV-07[^<]*<\/td>/);
});

// Sort by forecast start
test('rows are sorted by forecast start, ties in plan order', () => {
  const list = [T('A', ['B']), T('B', [], 16), T('C'), T('D', ['B'])];
  const rows = tableRows(list);
  assert.deepEqual(ids(rows), ['B', 'C', 'A', 'D']);
  assert.deepEqual(rows.map((r) => r.start), [0, 0, 2, 2]);
});

test('forecast start follows the longest dep chain in days', () => {
  const list = [T('A', [], 8), T('B', ['A'], 16), T('C', ['A'], 4), T('D', ['B', 'C'])];
  const s = forecastStarts(list);
  assert.deepEqual([...s], [['A', 0], ['B', 1], ['C', 1], ['D', 3]]);
});

test('merged deps do not delay the forecast; running deps do', () => {
  const list = [T('A', [], 8), T('B', ['A'])];
  assert.equal(forecastStarts(list).get('B'), 1);
  let s = markStarted(list, emptyState(), 'A');
  assert.equal(forecastStarts(list, s).get('B'), 1);
  s = markMerged(list, s, 'A');
  assert.equal(forecastStarts(list, s).get('B'), 0);
});

test('fixture table is sorted and never starts a ticket before its deps', () => {
  const rows = tableRows(model.tickets);
  assert.equal(rows.length, 16);
  const starts = rows.map((r) => r.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  const at = new Map(rows.map((r) => [r.ticket.id, r.start]));
  for (const { ticket } of rows) for (const d of ticket.deps) assert.ok(at.get(d) <= at.get(ticket.id));
  assert.deepEqual(ids(rows).slice(0, 2), ['WV-01', 'WV-02']);
});

test('a dep cycle or unknown dep does not throw', () => {
  const list = [T('A', ['B']), T('B', ['A']), T('C', ['X'])];
  assert.equal(tableRows(list).length, 3);
});

test('summary text is escaped', () => {
  const html = tableHtml([{ ...T('A'), summary: '<b>x</b>' }]);
  assert.ok(!html.includes('<b>x</b>'));
});

// AC 2: Row click opens the drawer
test('row click opens the drawer with that ticket id', () => {
  const opened = [];
  const table = createTable(model, fakeEl(), { onOpen: (id) => opened.push(id) });
  assert.equal(table.handleClick(clickOn('WV-06')), true);
  assert.deepEqual(opened, ['WV-06']);
});

test('every rendered row carries its id for the click handler', () => {
  const el = fakeEl();
  createTable(model, el);
  for (const t of model.tickets) assert.ok(el.innerHTML.includes(`data-id="${t.id}"`));
});

test('a click outside a row, or on an unknown id, opens nothing', () => {
  const opened = [];
  const table = createTable(model, fakeEl(), { onOpen: (id) => opened.push(id) });
  assert.equal(table.handleClick({ target: { closest: () => null } }), false);
  assert.equal(table.handleClick(clickOn('NOPE')), false);
  assert.equal(table.handleClick(undefined), false);
  assert.deepEqual(opened, []);
});

test('Enter and Space on a row open the drawer; other keys do not', () => {
  const opened = [];
  const table = createTable(model, fakeEl(), { onOpen: (id) => opened.push(id) });
  let prevented = 0;
  const key = (k) => ({ ...clickOn('WV-03'), key: k, preventDefault: () => prevented++ });
  assert.equal(table.handleKey(key('Enter')), true);
  assert.equal(table.handleKey(key(' ')), true);
  assert.equal(table.handleKey(key('a')), false);
  assert.deepEqual(opened, ['WV-03', 'WV-03']);
  assert.equal(prevented, 2);
});

test('setState redraws the table with the new order and state', () => {
  const el = fakeEl();
  const table = createTable({ tickets: [T('A', [], 8), T('B', ['A'])] }, el);
  assert.match(el.innerHTML, /data-id="B"[^>]*data-start="1"/);
  table.setState({ merged: ['A'], running: [] });
  assert.match(el.innerHTML, /data-id="B"[^>]*data-start="0"/);
  assert.match(el.innerHTML, /data-id="A"[^>]*data-state="done"/);
});
