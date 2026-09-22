/**
 * CRM Owner Resolver · Unified owner mapping across all CRM providers
 *
 * Maps CRM user IDs to Baakalai team members by email.
 * Extracts owner info from raw CRM contact data.
 *
 * Supported: Pipedrive, HubSpot, Salesforce, Odoo
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Build a map of CRM user IDs → { email, baakalaiUserId }
 * by fetching CRM users and matching them to team members by email.
 */
async function buildOwnerMap(provider, credentials, userId) {
  const map = new Map(); // crm user id string → { email, baakalaiUserId }

  // Get Baakalai team members
  let teamByEmail = new Map();
  try {
    const result = await db.query(
      `SELECT tm.user_id, u.email FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)`,
      [userId]
    );
    for (const row of result.rows) {
      teamByEmail.set(row.email.toLowerCase(), row.user_id);
    }
  } catch { /* no team = solo user */ }

  // Also match the user themselves (solo mode or admin)
  try {
    const userResult = await db.query(`SELECT id, email FROM users WHERE id = $1`, [userId]);
    if (userResult.rows[0]) {
      teamByEmail.set(userResult.rows[0].email.toLowerCase(), userResult.rows[0].id);
    }
  } catch { /* ignore */ }

  try {
    let crmUsers = [];

    switch (provider) {
      case 'pipedrive': {
        const pipedrive = require('../api/pipedrive');
        crmUsers = await pipedrive.getUsers(credentials);
        // Pipedrive getUsers returns [{ id, name, email, active }]
        break;
      }

      case 'hubspot': {
        // HubSpot Owners API
        const res = await fetch('https://api.hubapi.com/crm/v3/owners', {
          headers: { Authorization: `Bearer ${credentials}` },
        });
        if (res.ok) {
          const data = await res.json();
          crmUsers = (data.results || []).map(o => ({
            id: o.id,
            email: o.email,
            name: `${o.firstName || ''} ${o.lastName || ''}`.trim(),
          }));
        }
        break;
      }

      case 'salesforce': {
        // Salesforce: query users
        const { instanceUrl, accessToken } = credentials;
        const res = await fetch(
          `${instanceUrl}/services/data/v58.0/query?q=${encodeURIComponent('SELECT Id, Name, Email FROM User WHERE IsActive = true LIMIT 200')}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (res.ok) {
          const data = await res.json();
          crmUsers = (data.records || []).map(u => ({
            id: u.Id,
            email: u.Email,
            name: u.Name,
          }));
        }
        break;
      }

      case 'odoo': {
        // Odoo: list users via res.users model
        const odoo = require('../api/odoo');
        const userIds = await odoo.call(credentials, 'res.users', 'search', [
          [['active', '=', true]],
        ], { limit: 200 });
        if (userIds && userIds.length > 0) {
          const users = await odoo.call(credentials, 'res.users', 'read', [userIds], {
            fields: ['id', 'name', 'login'],
          });
          crmUsers = (users || []).map(u => ({
            id: String(u.id),
            email: u.login, // Odoo uses login as email
            name: u.name,
          }));
        }
        break;
      }
    }

    // Build the map
    for (const cu of crmUsers) {
      const baakalaiUserId = cu.email ? teamByEmail.get(cu.email.toLowerCase()) : null;
      map.set(String(cu.id), {
        email: cu.email || null,
        name: cu.name || null,
        baakalaiUserId: baakalaiUserId || null,
      });
    }

    logger.info('crm-owner-resolver', `${provider}: mapped ${map.size} CRM users, ${[...map.values()].filter(v => v.baakalaiUserId).length} matched to team members`);
  } catch (err) {
    logger.warn('crm-owner-resolver', `${provider} user fetch failed: ${err.message}`);
  }

  return map;
}

/**
 * Champs portant l'identifiant du propriétaire, par fournisseur.
 *
 * POURQUOI UNE LISTE ET PLUS UN SEUL NOM (correctif 2026-09-22)
 * ------------------------------------------------------------
 * Cette fonction ne lisait que la forme BRUTE de chaque API. Or les
 * connecteurs normalisent leurs champs avant de rendre la main, et trois
 * d'entre eux renommaient précisément celui-ci :
 *   • `hubspot.listAllContacts` aplatit `properties.hubspot_owner_id` en
 *     `owner_id` · on cherchait `properties.hubspot_owner_id` sur un objet qui
 *     n'avait plus de `properties`.
 *   • `salesforce.listContacts` renomme `OwnerId` en `ownerId` · on cherchait
 *     `OwnerId`, avec un O majuscule qui n'existait plus.
 *   • `odoo.listContacts` ne demandait même pas `user_id` dans ses champs.
 *
 * Résultat mesuré sur les 443 opportunités de production : `crm_owner_id` et
 * `owner_email` NULL sur 100 % des lignes. Le symptôme se lisait comme « les
 * points d'appel ne passent pas l'owner », alors que `crm-agent.js` le passait
 * bien : c'est la résolution qui renvoyait null en amont, silencieusement.
 *
 * On accepte donc les deux formes, normalisée d'abord. Un connecteur qui
 * renomme encore un champ demain casse un seul tableau, pas la fonctionnalité.
 */
const OWNER_ID_FIELDS_BY_PROVIDER = {
  pipedrive: ['owner_id', 'ownerId'],
  hubspot: ['hubspot_owner_id', 'owner_id', 'ownerId'],
  salesforce: ['OwnerId', 'ownerId', 'owner_id'],
  odoo: ['user_id', 'ownerId', 'owner_id'],
  // Notion et Airtable n'ont pas d'identifiant d'utilisateur stable exposé
  // simplement : le propriétaire y est un champ libre, traité par `ownerEmail`
  // plus bas plutôt que par un identifiant.
  notion: ['ownerId'],
  airtable: ['ownerId'],
};

/** Champs portant directement l'email du propriétaire, quand le CRM en donne un. */
const OWNER_EMAIL_FIELDS = ['ownerEmail', 'owner_email'];

/**
 * Normalise une valeur d'owner en chaîne, quelle que soit la forme du CRM.
 * Pipedrive renvoie `{ id, name, email }`, Odoo renvoie `[id, libellé]`,
 * HubSpot et Salesforce renvoient une chaîne.
 */
function ownerIdToString(value) {
  // Odoo est en XML-RPC : un many2one vide ne vaut pas null mais `false`. Sans
  // ce cas, chaque contact Odoo sans commercial écrivait la CHAÎNE « false »
  // dans crm_owner_id, et l'ICP la comptait comme une personne de plus.
  // Le 0 est écarté pour la même raison : aucun CRM n'attribue l'identifiant 0.
  if (value === null || value === undefined || value === '' || value === false || value === 0) {
    return null;
  }
  if (Array.isArray(value)) return value.length > 0 ? ownerIdToString(value[0]) : null;
  if (typeof value === 'object') return value.id ? String(value.id) : null;
  return String(value);
}

/**
 * Extract the CRM owner ID from a raw contact object, depending on provider.
 * Tolère la forme brute de l'API comme la forme normalisée par le connecteur.
 */
function extractCrmOwnerId(provider, rawContact) {
  if (!rawContact || typeof rawContact !== 'object') return null;

  const fields = OWNER_ID_FIELDS_BY_PROVIDER[provider] || [];
  for (const field of fields) {
    const raw = rawContact[field] ?? rawContact.properties?.[field];
    const id = ownerIdToString(raw);
    if (id) return id;
  }
  return null;
}

/**
 * Email du propriétaire tel que porté par l'enregistrement lui-même.
 *
 * Sert deux cas : les connecteurs qui exposent l'email sans identifiant
 * (Airtable, où « Owner » est une colonne libre), et Pipedrive, dont
 * `owner_id` est un objet qui contient déjà l'email. Évite un aller-retour
 * API quand l'information est déjà là.
 */
function extractOwnerEmail(provider, rawContact) {
  if (!rawContact || typeof rawContact !== 'object') return null;

  for (const field of OWNER_EMAIL_FIELDS) {
    const value = rawContact[field] ?? rawContact.properties?.[field];
    if (typeof value === 'string' && value.includes('@')) return value.toLowerCase();
  }

  // Pipedrive : `owner_id` est un objet { id, name, email }.
  const embedded = rawContact.owner_id;
  if (embedded && typeof embedded === 'object' && typeof embedded.email === 'string'
      && embedded.email.includes('@')) {
    return embedded.email.toLowerCase();
  }
  return null;
}

/**
 * Resolve owner info for a contact.
 * Returns { crmOwnerId, ownerEmail, ownerId (baakalai) }
 *
 * `ownerMap` est optionnel : les chemins d'import qui ne peuvent pas se payer
 * un appel « liste des utilisateurs » (connecteurs sans `getUsers`) passent une
 * map vide et récupèrent quand même l'identifiant CRM, ce qui suffit à compter
 * les sièges côté ICP et à rattacher les deals entre eux.
 */
function resolveOwner(provider, rawContact, ownerMap) {
  const map = ownerMap instanceof Map ? ownerMap : new Map();
  const crmOwnerId = extractCrmOwnerId(provider, rawContact);
  const embeddedEmail = extractOwnerEmail(provider, rawContact);

  if (!crmOwnerId) {
    // Pas d'identifiant, mais parfois un email : on tient quand même une
    // personne distincte, et c'est tout ce dont le comptage de sièges a besoin.
    return { crmOwnerId: null, ownerEmail: embeddedEmail, ownerId: null };
  }

  const info = map.get(crmOwnerId);
  return {
    crmOwnerId,
    ownerEmail: info?.email || embeddedEmail || null,
    ownerId: info?.baakalaiUserId || null,
  };
}

module.exports = {
  buildOwnerMap,
  extractCrmOwnerId,
  extractOwnerEmail,
  resolveOwner,
  OWNER_ID_FIELDS_BY_PROVIDER,
};
