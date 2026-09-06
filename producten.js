// Productgegevens van de site — één bron voor alle pagina's.
// Naam, pagina, categorie, foto en alt-tekst van een product staan hier en nergens anders.
// Gebruikt door: de keuzehulp op de homepage (NL + EN) en het contactformulier (NL + EN).
//
// Een product wijzigen of toevoegen? Alleen dit bestand aanpassen. Velden:
//   id        interne sleutel (wordt gebruikt in de keuzehulp)
//   slug      waarde achter ?p= in de link naar het contactformulier
//   aliassen  andere slugs die elders op de site naar dit product verwijzen
//   naam/naamEN, url/urlEN, categorie/categorieEN, cta/ctaEN
//   foto, fotoB, fotoH, alt/altEN   (foto: null als het product geen keuzehulp-foto heeft)
//   datasheet  middenstuk van de bestandsnaam in datasheets/ (null = geen datasheet)
(function () {
  var producten = [
    {
      id: 'sam',
      datasheet: 'SAM', slug: 'sam', aliassen: [],
      naam: 'Security Asset Manager', naamEN: 'Security Asset Manager',
      url: 'sam/', urlEN: 'en/sam/',
      categorie: 'Sleutelbeheersysteem', categorieEN: 'Key management system',
      cta: 'SAM bekijken', ctaEN: 'View SAM',
      foto: 'photos/cut/panel-32.webp', fotoB: 636, fotoH: 912,
      alt: 'Security Asset Manager met sleutelposities achter een geopende deur',
      altEN: 'Security Asset Manager with key positions behind an open door'
    },
    {
      id: 'keybox',
      datasheet: 'Keybox', slug: 'keybox', aliassen: [],
      naam: 'Keybox', naamEN: 'Keybox',
      url: 'keybox/', urlEN: 'en/keybox/',
      categorie: 'Sleutelbeheersysteem', categorieEN: 'Key management system',
      cta: 'Keybox bekijken', ctaEN: 'View Keybox',
      foto: 'photos/cut/keybox-system-6.webp', fotoB: 1600, fotoH: 1224,
      alt: 'Keybox sleutelkast met codepaneel en display',
      altEN: 'Keybox key cabinet with keypad and display'
    },
    {
      id: 'safebox',
      datasheet: null, slug: 'safebox', aliassen: [],
      naam: 'Safebox', naamEN: 'Safebox',
      url: 'safebox/', urlEN: 'en/safebox/',
      categorie: 'Sleutelkast of kluis', categorieEN: 'Key cabinet or safe',
      cta: 'Safebox bekijken', ctaEN: 'View Safebox',
      foto: 'photos/safebox-58-transparant.webp', fotoB: 898, fotoH: 1160,
      alt: 'Zwarte Safebox 58 sleutelkluis met toetsenblok',
      altEN: 'Black Safebox 58 key safe with keypad'
    },
    {
      id: 'swat',
      datasheet: 'SWATbox', slug: 'swatbox', aliassen: [],
      naam: 'SWAT-box', naamEN: 'SWAT-box',
      url: 'swat-box/', urlEN: 'en/swat-box/',
      categorie: 'Sleutelkast of kluis', categorieEN: 'Key cabinet or safe',
      cta: 'SWAT-box bekijken', ctaEN: 'View SWAT-box',
      foto: 'photos/cut/swat-hero.webp', fotoB: 1300, fotoH: 1414,
      alt: 'SWAT-box voor mobiele sleuteluitgifte',
      altEN: 'SWAT-box for mobile key issue'
    },
    {
      id: 'keycontroller',
      datasheet: 'Keycontroller', slug: 'keycontroller', aliassen: [],
      naam: 'Keycontroller', naamEN: 'Keycontroller',
      url: 'keycontroller/', urlEN: 'en/keycontroller/',
      categorie: 'Sleutelkast of kluis', categorieEN: 'Key cabinet or safe',
      cta: 'Keycontroller bekijken', ctaEN: 'View Keycontroller',
      foto: 'photos/cut/keycontroller-6pos.webp', fotoB: 1200, fotoH: 1298,
      alt: 'Keycontroller kluis met zes tandemposities',
      altEN: 'Keycontroller safe with six tandem positions'
    },
    {
      id: 'surfacevault', slug: 'surfacevault', aliassen: ['surface-vault'],
      datasheet: 'Surface-Vault',
      naam: 'Surface Vault', naamEN: 'Surface Vault',
      url: 'surface-vault/', urlEN: 'en/surface-vault/',
      categorie: 'Sleutelkast of kluis', categorieEN: 'Key cabinet or safe',
      cta: 'Surface Vault bekijken', ctaEN: 'View Surface Vault',
      foto: 'photos/cut/surface-vault-open.webp', fotoB: 900, fotoH: 1024,
      alt: 'Surface Vault met geopend deksel en de sleutel in de vergrendeling',
      altEN: 'Surface Vault with the cover open, the key held in the entrapment'
    },
    {
      id: 'keytracker',
      datasheet: 'KeyTracker', slug: 'keytracker', aliassen: [],
      naam: 'KeyTracker', naamEN: 'KeyTracker',
      url: 'keytracker/', urlEN: 'en/keytracker/',
      categorie: 'Sleutelbeheersysteem', categorieEN: 'Key management system',
      cta: 'KeyTracker bekijken', ctaEN: 'View KeyTracker',
      foto: 'photos/keytracker-bord-25-cut.webp', fotoB: 894, fotoH: 480,
      alt: 'KeyTracker bord met 25 posities',
      altEN: 'KeyTracker board with 25 positions'
    },
    {
      id: 'lockers',
      datasheet: 'SAM-lockers', slug: 'samlockers', aliassen: ['lockers'],
      naam: 'SAM lockers', naamEN: 'SAM lockers',
      url: 'sam-lockers/', urlEN: 'en/sam-lockers/',
      categorie: 'Lockers', categorieEN: 'Lockers',
      cta: 'SAM lockers bekijken', ctaEN: 'View SAM lockers',
      foto: 'photos/lockers-hoog.webp', fotoB: 1250, fotoH: 1250,
      alt: 'SAM lockers met een geopend vak',
      altEN: 'SAM lockers with one compartment open'
    },
    {
      id: 'ocspray', slug: 'ocspraystation', aliassen: ['ocspray', 'oc-spray-station'],
      datasheet: null,
      naam: 'OC Spray Station', naamEN: 'OC Spray Station',
      url: 'oc-spray-station/', urlEN: 'en/oc-spray-station/',
      categorie: 'Lockers', categorieEN: 'Lockers',
      cta: 'OC Spray Station bekijken', ctaEN: 'View the OC Spray Station',
      foto: 'photos/cut/oc-spray-familie-vrij.webp', fotoB: 1500, fotoH: 756,
      alt: 'MK-9-kast met zestien spuitbussen naast een MK-4-kast met tachtig posities',
      altEN: 'MK-9 cabinet holding sixteen canisters beside an MK-4 cabinet with eighty positions'
    },
    {
      id: 'ktkasten', slug: 'keytrackerkasten', aliassen: ['ktkasten'],
      datasheet: null,
      naam: 'KeyTracker opbergkasten', naamEN: 'KeyTracker key cabinets',
      url: 'keytracker-opbergkasten/', urlEN: 'en/keytracker-opbergkasten/',
      categorie: 'Opbergsysteem', categorieEN: 'Storage system',
      cta: 'Opbergkasten bekijken', ctaEN: 'View the cabinets',
      foto: 'photos/keytracker-kasten-cut2.webp', fotoB: 1024, fotoH: 1024,
      alt: 'De vier maten KeyTracker-kasten naast elkaar, met mechanisch codeslot en noodcilinder',
      altEN: 'The four sizes of KeyTracker cabinet side by side, with mechanical code lock and emergency cylinder'
    },
    {
      id: 'velkey',
      datasheet: 'Vel-Key', slug: 'velkey', aliassen: [],
      naam: 'Vel-Key', naamEN: 'Vel-Key',
      url: 'vel-key/', urlEN: 'en/vel-key/',
      categorie: 'Sleutelkast of kluis', categorieEN: 'Key cabinet or safe',
      cta: 'Vel-Key bekijken', ctaEN: 'View Vel-Key',
      foto: 'photos/cut/velkey-cassette-schoon.webp', fotoB: 1600, fotoH: 1073,
      alt: 'Vel-Key cassette met gelabelde sleutels',
      altEN: 'Vel-Key cassette with labelled keys'
    },
    {
      id: 'ringen',
      datasheet: 'Sleutelringen', slug: 'sleutelringen', aliassen: ['ringen'],
      naam: 'Sleutelringen', naamEN: 'Key rings',
      url: 'sleutelringen/', urlEN: 'en/sleutelringen/',
      categorie: 'Sleutelringen', categorieEN: 'Key rings',
      cta: 'Sleutelringen bekijken', ctaEN: 'View key rings',
      foto: null, fotoB: 0, fotoH: 0, alt: '', altEN: ''
    }
  ];

  // Elke pagina zet window.DELPHI_BASIS ("", "../", "../../") vóór dit bestand;
  // adressen en foto's staan relatief aan de sitewortel en krijgen dat voorvoegsel.
  var BASIS = window.DELPHI_BASIS || '';
  if (BASIS) producten.forEach(function (p) {
    p.url = BASIS + p.url;
    p.urlEN = BASIS + p.urlEN;
    if (p.foto) p.foto = BASIS + p.foto;
  });

  var en = function (lang) { return lang === 'en'; };
  var veld = function (p, naam, lang) { return en(lang) ? p[naam + 'EN'] : p[naam]; };

  window.DELPHI_PRODUCTEN = {
    producten: producten,

    // Pad naar de datasheet-pdf, of '' als het product er geen heeft.
    datasheetUrl: function (id, lang) {
      var pr = this.op(id);
      if (!pr || !pr.datasheet) return '';
      return BASIS + 'datasheets/DELPHI-datasheet-' + pr.datasheet + (lang === 'en' ? '-EN' : '-NL') + '.pdf';
    },

    // Eén product op id.
    op: function (id) {
      for (var i = 0; i < producten.length; i++) if (producten[i].id === id) return producten[i];
      return null;
    },

    // Tabel voor de keuzehulp: { id: { naam, href, cta, img, imgW, imgH, alt } }
    kaart: function (lang) {
      var uit = {};
      producten.forEach(function (p) {
        uit[p.id] = {
          naam: veld(p, 'naam', lang),
          href: en(lang) ? p.urlEN : p.url,
          cta: veld(p, 'cta', lang),
          img: p.foto, imgW: p.fotoB, imgH: p.fotoH,
          alt: veld(p, 'alt', lang)
        };
      });
      return uit;
    },

    // { id: slug } — de waarde achter ?p= in de link naar het contactformulier.
    slugs: function () {
      var uit = {};
      producten.forEach(function (p) { uit[p.id] = p.slug; });
      return uit;
    },

    // Tabel voor het contactformulier: { slug: [naam, url, categorie] }, inclusief aliassen.
    bronnen: function (lang) {
      var uit = {};
      producten.forEach(function (p) {
        var rij = [veld(p, 'naam', lang), en(lang) ? p.urlEN : p.url, veld(p, 'categorie', lang),
          p.datasheet ? BASIS + 'datasheets/DELPHI-datasheet-' + p.datasheet + (en(lang) ? '-EN' : '-NL') + '.pdf' : ''];
        uit[p.slug] = rij;
        (p.aliassen || []).forEach(function (a) { uit[a] = rij; });
      });
      uit.keuzehulp = en(lang)
        ? ['the product finder', BASIS + 'en/#keuzehulp']
        : ['de keuzehulp', BASIS + '#keuzehulp'];
      return uit;
    }
  };
})();
