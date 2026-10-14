import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyReset, buildReset, revertReset } from "./reset.mjs";
import { createEditStore } from "../store/store.mjs";

const fixture = (name) => fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));
const read = (name) => JSON.parse(readFileSync(fixture(name), "utf8"));
const load = () => read("beam.sample.json");
const AT = "2026-10-12T19:30:00Z";

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function resetWV07() {
  const beam = deepFreeze(load());
  const built = buildReset(beam, "WV-07", "coding", "flaky test", AT);
  assert.equal(built.ok, true);
  return { beam, change: built.change, after: applyReset(beam, built.change) };
}

function withTicket(beam, id, patch) {
  return { ...beam, tickets: { ...beam.tickets, [id]: { ...beam.tickets[id], ...patch } } };
}

test("AC-1: WV-07 merged reset to coding with note 'flaky test' equals reset.WV-07.coding.json", () => {
  const { beam, change, after } = resetWV07();
  assert.equal(beam.tickets["WV-07"].status, "merged");
  assert.deepEqual(change, {
    ticket: "WV-07", from: "merged", to: "coding", at: AT, note: "flaky test", by: "warpedit", dependents: [],
  });
  assert.deepEqual(after.tickets["WV-07"], read("expected/reset.WV-07.coding.json"));
  assert.deepEqual(beam, load());
  for (const id of Object.keys(beam.tickets)) {
    if (id !== "WV-07") assert.equal(after.tickets[id], beam.tickets[id]);
  }
});

test("AC-2: pr.mergedAt, pr.openedAt, tokens, minutes and usage are unchanged field by field", () => {
  const { beam, after } = resetWV07();
  const was = beam.tickets["WV-07"];
  const now = after.tickets["WV-07"];
  assert.equal(now.pr.mergedAt, was.pr.mergedAt);
  assert.equal(now.pr.openedAt, was.pr.openedAt);
  assert.equal(now.tokens, was.tokens);
  assert.equal(now.minutes, was.minutes);
  assert.deepEqual(now.usage, was.usage);
  assert.deepEqual(now.pr, was.pr);
  assert.deepEqual(now.jira, was.jira);
  for (const key of ["claimedAt", "attempts", "updatedAt", "alarm", "agent"]) assert.equal(now[key], was[key], key);
  assert.deepEqual(now.events.slice(0, was.events.length), was.events);
});

test("AC-3: a target equal to the current status gives the same-phase refusal and no change", () => {
  const beam = deepFreeze(load());
  const built = buildReset(beam, "WV-07", "merged", "again", AT);
  assert.deepEqual(built, { ok: false, result: "same", message: "WV-07 is already merged", change: null });
  assert.deepEqual(beam, load());
  const sameChange = { ticket: "WV-07", from: "merged", to: "merged", at: AT, note: "", by: "warpedit", dependents: [] };
  assert.equal(applyReset(beam, sameChange), beam);
});

test("AC-3: an unknown phase or a missing ticket is refused with no change", () => {
  const beam = deepFreeze(load());
  assert.deepEqual(buildReset(beam, "WV-07", "teleporting", "", AT), {
    ok: false, result: "unknown", message: "teleporting is not a Warp phase", change: null,
  });
  assert.equal(buildReset(beam, "WV-99", "coding", "", AT).result, "missing");
  assert.equal(buildReset(beam, "toString", "coding", "", AT).result, "missing");
  assert.equal(applyReset(beam, { ticket: "WV-99", from: "merged", to: "coding", at: AT }), beam);
});

test("AC-4: a reset then revertReset deep-equals the loaded ticket", () => {
  const { beam, change, after } = resetWV07();
  const loaded = load();
  const exact = revertReset(after, change, beam);
  assert.deepEqual(exact.tickets["WV-07"], loaded.tickets["WV-07"]);
  assert.deepEqual(exact, loaded);
  const inverted = revertReset(after, change);
  assert.deepEqual(inverted.tickets["WV-07"], loaded.tickets["WV-07"]);
  assert.equal("resets" in inverted.tickets["WV-07"], false);
  assert.deepEqual(inverted, loaded);
});

test("AC-4: through the edit store, undo of a reset gives back the loaded ticket", () => {
  const store = createEditStore(deepFreeze(load()), { applyChange: applyReset });
  const { change } = buildReset(store.working, "WV-07", "coding", "flaky test", AT);
  store.apply(change);
  assert.deepEqual(store.working.tickets["WV-07"], read("expected/reset.WV-07.coding.json"));
  store.undo();
  assert.deepEqual(store.working.tickets["WV-07"], load().tickets["WV-07"]);
});

test("AC-4: a second reset keeps the first in resets and events, and reverting it leaves the first", () => {
  const { change: first, after } = resetWV07();
  const second = buildReset(after, "WV-07", "review", "", "2026-10-12T20:00:00Z").change;
  assert.equal(second.from, "coding");
  const twice = applyReset(after, second);
  assert.equal(twice.tickets["WV-07"].resets.length, 2);
  assert.equal(twice.tickets["WV-07"].events.at(-2).note, first.note);
  assert.deepEqual(revertReset(twice, second), after);
});

test("alarm is cleared only when the reset leaves alarm, and comes back on exact revert", () => {
  const alarm = { reason: "bugbot-failed", at: "2026-10-11T21:00:00Z" };
  const beam = deepFreeze(withTicket(load(), "WV-07", { status: "alarm", alarm }));
  const { change } = buildReset(beam, "WV-07", "queued", "retry", AT);
  const after = applyReset(beam, change);
  assert.equal(after.tickets["WV-07"].alarm, null);
  assert.deepEqual(revertReset(after, change, beam).tickets["WV-07"].alarm, alarm);

  const coding = deepFreeze(withTicket(load(), "WV-07", { status: "coding", alarm }));
  const kept = applyReset(coding, buildReset(coding, "WV-07", "review", "", AT).change);
  assert.deepEqual(kept.tickets["WV-07"].alarm, alarm);
});

test("change.dependents move with the reset, get the reset event, and revert with it", () => {
  const beam = deepFreeze(load());
  const dep = Object.keys(beam.tickets).find((id) => beam.tickets[id].status === "queued");
  const { change: base } = buildReset(beam, "WV-07", "coding", "flaky test", AT);
  const change = { ...base, dependents: [{ id: dep, from: "queued", to: "blocked" }] };
  const after = applyReset(beam, change);
  const t = after.tickets[dep];
  assert.equal(t.status, "blocked");
  assert.deepEqual(t.events.at(-1), {
    at: AT, type: "status", from: "queued", to: "blocked", by: "warpedit", note: "blocked by reset of WV-07",
  });
  assert.equal("resets" in t, false);
  assert.deepEqual(revertReset(after, change, beam), load());
  assert.deepEqual(revertReset(after, change), load());
});

test("AC-5: reset.test.mjs is picked up by the WarpEdit test command", () => {
  assert.equal(typeof buildReset, "function");
  assert.equal(typeof applyReset, "function");
  assert.equal(typeof revertReset, "function");
});
