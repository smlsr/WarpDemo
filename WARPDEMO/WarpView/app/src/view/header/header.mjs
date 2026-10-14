import { CATS, catColor } from "../../core/status.mjs";
import { ago, esc, fmtH, fmtN, natCmp, num, pct, stamp } from "../../core/util.mjs";

export const BUCKETS = Object.freeze([
  Object.freeze({ key: "done", label: "Completed", color: catColor("done") }),
  Object.freeze({ key: "prog", label: "In progress", color: catColor("prog") }),
  Object.freeze({ key: "err", label: "Errored / parked", color: catColor("err") }),
  Object.freeze({ key: "todo", label: "To do", color: catColor("todo") }),
]);

const SIZE_ORDER = ["S", "M", "L", "XL", "—"];
const TABLE_ROWS = 8;

const sum = (xs) => xs.reduce((a, b) => a + (num(b) || 0), 0);
const list = (runs) => (Array.isArray(runs) ? runs.filter(Boolean) : []);
const ticketsOf = (r) => (r && Array.isArray(r.tickets) ? r.tickets.filter(Boolean) : []);
const pick = (v, key) => (v == null || v === "" ? null : typeof v === "object" ? v[key] || null : String(v));

export const runKey = (r) => r.name || r.instance || r.dir || "run";
export const runLabel = (r) => r.name || (r.instance ? "warp:" + r.instance : r.dir || "run");

export function currentRuns(runs, tab = "all") {
  const all = list(runs);
  if (tab == null || tab === "all") return all;
  const hit = all.filter((r) => runKey(r) === tab);
  return hit.length ? hit : all;
}

export function runStateOf(r) {
  if (r.kind === "schedule") return "plan";
  if (r.paused && (r.runState === "running" || !r.runState)) return "paused";
  return r.runState || null;
}

const chip = (inner, cls = "", title = null) =>
  `<span class="chip${cls ? " " + cls : ""}"${title != null ? ` title="${esc(title)}"` : ""}>${inner}</span>`;

export function renderMeta(runs, tab = "all", { now = Date.now() } = {}) {
  const all = list(runs);
  if (!all.length) return chip("No run loaded");
  const cur = currentRuns(all, tab);
  const r = cur[0];
  const parts = [];
  const repo = cur.map((x) => x.repo).find(Boolean);
  if (repo) parts.push(chip(`repo <b>${esc(repo)}</b>`));
  if (cur.length === 1) {
    if (r.name) parts.push(chip(`run <b>${esc(r.name)}</b>`));
    if (r.instance) parts.push(chip(`warp:${esc(r.instance)}`, "mono"));
    const st = runStateOf(r);
    if (st) parts.push(chip(`<i class="dot ${esc(st)}"></i><b>${esc(st)}</b>${r.pauseReason ? " · " + esc(r.pauseReason) : ""}`));
    const range = pick(r.range, "spec");
    if (range) parts.push(chip(`range <b>${esc(range)}</b>`));
    const owner = pick(r.owner, "by");
    if (owner) parts.push(chip(`owner <b>${esc(owner)}</b>`));
    const exported = r.export ? num(r.exportedAt) : null;
    if (exported != null) parts.push(chip(`exported <b>${esc(stamp(exported))}</b>`, "", new Date(exported).toISOString()));
  } else {
    const live = all.filter((x) => x.runState === "running" && !x.paused).length;
    parts.push(chip(`<b>${all.length}</b> runs · ${live} running`));
  }
  const upd = Math.max(0, ...cur.map((x) => num(x.updated) || 0)) || null;
  if (upd != null) {
    parts.push(
      chip(`updated <b>${esc(ago(upd, now))}</b><span class="hide-sm"> · ${esc(stamp(upd))}</span>`, "", new Date(upd).toISOString()),
    );
  }
  return parts.join("");
}

const plannedStart = (t) => (num(t.start) != null ? t.start : Infinity);

export function renderHeadline(runs) {
  const cur = list(runs);
  if (!cur.length) return { title: "Warp run", subline: "", chain: "" };
  const one = cur.length === 1 ? cur[0] : null;
  const repo = cur.map((x) => x.repo).find(Boolean) || cur.map((x) => x.project).find(Boolean);
  const title = one
    ? `${one.name ? one.name + " — " : ""}${repo || "Warp run"} swimlane`
    : `${repo || "Warp"} — ${cur.length} runs`;

  const tickets = cur.flatMap(ticketsOf);
  const bits = [`${fmtN(tickets.length)} tickets`];
  if (one && one.kind !== "status" && num(one.waves) != null) bits.push(`${one.waves} waves`);
  bits.push(`${fmtN(sum(tickets.map((t) => t.hours)))} agent-hours`);
  const cap = one ? num(one.cap) : Math.max(0, ...cur.map((r) => num(r.cap) || 0)) || null;
  if (cap != null) bits.push(`${one ? "" : "up to "}${cap} agent slots`);
  const fin = Math.max(0, ...cur.map((r) => num(r.finish) || 0));
  if (fin) {
    const note = cur.some((r) => r.kind === "status") ? " (status.json has no dependencies; open beam.json for the plan)" : "";
    bits.push(`planned finish T+${Math.round(fin)}h${note}`);
  }
  if (one && num(one.peak)) bits.push(`peak ${one.peak} in flight`);
  if (one && num(one.critCount)) bits.push(`critical chain ${fmtH(one.critHours, 0)} over ${one.critCount} tickets`);
  if (one && one.gateOrder) bits.push(`gate order ${one.gateOrder}`);
  if (one && one.startAfter) bits.push(`starts after ${[].concat(one.startAfter).join(", ")}`);
  if (one && one.planSource === "schedule") bits.push("plan as written in schedule.json");

  const chain = one
    ? ticketsOf(one)
        .filter((t) => t.critical)
        .sort((a, b) => plannedStart(a) - plannedStart(b) || natCmp(a.id, b.id))
        .map((t) => t.id)
    : [];
  return {
    title: esc(title),
    subline: esc(bits.join(" · ")),
    chain: chain.length ? esc("★ " + chain.join(" → ")) : "",
  };
}

export function renderTabs(runs, tab = "all") {
  const all = list(runs);
  if (all.length < 2) return "";
  const on = currentRuns(all, tab).length === 1 ? runKey(currentRuns(all, tab)[0]) : "all";
  const button = (key, text) =>
    `<button type="button" class="tab${on === key ? " on" : ""}" data-tab="${esc(key)}" aria-pressed="${on === key}">${text}</button>`;
  return [button("all", `All runs (${all.length})`)]
    .concat(
      all.map((r) => {
        const ts = ticketsOf(r);
        return button(runKey(r), `${esc(runLabel(r))} · ${ts.filter((t) => t.cat === "done").length}/${ts.length}`);
      }),
    )
    .join("");
}

export function stackBar(values, total) {
  if (!total) return '<div class="stack"></div>';
  return (
    '<div class="stack">' +
    BUCKETS.map((b) =>
      values[b.key] > 0 ? `<i style="width:${(100 * values[b.key]) / total}%;background:${b.color}" title="${esc(b.label)}"></i>` : "",
    ).join("") +
    "</div>"
  );
}

export function rowsFor(values, total, fmt) {
  return (
    '<div class="rows">' +
    BUCKETS.filter((b) => b.key !== "err" || values.err > 0)
      .map((b) => {
        const v = values[b.key];
        return `<div><i class="sw" style="background:${b.color}"></i>${esc(b.label)}<span class="v">${v == null ? "—" : fmt(v)}</span><span class="p">${v == null ? "" : pct(v, total)}</span></div>`;
      })
      .join("") +
    "</div>"
  );
}

function catCounts(runs) {
  const by = Object.fromEntries(CATS.map((c) => [c.key, 0]));
  for (const t of list(runs).flatMap(ticketsOf)) if (Object.prototype.hasOwnProperty.call(by, t.cat)) by[t.cat]++;
  return by;
}

const card = (title, sub, big, bar, rows, foot, extra = "") =>
  `<div class="card"><h3>${title} <span>${sub}</span></h3><div class="big">${big}</div>${bar}${rows}<div class="foot">${foot}</div>${extra}</div>`;

export function renderCards(m, runs = []) {
  const many = list(runs).length > 1;
  const byCat = catCounts(runs);
  const assume = m.assumptions && m.assumptions.length
    ? `<details class="assume"><summary>Assumptions</summary><ul>${m.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details>`
    : "";
  const run = card(
    "Run estimate",
    many ? "longest run" : "elapsed, plan",
    fmtH(m.estTotal),
    stackBar(m.share, m.estTotal || 0),
    rowsFor(m.share, m.estTotal || 0, (v) => fmtH(v)),
    `<span>Elapsed <b>${fmtH(m.elapsed)}</b></span><span>ETA left <b>${m.eta == null ? "—" : "~" + fmtH(m.eta)}</b></span>` +
      (m.finish ? `<span title="Planned finish on the swimlane, with blocks in order">Swimlane <b>T+${Math.round(m.finish)}h</b></span>` : "") +
      `<span title="The plan's elapsed estimate, split by agent-hour share">split by agent-hours</span>`,
    assume,
  );
  const agent = card(
    "Agent hours",
    "estimate",
    fmtH(m.agentTotal),
    stackBar(m.agent, m.agentTotal),
    rowsFor(m.agent, m.agentTotal, (v) => fmtH(v)),
    `<span>Actual <b>${m.actualH ? fmtH(m.actualH) : "—"}</b></span><span>Tokens <b>${m.tokens ? fmtN(m.tokens) : "—"}</b></span>` +
      `<span>Cost <b>${m.cost == null ? "—" : "$" + m.cost.toFixed(2)}</b></span>` +
      (m.sizeDerived ? `<span title="S=4, M=7, L=11, XL=16 (scan.py)">${fmtN(m.sizeDerived)} from size</span>` : ""),
  );
  const human = card(
    "People hours",
    "approvals + gates",
    fmtH(m.humanTotal),
    stackBar(m.human, m.humanTotal),
    rowsFor(m.human, m.humanTotal, (v) => fmtH(v)),
    `<span>Plan <b>${fmtH(m.humanPlan)}</b></span><span>Gates <b>${m.gatesTotal ? m.gatesGreen + "/" + m.gatesTotal : "—"}</b> green</span>` +
      `<span>0.5h per review or gate</span>`,
  );
  const tick = card(
    "Tickets",
    `${pct(m.count.done, m.ticketTotal)} complete`,
    fmtN(m.ticketTotal),
    stackBar(m.count, m.ticketTotal),
    rowsFor(m.count, m.ticketTotal, fmtN),
    `<span>In review <b>${byCat.rev}</b></span><span>QA ready <b>${byCat.qa}</b></span><span>Coding <b>${byCat.prog}</b></span>`,
  );
  return run + agent + human + tick;
}

function miniTable(rows, head, order) {
  const sorted = order
    ? order.map((k) => rows.find((r) => r.key === k)).filter(Boolean)
    : [...rows].sort((a, b) => natCmp(a.key, b.key));
  const body = sorted
    .slice(0, TABLE_ROWS)
    .map((v) => `<tr><td class="mono">${esc(v.key)}</td><td>${fmtN(v.n)}</td><td>${fmtN(v.tokens)}</td><td>${fmtN(v.minutes)}</td></tr>`)
    .join("");
  const more = rows.length > TABLE_ROWS ? `<div class="tlnote">${rows.length - TABLE_ROWS} more</div>` : "";
  return `<table class="mini"><thead><tr><th>${head}</th><th>tickets</th><th>tokens</th><th>minutes</th></tr></thead><tbody>${body}</tbody></table>${more}`;
}

const meter = (label, v, max, text) =>
  `<div class="row"><span>${label}</span><span class="bar0"><i class="${max && v > max ? "over" : ""}" style="width:${max ? Math.min(100, (100 * v) / max) : 0}%"></i></span><span class="v">${text}</span></div>`;

export function renderUtil(u) {
  const cap = num(u.cap);
  const est = num(u.estH);
  const head = `${u.active} active of ${fmtN(cap)} agents · ${fmtH(u.spentH)} spent${est ? " of " + fmtH(est) + " estimated" : ""} · ${fmtN(u.tokens)} tokens`;
  return (
    `<summary>Utilization <span class="muted">${head}</span></summary>` +
    `<div class="util-b"><div class="meter">` +
    meter("Active agents / maxAgents", u.active, cap, `${u.active} / ${fmtN(cap)}`) +
    meter("Agent hours / estimate", u.spentH, est, `${fmtH(u.spentH)} / ${fmtH(est)}`) +
    meter("Tickets done", u.done, u.total, `${u.done} / ${u.total}`) +
    `<div class="tlnote">Active means a Warp status from claimed through merging. Hours spent are the minutes Warp recorded per ticket.</div>` +
    `</div>` +
    `<div>${miniTable(u.bySize || [], "size", SIZE_ORDER)}</div>` +
    `<div>${miniTable(u.byAgent || [], "agent")}</div></div>`
  );
}

export function renderActions(actions, state) {
  const out = [];
  for (const a of Array.isArray(actions) ? actions : []) {
    if (!a || typeof a.render !== "function") continue;
    let html;
    try {
      html = a.render(state);
    } catch {
      continue;
    }
    if (html == null || html === "") continue;
    out.push(`<span class="hdr-act" data-hook="${esc(a.id)}">${html}</span>`);
  }
  return out.join("");
}

export function renderHeader({ runs, tab = "all", metrics, util, actions = [], now = Date.now() } = {}) {
  const all = list(runs);
  const cur = currentRuns(all, tab);
  const head = renderHeadline(cur);
  return {
    meta: renderMeta(all, tab, { now }),
    title: head.title,
    subline: head.subline,
    chain: head.chain,
    tabs: renderTabs(all, tab),
    metrics: metrics ? renderCards(metrics, cur) : "",
    util: util ? renderUtil(util) : "",
    actions: renderActions(actions, { runs: all, tab, current: cur }),
  };
}
