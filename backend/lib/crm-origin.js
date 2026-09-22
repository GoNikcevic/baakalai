/**
 * Extraction de la date de création d'un contact DANS LE CRM du client.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * `opportunities.created_at` est la date d'insertion chez nous. Elle ne dit
 * rien de l'ancienneté du CRM en face : une base alimentée depuis 2019 et
 * importée hier ressortait vieille d'un jour. Le critère ICP « ≥ 12 mois
 * d'historique » (arbitrage du 2026-09-21) était donc inmesurable, et
 * `lib/icp-signals.js` le renvoyait figé à NULL en renvoyant ici.
 *
 * La colonne `crm_created_at` arrive avec la migration 113. Ce module fournit
 * la valeur, exactement comme `lib/crm-activity-date.js` fournit
 * `last_activity_at`. Les trois dates ont chacune leur sens et les confondre
 * est ce qui a cassé le produit une première fois :
 *   created_at       = quand NOUS avons inséré la ligne (audit technique)
 *   crm_created_at   = quand le contact est né dans le CRM (signal métier)
 *   last_activity_at = quand le commercial l'a touché en dernier
 *
 * DEUX FORMES D'ENREGISTREMENT À ACCEPTER
 * ---------------------------------------
 * Les connecteurs ne se ressemblent pas. `pipedrive.listAllPersons` renvoie la
 * personne brute de l'API, tandis que `salesforce.listContacts` et
 * `hubspot.listAllContacts` normalisent les noms de champs avant de rendre la
 * main. Lire un seul des deux jeux de noms est précisément le piège dans lequel
 * `crm-owner-resolver.js` est tombé : il n'interrogeait que la forme brute, et
 * renvoyait null en permanence sur trois connecteurs sur quatre.
 *
 * On accepte donc les deux, la forme normalisée d'abord.
 *
 * DISPONIBILITÉ PAR CONNECTEUR (audit du 2026-09-22)
 * --------------------------------------------------
 *   pipedrive  · `add_time`, renvoyé par défaut sur /persons
 *   odoo       · `create_date`, déjà demandé dans les champs de res.partner
 *   notion     · `created_time`, timestamp de page, déjà remonté
 *   hubspot    · `createdate`, il a fallu l'ajouter aux propriétés demandées
 *   salesforce · `CreatedDate`, le SOQL triait dessus sans jamais le SELECTer
 *   airtable   · `createdTime`, présent sur chaque record, il a fallu le mapper
 *   folk       · le connecteur est en écriture seule, il n'importe aucun
 *                contact : rien à extraire.
 */

const { parseDate } = require('./crm-activity-date');

/**
 * Champ portant la date de création, par fournisseur.
 *
 * Une seule candidate par connecteur, contrairement à la date d'activité : une
 * date de création n'a pas de substitut. Si le CRM ne l'expose pas, la réponse
 * est « inconnu », pas « une autre date qui y ressemble ».
 */
const CREATED_FIELDS_BY_PROVIDER = {
  pipedrive: ['add_time'],
  odoo: ['create_date'],
  hubspot: ['createdate'],
  salesforce: ['CreatedDate'],
  notion: ['created_time'],
  airtable: ['createdTime'],
  folk: ['createdAt'],
};

/**
 * Noms que les connecteurs utilisent une fois le champ normalisé. Testés avant
 * les noms bruts : quand un connecteur a déjà fait le travail, on le croit.
 *
 * `created_at` n'est volontairement PAS dans la liste : sur une ligne
 * d'opportunité c'est notre date d'insertion, et l'accepter ici rebrancherait
 * la confusion que cette colonne existe pour supprimer.
 */
const NORMALIZED_FIELDS = ['crmCreatedAt', 'crm_created_at', 'createdAt'];

/**
 * Renvoie la date de création d'un enregistrement CRM brut.
 *
 * @param {string} provider  identifiant du connecteur
 * @param {object} raw       enregistrement tel que renvoyé par le connecteur
 * @returns {string|null}    date ISO, ou null si le CRM n'en expose aucune
 */
function extractCreatedDate(provider, raw) {
  if (!raw || typeof raw !== 'object') return null;

  const candidates = [...NORMALIZED_FIELDS, ...(CREATED_FIELDS_BY_PROVIDER[provider] || [])];

  for (const field of candidates) {
    // HubSpot remonte ses valeurs sous `properties` quand l'objet n'a pas été
    // aplati par le connecteur (branche d'import inline de routes/crm.js).
    const value = raw[field] ?? raw.properties?.[field];
    const parsed = parseDate(value);
    if (parsed) return parsed.toISOString();
  }
  return null;
}

module.exports = { extractCreatedDate, CREATED_FIELDS_BY_PROVIDER };
