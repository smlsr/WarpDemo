// Save (SPEC §9): serialize the working copy in the shape it was loaded, or refuse; copy the same edits as Warp commands.
import { classify } from "../../../../../WarpView/app/src/load/parse/parse.mjs";
import { validate } from "../validate/validate.mjs";

export const MESSAGES = {
  status: "Open beam.json to save edits",
  schedule: "schedule.json is the plan: open beam.json to save edits",
  unknown: "This file cannot be saved: open beam.json to save edits",
};

const BY = "warpedit";
const COMMAND = "python3 .cursor/plugins/warp/scripts/beam.py set --beam .warp/beam.json";

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function kindOf(loaded) {
  if (isObj(loaded) && loaded.kind === "warp-plan" && loaded.tickets != null && typeof loaded.tickets === "object") return "warp-plan";
  return classify(loaded);
}

function stamp(now) {
  const d = now instanceof Date ? now : now == null ? new Date() : new Date(now);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function ticketOf(tickets, id) {
  if (Array.isArray(tickets)) return tickets.find((t) => isObj(t) && String(t.id) === id) || null;
  return isObj(tickets) && has(tickets, id) && isObj(tickets[id]) ? tickets[id] : null;
}

function merge(raw, id, work, keys) {
  if (!work) return raw;
  const out = { ...raw };
  for (const k of keys) {
    if (!has(work, k)) continue;
    if (k === "resets" && !has(raw, k) && Array.isArray(work[k]) && work[k].length === 0) continue;
    out[k] = work[k];
  }
  return out;
}

function mergeTickets(loadedTickets, workingTickets, keys) {
  if (Array.isArray(loadedTickets)) {
    return loadedTickets.map((t) => (isObj(t) ? merge(t, String(t.id), ticketOf(workingTickets, String(t.id)), keys) : t));
  }
  const out = {};
  for (const id of Object.keys(loadedTickets)) {
    const raw = loadedTickets[id];
    out[id] = isObj(raw) ? merge(raw, id, ticketOf(workingTickets, id), keys) : raw;
  }
  return out;
}

function time(v) {
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

// A dependent blocked by a later reset moves status without a resets[] entry (SPEC §6), so validate's reset-log
// check flags it. That mismatch is explained when the ticket's last status event is a warpedit move to its
// current status made at or after the last reset.
function explainedByDependentBlock(ticket) {
  const resets = Array.isArray(ticket.resets) ? ticket.resets : [];
  const events = Array.isArray(ticket.events) ? ticket.events : [];
  const last = resets[resets.length - 1];
  let ev = null;
  for (let i = events.length - 1; i >= 0 && !ev; i--) if (isObj(events[i]) && events[i].type === "status") ev = events[i];
  if (!last || !ev || ev.by !== BY || ev.to !== ticket.status) return false;
  const evAt = time(ev.at);
  const resetAt = time(last.at);
  return evAt != null && resetAt != null && evAt >= resetAt;
}

function realErrors(work, errors) {
  return errors.filter((e) => {
    if (e.code !== "reset-log") return true;
    const t = ticketOf(work.tickets, String(e.ticket));
    return !(t && explainedByDependentBlock(t));
  });
}

function refusal(message, errors = []) {
  return { ok: false, message, errors };
}

function describeErrors(errors) {
  const first = errors[0].message;
  return errors.length === 1 ? `Fix 1 validation error before saving: ${first}` : `Fix ${errors.length} validation errors before saving: ${first}`;
}

// → {ok: true, kind, data, text} or {ok: false, message, errors}. `kind` is detected from `loaded` unless given.
export function serialize(loaded, working, kind, options = {}) {
  const k = kind || kindOf(loaded);
  if (k === "status") return refusal(MESSAGES.status);
  if (k === "schedule") return refusal(MESSAGES.schedule);
  if (k !== "beam" && k !== "warp-plan") return refusal(MESSAGES.unknown);
  const work = working == null ? loaded : working;
  const errors = realErrors(work, validate(work).errors);
  if (errors.length) return refusal(describeErrors(errors), errors);
  const at = stamp(options.now);
  let data;
  if (k === "beam") {
    data = { ...loaded, tickets: mergeTickets(loaded.tickets, work.tickets, ["status", "events", "resets", "alarm"]), editedAt: at, editedBy: BY };
  } else {
    data = { ...loaded, tickets: mergeTickets(loaded.tickets, work.tickets, ["status", "resets"]), exportedAt: at };
  }
  return { ok: true, kind: k, data, text: JSON.stringify(data, null, 1) + "\n" };
}

export function fileName(name) {
  const base = String(name == null ? "" : name).split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|:*?]/g, "").trim();
  return base || "beam.json";
}

function quote(s) {
  const v = String(s);
  return /^[A-Za-z0-9_.:@%+=,/-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`;
}

function line(id, status) {
  return `${COMMAND} --id ${quote(id)} --status ${quote(status)}`;
}

export function asCommands(changes) {
  const lines = [];
  for (const c of changes || []) {
    if (!c) continue;
    lines.push(line(c.ticket, c.to));
    for (const d of c.dependents || []) lines.push(line(d.id, d.to));
  }
  return lines;
}

export function download(name, text, env = globalThis) {
  const doc = env.document;
  const blob = new env.Blob([text], { type: "application/json" });
  const url = env.URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = fileName(name);
  a.rel = "noopener";
  doc.body.appendChild(a);
  try {
    a.click();
  } finally {
    doc.body.removeChild(a);
    const revoke = () => env.URL.revokeObjectURL(url);
    if (typeof env.setTimeout === "function") env.setTimeout(revoke, 1000);
    else revoke();
  }
  return a.download;
}
