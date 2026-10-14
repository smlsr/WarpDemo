// Drawer section "Reset phase" (SPEC §7.1): phase menu, Reset button, dependents preview, reset log.
import { esc, parseTime, stamp } from "../../../../../WarpView/app/src/core/util.mjs";
import { statusText } from "../../../../../WarpView/app/src/core/status.mjs";
import { confirmReset } from "../confirm/confirm.mjs";
import { planDependents } from "../dependents/dependents.mjs";
import { targetsFrom } from "../phases/phases.mjs";
import { buildReset } from "../reset/reset.mjs";

export const SCHEDULE_LINE = "schedule.json is the plan: open beam.json to reset a phase";
export const DEFAULT_TARGET = "coding";

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function ticketIn(beam, id) {
  const tickets = beam && beam.tickets;
  if (Array.isArray(tickets)) return tickets.find((t) => isObj(t) && String(t.id) === String(id)) || null;
  return isObj(tickets) && has(tickets, id) && isObj(tickets[id]) ? tickets[id] : null;
}

function ticketRows(beam) {
  const tickets = beam && beam.tickets;
  if (Array.isArray(tickets)) return tickets.filter(isObj);
  return isObj(tickets) ? Object.entries(tickets).filter(([, v]) => isObj(v)).map(([id, v]) => ({ id, ...v })) : [];
}

function titleOf(t) {
  return t && (t.title || t.summary) ? String(t.title || t.summary) : undefined;
}

export function defaultTarget(status) {
  const targets = targetsFrom(status);
  return targets.includes(DEFAULT_TARGET) ? DEFAULT_TARGET : targets[0] || "";
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function previewText(plan) {
  const list = (ids) => ` (${ids.map(String).join(", ")})`;
  const parts = [];
  if (plan.blocked.length) parts.push(`Blocks ${plural(plan.blocked.length, "queued dependent", "queued dependents")}${list(plan.blocked)}`);
  if (plan.inFlight.length) parts.push(`${plan.inFlight.length} in flight on top${list(plan.inFlight)}`);
  if (plan.alreadyMerged.length) parts.push(`${plan.alreadyMerged.length} already merged on top${list(plan.alreadyMerged)}`);
  return parts.length ? parts.join(" · ") : "No other ticket is affected.";
}

// The file's resets come first, then this session's changes for the ticket; newest first when every time parses.
export function logEntries(edit, id, saved = new Set(), fallback = null) {
  const out = [];
  const from = edit && edit.loaded ? ticketIn(edit.loaded, id) : fallback;
  const filed = from && Array.isArray(from.resets) ? from.resets : [];
  for (const r of filed) if (isObj(r)) out.push({ from: r.from, to: r.to, at: r.at, note: r.note, unsaved: false });
  if (edit) {
    for (const c of edit.changes()) {
      if (c && c.ticket === id) out.push({ from: c.from, to: c.to, at: c.at, note: c.note, unsaved: !saved.has(c) });
    }
  }
  const times = out.map((e) => parseTime(e.at));
  if (out.length > 1 && times.every((x) => x != null)) {
    return out.map((e, i) => ({ e, i, t: times[i] })).sort((a, b) => b.t - a.t || b.i - a.i).map((x) => x.e);
  }
  return out.reverse();
}

function shortDate(at) {
  const ms = parseTime(at);
  return ms == null ? "" : new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

function logRow(e) {
  const ms = parseTime(e.at);
  const when = ms != null ? stamp(ms) : e.at ? String(e.at) : "";
  const text = [`${statusText(e.from)} → ${statusText(e.to)}`, when, e.note ? String(e.note) : ""].filter(Boolean).join(" · ");
  const lead = e.unsaved ? `<span class="u">unsaved</span>` : `<span>${esc(shortDate(e.at))}</span>`;
  return `${lead}<span>${esc(text)}</span>`;
}

export function renderLog(entries) {
  if (!entries.length) return `<div class="ed-empty">No resets yet</div>`;
  return `<div class="ed-log">${entries.map(logRow).join("")}</div>`;
}

export function renderPanel({ ticket, run, edit, saved, target } = {}) {
  if (run && run.kind === "schedule") {
    return `<div class="ed-sec" data-ed="reset-schedule"><p class="ed-note">${esc(SCHEDULE_LINE)}</p></div>`;
  }
  if (!edit || !ticket) return "";
  const work = ticketIn(edit.working, ticket.id);
  if (!work) return "";
  const status = work.status == null ? "" : String(work.status);
  const targets = targetsFrom(status);
  const to = targets.includes(target) ? target : defaultTarget(status);
  const plan = planFor(edit, ticket.id, status, to);
  const options = targets.map((p) => `<option value="${esc(p)}"${p === to ? " selected" : ""}>${esc(statusText(p))}</option>`).join("");
  return (
    `<div class="ed-sec" data-ed="reset" data-status="${esc(status)}"><h4>Reset phase</h4>` +
    `<div class="ed-row"><select aria-label="Reset to phase" data-ed="reset-to">${options}</select>` +
    `<button type="button" class="btn primary" data-ed="reset-go">Reset…</button></div>` +
    `<div class="ed-prev" data-ed="reset-prev">${esc(previewText(plan))}</div>` +
    `<h4 class="ed-logh">Reset log</h4>${renderLog(logEntries(edit, ticket.id, saved, ticket))}</div>`
  );
}

function planFor(edit, id, from, to) {
  return planDependents({ tickets: ticketRows(edit.working) }, id, from, to);
}

function detail(edit, id) {
  const t = ticketIn(edit.working, id);
  return { id, title: titleOf(t), status: t ? t.status : undefined };
}

export function createPanelPlugin({ store = null, confirm = confirmReset, now = () => Date.now() } = {}) {
  let edit = null;
  let app = null;
  let unsubscribe = null;
  let saved = new Set();
  let busy = false;
  const chosen = new Map();

  const refresh = () => {
    if (app && typeof app.render === "function") app.render("plugin");
  };

  function listen() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (!edit) return;
    unsubscribe = edit.subscribe((e) => {
      if (e && e.reason === "saved") saved = new Set(edit.changes());
      refresh();
    });
  }

  function attach(next) {
    edit = next || null;
    saved = new Set();
    chosen.clear();
    listen();
    refresh();
  }

  function target(ticket) {
    const work = edit && ticketIn(edit.working, ticket.id);
    const status = work ? String(work.status) : "";
    const want = chosen.get(ticket.id);
    return targetsFrom(status).includes(want) ? want : defaultTarget(status);
  }

  async function reset(ticket, to, doc) {
    if (!edit || busy) return;
    const work = ticketIn(edit.working, ticket.id);
    if (!work) return;
    const at = new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
    const built = buildReset(edit.working, ticket.id, to, "", at);
    if (!built.ok) {
      if (app && typeof app.toast === "function") app.toast(built.message, true);
      refresh();
      return;
    }
    const plan = planFor(edit, ticket.id, built.change.from, to);
    busy = true;
    let verdict;
    try {
      verdict = await confirm(
        {
          ticket: ticket.id,
          from: built.change.from,
          to,
          dependents: {
            blocked: plan.blocked.map((id) => detail(edit, id)),
            inFlight: plan.inFlight.map((id) => detail(edit, id)),
            alreadyMerged: plan.alreadyMerged.map((id) => detail(edit, id)),
          },
        },
        { document: doc },
      );
    } finally {
      busy = false;
    }
    if (!verdict || !verdict.ok) {
      refresh();
      return;
    }
    edit.apply({ ...built.change, note: verdict.note || "", dependents: plan.dependents });
  }

  const section = {
    id: "reset",
    render: (ticket, run) => renderPanel({ ticket, run, edit, saved, target: ticket ? chosen.get(ticket.id) : undefined }),
    bind(el, ctx) {
      const ticket = ctx && ctx.ticket;
      const select = el.querySelector('[data-ed="reset-to"]');
      const button = el.querySelector('[data-ed="reset-go"]');
      if (!ticket || !select || !button) return;
      select.addEventListener("change", () => {
        chosen.set(ticket.id, select.value);
        const work = ticketIn(edit.working, ticket.id);
        const prev = el.querySelector('[data-ed="reset-prev"]');
        if (prev && work) prev.textContent = previewText(planFor(edit, ticket.id, String(work.status), select.value));
      });
      button.addEventListener("click", () => reset(ticket, select.value || target(ticket), ctx.doc));
    },
  };

  return {
    id: "drawer-panel",
    attach,
    get store() {
      return edit;
    },
    drawerSections: [section],
    init(a) {
      app = a;
      if (!edit && store) attach(store);
      else listen();
      const destroy = a && a.destroy;
      if (a && typeof destroy === "function") {
        a.destroy = () => {
          if (unsubscribe) unsubscribe();
          unsubscribe = null;
          app = null;
          destroy();
        };
      }
    },
  };
}

export const panelPlugin = createPanelPlugin();
