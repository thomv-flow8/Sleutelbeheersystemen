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
    } else if (entry.name.endsWith('.html') && entry.name !== '404.html') {
      /* 404.html blijft buiten schot. Die is met de hand gemaakt, komt niet
       * uit Claude Design, en gebruikt bewust absolute paden omdat Apache hem
       * ook toont op adressen als /producten/oud-artikel/ - waar een relatief
       * pad naar het verkeerde bestand wijst. */
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

/* Batch 7 (optie A) — contactlinks van query string naar fragment.
 *
 * "contact/?p=keybox" preselecteert het product in het contactformulier, maar
 * alles achter een "?" telt voor crawlers als een aparte pagina. Daardoor zag
 * de audit /contact/, /contact/?p=keybox en /contact/?p=sam als drie pagina's
 * met dezelfde titel en description. Alles achter een "#" wordt juist genegeerd,
 * dus met een fragment vallen ze samen tot één URL.
 *
 * De canonical wees al naar /contact/, dus voor Google was dit al opgelost;
 * dit ruimt het crawlen zelf op. */
function contactFragmentLinks(html) {
  const before = html;
  html = html.replaceAll('contact/?p=', 'contact/#p=');
  return { html, changed: html === before ? 0 : (before.split('contact/?p=').length - 1) };
}

/* De tegenhanger: het formulier moet de parameter nu uit de hash lezen. De
 * terugval op de query string houdt oude, gedeelde of opgeslagen ?p=-links
 * werkend. */
const PARAM_HELPER =
  `const leesParam = (naam) =>\n` +
  `      new URLSearchParams(location.hash.slice(1)).get(naam) ??\n` +
  `      new URLSearchParams(location.search).get(naam);\n    `;

function contactParamReader(html) {
  if (html.includes('const leesParam')) return { html, changed: 0 };
  if (!html.includes("new URLSearchParams(location.search).get('p')")) return { html, changed: 0 };

  let n = 0;

  // De helper komt vlak voor het eerste gebruik te staan.
  html = html.replace(
    "const p = new URLSearchParams(location.search).get('p');",
    `${PARAM_HELPER}const p = leesParam('p');`
  );
  n++;

  for (const naam of ['i', 'kh']) {
    const oud = `new URLSearchParams(location.search).get('${naam}')`;
    if (html.includes(oud)) { html = html.replaceAll(oud, `leesParam('${naam}')`); n++; }
  }

  return { html, changed: n };
}

/* Batch 8 (optie B) — beschrijvende namen voor de "Bekijken"-links.
 *
 * De documentatiepagina heeft 14 rijen die elk eindigen op "Bekijken ›" (of
 * "View ›"), naar 14 verschillende bestemmingen. Wie de pagina ziet leidt uit
 * de rij af waar de link heen gaat; wie een schermlezer de links laat opsommen
 * hoort veertien keer hetzelfde woord.
 *
 * De zichtbare tekst blijft staan, er komt alleen een aria-label bij. Dat label
 * begint met die zichtbare tekst, zodat het voldoet aan WCAG 2.5.3 (Label in
 * Name): de toegankelijke naam moet bevatten wat er staat, anders werkt
 * spraakbediening niet meer.
 *
 * De PDF-links ("Nederlands 0,7 MB") laten we bewust met rust: hun zichtbare
 * tekst is de samengetrokken string "nederlands0,7 mb", en een leesbaar label
 * dat die letterlijk bevat bestaat niet. Een label eromheen zou de ene regel
 * oplossen en 2.5.3 breken. */
function documentatieLinkNames(html, relPath) {
  if (!/^(en\/)?documentatie\/index\.html$/.test(relPath)) return { html, changed: 0 };

  let n = 0;

  html = html.replace(/<li\b[^>]*>[\s\S]*?<\/li>/g, (li) => {
    if (!/>(?:Bekijken|View)(?:&nbsp;|\s)*&rsaquo;/.test(li)) return li;

    const naam = (li.match(/<span[^>]*>([^<]+)<\/span>/) || [, ''])[1].trim();
    if (!naam) return li;

    /* Een eerder gezet label van onszelf halen we eerst weg, zodat een
     * verbeterde formulering ook op al verwerkte bestanden landt. */
    li = li.replace(/\s*aria-label="(?:Bekijken|View)[^"]*"/g, '');

    return li.replace(
      /(<a\b(?![^>]*aria-label)[^>]*>)((?:Bekijken|View)(?:&nbsp;|\s)*&rsaquo;)/,
      (_m, open, tekst) => {
        n++;
        const woord = tekst.startsWith('View') ? 'View' : 'Bekijken';
        /* Het label moet de zichtbare tekst letterlijk bevatten, chevron en al
         * (WCAG 2.5.3, Label in Name). "Bekijken: ..." voldeed daar niet aan,
         * omdat de zichtbare tekst "Bekijken ›" is. */
        return `${open.slice(0, -1)} aria-label="${woord} › ${naam} datasheet">${tekst}`;
      }
    );
  });

  return { html, changed: n };
}

/* Batch 9 — kapotte JSON-LD repareren.
 *
 * In het FAQ-schema op de sleutelringen-pagina's staat HTML binnen een
 * JSON-tekst:
 *
 *     "text": "... de <a href="#rvs" style="color:#0066cc">RVS keyring</a> ..."
 *
 * Die href=" sluit de JSON-string voortijdig af, waardoor het hele blok
 * ongeldig is en Google de complete FAQ negeert. De aanhalingstekens van de
 * HTML-attributen moeten geescaped worden.
 *
 * De reparatie is aan beide kanten afgeschermd: we proberen alleen te
 * repareren als het blok nu NIET parst, en we houden de reparatie alleen als
 * het daarna WEL parst. Blokken die al goed zijn blijven onaangeraakt, en een
 * andere soort fout laten we staan in plaats van hem te verergeren. */
function repairJsonLd(html) {
  let n = 0;

  html = html.replace(
    /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g,
    (match, open, body, close) => {
      try { JSON.parse(body); return match; } catch { /* stuk, dus repareren */ }

      /* Alleen `attribuut="waarde"` wordt geraakt. JSON-sleutels zien er anders
       * uit ("@type": "Question" heeft een dubbele punt tussen de quotes), dus
       * die vallen buiten dit patroon. */
      const fixed = body.replace(/([a-zA-Z-]+)="([^"]*)"/g, (_m, naam, waarde) => `${naam}=\\"${waarde}\\"`);

      try { JSON.parse(fixed); } catch { return match; }
      n++;
      return open + fixed + close;
    }
  );

  return { html, changed: n };
}

/* Batch 10 — VideoObject-schema voor de pagina's met een video.
 *
 * Alles wat Google verplicht stelt staat al in de pagina: de omschrijving in
 * het aria-label van de <video>, de thumbnail in het poster-attribuut, en de
 * afmetingen op de tag zelf. Alleen de titel en de duur komen uit
 * video-meta.json, plus een uploadDate (de lastmod uit sitemap.xml).
 *
 * Het blok wordt toegevoegd naast de bestaande JSON-LD; er verandert niets aan
 * de pagina zelf. */
const VIDEO_META = JSON.parse(fs.readFileSync(new URL('./video-meta.json', import.meta.url), 'utf8'));
const VIDEO_MARKER = 'data-seo-fix="video"';

function videoSchema(html, relPath) {
  const video = html.match(/<video\b[^>]*>/i);
  if (!video) return { html, changed: 0 };
  if (html.includes(VIDEO_MARKER)) return { html, changed: 0 };

  const tag = video[0];
  const src = attr(tag, 'src');
  const poster = attr(tag, 'poster');
  const omschrijving = attr(tag, 'aria-label');
  if (!src || !poster || !omschrijving) return { html, changed: 0 };

  const bestand = src.split('/').pop();
  const meta = VIDEO_META.videos[bestand];
  if (!meta) return { html, changed: 0 };

  const engels = relPath.startsWith('en/');
  const absoluut = (p) => SITE + p.replace(/^(\.\.\/)+/, '');

  const data = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: engels ? meta.name : meta.naam,
    description: omschrijving,
    thumbnailUrl: absoluut(poster),
    contentUrl: absoluut(src),
    uploadDate: VIDEO_META.uploadDate,
    duration: meta.duur,
    width: Number(attr(tag, 'width')) || undefined,
    height: Number(attr(tag, 'height')) || undefined,
    isFamilyFriendly: true,
    publisher: { '@type': 'Organization', name: 'DELPHI Sleutelbeheersystemen' },
  };

  const blok =
    `<script type="application/ld+json" ${VIDEO_MARKER}>\n` +
    JSON.stringify(data, null, 1) +
    `\n</script>`;

  return { html: html.replace(/<\/head>/i, `${blok}\n</head>`), changed: 1 };
}

/* Batch 11 — formulier- en tabeltoegankelijkheid, plus kleurcontrast. */
function a11yTail(html) {
  let n = 0;

  /* Zonder autocomplete-token biedt de browser opgeslagen adressen niet aan.
   * Dat kost iedereen tijd, en voor wie moeilijk typt is het een echte drempel. */
  const TOKENS = [
    [/\btype="email"/i, 'email'],
    [/\btype="tel"/i, 'tel'],
    [/\bname="(?:naam|name)"/i, 'name'],
    [/\bname="(?:org|organisatie|organisation|company)"/i, 'organization'],
  ];

  html = html.replace(/<input\b(?![^>]*autocomplete)([^>]*)>/gi, (match, attrs) => {
    const treffer = TOKENS.find(([re]) => re.test(attrs));
    if (!treffer) return match;
    n++;
    return `<input${attrs} autocomplete="${treffer[1]}">`;
  });

  /* enterkeyhint bepaalt wat het mobiele toetsenbord op de enter-toets zet.
   * Zonder token staat er "enter" in plaats van "volgende" of "verzenden". */
  html = html.replace(/<input\b(?![^>]*enterkeyhint)([^>]*\btype="(?:text|email|tel)"[^>]*)>/gi, (_m, attrs) => {
    n++;
    return `<input${attrs} enterkeyhint="next">`;
  });
  html = html.replace(/<textarea\b(?![^>]*enterkeyhint)([^>]*)>/gi, (_m, attrs) => {
    n++;
    return `<textarea${attrs} enterkeyhint="send">`;
  });

  /* Lichtgrijze hoofdletterlabels van 11px halen 3,62:1 op wit, waar 4,5:1
   * nodig is. #6e6e73 zit in dezelfde grijstint maar komt op 5,07:1. Alleen
   * deze combinatie wordt geraakt; #86868b op grotere tekst blijft staan. */
  const voor = html;
  html = html.replaceAll(
    'font-size:11px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#86868b',
    'font-size:11px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#6e6e73'
  );
  if (html !== voor) n += (voor.split('color:#86868b').length - 1) - (html.split('color:#86868b').length - 1);

  return { html, changed: n };
}

/* Tabellen zonder toegankelijke naam. Een schermlezer kondigt "tabel" aan
 * zonder te zeggen waarover hij gaat; wie er met de cursor in springt weet dan
 * niet waar hij is. Elke tabel heeft een kop vlak ervoor staan, en die nemen we
 * over als aria-label. Een zichtbare <caption> zou die kop verdubbelen. */
function tableNames(html) {
  let n = 0;
  const gebruikt = new Set();

  // Namen die er al staan tellen mee, anders maken we alsnog duplicaten.
  for (const m of html.matchAll(/<table\b[^>]*aria-label="([^"]*)"/gi)) gebruikt.add(m[1]);

  /* De koppen zijn zinnen en eindigen op een punt; als tabelnaam leest dat
   * raar wanneer een schermlezer hem aankondigt. */
  const schoon = (s) => s.trim().replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/[.:,]+$/, '');

  html = html.replace(/<table\b(?![^>]*aria-label)([^>]*)>/gi, (match, attrs, offset) => {
    const ervoor = html.slice(0, offset);

    /* Een echte kop heeft de voorkeur. Staat die er niet vlak voor, dan pakken
     * we de dichtstbijzijnde kop hoger in het document: bij een reeks
     * specificatietabellen onder één kop is dat de juiste context. */
    const koppen = [...ervoor.matchAll(/<(h[1-4])\b[^>]*>([^<]{3,80})<\/\1>/gi)];
    const dichtbij = [...ervoor.slice(-700).matchAll(/<span\b[^>]*>([^<]{3,70})<\/span>/gi)];

    let basis = koppen.length ? schoon(koppen[koppen.length - 1][2]) : '';
    if (!basis && dichtbij.length) basis = schoon(dichtbij[dichtbij.length - 1][1]);
    if (!basis || /^[\d.,\s]+$/.test(basis)) return match;

    /* Meerdere tabellen onder dezelfde kop zouden dezelfde naam krijgen, en
     * dat is precies wat deze regel afkeurt. De eerste rijkop onderscheidt ze. */
    let naam = basis;
    if (gebruikt.has(naam)) {
      const eersteTh = match.length && /<th\b/i.test(html.slice(offset, offset + 800))
        ? schoon((html.slice(offset, offset + 800).match(/<th\b[^>]*>([^<]{2,50})</i) || [, ''])[1])
        : '';
      if (eersteTh) naam = `${basis} — ${eersteTh}`;
    }

    let uniek = naam;
    let i = 2;
    while (gebruikt.has(uniek)) uniek = `${naam} (${i++})`;
    gebruikt.add(uniek);

    n++;
    return `<table${attrs} aria-label="${escapeAttr(uniek)}">`;
  });

  return { html, changed: n };
}

/* Batch 12 — taalattribuut op de datasheet- en werkinstructiepagina's.
 *
 * Die komen uit Claude Design met een kaal <html> zonder lang. Een schermlezer
 * weet dan niet in welke taal hij moet voorlezen en valt terug op de taal van
 * het systeem: een Nederlandse datasheet wordt dan met een Engelse uitspraak
 * voorgelezen, of andersom. */
function htmlLang(html, relPath) {
  if (/<html[^>]*\blang\s*=/i.test(html)) return { html, changed: 0 };
  const taal = relPath.startsWith('en/') ? 'en' : 'nl';
  const nieuw = html.replace(/<html(\s[^>]*)?>/i, (_m, rest) => `<html lang="${taal}"${rest ?? ''}>`);
  return { html: nieuw, changed: nieuw === html ? 0 : 1 };
}

/* Batch 13 — lazy loading op de printpagina's.
 *
 * De datasheets en werkinstructies zijn lange documenten met tientallen
 * hogeresolutiefoto's; vrijwel alles staat onder de vouw. De eerste twee
 * afbeeldingen slaan we over, want die staan bovenaan en moeten juist meteen
 * geladen worden. */
function lazyOpPrintpaginas(html, relPath) {
  if (!/^(en\/)?(datasheet|werkinstructie)\//.test(relPath)) return { html, changed: 0 };

  /* Gemeten op een scherm van 900px hoog: op deze pagina's staan de eerste
   * drie afbeeldingen nog in beeld (logo op 162px, en twee foto's op 376 en
   * 681px). Vanaf de vierde is het onder de vouw. */
  const BOVEN_DE_VOUW = 3;

  let n = 0;
  let gezien = 0;

  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    gezien++;

    /* Zowel toevoegen als weghalen, zodat een bijgestelde drempel ook op al
     * verwerkte bestanden landt. Alleen bij afwijking tellen we mee. */
    if (gezien <= BOVEN_DE_VOUW) {
      if (!/\bloading\s*=\s*"lazy"/i.test(tag)) return tag;
      n++;
      return tag.replace(/\s*loading\s*=\s*"lazy"/i, '');
    }

    if (/\bloading\s*=/i.test(tag)) return tag;
    n++;
    return tag.replace(/\s*\/?>$/, ' loading="lazy" decoding="async">');
  });

  return { html, changed: n };
}

/* Batch 14 — scrollpositie bij een stapwissel in het contactformulier.
 *
 * De drie stappen zitten in een sectie van ruim 2000px en worden getoond met
 * display:flex / display:none. Bij het wisselen wordt de scrollpositie niet
 * bijgesteld: op mobiel heb je naar beneden gescrold om uit de zes knoppen van
 * stap 1 te kiezen, en dan verschijnt de kortere stap 2 boven je kijkvenster.
 * Je kijkt dus onder het formulier en moet terug omhoog.
 *
 * De sectie heeft al scroll-margin-top:90px voor de plakkende navigatiebalk;
 * scrollIntoView() houdt daar zelf rekening mee. */
/* Markers, zodat een verbeterde versie ook op al verwerkte bestanden landt.
 * Zonder die markers zou het script zijn eigen oude code laten staan. */
const STAP_START = '/* seo-fix:stapscroll */';
const STAP_EIND = '/* einde seo-fix:stapscroll */';

const STAP_SCROLL = `
    ${STAP_START}
    /* Bij een stapwissel de bovenkant van het FORMULIER terugbrengen in beeld,
     * maar alleen als die er niet al staat - anders spring je op desktop
     * zonder reden.
     *
     * Let op: niet naar de sectie #aanvraag scrollen. Daar staan eerst de
     * contactgegevens, de kaart en het dealership-blok in; de bovenkant
     * daarvan ligt ruim 1100px boven het formulier, en dan lijkt het alsof je
     * naar de top van de pagina springt. De scroll-margin van de sectie nemen
     * we wel over, zodat de kop niet achter de plakkende navigatiebalk valt. */
    if (this._stap === undefined) this._stap = this.state.stap;
    else if (this._stap !== this.state.stap) {
      this._stap = this.state.stap;
      const sec = document.getElementById('aanvraag');
      const form = sec && sec.querySelector('form');
      if (form) {
        const marge = parseFloat(getComputedStyle(sec).scrollMarginTop) || 0;
        const top = form.getBoundingClientRect().top;
        if (top < marge || top > window.innerHeight * 0.5) {
          const rustig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          window.scrollTo({
            top: Math.max(0, top + window.scrollY - marge),
            behavior: rustig ? 'auto' : 'smooth'
          });
        }
      }
    }
    ${STAP_EIND}
`;

function stapScroll(html) {
  if (!html.includes('id="aanvraag"')) return { html, changed: 0 };

  /* Een blok van een vorige run er eerst uit, zodat een verbetering doorkomt.
   * Twee vormen: mét markers (huidige versie) en zonder (de allereerste versie,
   * die naar de sectie scrolde in plaats van naar het formulier). Die laatste
   * moet expliciet weg: bleef hij staan, dan draaide hij als eerste, zette
   * this._stap, en deed het nieuwe blok niets meer. Het oude gedrag won dan. */
  const metMarkers = new RegExp(
    `\\n?\\s*${STAP_START.replace(/[*/]/g, '\\$&')}[\\s\\S]*?${STAP_EIND.replace(/[*/]/g, '\\$&')}\\n?`,
    'g'
  );
  html = html.replace(metMarkers, '\n');

  const zonderMarkers = /\n\s*\/\* Bij een stapwissel[\s\S]*?sec\.scrollIntoView\([^;]*;\s*\}\s*\}\s*\}\n/g;
  html = html.replace(zonderMarkers, '\n');

  const doel = `    this._so = this.state.searchOpen;\n`;
  if (!html.includes(doel)) return { html, changed: 0 };

  const nieuw = html.replace(doel, `${doel}${STAP_SCROLL}`);
  return { html: nieuw, changed: nieuw === html ? 0 : 1 };
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
let totals = { hoisted: 0, charset: 0, extras: 0, meta: 0, a11y: 0, main: 0, offers: 0, fragment: 0, linkNames: 0, jsonld: 0, video: 0, lazy: 0, stap: 0, touched: 0 };

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
  const p = contactFragmentLinks(html); html = p.html;
  const q = contactParamReader(html); html = q.html;
  const s = documentatieLinkNames(html, rel); html = s.html;
  const j = repairJsonLd(html); html = j.html;
  const v = videoSchema(html, rel); html = v.html;
  const t = a11yTail(html); html = t.html;
  const u = tableNames(html); html = u.html;
  const w = htmlLang(html, rel); html = w.html;
  const x = lazyOpPrintpaginas(html, rel); html = x.html;
  const y = stapScroll(html); html = y.html;

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
    totals.fragment += p.changed + q.changed;
    totals.linkNames += s.changed;
    totals.jsonld += j.changed;
    totals.video += v.changed;
    totals.a11y += t.changed + u.changed + w.changed;
    totals.lazy += x.changed;
    totals.stap += y.changed;
    console.log(
      `${rel}  head+${a.moved}${b.changed ? ' charset' : ''}` +
      `${c.added ? ` extra:${c.added}` : ''}${d.added ? ` meta:${d.added}` : ''}` +
      `${e.changed + g.changed ? ` a11y:${e.changed + g.changed}` : ''}` +
      `${m.changed ? ' main' : ''}${o.changed ? ` offers:${o.changed}` : ''}` +
      `${p.changed ? ` fragment:${p.changed}` : ''}${q.changed ? ' paramlezer' : ''}` +
      `${s.changed ? ` linknamen:${s.changed}` : ''}${j.changed ? ` jsonld:${j.changed}` : ''}${v.changed ? ' video' : ''}${t.changed ? ` tail:${t.changed}` : ''}${u.changed ? ` tabellen:${u.changed}` : ''}${w.changed ? ' lang' : ''}${x.changed ? ` lazy:${x.changed}` : ''}${y.changed ? ' stapscroll' : ''}`
    );
  }
}

console.log(
  `\n${totals.touched}/${files.length} bestanden aangepast · ` +
  `${totals.hoisted} tags naar <head> · ${totals.charset}x charset vooraan · ` +
  `${totals.fragment} fragment-fixes · ${totals.linkNames} linknamen · ${totals.main}x main+skip · ${totals.offers}x offers · ${totals.a11y} a11y-fixes · ${totals.extras} favicon|robots · ${totals.meta} SEO-tags bijgeplaatst`
);
