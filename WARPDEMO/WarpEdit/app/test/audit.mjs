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

// After these words an expression starts, so a "/" opens a regex literal.
const REGEX_AFTER = /(?<![.\w$])(?:return|typeof|case|do|else|in|of|instanceof|new|delete|void|throw|yield|await)$/;

// Whether a "/" at the end of `before` opens a regex literal (true) or divides (false). Only an
// expression-ending token divides: a name, a number, a closing ")" or "]", a string or a template.
// "}" ends a block far more often than an object literal, so a regex may follow it.
function opensRegex(before) {
  const t = before.replace(/\s+$/, "");
  if (!t) return true;
  const c = t[t.length - 1];
  if (c === "}") return true;
  if (!/[\w$)\]"'`]/.test(c)) return true;
  return REGEX_AFTER.test(t);
}

// Blanks the comments of JavaScript source and keeps every other character and every newline, so line
// numbers hold. Strings, template literals and regex literals are walked, so a "//" or "/*" inside one
// does not hide the code after it.
export function stripJsComments(src) {
  let out = "";
  let i = 0;
  const stack = [];
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      out += blank(src.slice(i, j));
      i = j;
    } else if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      const end = Math.min(src[j] === c ? j + 1 : j, n);
      out += src.slice(i, end);
      i = end;
    } else if (c === "`" || (c === "}" && stack.length && stack[stack.length - 1] === "tpl")) {
      if (c === "}") stack.pop();
      let j = i + 1;
      let open = false;
      while (j < n) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "`") break;
        else if (src[j] === "$" && src[j + 1] === "{") {
          open = true;
          break;
        } else j++;
      }
      const end = Math.min(open ? j + 2 : j + 1, n);
      out += src.slice(i, end);
      if (open) stack.push("tpl");
      i = end;
    } else if (c === "/" && opensRegex(out)) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "[") (cls = true), j++;
        else if (src[j] === "]") (cls = false), j++;
        else if (src[j] === "/" && !cls) break;
        else j++;
      }
      const end = Math.min(src[j] === "/" ? j + 1 : j, n);
      out += src.slice(i, end);
      i = end;
    } else {
      if (c === "{") stack.push("blk");
      else if (c === "}") stack.pop();
      out += c;
      i++;
    }
  }
  return out;
}

export function stripComments(text, html = false) {
  if (!html) return stripJsComments(text);
  const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script)/gi;
  const noHtmlComments = (t) => t.replace(/<!--[\s\S]*?-->/g, blank);
  let out = "";
  let at = 0;
  for (const m of text.matchAll(SCRIPT)) {
    const body = m.index + m[1].length;
    out += noHtmlComments(text.slice(at, body)) + stripJsComments(m[2]);
    at = body + m[2].length;
  }
  return out + noHtmlComments(text.slice(at));
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
