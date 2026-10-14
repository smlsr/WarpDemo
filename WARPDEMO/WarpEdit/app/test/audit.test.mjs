import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PHASES, VIEW_SRC, audit, report, scanText, stripJsComments } from "./audit.mjs";

const THIRTEEN = ["queued", "claimed", "planning", "coding", "review", "fix", "awaiting_approval", "merging", "merged", "done", "blocked", "alarm", "skipped"];
const AUDIT_CLI = fileURLToPath(new URL("./audit.mjs", import.meta.url));

function copyOfView() {
  const dir = mkdtempSync(join(tmpdir(), "warpedit-audit-"));
  cpSync(VIEW_SRC, dir, { recursive: true });
  return dir;
}

test("AC-2: the audit passes over WarpView's src and the released viewer.html", () => {
  const r = audit();
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true);
  assert.ok(r.files >= 10, "walks WarpView's modules");
  assert.equal(r.html, true, "viewer.html is audited too");
});

test("AC-2: the audit prints the thirteen phases", () => {
  assert.deepEqual(PHASES, THIRTEEN);
  assert.equal(PHASES.length, 13);
  const out = spawnSync(process.execPath, [AUDIT_CLI], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /phases \(13\): queued, claimed, planning, coding, review, fix, awaiting_approval, merging, merged, done, blocked, alarm, skipped/);
  assert.match(out.stdout, /audit: pass/);
  assert.match(report(audit()), /phases \(13\)/);
});

test("AC-3: a copy of the drawer that sets ticket.status fails the audit naming the file and line", () => {
  const dir = copyOfView();
  try {
    const file = join(dir, "view", "drawer", "drawer.mjs");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.splice(4, 0, 'export const sneaky = (ticket) => { ticket.status = "coding"; };');
    writeFileSync(file, lines.join("\n"));
    const r = audit({ srcDir: dir, viewerHtml: null });
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].file, file);
    assert.equal(r.violations[0].line, 5);
    assert.equal(r.violations[0].rule, "status-assignment");
    assert.match(report(r), new RegExp(`FAIL ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:5 status-assignment`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC-3: the same assignment is allowed under load/parse/ only", () => {
  const code = 'ticket.status = "coding";\n';
  assert.equal(scanText(code, "x.mjs", { rel: "load/parse/parse.mjs" }).length, 0);
  assert.equal(scanText(code, "x.mjs", { rel: "view/drawer/drawer.mjs" }).length, 1);
  assert.equal(scanText('t["status"] = "x";', "x.mjs", { rel: "store/store.mjs" }).length, 1);
  assert.equal(scanText("t.status += 1;", "x.mjs", { rel: "store/store.mjs" }).length, 1);
  assert.equal(scanText("Object.assign(t, { status: to });", "x.mjs", { rel: "store/store.mjs" }).length, 1);
  assert.equal(scanText("if (t.status === 'merged') {}", "x.mjs", { rel: "store/store.mjs" }).length, 0);
  assert.equal(scanText("// t.status = 1", "x.mjs", { rel: "store/store.mjs" }).length, 0);
});

test("AC-3: data-edit, a Reset label and a beam download each fail the audit with their line", () => {
  const cases = [
    ['const a = `<button data-edit="reset">x</button>`;', "data-edit"],
    ["const a = `<button>Reset</button>`;", "reset-label"],
    ['const a = "Reset phase";', "reset-label"],
    ["const a = new Blob([json]);", "beam-download"],
    ["a.download = name; a.href = URL.createObjectURL(b);", "beam-download"],
  ];
  for (const [code, rule] of cases) {
    const found = scanText(`const ok = 1;\n${code}\n`, "m.mjs", { rel: "view/x.mjs" });
    assert.deepEqual(found.map((f) => [f.line, f.rule]).filter(([, r]) => r === rule).slice(0, 1), [[2, rule]], code);
  }
  assert.equal(scanText('const a = "Resets nothing";', "m.mjs", { rel: "view/x.mjs" }).length, 0);
});

test("AC-3: the audit reads the released viewer.html and exempts only the parse module's bundle section", () => {
  const html = ["<script>", "  // src/load/parse/parse.mjs", "  t.status = to;", "  // src/view/drawer/drawer.mjs", "  t.status = to;", "</script>"].join("\n");
  const found = scanText(html, "viewer.html", { rel: "viewer.html", html: true });
  assert.deepEqual(found.map((f) => f.line), [5]);
});

test("AC-3: a status write after a URL string, a regex, a block comment or a template on the same line is still found", () => {
  const lines = [
    'const u = "http://x"; ticket.status = "coding";',
    "const u = 'a // b'; ticket.status = 'coding';",
    "const r = /\\/\\//; ticket.status = 'coding';",
    "const c = 1 /* note */; ticket.status = 'coding';",
    "const t = `a // ${1 + 1} // b`; ticket.status = 'coding';",
    "const t = `${ \"}\" }`; ticket.status = 'coding';",
    "const t = `/*`; ticket.status = 'coding'; const e = `*/`;",
    "const d = '/*'; ticket.status = 'coding'; const e = '*/';",
  ];
  for (const line of lines) {
    const found = scanText(`const ok = 1;\n${line}\n`, "m.mjs", { rel: "view/x.mjs" });
    assert.deepEqual(found.map((f) => [f.line, f.rule]), [[2, "status-assignment"]], line);
  }
});

test("AC-3: comments are still ignored, and line numbers and length hold", () => {
  assert.equal(scanText("// ticket.status = 1\n/* ticket.status = 2\n ticket.status = 3 */\nconst a = 1;", "m.mjs", { rel: "view/x.mjs" }).length, 0);
  const src = readFileSync(join(VIEW_SRC, "main.mjs"), "utf8");
  const out = stripJsComments(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split("\n").length, src.split("\n").length);
  assert.equal(stripJsComments("a // b\nc"), "a     \nc");
});

test("AC-3: in an html file only comments outside strings are blanked and script bodies are scanned as code", () => {
  const html = ["<!-- ticket.status = 1 -->", "<p>don't</p>", "<script>", 'const u = "http://x"; t.status = 2;', "</script>"].join("\n");
  const found = scanText(html, "v.html", { rel: "v.html", html: true });
  assert.deepEqual(found.map((f) => f.line), [4]);
});
