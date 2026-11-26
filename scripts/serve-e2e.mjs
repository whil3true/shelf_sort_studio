import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const prefix = '/shelf_sort_studio/';
const dist = resolve('dist');
if (!existsSync(resolve(dist, 'index.html'))) throw Error('Run npm run build before browser tests.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path.startsWith(prefix) ? resolve(dist, path.slice(prefix.length) || 'index.html') : '';
  if (!name.startsWith(dist + sep) || !existsSync(name) || !statSync(name).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const type = types[extname(name)] ?? 'application/octet-stream';
  const { size } = statSync(name);
  if (type === 'audio/ogg' && req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    const start = range?.[1] ? Number(range[1]) : Math.max(0, size - Number(range?.[2] ?? 0));
    const end = range?.[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}` });
    createReadStream(name, { start, end }).pipe(res);
    return;
  }
  const headers = { 'Content-Type': type, 'Content-Length': size };
  res.writeHead(200, type === 'audio/ogg' ? { ...headers, 'Accept-Ranges': 'bytes' } : headers);
  createReadStream(name).pipe(res);
}).listen(4175, '127.0.0.1');
