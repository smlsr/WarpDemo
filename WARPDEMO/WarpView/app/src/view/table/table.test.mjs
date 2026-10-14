import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { renderTable, nextSort, sortRows, COLS } from "./table.mjs";
import { buildRuns } from "../../load/parse/parse.mjs";
import { stamp } from "../../core/util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../../../../fixtures");
const CSS = readFileSync(join(HERE, "table.css"), "utf8");
const load = (p) => JSON.parse(readFileSync(join(FIX, p), "utf8"));

const sampleRuns = () =>
  buildRuns([{ path: ".warp/beam.json", data: load("beam.sample.json"), modified: 0 }]).runs;

const dom = (html) => new JSDOM(`<body><div id="v">${html}</div></body>`).window.document;
const ids = (doc) => [...doc.querySelectorAll("tbody tr")].map((r) => r.dataset.id);
const cells = (doc, id) => [...doc.querySelector(`tr[data-id="${id}"]`).children];
const col = (key) => COLS.findIndex((c) => c.key === key);

const mini = (tickets) => [{ name: "m", gates: [], tickets }];
const tk = (id, pr = {}, extra = {}) => ({
  id,
  title: id,
  size: "S",
  status: "merged",
  cat: "done",
  hours: 4,
  deps: [],
  gate: null,
  minutes: 0,
  pr: { url: null, openedAt: null, reviewedAt: null, approvedAt: null, mergedAt: null, ...pr },
  planned: null,
  ...extra,
});

test("AC-1: sample beam sorted by Merged descending lists tickets as in view.table.json", () => {
  const exp = load("expected/view.table.json");
  const doc = dom(renderTable(sampleRuns(), { key: exp.sort, dir: exp.dir }));
  assert.deepEqual(ids(doc), exp.ids);
  const th = [...doc.querySelectorAll("thead th")];
  assert.deepEqual(
    th.map((h) => h.textContent),
    ["Ticket", "Status", "Summary", "Size", "Block", "Est", "Plan", "Spent", "Opened", "Reviewed", "Approved", "Merged", "Links"]
  );
  assert.equal(th[col("merged")].getAttribute("aria-sort"), "descending");
  assert.equal(th.filter((h) => h.hasAttribute("aria-sort")).length, 1);
  const r = cells(doc, "WV-12");
  assert.equal(r[col("status")].textContent.trim(), "merged");
  assert.equal(r[col("size")].textContent, "M");
  assert.equal(r[col("block")].textContent, "G2");
  assert.equal(r[col("hours")].textContent, "7h");
  assert.equal(r[col("start")].textContent, "T+22");
  assert.equal(r[col("minutes")].textContent, "2.6h");
  assert.equal(r[col("opened")].textContent, stamp(Date.parse("2026-10-12T01:16:02Z")));
  assert.equal(r[col("opened")].querySelector("span").title, "2026-10-12T01:16:02Z");
  assert.equal(r[col("approved")].textContent, "—");
  assert.equal(r[col("links")].querySelector("a").textContent, "PR #64");
  assert.equal(r[col("links")].querySelector("a").getAttribute("rel"), "noopener");
  assert.equal(r[col("links")].querySelector("a").getAttribute("target"), "_blank");
  assert.equal(doc.querySelector("tr[data-id=WV-07] td b").textContent, "★ WV-07");
  assert.ok(/position:\s*sticky/.test(CSS));
});

test("AC-1: default sort is Plan ascending", () => {
  const doc = dom(renderTable(sampleRuns()));
  assert.equal(doc.querySelector("th[aria-sort]").dataset.sort, "start");
  assert.equal(doc.querySelector("th[aria-sort]").getAttribute("aria-sort"), "ascending");
  assert.equal(ids(doc)[0], "WV-01");
});

test("AC-2: Status sort follows Completed, Errored / Parked, In Progress, In Review, QA Ready, To Do", () => {
  const runs = sampleRuns();
  const s = nextSort({ key: "merged", dir: -1 }, "status");
  assert.deepEqual(s, { key: "status", dir: 1 });
  const doc = dom(renderTable(runs, s));
  const cats = ids(doc).map((id) => runs[0].tickets.find((t) => t.id === id).cat);
  const order = ["done", "err", "prog", "rev", "qa", "todo"];
  const rank = cats.map((c) => order.indexOf(c));
  assert.deepEqual(rank, [...rank].sort((a, b) => a - b));
  assert.deepEqual([...new Set(cats)], order.filter((c) => cats.includes(c)));
  assert.ok(cats.includes("qa") && cats.includes("err") && cats.includes("todo"));
  const rev = dom(renderTable(runs, nextSort(s, "status")));
  assert.deepEqual(ids(rev).slice().reverse(), ids(doc));
  assert.equal(rev.querySelector("th[aria-sort]").getAttribute("aria-sort"), "descending");
});

test("AC-3: opened-only PR shows three dashes and sorts last by Merged ascending", () => {
  const runs = mini([
    tk("T-1", { openedAt: "2026-10-01T10:00:00Z", mergedAt: "2026-10-02T10:00:00Z" }),
    tk("T-2", { openedAt: "2026-10-01T10:00:00Z" }, { status: "review", cat: "rev" }),
    tk("T-3", { mergedAt: "2026-10-03T10:00:00Z" }),
  ]);
  const asc = dom(renderTable(runs, { key: "merged", dir: 1 }));
  assert.deepEqual(ids(asc), ["T-1", "T-3", "T-2"]);
  const c = cells(asc, "T-2");
  for (const k of ["reviewed", "approved", "merged"]) assert.equal(c[col(k)].textContent, "—");
  assert.notEqual(c[col("opened")].textContent, "—");
  const desc = dom(renderTable(runs, { key: "merged", dir: -1 }));
  assert.equal(ids(desc).at(-1), "T-2");
});

test("AC-4: an invalid timestamp reads — and nothing throws", () => {
  const runs = mini([
    tk("T-1", { openedAt: "not-a-date", reviewedAt: {}, approvedAt: 12 / 0, mergedAt: "not-a-date" }),
    tk("T-2", { mergedAt: "2026-10-03T10:00:00Z" }),
  ]);
  let html;
  assert.doesNotThrow(() => {
    html = renderTable(runs, { key: "merged", dir: 1 });
    for (const c of COLS) renderTable(runs, { key: c.key, dir: -1 });
  });
  const doc = dom(html);
  const c = cells(doc, "T-1");
  for (const k of ["opened", "reviewed", "approved", "merged"]) {
    assert.equal(c[col(k)].textContent, "—");
    assert.equal(c[col(k)].querySelector("span"), null);
  }
  assert.deepEqual(ids(doc), ["T-2", "T-1"]);
  assert.doesNotThrow(() => renderTable([{ tickets: [{ id: "X" }] }, null, {}], { key: "nope" }, () => true));
});

test("AC-1: header sort controls, filtering, run labels and escaping", () => {
  assert.deepEqual(nextSort({ key: "start", dir: 1 }, "start"), { key: "start", dir: -1 });
  assert.deepEqual(nextSort({ key: "start", dir: -1 }, "start"), { key: "start", dir: 1 });
  assert.deepEqual(nextSort({ key: "start", dir: -1 }, "size"), { key: "size", dir: 1 });
  const runs = sampleRuns();
  const doc = dom(renderTable(runs, undefined, (t) => t.id !== "WV-01"));
  const hid = doc.querySelector("tr[data-id=WV-01]");
  assert.ok(hid.classList.contains("dim") && hid.hasAttribute("hidden"));
  assert.ok(!doc.querySelector("tr[data-id=WV-02]").classList.contains("dim"));
  for (const th of doc.querySelectorAll("th")) assert.equal(th.getAttribute("tabindex"), "0");
  for (const tr of doc.querySelectorAll("tbody tr")) assert.equal(tr.getAttribute("tabindex"), "0");

  const a = { name: "view", tickets: [tk("A-1")] };
  const b = { name: "edit", tickets: [tk("B-1", {}, { title: '<img src=x onerror="1">', jiraKey: 'K"1' })] };
  const multi = dom(renderTable([a, b], { key: "id", dir: 1 }));
  assert.equal(multi.querySelector("tr[data-id=A-1] .tlnote").textContent, "view");
  assert.equal(multi.querySelector("tr[data-id=B-1]").dataset.run, "edit");
  assert.equal(multi.querySelector("img"), null);
  assert.equal(dom(renderTable([a])).querySelector(".tlnote"), null);
  assert.deepEqual(sortRows([{ t: tk("A-2"), run: a }, { t: tk("A-10"), run: a }], { key: "id", dir: 1 }).map((r) => r.t.id), ["A-2", "A-10"]);
});
