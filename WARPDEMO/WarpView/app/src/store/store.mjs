import { catOf } from "../core/status.mjs";
import { plan } from "../model/plan/plan.mjs";

export const runKey = (r) => (r && (r.name || r.instance || r.dir)) || "run";

export const initialState = () => ({
  docs: [],
  sources: [],
  embedded: null,
  loadedAt: null,
  runs: [],
  tab: "all",
  view: "timeline",
  groupBy: "block",
  colorBy: "status",
  zoom: 0,
  clock: "plan",
  sort: { key: "start", dir: 1 },
  off: new Set(),
  q: "",
  closed: new Set(),
  theme: null,
  printing: false,
});

export function prepareRun(run) {
  if (!run || typeof run !== "object") return run;
  if (!Array.isArray(run.tickets)) run.tickets = [];
  for (const t of run.tickets) if (t) t.cat = catOf(t.status);
  run.gateAt = null;
  plan(run);
  return run;
}

export function currentOf(state) {
  const runs = Array.isArray(state.runs) ? state.runs : [];
  if (state.tab == null || state.tab === "all") return runs;
  const hit = runs.filter((r) => runKey(r) === state.tab);
  return hit.length ? hit : runs;
}

export function createStore(init = {}) {
  const state = { ...initialState(), ...init };
  const subs = new Set();

  const emit = (reason) => {
    for (const fn of [...subs]) {
      try {
        fn(state, reason);
      } catch {
        /* one failing subscriber does not stop the others */
      }
    }
  };

  const fixTab = () => {
    if (state.tab !== "all" && !state.runs.some((r) => runKey(r) === state.tab)) state.tab = "all";
  };

  return {
    state,
    getRuns: () => state.runs,
    current: () => currentOf(state),
    findTicket(key, id) {
      const run = state.runs.find((r) => runKey(r) === key) || null;
      const ticket = run ? run.tickets.find((t) => t.id === id) || null : null;
      return { run, ticket };
    },
    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(patch, reason = "set") {
      Object.assign(state, patch || {});
      fixTab();
      emit(reason);
    },
    replaceRuns(runs, reason = "load") {
      state.runs = (Array.isArray(runs) ? runs : []).filter(Boolean).map(prepareRun);
      fixTab();
      emit(reason);
    },
    recompute(run) {
      const list = run ? [run] : state.runs;
      for (const r of list) prepareRun(r);
      emit("recompute");
    },
  };
}
