/* Controleert of alle inline <script>-blokken in de pagina's nog parsen.
 * Draai dit na elke wijziging die JavaScript in de HTML raakt:
 *     node tools/js-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(process.argv[2] ?? '.');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['.git', 'tools', 'node_modules'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

let blocks = 0;
let overgeslagen = 0;
const fouten = [];

for (const file of walk(ROOT)) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  let i = 0;

  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    i++;
    const [, attrs, code] = m;

    if (/\bsrc\s*=/i.test(attrs)) continue;                 // extern bestand
    if (/type\s*=\s*"application\/ld\+json"/i.test(attrs)) { // JSON-LD apart valideren
      try { JSON.parse(code); } catch (e) { fouten.push(`${rel} script#${i} (JSON-LD): ${e.message}`); }
      blocks++;
      continue;
    }
    if (code.includes('{{')) { overgeslagen++; continue; }   // templatesyntax, geen pure JS

    blocks++;
    try {
      new vm.Script(code, { filename: `${rel}#${i}` });
    } catch (e) {
      fouten.push(`${rel} script#${i}: ${e.message}`);
    }
  }
}

if (fouten.length) {
  console.log(`SYNTAXFOUTEN (${fouten.length}):`);
  for (const f of fouten) console.log('  ' + f);
  process.exit(1);
}
console.log(`OK — ${blocks} inline scriptblokken parsen${overgeslagen ? ` (${overgeslagen} met templatesyntax overgeslagen)` : ''}`);
