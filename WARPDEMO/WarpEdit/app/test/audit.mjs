import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
export const VIEW_SRC = resolve(here, "..", "..", "..", "WarpView", "app", "src");
export const VIEWER_HTML = resolve(here, "..", "..", "..", "WarpView", "viewer.html");

// WarpEdit SPEC §3. recovering and bugbot_running display but are not targets.
export const PHASES = ["queued", "claimed", "planning", "coding", "review", "fix", "awaiting_approval", "merging", "merged", "done", "blocked", "alarm", "skipped"];

const RULES = [
  { rule: "status-assignment", re: /\.status\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?!=)|\[\s*["'`]status["'`]\s*\]\s*(?:[-+*/%&|^]|&&|\|\||\?\?)?=(?!=)|\bObject\.assign\([^)]*\bstatus\b/g, parseOnly: true, what: "assigns a status" },
  { rule: "data-edit", re: /\bdata-edit\b/g, what: "has a data-edit attribute" },
  { rule: "reset-label", re: /(?:>|["'`])\s*Reset\b[^"'`<>]*(?=<|["'`])/g, what: "has a control labelled Reset" },
  { rule: "beam-download", re: /\bdownload\s*=|\.download\b|\bcreateObjectURL\b|\bnew\s+Blob\b|\bshowSaveFilePicker\b|\bBlob\s*\(/g, what: "downloads a file" },
];

const blank = (s) => s.replace(/[^\n]/g, " ");
const linesBefore = (text, at) => text.slice(0, at).split("\n").length - 1;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Source map v3 mappings, per generated line: [generated column, original line, original column], 0-based.
function decodeMappings(mappings) {
  const lines = [];
  let oLine = 0;
  let oCol = 0;
  for (const text of mappings.split(";")) {
    const segs = [];
    let gCol = 0;
    for (const seg of text ? text.split(",") : []) {
      const v = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        value += (d & 31) * 2 ** shift;
        if (d & 32) shift += 5;
        else {
          v.push(value % 2 ? -(value - 1) / 2 : value / 2);
          value = 0;
          shift = 0;
        }
      }
      gCol += v[0];
      if (v.length >= 4) {
        oLine += v[2];
        oCol += v[3];
        segs.push([gCol, oLine, oCol]);
      }
    }
    lines.push(segs);
  }
  const first = new Map();
  lines.forEach((segs, l) => {
    for (const s of segs) if (!first.has(`${s[1]}:${s[2]}`)) first.set(`${s[1]}:${s[2]}`, l);
  });
  return { lines, first };
}

// The original line of generated (line, column): the last mapping at or before it. esbuild prints a
// multi-line template literal verbatim and maps each of its continuation lines back to where that
// template part opens (a "`" or the "}" that closes a "${"), so for those the lines since that
// position first appears in the output are counted on.
function originalLine(map, srcLines, line, col) {
  let hit = null;
  for (const s of map.lines[line] || []) if (s[0] <= col) hit = s;
  for (let l = line - 1; !hit && l >= 0; l--) {
    const segs = map.lines[l];
    if (segs && segs.length) hit = segs[segs.length - 1];
  }
  if (!hit) return line;
  const opens = (srcLines[hit[1]] || "")[hit[2]];
  if (opens !== "`" && opens !== "}") return hit[1];
  return hit[1] + (line - map.first.get(`${hit[1]}:${hit[2]}`));
}

// Each rule match in `lines`, as [0-based line, rule].
function matches(lines, at) {
  const out = [];
  lines.forEach((line, i) => {
    for (const r of RULES) for (const m of line.matchAll(r.re)) out.push([at(i, m.index), r]);
  });
  return out;
}

// JavaScript is parsed by esbuild, which drops every comment, so the regex-versus-division and
// statement-boundary questions are a real parser's. Hits on the printed code map back through its
// source map to the original line. `offset` is the line the source starts on in its file.
function scanJs(src, offset) {
  let res;
  try {
    res = transformSync(src, { loader: "js", sourcemap: "external", legalComments: "none", charset: "utf8", logLevel: "silent" });
  } catch (e) {
    const loc = e.errors && e.errors[0] && e.errors[0].location;
    return { error: offset + (loc ? loc.line - 1 : 0), hits: [] };
  }
  const map = decodeMappings(JSON.parse(res.map).mappings);
  const srcLines = src.split("\n");
  return { hits: matches(res.code.split("\n"), (i, col) => offset + originalLine(map, srcLines, i, col)) };
}

const SCRIPT = /(<script\b([^>]*)>)([\s\S]*?)(<\/script)/gi;
const isJsScript = (attrs) => {
  const m = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs);
  return !m || /^(?:|module|(?:text|application)\/(?:java|ecma)script)$/i.test(m[1]);
};

function walk(dir, files = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (name.endsWith(".mjs") && !/\.test\.mjs$/.test(name)) files.push(p);
  }
  return files;
}

const underParse = (rel) => rel.startsWith("load/parse/");

export function scanText(text, name, { rel = name, html = false } = {}) {
  const original = text.split("\n");
  const hits = [];
  const errors = [];
  const js = (src, offset) => {
    const r = scanJs(src, offset);
    if (r.error !== undefined) errors.push(r.error);
    hits.push(...r.hits);
  };
  if (!html) js(text, 0);
  else {
    let markup = "";
    let at = 0;
    for (const m of text.matchAll(SCRIPT)) {
      if (!isJsScript(m[2])) continue;
      const body = m.index + m[1].length;
      markup += text.slice(at, body) + blank(m[3]);
      at = body + m[3].length;
      js(m[3], linesBefore(text, body));
    }
    markup = (markup + text.slice(at)).replace(/<!--[\s\S]*?-->/g, blank);
    hits.push(...matches(markup.split("\n"), (i) => i));
  }

  // The released file is one bundle; esbuild marks each module with "// src/<path>".
  const section = [];
  let current = rel;
  original.forEach((line, i) => {
    const mark = html ? /^\s*\/\/ src\/(.+\.mjs)\s*$/.exec(line) : null;
    if (mark) current = mark[1];
    section[i] = current;
  });

  const found = [];
  const seen = new Set();
  const add = (line, rule) => {
    const key = `${line}:${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ file: name, line: line + 1, rule, text: (original[line] || "").trim() });
  };
  for (const line of errors) add(line, "parse-error");
  for (const [line, r] of hits) if (!(r.parseOnly && underParse(section[line] || rel))) add(line, r.rule);
  return found.sort((a, b) => a.line - b.line);
}

export function audit({ srcDir = VIEW_SRC, viewerHtml = VIEWER_HTML } = {}) {
  const violations = [];
  const files = walk(srcDir);
  for (const file of files) {
    const rel = relative(srcDir, file).split(sep).join("/");
    violations.push(...scanText(readFileSync(file, "utf8"), file, { rel }));
  }
  const html = viewerHtml && existsSync(viewerHtml) ? viewerHtml : null;
  if (html) violations.push(...scanText(readFileSync(html, "utf8"), html, { rel: "viewer.html", html: true }));
  return { ok: violations.length === 0, files: files.length, html: !!html, violations, phases: [...PHASES] };
}

export function report(result) {
  const lines = [`audit: ${result.files} modules${result.html ? " + viewer.html" : ""}`];
  lines.push(`phases (${result.phases.length}): ${result.phases.join(", ")}`);
  for (const v of result.violations) lines.push(`FAIL ${v.file}:${v.line} ${v.rule}: ${v.text}`);
  lines.push(result.ok ? "audit: pass" : `audit: fail (${result.violations.length})`);
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = audit();
  console.log(report(result));
  process.exit(result.ok ? 0 : 1);
}
