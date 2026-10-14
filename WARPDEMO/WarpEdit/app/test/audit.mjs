import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const VIEW_SRC = resolve(here, "..", "..", "..", "WarpView", "app", "src");
export const VIEWER_HTML = resolve(here, "..", "..", "..", "WarpView", "viewer.html");

// WarpEdit SPEC §3. recovering and bugbot_running display but are not targets.
export const PHASES = ["queued", "claimed", "planning", "coding", "review", "fix", "awaiting_approval", "merging", "merged", "done", "blocked", "alarm", "skipped"];

const RULES = [
  { rule: "status-assignment", re: /\.status\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?!=)|\[\s*["'`]status["'`]\s*\]\s*(?:[-+*/%&|^]|&&|\|\||\?\?)?=(?!=)|\bObject\.assign\([^)]*\bstatus\b/, parseOnly: true, what: "assigns a status" },
  { rule: "data-edit", re: /\bdata-edit\b/, what: "has a data-edit attribute" },
  { rule: "reset-label", re: /(?:>|["'`])\s*Reset\b[^"'`<>]*(?=<|["'`])/, what: "has a control labelled Reset" },
  { rule: "beam-download", re: /\bdownload\s*=|\.download\b|\bcreateObjectURL\b|\bnew\s+Blob\b|\bshowSaveFilePicker\b|\bBlob\s*\(/, what: "downloads a file" },
];

const blank = (s) => s.replace(/[^\n]/g, " ");

// Comments are blanked, keeping line numbers, so a doc comment cannot trip or hide a rule.
export function stripComments(text, html = false) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (html) out = out.replace(/<!--[\s\S]*?-->/g, blank);
  return out.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
}

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
  const found = [];
  const original = text.split("\n");
  const code = stripComments(text, html).split("\n");
  let section = rel;
  code.forEach((line, i) => {
    // The released file is one bundle; esbuild marks each module with "// src/<path>".
    const mark = html ? /^\s*\/\/ src\/(.+\.mjs)\s*$/.exec(original[i]) : null;
    if (mark) section = mark[1];
    for (const r of RULES) {
      if (r.parseOnly && underParse(section)) continue;
      if (r.re.test(line)) found.push({ file: name, line: i + 1, rule: r.rule, text: original[i].trim() });
    }
  });
  return found;
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
