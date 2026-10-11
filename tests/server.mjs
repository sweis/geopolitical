// Minimal static server for tests (no dependencies).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function serve(port = 0) {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      const file = join(ROOT, path === '/' ? 'index.html' : path);
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(body);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    srv.listen(port, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) serve(+(process.argv[2] ?? 8080)).then(({ url }) => console.log(`serving ${ROOT} at ${url}`));
