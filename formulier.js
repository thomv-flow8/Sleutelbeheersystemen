// Instellingen van het contactformulier — één bestand voor beide contactpagina's.
//
// ── WAT MOET HIER GEBEUREN ──────────────────────────────────────────────
// 1. Ga naar https://web3forms.com
// 2. Vul info@sleutelbeheersystemen.nl in en klik op "Create Access Key"
// 3. Je krijgt de sleutel per e-mail. Plak hem hieronder tussen de aanhalingstekens.
// 4. Klaar — beide contactpagina's gebruiken hem meteen.
//
// Zolang de sleutel leeg is, verdwijnt er niets: het formulier opent dan het
// mailprogramma van de bezoeker met alle gegevens al ingevuld.
// ────────────────────────────────────────────────────────────────────────
window.DELPHI_FORMULIER = {
  accessKey: 'a8f92f87-6a2d-4c63-a8d5-088d8871b9f8',

  // Waar de aanvragen heen gaan. Bij Web3Forms staat dit vast aan de access key;
  // dit adres wordt gebruikt voor de mailto-terugval en op de bedankpagina.
  ontvanger: 'info@sleutelbeheersystemen.nl',

  // Bouwt een mailto-link met alle ingevulde gegevens. Terugval als er geen
  // access key is of als het versturen mislukt — zo gaat een aanvraag nooit verloren.
  mailtoLink: function (data, lang) {
    var en = lang === 'en';
    var labels = en
      ? { onderwerp: 'Subject', organisatie: 'Organisation', naam: 'Name', email: 'E-mail',
          telefoon: 'Telephone', aantal: 'Details', bedrijfstype: 'Type of organisation',
          intentie: 'Request', bericht: 'Message', datasheet: 'Datasheet' }
      : { onderwerp: 'Onderwerp', organisatie: 'Organisatie', naam: 'Naam', email: 'E-mail',
          telefoon: 'Telefoon', aantal: 'Toelichting', bedrijfstype: 'Soort organisatie',
          intentie: 'Aanvraag', bericht: 'Bericht', datasheet: 'Datasheet' };
    var regels = [];
    Object.keys(labels).forEach(function (k) {
      if (data[k]) regels.push(labels[k] + ': ' + data[k]);
    });
    return 'mailto:' + this.ontvanger +
      '?subject=' + encodeURIComponent(data.subject || (en ? 'Enquiry via website' : 'Aanvraag via de website')) +
      '&body=' + encodeURIComponent(regels.join('\n'));
  }
};
