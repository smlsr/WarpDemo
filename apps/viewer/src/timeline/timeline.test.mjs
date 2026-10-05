import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel } from '../parse/index.mjs';
import { forecastStarts } from '../table/index.mjs';
import { markStarted, markMerged, emptyState } from '../tracker/index.mjs';
import { forecastSpans, agentRows, gateForecasts, dayCount, timelineHtml, createTimeline } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../../../../WarpView/fixtures/beam.sample.json'), 'utf8'));
const model = buildModel({ beam: fixture });

const T = (id, deps = [], hours = 8, extra = {}) => ({
  id, summary: `s ${id}`, deps, unlocks: [], status: 'queued', locks: [`l/${id}`], size: 'S', hours, ...extra,
});
const bar = (html, id) => html.match(new RegExp(`<div class="tl-bar" data-id="${id}"[^>]*>`))?.[0];
const gate = (html, key) => html.match(new RegExp(`<div class="tl-gate" data-gate="${key}"[^>]*>`))?.[0];
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))[1];

// AC 1: Bars sit on agent rows
test('every bar is inside the agent row it is assigned to', () => {
  const list = [T('A', [], 8, { agent: 'alice' }), T('B', ['A'], 8, { agent: 'bob' }), T('C', [], 16, { agent: 'alice' })];
  const html = timelineHtml(list);
  const rows = [...html.matchAll(/<div class="tl-row" data-agent="([^"]+)">(.*?)<\/div><\/div>/g)];
  assert.deepEqual(rows.map((r) => r[1]), ['alice', 'bob']);
  const inRow = (agent) => [...rows.find((r) => r[1] === agent)[2].matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(inRow('alice'), ['A', 'C']);
  assert.deepEqual(inRow('bob'), ['B']);
  for (const id of ['A', 'B', 'C']) assert.equal(attr(bar(html, id), 'data-agent'), list.find((t) => t.id === id).agent);
});

test('a bar spans its forecast start to its forecast end in days', () => {
  const list = [T('A', [], 8), T('B', ['A'], 12)];
  const html = timelineHtml(list);
  assert.equal(attr(bar(html, 'A'), 'data-start'), '0');
  assert.equal(attr(bar(html, 'A'), 'data-end'), '1');
  assert.equal(attr(bar(html, 'B'), 'data-start'), '1');
  assert.equal(attr(bar(html, 'B'), 'data-end'), '2.5');
  assert.match(bar(html, 'B'), /style="--s:1;--w:1\.5;/);
});

test('tickets without an agent are packed onto lanes with no overlap', () => {
  const list = [T('A', [], 8), T('B', [], 8), T('C', ['A'], 8), T('D', ['B'], 8)];
  const rows = agentRows(list);
  assert.deepEqual(rows.map((r) => r.agent), ['Agent 1', 'Agent 2']);
  assert.deepEqual(rows.map((r) => r.bars.map((b) => b.ticket.id)), [['A', 'C'], ['B', 'D']]);
  for (const r of rows) {
    r.bars.forEach((b, i) => i && assert.ok(b.start >= r.bars[i - 1].end, `${b.ticket.id} overlaps`));
  }
});

test('named agents come before packed lanes; every ticket gets exactly one bar', () => {
  const list = [T('A'), T('B', [], 8, { agent: 'shuttle-B' }), T('C')];
  const rows = agentRows(list);
  assert.deepEqual(rows.map((r) => r.agent), ['shuttle-B', 'Agent 1', 'Agent 2']);
  assert.equal(rows.flatMap((r) => r.bars).length, 3);
});

test('fixture: every ticket has one bar, on a row, starting after its deps finish', () => {
  const html = timelineHtml(model.tickets, model.gates);
  const spans = forecastSpans(model.tickets);
  for (const t of model.tickets) {
    const b = bar(html, t.id);
    assert.ok(b, t.id);
    assert.equal(html.split(`data-id="${t.id}"`).length - 1, 1, `${t.id} drawn once`);
    for (const d of t.deps) assert.ok(spans.get(d).end <= spans.get(t.id).start + 1e-9, `${t.id} after ${d}`);
  }
  const rowHtml = html.match(/<div class="tl-body">(.*?)<div class="tl-gates">/)[1];
  assert.equal([...rowHtml.matchAll(/class="tl-bar"/g)].length, 16);
});

test('bar start matches the ticket table forecast', () => {
  const html = timelineHtml(model.tickets, model.gates);
  const starts = forecastStarts(model.tickets);
  for (const t of model.tickets) assert.equal(Number(attr(bar(html, t.id), 'data-start')), starts.get(t.id));
});

test('merged tickets draw no bar; running tickets keep theirs', () => {
  const list = [T('A'), T('B', ['A'])];
  let s = markStarted(list, emptyState(), 'A');
  assert.equal(attr(bar(timelineHtml(list, [], s), 'A'), 'data-state'), 'run');
  s = markMerged(list, s, 'A');
  const html = timelineHtml(list, [], s);
  assert.equal(bar(html, 'A'), undefined);
  assert.equal(attr(bar(html, 'B'), 'data-start'), '0');
});

// Day columns
test('day columns cover the last bar and gate', () => {
  const list = [T('A', [], 8), T('B', ['A'], 12)];
  const html = timelineHtml(list);
  assert.deepEqual([...html.matchAll(/class="tl-day" data-day="(\d+)">Day \d+</g)].map((m) => m[1]), ['0', '1', '2']);
  assert.match(html, /class="timeline" style="--days:3"/);
  assert.equal(dayCount([], []), 1);
});

// AC 2: A blocking gate draws a solid line at its forecast
test('a blocking gate draws a solid line at its forecast day', () => {
  const list = [T('A', [], 8), T('B', ['A'], 16), T('C', [], 4)];
  const gates = [{ key: 'G1', name: 'Mid', blocking: true, members: ['B', 'C'] }];
  const html = timelineHtml(list, gates);
  const g = gate(html, 'G1');
  assert.ok(g);
  assert.equal(attr(g, 'data-line'), 'solid');
  assert.equal(attr(g, 'data-blocking'), 'true');
  assert.equal(attr(g, 'data-day'), '3');
  assert.match(g, /style="--s:3"/);
  assert.equal(attr(bar(html, 'B'), 'data-end'), '3');
});

test('a non-blocking gate is dashed, not solid', () => {
  const list = [T('A', [], 8)];
  const html = timelineHtml(list, [{ key: 'G9', blocking: false, members: ['A'] }]);
  assert.equal(attr(gate(html, 'G9'), 'data-line'), 'dashed');
});

test('a gate also takes tickets that name it in their gate field', () => {
  const list = [T('A', [], 8, { gate: 'G2' }), T('B', ['A'], 8, { gate: 'G2' })];
  const [g] = gateForecasts(list, [{ key: 'G2', blocking: true, members: [] }]);
  assert.equal(g.day, 2);
  assert.deepEqual(g.members, ['A', 'B']);
});

test('a gate moves to day 0 once its members merge, and is marked passed', () => {
  const list = [T('A'), T('B', ['A'])];
  const gates = [{ key: 'G0', blocking: true, members: ['A'] }];
  assert.equal(gateForecasts(list, gates)[0].day, 1);
  let s = markMerged(list, markStarted(list, emptyState(), 'A'), 'A');
  const [g] = gateForecasts(list, gates, s);
  assert.equal(g.day, 0);
  assert.equal(g.passed, true);
  assert.equal(attr(gate(timelineHtml(list, gates, s), 'G0'), 'data-passed'), 'true');
});

test('fixture: G0 and G1 are blocking, solid, and G1 sits after G0', () => {
  const html = timelineHtml(model.tickets, model.gates);
  const g0 = gate(html, 'G0');
  const g1 = gate(html, 'G1');
  assert.equal(attr(g0, 'data-line'), 'solid');
  assert.equal(attr(g1, 'data-line'), 'solid');
  const starts = forecastStarts(model.tickets);
  const ends = forecastSpans(model.tickets);
  // G0 members are WV-01 and WV-03: the gate sits on the later of their finishes.
  assert.equal(Number(attr(g0, 'data-day')), Math.round(Math.max(ends.get('WV-01').end, ends.get('WV-03').end) * 100) / 100);
  assert.ok(Number(attr(g1, 'data-day')) > Number(attr(g0, 'data-day')));
  assert.ok(Number(attr(g1, 'data-day')) >= starts.get('WV-07'));
});

test('a gate with no known member draws nothing', () => {
  const html = timelineHtml([T('A')], [{ key: 'GX', blocking: true, members: ['NOPE'] }]);
  assert.equal(gate(html, 'GX'), undefined);
});

// Robustness and controller
test('empty input, a dep cycle, and an unknown dep do not throw', () => {
  assert.match(timelineHtml([]), /Nothing left to schedule/);
  assert.ok(timelineHtml([T('A', ['B']), T('B', ['A']), T('C', ['X'])]).includes('class="timeline"'));
});

test('ticket and agent text is escaped', () => {
  const html = timelineHtml([T('A', [], 8, { agent: '<i>x</i>', summary: '<b>y</b>' })]);
  assert.ok(!html.includes('<i>x</i>') && !html.includes('<b>y</b>'));
});

test('the controller renders and redraws when the run state changes', () => {
  const el = { innerHTML: '' };
  const tl = createTimeline(model, el);
  assert.ok(bar(el.innerHTML, 'WV-01'));
  tl.setState({ merged: ['WV-01'], running: [] });
  assert.equal(bar(el.innerHTML, 'WV-01'), undefined);
  assert.equal(tl.rows().flatMap((r) => r.bars).length, 15);
  assert.equal(tl.gates().length, 2);
});
