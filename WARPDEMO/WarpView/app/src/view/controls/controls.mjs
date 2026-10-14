import { CATS, catColor } from "../../core/status.mjs";
import { esc } from "../../core/util.mjs";

export const PREFIX = "warp-dash:";

export const VIEWS = Object.freeze(["timeline", "board", "table"]);
export const VIEW_LABELS = Object.freeze({ timeline: "Swimlane", board: "Board", table: "Table" });
export const GROUPS = Object.freeze(["block", "status", "module", "lane", "repo", "size"]);
export const COLORS = Object.freeze(["status", "module", "lane"]);
export const THEMES = Object.freeze(["light", "dark"]);

export const MENU_ITEMS = Object.freeze([
  Object.freeze({ act: "open-files", label: "Open status files…", key: "O" }),
  Object.freeze({ act: "open-folder", label: "Open .warp folder…", key: "⇧O" }),
  Object.freeze({ act: "reload", label: "Reload", key: "R" }),
  Object.freeze({ act: "auto-reload", label: "Auto-reload every 30s", key: "" }),
  Object.freeze({ act: "print", label: "Print…", key: "P" }),
  Object.freeze({ act: "clear", label: "Close all files", key: "" }),
]);

const ACTIVATE = ".tcard, .lane-h, .trow, th[data-sort]";
const TYPING = /^(input|select|textarea)$/i;

export const initialControls = () => ({
  off: new Set(),
  q: "",
  view: "timeline",
  groupBy: "block",
  colorBy: "status",
  zoom: 0,
  theme: null,
});

const pick = (list, v, dflt) => (list.includes(v) ? v : dflt);

export function createPrefs(getStorage) {
  const read = (k) => {
    try {
      const s = getStorage();
      const v = s ? s.getItem(PREFIX + k) : null;
      return v == null ? null : v;
    } catch (e) {
      return null;
    }
  };
  const write = (k, v) => {
    try {
      const s = getStorage();
      if (!s) return false;
      s.setItem(PREFIX + k, String(v));
      return true;
    } catch (e) {
      return false;
    }
  };
  return { get: read, set: write };
}

export function loadControls(prefs) {
  const st = initialControls();
  const z = prefs ? parseFloat(prefs.get("zoom")) : NaN;
  st.view = pick(VIEWS, prefs && prefs.get("view"), st.view);
  st.groupBy = pick(GROUPS, prefs && prefs.get("groupBy"), st.groupBy);
  st.colorBy = pick(COLORS, prefs && prefs.get("colorBy"), st.colorBy);
  st.zoom = isFinite(z) ? Math.min(100, Math.max(0, z)) : 0;
  st.theme = pick(THEMES, prefs && prefs.get("theme"), null);
  return st;
}

const remember = (prefs, k, v) => {
  try {
    if (prefs) prefs.set(k, v);
  } catch (e) {
    /* preferences are best effort */
  }
};

export const switchView = (state, view, prefs) => {
  const v = pick(VIEWS, view, state.view);
  remember(prefs, "view", v);
  return { ...state, view: v };
};

export const setGroupBy = (state, value, prefs) => {
  const v = pick(GROUPS, value, state.groupBy);
  remember(prefs, "groupBy", v);
  return { ...state, groupBy: v };
};

export const setColorBy = (state, value, prefs) => {
  const v = pick(COLORS, value, state.colorBy);
  remember(prefs, "colorBy", v);
  return { ...state, colorBy: v };
};

export const setZoom = (state, value, prefs) => {
  const n = parseFloat(value);
  const z = isFinite(n) ? Math.min(100, Math.max(0, n)) : state.zoom;
  remember(prefs, "zoom", z);
  return { ...state, zoom: z };
};

export const setQuery = (state, value) => ({ ...state, q: String(value == null ? "" : value).trim().toLowerCase() });

export const nextTheme = (current, prefersDark) => ((current || (prefersDark ? "dark" : "light")) === "dark" ? "light" : "dark");

export const toggleTheme = (state, prefs, prefersDark) => {
  const theme = nextTheme(state.theme, prefersDark);
  remember(prefs, "theme", theme);
  return { ...state, theme };
};

export const toggleCat = (state, cat) => {
  const off = new Set(state.off);
  if (off.has(cat)) off.delete(cat);
  else off.add(cat);
  return { ...state, off };
};

export const onlyCat = (state, cat) => {
  const isOnly = state.off.size === CATS.length - 1 && !state.off.has(cat);
  return { ...state, off: isOnly ? new Set() : new Set(CATS.map((c) => c.key).filter((k) => k !== cat)) };
};

export function visibleControls(state) {
  return {
    groupBy: state.view === "board",
    zoom: state.view === "timeline",
    colorBy: true,
  };
}

export function legendCounts(runs) {
  const counts = Object.fromEntries(CATS.map((c) => [c.key, 0]));
  for (const r of runs || []) for (const t of r.tickets || []) counts[t.cat] = (counts[t.cat] || 0) + 1;
  return counts;
}

export function renderLegend(runs, state) {
  const counts = legendCounts(runs);
  return CATS.map((c) => {
    const off = state.off.has(c.key);
    return `<button class="fchip${off ? " off" : ""}" data-cat="${esc(c.key)}" aria-pressed="${off ? "false" : "true"}" title="Show or hide ${esc(c.label)} (double-click: only this)"><i class="sw" style="background:${catColor(c.key)}"></i>${esc(c.label)}<span class="n">${counts[c.key]}</span></button>`;
  }).join("");
}

export function renderViewSeg(state) {
  return VIEWS.map(
    (v) => `<button data-view="${v}" class="${state.view === v ? "on" : ""}" aria-pressed="${state.view === v}">${VIEW_LABELS[v]}</button>`
  ).join("");
}

export function searchText(ticket, run) {
  const t = ticket || {};
  return [t.id, t.title, t.jiraKey, t.module, t.layer, t.lane, t.repo, t.priorityGate, t.agent, t.status, t.block, t.size, run && run.name]
    .map((v) => (v == null ? "" : v))
    .join(" ")
    .toLowerCase();
}

export function queryWords(q) {
  return String(q == null ? "" : q)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function matchesQuery(ticket, run, q) {
  const words = queryWords(q);
  if (!words.length) return true;
  const hay = searchText(ticket, run);
  return words.every((w) => hay.includes(w));
}

export function matches(ticket, run, state) {
  const st = state || {};
  if (st.off && st.off.has(ticket.cat)) return false;
  return matchesQuery(ticket, run, st.q);
}

export const isHit = (ticket, run, state) => queryWords(state && state.q).length > 0 && matches(ticket, run, state);

export const visibleTickets = (tickets, run, state) => (tickets || []).filter((t) => matches(t, run, state));

export function keyAction(e) {
  const key = e.key;
  if (key === "Escape") return "escape";
  const target = e.target || {};
  const is = (sel) => typeof target.matches === "function" && target.matches(sel);
  if ((key === "Enter" || key === " ") && is(ACTIVATE)) return "activate";
  if (TYPING.test(target.tagName || "") || target.isContentEditable) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (key === "/") return "focus-search";
  if (key === "o") return "open-files";
  if (key === "O") return "open-folder";
  if (key === "r") return "reload";
  if (key === "p") return "print";
  return null;
}
