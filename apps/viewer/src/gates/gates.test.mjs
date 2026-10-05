import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel } from '../parse/index.mjs';
import { emptyState } from '../tracker/index.mjs';
import { memberStatus, isReached, gateView, gates, gateHtml, gatesHtml, createGates } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../../../../WarpView/fixtures/beam.sample.json'), 'utf8'));
const model = buildModel({ beam: fixture });
const T = (id, status = 'queued') => ({ id, summary: `s ${id}`, deps: [], status, locks: [`l/${id}`], size: 'S' });
const G = (over = {}) => ({ key: 'GX', name: 'Gate X', blocking: true, members: ['A', 'B'], checks: ['run it'], ifRed: 'stop', ...over });
const stateWith = (merged = [], running = []) => ({ merged, running });
const gateEl = (html, key) => html.match(new RegExp(`<article class="gate" data-gate="${key}"[\\s\\S]*?</article>`))[0];

// AC 1: G0 shows its check command
test('G0 shows its check command', () => {
  const html = gatesHtml(model, emptyState());
  const g0 = gateEl(html, 'G0');
  assert.match(g0, /G0 · Model loads/);
  assert.match(g0, /<code class="check">Open ui\/build-map\.html and read 16 tickets from the fixture beam<\/code>/);
});

test('every check of a gate is listed, in order', () => {
  const g1 = gateEl(gatesHtml(model, emptyState()), 'G1');
  const a = g1.indexOf('Gate line sits on the G0 forecast');
  const b = g1.indexOf('Ready set matches the tracker');
  assert.ok(a > 0 && b > a);
  assert.equal((g1.match(/class="check"/g) || []).length, 2);
});

test('the if-red text is shown for each gate', () => {
  const html = gatesHtml(model, emptyState());
  assert.match(gateEl(html, 'G0'), /If red:<\/b> Nobody starts panes\. Fix the parser on the WV-03 branch\./);
  assert.match(gateEl(html, 'G1'), /Do not wire the offline demo until the timeline and gates match\./);
});

test('a gate with no checks says so and one with no if-red omits the line', () => {
  const html = gateHtml(gateView(G({ checks: [], ifRed: '' }), [T('A'), T('B')]));
  assert.match(html, /No checks listed/);
  assert.doesNotMatch(html, /If red/);
});

test('check and if-red text is escaped', () => {
  const html = gateHtml(gateView(G({ checks: ['a <b> & "c"'], ifRed: '<script>x</script>' }), []));
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>c|a <b>/);
  assert.match(html, /a &lt;b&gt; &amp; &quot;c&quot;/);
});

// AC 2: Reached state appears when every member is merged
test('reached appears when every member is merged', () => {
  const tickets = [T('A', 'merged'), T('B', 'merged')];
  assert.equal(isReached(G(), tickets), true);
  const html = gateHtml(gateView(G(), tickets));
  assert.match(html, /data-state="reached"/);
  assert.match(html, /class="state reached">Reached</);
});

test('reached does not appear while any member is not merged', () => {
  for (const other of ['queued', 'running', 'claimed']) {
    const tickets = [T('A', 'merged'), T('B', other)];
    assert.equal(isReached(G(), tickets), false);
    const html = gateHtml(gateView(G(), tickets));
    assert.match(html, /data-state="open"/);
    assert.match(html, /Open · 1\/2 merged/);
    assert.doesNotMatch(html, /Reached/);
  }
});

test('marking members merged in the browser state reaches the gate', () => {
  const tickets = [T('A'), T('B')];
  assert.equal(isReached(G(), tickets, stateWith(['A'])), false);
  assert.equal(isReached(G(), tickets, stateWith(['A', 'B'])), true);
  assert.equal(isReached(G(), tickets, stateWith(['A'], ['B'])), false);
});

test('the browser state wins over the ticket status', () => {
  const tickets = [T('A', 'merged'), T('B', 'merged')];
  assert.equal(isReached(G(), tickets, emptyState()), true);
  // A is listed as running in the browser, so it is not merged there.
  assert.equal(isReached(G(), tickets, stateWith([], ['A'])), false);
});

test('a member missing from the ticket list is open, so the gate is not reached', () => {
  const tickets = [T('A', 'merged')];
  const s = memberStatus(G(), tickets);
  assert.deepEqual(s.merged, ['A']);
  assert.deepEqual(s.open, ['B']);
  assert.equal(isReached(G(), tickets), false);
});

test('a gate with no members is never reached', () => {
  assert.equal(isReached(G({ members: [] }), [T('A', 'merged')]), false);
  assert.equal(isReached({ key: 'GZ' }, []), false);
});

test('fixture gates: not reached at the start, reached when members merge', () => {
  assert.deepEqual(gates(model, emptyState()).map((g) => [g.key, g.reached]), [['G0', false], ['G1', false]]);
  const g0 = model.gates.find((g) => g.key === 'G0');
  const after = stateWith(g0.members);
  const views = gates(model, after);
  assert.equal(views.find((g) => g.key === 'G0').reached, true);
  assert.equal(views.find((g) => g.key === 'G1').reached, false);
  assert.match(gateEl(gatesHtml(model, after), 'G0'), /data-state="reached"/);
});

test('blocking gates carry data-blocking', () => {
  assert.match(gateHtml(gateView(G(), [])), /data-blocking="true"/);
  assert.doesNotMatch(gateHtml(gateView(G({ blocking: false }), [])), /data-blocking/);
});

test('a model with no gates shows an empty note', () => {
  assert.match(gatesHtml({ tickets: [], gates: [] }), /No gates/);
  assert.match(gatesHtml({ tickets: [] }), /No gates/);
});

test('createGates renders into the element and updates on state change', () => {
  const el = { innerHTML: '' };
  const pane = createGates(model, el);
  assert.doesNotMatch(el.innerHTML, /data-state="reached"/);
  const g0 = model.gates.find((g) => g.key === 'G0');
  pane.setState(stateWith(g0.members));
  assert.match(gateEl(el.innerHTML, 'G0'), /data-state="reached"/);
  assert.equal(pane.views().find((g) => g.key === 'G0').reached, true);
});
