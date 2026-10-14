import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "../../build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "..");
const viewDir = join(appDir, "..");
const srcDir = join(appDir, "src");
const tokensCss = readFileSync(join(here, "tokens.css"), "utf8");
const layoutCss = readFileSync(join(here, "layout.css"), "utf8");
const spec = readFileSync(join(viewDir, "spec", "SPEC.md"), "utf8");
const reference = readFileSync(join(viewDir, "ui", "reference", "warp-dashboard.html"), "utf8");

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseDecls(body) {
  const map = new Map();
  for (const d of splitTop(body, ";")) {
    const i = d.indexOf(":");
    map.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return map;
}

function blocks(css, media = "") {
  const out = [];
  let i = 0;
  const src = stripComments(css);
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (depth && j < src.length) {
      if (src[j] === "{") depth++;
      if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (prelude.startsWith("@media")) out.push(...blocks(body, prelude));
    else if (!prelude.startsWith("@")) out.push({ media, selectors: splitTop(prelude, ","), decls: parseDecls(body) });
    i = j;
  }
  return out;
}

function specTokens() {
  const sec = spec.slice(spec.indexOf("### 12.1"), spec.indexOf("### 12.2"));
  const rows = [...sec.matchAll(/^\|\s*(--[a-z][\w-]*)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)];
  return rows.map(([, name, light, dark]) => ({ name, light, dark }));
}

function tokenBlocks() {
  const all = blocks(tokensCss);
  const find = (media, selector) => {
    const b = all.find((x) => x.media === media && x.selectors.includes(selector));
    assert.ok(b, `tokens.css has ${media || "top level"} ${selector}`);
    return b.decls;
  };
  return {
    root: find("", ":root"),
    darkMedia: find("@media (prefers-color-scheme: dark)", ':root:not([data-theme="light"])'),
    darkAttr: find("", ':root[data-theme="dark"]'),
  };
}

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

test("AC-1: SPEC §12.1 lists the eighteen tokens the test compares against", () => {
  const t = specTokens();
  assert.equal(t.length, 18);
  assert.deepEqual(
    t.map((x) => x.name),
    ["--bg", "--panel", "--panel2", "--ink", "--ink2", "--muted", "--line", "--line2", "--brand", "--brand2", "--c-done", "--c-err", "--c-prog", "--c-rev", "--c-qa", "--c-todo", "--tint", "--tint-todo"],
  );
});

test("AC-1: every SPEC §12.1 token is defined on :root with its light value", () => {
  const { root } = tokenBlocks();
  for (const t of specTokens()) assert.equal(root.get(t.name)?.toLowerCase(), t.light.toLowerCase(), `${t.name} light`);
});

test("AC-1: every SPEC §12.1 token is redefined with its dark value under prefers-color-scheme: dark and under [data-theme=dark]", () => {
  const { darkMedia, darkAttr } = tokenBlocks();
  for (const t of specTokens()) {
    assert.equal(darkMedia.get(t.name)?.toLowerCase(), t.dark.toLowerCase(), `${t.name} dark (media)`);
    assert.equal(darkAttr.get(t.name)?.toLowerCase(), t.dark.toLowerCase(), `${t.name} dark (attribute)`);
  }
});

test("AC-1: the dark media block is guarded so an explicit light theme wins", () => {
  assert.match(tokensCss, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
});

test("AC-5: tokens.css defines nothing the layout uses that is missing (every var(--x) in layout.css resolves)", () => {
  const defined = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const local = new Set([...stripComments(layoutCss).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const allowedUnset = new Set(["--c", "--rowh"]);
  for (const [, name] of layoutCss.matchAll(/var\((--[\w-]+)/g)) {
    assert.ok(defined.has(name) || local.has(name) || allowedUnset.has(name), `${name} is defined`);
  }
});

test("AC-4: no status color value appears in any CSS file in src/ outside tokens.css", () => {
  const status = specTokens().filter((t) => /^--c-/.test(t.name));
  const hexes = new Set(status.flatMap((t) => [t.light, t.dark]).map((h) => h.toLowerCase()));
  const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const files = cssFiles(srcDir).filter((f) => !f.endsWith(join("styles", "tokens.css")));
  assert.ok(files.some((f) => f.endsWith("layout.css")));
  for (const f of files) {
    const text = stripComments(readFileSync(f, "utf8")).toLowerCase();
    for (const h of hexes) assert.equal(text.includes(h), false, `${relative(srcDir, f)} contains ${h}`);
    for (const h of hexes) {
      const [r, g, b] = toRgb(h);
      const re = new RegExp(`rgba?\\(\\s*${r}\\s*[, ]\\s*${g}\\s*[, ]\\s*${b}\\b`);
      assert.equal(re.test(text), false, `${relative(srcDir, f)} contains rgb(${r},${g},${b})`);
    }
  }
});

test("AC-4: layout.css has no color literal at all (hex, rgb, hsl) and uses var(--c-*) for status colors", () => {
  const text = stripComments(layoutCss);
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(text), false, "hex literal");
  assert.equal(/\b(?:rgba?|hsla?)\(/.test(text), false, "rgb/hsl literal");
  assert.match(text, /var\(--c-done\)/);
  assert.match(text, /var\(--c-err\)/);
  assert.match(text, /var\(--c-qa\)/);
  assert.match(text, /var\(--c-todo\)/);
});

const norm = (v) =>
  v
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(^|[^\d])0\./g, "$1.");

const TOKEN_FOR_LITERAL = {
  "var(--on-brand)": "#fff",
  "var(--on-err)": "#fff",
  "var(--shadow-pop)": "0 10px 30px rgba(0,0,0,.18)",
  "var(--shadow-tip)": "0 8px 24px rgba(0,0,0,.25)",
  "var(--scrim)": "rgba(5,10,12,.35)",
};

const EXTRAS = new Set([
  "@media (max-width: 640px)|.headline .chain|max-width",
  "@media (max-width: 640px)|.search|max-width",
  "@media (max-width: 640px)|.search|flex-basis",
  "@media (max-width: 640px)|.controls|min-width",
  "@media (max-width: 640px)|.empty|margin",
  "@media (max-width: 640px)|.empty|padding",
  "@media print|body|background",
  "@media print|*|print-color-adjust",
  "@media print|*|-webkit-print-color-adjust",
  "@media print|.lane|break-inside",
]);

function refIndex() {
  const css = reference.match(/<style>([\s\S]*?)<\/style>/)[1];
  const index = new Map();
  for (const b of blocks(css)) {
    for (const sel of b.selectors) {
      const key = `${b.media}|${sel}`;
      const cur = index.get(key) ?? new Map();
      for (const [k, v] of b.decls) cur.set(k, v);
      index.set(key, cur);
    }
  }
  return index;
}

test("AC-2: every layout rule for cards, chips, panels, bars and controls repeats the reference page's declarations", () => {
  const ref = refIndex();
  const mismatches = [];
  let checked = 0;
  for (const b of blocks(layoutCss)) {
    for (const sel of b.selectors) {
      const key = `${b.media}|${sel}`;
      const r = ref.get(key);
      for (const [prop, value] of b.decls) {
        if (EXTRAS.has(`${b.media}|${sel}|${prop}`)) continue;
        if (!r || !r.has(prop)) {
          mismatches.push(`${key} ${prop} not in reference`);
          continue;
        }
        let v = value;
        for (const [token, literal] of Object.entries(TOKEN_FOR_LITERAL)) v = v.split(token).join(literal);
        checked++;
        if (norm(v) !== norm(r.get(prop))) mismatches.push(`${key} ${prop}: ${value} != ${r.get(prop)}`);
      }
    }
  }
  assert.ok(checked > 400, `checked ${checked} declarations`);
  assert.deepEqual(mismatches, []);
});

test("AC-2: the shared panels, cards, chips and controls named by swimlane-plan.png all have a layout rule", () => {
  const selectors = new Set(blocks(layoutCss).flatMap((b) => b.selectors.map((s) => `${b.media}|${s}`)));
  for (const cls of [".top", ".brand", ".chip", ".dot.running", ".btn.primary", ".btn.icon", ".headline h1", ".metrics", ".card", ".big", ".stack", ".rows .sw", ".foot", ".fchip", ".fchip.off", ".search input", ".seg button.on", ".ctl select", ".panel", ".panel-h", ".util > summary", ".empty", ".drop", ".toasts", ".foot-note"]) {
    assert.ok(selectors.has(`|${cls}`), `${cls} has a rule`);
  }
});

test("AC-2: the built page carries tokens first-class: one style element holds tokens.css and layout.css", async () => {
  const out = mkdtempSync(join(tmpdir(), "warp-wv02-"));
  try {
    const root = join(out, "app");
    cpSync(srcDir, join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "styles", "tokens.css"), tokensCss);
    writeFileSync(join(root, "src", "styles", "layout.css"), layoutCss);
    const { path } = await build({ root });
    const html = readFileSync(path, "utf8");
    assert.equal(html.split("<style>").length, 2);
    assert.ok(html.includes("--c-done: #1f9d55"));
    assert.ok(html.includes(".metrics { display: grid"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("AC-3: at 640 px and below the gutter is 16 px, metric cards are one column, the top bar wraps and the page does not scroll sideways", () => {
  const phone = blocks(layoutCss).filter((b) => b.media === "@media (max-width: 640px)");
  const get = (sel, prop) => phone.find((b) => b.selectors.includes(sel))?.decls.get(prop);
  assert.equal(get(".wrap", "padding"), "0 16px");
  assert.equal(get(".metrics", "grid-template-columns"), "1fr");
  assert.equal(get(".tl-lab", "width"), "54px");
  assert.equal(get(".top", "position"), "static");
  assert.equal(get(".meta", "flex-basis"), "100%");
  const base = blocks(layoutCss).filter((b) => b.media === "");
  const top = base.find((b) => b.selectors.includes(".top .wrap"));
  assert.equal(top.decls.get("flex-wrap"), "wrap");
  const metrics = base.find((b) => b.selectors.includes(".metrics"));
  assert.match(metrics.decls.get("grid-template-columns"), /minmax\(0,\s*1fr\)/);
});

function findChrome() {
  for (const p of [process.env.CHROME, "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

const chrome = findChrome();

test("AC-3: in a 390 px frame documentElement.scrollWidth equals clientWidth and the four metric cards share one left edge", { skip: chrome ? false : "no Chrome on this machine" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "warp-wv02-chrome-"));
  try {
    const refCss = reference.match(/<style>([\s\S]*?)<\/style>/)[1];
    const viewRules = blocks(refCss)
      .filter((b) => b.media === "" && b.selectors.some((s) => /^(\.tl|\.gl|\.gline|\.grid-v|\.bar|table\.grid|\.tbl-wrap|\.lane|\.tcard|\.drawer-|\.kv|\.ev|\.tags|\.tag)/.test(s)))
      .map((b) => `${b.selectors.join(",")}{${[...b.decls].map(([k, v]) => `${k}:${v}`).join(";")}}`)
      .join("\n");
    const page = reference.replace(/<style>[\s\S]*?<\/style>/, () => `<style>\n${tokensCss}\n${layoutCss}\n${viewRules}\n</style>`);
    writeFileSync(join(dir, "page.html"), page);
    writeFileSync(
      join(dir, "frame.html"),
      `<!doctype html><iframe id="f" src="page.html" width="390" height="800"></iframe><script>
f.onload = () => setTimeout(() => {
  const d = f.contentDocument.documentElement;
  const cards = [...f.contentDocument.querySelectorAll(".metrics .card")].map((c) => Math.round(c.getBoundingClientRect().left));
  document.title = JSON.stringify({ sw: d.scrollWidth, cw: d.clientWidth, cards });
}, 300);
</script>`,
    );
    const r = spawnSync(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", `--user-data-dir=${join(dir, "profile")}`, "--window-size=800,900", "--virtual-time-budget=5000", "--dump-dom", `file://${join(dir, "frame.html")}`], { encoding: "utf8", timeout: 60000 });
    const m = r.stdout.match(/<title>(.*?)<\/title>/);
    assert.ok(m, `chrome output: ${r.stderr.slice(0, 200)}`);
    const got = JSON.parse(m[1].replace(/&quot;/g, '"'));
    assert.equal(got.sw, got.cw);
    assert.ok(got.cw >= 360 && got.cw <= 390);
    assert.equal(got.cards.length, 4);
    assert.equal(new Set(got.cards).size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
