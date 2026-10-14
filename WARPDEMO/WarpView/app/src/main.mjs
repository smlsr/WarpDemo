import { esc, parseTime, stamp } from "./core/util.mjs";
import { buildRuns } from "./load/parse/parse.mjs";
import {
  createAutoReload,
  embeddedDocs,
  openFiles,
  openFolder,
  readSources,
  reload as rereadSources,
  sourcesFromDrop,
} from "./load/sources/sources.mjs";
import { computeMetrics, utilization } from "./model/metrics/metrics.mjs";
import { layoutActual, layoutPlan } from "./model/plan/plan.mjs";
import { createStore, currentOf, runKey } from "./store/store.mjs";
import { renderBoard, setLaneClosed } from "./view/board/board.mjs";
import {
  createPrefs,
  keyAction,
  loadControls,
  matches,
  onlyCat,
  renderLegend,
  renderViewSeg,
  setColorBy,
  setGroupBy,
  setQuery,
  setZoom,
  switchView,
  toggleCat,
  toggleTheme,
  visibleControls,
} from "./view/controls/controls.mjs";
import { renderDrawer, renderTooltip } from "./view/drawer/drawer.mjs";
import { renderHeader, runLabel } from "./view/header/header.mjs";
import { PRINT_W, renderSwimlanePanel } from "./view/swimlane/swimlane.mjs";
import { nextSort, renderTable } from "./view/table/table.mjs";

const LOGO =
  '<svg width="54" height="54" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="12" fill="#0E1719"/><path d="M14 12v40M24 12v40M40 12v40M50 12v40" stroke="#43B3AD" stroke-width="3"/><path d="M14 20h36M14 32h36M14 44h36" stroke="#F7FAFA" stroke-width="2.4" opacity=".85"/></svg>';

export const HOOKS = Object.freeze(["drawerSections", "headerActions", "swimlaneOverlays", "keys"]);
export const TOAST_MS = 4000;
const RESIZE_MS = 120;
const VIEW_ONLY = new Set(["zoom", "clock", "sort", "print", "resize"]);
const DRAWER_REFRESH = new Set(["load", "reload", "recompute", "plugin"]);
const TYPING = /^(input|select|textarea)$/i;

const apps = new WeakMap();

export function renderEmpty() {
  return `${LOGO}
    <h2>Open a Warp run</h2>
    <p>Open <code>.warp/beam.json</code>, or <code>status.json</code>, or the whole <code>.warp</code> folder. Ticket <code>state.json</code> files are read too. A named run's <code>.warp/runs/&lt;name&gt;/</code> works the same way, and several runs open side by side.</p>
    <p>You can also drop files or a folder anywhere on this page. Nothing is uploaded: the files are read in this browser.</p>
    <div class="row">
      <button class="btn primary" data-act="open-files">Open status files…</button>
      <button class="btn" data-act="open-folder">Open .warp folder…</button>
    </div>`;
}

// JSON.parse messages quote the file's text, which must never reach a log line or a toast.
const reasonOf = (e) => {
  const m = String(e && e.message ? e.message : e == null ? "" : e);
  return /JSON|Unexpected token|position \d+/i.test(m) ? "not valid JSON" : m;
};

function embeddedPayload(doc) {
  const el = doc.getElementById("warp-data");
  if (!el) return null;
  try {
    const p = JSON.parse(el.textContent || "null");
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

export function collectHooks(plugins) {
  const hooks = { drawerSections: [], headerActions: [], swimlaneOverlays: [], keys: [] };
  for (const p of Array.isArray(plugins) ? plugins : []) {
    if (!p || typeof p !== "object") continue;
    for (const h of HOOKS) if (Array.isArray(p[h])) hooks[h].push(...p[h].filter(Boolean));
  }
  return hooks;
}

export function createApp({ root = typeof document !== "undefined" ? document : null, plugins = [], now = () => Date.now() } = {}) {
  const doc = root && root.nodeType === 9 ? root : root && root.ownerDocument;
  if (!doc || !doc.defaultView) throw new Error("createApp needs a document or an element in one");
  const win = doc.defaultView;
  const prev = apps.get(doc);
  if (prev) prev.destroy();

  const $ = (s) => root.querySelector(s);
  const prefs = createPrefs(() => win.localStorage);
  const ctl = loadControls(prefs);
  const store = createStore({
    view: ctl.view,
    groupBy: ctl.groupBy,
    colorBy: ctl.colorBy,
    zoom: ctl.zoom,
    theme: ctl.theme,
    clock: prefs.get("clock") === "actual" ? "actual" : "plan",
  });
  const S = store.state;
  const hooks = collectHooks(plugins);
  const ui = { drawer: null, opener: null, utilWasOpen: false, noStore: false, dragDepth: 0, resizeT: null, listeners: [] };
  const plugList = Array.isArray(plugins) ? plugins.filter(Boolean) : [];

  const on = (target, type, fn, opts) => {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    ui.listeners.push([target, type, fn, opts]);
  };
  const media = (q) => {
    try {
      return typeof win.matchMedia === "function" && !!win.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const show = (el, visible) => {
    if (!el) return;
    el.classList.toggle("hidden", !visible);
    el.hidden = !visible;
  };
  const setHtml = (sel, html) => {
    const el = $(sel);
    if (el) el.innerHTML = html;
    return el;
  };
  const match = (t, run) => matches(t, run, S);

  function toast(msg, err = false) {
    const host = $("#toasts");
    if (!host) return;
    const el = doc.createElement("div");
    el.className = "toast" + (err ? " err" : "");
    el.setAttribute("role", err ? "alert" : "status");
    el.textContent = String(msg);
    host.appendChild(el);
    win.setTimeout(() => el.remove(), TOAST_MS);
  }

  const ctx = (extra = {}) => ({
    app,
    store,
    state: S,
    root,
    doc,
    win,
    render: () => render("plugin"),
    toast,
    openDrawer,
    closeDrawer,
    ...extra,
  });

  const safe = (fn, fallback = "") => {
    try {
      return fn();
    } catch (e) {
      win.console.error("plugin.failed", { reason: reasonOf(e) });
      return fallback;
    }
  };

  // ---- rendering -------------------------------------------------------------------------------

  function renderSwimlanes(runs, view) {
    const wide = view.clientWidth || (doc.documentElement.clientWidth || 0) - 40;
    const narrow = media("(max-width:640px)");
    const many = runs.length > 1;
    const t = now();
    const overlays = hooks.swimlaneOverlays.map((ov) => ({
      id: ov.id,
      render: (lay, run, opts) => (typeof ov.render === "function" ? safe(() => ov.render(lay, run, opts)) : ""),
    }));
    return runs
      .map((run) => {
        const lay = S.clock === "actual" ? layoutActual(run, t) : layoutPlan(run);
        return renderSwimlanePanel(run, lay, {
          width: wide,
          zoom: S.zoom,
          narrow,
          print: S.printing,
          printWidth: PRINT_W,
          off: S.off,
          query: S.q,
          matches: match,
          colorBy: S.colorBy,
          overlays,
          runKey: runKey(run),
          title: many ? runLabel(run) : "Swimlane",
          clock: S.clock,
        });
      })
      .join("");
  }

  function bindOverlays(view) {
    for (const el of view.querySelectorAll("[data-overlay]")) {
      const panel = el.closest(".swimlane");
      const run = panel ? S.runs.find((r) => runKey(r) === panel.dataset.run) || null : null;
      for (const ov of hooks.swimlaneOverlays) {
        if (ov.id === el.dataset.overlay && typeof ov.bind === "function") safe(() => ov.bind(el, ctx({ run })));
      }
    }
  }

  function renderView() {
    const view = $("#view");
    if (!view) return;
    const runs = currentOf(S);
    if (!runs.length) view.innerHTML = "";
    else if (S.view === "table") view.innerHTML = renderTable(runs, S.sort, match);
    else if (S.view === "board")
      view.innerHTML = renderBoard({ runs, groupBy: S.groupBy, colorBy: S.colorBy, off: S.off, q: S.q, closed: S.closed });
    else view.innerHTML = renderSwimlanes(runs, view);
    bindOverlays(view);
  }

  function renderControls() {
    setHtml("#viewSeg", renderViewSeg(S));
    const vis = visibleControls(S);
    show($("#groupCtl"), vis.groupBy);
    show($("#zoomCtl"), vis.zoom);
    show($("#colorCtl"), vis.colorBy);
    const g = $("#groupBy");
    if (g) g.value = S.groupBy;
    const c = $("#colorBy");
    if (c) c.value = S.colorBy;
    const z = $("#zoom");
    if (z) z.value = String(S.zoom);
    const a = $("#autoRefresh");
    if (a) a.checked = !!(auto && auto.enabled);
  }

  function renderActionsBar(html) {
    const bar = $("#actionsBar");
    if (!bar) return;
    bar.innerHTML = html;
    show(bar, !!html);
    for (const el of bar.querySelectorAll("[data-hook]")) {
      for (const a of hooks.headerActions) {
        if (a.id === el.dataset.hook && typeof a.bind === "function") safe(() => a.bind(el, ctx()));
      }
    }
  }

  function renderFoot() {
    const files = S.docs.length;
    const src = $("#sources");
    if (src) {
      const paths = S.docs.slice(0, 4).map((d) => d.path).join(", ");
      src.textContent = `${files} file${files === 1 ? "" : "s"} read${S.embedded && !S.sources.length ? " (embedded by /warp-dashboard)" : ""}${paths ? " · " + paths : ""}${files > 4 ? ", …" : ""}`;
    }
    const gen = $("#generated");
    if (gen) {
      const written = S.embedded && !S.sources.length && S.embedded.generatedAt != null;
      gen.textContent = written
        ? "Written by /warp-dashboard " + stamp(S.embedded.generatedAt)
        : S.loadedAt != null
          ? "Loaded " + stamp(S.loadedAt)
          : "";
    }
  }

  function render(reason = "render") {
    if (reason === "theme") return;
    const has = S.runs.length > 0;
    if (VIEW_ONLY.has(reason) && has) {
      renderControls();
      renderView();
      return;
    }
    show($("#emptyState"), !has);
    show($("#app"), has);
    const rb = $("#reloadBtn");
    if (rb) rb.disabled = !(S.sources.length || S.embedded);
    const t = now();
    const cur = currentOf(S);
    const head = renderHeader({
      runs: S.runs,
      tab: S.tab,
      metrics: has ? computeMetrics(cur, t) : null,
      util: has ? utilization(cur) : null,
      actions: hooks.headerActions,
      now: t,
    });
    setHtml("#meta", head.meta);
    renderActionsBar(head.actions);
    if (!has) {
      setHtml("#view", "");
      closeDrawer();
      return;
    }
    setHtml("#title", head.title);
    setHtml("#subline", head.subline);
    setHtml("#chainline", head.chain);
    setHtml("#tabs", head.tabs);
    setHtml("#metrics", head.metrics);
    setHtml("#util", head.util);
    setHtml("#legend", renderLegend(cur, S));
    renderControls();
    renderView();
    renderFoot();
    if (ui.drawer && DRAWER_REFRESH.has(reason)) refreshDrawer();
  }

  // ---- drawer and tooltip ----------------------------------------------------------------------

  const drawerSections = () =>
    hooks.drawerSections.map((s) => ({
      id: s.id,
      render: (t, run) => {
        if (typeof s.render !== "function") return "";
        const html = s.render(t, run);
        return typeof html === "string" && html ? `<section class="dsec" data-hook="${esc(s.id)}">${html}</section>` : "";
      },
    }));

  function fillDrawer(ticket, run) {
    const dr = $("#drawer");
    if (!dr) return null;
    dr.innerHTML = renderDrawer(ticket, run, drawerSections(), now());
    for (const el of dr.querySelectorAll(".dsec[data-hook]")) {
      for (const s of hooks.drawerSections) {
        if (s.id === el.dataset.hook && typeof s.bind === "function") safe(() => s.bind(el, ctx({ run, ticket })));
      }
    }
    return dr;
  }

  function openDrawer(key, id) {
    const { run, ticket } = store.findTicket(key, id);
    if (!ticket) return false;
    const dr = fillDrawer(ticket, run);
    if (!dr) return false;
    ui.drawer = { key, id };
    hideTip();
    doc.body.classList.add("drawer-open");
    dr.setAttribute("aria-hidden", "false");
    const x = dr.querySelector("#drawerClose");
    if (x) x.focus();
    return true;
  }

  function refreshDrawer() {
    const { run, ticket } = store.findTicket(ui.drawer.key, ui.drawer.id);
    if (ticket) fillDrawer(ticket, run);
    else closeDrawer();
  }

  function closeDrawer() {
    const was = !!ui.drawer;
    ui.drawer = null;
    doc.body.classList.remove("drawer-open");
    const dr = $("#drawer");
    if (dr) dr.setAttribute("aria-hidden", "true");
    const back = ui.opener;
    ui.opener = null;
    if (was && back && back.isConnected && typeof back.focus === "function") back.focus();
  }

  function hideTip() {
    const tip = $("#tip");
    if (tip) tip.style.display = "none";
  }

  function showTip(e, el) {
    const tip = $("#tip");
    const { ticket } = store.findTicket(el.dataset.run, el.dataset.id);
    if (!tip || !ticket) return;
    tip.innerHTML = renderTooltip(ticket);
    tip.style.display = "block";
    const w = tip.offsetWidth || 0;
    const h = tip.offsetHeight || 0;
    const x = Math.min(e.clientX + 14, (win.innerWidth || 0) - w - 8);
    const y = e.clientY + 16 + h > (win.innerHeight || 0) ? e.clientY - h - 10 : e.clientY + 16;
    tip.style.left = Math.max(0, x) + "px";
    tip.style.top = Math.max(0, y) + "px";
  }

  // ---- loading ---------------------------------------------------------------------------------

  function logErrors(errors) {
    for (const e of errors || []) win.console.error("load.failed", { path: e.path, reason: reasonOf(e.error) });
  }

  function loadDocs(docs, { sources = [], errors = [], quiet = false, reason = "load", embedded = null } = {}) {
    let built;
    try {
      built = buildRuns(docs, embedded);
    } catch (e) {
      toast("Could not read: " + reasonOf(e), true);
      return false;
    }
    if (!built.runs.length) {
      toast(
        docs.length
          ? "No beam.json, status.json or schedule.json in what was opened."
          : "Nothing could be read." + (errors[0] ? " " + reasonOf(errors[0].error) : ""),
        true,
      );
      return false;
    }
    S.docs = docs;
    S.sources = sources;
    S.embedded = embedded;
    S.loadedAt = now();
    store.replaceRuns(built.runs, reason);
    if (!quiet) {
      const n = built.runs.length;
      const bits = [`${n} run${n === 1 ? "" : "s"}`, `${S.runs.reduce((a, r) => a + r.tickets.length, 0)} tickets`];
      if (built.states) bits.push(`${built.states} ticket states (${built.overlaid} newer than the beam)`);
      if (errors.length) bits.push(`${errors.length} unreadable`);
      if (built.skipped) bits.push(`${built.skipped} skipped`);
      toast("Loaded " + bits.join(", "));
    }
    return true;
  }

  async function loadSources(sources, opts = {}) {
    const { docs, errors } = await readSources(sources);
    logErrors(errors);
    return loadDocs(docs, { ...opts, sources, errors });
  }

  async function pick(open) {
    let sources;
    try {
      sources = await open({ win, doc });
    } catch (e) {
      toast("Could not open: " + reasonOf(e), true);
      return false;
    }
    if (!sources || !sources.length) return false;
    return loadSources(sources);
  }

  async function reload({ quiet = false } = {}) {
    if (!S.sources.length && !S.embedded) {
      if (!quiet) toast("Nothing to reload. Open files first.");
      return false;
    }
    let r;
    try {
      r = await rereadSources({ win, doc, sources: S.sources });
    } catch (e) {
      toast("Could not reload: " + reasonOf(e), true);
      return false;
    }
    if (r.mode === "page") return true;
    if (r.mode === "none") {
      if (!quiet) toast(r.message);
      return false;
    }
    logErrors(r.errors);
    const ok = r.docs.length
      ? loadDocs(r.docs, { sources: S.sources, errors: r.errors, quiet: true, reason: "reload", embedded: S.embedded })
      : false;
    if (r.message) toast(r.message, true);
    else if (ok && !quiet) toast("Reloaded");
    return ok;
  }

  // ---- actions ---------------------------------------------------------------------------------

  const auto = createAutoReload({ win, doc, onTick: () => (S.runs.length ? reload({ quiet: true }) : null) });

  function print() {
    try {
      if (typeof win.print === "function") win.print();
    } catch {
      /* printing is not offered here */
    }
  }

  const applyTheme = (theme) => {
    const el = doc.documentElement;
    if (theme) el.setAttribute("data-theme", theme);
    else el.removeAttribute("data-theme");
  };

  function setMenu(open) {
    const m = $("#fileMenu");
    if (!m) return;
    m.classList.toggle("open", open);
    const b = $("#fileBtn");
    if (b) b.setAttribute("aria-expanded", String(open));
  }
  const menuOpen = () => {
    const m = $("#fileMenu");
    return !!m && m.classList.contains("open");
  };

  function act(name) {
    setMenu(false);
    if (name === "open-files") return pick(openFiles);
    if (name === "open-folder") return pick(openFolder);
    if (name === "reload") return reload();
    if (name === "auto-reload") {
      auto.toggle();
      return renderControls();
    }
    if (name === "print") return print();
    if (name === "clear") {
      closeDrawer();
      store.set({ runs: [], docs: [], sources: [], embedded: null, tab: "all", loadedAt: null }, "clear");
    }
    return null;
  }

  function toggleLane(head) {
    const lane = head.closest(".lane");
    if (!lane) return;
    const closed = lane.classList.toggle("closed");
    S.closed = setLaneClosed(S.closed, lane.dataset.lane, closed);
    head.setAttribute("aria-expanded", String(!closed));
  }

  const inside = (t) => !!t && (root === doc || root.contains(t));
  const elOf = (e) => (e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement) || null;

  on(doc, "click", (e) => {
    const t = elOf(e);
    if (!inside(t)) return;
    const a = t.closest("[data-act]");
    if (a && !t.closest("#drawer, #actionsBar")) {
      act(a.dataset.act);
      return;
    }
    if (t.closest("#fileBtn")) {
      setMenu(!menuOpen());
      return;
    }
    if (!t.closest("#fileMenu")) setMenu(false);
    if (t.closest("#drawerClose, #scrim")) return closeDrawer();
    if (t.closest("#reloadBtn")) return void reload();
    if (t.closest("#printBtn")) return print();
    if (t.closest("#themeBtn")) {
      const theme = toggleTheme(S, prefs, media("(prefers-color-scheme: dark)")).theme;
      applyTheme(theme);
      return store.set({ theme }, "theme");
    }
    const chip = t.closest("#legend .fchip[data-cat]");
    if (chip) return store.set({ off: toggleCat(S, chip.dataset.cat).off }, "filter");
    const tab = t.closest("#tabs [data-tab]");
    if (tab) return store.set({ tab: tab.dataset.tab }, "tab");
    const clock = t.closest("#view [data-clock]");
    if (clock) {
      const c = clock.dataset.clock === "actual" ? "actual" : "plan";
      prefs.set("clock", c);
      return store.set({ clock: c }, "clock");
    }
    const th = t.closest("#view th[data-sort]");
    if (th) {
      const key = th.dataset.sort;
      const refocus = doc.activeElement === th;
      store.set({ sort: nextSort(S.sort, key) }, "sort");
      const again = refocus ? $(`#view th[data-sort="${key}"]`) : null;
      if (again) again.focus();
      return;
    }
    const v = t.closest("#viewSeg [data-view]");
    if (v) return store.set({ view: switchView(S, v.dataset.view, prefs).view }, "view");
    const lh = t.closest("#view .lane-h");
    if (lh) return toggleLane(lh);
    const tk = t.closest("#view .bar, #view .tcard, #view .trow");
    if (tk && !t.closest("a")) {
      ui.opener = tk;
      openDrawer(tk.dataset.run, tk.dataset.id);
    }
  });

  on(doc, "dblclick", (e) => {
    const t = elOf(e);
    if (!inside(t)) return;
    const chip = t.closest("#legend .fchip[data-cat]");
    if (chip) store.set({ off: onlyCat(S, chip.dataset.cat).off }, "filter");
  });

  on(doc, "keydown", (e) => {
    const t = elOf(e) || doc.body;
    if (!inside(t)) return;
    const typing = TYPING.test(t.tagName || "") || t.isContentEditable;
    if (!typing) {
      const ctrl = e.ctrlKey || e.metaKey;
      for (const k of hooks.keys) {
        if (!k || typeof k.run !== "function" || k.key !== e.key) continue;
        if (!!k.ctrl !== ctrl || (k.shift != null && !!k.shift !== e.shiftKey)) continue;
        e.preventDefault();
        safe(() => k.run(e, ctx()));
        return;
      }
    }
    let action = keyAction(e);
    if (!action && (e.key === "Enter" || e.key === " ") && t.matches("#view .bar")) action = "activate";
    if (!action) return;
    if (action === "escape") {
      setMenu(false);
      hideTip();
      if (ui.drawer) closeDrawer();
      return;
    }
    e.preventDefault();
    if (action === "activate") t.click();
    else if (action === "focus-search") {
      const q = $("#q");
      if (q) q.focus();
    } else act(action);
  });

  on(doc, "input", (e) => {
    const t = elOf(e);
    if (!inside(t)) return;
    if (t.id === "q") store.set({ q: setQuery(S, t.value).q }, "filter");
    else if (t.id === "zoom") store.set({ zoom: setZoom(S, t.value, prefs).zoom }, "zoom");
  });

  on(doc, "change", (e) => {
    const t = elOf(e);
    if (!inside(t)) return;
    if (t.id === "groupBy") store.set({ groupBy: setGroupBy(S, t.value, prefs).groupBy }, "group");
    else if (t.id === "colorBy") store.set({ colorBy: setColorBy(S, t.value, prefs).colorBy }, "color");
    else if (t.id === "autoRefresh") auto.set(t.checked);
  });

  on(doc, "mouseover", (e) => {
    const t = elOf(e);
    const b = t && t.closest("#view .bar");
    if (b) showTip(e, b);
  });
  on(doc, "mousemove", (e) => {
    const t = elOf(e);
    const b = t && t.closest("#view .bar");
    if (b) showTip(e, b);
    else hideTip();
  });

  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  on(win, "dragenter", (e) => {
    if (!hasFiles(e)) return;
    ui.dragDepth++;
    doc.body.classList.add("dragging");
    e.preventDefault();
  });
  on(win, "dragover", (e) => e.preventDefault());
  on(win, "dragleave", () => {
    ui.dragDepth = Math.max(0, ui.dragDepth - 1);
    if (!ui.dragDepth) doc.body.classList.remove("dragging");
  });
  on(win, "drop", (e) => {
    e.preventDefault();
    ui.dragDepth = 0;
    doc.body.classList.remove("dragging");
    if (!e.dataTransfer) return;
    sourcesFromDrop(e.dataTransfer)
      .then((sources) => (sources.length ? loadSources(sources) : toast("No .json files in what was dropped.", true)))
      .catch((err) => toast("Could not read the drop: " + reasonOf(err), true));
  });

  on(win, "resize", () => {
    win.clearTimeout(ui.resizeT);
    ui.resizeT = win.setTimeout(() => {
      if (S.runs.length && S.view === "timeline") render("resize");
    }, RESIZE_MS);
  });

  on(win, "beforeprint", () => {
    const u = $("#util");
    if (u) {
      ui.utilWasOpen = u.open;
      ui.noStore = true;
      u.open = true;
    }
    if (S.view === "timeline" && S.runs.length) store.set({ printing: true }, "print");
  });
  on(win, "afterprint", () => {
    const u = $("#util");
    if (u) u.open = !!ui.utilWasOpen;
    win.setTimeout(() => {
      ui.noStore = false;
    }, 0);
    if (S.printing) store.set({ printing: false }, "print");
  });

  const utilEl = $("#util");
  if (utilEl) {
    utilEl.open = prefs.get("util") === "1";
    on(utilEl, "toggle", () => {
      if (!ui.noStore) prefs.set("util", utilEl.open ? "1" : "");
    });
  }

  function destroy() {
    for (const [target, type, fn, opts] of ui.listeners) target.removeEventListener(type, fn, opts);
    ui.listeners = [];
    auto.stop();
    win.clearTimeout(ui.resizeT);
    if (apps.get(doc) === app) apps.delete(doc);
  }

  const app = {
    root,
    plugins: plugList,
    hooks,
    store,
    recompute: (run) => store.recompute(run),
    render,
    openDrawer,
    closeDrawer,
    toast,
    reload,
    load: (docs, opts) => loadDocs(docs, opts),
    destroy,
  };
  apps.set(doc, app);

  const empty = $("#emptyState");
  if (empty) empty.innerHTML = renderEmpty();
  applyTheme(S.theme);
  store.subscribe((_, reason) => render(reason));

  for (const p of plugList) if (typeof p.init === "function") safe(() => p.init(app));

  const docs = embeddedDocs(doc);
  if (docs.length) {
    const payload = embeddedPayload(doc) || {};
    const embedded = { repo: payload.repo || null, jiraSite: payload.jiraSite || "", generatedAt: parseTime(payload.generatedAt) };
    if (!loadDocs(docs, { quiet: true, embedded })) render("init");
  } else render("init");
  return app;
}

if (typeof document !== "undefined" && document.getElementById("warp-data")) {
  createApp({ root: document });
}
