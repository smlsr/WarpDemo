import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { loadBuilt } from "./dom.mjs";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pack = join(appDir, "..", "..");
const viewApp = join(pack, "WarpView", "app");
const built = join(appDir, "dist", "editor.html");
const buildJs = join(appDir, "build.mjs");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

function run(...args) {
  return spawnSync(process.execPath, [buildJs, ...args], { encoding: "utf8" });
}

// The viewer, bundled from WarpView's own entry and shell, as the reference for AC-4.
async function bundleViewer() {
  const src = join(viewApp, "src");
  const css = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".css")) css.push(readFileSync(p, "utf8"));
    }
  };
  walk(src);
  const res = await esbuild({ entryPoints: [join(src, "main.mjs")], bundle: true, format: "iife", target: "es2020", write: false, logLevel: "silent" });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  return readFileSync(join(src, "shell.html"), "utf8")
    .replace("<!--warp:styles-->", () => `<style>\n${css.join("\n")}\n</style>`)
    .replace("<!--warp:script-->", () => `<script>\n${js}</script>`);
}

let scratchDir;
let viewerFile;
let bareFile;
before(async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  scratchDir = mkdtempSync(join(tmpdir(), "warpedit-build-"));
  viewerFile = join(scratchDir, "viewer.html");
  writeFileSync(viewerFile, await bundleViewer());
  bareFile = join(scratchDir, "bare-editor.html");
  const b = run("--no-plugins", "--out", bareFile);
  assert.equal(b.status, 0, b.stderr);
});

test("AC-1: build writes dist/editor.html with the title 'Warp Editor', the 'Editing' badge and WarpView's empty state", () => {
  assert.ok(existsSync(built));
  const r = run();
  assert.match(r.stdout, /^editor: .*dist[\\/]editor\.html \d+\n$/);
  const dom = loadBuilt(built);
  const doc = dom.window.document;
  assert.equal(doc.title, "Warp Editor");
  const badge = doc.querySelector(".brand .ed-badge");
  assert.ok(badge, "badge is in the brand");
  assert.equal(badge.textContent, "Editing");
  assert.equal(badge.previousElementSibling.tagName, "SMALL");
  assert.match(doc.getElementById("emptyState").textContent, /Open a Warp run/);
  assert.equal(doc.getElementById("emptyState").classList.contains("hidden"), false);
  assert.equal(doc.getElementById("app").classList.contains("hidden"), true);
  assert.equal(doc.querySelectorAll("script[src]").length, 0);
  assert.equal(doc.querySelectorAll('link[rel="stylesheet"]').length, 0);
  const styles = [...doc.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  assert.match(styles, /--c-done/, "WarpView's CSS is inlined");
  assert.ok(styles.indexOf("--c-done") < styles.indexOf(".ed-badge"), "WarpView CSS comes before the editor's");
  dom.window.close();
});

test("AC-1: the dist build loads a beam through WarpView's modules", () => {
  const data = { files: [{ path: ".warp/beam.json", data: json(join(pack, "WarpEdit", "fixtures", "beam.sample.json")) }] };
  const dom = loadBuilt(built, data, { url: "file:///page.html" });
  const doc = dom.window.document;
  assert.equal(doc.getElementById("app").classList.contains("hidden"), false);
  assert.ok(doc.querySelectorAll("[data-id]").length > 0);
  dom.window.close();
});

test("AC-1: the built editor has no network reference, fetch or eval", () => {
  const html = readFileSync(built, "utf8").replace(/(["'`])https:\/\/\1/g, "");
  assert.equal(html.includes("http://"), false);
  assert.equal(html.includes("https://"), false);
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|\beval\s*\(|new Function/.test(html), false);
});

test("AC-1: a missing WarpView shell exits 1 and names the file", () => {
  const root = mkdtempSync(join(tmpdir(), "warpedit-noview-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "main.mjs"), "document.title = 'x';\n");
    const r = run("--root", root, "--view-root", join(root, "nope"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /shell\.html/);
    assert.equal(existsSync(join(root, "dist")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC-1: a CSS file under WarpEdit's src that fails to parse exits 1 and names it", () => {
  const root = mkdtempSync(join(tmpdir(), "warpedit-css-"));
  try {
    mkdirSync(join(root, "src", "edit"), { recursive: true });
    writeFileSync(join(root, "src", "main.mjs"), "document.title = 'x';\n");
    writeFileSync(join(root, "src", "edit", "broken.css"), "body { color: red;; } } @media ( {\n");
    const r = run("--root", root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /broken\.css/);
    assert.equal(existsSync(join(root, "dist")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC-4: with an empty plugin list the editor renders exactly like the viewer and has no edit control", () => {
  const files = [
    { path: ".warp/beam.json", data: json(join(pack, "WarpEdit", "fixtures", "beam.sample.json")) },
  ];
  const fixture = { files };
  const load = (file) => {
    const dom = loadBuilt(file, fixture, { url: "file:///page.html" });
    const doc = dom.window.document;
    const snap = {
      app: doc.getElementById("app").innerHTML,
      title: doc.getElementById("title").innerHTML,
      metrics: doc.getElementById("metrics").innerHTML,
      view: doc.getElementById("view").innerHTML,
      actions: doc.getElementById("actionsBar").innerHTML,
      actionsHidden: doc.getElementById("actionsBar").classList.contains("hidden"),
      drawer: null,
      edit: doc.querySelectorAll("[data-edit], [data-hook]").length,
      buttons: [...doc.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => /reset|save|undo|redo/i.test(t)),
    };
    const card = doc.querySelector("[data-id]");
    assert.ok(card, "a ticket is on screen");
    card.click();
    snap.drawer = doc.getElementById("drawer").innerHTML;
    dom.window.close();
    return snap;
  };
  const viewer = load(viewerFile);
  const editor = load(bareFile);
  assert.ok(viewer.app.length > 500, "the fixture rendered");
  assert.ok(viewer.drawer.includes("drawerClose"), "a ticket drawer opened");
  assert.equal(editor.edit, 0);
  assert.deepEqual(editor.buttons, []);
  assert.equal(editor.actions, "");
  assert.equal(editor.actionsHidden, true);
  assert.equal(editor.drawer.includes("Reset"), false);
  assert.deepEqual(editor, viewer);
});

test("AC-4: src/plugins.mjs is an array export and main.mjs hands it to createApp", () => {
  const plugins = readFileSync(join(appDir, "src", "plugins.mjs"), "utf8");
  assert.match(plugins, /export const plugins = \[/);
  const main = readFileSync(join(appDir, "src", "main.mjs"), "utf8");
  assert.match(main, /from "\.\.\/\.\.\/\.\.\/WarpView\/app\/src\/main\.mjs"/);
  assert.match(main, /createApp\(\{ root: document, plugins \}\)/);
});

test("AC-5: npm test is node --test and the release script writes editor.html beside app/", () => {
  const pkg = json(join(appDir, "package.json"));
  assert.equal(pkg.scripts.test, "node --test");
  assert.equal(pkg.scripts.build, "node build.mjs");
  assert.equal(pkg.scripts.release, "node build.mjs --release");
  assert.deepEqual(pkg.devDependencies, { esbuild: "0.24.0", jsdom: "25.0.1" });
});
