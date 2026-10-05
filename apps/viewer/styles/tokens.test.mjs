import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tokens.css'), 'utf8');
const buildMap = readFileSync(join(here, '..', '..', '..', 'WarpView', 'ui', 'build-map.html'), 'utf8');

function decls(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z-]+)\s*:\s*([^;}]+?)\s*(?=[;}])/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}

function lightTokens() {
  const m = css.match(/^:root\s*\{([^}]*)\}/m);
  assert.ok(m, 'light :root block');
  return decls(m[1]);
}

function darkTokens() {
  const m = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/);
  assert.ok(m, 'dark prefers-color-scheme block');
  return decls(m[1]);
}

function spec() {
  // The spec palette is the :root block of the build map.
  const m = buildMap.match(/:root\{([^}]*)\}/);
  assert.ok(m, 'build-map :root block');
  return decls(m[1]);
}

const hex = (c) => {
  let h = c.replace('#', '');
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (c) => {
  const [r, g, b] = hex(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// WV-02 AC1: Ink, paper, teal, gate, and crit colors match the spec
test('WV-02 AC1: ink, paper, teal, gate, crit match the spec', () => {
  const light = lightTokens();
  const want = spec();
  for (const name of ['--ink', '--paper', '--teal', '--gate', '--crit']) {
    assert.ok(want[name], `${name} in spec`);
    assert.equal(light[name], want[name], name);
  }
});

test('WV-02 AC1: every build-map token is defined with the same light value', () => {
  const light = lightTokens();
  for (const [name, value] of Object.entries(spec())) {
    assert.equal(light[name], value, name);
  }
});

// WV-02 AC2: Dark preference does not break contrast
test('WV-02 AC2: dark block redefines the full palette', () => {
  const dark = darkTokens();
  for (const name of Object.keys(lightTokens())) {
    assert.ok(dark[name], `${name} missing in dark`);
  }
});

test('WV-02 AC2: dark text tokens reach AA (4.5:1) on paper, card, and soft', () => {
  const d = darkTokens();
  for (const text of ['--ink', '--muted', '--gate', '--warn', '--ok', '--crit', '--teal']) {
    for (const bg of ['--paper', '--card', '--soft']) {
      const r = ratio(d[text], d[bg]);
      assert.ok(r >= 4.5, `${text} on ${bg} is ${r.toFixed(2)}`);
    }
  }
});

test('WV-02 AC2: dark --on text reaches AA on teal and every area color', () => {
  const d = darkTokens();
  for (const bg of ['--teal', '--c-platform', '--c-api', '--c-console', '--c-quality', '--c-install']) {
    const r = ratio(d['--on'], d[bg]);
    assert.ok(r >= 4.5, `--on on ${bg} is ${r.toFixed(2)}`);
  }
});

test('WV-02 AC2: dark borders stay visible against paper and card', () => {
  const d = darkTokens();
  for (const bg of ['--paper', '--card']) {
    assert.ok(ratio(d['--line'], d[bg]) >= 1.3, `--line on ${bg}`);
  }
});

test('WV-02 AC2: light text tokens that carry body copy keep AA', () => {
  const l = lightTokens();
  for (const text of ['--ink', '--muted']) {
    for (const bg of ['--paper', '--card', '--soft']) {
      assert.ok(ratio(l[text], l[bg]) >= 4.5, `${text} on ${bg}`);
    }
  }
});
