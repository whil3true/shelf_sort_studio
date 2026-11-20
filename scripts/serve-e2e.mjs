import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const prefix = '/shelf_sort_studio/';
const dist = resolve('dist');
if (!existsSync(resolve(dist, 'index.html'))) throw Error('Run npm run build before browser tests.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path.startsWith(prefix) ? resolve(dist, path.slice(prefix.length) || 'index.html') : '';
  if (!name.startsWith(dist + sep) || !existsSync(name) || !statSync(name).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': types[extname(name)] ?? 'application/octet-stream' });
  createReadStream(name).pipe(res);
}).listen(4175, '127.0.0.1');
