// Phase scrubber (SPEC §11): a time slider over the actual swimlane. Each bar takes the color of its phase at
// the chosen time, bars that start later hide, and every reset made by WarpEdit is marked on its bar.
// Registered through WarpView's swimlaneOverlays hook; on the plan clock it renders nothing.
import { esc, fmtH, num, parseTime, stamp } from "../../../../../WarpView/app/src/core/util.mjs";
import { ACTIVE, catColor, catOf, normStatus, statusText } from "../../../../../WarpView/app/src/core/status.mjs";
import { runKeyOf, swimlaneScale } from "../../../../../WarpView/app/src/view/swimlane/swimlane.mjs";

export const OVERLAY_ID = "scrubber";
export const STEP = 0.25;
export const LABEL = "Phase at";
export const BACK = "Back to now";
export const RESET_BY = "warpedit";

const H_MS = 3600000;
const CAT_CLASS = /\bc-(done|err|prog|rev|qa|todo)\b/;
const MARK_INSET = 6;
const finite = (v) => typeof v === "number" && isFinite(v);
const toMs = (v) => (typeof v === "number" ? (isFinite(v) ? v : null) : parseTime(v));

// Status events in time order; events at the same instant keep their file order.
export function statusEvents(ticket) {
  const evs = ticket && Array.isArray(ticket.events) ? ticket.events : [];
  return evs
    .map((e, i) => ({ e, i, at: e && e.type === "status" && e.to != null ? toMs(e.at) : null }))
    .filter((x) => x.at != null)
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ e, at }) => ({
      at,
      from: e.from == null ? null : normStatus(e.from),
      to: normStatus(e.to),
      by: e.by == null ? null : String(e.by),
      note: e.note == null ? "" : String(e.note),
    }));
}

export function claimOf(ticket) {
  if (!ticket) return null;
  return toMs(ticket.claimedAt) ?? toMs(ticket.pr && ticket.pr.openedAt);
}

// Replays status events up to `at` (ms or ISO). Before the first event the ticket is queued. A ticket without
// status events is queued before its claim and on its current status from then on; with no claim either,
// the files say nothing about its past, so it keeps its current status.
export function phaseAt(ticket, at) {
  if (!ticket) return "queued";
  const status = normStatus(ticket.status);
  const ms = toMs(at);
  if (ms == null) return status;
  const evs = statusEvents(ticket);
  if (!evs.length) {
    const claim = claimOf(ticket);
    return claim != null && ms < claim ? "queued" : status;
  }
  let phase = "queued";
  for (const e of evs) {
    if (e.at > ms) break;
    phase = e.to;
  }
  return phase;
}

const startedInto = (to) => ACTIVE.has(to) || to === "merged" || to === "done";

// The bar start of WarpView's layoutActual (SPEC §8), used only when the run has no runStartedAt.
function startMs(t) {
  const claim = claimOf(t);
  if (claim != null) return claim;
  if (catOf(normStatus(t.status)) === "todo") return null;
  const first = statusEvents(t).find((e) => startedInto(e.to));
  return first ? first.at : null;
}

// The instant +0 of the actual clock: runStartedAt, else the earliest bar start.
export function baseOf(run, layout) {
  const started = toMs(run && run.runStartedAt);
  if (started != null) return started;
  const starts = ((layout && layout.items) || []).map((it) => (it && it.t ? startMs(it.t) : null)).filter((x) => x != null);
  return starts.length ? Math.min(...starts) : null;
}

export function nowOf(layout) {
  const lay = layout || {};
  if (finite(lay.now)) return Math.max(0, lay.now);
  return Math.max(0, num(lay.span) ?? 0);
}

// The slider ends on the first step at or after the now line, so the now line is always reachable.
export function maxOf(now) {
  return Math.max(0, Math.ceil(now / STEP - 1e-6) * STEP);
}

export function snap(t, max) {
  const v = num(t);
  if (v == null) return null;
  return Math.min(max, Math.max(0, Math.round(v / STEP) * STEP));
}

export function isActual(layout, opts = {}) {
  return opts && opts.clock ? opts.clock === "actual" : !!layout && layout.prefix === "+";
}

const validItem = (it) => it && it.t && it.t.id != null && finite(it.s) && finite(it.e) && Number.isInteger(it.row) && it.row >= 0;

// Everything the overlay draws for hour `t` (null = the now line), without touching the DOM.
export function scrubFrame(layout, run, t = null) {
  const lay = layout || {};
  const now = nowOf(lay);
  const max = maxOf(now);
  const want = num(t);
  const atNow = want == null || want >= now;
  const h = atNow ? now : Math.max(0, want);
  const base = baseOf(run, lay);
  const at = base == null ? null : base + h * H_MS;
  const phase = (tk) => (atNow || at == null ? normStatus(tk.status) : phaseAt(tk, at));

  const phases = {};
  for (const tk of (run && Array.isArray(run.tickets) ? run.tickets : [])) if (tk && tk.id != null) phases[tk.id] = phase(tk);

  const bars = [];
  const marks = [];
  for (const it of Array.isArray(lay.items) ? lay.items : []) {
    if (!validItem(it)) continue;
    const p = phase(it.t);
    const cat = catOf(p);
    const hidden = !atNow && it.s > h + 1e-9;
    bars.push({ id: String(it.t.id), row: it.row, s: it.s, e: it.e, phase: p, cat, color: catColor(cat), hidden });
    if (base == null) continue;
    for (const ev of statusEvents(it.t)) {
      if (ev.by !== RESET_BY) continue;
      marks.push({ id: String(it.t.id), row: it.row, s: it.s, e: it.e, x: (ev.at - base) / H_MS, at: ev.at, from: ev.from, to: ev.to, note: ev.note, hidden });
    }
  }
  return { t: atNow ? null : h, h, now, max, atNow, at, base, phases, bars, marks };
}

export function labelOf(frame) {
  return `+${fmtH(frame.h, 2)} · ${stamp(frame.at)}`;
}

export function markTip(m) {
  return `${statusText(m.from || "queued")} → ${statusText(m.to)}${m.note ? " · " + m.note : ""}`;
}

// The marker sits on its bar at the reset time, held inside the bar (a reset after the bar ends lands on its end).
export function markLeft(m, pph) {
  const left = m.s * pph + 1;
  const w = Math.max(3, (m.e - m.s) * pph - 2);
  if (w < 2 * MARK_INSET) return left + w / 2;
  return Math.min(left + w - MARK_INSET, Math.max(left + MARK_INSET, m.x * pph));
}

const px = (v) => `${Math.round(v * 100) / 100}px`;

export function renderScrubber(layout, run, opts = {}, t = null) {
  if (!isActual(layout, opts)) return "";
  const f = scrubFrame(layout, run, t);
  const pph = num(opts.scale && opts.scale.pph) ?? swimlaneScale(layout, opts).pph;
  const value = f.atNow ? f.max : snap(f.h, f.max);
  const row =
    `<div class="ed-scrub" data-ed="scrub"><b>${esc(LABEL)}</b>` +
    `<input type="range" data-ed="scrub-t" aria-label="${esc(LABEL)}" min="0" max="${f.max}" step="${STEP}" value="${value}">` +
    `<span class="ed-scrub-at" data-ed="scrub-at">${esc(labelOf(f))}</span>` +
    `<button type="button" class="btn" data-ed="scrub-now"${f.atNow ? " disabled" : ""}>${esc(BACK)}</button></div>`;
  const line = `<i class="ed-scrubline" data-ed="scrub-line" style="left:${px(f.h * pph)}"${f.atNow ? " hidden" : ""}></i>`;
  const marks = f.marks
    .map((m) => {
      const tip = markTip(m);
      return (
        `<i class="ed-mark" data-ed="scrub-mark" data-id="${esc(m.id)}" role="img" aria-label="${esc(`Reset of ${m.id}: ${tip}`)}" title="${esc(tip)}" ` +
        `style="left:${px(markLeft(m, pph))};top:calc(var(--rowh, 46px) * ${m.row} + 1px)"${m.hidden ? " hidden" : ""}></i>`
      );
    })
    .join("");
  return row + line + marks;
}

// ---- binding: repaint the bars that WarpView drew, in place ---------------------------------------------

function paintBar(el, bar, atNow) {
  if (el.dataset.edC === undefined) {
    el.dataset.edC = el.style.getPropertyValue("--c");
    const m = CAT_CLASS.exec(el.className);
    el.dataset.edCat = m ? m[1] : "";
  }
  const cat = atNow ? el.dataset.edCat : bar.cat;
  if (cat) el.className = CAT_CLASS.test(el.className) ? el.className.replace(CAT_CLASS, "c-" + cat) : `${el.className} c-${cat}`;
  el.style.setProperty("--c", atNow ? el.dataset.edC : bar.color);
  el.style.display = !atNow && bar.hidden ? "none" : "";
  el.dataset.edPhase = bar.phase;
}

export function applyFrame(panel, overlay, frame, pph) {
  const byId = new Map(frame.bars.map((b) => [b.id, b]));
  for (const el of panel.querySelectorAll(".tl-body .bar[data-id]")) {
    const bar = byId.get(el.dataset.id);
    if (bar) paintBar(el, bar, frame.atNow);
  }
  if (overlay) {
    for (const el of overlay.querySelectorAll('[data-ed="scrub-mark"]')) {
      const bar = byId.get(el.dataset.id);
      el.hidden = !!(bar && bar.hidden && !frame.atNow);
    }
    const line = overlay.querySelector('[data-ed="scrub-line"]');
    if (line) {
      line.style.left = px(frame.h * pph);
      line.hidden = frame.atNow;
    }
  }
  const at = panel.querySelector('[data-ed="scrub-at"]');
  if (at) at.textContent = labelOf(frame);
  const back = panel.querySelector('[data-ed="scrub-now"]');
  if (back) back.disabled = frame.atNow;
}

export function createScrubberPlugin() {
  const times = new Map();
  const views = new Map();

  const keyOf = (run, opts) => String(opts && opts.runKey != null ? opts.runKey : runKeyOf(run));

  function set(key, t) {
    const view = views.get(key);
    const now = view ? nowOf(view.layout) : Infinity;
    const v = t == null ? null : snap(t, view ? maxOf(now) : Infinity);
    if (v == null || v >= now) times.delete(key);
    else times.set(key, v);
  }

  const overlay = {
    id: OVERLAY_ID,
    render(layout, run, opts = {}) {
      const key = keyOf(run, opts);
      if (!isActual(layout, opts)) {
        times.delete(key);
        views.delete(key);
        return "";
      }
      const pph = num(opts.scale && opts.scale.pph) ?? swimlaneScale(layout, opts).pph;
      views.set(key, { layout, run, pph });
      return renderScrubber(layout, run, { ...opts, scale: { pph } }, times.has(key) ? times.get(key) : null);
    },
    bind(el) {
      const panel = el && el.closest(".swimlane");
      const key = panel ? panel.dataset.run : null;
      const view = key != null ? views.get(key) : null;
      if (!panel || !view) return;
      const row = el.querySelector('[data-ed="scrub"]');
      const head = panel.querySelector(":scope > .panel-h");
      if (row && head) head.after(row);
      const frame = () => scrubFrame(view.layout, view.run, times.has(key) ? times.get(key) : null);
      const slider = row && row.querySelector('[data-ed="scrub-t"]');
      const back = row && row.querySelector('[data-ed="scrub-now"]');
      if (slider) {
        slider.addEventListener("input", () => {
          set(key, slider.value);
          applyFrame(panel, el, frame(), view.pph);
        });
      }
      if (back) {
        back.addEventListener("click", () => {
          set(key, null);
          const f = frame();
          if (slider) slider.value = String(f.max);
          applyFrame(panel, el, f, view.pph);
        });
      }
      applyFrame(panel, el, frame(), view.pph);
    },
  };

  return {
    id: "scrubber",
    swimlaneOverlays: [overlay],
    timeOf: (key) => (times.has(String(key)) ? times.get(String(key)) : null),
    setTime: set,
  };
}

export const scrubberPlugin = createScrubberPlugin();
