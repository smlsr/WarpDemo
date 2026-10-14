import { esc, fmtH, hashHue, natCmp, num, parseTime, stamp } from "../../core/util.mjs";
import { CATS, bucketOf, catColor, statusText } from "../../core/status.mjs";
import { assignBlocks, gateKeys } from "../../model/blocks/blocks.mjs";
import { GROUPS, matches } from "../controls/controls.mjs";

export const GROUP_BY = GROUPS;
export const SIZE_LANES = Object.freeze(["S", "M", "L", "XL", "No size"]);

const BUCKETS = Object.freeze([
  { key: "done", label: "Completed", color: "var(--c-done)" },
  { key: "prog", label: "In progress", color: "var(--c-prog)" },
  { key: "err", label: "Errored / parked", color: "var(--c-err)" },
  { key: "todo", label: "To do", color: "var(--c-todo)" },
]);

const CHEVRON =
  '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"></path></svg>';

const toSet = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));
const sum = (a) => a.reduce((x, y) => x + (num(y) || 0), 0);
const timeOf = (v) => {
  const ms = typeof v === "number" ? v : parseTime(v);
  return ms != null && !isNaN(new Date(ms).getTime()) ? ms : null;
};

export const normGroupBy = (g) => (GROUP_BY.includes(g) ? g : "block");
export const runKey = (r) => r.name || r.instance || r.dir || "run";
export const runLabel = (r) => r.name || (r.instance ? "warp:" + r.instance : r.dir || "run");

export function groupKeyOf(t, groupBy) {
  switch (normGroupBy(groupBy)) {
    case "status":
      return t.cat;
    case "module":
      return t.module || "No module";
    case "size":
      return t.size || "No size";
    case "lane":
      return t.lane || t.module || "No lane";
    case "repo":
      return t.repo || "No repo";
    default:
      return t.block || "All tickets";
  }
}

function blocksOf(run, keys) {
  const tickets = run.tickets || [];
  if (!keys.length || tickets.every((t) => t.block !== undefined)) return null;
  const copy = { ...run, tickets: tickets.map((t) => ({ ...t })) };
  return assignBlocks(copy);
}

function laneKeys(run, groupBy, gkeys) {
  const tickets = run.tickets || [];
  const distinct = (f) => [...new Set(tickets.map(f))].sort(natCmp);
  switch (groupBy) {
    case "status":
      return CATS.map((c) => c.key);
    case "size":
      return SIZE_LANES.slice();
    case "block":
      return gkeys.length ? gkeys : ["All tickets"];
    case "lane":
      return distinct((t) => t.lane || t.module || "No lane");
    case "repo":
      return distinct((t) => t.repo || "No repo");
    default:
      return distinct((t) => t.module || "No module");
  }
}

export function lanesFor(runs, groupBy = "block") {
  const by = normGroupBy(groupBy);
  const list = Array.isArray(runs) ? runs.filter(Boolean) : [];
  const lanes = new Map();
  const prefixed = list.length > 1 && by === "block";
  const laneId = (run, k) => (prefixed ? runLabel(run) + " · " : "") + k;
  const gateOf = (run, k) => (by === "block" ? (run.gates || []).find((g) => g && String(g.key) === k) || null : null);
  for (const run of list) {
    const gkeys = gateKeys(run);
    const blocks = by === "block" ? blocksOf(run, gkeys) : null;
    for (const k of laneKeys(run, by, gkeys)) {
      const id = laneId(run, k);
      if (!lanes.has(id)) lanes.set(id, { id, key: k, run, gate: gateOf(run, k), items: [] });
    }
    for (const t of run.tickets || []) {
      const k = blocks ? blocks[t.id] || "All tickets" : groupKeyOf(t, by);
      const id = laneId(run, k);
      if (!lanes.has(id)) lanes.set(id, { id, key: k, run, gate: gateOf(run, k), items: [] });
      lanes.get(id).items.push({ t, run });
    }
  }
  return [...lanes.values()].filter((l) => l.items.length);
}

export function ticketMatches(t, run, state = {}) {
  if (typeof state.match === "function") return !!state.match(t, run);
  return matches(t, run, { off: toSet(state.off), q: state.q });
}

export function safeUrl(u) {
  const s = String(u == null ? "" : u).trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
}

export function jiraUrl(site, key) {
  const s = String(site == null ? "" : site).trim();
  if (!key || !s) return null;
  const base = /^https?:\/\//i.test(s) ? s : "https://" + s;
  return safeUrl(base.replace(/\/+$/, "") + "/browse/" + encodeURIComponent(key));
}

export function prLabel(url) {
  const m = /(\d+)\/?$/.exec(url || "");
  return m ? "PR #" + m[1] : "PR";
}

export function colorOf(t, colorBy) {
  if (colorBy === "module" || colorBy === "lane") {
    const h = hashHue((colorBy === "lane" ? t.lane || t.module : t.module) || "none");
    const ui = /ui|front|web|app|screen/i.test(t.layer || "");
    return `hsl(${h} 62% ${ui ? 62 : 46}%)`;
  }
  return catColor(t.cat);
}

export function stackBar(values, total) {
  if (!total) return '<div class="stack"></div>';
  const parts = BUCKETS.map((b) =>
    values[b.key] > 0 ? `<i style="width:${(100 * values[b.key]) / total}%;background:${b.color}" title="${esc(b.label)}"></i>` : "",
  );
  return '<div class="stack">' + parts.join("") + "</div>";
}

const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)} ↗</a>`;

export function renderCard(t, run, opts = {}) {
  const pr = t.pr || {};
  const prHref = safeUrl(pr.url);
  const ju = jiraUrl(run && run.jiraSite, t.jiraKey);
  const star = t.critical ? "★ " : "";
  const title = t.title ? esc(t.title) : '<span class="none">No title</span>';
  const prPart = pr.url ? (prHref ? link(prHref, prLabel(prHref)) : `<span>${esc(prLabel(pr.url))}</span>`) : "";
  const jiraPart = t.jiraKey ? (ju ? link(ju, t.jiraKey) : `<span>${esc(t.jiraKey)}</span>`) : "";
  const ci = pr.ci ? `<span title="CI">CI ${pr.ci === "green" ? "✓" : esc(pr.ci)}</span>` : "";
  const spent = t.minutes ? `<span title="Agent time spent">spent ${fmtH(t.minutes / 60)}</span>` : "";
  return `<article class="tcard ${t.critical ? "crit" : ""}" style="--c:${colorOf(t, opts.colorBy)}" data-id="${esc(t.id)}" data-run="${esc(runKey(run || {}))}" tabindex="0">
    <div class="l1"><span class="id">${star}${esc(t.id)}</span>${t.size ? `<span class="badge">${esc(t.size)}</span>` : ""}<span class="st">${esc(statusText(t.status))}</span></div>
    <div class="tt" title="${esc(t.title)}">${title}</div>
    <div class="l3"><span title="Agent-hour estimate (${esc(t.hoursFrom)})">est ${fmtH(num(t.hours), 0)}</span>${spent}
      ${prPart}
      ${jiraPart}
      ${ci}</div>
    ${t.alarm ? `<div class="alarm">⚠ ${esc(t.alarm)}</div>` : ""}</article>`;
}

export function gateTooltip(gate) {
  const green = timeOf(gate.greenAt);
  const starts = Array.isArray(gate.starts) ? gate.starts : [];
  const checks = (Array.isArray(gate.checks) ? gate.checks : []).map((c) => (c && typeof c === "object" ? c.check || c.name || "" : c));
  return [
    gate.scope && !gate.blocking ? "scope: " + gate.scope : "",
    starts.length ? "starts: " + starts.join(", ") : "",
    green != null ? "green " + new Date(green).toISOString() : "",
    gate.evidence || "",
    ...checks.filter(Boolean).map((c) => "check: " + c),
    gate.onGreen ? "on green: " + gate.onGreen : "",
    gate.ifRed ? "if red: " + gate.ifRed : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function gatePills(gate) {
  if (!gate) return "";
  const starts = Array.isArray(gate.starts) ? gate.starts : [];
  const status = gate.status || "pending";
  const cls = status === "green" ? "green" : status === "red" ? "red" : "";
  const green = timeOf(gate.greenAt);
  return (
    (gate.priority ? '<span class="pill" title="priority gate: its path dispatches ahead of rank">priority</span>' : "") +
    (starts.length ? `<span class="pill" title="these programs start at this gate">starts ${esc(starts.join(", "))}</span>` : "") +
    `<span class="pill ${cls}" title="${esc(gateTooltip(gate))}">gate ${esc(status)}${green != null ? " · " + esc(stamp(green)) : ""}</span>`
  );
}

export function laneClosed(laneId, { cleared, groupBy, total, laneCount, closed }) {
  const c = toSet(closed);
  if (c.has(laneId)) return true;
  if (c.has("!" + laneId)) return false;
  return !!cleared && groupBy === "block" && total > 0 && laneCount > 1;
}

export function setLaneClosed(closed, laneId, isClosed) {
  const next = new Set(toSet(closed));
  next.delete(laneId);
  next.delete("!" + laneId);
  next.add(isClosed ? laneId : "!" + laneId);
  return next;
}

const startOf = (t) => {
  const s = num(t.start);
  return s == null ? Infinity : s;
};

export function renderLane(lane, state = {}, laneCount = 1) {
  const groupBy = normGroupBy(state.groupBy);
  const items = lane.items.slice().sort((a, b) => startOf(a.t) - startOf(b.t) || natCmp(a.t.id, b.t.id));
  const values = { done: 0, prog: 0, err: 0, todo: 0 };
  for (const { t } of items) {
    const b = bucketOf(t.cat);
    values[b in values ? b : "todo"]++;
  }
  const total = items.length;
  const doneN = values.done;
  const gate = lane.gate;
  const cleared = doneN === total && !(gate && gate.status === "red");
  const closed = laneClosed(lane.id, { cleared, groupBy, total, laneCount, closed: state.closed });
  const shown = items.filter(({ t, run }) => ticketMatches(t, run, state));
  const cat = groupBy === "status" ? CATS.find((c) => c.key === lane.key) : null;
  const title = groupBy === "status" ? (cat ? cat.label : lane.key) : lane.id;
  const swatch = cat ? `<i class="sw" style="background:${catColor(cat.key)}"></i>` : "";
  const gname = gate && gate.name ? ` <span class="gname">${esc(gate.name)}</span>` : "";
  const clearedPill = cleared && groupBy === "block" ? '<span class="pill green">cleared</span>' : "";
  const shownNote = shown.length !== total ? `<span>${shown.length} shown</span>` : "";
  const cards = shown.map(({ t, run }) => renderCard(t, run, state)).join("") || '<div class="empty-lane">Nothing here.</div>';
  return `<section class="panel lane ${closed ? "closed" : ""}" data-lane="${esc(lane.id)}">
      <div class="lane-h" role="button" tabindex="0" aria-expanded="${!closed}">${CHEVRON}
        <h2>${swatch}${esc(title)}${gname}</h2>
        ${gatePills(gate)}${clearedPill}
        <span class="stat"><span>${doneN}/${total} done</span><span>${fmtH(sum(items.map(({ t }) => t.hours)))} agent</span>${shownNote}${stackBar(values, total)}</span></div>
      <div class="lane-b">${cards}</div></section>`;
}

export function renderBoard(state = {}) {
  const lanes = lanesFor(state.runs, state.groupBy);
  if (!lanes.length) return '<div class="empty">No tickets.</div>';
  return lanes.map((lane) => renderLane(lane, state, lanes.length)).join("");
}
