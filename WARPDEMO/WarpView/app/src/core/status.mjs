const table = (o) => Object.freeze(Object.assign(Object.create(null), o));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const CATS = Object.freeze([
  Object.freeze({ key: "done", label: "Completed" }),
  Object.freeze({ key: "err", label: "Errored / Parked" }),
  Object.freeze({ key: "prog", label: "In Progress" }),
  Object.freeze({ key: "rev", label: "In Review" }),
  Object.freeze({ key: "qa", label: "QA Ready" }),
  Object.freeze({ key: "todo", label: "To Do" }),
]);

export const STATUS_CAT = table({
  queued: "todo",
  claimed: "prog",
  recovering: "prog",
  planning: "prog",
  coding: "prog",
  fix: "prog",
  review: "rev",
  bugbot_running: "rev",
  merging: "rev",
  awaiting_approval: "qa",
  merged: "done",
  done: "done",
  skipped: "done",
  blocked: "err",
  alarm: "err",
  parked: "err",
});

export const STATUS_ALIAS = table({
  in_progress: "coding",
  inprogress: "coding",
  in_review: "review",
  qa_ready: "awaiting_approval",
  qa: "awaiting_approval",
  to_do: "queued",
  todo: "queued",
  ready: "queued",
  completed: "done",
  complete: "done",
  errored: "alarm",
  error: "alarm",
  failed: "alarm",
  bugbot: "bugbot_running",
});

export const STATE_STATUS = table({
  started: "claimed",
  planning: "planning",
  coding: "coding",
  review: "review",
  bugbot: "bugbot_running",
  fix: "fix",
  "pr-opened": "review",
  "check-red": "fix",
  "check-green": "review",
  "lock-escape": "alarm",
  alarm: "alarm",
  failed: "alarm",
});

export const TERMINAL = new Set(["merged", "done", "skipped"]);

export const ACTIVE = new Set([
  "claimed",
  "recovering",
  "planning",
  "coding",
  "review",
  "bugbot_running",
  "fix",
  "awaiting_approval",
  "merging",
]);

export function normStatus(raw) {
  if (raw == null || raw === "") return "queued";
  const s = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "") return "queued";
  if (has(STATUS_CAT, s)) return s;
  return has(STATUS_ALIAS, s) ? STATUS_ALIAS[s] : s;
}

export function catOf(status) {
  return has(STATUS_CAT, status) ? STATUS_CAT[status] : "todo";
}

export function bucketOf(cat) {
  return cat === "rev" || cat === "qa" ? "prog" : cat;
}

export function catColor(cat) {
  return `var(--c-${cat})`;
}

export function statusText(status) {
  return String(status == null ? "" : status).replace(/_/g, " ");
}
