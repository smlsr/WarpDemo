import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel } from '../parse/index.mjs';
import { emptyState, markStarted, markMerged } from '../tracker/index.mjs';
import { locksOf, blockersOf, criteriaOf, drawerModel, drawerHtml, createDrawer } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../../../../WarpView/fixtures/beam.sample.json'), 'utf8'));
const model = buildModel({ beam: fixture });
const byId = model.byId;

const T = (id, deps = [], extra = {}) => ({ id, summary: `s ${id}`, deps, status: 'queued', locks: [`l/${id}`], ac: [], ...extra });
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const section = (html, name) => html.split(`data-sec="${name}"`)[1].split('</section>')[0];

// AC 1: Drawer lists lock folders
test('AC1: drawer lists the lock folder of WV-10 from the fixture beam', () => {
  const html = drawerHtml(byId['WV-10'], model.tickets);
  const locks = section(html, 'locks');
  assert.deepEqual([...locks.matchAll(/data-lock="([^"]+)"/g)].map((m) => m[1]), ['apps/viewer/src/drawer']);
  assert.match(locks, /<code>apps\/viewer\/src\/drawer<\/code>/);
});

test('AC1: every lock folder of a ticket is listed, in order, once', () => {
  const t = T('A', [], { locks: ['x/one', 'x/two', 'x/one', 'x/three'] });
  assert.deepEqual(locksOf(t), ['x/one', 'x/two', 'x/three']);
  const locks = section(drawerHtml(t, [t]), 'locks');
  assert.deepEqual([...locks.matchAll(/data-lock="([^"]+)"/g)].map((m) => m[1]), ['x/one', 'x/two', 'x/three']);
});

test('AC1: every fixture ticket lists exactly its own lock folders', () => {
  for (const t of model.tickets) {
    const locks = section(drawerHtml(t, model.tickets), 'locks');
    const listed = [...locks.matchAll(/data-lock="([^"]+)"/g)].map((m) => decode(m[1]));
    assert.deepEqual(listed, t.locks, t.id);
    assert.ok(listed.length >= 1, `${t.id} has a lock`);
  }
});

test('AC1: a ticket with no locks says so', () => {
  const t = T('A', [], { locks: [] });
  assert.match(section(drawerHtml(t, [t]), 'locks'), /No lock folders/);
});

// AC 2: Blocker links open the blocker ticket
test('AC2: each blocker is a link that names the blocker ticket', () => {
  const html = drawerHtml(byId['WV-13'], model.tickets);
  const sec = section(html, 'blockers');
  const links = [...sec.matchAll(/<a href="#ticket=(WV-\d+)" data-act="open" data-open="(WV-\d+)">/g)];
  assert.deepEqual(links.map((m) => m[1]), ['WV-07', 'WV-09', 'WV-10', 'WV-11']);
  assert.deepEqual(links.map((m) => m[2]), ['WV-07', 'WV-09', 'WV-10', 'WV-11']);
});

test('AC2: clicking a blocker link opens the drawer for the blocker ticket', () => {
  const els = { drawer: { innerHTML: '' } };
  const opened = [];
  const drawer = createDrawer(model, els, { onOpen: (id) => opened.push(id) });
  assert.equal(drawer.open('WV-10'), true);
  assert.match(els.drawer.innerHTML, /data-id="WV-10"/);
  assert.match(els.drawer.innerHTML, /data-open="WV-06"/);

  let prevented = false;
  const link = { dataset: { act: 'open', open: 'WV-06' } };
  assert.equal(drawer.handleClick({ target: link, preventDefault: () => (prevented = true) }), true);
  assert.equal(prevented, true);
  assert.equal(drawer.openId, 'WV-06');
  assert.match(els.drawer.innerHTML, /<aside class="drawer" data-id="WV-06"/);
  assert.doesNotMatch(els.drawer.innerHTML, /<aside class="drawer" data-id="WV-10"/);
  assert.deepEqual(opened, ['WV-10', 'WV-06']);
});

test('AC2: a click inside the link (on its inner span) also opens the blocker', () => {
  const drawer = createDrawer(model, { drawer: { innerHTML: '' } });
  drawer.open('WV-10');
  const link = { dataset: { act: 'open', open: 'WV-06' } };
  const inner = { dataset: {}, closest: (sel) => (sel === '[data-act="open"]' ? link : null) };
  assert.equal(drawer.handleClick({ target: inner }), true);
  assert.equal(drawer.openId, 'WV-06');
});

test('AC2: following blockers walks back to a ticket with none', () => {
  const drawer = createDrawer(model, { drawer: { innerHTML: '' } });
  drawer.open('WV-13');
  const seen = [drawer.openId];
  for (let i = 0; i < 10; i++) {
    const next = drawer.model().blockers[0];
    if (!next) break;
    drawer.handleClick({ target: { dataset: { act: 'open', open: next.id } } });
    seen.push(drawer.openId);
  }
  assert.deepEqual(seen, ['WV-13', 'WV-07', 'WV-04', 'WV-03', 'WV-01']);
  assert.match(section(drawerHtml(byId['WV-01'], model.tickets), 'blockers'), /No blockers/);
});

test('AC2: every blocker link in the fixture points at a ticket that exists', () => {
  for (const t of model.tickets) {
    const sec = section(drawerHtml(t, model.tickets), 'blockers');
    const ids = [...sec.matchAll(/data-open="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, t.deps, t.id);
    for (const id of ids) assert.ok(byId[id], `${t.id} -> ${id}`);
  }
});

test('AC2: a blocker that is not in the plan is shown, blocks, and has no link', () => {
  const t = T('A', ['GONE']);
  const b = blockersOf(t, [t]);
  assert.deepEqual(b.map((x) => [x.id, x.missing, x.blocking]), [['GONE', true, true]]);
  const sec = section(drawerHtml(t, [t]), 'blockers');
  assert.match(sec, /data-blocker="GONE"/);
  assert.doesNotMatch(sec, /<a /);
  const drawer = createDrawer({ tickets: [t] }, { drawer: { innerHTML: '' } });
  assert.equal(drawer.open('GONE'), false);
  assert.equal(drawer.openId, null);
});

test('blockers follow tracker state: merged stops blocking, running still blocks', () => {
  const list = [T('A'), T('B', ['A'])];
  let s = markStarted(list, emptyState(), 'A');
  assert.equal(blockersOf(list[1], list, s)[0].state, 'run');
  assert.equal(blockersOf(list[1], list, s)[0].blocking, true);
  s = markMerged(list, s, 'A');
  assert.equal(blockersOf(list[1], list, s)[0].blocking, false);
  assert.match(drawerHtml(list[1], list, s), /data-blocker="A" data-blocking="false" data-state="done"/);
});

test('the open drawer redraws when tracker state changes', () => {
  const list = [T('A'), T('B', ['A'])];
  const els = { drawer: { innerHTML: '' } };
  const drawer = createDrawer({ tickets: list }, els);
  drawer.open('B');
  assert.match(els.drawer.innerHTML, /data-blocking="true"/);
  drawer.setState({ merged: ['A'], running: [] });
  assert.match(els.drawer.innerHTML, /data-blocking="false"/);
});

// Acceptance criteria section and general behavior
test('drawer lists the acceptance criteria of WV-10', () => {
  assert.deepEqual(criteriaOf(byId['WV-10']), ['Drawer lists lock folders', 'Blocker links open the blocker ticket']);
  const sec = section(drawerHtml(byId['WV-10'], model.tickets), 'criteria');
  assert.equal((sec.match(/class="ac"/g) || []).length, 2);
  assert.match(sec, /Drawer lists lock folders/);
  assert.match(sec, /Blocker links open the blocker ticket/);
});

test('drawer header shows the id, summary, and effective state chip', () => {
  const s = markStarted(model.tickets, emptyState(), 'WV-01');
  const html = drawerHtml(byId['WV-01'], model.tickets, s);
  assert.match(html, /data-state="run"/);
  assert.match(html, /class="chip run"[^>]*>running</);
  assert.match(html, /Viewer repo skeleton/);
});

test('drawerModel is plain data', () => {
  const m = drawerModel(byId['WV-10'], model.tickets);
  assert.equal(m.id, 'WV-10');
  assert.deepEqual(m.locks, ['apps/viewer/src/drawer']);
  assert.deepEqual(m.blockers.map((b) => b.id), ['WV-06']);
  assert.equal(m.criteria.length, 2);
});

test('close empties the drawer and open of an unknown or the same id does nothing', () => {
  const els = { drawer: { innerHTML: '' } };
  const drawer = createDrawer(model, els);
  assert.equal(els.drawer.innerHTML, '');
  assert.equal(drawer.open('NOPE'), false);
  assert.equal(drawer.open('WV-10'), true);
  assert.equal(drawer.open('WV-10'), false);
  assert.equal(drawer.handleClick({ target: { dataset: { act: 'close' } } }), true);
  assert.equal(drawer.openId, null);
  assert.equal(els.drawer.innerHTML, '');
  assert.equal(drawer.close(), false);
});

test('clicks that are not drawer links do nothing', () => {
  const drawer = createDrawer(model, { drawer: { innerHTML: '' } });
  assert.equal(drawer.handleClick({ target: { dataset: {}, closest: () => null } }), false);
  assert.equal(drawer.handleClick({}), false);
  assert.equal(drawer.openId, null);
});

test('drawer html escapes ticket text', () => {
  const t = T('A', ['B'], { summary: '<b>"x"</b>', locks: ['a/<i>'], ac: ['<script>'] });
  const b = T('B', [], { summary: '<u>' });
  const html = drawerHtml(t, [t, b]);
  assert.doesNotMatch(html, /<b>|<i>|<script>|<u>/);
  assert.match(html, /&lt;script&gt;/);
});
