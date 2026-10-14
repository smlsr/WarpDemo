import { CATS, catColor, catOf, statusText } from "../../core/status.mjs";
import { ago, esc, fmtH, fmtN, num, parseTime, stamp } from "../../core/util.mjs";

export const MAX_EVENTS = 25;

const SAFE_URL = /^https?:\/\//i;

export function jiraUrl(run, key) {
  const site = run && run.jiraSite;
  if (!key || !site) return null;
  const base = /^https?:\/\//.test(site) ? site : "https://" + site;
  return base.replace(/\/+$/, "") + "/browse/" + encodeURIComponent(key);
}

export function prLabel(url) {
  const m = /(\d+)\/?$/.exec(url || "");
  return m ? "PR #" + m[1] : "PR";
}

const link = (href, text) =>
  href && SAFE_URL.test(String(href))
    ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`
    : esc(text);

const hours = (v) => (num(v) == null ? null : Math.round(num(v)));

const catLabel = (t) => {
  const key = t.cat || catOf(t.status);
  const c = CATS.find((x) => x.key === key);
  return { key, label: c ? c.label : key };
};

function fields(t, run, now) {
  const pr = t.pr || {};
  const ju = jiraUrl(run, t.jiraKey);
  const cat = catLabel(t);
  const planned = t.planned && typeof t.planned === "object" ? t.planned : null;
  const start = hours(t.start);
  const merge = hours(t.mergeAt);
  const rows = [
    ["Status", `<b style="color:${catColor(cat.key)}">${esc(cat.label)}</b> · ${esc(statusText(t.status))}`],
    ["Run", esc((run && (run.name || run.instance || run.dir)) || "—")],
    ["Block", esc(t.block || "—")],
    ["Size", esc(t.size || "—") + (t.autoMerge ? " · auto-merge" : " · needs approval")],
    ["Estimate", `${esc(fmtH(t.hours))} <span class="dv-raw">(${esc(t.hoursFrom || "—")})</span>`],
    [
      "Planned",
      start == null || merge == null
        ? "—"
        : `T+${start}h → T+${merge}h · slot ${esc(num(t.slot) == null ? "—" : t.slot + 1)}${t.unplaced ? " · dependency could not be met" : ""}`,
    ],
    ["Spent", t.minutes ? esc(fmtH(t.minutes / 60)) : "—"],
    ["Tokens / cost", `${t.tokens ? esc(fmtN(t.tokens)) : "—"} / ${t.cost == null ? "—" : "$" + esc(Number(t.cost).toFixed(2))}`],
    ["Pull request", pr.url ? link(pr.url, pr.url) : "—"],
    ["CI / Bugbot", `${esc(pr.ci || "—")} / ${esc(pr.bugbot || "—")}`],
    [
      "Jira",
      t.jiraKey
        ? link(ju, t.jiraKey) + (t.jiraStatus ? " · " + esc(t.jiraStatus) : "") + (t.jiraDone ? " · Done" : "")
        : "—",
    ],
    [
      "Merged",
      pr.sha
        ? `<span class="mono">${esc(String(pr.sha).slice(0, 10))}</span> ${esc(pr.via || "")} ${esc(pr.mergedAt || "")}`
        : "—",
    ],
    ["Agent", t.agent ? `<span class="mono">${esc(t.agent)}</span>` : "—"],
    ["Attempts", `${esc(t.attempts || 0)}${t.recoveries ? ` · ${esc(t.recoveries)} recoveries` : ""}`],
    ["Module", esc([t.module, t.layer].filter(Boolean).join(" · ") || "—")],
  ];
  if (t.lane || t.repo) rows.push(["Lane / repo", esc([t.lane, t.repo].filter(Boolean).join(" · "))]);
  if (t.priorityGate) {
    rows.push(["Priority gate", `<b>${esc(t.priorityGate)}</b> · dispatched after the critical chain, ahead of rank`]);
  }
  if (planned) {
    const ls = planned.latest_start;
    rows.push([
      "Schedule",
      `slot ${esc(planned.slot ?? "—")} · T+${esc(planned.start ?? "—")}h → T+${esc(planned.merge ?? "—")}h` +
        (ls != null ? ` · latest start T+${esc(ls)}h` : ""),
    ]);
  }
  const upd = parseTime(t.updatedAt);
  rows.push(["Updated", upd == null ? "—" : `${esc(stamp(upd))} (${esc(ago(upd, now))})`]);
  if (t.alarm) rows.splice(1, 0, ["Alarm", `<b class="dv-alarm">${esc(t.alarm)}</b>`]);
  if (t.stateNote) rows.push(["Note", esc(t.stateNote)]);
  return rows;
}

const dl = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;

function stamps(t) {
  const pr = t.pr || {};
  const marks = [
    ["Claimed", t.claimedAt],
    ["PR opened", pr.openedAt],
    ["Reviewed", pr.reviewedAt],
    ["Approved", pr.approvedAt],
    ["Merged", pr.mergedAt],
    ["Jira last comment", t.jiraCommentAt],
    ["Updated", t.updatedAt],
  ];
  return marks.map(([k, v]) => [k, v ? `${esc(stamp(parseTime(v)))} <span class="dv-raw">${esc(v)}</span>` : "—"]);
}

export function recentEvents(events, max = MAX_EVENTS) {
  const list = (Array.isArray(events) ? events : []).filter((e) => e && typeof e === "object");
  const times = list.map((e) => parseTime(e.at));
  const ordered = times.every((x) => x != null)
    ? list.map((e, i) => ({ e, i, at: times[i] })).sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.e)
    : list;
  return ordered.slice(-max).reverse();
}

const eventRow = (e) =>
  `<span class="t">${esc(stamp(parseTime(e.at)))}</span><span>${esc(e.type || "")}` +
  `${e.from || e.to ? ` ${esc(e.from || "")} → ${esc(e.to || "")}` : ""}${e.detail ? " · " + esc(e.detail) : ""}</span>`;

const tags = (list) => `<div class="tags">${list.map((d) => `<span class="tag mono">${esc(d)}</span>`).join("")}</div>`;

function extra(sections, t, run) {
  let out = "";
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s || typeof s.render !== "function") continue;
    try {
      const html = s.render(t, run);
      if (typeof html === "string") out += html;
    } catch {
      // a failing plugin section must not break the drawer
    }
  }
  return out;
}

export function renderDrawer(ticket, run, sections = [], now = Date.now()) {
  const t = ticket || {};
  const cat = catLabel(t);
  const checks = Array.isArray(t.checks) ? t.checks : [];
  const deps = Array.isArray(t.deps) ? t.deps : [];
  const locks = Array.isArray(t.locks) ? t.locks : [];
  const ev = recentEvents(t.events);
  return (
    `<div class="drawer-h" style="--c:${catColor(cat.key)}"><div class="id">${t.critical ? "★ " : ""}${esc(t.id)}</div>` +
    `<div class="tt">${esc(t.title)}</div><button class="btn icon x" id="drawerClose" aria-label="Close">✕</button></div>` +
    `<div class="drawer-b">${dl(fields(t, run, now))}` +
    `<h4>Timestamps</h4>${dl(stamps(t))}` +
    (checks.length
      ? `<h4>Checks when it merges</h4><ul class="dv-checks">${checks
          .map((c) => `<li>${c.name ? `<b>${esc(c.name)}</b> — ` : ""}${esc(c.check)}</li>`)
          .join("")}</ul>`
      : "") +
    (deps.length ? `<h4>Depends on</h4>${tags(deps)}` : "") +
    (locks.length ? `<h4>Locks</h4>${tags(locks)}` : "") +
    (ev.length ? `<h4>Events</h4><div class="ev">${ev.map(eventRow).join("")}</div>` : "") +
    `${extra(sections, t, run)}</div>`
  );
}

export function renderTooltip(ticket) {
  const t = ticket || {};
  const start = hours(t.start);
  const merge = hours(t.mergeAt);
  const meta = [
    t.size ? esc(t.size) : "",
    `est ${esc(fmtH(t.hours, 0))}`,
    start != null && merge != null ? `T+${start}→${merge}h` : "",
    t.block ? esc(t.block) : "",
    t.pr && t.pr.url ? esc(prLabel(t.pr.url)) : "",
    t.jiraKey ? esc(t.jiraKey) : "",
  ].filter(Boolean);
  return (
    `<b>${t.critical ? "★ " : ""}${esc(t.id)}</b> · ${esc(statusText(t.status))}<br>${esc(t.title)}<br>` +
    `<span class="m">${meta.join(" · ")}</span>${t.alarm ? `<br>⚠ ${esc(t.alarm)}` : ""}`
  );
}
