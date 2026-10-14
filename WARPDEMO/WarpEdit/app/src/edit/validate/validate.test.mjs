import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "./validate.mjs";

const fixture = (name) => fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));
const read = (name) => JSON.parse(readFileSync(fixture(name), "utf8"));

test("AC-1: beam.sample.json unchanged has no errors", () => {
  const r = validate(read("beam.sample.json"));
  assert.deepEqual(r.errors, []);
});

test("AC-2: missing-dep.json gives one dep-missing error naming WV-09 and WV-99", () => {
  const r = validate(read("invalid/missing-dep.json"));
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.errors[0], {
    code: "dep-missing",
    ticket: "WV-09",
    message: "WV-09 depends on WV-99, which is not in this run",
  });
});

test("AC-3: cycle.json gives one cycle error WV-10 → WV-11 → WV-10", () => {
  const r = validate(read("invalid/cycle.json"));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, "cycle");
  assert.equal(r.errors[0].message, "WV-10 → WV-11 → WV-10");
  assert.ok(r.errors[0].message.startsWith(r.errors[0].ticket));
});

test("AC-4: a dependency written view:WV-15 is not reported", () => {
  const beam = read("beam.sample.json");
  beam.tickets["WV-09"].deps = ["view:WV-15"];
  assert.deepEqual(validate(beam).errors, []);
  beam.tickets["WV-09"].after = ["view:WV-15"];
  assert.deepEqual(validate(beam).errors, []);
});

test("AC-5: duplicate ids, unknown status and reset-log mismatch are errors", () => {
  const plan = read("WARP_PLAN.sample.json");
  assert.deepEqual(validate(plan).errors, []);
  plan.tickets.push({ ...plan.tickets[0] });
  const dup = validate(plan).errors;
  assert.deepEqual(dup.map((e) => e.code), ["duplicate-id"]);
  assert.ok(dup[0].message.startsWith("WV-01"));

  const beam = read("beam.sample.json");
  beam.tickets["WV-04"].status = "sleeping";
  beam.tickets["WV-05"].resets = [{ from: "merged", to: "coding", at: "2026-10-12T19:30:00Z", note: "" }];
  const codes = validate(beam).errors.map((e) => `${e.code}:${e.ticket}`).sort();
  assert.deepEqual(codes, ["reset-log:WV-05", "unknown-status:WV-04"]);
});

test("AC-5: merged-on-unmerged and in-flight-dependent are warnings, not errors", () => {
  const beam = read("beam.sample.json");
  const base = validate(beam);
  assert.deepEqual(base.errors, []);
  beam.tickets["WV-07"].status = "coding";
  beam.tickets["WV-07"].resets = [{ from: "merged", to: "coding", at: "2026-10-12T19:30:00Z", note: "flaky test" }];
  const r = validate(beam);
  assert.deepEqual(r.errors, []);
  const codes = r.warnings.map((w) => `${w.code}:${w.ticket}`);
  assert.ok(codes.includes("merged-on-unmerged:WV-11"));
  assert.ok(codes.includes("in-flight-dependent:WV-09"));
  for (const w of r.warnings) assert.ok(w.message.startsWith(w.ticket));
});

test("AC-5: validation does not mutate the beam and handles empty input", () => {
  const beam = read("invalid/cycle.json");
  const copy = JSON.stringify(beam);
  validate(beam);
  assert.equal(JSON.stringify(beam), copy);
  assert.deepEqual(validate(null), { errors: [], warnings: [] });
  assert.deepEqual(validate({}), { errors: [], warnings: [] });
});
