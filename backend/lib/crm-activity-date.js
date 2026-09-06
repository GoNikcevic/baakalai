/**
 * Extraction de la date de dernière activité réelle d'un contact CRM.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * `opportunities.updated_at` ne peut pas servir de signal métier : il est
 * réécrit à `now()` à chaque synchronisation, à la fois par `opportunities.update()`
 * et par le trigger `trg_opportunities_updated_at`. Mesuré en production :
 * 376 opportunités pour seulement 3 minutes distinctes de `updated_at`.
 *
 * Conséquence en cascade — tout ce qui repose sur la récence était mort :
 *   • /dashboard/activation renvoyait 0 deal stagnant sur 373 opportunités,
 *     donc QuickWinCard ne s'affichait jamais ;
 *   • churn-scoring donnait 286 scores à 0 et aucun au-dessus de 40, le critère
 *     d'inactivité (30 points sur 100) ne pouvant jamais se déclencher ;
 *   • Deal Coach n'avait aucun deal stagnant à coacher.
 *
 * La colonne `last_activity_at` existe depuis la migration 043 et est indexée
 * depuis la 063, mais personne ne l'écrivait. Ce module fournit la valeur.
 *
 * SÉPARATION DES RESPONSABILITÉS
 * ------------------------------
 * `updated_at`      = quand NOUS avons touché la ligne (audit technique).
 * `last_activity_at` = quand le COMMERCIAL a touché le deal (signal métier).
 * Les deux sont légitimes ; les confondre est ce qui a cassé le produit.
 *
 * DISPONIBILITÉ PAR CONNECTEUR (audit du 2026-07-29)
 * --------------------------------------------------
 *   pipedrive  — `update_time` / `last_activity_date`, renvoyés par défaut
 *   odoo       — `write_date`, déjà demandé
 *   hubspot    — nécessitait d'ajouter les propriétés à la requête
 *   salesforce — nécessitait d'ajouter les champs au SOQL
 *   folk / airtable / notion — pas de date d'activité exposée simplement ;
 *                on retombe sur null, et les consommateurs utilisent created_at.
 */

/**
 * Champs candidats par fournisseur, du plus significatif au moins significatif.
 *
 * L'ordre compte : une « dernière activité commerciale » (appel, email, note)
 * est un bien meilleur signal de deal dormant qu'une « dernière modification »,
 * qui peut n'être qu'un changement de champ administratif.
 */
const FIELDS_BY_PROVIDER = {
  pipedrive: ['last_activity_date', 'update_time', 'add_time'],
  odoo: ['write_date', 'create_date'],
  hubspot: [
    'hs_last_sales_activity_timestamp',
    'notes_last_contacted',
    'lastmodifieddate',
    'createdate',
  ],
  salesforce: ['LastActivityDate', 'LastModifiedDate', 'CreatedDate'],
  folk: ['updatedAt', 'createdAt'],
  airtable: ['updatedAt', 'createdAt'],
  notion: ['last_edited_time', 'created_time'],
};

/** Bornes de vraisemblance : hors de cet intervalle, la date est une erreur. */
const MIN_YEAR = 2000;

function parseDate(value) {
  if (!value) return null;

  // HubSpot renvoie parfois des timestamps epoch en millisecondes (chaîne).
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
    const n = Number(value);
    const ms = String(value).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return isValid(d) ? d : null;
  }

  // Odoo renvoie « 2026-05-30 14:22:01 » sans indicateur de fuseau : Date le
  // lit comme heure locale. On force UTC, sinon le décalage fausse les seuils
  // de récence sur les deals limites.
  const s = String(value).trim();
  const odooLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s);
  const d = new Date(odooLike ? s.replace(' ', 'T') + 'Z' : s);
  return isValid(d) ? d : null;
}

function isValid(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  // Une date dans le futur est une anomalie de saisie CRM, pas une activité.
  // On tolère une petite marge pour les décalages d'horloge.
  const maxMs = Date.now() + 7 * 86400000;
  return year >= MIN_YEAR && d.getTime() <= maxMs;
}

/**
 * Renvoie la date de dernière activité d'un enregistrement CRM brut.
 *
 * @param {string} provider  identifiant du connecteur
 * @param {object} raw       enregistrement tel que renvoyé par le connecteur
 * @returns {string|null}    date ISO, ou null si le CRM n'en expose aucune
 */
function extractActivityDate(provider, raw) {
  if (!raw || typeof raw !== 'object') return null;

  const fields = FIELDS_BY_PROVIDER[provider] || [];
  // Les connecteurs normalisent parfois déjà le champ : on l'accepte en premier.
  const candidates = ['lastActivityAt', 'last_activity_at', ...fields];

  for (const field of candidates) {
    // Certains connecteurs remontent les valeurs sous `properties` (HubSpot).
    const value = raw[field] ?? raw.properties?.[field];
    const parsed = parseDate(value);
    if (parsed) return parsed.toISOString();
  }
  return null;
}

module.exports = { extractActivityDate, FIELDS_BY_PROVIDER, parseDate };
