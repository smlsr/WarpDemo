import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { NOTE_MAX, confirmReset, renderConfirm } from "./confirm.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pack = resolve(here, "..", "..", "..", "..");
const beam = JSON.parse(readFileSync(resolve(pack, "fixtures", "beam.sample.json"), "utf8"));
const expected = JSON.parse(readFileSync(resolve(pack, "fixtures", "expected", "dependents.WV-07.json"), "utf8"));
const css = readFileSync(resolve(here, "confirm.css"), "utf8");

const TITLES = {
  "WV-15": "Wire the app: store, render loop, drawer, tabs, print, plugin hooks",
  "WV-16": "Release viewer.html, README and parity check",
};
const withTitle = (id) => ({ id, title: TITLES[id] });
const opts = () => ({
  ticket: "WV-07",
  from: beam.tickets["WV-07"].status,
  to: "coding",
  dependents: {
    blocked: expected.blocked.map(withTitle),
    inFlight: expected.inFlight.map((id) => ({ id, status: beam.tickets[id].status })),
    alreadyMerged: expected.alreadyMerged.map((id) => ({ id, status: beam.tickets[id].status })),
  },
});

function setup() {
  const dom = new JSDOM('<!doctype html><body><button id="opener">open</button></body>', { pretendToBeVisual: true });
  const { document, KeyboardEvent, MouseEvent, Event } = dom.window;
  document.getElementById("opener").focus();
  const q = (s) => document.querySelector(s);
  const press = (key, init = {}) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    (document.activeElement || document.body).dispatchEvent(e);
    return e;
  };
  const type = (text) => {
    const a = q("textarea");
    a.value = text;
    a.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return { dom, document, q, press, type, click };
}

const settled = (p) => {
  let out = "pending";
  p.then((v) => (out = v));
  return Promise.resolve().then(() => Promise.resolve()).then(() => out);
};

test("AC-1: WV-07 merged → coding with two blocked dependents shows the layout of edit-confirm.png", () => {
  const html = renderConfirm(opts());
  const doc = new JSDOM(html).window.document;
  const dlg = doc.querySelector('[role="dialog"]');
  assert.equal(dlg.getAttribute("aria-modal"), "true");
  assert.equal(doc.querySelector("h3").textContent, "Reset WV-07");
  const chips = [...doc.querySelectorAll(".ed-confirm-chip")];
  assert.deepEqual(chips.map((c) => c.textContent), ["merged", "coding"]);
  assert.equal(chips[0].getAttribute("style"), "--c:var(--c-done)");
  assert.equal(chips[1].getAttribute("style"), "--c:var(--c-prog)");
  assert.equal(doc.querySelector(".ed-confirm-move").textContent, "merged → coding");
  const heads = [...doc.querySelectorAll(".ed-confirm-h")].map((p) => p.textContent);
  assert.deepEqual(heads, ["Will be blocked", "In flight on top · already merged on top"]);
  const blocked = [...doc.querySelectorAll(".ed-confirm-blocked li")];
  assert.equal(blocked.length, 2);
  assert.equal(blocked[0].textContent, `WV-15 ${TITLES["WV-15"]}`);
  assert.equal(blocked[1].textContent, `WV-16 ${TITLES["WV-16"]}`);
  assert.deepEqual([...doc.querySelectorAll(".ed-confirm-kept li")].map((l) => l.textContent), ["WV-09 coding — keeps its status, warned", "WV-11 merged — keeps its status"]);
  const area = doc.querySelector("textarea");
  assert.equal(area.getAttribute("placeholder"), "Note (optional, saved in the event)");
  assert.deepEqual([...doc.querySelectorAll(".ed-confirm-foot button")].map((b) => b.textContent), ["Cancel", "Reset"]);
  assert.ok(doc.querySelector(".ed-confirm-foot .btn.primary").textContent === "Reset");
});

test("AC-1: the dialog opens with focus on Cancel, and the stylesheet uses tokens only", async () => {
  const s = setup();
  const p = confirmReset(opts(), { document: s.document });
  assert.equal(s.document.activeElement, s.q('[data-ed="confirm-cancel"]'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(css), "no color literal in confirm.css");
  assert.match(css, /var\(--panel\)/);
  assert.match(css, /var\(--line2\)/);
  s.press("Escape");
  await p;
});

test("AC-1: values from the run are escaped", () => {
  const html = renderConfirm({ ticket: '<img src=x onerror=1>', from: "merged", to: "coding", dependents: { blocked: [{ id: "<b>", title: '"><script>x</script>' }] }, note: "</textarea><i>" });
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector("img"), null);
  assert.equal(doc.querySelector("script"), null);
  assert.equal(doc.querySelector("i"), null);
  assert.equal(doc.querySelector("h3").textContent, "Reset <img src=x onerror=1>");
});

test("AC-2: a note typed and Reset clicked resolves ok true with the note", async () => {
  const s = setup();
  const p = confirmReset(opts(), { document: s.document });
  s.type("flaky test in plan.test.mjs");
  s.click(s.q('[data-ed="confirm-ok"]'));
  assert.deepEqual(await p, { ok: true, note: "flaky test in plan.test.mjs" });
  assert.equal(s.q(".ed-confirm-modal"), null);
  assert.equal(s.document.activeElement, s.document.getElementById("opener"));
});

test("AC-2: Reset with no note resolves ok true and an empty note", async () => {
  const s = setup();
  const p = confirmReset(opts(), { document: s.document });
  s.click(s.q('[data-ed="confirm-ok"]'));
  assert.deepEqual(await p, { ok: true, note: "" });
});

test("AC-3: Escape resolves ok false and no change reaches the store", async () => {
  const s = setup();
  const applied = [];
  const p = confirmReset(opts(), { document: s.document });
  s.type("will be dropped");
  s.press("Escape");
  const r = await p;
  assert.deepEqual(r, { ok: false, note: "" });
  if (r.ok) applied.push(r);
  assert.deepEqual(applied, []);
  assert.equal(s.q(".ed-confirm-modal"), null);
});

test("AC-3: the scrim resolves ok false, a click inside the dialog does not", async () => {
  const s = setup();
  const p = confirmReset(opts(), { document: s.document });
  s.click(s.q(".ed-confirm-dlg"));
  assert.equal(await settled(p), "pending");
  s.click(s.q(".ed-confirm-modal"));
  assert.deepEqual(await p, { ok: false, note: "" });
});

test("AC-3: Cancel resolves ok false", async () => {
  const s = setup();
  const p = confirmReset(opts(), { document: s.document });
  s.type("typed then cancelled");
  s.click(s.q('[data-ed="confirm-cancel"]'));
  assert.deepEqual(await p, { ok: false, note: "" });
});

test("AC-3: opening a second dialog cancels the first and leaves one in the page", async () => {
  const s = setup();
  const first = confirmReset(opts(), { document: s.document });
  const second = confirmReset(opts(), { document: s.document });
  assert.deepEqual(await first, { ok: false, note: "" });
  assert.equal(s.document.querySelectorAll(".ed-confirm-modal").length, 1);
  s.press("Escape");
  await second;
});

test("AC-4: a 600-character note stops at 500 characters", async () => {
  const s = setup();
  const p = confirmReset(opts(), { document: s.document });
  assert.equal(s.q("textarea").getAttribute("maxlength"), String(NOTE_MAX));
  s.type("x".repeat(600));
  assert.equal(s.q("textarea").value.length, 500);
  s.click(s.q('[data-ed="confirm-ok"]'));
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(r.note.length, 500);
});

test("Tab cycles inside the dialog, Shift+Tab goes back", async () => {
  const s = setup();
  const p = confirmReset(opts(), { document: s.document });
  const cancel = s.q('[data-ed="confirm-cancel"]');
  const ok = s.q('[data-ed="confirm-ok"]');
  const area = s.q("textarea");
  assert.equal(s.document.activeElement, cancel);
  s.press("Tab");
  assert.equal(s.document.activeElement, ok);
  s.press("Tab");
  assert.equal(s.document.activeElement, area);
  s.press("Tab");
  assert.equal(s.document.activeElement, cancel);
  s.press("Tab", { shiftKey: true });
  assert.equal(s.document.activeElement, area);
  s.press("Escape");
  await p;
});

test("Escape does not reach WarpView's own key handler while the dialog is open", async () => {
  const s = setup();
  let seen = 0;
  s.document.addEventListener("keydown", () => seen++);
  const p = confirmReset(opts(), { document: s.document });
  s.press("Escape");
  await p;
  assert.equal(seen, 0);
});

test("other keys typed in the dialog do not reach WarpView's shortcuts (/, o, r, p)", async () => {
  const s = setup();
  const seen = [];
  s.document.addEventListener("keydown", (e) => seen.push(e.key));
  const p = confirmReset(opts(), { document: s.document });
  for (const k of ["/", "o", "r", "p", "O"]) s.press(k);
  s.q("textarea").focus();
  for (const k of ["/", "r"]) s.press(k);
  s.document.body.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: "o", bubbles: true, cancelable: true }));
  assert.deepEqual(seen, []);
  assert.equal(s.document.querySelectorAll(".ed-confirm-modal").length, 1);
  s.press("Escape");
  await p;
  s.press("r");
  assert.deepEqual(seen, ["r"]);
});

test("keys typed in the textarea and the buttons still reach their own targets", async () => {
  const s = setup();
  const p = confirmReset(opts(), { document: s.document });
  const area = s.q("textarea");
  area.focus();
  let got = 0;
  area.addEventListener("keydown", () => got++);
  const e = s.press("/");
  assert.equal(got, 1);
  assert.equal(e.defaultPrevented, false);
  s.press("Escape");
  await p;
});

test("a reset with no dependents says so", () => {
  const doc = new JSDOM(renderConfirm({ ticket: "WV-01", from: "coding", to: "queued" })).window.document;
  assert.match(doc.querySelector(".ed-confirm-h").textContent, /No other ticket is affected/);
  assert.equal(doc.querySelectorAll("ul").length, 0);
});
