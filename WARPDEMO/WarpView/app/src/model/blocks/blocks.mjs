const GATE_RE = /^G(\d+)$/i;
const TERMINAL = new Set(["merged", "done", "skipped"]);

const gnum = (k) => (GATE_RE.test(k) ? parseInt(k.slice(1), 10) : 1e6);

export function gateKeys(run) {
  const gates = (run.gates || []).filter((g) => g && g.key);
  const keys = gates.map((g) => String(g.key));
  if (gates.length && gates.every((g) => typeof g.at === "number" && isFinite(g.at))) {
    return gates
      .map((g, i) => ({ k: String(g.key), at: g.at, i }))
      .sort((a, b) => a.at - b.at || gnum(a.k) - gnum(b.k) || a.i - b.i)
      .map((x) => x.k);
  }
  const numbered = keys.filter((k) => GATE_RE.test(k)).sort((a, b) => gnum(a) - gnum(b));
  return numbered.concat(keys.filter((k) => !GATE_RE.test(k)));
}

export function assignBlocks(run) {
  const order = gateKeys(run);
  const tickets = run.tickets || [];
  const result = {};
  if (!order.length) {
    for (const t of tickets) {
      t.block = null;
      result[t.id] = null;
    }
    run.blockRank = new Map();
    return result;
  }
  const rank = new Map(order.map((k, i) => [k, i]));
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const members = new Map();
  for (const g of run.gates || []) {
    if (!g || !g.key) continue;
    const key = String(g.key);
    for (const raw of g.members || []) {
      const id = String(raw);
      const held = members.get(id);
      if (held == null || rank.get(key) < rank.get(held)) members.set(id, key);
    }
  }
  const found = new Map();
  const block = (id, seen) => {
    if (found.has(id)) return found.get(id);
    const t = byId.get(id) || {};
    let k;
    if (t.gate && rank.has(String(t.gate))) k = String(t.gate);
    else if (members.has(id)) k = members.get(id);
    else {
      k = order[0];
      const next = new Set(seen).add(id);
      for (const d of t.deps || []) {
        if (byId.has(d) && !seen.has(d) && d !== id) {
          const o = block(d, next);
          if (rank.get(o) > rank.get(k)) k = o;
        }
      }
    }
    found.set(id, k);
    return k;
  };
  for (const t of tickets) {
    t.block = block(t.id, new Set());
    result[t.id] = t.block;
  }
  run.blockRank = rank;
  return result;
}

export function blockStates(run) {
  const order = gateKeys(run);
  if (!order.length) return [];
  if (!run.blockRank || (run.tickets || []).some((t) => t.block === undefined)) assignBlocks(run);
  const gates = new Map((run.gates || []).filter((g) => g && g.key).map((g) => [String(g.key), g]));
  return order.map((key) => {
    const ts = (run.tickets || []).filter((t) => t.block === key);
    const ids = ts.map((t) => t.id).sort();
    const counts = { merged: 0, open: 0, parked: 0, queued: 0 };
    let minutes = 0;
    let tokens = 0;
    let cost = 0;
    for (const t of ts) {
      const s = t.status;
      if (TERMINAL.has(s)) counts.merged++;
      else if (s === "parked") counts.parked++;
      else if (s == null || s === "queued" || s === "blocked") counts.queued++;
      else counts.open++;
      minutes += Number(t.minutes) || 0;
      tokens += Number(t.tokens) || 0;
      cost += Number(t.cost) || 0;
    }
    const gate = gates.get(key) || {};
    return {
      key,
      tickets: ids,
      total: ids.length,
      ...counts,
      gate: gate.status || "pending",
      cleared: counts.merged === ids.length && gate.status !== "red",
      minutes,
      tokens,
      cost: Math.round(cost * 100) / 100,
    };
  });
}
