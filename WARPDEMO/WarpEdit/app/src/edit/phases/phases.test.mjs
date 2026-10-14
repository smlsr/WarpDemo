import { test } from "node:test";
import assert from "node:assert/strict";
import { PHASES, check, phaseOption, phaseOptions, targetsFrom } from "./phases.mjs";

const THIRTEEN = ["queued", "claimed", "planning", "coding", "review", "fix", "awaiting_approval", "merging", "merged", "done", "blocked", "alarm", "skipped"];

test("PHASES lists the thirteen target phases, not recovering or bugbot_running", () => {
  assert.deepEqual([...PHASES], THIRTEEN);
});

test("AC-1: from merged, targetsFrom returns the earlier phases plus blocked and alarm, in order", () => {
  const expected = ["queued", "claimed", "planning", "coding", "review", "fix", "awaiting_approval", "merging", "blocked", "alarm"];
  assert.deepEqual(targetsFrom("merged"), expected);
  assert.deepEqual(targetsFrom("done"), expected);
  assert.deepEqual(targetsFrom("skipped"), expected);
});

test("AC-2: from coding, targetsFrom returns the twelve other phases including merged and done", () => {
  const t = targetsFrom("coding");
  assert.equal(t.length, 12);
  assert.ok(!t.includes("coding"));
  assert.ok(t.includes("merged") && t.includes("done"));
  assert.deepEqual(t, THIRTEEN.filter((p) => p !== "coding"));
});

test("targetsFrom for a display-only status offers all thirteen phases", () => {
  assert.deepEqual(targetsFrom("recovering"), THIRTEEN);
  assert.deepEqual(targetsFrom("bugbot_running"), THIRTEEN);
});

test("AC-3: merged to merged is same, naming the ticket and the phase", () => {
  const r = check("merged", "merged", "WV-07");
  assert.equal(r.result, "same");
  assert.equal(r.ok, false);
  assert.equal(r.message, "WV-07 is already merged");
});

test("AC-3: skipped to skipped is same likewise", () => {
  const r = check("skipped", "skipped", "WV-12");
  assert.equal(r.result, "same");
  assert.equal(r.message, "WV-12 is already skipped");
});

test("AC-3: same without an id still names the phase", () => {
  assert.equal(check("coding", "coding").message, "Ticket is already coding");
});

test("AC-4: to 'teleporting' check returns unknown naming it", () => {
  const r = check("coding", "teleporting", "WV-07");
  assert.equal(r.result, "unknown");
  assert.equal(r.ok, false);
  assert.equal(r.message, "teleporting is not a Warp phase");
  assert.equal(check("coding", undefined).result, "unknown");
});

test("check returns ok for a different known phase", () => {
  assert.deepEqual(check("merged", "coding", "WV-07"), { result: "ok", ok: true, message: "" });
  assert.equal(check("coding", "merged").result, "ok");
});

test("phase options carry WarpView's label and category color", () => {
  assert.deepEqual(phaseOption("awaiting_approval"), { value: "awaiting_approval", label: "awaiting approval", color: "var(--c-qa)" });
  assert.equal(phaseOption("merged").color, "var(--c-done)");
  assert.equal(phaseOption("alarm").color, "var(--c-err)");
  assert.deepEqual(phaseOptions("merged").map((o) => o.value), targetsFrom("merged"));
});

test("AC-5: this file is picked up by the WarpEdit test command", () => {
  assert.equal(typeof targetsFrom, "function");
});
