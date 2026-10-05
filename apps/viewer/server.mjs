// Read-only static host for WarpView/ui. No dependencies, no write routes.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const UI_ROOT = resolve(here, '..', '..', 'WarpView', 'ui');
export const INDEX = 'build-map.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createViewer(root = UI_ROOT) {
  return createServer(async (req, res) => {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    // Read-only: only GET and HEAD are served.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(400, 'Bad Request', { 'Content-Type': 'text/plain' });
    }
    if (pathname.includes('\0')) return send(400, 'Bad Request', { 'Content-Type': 'text/plain' });
    if (pathname === '/') pathname = '/' + INDEX;
    const file = normalize(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      return send(403, 'Forbidden', { 'Content-Type': 'text/plain' });
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const data = await readFile(file);
      send(200, data, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    } catch {
      send(404, 'Not Found', { 'Content-Type': 'text/plain' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5173);
  const host = process.env.HOST || '127.0.0.1';
  createViewer().listen(port, host, () => {
    console.log(`WarpView viewer (read-only) serving ${UI_ROOT}`);
    console.log(`http://${host}:${port}/`);
  });
}
