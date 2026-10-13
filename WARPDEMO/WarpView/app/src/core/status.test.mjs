import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATS,
  STATUS_CAT,
  STATE_STATUS,
  TERMINAL,
  ACTIVE,
  normStatus,
  catOf,
  bucketOf,
  catColor,
  statusText,
} from "./status.mjs";

const categories = JSON.parse(
  readFileSync(new URL("../../../fixtures/expected/categories.json", import.meta.url), "utf8"),
);

test("AC-1: catOf returns the SPEC §5.1 category for each of the sixteen statuses", () => {
  const spec = {
    done: ["merged", "done", "skipped"],
    err: ["alarm", "parked", "blocked"],
    prog: ["claimed", "recovering", "planning", "coding", "fix"],
    rev: ["review", "bugbot_running", "merging"],
    qa: ["awaiting_approval"],
    todo: ["queued"],
  };
  let n = 0;
  for (const [cat, list] of Object.entries(spec)) {
    for (const s of list) {
      assert.equal(catOf(s), cat, s);
      n++;
    }
  }
  assert.equal(n, 16);
  assert.equal(Object.keys(STATUS_CAT).length, 16);
  for (const s of ["merged", "done", "skipped"]) assert.equal(catOf(s), "done");
  assert.equal(catOf("awaiting_approval"), "qa");
  for (const s of ["alarm", "parked", "blocked"]) assert.equal(catOf(s), "err");
  assert.deepEqual(CATS.map((c) => c.key), ["done", "err", "prog", "rev", "qa", "todo"]);
  assert.deepEqual(CATS.map((c) => c.label), [
    "Completed",
    "Errored / Parked",
    "In Progress",
    "In Review",
    "QA Ready",
    "To Do",
  ]);
});

test("AC-2: normStatus maps 'In Progress', 'QA-Ready' and 'to do' to coding, awaiting_approval and queued", () => {
  assert.equal(normStatus("In Progress"), "coding");
  assert.equal(normStatus("QA-Ready"), "awaiting_approval");
  assert.equal(normStatus("to do"), "queued");
  assert.equal(normStatus("In-Review"), "review");
  assert.equal(normStatus("Completed"), "done");
  assert.equal(normStatus("errored"), "alarm");
  assert.equal(normStatus("failed"), "alarm");
  assert.equal(normStatus("bugbot"), "bugbot_running");
  assert.equal(normStatus("ready"), "queued");
  assert.equal(normStatus("merged"), "merged");
});

test("AC-3: empty and null become queued; 'teleporting' stays as is with category todo", () => {
  assert.equal(normStatus(""), "queued");
  assert.equal(normStatus(null), "queued");
  assert.equal(normStatus(undefined), "queued");
  assert.equal(catOf(normStatus("")), "todo");
  assert.equal(catOf(normStatus(null)), "todo");
  assert.equal(normStatus("teleporting"), "teleporting");
  assert.equal(catOf("teleporting"), "todo");
  assert.equal(catOf(normStatus("teleporting")), "todo");
  assert.equal(catOf("constructor"), "todo");
  assert.equal(normStatus("constructor"), "constructor");
});

test("AC-4: STATE_STATUS has no entry for heartbeat or done", () => {
  assert.equal(STATE_STATUS["heartbeat"], undefined);
  assert.equal(STATE_STATUS["done"], undefined);
  assert.equal(STATE_STATUS["constructor"], undefined);
  assert.equal(STATE_STATUS["started"], "claimed");
  assert.equal(STATE_STATUS["bugbot"], "bugbot_running");
  assert.equal(STATE_STATUS["pr-opened"], "review");
  assert.equal(STATE_STATUS["check-red"], "fix");
  assert.equal(STATE_STATUS["check-green"], "review");
  assert.equal(STATE_STATUS["lock-escape"], "alarm");
  assert.equal(STATE_STATUS["failed"], "alarm");
});

test("AC-5: every key in fixtures/expected/categories.json maps to its category", () => {
  const keys = Object.keys(categories);
  assert.equal(keys.length, 16);
  for (const k of keys) assert.equal(catOf(k), categories[k], k);
  assert.deepEqual({ ...STATUS_CAT }, categories);
});

test("helpers: buckets, colors, terminal and active sets, status text", () => {
  assert.equal(bucketOf("rev"), "prog");
  assert.equal(bucketOf("qa"), "prog");
  assert.equal(bucketOf("prog"), "prog");
  assert.equal(bucketOf("done"), "done");
  assert.equal(bucketOf("err"), "err");
  assert.equal(bucketOf("todo"), "todo");
  assert.equal(catColor("done"), "var(--c-done)");
  assert.deepEqual([...TERMINAL].sort(), ["done", "merged", "skipped"]);
  assert.ok(ACTIVE.has("claimed") && ACTIVE.has("merging") && !ACTIVE.has("queued") && !ACTIVE.has("merged"));
  assert.equal(statusText("bugbot_running"), "bugbot running");
});
