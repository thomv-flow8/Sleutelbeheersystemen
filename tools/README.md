# tools/

Hulpmiddelen voor het nabewerken en controleren van de site. Deze map is
alleen voor ontwikkeling en hoeft niet mee naar de webserver.

## Werkwijze na een export uit Claude Design

Claude Design levert de SEO-tags aan in een `<helmet>`-blok in de `<body>`.
`support.js` verplaatst dat blok pas tijdens runtime naar de `<head>`. Crawlers
en social scrapers (LinkedIn, WhatsApp, Slack, Facebook) voeren geen JavaScript
uit en zien die tags daardoor nooit. Draai daarom na **elke** export:

```bash
node tools/seo-fix.mjs
node tools/seo-check.mjs
```

`seo-fix.mjs` is idempotent — twee keer draaien geeft hetzelfde resultaat als
een keer. Alles wat het in de `<head>` plaatst staat tussen de markers
`<!-- seo-fix:start -->` en `<!-- seo-fix:end -->`, zodat een volgende run zijn
eigen werk netjes vervangt. Wat je zelf buiten die markers in de `<head>` zet,
blijft staan.

Wat het script doet:

1. Verplaatst `<title>`, `<meta>` en `<link>` uit `<helmet>` naar de `<head>`.
2. Zet `<meta charset>` vooraan in de `<head>`.
3. Voegt favicon-links toe (relatieve paden, per paginadiepte berekend).
4. Zet `noindex` op de privé stamboom-sectie.
5. Past de teksten uit `page-meta.json` toe en vult ontbrekende
   `og:`- en `twitter:`-tags aan.
6. Voegt een `aria-label` toe aan het zoekveld en herstelt twee
   toegankelijkheidsfouten in labels.

## page-meta.json

Meta descriptions per pagina. Twee soorten: pagina's die uit Claude Design
komen zónder description (de datasheets en werkinstructies), en pagina's
waarvan de description langer was dan 160 tekens en hier is ingekort.
Houd elke regel onder 160 tekens; `seo-check.mjs` bewaakt dat.

## Lokaal bekijken

```bash
node tools/serve.mjs 4173
```

Serveert de map vanaf de root, net als productie. Handig om te controleren
vóór publiceren. De server heeft ook een `POST /__save`-endpoint dat gebruikt
is om de og-image en de favicons te genereren; die is alleen voor lokaal
gebruik.

## Wat dit script NIET oplost

Twee dingen horen thuis in de bron in Claude Design, niet in een nabewerking:

- **`{{ }}` in attributen.** De uitgeleverde HTML bevat `href="{{ khHref }}"`
  en `aria-pressed="{{ ... }}"`. Crawlers zien die als kapotte links en als
  ongeldige ARIA-waarden. Ze hier vervangen kán niet: `compileAttr()` in
  `support.js` leidt de binding af uit de attribuutwaarde zelf, dus een
  vervangen waarde verbreekt de binding en zet de aanbevelings-CTA permanent
  op `#`.
- **`<li>` en `<ul>` met een template-element ertussen.** Na rendering klopt
  de lijst, in de uitgeleverde HTML niet.

## Vóór publiceren naar productie

`robots.txt` staat nu op `Disallow: /` voor de GitHub-testomgeving. De
productieversie staat als commentaar in het bestand zelf.
