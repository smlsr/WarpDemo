// Loaders. Each source is optional; at least one must exist.
import { buildModel } from './model.mjs';

// Node: read from disk. A missing file is skipped, any other read error is thrown.
export async function loadModelFromFiles({ beam, status, schedule }) {
  const { readFile } = await import('node:fs/promises');
  const read = async (path) => {
    if (!path) return null;
    try {
      return await readFile(path, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    }
  };
  const [b, st, sc] = await Promise.all([read(beam), read(status), read(schedule)]);
  return buildModel({ beam: b, status: st, schedule: sc });
}

// Browser: GET each url with the given fetch. A 404 is skipped; other failures throw.
export async function loadModelFromUrls({ beam, status, schedule }, fetchImpl = globalThis.fetch) {
  const get = async (url) => {
    if (!url) return null;
    const res = await fetchImpl(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.text();
  };
  const [b, st, sc] = await Promise.all([get(beam), get(status), get(schedule)]);
  return buildModel({ beam: b, status: st, schedule: sc });
}
