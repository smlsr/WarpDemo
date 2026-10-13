import { ACTIVE, TERMINAL, bucketOf, catOf, normStatus } from "../../core/status.mjs";
import { natCmp, num, parseTime } from "../../core/util.mjs";

const SIZE_HOURS = { S: 4, M: 7, L: 11, XL: 16 };
const DEFAULT_APPROVAL = 0.5;
const DEFAULT_CAP = 18;
const HOUR_MS = 3600000;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const zero = () => ({ done: 0, prog: 0, err: 0, todo: 0 });
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const sizeOf = (t) => {
  const s = typeof t.size === "string" ? t.size.trim().toUpperCase() : "";
  return own(SIZE_HOURS, s) ? s : null;
};

function facts(t) {
  const status = normStatus(t.status);
  const cat = t.cat || catOf(status);
  const size = sizeOf(t);
  const given = num(t.hours);
  const hasOwn = given != null && given > 0;
  const hours = hasOwn ? given : SIZE_HOURS[size || "M"];
  const fromTicket = t.hoursFrom != null ? t.hoursFrom === "ticket" : hasOwn;
  const autoMerge = typeof t.autoMerge === "boolean" ? t.autoMerge : size ? size === "S" || size === "M" : true;
  return {
    status,
    cat,
    bucket: bucketOf(cat),
    hours,
    fromTicket,
    autoMerge,
    minutes: num(t.minutes) || 0,
    tokens: num(t.tokens) || 0,
    cost: num(t.cost),
    size,
    critical: !!t.critical,
    agent: t.agent || null,
  };
}

const ticketsOf = (run) => (run && Array.isArray(run.tickets) ? run.tickets.filter(Boolean) : []);
const gatesOf = (run) => (run && Array.isArray(run.gates) ? run.gates.filter(Boolean) : []);
const approvalOf = (run) => num(run.estimate && run.estimate.approvalHours) || DEFAULT_APPROVAL;
const capOf = (run) => num(run.cap) || DEFAULT_CAP;

export function etaOf(run) {
  const given = run.metrics ? num(run.metrics.etaHours) : null;
  if (given != null) return given;
  const open = ticketsOf(run)
    .map(facts)
    .filter((f) => !TERMINAL.has(f.status));
  const crit = sum(open.filter((f) => f.critical).map((f) => f.hours));
  const parallel = sum(open.map((f) => f.hours)) / Math.max(1, Math.min(capOf(run), 8));
  return Math.round(Math.max(crit, parallel) * 10) / 10;
}

const ms = (v) => (typeof v === "string" ? parseTime(v) : num(v));

export function elapsedOf(run, now = Date.now()) {
  const start = ms(run.runStartedAt);
  if (start == null) return null;
  const end = ms(run.runEndedAt) ?? (run.runState === "running" ? now : ms(run.updated) ?? now);
  return Math.max(0, (end - start) / HOUR_MS);
}

export function computeMetrics(runs, now = Date.now()) {
  const list = Array.isArray(runs) ? runs.filter(Boolean) : [];
  const agent = zero();
  const human = zero();
  const count = zero();
  const share = zero();
  let estTotal = null;
  let sizeDerived = 0;
  let actualMin = 0;
  let tokens = 0;
  let cost = 0;
  let costSeen = false;
  let gatesTotal = 0;
  let gatesGreen = 0;
  let elapsed = null;
  let eta = null;
  let humanPlan = null;

  for (const run of list) {
    const approval = approvalOf(run);
    const tickets = ticketsOf(run);
    for (const t of tickets) {
      const f = facts(t);
      count[f.bucket]++;
      agent[f.bucket] += f.hours;
      if (!f.autoMerge) human[f.bucket] += approval;
      if (!f.fromTicket) sizeDerived++;
      actualMin += f.minutes;
      tokens += f.tokens;
      if (f.cost != null) {
        cost += f.cost;
        costSeen = true;
      }
    }
    for (const g of gatesOf(run).filter((x) => x.blocking)) {
      gatesTotal++;
      let b = "todo";
      if (g.status === "green") {
        b = "done";
        gatesGreen++;
      } else if (g.status === "red") b = "err";
      else if (tickets.some((t) => t.block === g.key && facts(t).cat !== "todo")) b = "prog";
      human[b] += approval;
    }
    const est = run.estimate;
    const rs = est ? num(est.elapsedHours) : null;
    if (rs != null) estTotal = Math.max(estTotal == null ? 0 : estTotal, rs);
    const hp = est ? num(est.humanHours) : null;
    if (hp != null) humanPlan = (humanPlan || 0) + hp;
    const el = elapsedOf(run, now);
    if (el != null) elapsed = Math.max(elapsed == null ? 0 : elapsed, el);
    const e = etaOf(run);
    if (e != null) eta = Math.max(eta == null ? 0 : eta, e);
  }

  const agentTotal = sum(Object.values(agent));
  for (const k of Object.keys(share)) share[k] = estTotal != null && agentTotal > 0 ? (estTotal * agent[k]) / agentTotal : null;

  const finish = Math.max(0, ...list.map((r) => num(r.finish) || 0)) || null;
  const assumptions = [
    ...new Set(list.flatMap((r) => (r.estimate && Array.isArray(r.estimate.assumptions) ? r.estimate.assumptions : []))),
  ];

  return {
    finish,
    assumptions,
    agent,
    human,
    count,
    share,
    estTotal,
    agentTotal,
    humanTotal: sum(Object.values(human)),
    ticketTotal: sum(Object.values(count)),
    humanPlan,
    sizeDerived,
    actualH: actualMin / 60,
    tokens,
    cost: costSeen ? cost : null,
    gatesTotal,
    gatesGreen,
    elapsed,
    eta,
  };
}

const SIZE_ORDER = ["S", "M", "L", "XL", "—"];

function group(tickets, keyOf) {
  const rows = new Map();
  for (const t of tickets) {
    const f = facts(t);
    const k = keyOf(f);
    const row = rows.get(k) || { key: k, n: 0, tokens: 0, minutes: 0 };
    row.n++;
    row.tokens += f.tokens;
    row.minutes += f.minutes;
    rows.set(k, row);
  }
  return [...rows.values()];
}

export function utilization(runs) {
  const list = Array.isArray(runs) ? runs.filter(Boolean) : [];
  const tickets = list.flatMap(ticketsOf);
  const all = tickets.map(facts);
  const cap = list.length ? sum(list.map(capOf)) : null;
  const active = all.filter((f) => ACTIVE.has(f.status)).length;
  const spentH = sum(all.map((f) => f.minutes)) / 60;
  const estimates = list.map((r) => (r.estimate ? num(r.estimate.agentHours) : null)).filter((x) => x != null);
  const estH = estimates.length ? sum(estimates) || null : null;
  const done = all.filter((f) => f.cat === "done").length;
  const bySize = group(tickets, (f) => f.size || "—").sort((a, b) => SIZE_ORDER.indexOf(a.key) - SIZE_ORDER.indexOf(b.key));
  const byAgent = group(tickets, (f) => f.agent || "unassigned").sort((a, b) => natCmp(a.key, b.key));
  return {
    active,
    cap,
    spentH,
    estH,
    tokens: sum(all.map((f) => f.tokens)),
    done,
    total: all.length,
    bySize,
    byAgent,
  };
}
