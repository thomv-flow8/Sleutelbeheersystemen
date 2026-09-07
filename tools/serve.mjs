/* Minimale statische server om de site lokaal te controleren.
 *     node tools/serve.mjs [poort]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.argv[2] ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
  '.ico': 'image/x-icon', '.enc': 'application/octet-stream',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  /* Alleen voor lokaal gebruik: laat de pagina een gegenereerd bestand
   * (og-image, hercomprimeerde foto) wegschrijven naar de projectmap. Deze
   * server is een ontwikkelhulpmiddel en wordt niet meegepubliceerd. */
  if (req.method === 'POST' && url === '/__save') {
    const target = new URL(req.url, 'http://x').searchParams.get('path') ?? '';
    const dest = path.resolve(ROOT, target);
    if (!dest.startsWith(ROOT) || target.includes('..')) { res.writeHead(403).end('403'); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      console.log(`opgeslagen: ${target} (${buf.length} bytes)`);
      res.writeHead(200, { 'content-type': 'text/plain' }).end(String(buf.length));
    });
    return;
  }

  let file = path.join(ROOT, url);

  // Buiten de projectmap wijzen we af.
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('403'); return; }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + url);
    return;
  }

  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
