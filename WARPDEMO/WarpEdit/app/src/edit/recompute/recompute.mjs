// Live recompute (SPEC §10): every edit-store event rebuilds the runs from the working copy with WarpView's
// buildRuns and hands them to app.store.replaceRuns(runs, "edit"), so blocks, plan, legend, cards, utilization,
// swimlane, board and table follow. Tab, view, filters, sort, zoom and scroll stay where they were.
import { buildRuns, classify } from "../../../../../WarpView/app/src/load/parse/parse.mjs";
import { normStatus } from "../../../../../WarpView/app/src/core/status.mjs";
import { esc } from "../../../../../WarpView/app/src/core/util.mjs";

export const PENDING_EDITED = "pending (edited)";
export const EDIT_REASON = "edit";

const MERGED = new Set(["merged", "done", "skipped"]);
const SCROLLERS = "#view .tbl-wrap, #view .tl-scroll, #drawer .drawer-b";
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const instOf = (b) => (isObj(b.instance) ? b.instance.id : b.instance) || null;

function statusesOf(beam) {
  const out = new Map();
  const tickets = beam && beam.tickets;
  const rows = Array.isArray(tickets) ? tickets.map((t) => [t && t.id, t]) : Object.entries(isObj(tickets) ? tickets : {});
  for (const [id, t] of rows) if (id != null && isObj(t)) out.set(String(t.id || id), normStatus(t.status));
  return out;
}

const sameRun = (a, b) => isObj(a) && isObj(b) && (a.run || null) === (b.run || null) && instOf(a) === instOf(b);

// The loaded beam's doc is swapped for the working copy; every other doc (status.json, state.json, other runs)
// is read again as it was, so the rebuilt runs differ from the loaded ones only by the edits.
export function docsWith(docs, loaded, working, fallbackPath = "beam.json") {
  const list = Array.isArray(docs) ? docs.filter((d) => d && d.data != null) : [];
  let at = list.findIndex((d) => d.data === loaded || d.data === working);
  if (at < 0) at = list.findIndex((d) => classify(d.data) === "beam" && sameRun(d.data, working));
  if (at < 0) return { docs: [...list, { path: fallbackPath, data: working }], path: fallbackPath };
  const out = list.slice();
  out[at] = { ...list[at], data: working };
  return { docs: out, path: list[at].path };
}

// A gate Warp recorded green, with a member that was merged in `baseline` and is not merged now. Warp recomputes
// the gate on its next tick; until the edit is saved the gate reads "pending (edited)". Its recorded status is
// kept, so totals count it the way Warp still does (fixtures/expected/after-reset.metrics.json: gates 2/4 green).
export function markEditedGates(run, baseline) {
  if (!run || !Array.isArray(run.gates) || !Array.isArray(run.tickets)) return [];
  const before = statusesOf(baseline);
  const now = new Map(run.tickets.map((t) => [t.id, t.status]));
  const marked = [];
  for (const g of run.gates) {
    if (!g || g.status !== "green") continue;
    const ids = [...new Set([...(g.members || []), ...run.tickets.filter((t) => t.gate === g.key).map((t) => t.id)])];
    const left = ids.filter((id) => MERGED.has(before.get(id)) && now.has(id) && !MERGED.has(now.get(id)));
    if (!left.length) continue;
    const note = `${PENDING_EDITED}: ${left.join(", ")} no longer merged; Warp recomputes this gate on its next tick`;
    g.edited = PENDING_EDITED;
    g.editedTickets = left;
    g.evidence = g.evidence ? `${note} · was: ${g.evidence}` : note;
    marked.push({ key: g.key, name: g.name || "", tickets: left });
  }
  return marked;
}

// A ticket the editor moved shows the edited status: its state.json overlay (WarpView SPEC §3.3) was written
// before the edit and would otherwise put the old status back over a non-terminal reset target.
export function editedIds(loaded, working) {
  const a = statusesOf(loaded);
  const out = new Set();
  for (const [id, s] of statusesOf(working)) if (a.get(id) !== s) out.add(id);
  return out;
}

export function rebuild({ docs = [], loaded = null, working, baseline = loaded, embedded = null, path } = {}) {
  if (!isObj(working)) return [];
  const moved = isObj(loaded) ? editedIds(loaded, working) : new Set();
  const kept = moved.size
    ? (Array.isArray(docs) ? docs : []).filter((d) => !(d && classify(d.data) === "ticket" && moved.has(String(d.data.id))))
    : docs;
  const swapped = docsWith(kept, loaded, working, path);
  const runs = buildRuns(swapped.docs, embedded).runs;
  const edited = runs.find((r) => r.kind === "beam" && r.path === swapped.path) || runs.find((r) => r.kind === "beam" && r.name === (working.run || null));
  if (edited) markEditedGates(edited, baseline || loaded);
  return runs;
}

export function editedGates(runs) {
  const out = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    for (const g of (r && r.gates) || []) if (g && g.edited) out.push({ run: r, key: g.key, name: g.name || "", tickets: g.editedTickets || [] });
  }
  return out;
}

export function renderPendingGates(state) {
  const list = editedGates(state && (state.current || state.runs));
  if (!list.length) return "";
  return list
    .map(
      (g) =>
        `<span class="pill" data-recompute="gate" data-gate="${esc(g.key)}" title="${esc(`Warp recomputes ${g.key} on its next tick`)}">` +
        `${esc(g.key)} gate ${PENDING_EDITED} · ${esc(g.tickets.join(", "))} not merged</span>`,
    )
    .join("");
}

// View state that lives in the DOM rather than in app.store.state: scroll offsets and the focused row or header.
export function captureView(root) {
  const doc = root && (root.nodeType === 9 ? root : root.ownerDocument);
  if (!doc) return null;
  const win = doc.defaultView;
  const scroll = keyed(root).map(({ el, key }) => ({ key, top: el.scrollTop, left: el.scrollLeft }));
  const active = doc.activeElement;
  let focus = null;
  if (active && active !== doc.body && active.closest && active.closest("#view")) {
    if (active.dataset && active.dataset.sort) focus = `#view th[data-sort="${cssStr(active.dataset.sort)}"]`;
    else if (active.dataset && active.dataset.id != null)
      focus = `#view [data-id="${cssStr(active.dataset.id)}"][data-run="${cssStr(active.dataset.run || "")}"]`;
  }
  return { scroll, focus, x: win ? win.scrollX : 0, y: win ? win.scrollY : 0, active };
}

export function restoreView(root, saved) {
  if (!saved || !root) return;
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const els = new Map(keyed(root).map(({ el, key }) => [key, el]));
  for (const s of saved.scroll) {
    const el = els.get(s.key);
    if (!el) continue;
    if (el.scrollTop !== s.top) el.scrollTop = s.top;
    if (el.scrollLeft !== s.left) el.scrollLeft = s.left;
  }
  const win = doc && doc.defaultView;
  if (win && (win.scrollX !== saved.x || win.scrollY !== saved.y) && typeof win.scrollTo === "function") {
    try {
      win.scrollTo(saved.x, saved.y);
    } catch {
      /* no layout here */
    }
  }
  if (saved.focus && saved.active && !saved.active.isConnected) {
    const el = root.querySelector(saved.focus);
    if (el && typeof el.focus === "function") el.focus();
  }
}

// A scroller is the same one after a render when its class, its run panel and its place among those match.
function keyed(root) {
  const seen = new Map();
  return [...root.querySelectorAll(SCROLLERS)].map((el) => {
    const panel = el.closest("[data-run]");
    const base = `${el.className}|${panel ? panel.getAttribute("data-run") : ""}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return { el, key: `${base}|${n}` };
  });
}

const cssStr = (s) => String(s).replace(/["\\]/g, "\\$&");

export function createRecomputePlugin({ store = null, path } = {}) {
  let edit = null;
  let app = null;
  let baseline = null;
  let unsubscribe = null;

  function recompute() {
    if (!app || !app.store || !edit) return false;
    const S = app.store.state;
    if (!Array.isArray(S.runs) || !S.runs.length) return false;
    const root = app.root;
    const saved = captureView(root);
    const runs = rebuild({ docs: S.docs, loaded: edit.loaded, working: edit.working, baseline, embedded: S.embedded, path });
    if (!runs.length) return false;
    app.store.replaceRuns(runs, EDIT_REASON);
    const doc = root && (root.nodeType === 9 ? root : root.ownerDocument);
    // The drawer refills only on load, reload, recompute or plugin renders; an open one must show the edited ticket.
    if (doc && doc.body && doc.body.classList.contains("drawer-open") && typeof app.render === "function") app.render("plugin");
    restoreView(root, saved);
    return true;
  }

  function listen() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (!edit || typeof edit.subscribe !== "function") return;
    unsubscribe = edit.subscribe((e) => {
      if (e && e.reason === "saved") baseline = edit.working;
      recompute();
    });
  }

  function attach(next) {
    edit = next || null;
    baseline = edit ? edit.loaded : null;
    listen();
    if (edit && edit.working !== edit.loaded) recompute();
  }

  return {
    id: "recompute",
    attach,
    recompute,
    get store() {
      return edit;
    },
    headerActions: [{ id: "recompute", render: (state) => renderPendingGates(state) }],
    init(a) {
      app = a;
      if (!edit && store) attach(store);
      else if (edit) {
        listen();
        if (edit.working !== edit.loaded) recompute();
      }
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

export const recomputePlugin = createRecomputePlugin();
