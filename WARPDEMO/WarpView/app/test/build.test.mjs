import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBuilt } from "./dom.mjs";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(appDir, "dist", "viewer.html");
const buildJs = join(appDir, "build.mjs");

function runBuild(root) {
  return spawnSync(process.execPath, [buildJs, ...(root ? ["--root", root] : [])], { encoding: "utf8" });
}

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "warpview-build-"));
  mkdirSync(join(root, "src"), { recursive: true });
  cpSync(join(appDir, "src", "shell.html"), join(root, "src", "shell.html"));
  writeFileSync(join(root, "src", "main.mjs"), "document.title = 'scratch';\n");
  return root;
}

before(() => {
  const r = runBuild();
  assert.equal(r.status, 0, r.stderr);
});

test("AC-1: build writes dist/viewer.html with one inline script, no stylesheet link, and the empty state", () => {
  assert.ok(existsSync(built));
  const r = runBuild();
  assert.match(r.stdout, /^viewer: .*dist[\\/]viewer\.html \d+\n$/);
  const html = readFileSync(built, "utf8");
  const dom = loadBuilt(built);
  const doc = dom.window.document;
  const code = [...doc.querySelectorAll("script")].filter((s) => !s.src && (s.type === "" || s.type === "text/javascript"));
  assert.equal(code.length, 1);
  assert.equal(doc.querySelectorAll("script[src]").length, 0);
  assert.equal(doc.querySelectorAll('link[rel="stylesheet"]').length, 0);
  assert.ok(/<link[^>]+rel=["']?stylesheet/i.test(html) === false);
  assert.match(doc.body.textContent, /Open a Warp run/);
  assert.equal(doc.getElementById("warp-data").textContent, "null");
  for (const id of ["meta", "fileMenu", "reloadBtn", "themeBtn", "printBtn", "actionsBar", "emptyState", "app", "title", "subline", "chainline", "tabs", "metrics", "util", "legend", "q", "viewSeg", "groupBy", "colorBy", "zoom", "view", "sources", "generated", "scrim", "drawer", "tip", "toasts", "fileInput", "dirInput", "warp-data"]) {
    assert.ok(doc.getElementById(id), `#${id} is in the shell`);
  }
  assert.ok(doc.querySelector("header.top"));
  dom.window.close();
});

test("AC-1: a data slot fixture is placed in #warp-data", () => {
  const dom = loadBuilt(built, { files: [] });
  assert.equal(dom.window.document.getElementById("warp-data").textContent, '{"files":[]}');
  dom.window.close();
});

test("AC-3: the built file contains no http:// or https:// and no fetch", () => {
  const html = readFileSync(built, "utf8");
  assert.equal(html.includes("http://"), false);
  assert.equal(html.includes("https://"), false);
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|\beval\s*\(|new Function/.test(html), false);
});

test("AC-4: a CSS file that fails to parse exits 1, names the file and leaves no viewer.html", () => {
  const root = scratch();
  try {
    mkdirSync(join(root, "src", "styles"));
    writeFileSync(join(root, "src", "styles", "ok.css"), "body { margin: 0 }\n");
    writeFileSync(join(root, "src", "styles", "broken.css"), "body { color: red;; } } @media ( {\n");
    const r = runBuild(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /broken\.css/);
    assert.equal(existsSync(join(root, "dist", "viewer.html")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC-4: a missing src/main.mjs exits 1, names the file and leaves no viewer.html", () => {
  const root = scratch();
  try {
    rmSync(join(root, "src", "main.mjs"));
    const r = runBuild(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /main\.mjs/);
    assert.equal(existsSync(join(root, "dist")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC-4: a main.mjs that fails to bundle exits 1 and leaves no viewer.html", () => {
  const root = scratch();
  try {
    writeFileSync(join(root, "src", "main.mjs"), 'import "./nope.mjs";\n');
    const r = runBuild(root);
    assert.equal(r.status, 1);
    assert.equal(existsSync(join(root, "dist", "viewer.html")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC-1: CSS under src/styles/ comes first, then the rest in path order, all inlined", () => {
  const root = scratch();
  try {
    mkdirSync(join(root, "src", "styles"));
    mkdirSync(join(root, "src", "view"));
    writeFileSync(join(root, "src", "view", "a.css"), ".from-view { order: 3 }\n");
    writeFileSync(join(root, "src", "styles", "z.css"), ".from-z { order: 2 }\n");
    writeFileSync(join(root, "src", "styles", "a.css"), ".from-a { order: 1 }\n");
    const r = runBuild(root);
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(root, "dist", "viewer.html"), "utf8");
    const at = (s) => html.indexOf(s);
    assert.ok(at(".from-a") > 0 && at(".from-a") < at(".from-z") && at(".from-z") < at(".from-view"));
    assert.equal((html.match(/<style>/g) || []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC-5: release writes the file beside app/, not under dist/", () => {
  const root = scratch();
  try {
    const app = join(root, "app");
    mkdirSync(join(app, "src"), { recursive: true });
    cpSync(join(root, "src"), join(app, "src"), { recursive: true });
    const r = spawnSync(process.execPath, [buildJs, "--release", "--root", app], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(root, "viewer.html")));
    assert.equal(existsSync(join(app, "dist")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
