import { CATS, STATUS_CAT, catColor, statusText } from "../../core/status.mjs";
import { esc, fmtH, natCmp, natKey, stamp } from "../../core/util.mjs";
import { plan } from "../../model/plan/plan.mjs";

export const SIZES = Object.freeze(["S", "M", "L", "XL"]);
export const DEFAULT_SORT = Object.freeze({ key: "start", dir: 1 });

const STATUS_ORDER = Object.keys(STATUS_CAT);

const timeOf = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
};

const prOf = (t) => (t && t.pr && typeof t.pr === "object" ? t.pr : {});
const finite = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const startOf = (t) => finite(t.start) ?? finite(t.planned && t.planned.start);

export const COLS = Object.freeze([
  { key: "id", label: "Ticket", val: (t) => natKey(t.id) },
  {
    key: "status",
    label: "Status",
    val: (t) => {
      const c = CATS.findIndex((x) => x.key === t.cat);
      const s = STATUS_ORDER.indexOf(t.status);
      return (c < 0 ? CATS.length : c) * 100 + (s < 0 ? 99 : s);
    },
  },
  { key: "title", label: "Summary", val: (t) => String(t.title || "").toLowerCase() },
  { key: "size", label: "Size", val: (t) => (SIZES.includes(t.size) ? SIZES.indexOf(t.size) : null) },
  { key: "block", label: "Block", val: (t) => (t.block ? natKey(t.block) : null) },
  { key: "hours", label: "Est", val: (t) => finite(t.hours) },
  { key: "start", label: "Plan", val: startOf },
  { key: "minutes", label: "Spent", val: (t) => (t.minutes ? finite(t.minutes) : null) },
  { key: "opened", label: "Opened", val: (t) => timeOf(prOf(t).openedAt) },
  { key: "reviewed", label: "Reviewed", val: (t) => timeOf(prOf(t).reviewedAt) },
  { key: "approved", label: "Approved", val: (t) => timeOf(prOf(t).approvedAt) },
  { key: "merged", label: "Merged", val: (t) => timeOf(prOf(t).mergedAt) },
  { key: "links", label: "Links", val: (t) => (prOf(t).url ? 1 : 0) + (t.jiraKey ? 1 : 0) },
]);

export const runKey = (r) => (r && (r.name || r.instance || r.dir)) || "run";
export const runLabel = (r) => (r && (r.name || (r.instance ? "warp:" + r.instance : r.dir))) || "run";

const dirOf = (d) => (d === -1 || d === "descending" || d === "desc" ? -1 : 1);

export function normSort(sort) {
  const s = sort && typeof sort === "object" ? sort : {};
  const col = COLS.find((c) => c.key === s.key) || COLS.find((c) => c.key === DEFAULT_SORT.key);
  return { key: col.key, dir: s.key === col.key ? dirOf(s.dir) : DEFAULT_SORT.dir };
}

export function nextSort(sort, key) {
  const cur = normSort(sort);
  if (!COLS.some((c) => c.key === key)) return cur;
  return cur.key === key ? { key, dir: -cur.dir } : { key, dir: 1 };
}

export function sortRows(rows, sort) {
  const { key, dir } = normSort(sort);
  const col = COLS.find((c) => c.key === key);
  const keyed = rows.map((row) => ({ row, v: col.val(row.t) }));
  keyed.sort((a, b) => {
    const am = a.v == null;
    const bm = b.v == null;
    if (am || bm) return am && bm ? natCmp(a.row.t.id, b.row.t.id) * dir : am ? 1 : -1;
    if (a.v < b.v) return -dir;
    if (a.v > b.v) return dir;
    return natCmp(a.row.t.id, b.row.t.id) * dir;
  });
  return keyed.map((k) => k.row);
}

export function jiraUrl(run, key) {
  if (!key || !run || !run.jiraSite) return null;
  const site = /^https?:\/\//.test(run.jiraSite) ? run.jiraSite : "https://" + run.jiraSite;
  return site.replace(/\/+$/, "") + "/browse/" + encodeURIComponent(key);
}

export function prLabel(url) {
  const m = /(\d+)\/?$/.exec(url || "");
  return m ? "PR #" + m[1] : "PR";
}

const stampCell = (raw) => {
  const ms = timeOf(raw);
  return ms == null ? "—" : `<span title="${esc(raw)}">${esc(stamp(ms))}</span>`;
};

function linksCell(run, t) {
  const url = prOf(t).url;
  const pr = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(prLabel(url))}</a>` : "";
  const ju = jiraUrl(run, t.jiraKey);
  const jira = t.jiraKey
    ? ju
      ? `<a href="${esc(ju)}" target="_blank" rel="noopener">${esc(t.jiraKey)}</a>`
      : esc(t.jiraKey)
    : "";
  return [pr, jira].filter(Boolean).join(" ");
}

function rowHtml(run, t, many, visible) {
  const hours = finite(t.hours);
  const start = startOf(t);
  const label = many ? ` <span class="tlnote">${esc(runLabel(run))}</span>` : "";
  const cls = visible ? "trow" : "trow dim";
  return `<tr class="${cls}"${visible ? "" : " hidden"} data-id="${esc(t.id)}" data-run="${esc(runKey(run))}" tabindex="0">
<td class="mono"><b>${t.critical ? "★ " : ""}${esc(t.id)}</b>${label}</td>
<td><span class="chipst" style="--c:${catColor(t.cat)}">${esc(statusText(t.status))}</span></td>
<td class="t" title="${esc(t.title)}">${esc(t.title)}</td>
<td>${esc(t.size || "—")}</td>
<td>${esc(t.block || "—")}</td>
<td>${hours == null ? "—" : fmtH(hours, 0)}</td>
<td>${start == null ? "—" : "T+" + Math.round(start)}</td>
<td>${t.minutes ? fmtH(t.minutes / 60) : "—"}</td>
<td>${stampCell(prOf(t).openedAt)}</td>
<td>${stampCell(prOf(t).reviewedAt)}</td>
<td>${stampCell(prOf(t).approvedAt)}</td>
<td>${stampCell(prOf(t).mergedAt)}</td>
<td>${linksCell(run, t)}</td></tr>`;
}

export function renderTable(runs, sort, matches) {
  const list = (Array.isArray(runs) ? runs : []).filter(Boolean);
  const s = normSort(sort);
  const show = typeof matches === "function" ? matches : () => true;
  const rows = [];
  for (const run of list) {
    if (!Array.isArray(run.tickets)) continue;
    let view = run;
    if (!(run.gateAt instanceof Map)) {
      view = { ...run, tickets: run.tickets.map((t) => (t && typeof t === "object" ? { ...t } : t)) };
      plan(view);
    }
    const src = new Map(run.tickets.map((t, i) => [view.tickets[i], t]));
    for (const t of view.tickets) rows.push({ t, run: view, orig: src.get(t), origRun: run });
  }
  const body = sortRows(rows, s)
    .map(({ t, run, orig, origRun }) => rowHtml(run, t, list.length > 1, !!show(orig, origRun)))
    .join("");
  const head = COLS.map(
    (c) =>
      `<th data-sort="${c.key}" tabindex="0"${c.key === s.key ? ` aria-sort="${s.dir > 0 ? "ascending" : "descending"}"` : ""}>${c.label}</th>`
  ).join("");
  return `<section class="panel"><div class="tbl-wrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}
