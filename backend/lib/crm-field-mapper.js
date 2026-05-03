/**
 * CRM Field Mapper — Fetch and map custom fields across CRM providers
 *
 * Supports: Pipedrive, HubSpot, Salesforce
 * Fetches available fields from each CRM and applies user-defined mappings
 * during contact sync to assign product lines, tags, etc.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Fetch available contact fields from a CRM provider.
 * Returns [{ key, name, type, options[] }]
 */
async function fetchCrmFields(provider, credentials) {
  switch (provider) {
    case 'pipedrive': {
      const pipedrive = require('../api/pipedrive');
      const fields = await pipedrive.getPersonFields(credentials);
      return fields.map(f => ({
        key: f.key,
        name: f.name,
        type: f.fieldType,
        options: (f.options || []).map(o => ({ id: String(o.id), label: o.label })),
      }));
    }

    case 'hubspot': {
      const res = await fetch('https://api.hubapi.com/crm/v3/properties/contacts', {
        headers: { Authorization: `Bearer ${credentials}` },
      });
      if (!res.ok) throw new Error(`HubSpot fields: ${res.status}`);
      const data = await res.json();
      return (data.results || []).map(p => ({
        key: p.name,
        name: p.label,
        type: p.type,
        options: (p.options || []).map(o => ({ id: o.value, label: o.label })),
      }));
    }

    case 'salesforce': {
      const { instanceUrl, accessToken } = credentials;
      const res = await fetch(
        `${instanceUrl}/services/data/v58.0/sobjects/Contact/describe`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) throw new Error(`Salesforce fields: ${res.status}`);
      const data = await res.json();
      return (data.fields || []).map(f => ({
        key: f.name,
        name: f.label,
        type: f.type,
        options: (f.picklistValues || []).map(p => ({ id: p.value, label: p.label })),
      }));
    }

    default:
      return [];
  }
}

/**
 * Get saved field mappings for a user/team.
 * Returns [{ id, crmField, crmFieldName, baakalaiField, mappingValues }]
 */
async function getMappings(userId) {
  const result = await db.query(
    `SELECT * FROM crm_field_mappings WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  return result.rows;
}

/**
 * Save a field mapping.
 */
async function saveMapping(userId, { crmProvider, crmField, crmFieldName, baakalaiField, mappingValues }) {
  // Upsert: one mapping per crm_field + baakalai_field combo
  const existing = await db.query(
    `SELECT id FROM crm_field_mappings WHERE user_id = $1 AND crm_field = $2 AND baakalai_field = $3`,
    [userId, crmField, baakalaiField]
  );

  if (existing.rows.length > 0) {
    await db.query(
      `UPDATE crm_field_mappings SET mapping_values = $1, crm_field_name = $2, updated_at = now() WHERE id = $3`,
      [JSON.stringify(mappingValues), crmFieldName, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }

  const result = await db.query(
    `INSERT INTO crm_field_mappings (user_id, crm_provider, crm_field, crm_field_name, baakalai_field, mapping_values)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, crmProvider, crmField, crmFieldName, baakalaiField, JSON.stringify(mappingValues)]
  );
  return result.rows[0].id;
}

/**
 * Delete a mapping.
 */
async function deleteMapping(userId, mappingId) {
  await db.query(
    `DELETE FROM crm_field_mappings WHERE id = $1 AND user_id = $2`,
    [mappingId, userId]
  );
}

/**
 * Apply mappings to a raw CRM contact during sync.
 * Returns { productLineIds: [], customFields: {} }
 */
async function applyMappings(userId, crmProvider, rawContact) {
  const mappings = await getMappings(userId);
  if (mappings.length === 0) return { productLineIds: [], customFields: {} };

  const result = { productLineIds: [], customFields: {} };

  for (const mapping of mappings) {
    if (mapping.crm_provider !== crmProvider) continue;

    // Get the field value from the raw contact
    const fieldValue = extractFieldValue(crmProvider, rawContact, mapping.crm_field);
    if (fieldValue == null) continue;

    const values = mapping.mapping_values || {};

    if (mapping.baakalai_field === 'product_line') {
      // Map CRM field value → product line ID
      const productLineId = values[String(fieldValue)];
      if (productLineId && !result.productLineIds.includes(productLineId)) {
        result.productLineIds.push(productLineId);
      }
    } else if (mapping.baakalai_field === 'status') {
      const mappedStatus = values[String(fieldValue)];
      if (mappedStatus) result.customFields.status = mappedStatus;
    } else {
      result.customFields[mapping.baakalai_field] = fieldValue;
    }
  }

  return result;
}

/**
 * Extract a field value from a raw CRM contact.
 */
function extractFieldValue(provider, contact, fieldKey) {
  switch (provider) {
    case 'pipedrive':
      // Pipedrive custom fields are at contact[fieldKey]
      // Some are objects with value property
      const val = contact[fieldKey];
      if (val && typeof val === 'object' && 'value' in val) return val.value;
      return val ?? null;

    case 'hubspot':
      return contact.properties?.[fieldKey] ?? null;

    case 'salesforce':
      return contact[fieldKey] ?? null;

    default:
      return null;
  }
}

module.exports = { fetchCrmFields, getMappings, saveMapping, deleteMapping, applyMappings };
