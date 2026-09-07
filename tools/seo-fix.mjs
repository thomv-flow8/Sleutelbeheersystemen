#!/usr/bin/env node
/*
 * seo-fix.mjs — herstelt de SEO- en toegankelijkheidsstructuur van de
 * geexporteerde Claude Design-pagina's.
 *
 * Draai dit na ELKE export uit Claude Design:
 *     node tools/seo-fix.mjs
 *
 * Het script is idempotent: twee keer draaien geeft hetzelfde resultaat als
 * een keer. Alles wat het in de <head> zet staat tussen de markers
 * <!-- seo-fix:start --> en <!-- seo-fix:end -->, zodat een volgende run zijn
 * eigen werk terugdraait voordat hij opnieuw begint. Handmatige toevoegingen
 * aan de <head> buiten die markers blijven dus staan.
 *
 * Waarom dit nodig is: support.js verplaatst het <helmet>-blok pas tijdens
 * runtime naar de <head>. Crawlers en social scrapers (LinkedIn, WhatsApp,
 * Slack, Facebook) voeren geen JavaScript uit en zien die tags daardoor nooit.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? '.');
const START = '<!-- seo-fix:start -->';
const END = '<!-- seo-fix:end -->';

/* ---------------------------------------------------------------- helpers */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'tools' && entry.name !== 'node_modules') walk(p, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(p);
    }
  }
  return out;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : null;
};

/* Sleutel waarmee we bepalen of twee head-tags "hetzelfde" zijn. Zonder dit
 * zou de viewport-meta, die zowel in de <head> als in het helmet-blok staat,
 * na het verplaatsen dubbel in de head belanden. */
function keyOf(tag) {
  const lower = tag.toLowerCase();
  if (lower.startsWith('<title')) return 'title';
  if (lower.startsWith('<meta')) {
    if (/\bcharset\s*=/i.test(tag)) return 'charset';
    const name = attr(tag, 'name');
    if (name) return `name:${name.toLowerCase()}`;
    const prop = attr(tag, 'property');
    if (prop) return `prop:${prop.toLowerCase()}`;
    const equiv = attr(tag, 'http-equiv');
    if (equiv) return `equiv:${equiv.toLowerCase()}`;
    return `meta:${tag}`;
  }
  if (lower.startsWith('<link')) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href') ?? '';
    if (rel === 'alternate') return `hreflang:${(attr(tag, 'hreflang') ?? '').toLowerCase()}`;
    if (rel === 'canonical') return 'canonical';
    return `link:${rel}:${href}`;
  }
  return `other:${tag}`;
}

/* Alleen tags op het hoogste niveau van het helmet-blok tellen mee. Een regel
 * die toevallig binnen een <script> of <style> staat (JSON-LD bevat vaak
 * HTML-achtige tekst) mag niet verplaatst worden. */
function splitHelmet(inner) {
  const move = [];
  const keep = [];
  let depth = null;

  for (const line of inner.split('\n')) {
    const trimmed = line.trim();

    if (depth) {
      keep.push(line);
      if (new RegExp(`</${depth}\\s*>`, 'i').test(line)) depth = null;
      continue;
    }

    const open = trimmed.match(/^<(script|style)\b/i);
    if (open) {
      keep.push(line);
      if (!new RegExp(`</${open[1]}\\s*>`, 'i').test(line)) depth = open[1].toLowerCase();
      continue;
    }

    const isMoveable =
      /^<meta\b[^>]*>$/i.test(trimmed) ||
      /^<link\b[^>]*>$/i.test(trimmed) ||
      /^<title\b[^>]*>.*<\/title>$/i.test(trimmed);

    if (isMoveable) move.push(trimmed);
    else keep.push(line);
  }

  return { move, keep: keep.join('\n') };
}

/* ------------------------------------------------------------------ fixes */

/* Batch 1 — de SEO-head statisch uitleveren in plaats van pas na hydratie. */
function hoistHelmet(html, file) {
  /* Het blok van een vorige run wegnemen we alleen als het helmet-blok nu
   * opnieuw tags aanlevert. Anders zou een tweede run op een al verwerkt
   * bestand de hele SEO-head verwijderen zonder er iets voor terug te zetten. */
  const stripped = html.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}`, 'g'), '');

  const helmet = stripped.match(/(<helmet[^>]*>)([\s\S]*?)(<\/helmet>)/i);
  if (!helmet) return { html, moved: 0 };

  const { move, keep } = splitHelmet(helmet[2]);
  if (!move.length) return { html, moved: 0 };

  html = stripped;

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return { html, moved: 0 };

  // Wat al in de head staat niet nog een keer injecteren.
  const existing = new Set();
  for (const tag of headMatch[1].matchAll(/<(?:meta|link|title)\b[^>]*>(?:[^<]*<\/title>)?/gi)) {
    existing.add(keyOf(tag[0]));
  }

  const inject = [];
  const seen = new Set();
  for (const tag of move) {
    const key = keyOf(tag);
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    inject.push(tag);
  }

  // Uit het helmet-blok halen we alles weg wat we verplaatsen, ook de
  // duplicaten die we niet injecteren: die stonden immers al in de head.
  html = html.replace(helmet[0], `${helmet[1]}${keep}${helmet[3]}`);

  if (!inject.length) return { html, moved: 0 };

  const block = `\n${START}\n${inject.join('\n')}\n${END}`;
  html = html.replace(/<\/head>/i, `${block}\n</head>`);

  return { html, moved: inject.length };
}

/* De charset moet het eerste element in de head zijn; nu staat er een
 * resources-script voor. */
function charsetFirst(html) {
  const charset = html.match(/[ \t]*<meta\b[^>]*\bcharset\s*=[^>]*>\n?/i);
  if (!charset) return { html, changed: false };

  const head = html.match(/<head[^>]*>/i);
  if (!head) return { html, changed: false };

  const headEnd = head.index + head[0].length;
  // Staat hij al direct achter <head>? Dan niets doen.
  if (html.slice(headEnd, charset.index).trim() === '') return { html, changed: false };

  html = html.replace(charset[0], '');
  const head2 = html.match(/<head[^>]*>/i);
  const at = head2.index + head2[0].length;
  html = html.slice(0, at) + '\n' + charset[0].trim() + html.slice(at);

  return { html, changed: true };
}

/* Batch 3 — favicon. Ontbrak op alle 62 pagina's.
 *
 * Relatieve paden, geen absolute. Productie draait op de root van
 * www.sleutelbeheersystemen.nl, maar de testomgeving staat op GitHub Pages
 * onder /Sleutelbeheersystemen/. Een absolute "/favicon.ico" zou daar 404
 * geven. De rest van de site verwijst om dezelfde reden relatief
 * ("../fonts/InterVariable.woff2"), dus dit volgt de bestaande stijl. */
function faviconTags(relPath) {
  const depth = relPath.split('/').length - 1;
  const up = depth ? '../'.repeat(depth) : '';
  return [
    `<link rel="icon" href="${up}favicon.ico" sizes="32x32">`,
    `<link rel="icon" href="${up}photos/icons/favicon-512.png" type="image/png" sizes="512x512">`,
    `<link rel="apple-touch-icon" href="${up}photos/icons/favicon-180.png">`,
  ];
}

/* De stamboom is privé (robots.txt sluit hem in productie al uit, en de
 * sitemap bevat hem niet). Een Disallow houdt crawlers weg, maar voorkomt
 * niet dat een van elders gelinkte URL alsnog in de index komt; noindex wel. */
const PRIVATE = /^stamboom[\/\\]/;

/* Batch 4 — de datasheet- en werkinstructiepagina's staan wel in sitemap.xml,
 * maar kwamen zonder description, canonical of og-tags uit Claude Design.
 * De teksten staan in page-meta.json, afgeleid van de productpagina's. */
const SITE = 'https://www.sleutelbeheersystemen.nl/';
const META = JSON.parse(fs.readFileSync(new URL('./page-meta.json', import.meta.url), 'utf8'));

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function pageMeta(html, relPath) {
  const key = relPath.replace(/index\.html$/, '');
  const override = META[key];
  let changed = 0;

  /* Staat de pagina in page-meta.json, dan is die tekst leidend: hij vervangt
   * een bestaande description die te lang was, en og:/twitter:description
   * schuiven mee zodat ze niet uit elkaar gaan lopen. */
  if (override) {
    const d = escapeAttr(override);
    const current = html.match(/(<meta[^>]*name="description"[^>]*content=")([^"]*)(")/i);

    if (current && current[2] !== d) {
      const old = current[2];
      html = html.replace(current[0], `${current[1]}${d}${current[3]}`);
      changed++;
      for (const mirror of ['og:description', 'twitter:description']) {
        const sel = mirror.startsWith('og:') ? 'property' : 'name';
        const re = new RegExp(`(<meta[^>]*${sel}="${mirror}"[^>]*content=")([^"]*)(")`, 'i');
        const m = html.match(re);
        if (m && m[2] === old) { html = html.replace(m[0], `${m[1]}${d}${m[3]}`); changed++; }
      }
    }
  }

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return { html, added: changed };
  const head = headMatch[1];

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  const description =
    override ??
    (head.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || [, ''])[1];

  const url = SITE + key;
  const d = escapeAttr(description);
  const t = escapeAttr(title);

  /* og:title en og:description ontbraken op de meeste pagina's. Ze zijn af te
   * leiden uit de titel en de description, dus dat doen we voor elke pagina —
   * niet alleen voor de pagina's die in page-meta.json staan. */
  const wanted = [
    [/property="og:title"/i, `<meta property="og:title" content="${t}">`],
    [/property="og:description"/i, `<meta property="og:description" content="${d}">`],
    [/property="og:site_name"/i, '<meta property="og:site_name" content="DELPHI Sleutelbeheersystemen">'],
    [/name="twitter:card"/i, '<meta name="twitter:card" content="summary_large_image">'],
  ];

  if (override) {
    wanted.unshift(
      [/name="description"/i, `<meta name="description" content="${d}">`],
      [/rel="canonical"/i, `<link rel="canonical" href="${url}">`],
      [/property="og:url"/i, `<meta property="og:url" content="${url}">`],
      [/property="og:type"/i, '<meta property="og:type" content="article">'],
      [/property="og:image"/i, `<meta property="og:image" content="${SITE}photos/og-image.jpg">`],
    );
  }

  // Zonder description zijn og:description en twitter:card zinloos.
  const add = wanted
    .filter(([re, tag]) => !re.test(head) && !(tag.includes('content=""')))
    .map(([, tag]) => tag);

  if (!add.length) return { html, added: changed };

  return { html: html.replace(/<\/head>/i, `${add.join('\n')}\n</head>`), added: changed + add.length };
}

function headExtras(html, relPath) {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return { html, added: 0 };

  const head = headMatch[1];
  const add = [];

  for (const tag of faviconTags(relPath)) {
    const href = attr(tag, 'href');
    if (!head.includes(`href="${href}"`)) add.push(tag);
  }

  if (PRIVATE.test(relPath) && !/name="robots"/i.test(head)) {
    add.push('<meta name="robots" content="noindex, nofollow">');
  }

  if (!add.length) return { html, added: 0 };

  return {
    html: html.replace(/<\/head>/i, `${add.join('\n')}\n</head>`),
    added: add.length,
  };
}

/* Batch 5 — toegankelijkheid in de markup. Alleen statische attributen en
 * tekst, nooit een waarde waar support.js aan bindt. */
function a11yFixes(html) {
  let n = 0;

  /* Het zoekveld had alleen een placeholder. Die telt niet als toegankelijke
   * naam: schermlezers lezen hem niet betrouwbaar voor, en hij verdwijnt zodra
   * je typt. We nemen exact de placeholdertekst over als aria-label. */
  html = html.replace(
    /<input([^>]*\btype="search"[^>]*)>/gi,
    (match, attrs) => {
      if (/aria-label=/i.test(attrs)) return match;
      const placeholder = (attrs.match(/placeholder="([^"]*)"/i) || [, 'Zoeken'])[1];
      n++;
      return `<input${attrs} aria-label="${placeholder}">`;
    }
  );

  /* WCAG 2.5.3 (Label in Name): de toegankelijke naam moet de zichtbare tekst
   * bevatten. Zichtbaar staat er "Bellen", dus "Bel ..." voldoet niet — wie het
   * met spraakbediening probeert ("klik Bellen") krijgt geen match. */
  html = html.replace(/aria-label="Bel (\+[^"]*)"/g, (_m, nr) => {
    n++;
    return `aria-label="Bellen ${nr}"`;
  });

  return { html, changed: n };
}

/* De Engelse homepage toont in het mobiele menu het Nederlandse "Terug", waar
 * de andere Engelse pagina's "Back" tonen. Zichtbare tekst en aria-label
 * ("Back") liepen daardoor uiteen. Herstel dit ook in Claude Design, anders
 * komt het bij de volgende export terug. */
function backButtonLanguage(html, relPath) {
  if (!relPath.startsWith('en/') && relPath !== 'en/index.html') return { html, changed: 0 };

  let n = 0;
  html = html.replace(
    /(<button[^>]*aria-label="Back"[^>]*>[\s\S]{0,400}?)\bTerug\b/g,
    (_m, head) => { n++; return `${head}Back`; }
  );

  return { html, changed: n };
}

/* Batch 6 — <main>-landmark en skip-link.
 *
 * Op het top-niveau van de paginawrapper is de structuur overal
 * "nav > section... > footer". Alles tussen het einde van de nav en het begin
 * van de footer is de hoofdinhoud. Pagina's zonder nav (de datasheets) zijn in
 * hun geheel hoofdinhoud en krijgen geen skip-link, want er is niets om over
 * te slaan. */
const VOID_TAGS = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']);

/* Geeft de directe kindelementen van een fragment met hun posities. */
function topLevelChildren(fragment) {
  const children = [];
  let depth = 0;
  let open = null;

  for (const m of fragment.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const [full, close, tag, attrs] = m;
    const name = tag.toLowerCase();
    if (VOID_TAGS.has(name) || attrs.trimEnd().endsWith('/')) continue;

    if (close) {
      depth--;
      if (depth === 0 && open) {
        children.push({ name: open.name, start: open.start, end: m.index + full.length });
        open = null;
      }
      if (depth < 0) break; // sluittag van de wrapper zelf
      continue;
    }

    if (depth === 0) open = { name, start: m.index };
    depth++;
  }

  return children;
}

const SKIP_STYLE =
  '<style>.skip-link{position:absolute;left:-9999px;top:0;z-index:1000}' +
  '.skip-link:focus{left:8px;top:8px;padding:10px 16px;background:#1d1d1f;color:#fff;' +
  'border-radius:8px;font-size:15px;text-decoration:none}</style>';

function mainLandmark(html, relPath) {
  if (/<main\b/i.test(html)) return { html, changed: 0 };

  const helmetEnd = html.indexOf('</helmet>');
  const dcEnd = html.lastIndexOf('</x-dc>');
  if (helmetEnd < 0 || dcEnd < 0) return { html, changed: 0 };

  const offset = helmetEnd + '</helmet>'.length;
  const inner = html.slice(offset, dcEnd);

  // De paginawrapper: het eerste element op dit niveau.
  const wrapper = topLevelChildren(inner)[0];
  if (!wrapper || wrapper.name !== 'div') return { html, changed: 0 };

  const openTag = inner.slice(wrapper.start).match(/^<div\b[^>]*>/);
  if (!openTag) return { html, changed: 0 };

  const bodyStart = wrapper.start + openTag[0].length;
  const bodyEnd = wrapper.end - '</div>'.length;
  const children = topLevelChildren(inner.slice(bodyStart, bodyEnd));
  if (!children.length) return { html, changed: 0 };

  const nav = children.find((c) => c.name === 'nav');
  const footer = children.find((c) => c.name === 'footer');

  // Waar begint en eindigt de hoofdinhoud binnen de wrapper?
  const from = nav ? nav.end : 0;
  const to = footer ? footer.start : bodyEnd - bodyStart;
  if (to <= from) return { html, changed: 0 };

  const english = relPath.startsWith('en/') || /<html[^>]*lang="en"/i.test(html);
  const skip = nav
    ? `\n<a class="skip-link" href="#hoofdinhoud">${english ? 'Skip to main content' : 'Naar hoofdinhoud'}</a>`
    : '';

  const wrapperBody = inner.slice(bodyStart, bodyEnd);
  const rebuilt =
    skip +
    wrapperBody.slice(0, from) +
    '\n<main id="hoofdinhoud">' +
    wrapperBody.slice(from, to) +
    '</main>\n' +
    wrapperBody.slice(to);

  html =
    html.slice(0, offset + bodyStart) + rebuilt + html.slice(offset + bodyEnd);

  if (skip && !html.includes('class="skip-link"><style>') && !html.includes('.skip-link{')) {
    html = html.replace(/<\/head>/i, `${SKIP_STYLE}\n</head>`);
  }

  return { html, changed: 1 };
}

/* Prijzen staan bewust niet op de site. Een Offer zonder price is daardoor
 * onjuist: Google verwacht bij een Offer een prijs, en squirrel markeert hem
 * als incompleet. Het eerlijke antwoord is geen Offer opnemen — de rest van
 * het Product-schema (naam, merk, afbeelding) blijft gewoon staan. */
function dropEmptyOffers(html) {
  let n = 0;

  html = html.replace(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    (match, json) => {
      let data;
      try { data = JSON.parse(json); } catch { return match; }

      let touched = false;
      const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== 'object') return;
        if (node['@type'] === 'Product' && node.offers && node.offers.price === undefined) {
          delete node.offers;
          touched = true;
        }
        Object.values(node).forEach(visit);
      };
      visit(data);

      if (!touched) return match;
      n++;
      return `<script type="application/ld+json">\n${JSON.stringify(data, null, 1)}\n</script>`;
    }
  );

  return { html, changed: n };
}

/* GEEN placeholder-herschrijving. Toegelicht omdat de verleiding groot is:
 *
 * De uitgeleverde HTML bevat href="{{ khHref }}" en aria-pressed="{{ ... }}".
 * Crawlers die geen JavaScript draaien zien die als kapotte links en als
 * ongeldige ARIA-waarden. Het ligt voor de hand ze te vervangen door een
 * inerte "#" of "false".
 *
 * Dat mag niet. compileAttr() in support.js (regel 401) bepaalt de binding
 * uit de waarde van het attribuut zelf: staat er geen {{ }} in, dan compileert
 * het naar een constante. collectProps() (regel 440) stuurt elk attribuut
 * daardoorheen, zonder uitzondering voor href. Het vervangen van de waarde
 * verbreekt dus de binding: de aanbevelings-CTA op de homepage zou permanent
 * naar "#" wijzen en de keuzehulp-knoppen zouden voor schermlezers altijd
 * "niet ingedrukt" melden.
 *
 * De juiste plek voor deze fix is de bron in Claude Design (bind de href via
 * een handler in plaats van via een mustache in het attribuut). Tot die tijd
 * houden we de crawl-schade beperkt met een Disallow-regel in robots.txt. */

/* ------------------------------------------------------------------- main */

const files = walk(ROOT);
let totals = { hoisted: 0, charset: 0, extras: 0, meta: 0, a11y: 0, main: 0, offers: 0, touched: 0 };

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const before = fs.readFileSync(file, 'utf8');
  let html = before;

  const a = hoistHelmet(html, file); html = a.html;
  const b = charsetFirst(html); html = b.html;
  const c = headExtras(html, rel); html = c.html;
  const d = pageMeta(html, rel); html = d.html;
  const e = a11yFixes(html); html = e.html;
  const g = backButtonLanguage(html, rel); html = g.html;
  const m = mainLandmark(html, rel); html = m.html;
  const o = dropEmptyOffers(html); html = o.html;

  if (html !== before) {
    fs.writeFileSync(file, html);
    totals.touched++;
    totals.hoisted += a.moved;
    totals.charset += b.changed ? 1 : 0;
    totals.extras += c.added;
    totals.meta += d.added;
    totals.a11y += e.changed + g.changed;
    totals.main += m.changed;
    totals.offers += o.changed;
    console.log(
      `${rel}  head+${a.moved}${b.changed ? ' charset' : ''}` +
      `${c.added ? ` extra:${c.added}` : ''}${d.added ? ` meta:${d.added}` : ''}` +
      `${e.changed + g.changed ? ` a11y:${e.changed + g.changed}` : ''}` +
      `${m.changed ? ' main' : ''}${o.changed ? ` offers:${o.changed}` : ''}`
    );
  }
}

console.log(
  `\n${totals.touched}/${files.length} bestanden aangepast · ` +
  `${totals.hoisted} tags naar <head> · ${totals.charset}x charset vooraan · ` +
  `${totals.main}x main+skip · ${totals.offers}x offers · ${totals.a11y} a11y-fixes · ${totals.extras} favicon|robots · ${totals.meta} SEO-tags bijgeplaatst`
);
