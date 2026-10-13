import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, num, fmtH, fmtN, pct, parseTime, ago, stamp, natKey, natCmp, hashHue } from "./util.mjs";

test("AC-2: fmtH shows a dash for null, rounds from 100 and keeps one decimal below", () => {
  assert.equal(fmtH(null), "—");
  assert.equal(fmtH(undefined), "—");
  assert.equal(fmtH(7), "7h");
  assert.equal(fmtH(105.5), "106h");
  assert.equal(fmtH(36.24), "36.2h");
  assert.equal(fmtH(36.24, 0), "36h");
});

test("AC-2: natCmp orders digit runs numerically", () => {
  assert.ok(natCmp("WV-2", "WV-10") < 0);
  assert.ok(natCmp("WV-10", "WV-2") > 0);
  assert.equal(natCmp("WV-2", "wv-2"), 0);
  assert.deepEqual(["WV-10", "WV-2", "WV-1"].sort(natCmp), ["WV-1", "WV-2", "WV-10"]);
  assert.equal(natKey("WV-2"), "wv-00000002");
});

test("AC-2: esc escapes & < > \" and '", () => {
  assert.equal(esc('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
  assert.equal(esc("a & b's"), "a &amp; b&#39;s");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(0), "0");
});

test("AC-2: num returns a finite number or null", () => {
  assert.equal(num(4), 4);
  assert.equal(num("4.5h"), 4.5);
  assert.equal(num("x"), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
  assert.equal(num(null), null);
});

test("AC-2: fmtN and pct", () => {
  assert.equal(fmtN(null), "—");
  assert.equal(fmtN(1234.6), (1235).toLocaleString());
  assert.equal(pct(1, 4), "25%");
  assert.equal(pct(0, 4), "0%");
  assert.equal(pct(1, 0), "");
  assert.equal(pct(null, 4), "");
});

test("AC-2: parseTime, ago and stamp", () => {
  assert.equal(parseTime("2026-10-13T00:00:00Z"), Date.UTC(2026, 9, 13));
  assert.equal(parseTime(""), null);
  assert.equal(parseTime(null), null);
  assert.equal(parseTime("not a date"), null);
  const now = Date.UTC(2026, 9, 13, 12);
  assert.equal(ago(null, now), "—");
  assert.equal(ago(now - 10e3, now), "just now");
  assert.equal(ago(now - 5 * 60e3, now), "5m ago");
  assert.equal(ago(now - 3 * 3600e3, now), "3h ago");
  assert.equal(ago(now - 2 * 86400e3, now), "2d ago");
  assert.equal(stamp(null), "—");
  assert.match(stamp(now), /Oct/);
});

test("AC-2: hashHue is a 31-multiplier hash mod 360", () => {
  assert.equal(hashHue(""), 0);
  assert.equal(hashHue("a"), 97);
  assert.equal(hashHue("ab"), (97 * 31 + 98) % 360);
  for (const s of ["WarpView", "platform", "model", "ünïcode"]) {
    const h = hashHue(s);
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360);
  }
});
