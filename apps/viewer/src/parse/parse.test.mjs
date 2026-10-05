import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildModel, parseStatus, loadModelFromFiles, loadModelFromUrls, ModelError } from './index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = resolve(root, 'WarpView', 'fixtures', 'beam.sample.json');
const SCHEDULE = resolve(root, 'WarpView', 'plan', 'schedule.json');
const text = (p) => readFileSync(p, 'utf8');

const STATUS = `# Warp status

Warp v1.3.12

Updated 2026-10-05T14:13:22Z · runState=running

Done 1 · working 1 · left 1

## Working now

- **WV-02** claimed agent=shuttle-WV-02 pr=— — Theme tokens matching the build-map palette

## Done

- **WV-01** merged — Viewer repo skeleton and static host

## Left

- **WV-04** queued L — Dependency graph and ready-set from blockers
`;

// WV-03 AC1: Fixture beam of 16 tickets loads
test('WV-03 AC1: the fixture beam of 16 tickets loads', () => {
  const m = buildModel({ beam: text(FIXTURE) });
  assert.equal(m.tickets.length, 16);
  assert.equal(Object.keys(m.byId).length, 16);
  assert.deepEqual(m.byId['WV-03'].deps, ['WV-01']);
  assert.deepEqual(m.byId['WV-03'].locks, ['apps/viewer/src/parse']);
  assert.equal(m.byId['WV-03'].ac.length, 2);
  assert.equal(m.byId['WV-03'].status, 'queued');
  assert.equal(m.gates.length, 2);
});

test('WV-03 AC1: the fixture loads from a parsed object and from disk', async () => {
  assert.equal(buildModel({ beam: JSON.parse(text(FIXTURE)) }).tickets.length, 16);
  const m = await loadModelFromFiles({ beam: FIXTURE, status: '/nope/STATUS.md', schedule: SCHEDULE });
  assert.equal(m.tickets.length, 16);
  assert.equal(m.sources.status, false);
});

test('WV-03 AC1: the fixture loads over fetch and skips a 404 source', async () => {
  const files = { '/beam.json': text(FIXTURE), '/schedule.json': text(SCHEDULE) };
  const fake = async (url) => {
    const body = files[url];
    return body === undefined
      ? { ok: false, status: 404, text: async () => '' }
      : { ok: true, status: 200, text: async () => body };
  };
  const m = await loadModelFromUrls({ beam: '/beam.json', status: '/STATUS.md', schedule: '/schedule.json' }, fake);
  assert.equal(m.tickets.length, 16);
});

test('WV-03: schedule, beam state, and STATUS merge into one model', () => {
  const schedule = JSON.parse(text(SCHEDULE));
  const beam = {
    runState: 'running',
    tickets: {
      'WV-01': { id: 'WV-01', status: 'merged', agent: 'shuttle-WV-01', pr: { url: 'https://x/pr/1' } },
      'WV-03': { id: 'WV-03', status: 'coding', branch: 'warp/WV-03', deps: ['WV-01'] },
    },
  };
  const m = buildModel({ beam, status: STATUS, schedule });
  assert.equal(m.tickets.length, 16);
  assert.equal(m.tickets[0].id, 'WV-01', 'schedule order is kept');
  assert.equal(m.byId['WV-01'].status, 'merged');
  assert.equal(m.byId['WV-01'].pr, 'https://x/pr/1');
  assert.equal(m.byId['WV-03'].status, 'coding');
  assert.equal(m.byId['WV-03'].branch, 'warp/WV-03');
  assert.equal(m.byId['WV-03'].size, 'M', 'plan fields come from the schedule');
  assert.equal(m.byId['WV-02'].status, 'claimed', 'STATUS fills what the beam lacks');
  assert.equal(m.byId['WV-02'].agent, 'shuttle-WV-02');
  assert.equal(m.byId['WV-05'].status, 'queued');
  assert.deepEqual(m.byId['WV-01'].unlocks.includes('WV-03'), true);
  assert.deepEqual(m.criticalPath, ['WV-04', 'WV-07', 'WV-10', 'WV-13', 'WV-15']);
  assert.equal(m.byId['WV-04'].critical, true);
  assert.equal(m.runState, 'running');
  assert.equal(m.version, '1.3.12');
});

test('WV-03: STATUS.md parses sections, counts, and ticket lines', () => {
  const s = parseStatus(STATUS);
  assert.equal(s.version, '1.3.12');
  assert.equal(s.updatedAt, '2026-10-05T14:13:22Z');
  assert.equal(s.runState, 'running');
  assert.deepEqual(s.counts, { done: 1, working: 1, left: 1 });
  assert.deepEqual(s.tickets['WV-02'], {
    id: 'WV-02',
    status: 'claimed',
    section: 'working',
    agent: 'shuttle-WV-02',
    summary: 'Theme tokens matching the build-map palette',
  });
  assert.equal(s.tickets['WV-01'].status, 'merged');
  assert.equal(s.tickets['WV-04'].size, 'L');
  assert.equal(s.tickets['WV-04'].summary, 'Dependency graph and ready-set from blockers');
  assert.deepEqual(parseStatus('').tickets, {});
  assert.deepEqual(parseStatus(null).tickets, {});
});

// WV-03 AC2: Missing deps fail with the ticket id named
test('WV-03 AC2: a missing dep fails and names the ticket id', () => {
  const beam = JSON.parse(text(FIXTURE));
  beam.tickets.find((t) => t.id === 'WV-06').deps.push('WV-99');
  assert.throws(
    () => buildModel({ beam }),
    (err) => {
      assert.ok(err instanceof ModelError);
      assert.match(err.message, /WV-06/);
      assert.match(err.message, /WV-99/);
      assert.deepEqual(err.ticketIds, ['WV-06']);
      assert.equal(err.problems[0].code, 'missing-dep');
      assert.equal(err.problems[0].dep, 'WV-99');
      return true;
    },
  );
});

test('WV-03 AC2: every ticket with a missing dep is named, from any source', () => {
  const schedule = JSON.parse(text(SCHEDULE));
  schedule.tickets.find((t) => t.id === 'WV-04').deps = ['WV-77'];
  schedule.tickets.find((t) => t.id === 'WV-12').deps = ['WV-06', 'WV-88'];
  assert.throws(
    () => buildModel({ schedule }),
    (err) => {
      assert.deepEqual(err.ticketIds, ['WV-04', 'WV-12']);
      assert.match(err.message, /WV-04 depends on WV-77/);
      assert.match(err.message, /WV-12 depends on WV-88/);
      return true;
    },
  );
});

test('WV-03 AC2: a dep missing from the beam but present in the schedule is fine', () => {
  const beam = { tickets: { 'WV-03': { id: 'WV-03', deps: ['WV-01'] } } };
  const schedule = JSON.parse(text(SCHEDULE));
  assert.equal(buildModel({ beam, schedule }).tickets.length, 16);
  assert.throws(() => buildModel({ beam }), /WV-03 depends on WV-01/);
});

test('WV-03: self deps, duplicate ids, bad JSON, and empty input fail clearly', () => {
  assert.throws(
    () => buildModel({ beam: { tickets: [{ id: 'A-1', deps: ['A-1'] }] } }),
    /A-1 depends on itself/,
  );
  assert.throws(
    () => buildModel({ beam: { tickets: [{ id: 'A-1' }, { id: 'A-1' }] } }),
    /A-1 is defined more than once/,
  );
  assert.throws(() => buildModel({ beam: '{nope' }), /beam\.json is not valid JSON/);
  assert.throws(() => buildModel({ beam: { tickets: [{ summary: 'no id' }] } }), /has no id/);
  assert.throws(() => buildModel({}), /No tickets/);
});
