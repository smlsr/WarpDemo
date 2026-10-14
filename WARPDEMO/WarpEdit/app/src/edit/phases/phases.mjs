import { catColor, catOf, statusText } from "../../../../../WarpView/app/src/core/status.mjs";

export const PHASES = Object.freeze([
  "queued",
  "claimed",
  "planning",
  "coding",
  "review",
  "fix",
  "awaiting_approval",
  "merging",
  "merged",
  "done",
  "blocked",
  "alarm",
  "skipped",
]);

const TERMINAL_FROM = new Set(["merged", "done", "skipped"]);
const TERMINAL_TARGETS = new Set(["merged", "done", "skipped"]);

export function targetsFrom(status) {
  const from = String(status == null ? "" : status);
  return PHASES.filter((p) => p !== from && !(TERMINAL_FROM.has(from) && TERMINAL_TARGETS.has(p)));
}

export function check(from, to, id) {
  const target = String(to == null ? "" : to);
  if (!PHASES.includes(target)) {
    return { result: "unknown", ok: false, message: `${target} is not a Warp phase` };
  }
  if (String(from == null ? "" : from) === target) {
    const who = id == null || id === "" ? "Ticket" : String(id);
    return { result: "same", ok: false, message: `${who} is already ${target}` };
  }
  return { result: "ok", ok: true, message: "" };
}

export function phaseOption(status) {
  return { value: status, label: statusText(status), color: catColor(catOf(status)) };
}

export function phaseOptions(status) {
  return targetsFrom(status).map(phaseOption);
}
