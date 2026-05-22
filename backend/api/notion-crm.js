/**
 * Notion CRM API Client
 *
 * Pushes prospects to a user's Notion database as pages.
 * Uses the user's own Notion integration token (per-user isolation).
 *
 * Key challenge: we don't know the user's DB schema, so we use
 * best-effort property matching with common name variants.
 */

const { Client } = require('@notionhq/client');

// Common property name variants (EN/FR) for each field
const PROPERTY_ALIASES = {
  name: ['Name', 'Nom', 'name', 'nom', 'Full Name', 'Nom complet', 'Contact'],
  email: ['Email', 'E-mail', 'email', 'e-mail', 'Mail', 'Courriel'],
  title: ['Title', 'Titre', 'Poste', 'Job Title', 'Role', 'Rôle', 'Fonction', 'Position'],
  company: ['Company', 'Entreprise', 'Société', 'Organisation', 'Organization', 'Org'],
  companySize: ['Company Size', 'Taille', 'Size', 'Effectif', 'Employees'],
  linkedin: ['LinkedIn', 'linkedin', 'LinkedIn URL', 'Profil LinkedIn', 'LinkedIn Profile'],
};

/**
 * Discover which property names exist in a Notion database
 * and return a mapping from our field keys to actual property names + types.
 *
 * @param {Client} notion — initialized Notion client
 * @param {string} databaseId
 * @returns {object} — { name: { key, type }, email: { key, type }, ... }
 */
async function discoverSchema(notion, databaseId) {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  const props = db.properties;
  const propNames = Object.keys(props);

  const mapping = {};

  // Find the title property (required by Notion — every DB has exactly one)
  const titleProp = propNames.find((k) => props[k].type === 'title');
  if (titleProp) {
    mapping.name = { key: titleProp, type: 'title' };
  }

  // For each of our fields, find a matching property
  for (const [field, aliases] of Object.entries(PROPERTY_ALIASES)) {
    if (field === 'name' && mapping.name) continue; // already found via title type

    for (const alias of aliases) {
      const match = propNames.find((k) => k.toLowerCase() === alias.toLowerCase());
      if (match) {
        mapping[field] = { key: match, type: props[match].type };
        break;
      }
    }
  }

  return mapping;
}

/**
 * Build Notion page properties from prospect data based on discovered schema.
 *
 * @param {object} schema — mapping from discoverSchema()
 * @param {object} prospect — { name, email, title, company, company_size, linkedin_url }
 * @returns {object} — Notion properties object
 */
function buildProperties(schema, prospect) {
  const properties = {};

  // Name / Title property (required)
  if (schema.name) {
    properties[schema.name.key] = {
      title: [{ text: { content: prospect.name || 'Unknown' } }],
    };
  }

  const fieldMap = {
    email: prospect.email,
    title: prospect.title,
    company: prospect.company,
    companySize: prospect.company_size,
    linkedin: prospect.linkedin_url,
  };

  for (const [field, value] of Object.entries(fieldMap)) {
    if (!value || !schema[field]) continue;

    const { key, type } = schema[field];

    switch (type) {
      case 'rich_text':
        properties[key] = {
          rich_text: [{ text: { content: String(value) } }],
        };
        break;
      case 'email':
        properties[key] = { email: String(value) };
        break;
      case 'url':
        properties[key] = { url: String(value) };
        break;
      case 'phone_number':
        properties[key] = { phone_number: String(value) };
        break;
      case 'number':
        properties[key] = { number: Number(value) || 0 };
        break;
      case 'select':
        properties[key] = { select: { name: String(value) } };
        break;
      // For unsupported types, skip silently
      default:
        break;
    }
  }

  return properties;
}

/**
 * Push a prospect to a Notion database as a page.
 *
 * @param {string} notionToken — user's Notion integration token
 * @param {string} databaseId — user's Notion database ID for contacts
 * @param {object} prospect — { name, email, title, company, company_size, linkedin_url }
 * @returns {{ pageId: string }} — the created Notion page ID
 */
async function pushProspectToNotion(notionToken, databaseId, prospect) {
  if (!notionToken) throw new Error('Notion token is required');
  if (!databaseId) throw new Error('Notion database ID is required');

  const notion = new Client({ auth: notionToken });

  // Discover the user's database schema
  const schema = await discoverSchema(notion, databaseId);

  if (!schema.name) {
    throw new Error('Could not find a title property in the Notion database');
  }

  const properties = buildProperties(schema, prospect);

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties,
  });

  return { pageId: page.id };
}

/**
 * Push multiple prospects to Notion (batch).
 * Sequential with 350ms delay to respect Notion rate limit (~3 req/sec).
 *
 * @param {string} notionToken
 * @param {string} databaseId
 * @param {object[]} prospects
 * @returns {{ results: Array, errors: Array }}
 */
async function pushProspectsToNotion(notionToken, databaseId, prospects) {
  if (!notionToken) throw new Error('Notion token is required');
  if (!databaseId) throw new Error('Notion database ID is required');

  const notion = new Client({ auth: notionToken });

  // Discover schema once for all prospects
  const schema = await discoverSchema(notion, databaseId);

  if (!schema.name) {
    throw new Error('Could not find a title property in the Notion database');
  }

  const results = [];
  const errors = [];

  for (const prospect of prospects) {
    try {
      const properties = buildProperties(schema, prospect);
      const page = await notion.pages.create({
        parent: { database_id: databaseId },
        properties,
      });
      results.push({ pageId: page.id, name: prospect.name });
    } catch (err) {
      errors.push({ name: prospect.name, error: err.message });
    }

    // Rate limit: ~3 req/sec → 350ms between requests
    if (prospects.indexOf(prospect) < prospects.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return { results, errors };
}

/**
 * List databases accessible to the user's Notion integration.
 * Uses the Notion search API to find all databases the integration can access.
 *
 * @param {string} notionToken — user's Notion integration token
 * @returns {Array<{ id: string, title: string, url: string }>}
 */
async function listDatabases(notionToken) {
  if (!notionToken) throw new Error('Notion token is required');

  const notion = new Client({ auth: notionToken });

  const response = await notion.search({
    filter: { value: 'database', property: 'object' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: 50,
  });

  return response.results.map((db) => ({
    id: db.id,
    title:
      db.title?.[0]?.plain_text ||
      db.title?.[0]?.text?.content ||
      'Untitled',
    url: db.url || null,
  }));
}

/**
 * Query all pages (contacts) from a Notion database.
 * Returns normalized contact objects for import.
 */
async function queryContacts(notionToken, databaseId) {
  const notion = new Client({ auth: notionToken });
  const schema = await discoverSchema(notion, databaseId);

  const contacts = [];
  let cursor;
  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      const props = page.properties;
      const contact = { notionPageId: page.id };

      // Extract each field using the discovered schema
      for (const [field, meta] of Object.entries(schema)) {
        const prop = props[meta.key];
        if (!prop) continue;
        let val = null;
        if (meta.type === 'title') {
          val = (prop.title || []).map(t => t.plain_text).join('');
        } else if (meta.type === 'rich_text') {
          val = (prop.rich_text || []).map(t => t.plain_text).join('');
        } else if (meta.type === 'email') {
          val = prop.email;
        } else if (meta.type === 'url') {
          val = prop.url;
        } else if (meta.type === 'phone_number') {
          val = prop.phone_number;
        } else if (meta.type === 'number') {
          val = prop.number;
        } else if (meta.type === 'select') {
          val = prop.select?.name || null;
        }
        contact[field] = val;
      }

      // Also try to extract email from direct 'Email' property if schema didn't catch it
      if (!contact.email) {
        for (const [k, v] of Object.entries(props)) {
          if (v.type === 'email' && v.email) { contact.email = v.email; break; }
        }
      }

      contacts.push(contact);
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return contacts;
}

module.exports = {
  pushProspectToNotion,
  pushProspectsToNotion,
  listDatabases,
  discoverSchema,
  buildProperties,
  queryContacts,
};
