import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { applyState, buildRuns, classify, repoFrom, runFromSchedule, runFromStatus } from "./parse.mjs";

const PACK = fileURLToPath(new URL("../../../../", import.meta.url));
const FIX = join(PACK, "fixtures");
const read = (rel) => JSON.parse(readFileSync(join(PACK, rel), "utf8"));
const doc = (rel, extra = {}) => ({ path: "WARPDEMO/WarpView/" + rel, data: read(rel), modified: null, ...extra });
const plain = (v) => JSON.parse(JSON.stringify(v));
const clone = plain;

const pick = (t) => ({
  id: t.id,
  title: t.title,
  size: t.size,
  status: t.status,
  cat: t.cat,
  hours: t.hours,
  hoursFrom: t.hoursFrom,
  autoMerge: t.autoMerge,
  deps: t.deps,
  gate: t.gate,
  critical: t.critical,
  jiraKey: t.jiraKey,
  prUrl: t.pr.url,
  minutes: t.minutes,
  tokens: t.tokens,
  cost: t.cost,
  stateNote: t.stateNote,
  lane: t.lane,
  repo: t.repo,
  wave: t.wave,
  priorityGate: t.priorityGate,
  checks: t.checks,
  planned: t.planned,
});

const project = (r, built) =>
  plain({
    kind: r.kind,
    name: r.name,
    instance: r.instance,
    runState: r.runState,
    cap: r.cap,
    gateOrder: r.gateOrder,
    repo: r.repo,
    updated: r.updated ? new Date(r.updated).toISOString() : null,
    schedule: r.schedule || null,
    gates: r.gates.map((g) => ({
      key: g.key,
      status: g.status,
      blocking: g.blocking,
      scope: g.scope,
      onGreen: g.onGreen,
      priority: g.priority,
      starts: g.starts,
      at: g.at,
      hold: g.hold,
    })),
    overlaid: built.overlaid,
    skipped: built.skipped,
    tickets: r.tickets.map(pick),
  });

const expectedRun = (rel) => {
  const { gateKeys, ...rest } = read(rel);
  return plain(rest);
};

const beamDocs = () => [doc("fixtures/beam.sample.json")];
const withState = () => [...beamDocs(), doc("fixtures/tickets/WV-11/state.json")];

test("AC-1: beam.sample.json builds one run view with 16 tickets filled as in view.run.json", () => {
  const built = buildRuns(withState(), null);
  assert.equal(built.runs.length, 1);
  const r = built.runs[0];
  assert.equal(r.name, "view");
  assert.equal(r.kind, "beam");
  assert.equal(r.tickets.length, 16);
  assert.deepEqual(project(r, built), expectedRun("fixtures/expected/view.run.json"));

  const keys = [
    "id", "title", "size", "status", "cat", "hours", "hoursFrom", "autoMerge", "deps", "locks", "gate", "module", "layer",
    "critical", "starred", "rank", "priority", "pr", "jiraKey", "jiraStatus", "jiraDone", "jiraCommentAt", "alarm", "agent",
    "attempts", "recoveries", "minutes", "tokens", "cost", "claimedAt", "updatedAt", "events", "stateNote", "lane", "repo",
    "wave", "priorityGate", "checks", "planned",
  ];
  for (const t of r.tickets) assert.deepEqual(Object.keys(t), keys);
  assert.deepEqual(Object.keys(r.tickets[0].pr), ["url", "ci", "bugbot", "sha", "via", "openedAt", "reviewedAt", "approvedAt", "mergedAt"]);
  const wv01 = r.tickets.find((t) => t.id === "WV-01");
  assert.equal(wv01.pr.url, "https://github.com/smlsr/WarpDemo/pull/42");
  assert.equal(wv01.jiraKey, "WAR-101");
  assert.equal(r.repo, "smlsr/WarpDemo");
  assert.equal(r.instance, "4e7a21");
});

test("AC-1: the Warp export (kind warp-plan) is read as a beam with its top-level estimate", () => {
  const exp = doc("fixtures/WARP_PLAN.sample.json");
  assert.equal(classify(exp.data), "beam");
  const built = buildRuns([exp], null);
  assert.equal(built.runs.length, 1);
  const r = built.runs[0];
  assert.equal(r.export, true);
  assert.ok(r.exportedAt > 0);
  assert.deepEqual(r.estimate, exp.data.estimate);
  assert.equal(r.tickets.length, exp.data.tickets.length);
  assert.equal(r.updated >= r.exportedAt, true);
});

test("AC-2: a newer state.json moves WV-11 to coding with a stateNote and overlaid is 1", () => {
  const before = buildRuns(beamDocs(), null);
  const was = before.runs[0].tickets.find((t) => t.id === "WV-11");
  assert.equal(was.status, "claimed");
  assert.equal(before.overlaid, 0);

  const built = buildRuns(withState(), null);
  const t = built.runs[0].tickets.find((x) => x.id === "WV-11");
  assert.equal(t.status, "coding");
  assert.equal(t.cat, "prog");
  assert.equal(t.stateNote, "state.json: coding (beam said claimed)");
  assert.equal(built.overlaid, 1);
  assert.equal(built.states, 1);
});

test("AC-2: a state.json that is not newer, or has no time, changes nothing", () => {
  const old = withState();
  old[1].data = { ...old[1].data, updatedAt: "2026-10-01T00:00:00Z", heartbeatAt: "2026-10-01T00:00:00Z" };
  const a = buildRuns(old, null);
  assert.equal(a.overlaid, 0);
  assert.equal(a.runs[0].tickets.find((t) => t.id === "WV-11").status, "claimed");

  const untimed = withState();
  untimed[1].data = { id: "WV-11", state: "coding" };
  assert.equal(buildRuns(untimed, null).overlaid, 0);
});

test("AC-2: a state attaches by folder first, then by id; unknown ids attach nowhere", () => {
  const viewBeam = doc("fixtures/runs/view/beam.json");
  const editBeam = doc("fixtures/runs/edit/beam.json");
  const state = (path) => ({
    path,
    modified: null,
    data: { id: "WV-11", state: "coding", updatedAt: "2026-10-12T19:59:00Z", agent: "bc-x" },
  });
  const byFolder = buildRuns([viewBeam, editBeam, state("WARPDEMO/WarpView/fixtures/runs/view/tickets/WV-11/state.json")], null);
  assert.equal(byFolder.overlaid, 1);
  assert.equal(byFolder.runs.find((r) => r.name === "view").tickets.find((t) => t.id === "WV-11").status, "coding");

  const byId = buildRuns([viewBeam, editBeam, state("elsewhere/tickets/WV-11/state.json")], null);
  assert.equal(byId.overlaid, 1);

  const stray = buildRuns([viewBeam, { path: "x/tickets/ZZ-99/state.json", data: { id: "ZZ-99", state: "coding", updatedAt: "2026-10-12T19:59:00Z" } }], null);
  assert.equal(stray.overlaid, 0);
  assert.equal(stray.states, 1);
});

test("AC-3: two named beams make two runs sorted by name; the newer view copy is kept", () => {
  const view = doc("fixtures/runs/view/beam.json", { path: "WARPDEMO/WarpView/fixtures/runs/view/beam.json" });
  const edit = doc("fixtures/runs/edit/beam.json");
  const older = clone(view);
  older.path = "WARPDEMO/WarpView/fixtures/.warp/beam.json";
  older.data.checkpointAt = "2026-10-10T00:00:00Z";
  for (const t of Object.values(older.data.tickets)) t.updatedAt = "2026-10-10T00:00:00Z";
  older.data.tickets["WV-01"].status = "queued";

  for (const order of [[view, edit, older], [older, edit, view], [edit, older, view]]) {
    const built = buildRuns(order, null);
    assert.deepEqual(built.runs.map((r) => r.name), ["edit", "view"]);
    const v = built.runs[1];
    assert.equal(v.path, view.path);
    assert.equal(v.tickets.find((t) => t.id === "WV-01").status, "done");
    assert.equal(v.tickets.length, 16);
    assert.equal(built.runs[0].tickets.length, 14);
  }
});

test("AC-3: runs sort by name in natural order", () => {
  const mk = (name) => ({ path: `r/${name}/beam.json`, data: { run: name, tickets: {}, runState: "running" } });
  const built = buildRuns([mk("run10"), mk("run2"), mk("Alpha")], null);
  assert.deepEqual(built.runs.map((r) => r.name), ["Alpha", "run2", "run10"]);
});

test("AC-3: a beam without a name falls back to its instance id, then to its folder", () => {
  const a = { path: "a/.warp/beam.json", data: { instance: { id: "i1" }, tickets: {}, gates: [] } };
  const a2 = { path: "a/.warp/runs/x/beam.json", data: { instance: { id: "i1" }, tickets: {}, gates: [] } };
  const b = { path: "b/.warp/beam.json", data: { tickets: {} } };
  const built = buildRuns([a, a2, b], null);
  assert.equal(built.runs.length, 2);
});

test("AC-4: status.sample.json alone makes one status run with no gates and hours from size", () => {
  const built = buildRuns([doc("fixtures/status.sample.json")], null);
  assert.equal(built.runs.length, 1);
  const r = built.runs[0];
  assert.equal(r.kind, "status");
  assert.deepEqual(r.gates, []);
  assert.equal(r.estimate, null);
  assert.equal(r.tickets.length, 16);
  const table = { S: 4, M: 7, L: 11, XL: 16 };
  for (const t of r.tickets) {
    assert.equal(t.hours, table[t.size], t.id);
    assert.equal(t.hoursFrom, "size " + t.size);
  }
  assert.equal(r.instance, "4e7a21");
  assert.equal(r.repo, "smlsr/WarpDemo");
  assert.equal(r.tickets.find((t) => t.id === "WV-01").pr.url, "https://github.com/smlsr/WarpDemo/pull/42");
});

test("AC-4: a status.json joins the beam of its instance and only moves updated", () => {
  const status = doc("fixtures/status.sample.json");
  const built = buildRuns([...beamDocs(), status], null);
  assert.equal(built.runs.length, 1);
  assert.equal(built.runs[0].kind, "beam");
  assert.equal(built.runs[0].updated, Date.parse(status.data.updatedAt));
  assert.equal(built.runs[0].tickets.length, 16);
});

test("AC-4: a status.json from another instance and folder makes its own run", () => {
  const status = doc("fixtures/status.sample.json", { path: "other/status.json" });
  status.data.instance = { id: "zzzzzz" };
  const built = buildRuns([...beamDocs(), status], null);
  assert.equal(built.runs.length, 2);
});

test("AC-4: sizes outside S/M/L/XL fall back to default M, and hours on the ticket win", () => {
  const r = runFromStatus({ done: [{ id: "A", size: "?" }, { id: "B", size: "XL (big)", hours: 3 }, { id: "C" }, { id: "D", size: "l" }] }, "s.json", null);
  const by = Object.fromEntries(r.tickets.map((t) => [t.id, t]));
  assert.deepEqual([by.A.hours, by.A.hoursFrom], [7, "default M"]);
  assert.deepEqual([by.B.hours, by.B.hoursFrom, by.B.size], [3, "ticket", "XL"]);
  assert.deepEqual([by.C.hours, by.C.hoursFrom], [7, "default M"]);
  assert.deepEqual([by.D.hours, by.D.hoursFrom], [11, "size L"]);
});

test("AC-5: plan/schedule.json makes one strict schedule run, every ticket queued, as in schedule.run.json", () => {
  const built = buildRuns([doc("plan/schedule.json")], null);
  assert.equal(built.runs.length, 1);
  const r = built.runs[0];
  assert.equal(r.kind, "schedule");
  assert.equal(r.name, "WarpView");
  assert.equal(r.gateOrder, "strict");
  assert.equal(r.runState, "plan");
  assert.equal(r.tickets.length, 16);
  for (const t of r.tickets) {
    assert.equal(t.status, "queued");
    assert.ok(t.lane, t.id);
    assert.ok(t.repo, t.id);
    assert.ok(t.planned && typeof t.planned.slot === "number", t.id);
  }
  assert.equal(r.tickets.filter((t) => t.priorityGate).length, 15);
  assert.deepEqual(project(r, built), expectedRun("fixtures/expected/schedule.run.json"));
});

test("AC-5: schedule tickets keep locks as written and a unlabelled schedule is detected by shape", () => {
  const data = read("plan/schedule.json");
  const r = runFromSchedule(data, "plan/schedule.json", null);
  const src = data.tickets[0];
  assert.deepEqual(r.tickets[0].locks, src.locks);
  assert.deepEqual(r.tickets[0].deps, src.after);
  assert.equal(r.tickets[0].hours, src.h);
  assert.equal(r.tickets[0].hoursFrom, "ticket");
  const bare = clone(data);
  delete bare.schema;
  assert.equal(classify(bare), "schedule");
  const lone = clone(data);
  delete lone.schema;
  delete lone.critical_chain;
  assert.equal(classify(lone), "beam");
  assert.deepEqual(r.estimate.approvalHours, 0.5);
  assert.equal(r.cap, data.model.slots || 18);
});

test("AC-5: a schedule never merges with a beam of the same name", () => {
  const built = buildRuns([doc("plan/schedule.json"), ...beamDocs()], null);
  assert.equal(built.runs.length, 2);
  assert.deepEqual(built.runs.map((r) => r.kind).sort(), ["beam", "schedule"]);
});

test("AC-6: two-repos.json (no gate_order) reads gate order deps, every gate red, repo Demo-API + Demo-UI", () => {
  const built = buildRuns([doc("fixtures/schedule/two-repos.json")], null);
  assert.equal(built.runs.length, 1);
  const r = built.runs[0];
  assert.equal(r.gateOrder, "deps");
  assert.ok(r.gates.length > 0);
  for (const g of r.gates) assert.equal(g.hold, "red", g.key);
  assert.equal(r.repo, "Demo-API + Demo-UI");
  const ad02 = r.tickets.find((t) => t.id === "AD-02");
  assert.equal(ad02.priorityGate, "G-RBAC");
  assert.equal(ad02.checks.length, 1);
  assert.deepEqual(Object.keys(ad02.checks[0]), ["name", "check"]);
  assert.deepEqual(project(r, built), expectedRun("fixtures/expected/two-repos.run.json"));
  assert.deepEqual(read("fixtures/expected/two-repos.run.json").gateKeys, ["G0", "G-RBAC", "G1", "G2"]);
  const byAt = [...r.gates].sort((a, b) => a.at - b.at).map((g) => g.key);
  assert.deepEqual(byAt, ["G0", "G-RBAC", "G1", "G2"]);
});

test("AC-6: a check given as a string becomes {name: '', check}", () => {
  const r = runFromSchedule({ program: "P", tickets: [{ id: "T-1", h: 4, after: [], slot: 1, checks: ["make it", { name: "N", check: "c", wave: 1 }] }], gates: [{ key: "G0", checks: ["a", { check: "b" }, { name: "c" }] }] }, "s.json", null);
  assert.deepEqual(r.tickets[0].checks, [{ name: "", check: "make it" }, { name: "N", check: "c" }]);
  assert.deepEqual(r.gates[0].checks, ["a", "b", "c"]);
  assert.equal(r.gateOrder, "deps");
  assert.equal(r.cap, 18);
});

test("AC-7: a JSON file with neither tickets, done/working/left nor id+state is skipped and creates no run", () => {
  const junk = [
    { path: ".warp/agents.json", data: { agents: [] } },
    { path: ".warp/config.json", data: { a: 1 } },
    { path: "x.json", data: [1, 2, 3] },
    { path: "n.json", data: null },
    { path: "s.json", data: "text" },
    { path: "id.json", data: { id: "WV-1" } },
    { path: "st.json", data: { state: "coding" } },
  ];
  const built = buildRuns(junk, null);
  assert.deepEqual(built.runs, []);
  assert.equal(built.skipped, junk.length);
  assert.equal(built.overlaid, 0);
  const mixed = buildRuns([...beamDocs(), junk[0]], null);
  assert.equal(mixed.runs.length, 1);
  assert.equal(mixed.skipped, 1);
});

test("AC-7: classify is by content, never by file name", () => {
  assert.equal(classify(read("fixtures/beam.sample.json")), "beam");
  assert.equal(classify(read("fixtures/big/beam.sample.json")), "beam");
  assert.equal(classify(read("fixtures/WARP_PLAN.sample.json")), "beam");
  assert.equal(classify(read("fixtures/status.sample.json")), "status");
  assert.equal(classify(read("fixtures/tickets/WV-11/state.json")), "ticket");
  assert.equal(classify(read("plan/schedule.json")), "schedule");
  assert.equal(classify(read("fixtures/schedule/two-repos.json")), "schedule");
  assert.equal(classify({ tickets: {} }), "beam");
  assert.equal(classify({ tickets: [] }), "beam");
  assert.equal(classify({ tickets: null }), null);
  assert.equal(classify({ id: "T", state: "coding", tickets: {} }), "beam");
  assert.equal(classify({ working: [] }), "status");
  assert.equal(classify({ id: "T", state: 3 }), null);
  assert.equal(classify(undefined), null);
  assert.equal(classify([]), null);
});

test("AC-7: a merged ticket with a newer state.json saying coding stays merged", () => {
  const docs = [doc("fixtures/beam.sample.json"), { path: "WARPDEMO/WarpView/fixtures/tickets/WV-02/state.json", data: { id: "WV-02", state: "coding", updatedAt: "2026-12-01T00:00:00Z", agent: "bc-z", alarm: "boom" } }];
  const t0 = docs[0].data.tickets["WV-02"];
  assert.equal(t0.status, "merged");
  const built = buildRuns(docs, null);
  const t = built.runs[0].tickets.find((x) => x.id === "WV-02");
  assert.equal(t.status, "merged");
  assert.equal(t.stateNote, null);
  assert.equal(t.alarm, null);
  assert.equal(built.overlaid, 0);
});

test("AC-7: a parked ticket keeps parked, and done and skipped never move", () => {
  const newer = { updatedAt: "2030-01-01T00:00:00Z" };
  for (const status of ["done", "skipped", "merged"]) {
    const t = { status, cat: "done", pr: {}, alarm: null, updatedAt: null, stateNote: null };
    assert.equal(applyState(t, { id: "x", state: "coding", ...newer }), false);
    assert.equal(t.status, status);
  }
  const parked = { status: "parked", cat: "err", pr: {}, alarm: null, updatedAt: "2026-01-01T00:00:00Z", stateNote: null };
  assert.equal(applyState(parked, { id: "x", state: "coding", ...newer }), false);
  assert.equal(parked.status, "parked");
  assert.equal(parked.stateNote, null);
});

test("AC-7: applyState copies the pr url, the alarm and the agent when missing, and maps states per SPEC 5.3", () => {
  const mk = () => ({ status: "queued", cat: "todo", pr: { url: null }, alarm: null, agent: null, updatedAt: "2026-01-01T00:00:00Z", stateNote: null });
  const t = mk();
  const moved = applyState(t, { id: "x", state: "pr-opened", updatedAt: "2026-02-01T00:00:00Z", pr: { url: "https://github.com/o/r/pull/9" }, alarm: "lock-escape", agent: "bc-1" });
  assert.equal(moved, true);
  assert.equal(t.status, "review");
  assert.equal(t.cat, "rev");
  assert.equal(t.pr.url, "https://github.com/o/r/pull/9");
  assert.equal(t.alarm, "lock-escape");
  assert.equal(t.agent, "bc-1");
  assert.equal(t.stateNote, "state.json: pr-opened (beam said queued)");

  const kept = { ...mk(), pr: { url: "https://github.com/o/r/pull/1" }, alarm: "old", agent: "me" };
  applyState(kept, { id: "x", state: "heartbeat", updatedAt: "2026-02-01T00:00:00Z", pr: { url: "https://github.com/o/r/pull/9" }, alarm: "new", agent: "other" });
  assert.equal(kept.status, "queued");
  assert.equal(kept.pr.url, "https://github.com/o/r/pull/1");
  assert.equal(kept.alarm, "old");
  assert.equal(kept.agent, "me");

  for (const [state, status] of [["started", "claimed"], ["bugbot", "bugbot_running"], ["check-red", "fix"], ["check-green", "review"], ["failed", "alarm"]]) {
    const x = mk();
    applyState(x, { id: "x", state, updatedAt: "2026-02-01T00:00:00Z" });
    assert.equal(x.status, status, state);
  }
  const hb = mk();
  assert.equal(applyState(hb, { id: "x", state: "done", heartbeatAt: "2026-02-01T00:00:00Z" }), false);
  assert.equal(hb.status, "queued");
  const proto = mk();
  assert.equal(applyState(proto, { id: "x", state: "constructor", updatedAt: "2026-02-01T00:00:00Z" }), false);
  assert.equal(proto.status, "queued");
});

test("AC-7: repo label comes from the embedded repo, else the first pull request url of any host", () => {
  const rows = (url) => ({ tickets: [{ id: "A" }, { id: "B", pr: { url } }] });
  const repo = (url) => repoFrom({ tickets: rows(url).tickets.map((t) => ({ ...t, pr: t.pr || { url: null } })) });
  assert.equal(repo("https://github.com/o/r/pull/3"), "o/r");
  assert.equal(repo("https://gitlab.com/g/sub/p/-/merge_requests/3"), "g/sub/p");
  assert.equal(repo("https://gitlab.com/g/p/merge_requests/3"), "g/p");
  assert.equal(repo("https://bitbucket.org/w/r/pull-requests/3"), "w/r");
  assert.equal(repo("not a url"), null);
  const bare = [{ path: "b.json", data: { run: "b", tickets: {}, runState: "x" } }];
  const built = buildRuns(bare, { repo: "embedded/repo", jiraSite: "https://x.atlassian.net" });
  assert.equal(built.runs[0].repo, "embedded/repo");
  assert.equal(built.runs[0].jiraSite, "https://x.atlassian.net");
  assert.equal(buildRuns(beamDocs(), { jiraSite: "https://x.atlassian.net" }).runs[0].jiraSite, beamDocs()[0].data.config.jiraSite || "https://x.atlassian.net");
  assert.equal(buildRuns(beamDocs(), null).runs[0].repo, "smlsr/WarpDemo");
});

test("AC-7: bad rows inside a beam do not throw", () => {
  const data = { run: "odd", tickets: { A: null, B: "x", C: { id: "C", checks: [null, "q"], pr: "https://github.com/o/r/pull/1" } }, gates: [null, { key: "G0", members: "C" }] };
  const built = buildRuns([{ path: "odd.json", data }], null);
  const r = built.runs[0];
  assert.deepEqual(r.tickets.map((t) => t.id), ["C"]);
  assert.equal(r.tickets[0].pr.url, "https://github.com/o/r/pull/1");
  assert.deepEqual(r.tickets[0].checks, [{ name: "", check: "q" }]);
  assert.deepEqual(r.gates[0].members, ["C"]);
  assert.equal(r.repo, "o/r");
});

test("AC-7: updated is the newest of checkpointAt, exportedAt and ticket times, else the file's modified time", () => {
  const a = buildRuns([{ path: "a.json", modified: 5, data: { run: "a", tickets: {}, runState: "x" } }], null).runs[0];
  assert.equal(a.updated, 5);
  const b = buildRuns([{ path: "b.json", modified: 5, data: { run: "b", checkpointAt: "2026-01-01T00:00:00Z", tickets: { T: { updatedAt: "2026-03-01T00:00:00Z" } }, runState: "x" } }], null).runs[0];
  assert.equal(b.updated, Date.parse("2026-03-01T00:00:00Z"));
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

test("AC-8: every fixture under fixtures/ parses; every non-expected file builds without throwing", () => {
  const files = walk(FIX);
  assert.ok(files.length >= 20);
  let runs = 0;
  for (const file of files) {
    const rel = relative(PACK, file).split(sep).join("/");
    const data = JSON.parse(readFileSync(file, "utf8"));
    const kind = classify(data);
    if (rel.startsWith("fixtures/expected/")) continue;
    assert.ok(["beam", "status", "ticket", "schedule"].includes(kind), `${rel}: ${kind}`);
    const built = buildRuns([{ path: rel, data, modified: null }], null);
    assert.equal(built.skipped, 0, rel);
    if (kind === "ticket") assert.equal(built.runs.length, 0, rel);
    else {
      assert.equal(built.runs.length, 1, rel);
      runs++;
      assert.ok(built.runs[0].tickets.length > 0, rel);
    }
  }
  assert.ok(runs >= 7);
});

test("AC-8: every fixture together builds the expected runs and the big run has 68 tickets", () => {
  const docs = walk(FIX)
    .map((f) => ({ path: relative(PACK, f).split(sep).join("/"), data: JSON.parse(readFileSync(f, "utf8")), modified: null }))
    .filter((d) => !d.path.startsWith("fixtures/expected/"));
  docs.push(doc("plan/schedule.json"));
  const built = buildRuns(docs, null);
  assert.equal(built.skipped, 0);
  const names = built.runs.map((r) => r.name || r.instance || r.dir);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })));
  const big = built.runs.find((r) => r.name === "core");
  assert.equal(big.tickets.length, 68);
  assert.ok(built.runs.some((r) => r.kind === "schedule" && r.name === "WarpView"));
  assert.ok(built.runs.some((r) => r.name === "view"));
});
