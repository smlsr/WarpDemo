import { build as esbuild, transform } from "esbuild";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const VIEW_APP = resolve(here, "..", "..", "WarpView", "app");

export const TITLE = "Warp Editor";
export const BADGE = "Editing";

// Tokens only: no color literal outside WarpView's tokens.css (AGENTS.md rule 8).
const BADGE_CSS = `.ed-badge { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 8px; border-radius: 99px; background: color-mix(in srgb, var(--c-qa) 20%, transparent); color: var(--c-qa); margin-left: 8px; }`;

function listCss(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".css")) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  const rel = (p) => relative(dir, p).split(sep).join("/");
  const styles = (p) => (rel(p).startsWith("styles/") ? 0 : 1);
  return out.sort((a, b) => styles(a) - styles(b) || (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0));
}

class BuildError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.file = file;
  }
}

export function brandWithBadge(shell) {
  const re = /(<div class="brand">[\s\S]*?<\/small>)/;
  if (!re.test(shell)) throw new BuildError("WarpView/app/src/shell.html", 'no <div class="brand"> with a <small> label to put the badge after');
  return shell.replace(re, (m) => `${m}<span class="ed-badge">${BADGE}</span>`);
}

export function editorShell(shell) {
  if (!/<title>[^<]*<\/title>/.test(shell)) throw new BuildError("WarpView/app/src/shell.html", "no <title>");
  return brandWithBadge(shell.replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`));
}

// Test seam: swaps src/plugins.mjs for an empty list so the editor can be compared with the viewer.
const emptyPlugins = {
  name: "warp-empty-plugins",
  setup(b) {
    b.onResolve({ filter: /(^|\/)plugins\.mjs$/ }, (a) => (a.importer.endsWith("main.mjs") ? { path: "plugins-empty", namespace: "warp-empty" } : null));
    b.onLoad({ filter: /.*/, namespace: "warp-empty" }, () => ({ contents: "export const plugins = [];", loader: "js" }));
  },
};

// WarpView's entry boots itself when #warp-data exists. The editor boots once, with its plugins,
// so that block is cut from the bundled copy. If WarpView changes it, the build says so.
const SELF_BOOT = /\n?if \(typeof document !== "undefined" && document\.getElementById\("warp-data"\)\) \{\s*createApp\(\{ root: document \}\);\s*\}\s*$/;

export function withoutSelfBoot(source) {
  if (!SELF_BOOT.test(source)) {
    throw new BuildError("WarpView/app/src/main.mjs", "the self-boot block at the end of the file changed; the editor must boot createApp once, with its plugins");
  }
  return source.replace(SELF_BOOT, "\n");
}

const viewEntry = (viewRoot) => ({
  name: "warp-view-entry",
  setup(b) {
    const entry = join(viewRoot, "src", "main.mjs");
    b.onLoad({ filter: /main\.mjs$/ }, (a) => {
      if (resolve(a.path) !== resolve(entry)) return null;
      return { contents: withoutSelfBoot(readFileSync(a.path, "utf8")), loader: "js", resolveDir: dirname(a.path) };
    });
  },
});

export async function build({ root = here, viewRoot = VIEW_APP, release = false, noPlugins = false, out = null } = {}) {
  const src = join(root, "src");
  const mainPath = join(src, "main.mjs");
  const shellPath = join(viewRoot, "src", "shell.html");
  const display = (p) => relative(root, p).split(sep).join("/");
  for (const p of [shellPath, mainPath]) {
    if (!existsSync(p)) throw new BuildError(display(p), "file not found");
  }

  const css = [];
  for (const file of [...listCss(join(viewRoot, "src")), ...listCss(src)]) {
    const name = display(file);
    const text = readFileSync(file, "utf8");
    try {
      const res = await transform(text, { loader: "css", logLevel: "silent" });
      if (res.warnings.length) throw new Error(res.warnings[0].text);
    } catch (e) {
      const first = e.errors && e.errors[0] ? e.errors[0] : null;
      const where = first && first.location ? ` line ${first.location.line}` : "";
      throw new BuildError(name, `CSS does not parse${where}: ${first ? first.text : e.message}`);
    }
    css.push(text);
  }
  css.push(BADGE_CSS);

  let js;
  try {
    const res = await esbuild({
      entryPoints: [mainPath],
      bundle: true,
      format: "iife",
      target: "es2020",
      minify: false,
      write: false,
      logLevel: "silent",
      plugins: [viewEntry(viewRoot), ...(noPlugins ? [emptyPlugins] : [])],
    });
    js = res.outputFiles[0].text;
  } catch (e) {
    const first = e.errors && e.errors[0];
    const file = first && first.location ? first.location.file : "src/main.mjs";
    throw new BuildError(file, first ? first.text : e.message);
  }

  const shell = editorShell(readFileSync(shellPath, "utf8"));
  if (!shell.includes("<!--warp:styles-->") || !shell.includes("<!--warp:script-->")) {
    throw new BuildError("WarpView/app/src/shell.html", "missing <!--warp:styles--> or <!--warp:script--> marker");
  }
  const styleTag = `<style>\n${css.join("\n")}\n</style>`;
  const scriptTag = `<script>\n${js.replace(/<\/script/gi, "<\\/script")}</script>`;
  const html = shell.replace("<!--warp:styles-->", () => styleTag).replace("<!--warp:script-->", () => scriptTag);

  const target = out ? resolve(out) : release ? resolve(root, "..", "editor.html") : join(root, "dist", "editor.html");
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, html);
    renameSync(tmp, target);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { path: target, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const val = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? resolve(args[i + 1]) : null;
  };
  try {
    const { path, bytes } = await build({
      root: val("--root") || here,
      viewRoot: val("--view-root") || VIEW_APP,
      release: args.includes("--release"),
      noPlugins: args.includes("--no-plugins"),
      out: val("--out"),
    });
    console.log(`editor: ${path} ${bytes}`);
  } catch (e) {
    console.error(`build failed: ${e.message}`);
    process.exit(1);
  }
}
