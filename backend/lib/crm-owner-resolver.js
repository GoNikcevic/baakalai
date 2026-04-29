/**
 * CRM Owner Resolver — Unified owner mapping across all CRM providers
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
 * Extract the CRM owner ID from a raw contact object, depending on provider.
 */
function extractCrmOwnerId(provider, rawContact) {
  switch (provider) {
    case 'pipedrive':
      return rawContact.owner_id?.id
        ? String(rawContact.owner_id.id)
        : (rawContact.owner_id ? String(rawContact.owner_id) : null);

    case 'hubspot':
      return rawContact.properties?.hubspot_owner_id || null;

    case 'salesforce':
      return rawContact.OwnerId || null;

    case 'odoo':
      // Odoo res.partner has user_id = [id, name]
      return Array.isArray(rawContact.user_id)
        ? String(rawContact.user_id[0])
        : (rawContact.user_id ? String(rawContact.user_id) : null);

    default:
      return null;
  }
}

/**
 * Resolve owner info for a contact.
 * Returns { crmOwnerId, ownerEmail, ownerId (baakalai) }
 */
function resolveOwner(provider, rawContact, ownerMap) {
  const crmOwnerId = extractCrmOwnerId(provider, rawContact);
  if (!crmOwnerId) return { crmOwnerId: null, ownerEmail: null, ownerId: null };

  const info = ownerMap.get(crmOwnerId);
  return {
    crmOwnerId,
    ownerEmail: info?.email || null,
    ownerId: info?.baakalaiUserId || null,
  };
}

module.exports = { buildOwnerMap, extractCrmOwnerId, resolveOwner };
