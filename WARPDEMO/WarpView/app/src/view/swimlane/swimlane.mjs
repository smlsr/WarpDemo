import { esc, fmtH, hashHue, natCmp, num } from "../../core/util.mjs";
import { catColor, catOf, statusText } from "../../core/status.mjs";
import { matches, queryWords } from "../controls/controls.mjs";

export const LABEL_W = 76;
export const LABEL_W_NARROW = 54;
export const PRINT_W = 1020;
export const TICK_STEPS = Object.freeze([1, 2, 5, 10, 20, 25, 50, 100, 200]);
export const MIN_TICK_PX = 56;
export const TINY_PX = 70;
export const GATE_SHARE_PX = 6;

// Text widths are estimated (no DOM here): 7 px per bold label character plus
// 8 px padding, 6 px per name character plus 12 px, as the reference page does.
const LABEL_CH = 7;
const LABEL_PAD = 8;
const NAME_CH = 6;
const NAME_PAD = 12;
const LIFT = "bottom:17px";

const finite = (v) => typeof v === "number" && isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function swimlaneScale(layout, opts = {}) {
  const lab = opts.narrow ? LABEL_W_NARROW : LABEL_W;
  const span = Math.max(1, Math.ceil((num(layout && layout.span) || 0) / 5) * 5);
  const wide = num(opts.width) ?? 0;
  const zoom = clamp(num(opts.zoom) ?? 0, 0, 100);
  const fit = Math.max(wide < 700 ? 7 : 2, (wide - lab - 24) / span);
  const pph = opts.print ? Math.max(1, ((num(opts.printWidth) ?? PRINT_W) - lab) / span) : fit * Math.pow(6, zoom / 100);
  const W = Math.ceil(span * pph) + 16;
  const step = TICK_STEPS.find((x) => x * pph >= MIN_TICK_PX) || 500;
  const ticks = [];
  for (let h = 0; h <= span; h += step) ticks.push(h);
  return { lab, span, pph, W, step, ticks, zoom };
}

export function gateClass(items) {
  if (items.some((x) => x.g && x.g.status === "red")) return "red";
  if (items.length && items.every((x) => x.g && x.g.status === "green")) return "green";
  return "";
}

export function gateLines(gates, pph) {
  const sorted = (gates || []).filter((x) => x && finite(x.at)).slice().sort((a, b) => a.at - b.at || natCmp(a.k, b.k));
  const lines = [];
  for (const x of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.at - x.at) * pph < GATE_SHARE_PX) last.items.push(x);
    else lines.push({ at: x.at, items: [x] });
  }
  return lines;
}

// Labels sit left of their line in two rows. The lower row holds the label and,
// under it, the gate name; the upper row (lifted) overlaps the name line, so a
// lifted label must also clear every name box before it. A group that fits in
// neither row joins the label before it, so no two labels ever overlap.
export function gateLabels(gates, pph) {
  const placed = [];
  const edge = (pred) => {
    for (let i = placed.length - 1; i >= 0; i--) if (pred(placed[i])) return placed[i].x;
    return 0;
  };
  const place = (grp) => {
    const x = grp.at * pph;
    const text = grp.items.map((it) => it.k).join(" · ");
    const wL = text.length * LABEL_CH + LABEL_PAD;
    const lower = edge((p) => !p.lift);
    const upper = edge((p) => p.lift);
    const named = edge((p) => !p.lift && p.name);
    const nameOf = () => {
      const n = grp.items.length === 1 ? String(grp.items[0].g && grp.items[0].g.name ? grp.items[0].g.name : "") : "";
      const wN = n.length * NAME_CH + NAME_PAD;
      return n && wN < x - Math.max(lower, upper) ? { name: n, wN } : { name: "", wN: 0 };
    };
    if (!placed.length || wL <= x - lower) {
      const { name, wN } = nameOf();
      placed.push({ ...grp, x, text, lift: false, name, w: Math.max(wL, wN), wL });
      return;
    }
    if (wL <= x - Math.max(upper, named)) {
      placed.push({ ...grp, x, text, lift: true, name: "", w: wL, wL });
      return;
    }
    const prev = placed.pop();
    place({ at: prev.at, items: prev.items.concat(grp.items) });
  };
  for (const line of gateLines(gates, pph)) place({ at: line.at, items: line.items.slice() });
  return placed;
}

export function gateTooltip(x) {
  const g = (x && x.g) || {};
  const key = x && x.k != null ? x.k : g.key;
  const green = g.greenAt ? new Date(g.greenAt) : null;
  return [
    `${key} ${g.name || ""} — ${g.status || "pending"}`,
    g.blocking ? "blocking: a red gate stops everyone" : g.scope ? "scope: " + g.scope : "",
    g.priority ? "priority gate: its path dispatches ahead of rank" : "",
    Array.isArray(g.starts) && g.starts.length ? "starts: " + g.starts.join(", ") : "",
    green && !isNaN(green) ? "green " + green.toISOString() : "",
    g.evidence || "",
    ...(Array.isArray(g.checks) ? g.checks : []).map((c) => "check: " + (c && typeof c === "object" ? c.check : c)),
    g.onGreen ? "on green: " + g.onGreen : "",
    g.ifRed ? "if red: " + g.ifRed : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function barColor(t, colorBy = "status") {
  if (colorBy === "module" || colorBy === "lane") {
    const h = hashHue((colorBy === "lane" ? t.lane || t.module : t.module) || "none");
    const ui = /ui|front|web|app|screen/i.test(t.layer || "");
    return `hsl(${h} 62% ${ui ? 62 : 46}%)`;
  }
  return catColor(t.cat || catOf(t.status));
}

export function prLabel(url) {
  const m = /(\d+)\/?$/.exec(url || "");
  return m ? "PR #" + m[1] : "PR";
}

export function tooltipFor(t) {
  const pr = t.pr || {};
  const plan = finite(t.start) && finite(t.mergeAt) ? ` · T+${Math.round(t.start)}→${Math.round(t.mergeAt)}h` : "";
  const meta = `${esc(t.size || "")} · est ${fmtH(num(t.hours), 0)}${plan}${t.block ? " · " + esc(t.block) : ""}${pr.url ? " · " + esc(prLabel(pr.url)) : ""}${t.jiraKey ? " · " + esc(t.jiraKey) : ""}`;
  return `<b>${t.critical ? "★ " : ""}${esc(t.id)}</b> · ${esc(statusText(t.status))}<br>${esc(t.title)}<br><span class="m">${meta}</span>${t.alarm ? `<br>⚠ ${esc(t.alarm)}` : ""}`;
}

export function runKeyOf(run) {
  return (run && (run.name || run.instance || run.dir)) || "run";
}

export function ticketMatches(t, run, opts = {}) {
  const off = opts.off instanceof Set ? opts.off : new Set(opts.off || []);
  return matches({ ...t, cat: t.cat || catOf(t.status) }, run, { off, q: opts.query });
}

function renderBar(it, run, sc, opts, key) {
  const t = it.t;
  const pr = t.pr || {};
  const cat = t.cat || catOf(t.status);
  const w = Math.max(3, (it.e - it.s) * sc.pph - 2);
  const tiny = w < TINY_PX;
  const shown = typeof opts.matches === "function" ? opts.matches(t, run) : ticketMatches(t, run, opts);
  const searching = queryWords(opts.query).length > 0;
  const cls = ["bar", "c-" + cat];
  if (t.critical) cls.push("crit");
  if (tiny) cls.push("tiny");
  if (!shown) cls.push("dim");
  else if (searching) cls.push("hit");
  const id = `<span class="id">${t.critical ? "★ " : ""}${esc(t.id)}</span>`;
  let body = `<div class="l1">${id}</div>`;
  if (!tiny) {
    const meta = it.sz ? `${t.size || ""}·${fmtH(num(t.hours), 0)}` : fmtH(it.e - it.s);
    const flag = t.alarm ? "⚠" : pr.ci === "red" ? "✗" : "";
    body = `<div class="l1">${id}<span class="sz">${esc(meta)}</span></div><div class="tt">${esc(t.title)}</div>${flag ? `<span class="flag">${flag}</span>` : ""}`;
  }
  const label = `${t.id} ${statusText(t.status)} ${t.title || ""}`.trim();
  return `<div class="${esc(cls.join(" "))}" style="left:${it.s * sc.pph + 1}px;width:${w}px;--c:${esc(barColor(t, opts.colorBy))}" data-id="${esc(t.id)}" data-run="${esc(key)}" role="button" tabindex="0" aria-label="${esc(label)}">${body}</div>`;
}

export function renderSwimlane(run, layout, opts = {}) {
  const lay = layout || {};
  const sc = swimlaneScale(lay, opts);
  const { lab, pph, W, ticks } = sc;
  const key = opts.runKey != null ? opts.runKey : runKeyOf(run);
  const prefix = lay.prefix || "T+";
  const rows = Math.max(1, Math.floor(num(lay.rows) || 0));
  const lines = gateLines(lay.gates, pph);
  const labels = gateLabels(lay.gates, pph);

  let html = `<div class="tl" style="width:${W + lab}px">`;
  html += `<div class="tl-head"><div class="tl-row gates"><div class="tl-lab"></div><div class="tl-track" style="width:${W}px">`;
  html += labels
    .map((gr) => {
      const tip = gr.items.map(gateTooltip).join("\n\n");
      const name = gr.name ? `<small>${esc(gr.name)}</small>` : "";
      return `<div class="gl${gateClass(gr.items) ? " " + gateClass(gr.items) : ""}" style="left:${gr.x}px;${gr.lift ? LIFT : ""}" title="${esc(tip)}">${esc(gr.text)}${name}</div>`;
    })
    .join("");
  html += `</div></div><div class="tl-row tl-axis"><div class="tl-lab">${esc(prefix)}</div><div class="tl-track" style="width:${W}px">`;
  html += ticks.map((h) => `<span style="left:${h * pph}px">${esc(prefix)}${h}</span>`).join("");
  html += `</div></div></div>`;

  html += `<div class="tl-body" style="position:relative">`;
  html += `<div class="tl-lines" style="position:absolute;left:${lab}px;top:0;bottom:0;width:${W}px;pointer-events:none">`;
  html += ticks.map((h) => `<i class="grid-v" style="left:${h * pph}px"></i>`).join("");
  html += lines.map((ln) => `<i class="gline${gateClass(ln.items) ? " " + gateClass(ln.items) : ""}" style="left:${ln.at * pph}px"></i>`).join("");
  if (finite(lay.now)) html += `<i class="nowline" style="left:${lay.now * pph}px" title="now"></i>`;
  html += `</div>`;

  const byRow = new Map();
  for (const it of Array.isArray(lay.items) ? lay.items : []) {
    if (!it || !it.t || !finite(it.s) || !finite(it.e) || !Number.isInteger(it.row) || it.row < 0 || it.row >= rows) continue;
    if (!byRow.has(it.row)) byRow.set(it.row, []);
    byRow.get(it.row).push(it);
  }
  const rowLabel = lay.label || "Slot";
  for (let row = 0; row < rows; row++) {
    html += `<div class="tl-row"><div class="tl-lab">${esc(rowLabel)} ${row + 1}</div><div class="tl-track" style="width:${W}px">`;
    for (const it of byRow.get(row) || []) html += renderBar(it, run, sc, opts, key);
    html += `</div></div>`;
  }

  const overlays = Array.isArray(opts.overlays) ? opts.overlays : [];
  for (const ov of overlays) {
    if (!ov || typeof ov.render !== "function") continue;
    const out = ov.render(lay, run, { ...opts, scale: sc });
    if (out) html += `<div class="tl-overlay" data-overlay="${esc(ov.id || "")}" style="position:absolute;left:${lab}px;top:0;bottom:0;width:${W}px">${out}</div>`;
  }
  html += `</div></div>`;
  return html;
}

export function swimlaneNote(run, layout, clock) {
  const lay = layout || {};
  if (clock === "actual") {
    const started = Array.isArray(lay.items) ? lay.items.length : 0;
    return `${lay.rows || 0} agents in use · ${started} started${lay.unstarted ? ` · ${lay.unstarted} not started` : ""}${finite(lay.now) ? ` · now +${Math.round(lay.now)}h` : ""}`;
  }
  const tail =
    run.planSource === "schedule"
      ? " · as written in schedule.json"
      : run.kind !== "beam"
        ? ""
        : run.gateOrder === "deps"
          ? " · dependency order"
          : " · blocks finish in order";
  return `${run.slots || 0} of ${run.cap} slots · planned finish T+${Math.round(run.finish || 0)}h${tail}`;
}

const FOOT_PLAN =
  "<span>Estimate-hours on a continuous clock. A bar ends at its merge; the slot is reused at once. Bars are the plan; color is the ticket's status now.</span><span>Slots are interchangeable: the parent gives a ready ticket the next free agent.</span>";
const FOOT_ACTUAL =
  "<span>Hours since the run started. A bar runs from claim (or PR opened) to merge; an open ticket runs to now. Gate lines are drawn at greenAt.</span><span>Rows are agents in use at the same time, not agent ids.</span>";

export function renderSwimlanePanel(run, layout, opts = {}) {
  const lay = layout || {};
  const actual = opts.clock ? opts.clock === "actual" : lay.prefix === "+";
  const key = opts.runKey != null ? opts.runKey : runKeyOf(run);
  const title = opts.title || "Swimlane";
  const btn = (clock, label, tip) => {
    const on = (clock === "actual") === actual;
    return `<button type="button" data-clock="${clock}"${on ? ' class="on"' : ""} aria-pressed="${on}" title="${tip}">${label}</button>`;
  };
  return `<section class="panel swimlane" data-run="${esc(key)}">
    <div class="panel-h"><h2>${esc(title)}</h2><span class="muted">${esc(swimlaneNote(run, lay, actual ? "actual" : "plan"))}</span>
      <div class="seg clock" role="group" aria-label="Clock">${btn("plan", "Plan", "Estimate-hours: the plan, colored by status now")}${btn("actual", "Actual", "Hours since the run started, from claimed to merged")}</div></div>
    <div class="tl-scroll">${renderSwimlane(run, lay, opts)}</div>
    <div class="tl-foot">${actual ? FOOT_ACTUAL : FOOT_PLAN}</div></section>`;
}
