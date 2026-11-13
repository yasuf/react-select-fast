// Minimal static server for the benchmark page: node bench/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 5199);
const types = { '.html': 'text/html', '.js': 'text/javascript' };

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(root, path === '/' ? 'index.html' : path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () =>
  console.log(`bench at http://127.0.0.1:${port}/`)
);
