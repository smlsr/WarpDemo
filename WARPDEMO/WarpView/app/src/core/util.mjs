export const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const num = (v) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && isFinite(n) ? n : null;
};

export const fmtH = (h, dp) =>
  h == null
    ? "—"
    : (Math.abs(h) >= 100 ? Math.round(h).toLocaleString() : (+h.toFixed(dp == null ? 1 : dp)).toLocaleString()) + "h";

export const fmtN = (n) => (n == null ? "—" : Math.round(n).toLocaleString());

export const pct = (a, b) => (b > 0 && a != null ? Math.round((100 * a) / b) + "%" : "");

export const parseTime = (s) => {
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
};

export function ago(ms, now = Date.now()) {
  if (ms == null) return "—";
  const d = (now - ms) / 1000;
  if (d < 45) return "just now";
  if (d < 3600) return Math.round(d / 60) + "m ago";
  if (d < 86400) return Math.round(d / 3600) + "h ago";
  return Math.round(d / 86400) + "d ago";
}

export const stamp = (ms) =>
  ms == null ? "—" : new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function natKey(id) {
  return String(id)
    .split(/(\d+)/)
    .map((p, i) => (i % 2 ? p.padStart(8, "0") : p.toLowerCase()))
    .join("");
}

export const natCmp = (a, b) => {
  const x = natKey(a);
  const y = natKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

export function hashHue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
