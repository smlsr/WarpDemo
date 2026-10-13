import { natCmp, num, parseTime } from "../../core/util.mjs";
import { STATE_STATUS, TERMINAL, catOf, normStatus } from "../../core/status.mjs";

export const SIZE_HOURS = Object.freeze({ S: 4, M: 7, L: 11, XL: 16 });
export const DEFAULT_APPROVAL = 0.5;
export const DEFAULT_CAP = 18;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const strs = (v) => list(v).map(String);

export const sizeOf = (raw) => {
  const m = /^(XL|S|M|L)\b/i.exec(String(raw == null ? "" : raw).trim());
  return m ? m[1].toUpperCase() : null;
};

export const dirOf = (p) => {
  const s = String(p == null ? "" : p);
  const i = s.lastIndexOf("/");
  return i < 0 ? "" : s.slice(0, i);
};

export function runDirOf(p) {
  const d = dirOf(p);
  const i = d.lastIndexOf("/tickets/");
  if (i >= 0) return d.slice(0, i);
  if (d.endsWith("/tickets") || d === "tickets") return dirOf(d);
  return d;
}

function isScheduleV2(data) {
  if (!Array.isArray(data.tickets)) return false;
  if (data.schema === "build-schedule/2") return true;
  const first = isObj(data.tickets[0]) ? data.tickets[0] : {};
  return "h" in first && "after" in first && "slot" in first && Array.isArray(data.critical_chain);
}

export function classify(data) {
  if (!isObj(data)) return null;
  if (isScheduleV2(data)) return "schedule";
  const hasTickets = data.tickets != null && typeof data.tickets === "object";
  if (hasTickets && (data.gates || data.program || data.runState || data.config || data.instance)) return "beam";
  if (Array.isArray(data.done) || Array.isArray(data.working) || Array.isArray(data.left)) return "status";
  if (typeof data.state === "string" && data.id && !data.tickets) return "ticket";
  if (hasTickets) return "beam";
  return null;
}

export function ticketRow(raw, id) {
  const t = isObj(raw) ? raw : {};
  const pr = isObj(t.pr) ? t.pr : t.pr ? { url: t.pr } : {};
  const jira = isObj(t.jira) ? t.jira : {};
  const usage = isObj(t.usage) ? t.usage : {};
  const status = normStatus(t.status);
  const size = sizeOf(t.size);
  const ownHours = num(t.hours);
  const fromTicket = ownHours != null && ownHours > 0;
  return {
    id: String(t.id || id),
    title: t.summary || t.title || "",
    size,
    status,
    cat: catOf(status),
    hours: fromTicket ? ownHours : SIZE_HOURS[size || "M"],
    hoursFrom: fromTicket ? "ticket" : size ? "size " + size : "default M",
    autoMerge: t.autoMerge === true ? true : t.autoMerge === false ? false : size ? size === "S" || size === "M" : true,
    deps: [].concat(list(t.deps), list(t.after)).map(String),
    locks: strs(t.locks),
    gate: t.gate || null,
    module: t.module || null,
    layer: t.layer || null,
    critical: !!t.critical,
    starred: !!t.starred,
    rank: num(t.rank),
    priority: t.priority || null,
    pr: {
      url: pr.url || null,
      ci: pr.ci || null,
      bugbot: pr.bugbot || null,
      sha: pr.sha || null,
      via: pr.via || null,
      openedAt: pr.openedAt || null,
      reviewedAt: pr.reviewedAt || null,
      approvedAt: pr.approvedAt || null,
      mergedAt: pr.mergedAt || null,
    },
    jiraKey: t.jiraKey || jira.key || null,
    jiraStatus: jira.status || null,
    jiraDone: !!(jira.doneAt || t.jiraDone),
    jiraCommentAt: jira.lastCommentAt || null,
    alarm: t.alarm || null,
    agent: t.agent || null,
    attempts: num(t.attempts) || 0,
    recoveries: num(t.recoveries) || 0,
    minutes: num(t.minutes) || 0,
    tokens: num(t.tokens) || 0,
    cost: num(usage.cost),
    claimedAt: t.claimedAt || null,
    updatedAt: t.updatedAt || null,
    events: Array.isArray(t.events) ? t.events : [],
    stateNote: null,
    lane: t.lane || null,
    repo: t.repo || null,
    wave: num(t.wave),
    priorityGate: t.priorityGate || t.priority_gate || null,
    checks: list(t.checks)
      .filter((c) => c != null)
      .map((c) => (isObj(c) ? { name: c.name || "", check: c.check || "" } : { name: "", check: String(c) })),
    planned: isObj(t.planned) ? { ...t.planned } : null,
  };
}

const checkText = (c) => (typeof c === "string" ? c : isObj(c) ? c.check || c.name || "" : "");

function gateRow(g, extra) {
  return {
    key: String(g.key),
    name: g.name || "",
    status: g.status || "pending",
    blocking: g.blocking !== false,
    members: strs(g.members),
    greenAt: parseTime(g.greenAt),
    evidence: g.evidence || null,
    checks: list(g.checks).map(checkText),
    ifRed: g.ifRed || g.if_red || null,
    scope: g.scope || null,
    onGreen: g.onGreen || g.on_green || null,
    priority: !!g.priority,
    starts: strs(g.starts),
    at: num(g.at),
    hold: g.hold || null,
    otherMembers: strs(g.otherMembers),
    ...extra,
  };
}

const gatesOf = (v) => list(v).filter(isObj);

export function runFromBeam(doc, path, modified) {
  const b = doc;
  const cfg = isObj(b.config) ? b.config : {};
  const program = isObj(b.program) ? b.program : {};
  const raw = Array.isArray(b.tickets)
    ? b.tickets.filter(isObj)
    : Object.entries(isObj(b.tickets) ? b.tickets : {})
        .filter(([, v]) => isObj(v))
        .map(([k, v]) => ({ id: k, ...v }));
  const tickets = raw.map((t) => ticketRow(t, t.id));
  const inst = isObj(b.instance) ? b.instance : b.instance ? { id: b.instance } : {};
  const est = isObj(program.estimate) ? program.estimate : isObj(b.estimate) ? b.estimate : null;
  const times = tickets.map((t) => parseTime(t.updatedAt)).filter(Boolean);
  const updated = Math.max(parseTime(b.checkpointAt) || 0, parseTime(b.exportedAt) || 0, ...times, 0) || modified || null;
  return {
    kind: "beam",
    export: b.kind === "warp-plan",
    exportedAt: parseTime(b.exportedAt),
    path,
    dir: dirOf(path),
    name: b.run || null,
    instance: inst.id || null,
    host: inst.host || null,
    runState: b.runState || null,
    paused: !!b.paused,
    pauseReason: b.pauseReason || null,
    range: b.range || null,
    owner: b.owner || null,
    gateOrder: b.gateOrder || cfg.gateOrder || program.gateOrder || "strict",
    startAfter: cfg.startAfter || null,
    schedule: isObj(program.schedule) ? program.schedule : null,
    gates: gatesOf(b.gates).map((g) => gateRow(g)),
    tickets,
    critical: strs(program.criticalPath || b.criticalPath),
    estimate: est,
    metrics: b.metrics || null,
    cap: num(cfg.maxAgents) || DEFAULT_CAP,
    jiraSite: cfg.jiraSite || "",
    project: cfg.projectName || cfg.jiraProject || null,
    runStartedAt: parseTime(b.runStartedAt),
    runEndedAt: parseTime(b.runEndedAt),
    updated,
    repo: null,
  };
}

export function runFromSchedule(doc, path, modified) {
  const d = doc;
  const model = isObj(d.model) ? d.model : {};
  const n = isObj(d.numbers) ? d.numbers : {};
  const repos = list(d.repos).map(String);
  const strict = String(model.gate_order || "").toLowerCase() === "strict";
  const tickets = list(d.tickets)
    .filter(isObj)
    .map((t) =>
      ticketRow(
        {
          ...t,
          hours: t.h != null ? t.h : t.hours,
          deps: [],
          after: t.after || [],
          gate: t.gate || null,
          status: t.status || "queued",
          priorityGate: t.priority_gate || null,
          planned: { slot: t.slot, start: t.start, merge: t.merge, ready: t.ready, latest_start: t.latest_start },
        },
        t.id,
      ),
    );
  return {
    kind: "schedule",
    export: false,
    exportedAt: null,
    path,
    dir: dirOf(path),
    name: d.program || null,
    instance: null,
    host: null,
    runState: "plan",
    paused: false,
    pauseReason: null,
    range: null,
    owner: null,
    gateOrder: strict ? "strict" : "deps",
    startAfter: null,
    schedule: {
      program: d.program,
      repos,
      lanes: list(d.lanes),
      finishHours: num(n.finish_h),
      agentHours: num(n.agent_hours),
      priority: model.priority || null,
      rebuilt: d.rebuilt || null,
    },
    gates: gatesOf(d.gates).map((g) => gateRow(g, { status: "pending", greenAt: null, evidence: null, hold: strict ? "green" : "red", otherMembers: [] })),
    tickets,
    critical: strs(d.critical_chain),
    estimate: {
      elapsedHours: num(n.finish_h),
      agentHours: num(n.agent_hours),
      approvalHours: DEFAULT_APPROVAL,
      assumptions: [model.clock, model.merge, model.priority].filter(Boolean),
    },
    metrics: null,
    cap: num(model.slots) || DEFAULT_CAP,
    jiraSite: "",
    project: d.program || null,
    runStartedAt: null,
    runEndedAt: null,
    updated: parseTime(d.rebuilt) || modified || null,
    repo: repos.join(" + ") || null,
  };
}

export function runFromStatus(doc, path, modified) {
  const s = doc;
  const rows = [].concat(list(s.done), list(s.working), list(s.left)).filter(isObj);
  const inst = isObj(s.instance) ? s.instance : s.instance ? { id: s.instance } : {};
  return {
    kind: "status",
    export: false,
    exportedAt: null,
    path,
    dir: dirOf(path),
    name: s.run || null,
    instance: inst.id || null,
    host: inst.host || null,
    runState: s.runState || null,
    paused: !!s.paused,
    pauseReason: null,
    range: null,
    owner: null,
    gateOrder: null,
    startAfter: null,
    schedule: null,
    gates: [],
    tickets: rows.map((r) =>
      ticketRow({ ...r, pr: { url: r.pr, ci: r.ci, bugbot: r.bugbot, sha: r.sha, via: r.via } }, r.id),
    ),
    critical: [],
    estimate: null,
    metrics: s.metrics || null,
    cap: DEFAULT_CAP,
    jiraSite: "",
    project: null,
    runStartedAt: null,
    runEndedAt: null,
    updated: parseTime(s.updatedAt) || modified || null,
    repo: null,
  };
}

const PR_URL = /^https?:\/\/[^/]+\/(.+?)\/(?:pull|pulls|merge_requests|-\/merge_requests|pull-requests)\//;

export function repoFrom(run) {
  for (const t of run.tickets) {
    const u = t.pr && t.pr.url;
    if (!u) continue;
    const m = PR_URL.exec(String(u));
    if (m) return m[1].replace(/\/-$/, "");
  }
  return null;
}

export function applyState(t, st) {
  if (!t || !isObj(st) || TERMINAL.has(t.status)) return false;
  const when = parseTime(st.updatedAt || st.heartbeatAt);
  if (when == null) return false;
  const was = parseTime(t.updatedAt);
  if (was != null && when <= was) return false;
  const to = own(STATE_STATUS, st.state) ? STATE_STATUS[st.state] : null;
  let moved = false;
  if (to && to !== t.status && t.status !== "parked") {
    t.stateNote = `state.json: ${st.state} (beam said ${t.status})`;
    t.status = to;
    t.cat = catOf(to);
    moved = true;
  }
  if (isObj(st.pr) && st.pr.url && !t.pr.url) {
    t.pr.url = st.pr.url;
    moved = true;
  }
  if (st.alarm && !t.alarm) {
    t.alarm = st.alarm;
    moved = true;
  }
  if (st.agent && !t.agent) t.agent = st.agent;
  t.updatedAt = st.updatedAt || st.heartbeatAt || t.updatedAt;
  return moved;
}

const runKey = (r) => (r.name ? "run:" + r.name : r.instance ? "inst:" + r.instance : "dir:" + r.dir);
const docDir = (d) => (typeof d.dir === "string" ? d.dir : dirOf(d.path));

export function buildRuns(docs, extra) {
  const runs = new Map();
  const statuses = [];
  const states = [];
  let skipped = 0;
  const keep = (key, r) => {
    const prev = runs.get(key);
    if (!prev || (r.updated || 0) > (prev.updated || 0)) runs.set(key, r);
  };

  for (const d of Array.isArray(docs) ? docs : []) {
    const data = d ? d.data : null;
    const kind = classify(data);
    if (kind === "beam") {
      const r = runFromBeam(data, d.path, d.modified);
      keep(runKey(r), r);
    } else if (kind === "schedule") {
      const r = runFromSchedule(data, d.path, d.modified);
      keep("sched:" + (r.name || r.dir), r);
    } else if (kind === "status") statuses.push(d);
    else if (kind === "ticket") states.push(d);
    else skipped++;
  }

  for (const d of statuses) {
    const s = d.data;
    const inst = isObj(s.instance) ? s.instance.id : s.instance;
    const dir = docDir(d);
    const match = [...runs.values()].find((r) => r.kind !== "schedule" && ((inst && r.instance === inst) || r.dir === dir));
    if (match) {
      const u = parseTime(s.updatedAt);
      if (u && u > (match.updated || 0)) match.updated = u;
      continue;
    }
    const r = runFromStatus(s, d.path, d.modified);
    keep(runKey(r), r);
  }

  let overlaid = 0;
  const when = (d) => parseTime(d.data.updatedAt || d.data.heartbeatAt) || 0;
  const ordered = states.map((d, i) => ({ d, i })).sort((a, b) => when(a.d) - when(b.d) || a.i - b.i);
  for (const { d } of ordered) {
    const st = d.data;
    const id = String(st.id);
    const rd = runDirOf(d.path);
    const all = [...runs.values()];
    const has = (r) => r.tickets.some((t) => t.id === id);
    const run = all.find((r) => r.dir === rd && has(r)) || all.find(has);
    if (!run) continue;
    if (applyState(run.tickets.find((t) => t.id === id), st)) overlaid++;
  }

  const out = [...runs.values()];
  const embedded = extra && extra.repo;
  for (const r of out) {
    if (r.kind !== "schedule") r.repo = embedded || repoFrom(r);
    if (extra && extra.jiraSite && !r.jiraSite) r.jiraSite = extra.jiraSite;
  }
  out.sort((a, b) => natCmp(a.name || a.instance || a.dir, b.name || b.instance || b.dir));
  return { runs: out, skipped, overlaid, states: states.length };
}
