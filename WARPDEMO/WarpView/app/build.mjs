import { build as esbuild, transform } from "esbuild";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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

export async function build({ root = here, release = false } = {}) {
  const src = join(root, "src");
  const shellPath = join(src, "shell.html");
  const mainPath = join(src, "main.mjs");
  for (const p of [shellPath, mainPath]) {
    if (!existsSync(p)) throw new BuildError(relative(root, p).split(sep).join("/"), "file not found");
  }

  const css = [];
  for (const file of listCss(src)) {
    const name = relative(root, file).split(sep).join("/");
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
    });
    js = res.outputFiles[0].text;
  } catch (e) {
    const first = e.errors && e.errors[0];
    const file = first && first.location ? first.location.file : "src/main.mjs";
    throw new BuildError(file, first ? first.text : e.message);
  }

  const shell = readFileSync(shellPath, "utf8");
  const styleTag = css.length ? `<style>\n${css.join("\n")}\n</style>` : "";
  const scriptTag = `<script>\n${js.replace(/<\/script/gi, "<\\/script")}</script>`;
  if (!shell.includes("<!--warp:styles-->") || !shell.includes("<!--warp:script-->")) {
    throw new BuildError("src/shell.html", "missing <!--warp:styles--> or <!--warp:script--> marker");
  }
  const html = shell.replace("<!--warp:styles-->", () => styleTag).replace("<!--warp:script-->", () => scriptTag);

  const out = release ? resolve(root, "..", "viewer.html") : join(root, "dist", "viewer.html");
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, html);
    renameSync(tmp, out);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { path: out, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--root");
  const root = ri >= 0 ? resolve(args[ri + 1]) : here;
  try {
    const { path, bytes } = await build({ root, release: args.includes("--release") });
    console.log(`viewer: ${path} ${bytes}`);
  } catch (e) {
    console.error(`build failed: ${e.message}`);
    process.exit(1);
  }
}
