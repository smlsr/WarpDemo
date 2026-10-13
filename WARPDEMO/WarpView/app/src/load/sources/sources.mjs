import { parseTime } from "../../core/util.mjs";

export const WANTED = /(^|\/)(beam|status|state)[^/]*\.json$/i;
export const MAX_DEPTH = 7;
export const AUTO_INTERVAL_MS = 30000;
export const AUTO_KEY = "warp-dash:autoReload";

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "previous"]);
const JSON_TYPES = [{ description: "Warp status files", accept: { "application/json": [".json"] } }];

export const skipDir = (name) => {
  const n = String(name).toLowerCase();
  return SKIP_DIRS.has(n) || n.startsWith("previous-");
};
export const wanted = (path) => WANTED.test(String(path));
const isAbort = (e) => !!e && (e.name === "AbortError" || e.code === 20);
const hasWarpDir = (path) => /(^|\/)\.warp\//.test(path);

async function listHandle(dir) {
  const out = [];
  if (typeof dir.values === "function") {
    for await (const h of dir.values()) out.push({ name: h.name, isDir: h.kind === "directory", node: h });
  } else if (typeof dir.entries === "function") {
    for await (const [name, h] of dir.entries()) out.push({ name, isDir: h.kind === "directory", node: h });
  }
  return out;
}

function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function listEntry(dir) {
  const items = await readAllEntries(dir.createReader());
  return items.map((e) => ({ name: e.name, isDir: !!e.isDirectory, node: e }));
}

const handleSource = (path, node) => ({ path, handle: node });
const entrySource = (path, node) => ({ path, entry: node });

async function walk(dir, prefix, depth, list, mk, out) {
  let items;
  try {
    items = await list(dir);
  } catch {
    return;
  }
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const it of items) {
    const path = prefix + "/" + it.name;
    if (it.isDir) {
      if (depth < MAX_DEPTH && !skipDir(it.name)) await walk(it.node, path, depth + 1, list, mk, out);
    } else if (wanted(it.name)) out.push(mk(path, it.node));
  }
}

async function walkRoot(dir, name, list, mk) {
  const out = [];
  let items = [];
  try {
    items = await list(dir);
  } catch {
    items = [];
  }
  const warp = items.find((it) => it.isDir && it.name === ".warp");
  if (warp) await walk(warp.node, name + "/.warp", 0, list, mk, out);
  else await walk(dir, name, 0, list, mk, out);
  return out;
}

export const walkDirectoryHandle = (dir) => walkRoot(dir, dir.name, listHandle, handleSource);
export const walkDirectoryEntry = (dir) => walkRoot(dir, dir.name, listEntry, entrySource);

export function sourcesFromInputFolder(files) {
  const all = Array.from(files || [], (f) => ({ file: f, path: String(f.webkitRelativePath || f.name) }));
  const ok = all.filter(({ path }) => {
    const parts = path.split("/");
    const dirs = parts.slice(1, -1);
    return dirs.length <= MAX_DEPTH && !dirs.some(skipDir) && wanted(path);
  });
  const inWarp = ok.filter(({ path }) => hasWarpDir(path));
  return (inWarp.length ? inWarp : ok).map(({ file, path }) => ({ path, file })).sort((a, b) => (a.path < b.path ? -1 : 1));
}

const sourcesFromFiles = (files) => Array.from(files || [], (f) => ({ path: String(f.webkitRelativePath || f.name), file: f }));

function pickWithInput(doc, id, fromFiles) {
  return new Promise((resolve) => {
    const input = doc.getElementById(id);
    if (!input) return resolve([]);
    const done = (files) => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      resolve(files);
    };
    const onChange = () => {
      const files = Array.from(input.files || []);
      try {
        input.value = "";
      } catch {
        /* a read-only value is fine */
      }
      done(fromFiles(files));
    };
    const onCancel = () => done([]);
    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    input.click();
  });
}

export async function openFiles({ win, doc }) {
  if (win && typeof win.showOpenFilePicker === "function") {
    try {
      const handles = await win.showOpenFilePicker({ multiple: true, types: JSON_TYPES });
      return handles.map((h) => handleSource(h.name, h));
    } catch (e) {
      if (isAbort(e)) return [];
      throw e;
    }
  }
  return pickWithInput(doc, "fileInput", sourcesFromFiles);
}

export async function openFolder({ win, doc }) {
  if (win && typeof win.showDirectoryPicker === "function") {
    try {
      return await walkDirectoryHandle(await win.showDirectoryPicker({ mode: "read" }));
    } catch (e) {
      if (isAbort(e)) return [];
      throw e;
    }
  }
  return pickWithInput(doc, "dirInput", sourcesFromInputFolder);
}

export async function sourcesFromDrop(dataTransfer) {
  if (!dataTransfer) return [];
  const items = Array.from(dataTransfer.items || []).filter((i) => i.kind === "file");
  // DataTransfer is emptied after the first await, so every handle or entry is requested up front.
  const pending = items.map((item) => {
    if (typeof item.getAsFileSystemHandle === "function") return { kind: "handle", p: item.getAsFileSystemHandle() };
    if (typeof item.webkitGetAsEntry === "function") {
      const entry = item.webkitGetAsEntry();
      if (entry) return { kind: "entry", entry };
    }
    return { kind: "file", file: typeof item.getAsFile === "function" ? item.getAsFile() : null };
  });
  const files = Array.from(dataTransfer.files || []);
  const out = [];
  let any = false;
  for (const p of pending) {
    try {
      if (p.kind === "handle") {
        const h = await p.p;
        if (!h) continue;
        any = true;
        if (h.kind === "directory") out.push(...(await walkDirectoryHandle(h)));
        else out.push(handleSource(h.name, h));
      } else if (p.kind === "entry") {
        any = true;
        if (p.entry.isDirectory) out.push(...(await walkDirectoryEntry(p.entry)));
        else out.push(entrySource(p.entry.name, p.entry));
      } else if (p.file) {
        any = true;
        out.push(...sourcesFromFiles([p.file]));
      }
    } catch {
      /* one unreadable item does not stop the others */
    }
  }
  return any ? out : sourcesFromFiles(files);
}

async function fileOf(src) {
  if (src.handle) return src.handle.getFile();
  if (src.entry) return new Promise((resolve, reject) => src.entry.file(resolve, reject));
  return src.file;
}

async function textOf(file) {
  if (file && typeof file.text === "function") return file.text();
  if (file && typeof file.arrayBuffer === "function") return new TextDecoder().decode(await file.arrayBuffer());
  throw new Error("file cannot be read");
}

export async function readSources(sources) {
  const docs = [];
  const errors = [];
  for (const src of Array.isArray(sources) ? sources : []) {
    try {
      const file = await fileOf(src);
      const text = await textOf(file);
      const data = JSON.parse(text);
      const m = file && typeof file.lastModified === "number" ? file.lastModified : null;
      docs.push({ path: src.path, data, modified: m });
    } catch (e) {
      errors.push({ path: src.path, error: e && e.message ? e.message : String(e), reopen: !src.handle && !src.entry });
    }
  }
  return { docs, errors };
}

export function embeddedDocs(doc) {
  const el = doc && doc.getElementById ? doc.getElementById("warp-data") : null;
  if (!el) return [];
  let payload;
  try {
    payload = JSON.parse(el.textContent || "null");
  } catch {
    return [];
  }
  if (!payload || !Array.isArray(payload.files)) return [];
  const gen = payload.generatedAt != null ? parseTime(payload.generatedAt) : null;
  return payload.files
    .filter((f) => f && typeof f.path === "string" && "data" in f)
    .map((f) => ({ path: f.path, data: f.data, modified: Number.isFinite(gen) ? gen : null }));
}

export async function reload({ win, doc, sources = [] }) {
  if (!sources.length && embeddedDocs(doc).length) {
    win.location.reload();
    return { mode: "page", docs: [], errors: [], message: "" };
  }
  if (!sources.length) return { mode: "none", docs: [], errors: [], message: "Nothing to reload. Open files first." };
  const { docs, errors } = await readSources(sources);
  const reopen = errors.some((e) => e.reopen);
  const message = errors.length
    ? reopen
      ? "Could not re-read some files. Open them again."
      : "Could not re-read " + errors.length + " file" + (errors.length === 1 ? "" : "s") + "."
    : "";
  return { mode: "sources", docs, errors, message };
}

export function createAutoReload({ win, doc, onTick, interval = AUTO_INTERVAL_MS }) {
  let on = false;
  let timer = null;

  const load = () => {
    try {
      return win.localStorage.getItem(AUTO_KEY) === "1";
    } catch {
      return false;
    }
  };
  const save = (v) => {
    try {
      win.localStorage.setItem(AUTO_KEY, v ? "1" : "0");
    } catch {
      /* the choice stays for this session only */
    }
  };
  const visible = () => !doc || doc.visibilityState !== "hidden";
  const stop = () => {
    if (timer != null) {
      win.clearInterval(timer);
      timer = null;
    }
  };
  const start = () => {
    stop();
    timer = win.setInterval(() => {
      if (!visible()) return;
      try {
        const r = onTick && onTick();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch {
        /* a failed tick is retried on the next one */
      }
    }, interval);
  };
  const set = (v) => {
    on = !!v;
    save(on);
    if (on) start();
    else stop();
    return on;
  };

  on = load();
  if (on) start();

  return {
    get enabled() {
      return on;
    },
    set,
    toggle: () => set(!on),
    stop,
  };
}
