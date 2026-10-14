import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PHASES, VIEW_SRC, audit, report, scanText } from "./audit.mjs";

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

test("AC-3: comments are still ignored, and each hit names its original line", () => {
  assert.equal(scanText("// ticket.status = 1\n/* ticket.status = 2\n ticket.status = 3 */\nconst a = 1;", "m.mjs", { rel: "view/x.mjs" }).length, 0);
  const src = [
    "/* a block",
    "   comment */",
    "",
    "const a = 1, b = { c: 2,",
    "  d: 3 }; t.status = 'x';",
    "const s = `one",
    "two <b>Reset</b> ${a}`;",
    "if (a) { y(); } else",
    "",
    "  t['status'] = 'y';",
    "const u = `x ${a} y",
    "z",
    "<i>Reset</i>`; const v = { w: 1,",
    "  k: 2 }.k; t.status = v;",
  ].join("\n");
  const found = scanText(src, "m.mjs", { rel: "view/x.mjs" });
  assert.deepEqual(found.map((f) => [f.line, f.rule]), [[5, "status-assignment"], [7, "reset-label"], [10, "status-assignment"], [13, "reset-label"], [14, "status-assignment"]]);
  assert.equal(found[0].text, "d: 3 }; t.status = 'x';");
});

test("AC-3: a module that does not parse fails the audit naming the file and line", () => {
  const found = scanText("const ok = 1;\nconst = ;\n", "bad.mjs", { rel: "view/x.mjs" });
  assert.deepEqual(found.map((f) => [f.file, f.line, f.rule]), [["bad.mjs", 2, "parse-error"]]);
});

test("AC-3: a regex in a nested for-of head or after a bare return line does not hide the status write after it", () => {
  const cases = [
    ["for (const { a: { b } } of /\\/*/.exec(x)) {} t.status = 'coding';", 2],
    ["for (const [a, [b]] of /\\/*/.exec(x)) {} t.status = 'coding';", 2],
    ["for (const x of xs) for (const y of /\\/*/.exec(x)) {} t.status = 'coding';", 2],
    ["function f() {\n  return\n  { y(); } /\\/*/.test(c); t.status = 'coding';\n}", 4],
    ["function f() {\n  return\n  { y(); } /\\/*/.test(c);\n  t.status = 'coding';\n}", 5],
  ];
  for (const [code, line] of cases) {
    const found = scanText(`const ok = 1;\n${code}\n`, "m.mjs", { rel: "view/x.mjs" });
    assert.deepEqual(found.map((f) => [f.line, f.rule]), [[line, "status-assignment"]], code);
  }
});

test("AC-3: a non-JavaScript script block in an html file is read as markup, not parsed", () => {
  const html = ['<script id="warp-data" type="application/json">{"status": "x"}</script>', "<script>", "t.status = 1;", "</script>"].join("\n");
  const found = scanText(html, "v.html", { rel: "v.html", html: true });
  assert.deepEqual(found.map((f) => [f.line, f.rule]), [[3, "status-assignment"]]);
});

test("AC-3: in an html file only comments outside strings are blanked and script bodies are scanned as code", () => {
  const html = ["<!-- ticket.status = 1 -->", "<p>don't</p>", "<script>", 'const u = "http://x"; t.status = 2;', "</script>"].join("\n");
  const found = scanText(html, "v.html", { rel: "v.html", html: true });
  assert.deepEqual(found.map((f) => f.line), [4]);
});

test("AC-3: a regex literal after return, typeof, case, a brace or an operator does not hide the status write after it", () => {
  const lines = [
    "function f(t) { return /\\//.test(x); } t.status = 'coding';",
    "function f(t) { return /\\/*/.test(x); } t.status = 'coding';",
    "const k = typeof /\\/*/; t.status = 'coding';",
    "switch (x) { case /\\/*/.test(y): break; } t.status = 'coding';",
    "if (a) { b(); } /\\/*/.test(c); t.status = 'coding';",
    "const m = x ? /\\//.test(a) : /\\/*/.test(b); t.status = 'coding';",
    "const [a, b] = [/\\//, /\\/*/]; t.status = 'coding';",
    "x = a / b; y = c / d; t.status = 'coding'; // z / w",
    "x = (a) / 2; y = arr[0] / 2; t.status = 'coding'; // note",
    "const m = s.match(/[/*]/); t.status = 'coding';",
  ];
  for (const line of lines) {
    const found = scanText(`const ok = 1;\n${line}\n`, "m.mjs", { rel: "view/x.mjs" });
    assert.deepEqual(found.map((f) => [f.line, f.rule]), [[2, "status-assignment"]], line);
  }
  assert.equal(scanText("function f() { return /a/ // t.status = 1\n}", "m.mjs", { rel: "view/x.mjs" }).length, 0);
  assert.equal(scanText("a = b / c; // t.status = 1\n", "m.mjs", { rel: "view/x.mjs" }).length, 0);
});

test("AC-3: a slash after an object literal or the name `of` divides, so the comment after it is still ignored", () => {
  const ignored = [
    "const o = { valueOf: () => 4 } / 2; // t.status = 1",
    "const o = { valueOf: () => 4 } / 2; /* t.status = 1 */",
    "const o = f({ a: { b: 1 } } / 2); // t.status = 1",
    "const o = x ? 1 : { valueOf: () => 4 } / 2; // t.status = 1",
    "const t = `${{ valueOf: () => 4 } / 2}`; // t.status = 1",
    "const of = 4; const h = of / 2; // t.status = 1",
    "const h = x.of / 2; // t.status = 1",
  ];
  for (const line of ignored) {
    assert.deepEqual(scanText(`const ok = 1;\n${line}\n`, "m.mjs", { rel: "view/x.mjs" }), [], line);
  }
  const found = [
    "for (const s of /\\/*/.exec(x)) {} t.status = 'coding';",
    "for (const [k, v] of /\\/*/.exec(x)) {} t.status = 'coding';",
    "if (a) { b(); } /\\/*/.test(c); t.status = 'coding';",
    "switch (x) { case 1: { y(); } /\\/*/.test(c); } t.status = 'coding';",
    "L: { y(); } /\\/*/.test(c); t.status = 'coding';",
    "const f = () => { y(); }\n/\\/*/.test(c); t.status = 'coding';",
  ];
  for (const line of found) {
    const at = line.split("\n").length + 1;
    const hits = scanText(`const ok = 1;\n${line}\n`, "m.mjs", { rel: "view/x.mjs" });
    assert.deepEqual(hits.map((f) => [f.line, f.rule]), [[at, "status-assignment"]], line);
  }
});
