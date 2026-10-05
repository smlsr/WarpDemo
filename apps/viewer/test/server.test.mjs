import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createViewer } from '../server.mjs';

let server;
let base;

before(async () => {
  server = createViewer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

// WV-01 AC1: `pnpm install && pnpm dev` serves ui/build-map.html
test('WV-01 AC1: / serves ui/build-map.html', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /<h1>WarpView<\/h1>/);
  const direct = await fetch(`${base}/build-map.html`);
  assert.equal(await direct.text(), body);
});

// WV-01 AC2: no edit controls are rendered
test('WV-01 AC2: edit mode is off and the edit bar stays hidden', async () => {
  const body = await (await fetch(`${base}/`)).text();
  assert.match(body, /const EDIT = false;/);
  assert.match(body, /<div class="editbar" id="editbar" hidden>/);
  assert.doesNotMatch(body, /contenteditable/i);
});

test('WV-01 AC2: host exposes no write routes', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await fetch(`${base}/beam.json`, { method, body: '{}' });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
  }
});

test('host stays inside ui/ and 404s unknown files', async () => {
  assert.equal((await fetch(`${base}/missing.html`)).status, 404);
  const res = await fetch(`${base}/..%2f..%2fapps%2fviewer%2fpackage.json`);
  assert.ok([403, 404].includes(res.status));
  assert.equal((await fetch(`${base}/%00`)).status, 400);
});
