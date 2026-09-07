/* Controleert of elke pagina precies een title, description en canonical in de
 * <head> heeft en geen meta/title meer in de <body>.
 *     node tools/seo-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['.git', 'tools', 'node_modules'].includes(e.name)) walk(p, out);
    } else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const count = (re, s) => (s.match(re) || []).length;
const files = walk('.');
const bad = [];

for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const head = (s.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
  const body = s.slice(s.search(/<body/i));

  /* Pagina's op noindex (de prive stamboom) worden niet geindexeerd en hebben
   * dus geen description of canonical nodig. */
  const noindex = /<meta[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(head);

  const r = {
    file: path.relative('.', f).split(path.sep).join('/'),
    title: count(/<title\b/gi, head),
    desc: count(/<meta[^>]*name="description"/gi, head),
    canonical: count(/<link[^>]*rel="canonical"/gi, head),
    ogTitle: count(/<meta[^>]*property="og:title"/gi, head),
    descLength: (head.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || [, ''])[1].length,
    bodyMeta: count(/<meta\b/gi, body),
    bodyTitle: count(/<title\b/gi, body),
    noindex,
  };

  const broken =
    r.title !== 1 || r.bodyMeta !== 0 || r.bodyTitle !== 0 ||
    (!noindex && (r.desc !== 1 || r.canonical !== 1 || r.descLength > 160));

  if (broken) bad.push(r);
}

if (!bad.length) {
  console.log(`OK — ${files.length} bestanden: 1 title + 1 description in de <head>, 0 meta/title in de <body>`);
} else {
  console.log(`AFWIJKINGEN (${bad.length} van ${files.length}):`);
  for (const r of bad) console.log(JSON.stringify(r));
}
