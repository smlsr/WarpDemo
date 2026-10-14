import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { buildRuns } from "../../load/parse/parse.mjs";
import { plan } from "../../model/plan/plan.mjs";
import { CATS } from "../../core/status.mjs";
import { legendCounts, renderLegend } from "../controls/controls.mjs";
import {
  jiraUrl,
  lanesFor,
  laneClosed,
  renderBoard,
  renderCard,
  setLaneClosed,
  ticketMatches,
} from "./board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "../../../..");
const FIX = join(PACK, "fixtures");
const SCREENS = join(PACK, "ui/screens");
const load = (p) => JSON.parse(readFileSync(join(FIX, p), "utf8"));

const runsOf = (docs, extra) => buildRuns(docs, extra).runs.map((r) => plan(r));
const beamRuns = (extra) => runsOf([{ path: ".warp/beam.json", data: load("beam.sample.json") }], extra);
const scheduleRuns = () => runsOf([{ path: "fixtures/schedule/two-repos.json", data: load("schedule/two-repos.json") }]);

const parse = (html) => JSDOM.fragment(`<div>${html}</div>`).firstChild;
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

function laneFacts(root) {
  return [...root.querySelectorAll(".lane")].map((lane) => ({
    id: lane.getAttribute("data-lane"),
    closed: lane.classList.contains("closed"),
    expanded: lane.querySelector(".lane-h").getAttribute("aria-expanded"),
    h2: text(lane.querySelector(".lane-h h2")),
    pills: [...lane.querySelectorAll(".lane-h .pill")].map((p) => ({ text: text(p), cls: p.className, title: p.getAttribute("title") })),
    stat: [...lane.querySelectorAll(".lane-h .stat > span")].map(text),
    stack: [...lane.querySelectorAll(".lane-h .stack i")].map((i) => i.getAttribute("style")),
    cards: [...lane.querySelectorAll(".tcard")].map((c) => ({
      id: c.getAttribute("data-id"),
      run: c.getAttribute("data-run"),
      crit: c.classList.contains("crit"),
      color: c.getAttribute("style"),
      text: text(c),
      links: [...c.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]),
    })),
  }));
}

function embeddedDocs(screen) {
  const html = readFileSync(join(SCREENS, screen), "utf8");
  const m = /<script id="warp-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  const data = JSON.parse(m[1]);
  return { data, docs: data.files.map((f) => ({ path: f.path, data: f.data })) };
}

async function referenceBoard(screen) {
  const dom = new JSDOM(readFileSync(join(SCREENS, screen), "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/" + screen,
  });
  try {
    const view = dom.window.document.querySelector("#view");
    for (let i = 0; i < 100 && !view.querySelector(".lane"); i++) await new Promise((r) => setTimeout(r, 30));
    return laneFacts(parse(view.innerHTML));
  } finally {
    dom.window.close();
  }
}

test("AC-1: beam.sample.json by block gives four lanes G0–G3 with G0 collapsed and cleared", () => {
  const root = parse(renderBoard({ runs: beamRuns(), groupBy: "block" }));
  const lanes = laneFacts(root);
  assert.deepEqual(lanes.map((l) => l.id), ["G0", "G1", "G2", "G3"]);
  const g0 = lanes[0];
  assert.equal(g0.closed, true);
  assert.equal(g0.expanded, "false");
  assert.ok(g0.pills.some((p) => p.text === "cleared" && /\bgreen\b/.test(p.cls)));
  assert.ok(g0.pills.some((p) => /^gate green · /.test(p.text) && /\bgreen\b/.test(p.cls)));
  assert.equal(g0.h2, "G0 Skeleton builds");
  assert.deepEqual(g0.stat, ["1/1 done", "4h agent"]);
  assert.deepEqual(lanes.map((l) => l.closed), [true, true, false, false]);
  const g2 = lanes[2];
  assert.equal(g2.h2, "G2 Panes agree");
  assert.deepEqual(g2.pills.map((p) => p.text), ["priority", "starts WarpEdit", "gate pending"]);
  assert.equal(g2.pills.some((p) => p.text === "cleared"), false);
  assert.deepEqual(lanes[3].pills.map((p) => p.text), ["gate pending"]);
  assert.deepEqual(lanes[3].cards.map((c) => c.id), ["WV-16"]);
});

test("AC-1: the board matches board.png — same lanes, headers, pills, stats and cards as the reference renders", async () => {
  const { data, docs } = embeddedDocs("board.html");
  const mine = laneFacts(parse(renderBoard({ runs: runsOf(docs, { repo: data.repo, jiraSite: data.jiraSite }), groupBy: "block" })));
  const ref = await referenceBoard("board.html");
  assert.equal(ref.length, 4);
  assert.deepEqual(mine, ref);
  const g2 = mine.find((l) => l.id === "G2");
  assert.deepEqual(g2.cards.map((c) => c.id), ["WV-09", "WV-10", "WV-11", "WV-12", "WV-13", "WV-14", "WV-15"]);
  assert.deepEqual(g2.stat, ["1/7 done", "75h agent"]);
  const wv14 = g2.cards.find((c) => c.id === "WV-14");
  assert.match(wv14.text, /⚠ lock-escape/);
});

test("AC-2: groupBy status gives six lanes in CATS order with counts equal to the legend counts", () => {
  const runs = beamRuns();
  const legend = legendCounts(runs);
  for (const c of CATS) assert.ok(legend[c.key] > 0, `fixture has ${c.key}`);
  const chips = [...parse(renderLegend(runs, { off: new Set() })).querySelectorAll(".fchip")];
  assert.deepEqual(chips.map((b) => [b.getAttribute("data-cat"), Number(text(b.querySelector(".n")))]), CATS.map((c) => [c.key, legend[c.key]]));
  const lanes = laneFacts(parse(renderBoard({ runs, groupBy: "status" })));
  assert.equal(lanes.length, 6);
  assert.deepEqual(lanes.map((l) => l.id), CATS.map((c) => c.key));
  assert.deepEqual(lanes.map((l) => l.h2), CATS.map((c) => c.label));
  for (const [i, c] of CATS.entries()) {
    assert.equal(lanes[i].cards.length, legend[c.key], `${c.key} cards`);
    assert.match(lanes[i].stat[0], new RegExp(`/${legend[c.key]} done$`), `${c.key} total`);
    assert.equal(lanes[i].closed, false);
    assert.equal(lanes[i].pills.length, 0);
  }
  assert.deepEqual(lanesFor(runs, "status").map((l) => l.items.length), CATS.map((c) => legend[c.key]));
});

test("AC-3: an empty jiraSite renders the Jira key as plain text; acme.atlassian.net links to /browse/<key>", () => {
  const [run] = beamRuns();
  const t = run.tickets.find((x) => x.id === "WV-01");
  const plain = parse(renderCard(t, { ...run, jiraSite: "" }));
  assert.equal(plain.querySelectorAll("a[href*='browse']").length, 0);
  assert.ok([...plain.querySelectorAll(".l3 span")].some((s) => text(s) === "WAR-101"));
  const linked = parse(renderCard(t, { ...run, jiraSite: "acme.atlassian.net" }));
  const a = [...linked.querySelectorAll("a")].find((x) => text(x).startsWith("WAR-101"));
  assert.equal(a.getAttribute("href"), "https://acme.atlassian.net/browse/WAR-101");
  assert.equal(a.getAttribute("target"), "_blank");
  assert.equal(a.getAttribute("rel"), "noopener");
  assert.equal(jiraUrl("https://acme.atlassian.net/", "WAR-1"), "https://acme.atlassian.net/browse/WAR-1");
  assert.equal(jiraUrl("", "WAR-1"), null);
  assert.equal(jiraUrl("acme.atlassian.net", null), null);
});

test("AC-4: two-repos.json grouped by Repo gives lanes Demo-API and Demo-UI as in schedule-repos.png", async () => {
  const runs = scheduleRuns();
  const mine = laneFacts(parse(renderBoard({ runs, groupBy: "repo" })));
  assert.deepEqual(mine.map((l) => l.id), ["Demo-API", "Demo-UI"]);
  assert.deepEqual(mine[0].cards.map((c) => c.id), ["AR-00", "AD-01", "AD-02", "AD-03", "AD-04"]);
  assert.deepEqual(mine[1].cards.map((c) => c.id), ["AU-01", "AU-02"]);
  assert.ok(mine.every((l) => !l.closed && l.pills.length === 0));
  const ref = await referenceBoard("schedule-repos.html");
  assert.deepEqual(mine, ref);
});

test("AC-4: grouped by block, the G-RBAC lane shows 'priority' and 'starts Demo-Portal' and its tooltip names scope and on-green", () => {
  const lanes = laneFacts(parse(renderBoard({ runs: scheduleRuns(), groupBy: "block" })));
  assert.deepEqual(lanes.map((l) => l.id), ["G0", "G-RBAC", "G1", "G2"]);
  const rbac = lanes.find((l) => l.id === "G-RBAC");
  assert.equal(rbac.h2, "G-RBAC Roles live (Demo-Portal start)");
  const texts = rbac.pills.map((p) => p.text);
  assert.ok(texts.includes("priority"));
  assert.ok(texts.includes("starts Demo-Portal"));
  const gate = rbac.pills.find((p) => /^gate /.test(p.text));
  assert.equal(gate.text, "gate pending");
  const lines = gate.title.split("\n");
  assert.ok(lines.includes("scope: Demo-Portal program start"));
  assert.ok(lines.includes("on green: make gate-close GATE=G-RBAC PROGRAM=Demo-Admin"));
  assert.ok(lines.includes("starts: Demo-Portal"));
  assert.ok(lines.includes("check: make rbac-ready exits 0"));
  assert.ok(lines.includes("if red: Demo-Portal keeps waiting; fix roles first."));
  const g0 = lanes.find((l) => l.id === "G0").pills.find((p) => /^gate /.test(p.text));
  assert.equal(g0.title.split("\n").some((l) => l.startsWith("scope:")), false, "a blocking gate has no scope line");
  assert.deepEqual(rbac.cards.map((c) => c.id), ["AD-02"]);
});

test("AC-5: a filter that hides every ticket in a lane shows '0 shown' and no cards; other lanes are unchanged", () => {
  const runs = beamRuns();
  const all = parse(renderBoard({ runs, groupBy: "block" }));
  const filtered = parse(renderBoard({ runs, groupBy: "block", match: (t) => t.block !== "G3" }));
  const before = [...all.querySelectorAll(".lane")];
  const after = [...filtered.querySelectorAll(".lane")];
  assert.equal(after.length, 4);
  const g3 = laneFacts(filtered).find((l) => l.id === "G3");
  assert.equal(g3.cards.length, 0);
  assert.ok(g3.stat.includes("0 shown"));
  assert.deepEqual(g3.stat.slice(0, 2), ["0/1 done", "4h agent"]);
  for (let i = 0; i < 3; i++) assert.equal(after[i].outerHTML, before[i].outerHTML, `lane ${before[i].getAttribute("data-lane")} unchanged`);

  const byStatus = laneFacts(parse(renderBoard({ runs, groupBy: "status", off: new Set(["todo"]) })));
  const todo = byStatus.find((l) => l.id === "todo");
  assert.equal(todo.cards.length, 0);
  assert.ok(todo.stat.includes("0 shown"));
  for (const l of byStatus.filter((x) => x.id !== "todo")) assert.equal(l.stat.some((s) => /shown$/.test(s)), false);

  const searched = laneFacts(parse(renderBoard({ runs, groupBy: "block", q: "wv-16" })));
  assert.deepEqual(searched.map((l) => l.cards.length), [0, 0, 0, 1]);
  assert.deepEqual(searched.map((l) => l.stat.find((s) => /shown$/.test(s)) || null), ["0 shown", "0 shown", "0 shown", null]);
});

test("AC-6: board.test.mjs sits beside a pure view module (no DOM, storage or network)", () => {
  const src = readFileSync(join(HERE, "board.mjs"), "utf8");
  for (const word of ["document", "window", "localStorage", "fetch(", "XMLHttpRequest", "eval(", "new Function"]) {
    assert.equal(src.includes(word), false, `board.mjs uses ${word}`);
  }
  const runs = beamRuns();
  const snapshot = JSON.stringify(runs.map((r) => r.tickets.map((t) => [t.id, t.status, t.block])));
  const a = renderBoard({ runs, groupBy: "block" });
  assert.equal(renderBoard({ runs, groupBy: "block" }), a);
  assert.equal(JSON.stringify(runs.map((r) => r.tickets.map((t) => [t.id, t.status, t.block]))), snapshot);
  assert.match(readFileSync(join(HERE, "board.css"), "utf8"), /\.lane-b \{[^}]*minmax\(232px, 1fr\)/);
});

test("the person's choice wins over the default collapse, and lanes start open when there is only one", () => {
  const runs = beamRuns();
  const opened = setLaneClosed(new Set(), "G0", false);
  const closedG2 = setLaneClosed(opened, "G2", true);
  const lanes = laneFacts(parse(renderBoard({ runs, groupBy: "block", closed: closedG2 })));
  assert.deepEqual(lanes.map((l) => l.closed), [false, true, true, false]);
  assert.equal(laneClosed("G0", { cleared: true, groupBy: "block", total: 1, laneCount: 1, closed: [] }), false);
  assert.equal(laneClosed("done", { cleared: true, groupBy: "status", total: 9, laneCount: 6, closed: [] }), false);
  assert.deepEqual([...setLaneClosed(closedG2, "G2", false)].sort(), ["!G0", "!G2"]);
});

test("several runs prefix block lanes with the run label; a run without gates gets 'All tickets'", () => {
  const docs = [
    { path: "runs/view/beam.json", data: load("runs/view/beam.json") },
    { path: "runs/edit/beam.json", data: load("runs/edit/beam.json") },
  ];
  const runs = runsOf(docs);
  assert.equal(runs.length, 2);
  const ids = lanesFor(runs, "block").map((l) => l.id);
  assert.ok(ids.every((id) => / · /.test(id)));
  assert.ok(ids.some((id) => id.startsWith("edit · ")) && ids.some((id) => id.startsWith("view · ")));
  assert.deepEqual(lanesFor(runs, "status").map((l) => l.id), CATS.map((c) => c.key).filter((k) => runs.some((r) => r.tickets.some((t) => t.cat === k))));
  const bare = { name: "bare", gates: [], tickets: runs[0].tickets.map((t) => ({ ...t, block: null })) };
  assert.deepEqual(lanesFor([bare], "block").map((l) => l.id), ["All tickets"]);
});

test("lane, module and size groupings use their fallbacks and natural order", () => {
  const [run] = beamRuns();
  const t = (id, extra) => ({ ...run.tickets[0], id, ...extra });
  const r = { name: "x", gates: [], tickets: [t("A-10", { lane: "lane 10", size: "XL" }), t("A-2", { lane: "lane 2", size: null }), t("A-3", { lane: null, module: null, size: "S" })] };
  assert.deepEqual(lanesFor([r], "lane").map((l) => l.id), ["lane 2", "lane 10", "No lane"]);
  assert.deepEqual(lanesFor([r], "size").map((l) => l.id), ["S", "XL", "No size"]);
  assert.deepEqual(lanesFor([r], "repo").map((l) => l.id), ["smlsr/WarpDemo", "No repo"].filter((k) => r.tickets.some((x) => (x.repo || "No repo") === k)));
  assert.deepEqual(lanesFor([r], "module").map((l) => l.id).includes("No module"), true);
  assert.deepEqual(lanesFor([r], "bogus").map((l) => l.id), lanesFor([r], "block").map((l) => l.id));
});

test("every value from a file is escaped and only http(s) links are rendered", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const t = {
    id: evil,
    title: evil,
    size: "S",
    status: "alarm",
    cat: "err",
    hours: 4,
    hoursFrom: evil,
    minutes: 0,
    critical: false,
    jiraKey: evil,
    alarm: evil,
    pr: { url: "javascript:alert(1)//42", ci: evil },
  };
  const run = { name: evil, jiraSite: "acme.atlassian.net", gates: [{ key: "G0", name: evil, status: "red", evidence: evil, checks: [evil], blocking: true }], tickets: [{ ...t, block: "G0" }] };
  const html = renderBoard({ runs: [run], groupBy: "block" });
  assert.equal(html.includes("<img"), false);
  assert.equal(/javascript:/i.test(html), false);
  const root = parse(html);
  assert.equal(root.querySelectorAll("img, script").length, 0);
  const card = root.querySelector(".tcard");
  assert.equal(card.getAttribute("data-id"), evil);
  assert.ok([...card.querySelectorAll("a")].every((a) => /^https:\/\//.test(a.getAttribute("href"))));
  assert.equal(laneFacts(root)[0].pills.some((p) => p.text === "cleared"), false);
  const odd = renderBoard({ runs: [{ ...run, gates: [{ ...run.gates[0], greenAt: 1e20 }] }], groupBy: "block" });
  assert.match(odd, />gate red</);
  assert.ok(ticketMatches(t, run, { q: "" }));
  assert.equal(ticketMatches(t, run, { off: ["err"] }), false);
});
