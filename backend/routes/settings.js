const { Router } = require('express');
const db = require('../db');
const { encrypt, decrypt, maskKey } = require('../config/crypto');

const router = Router();

// The API keys we manage — maps frontend field names to DB keys
const KEY_MAP = {
  // Core integrations
  lemlistKey: 'lemlist_api_key',
  notionToken: 'notion_token',
  claudeKey: 'anthropic_api_key',
  // CRM
  hubspotKey: 'hubspot_api_key',
  pipedriveKey: 'pipedrive_api_key',
  salesforceKey: 'salesforce_api_key',
  // Enrichment
  dropcontactKey: 'dropcontact_api_key',
  apolloKey: 'apollo_api_key',
  hunterKey: 'hunter_api_key',
  // Calendar
  calendlyKey: 'calendly_api_key',
};

// GET /api/settings/keys — Return masked key status (never plaintext)
router.get('/keys', (_req, res) => {
  const result = {};

  for (const [field, dbKey] of Object.entries(KEY_MAP)) {
    const row = db.settings.get(dbKey);
    if (row) {
      try {
        const plain = decrypt(row.value);
        result[field] = {
          configured: true,
          masked: maskKey(plain),
          updatedAt: row.updated_at,
        };
      } catch {
        result[field] = { configured: false, masked: null, updatedAt: null };
      }
    } else {
      result[field] = { configured: false, masked: null, updatedAt: null };
    }
  }

  res.json({ keys: result });
});

// POST /api/settings/keys — Save one or more API keys (encrypted)
router.post('/keys', (req, res) => {
  const { keys } = req.body;
  if (!keys || typeof keys !== 'object') {
    return res.status(400).json({ error: 'Missing keys object in body' });
  }

  const saved = [];
  const errors = [];

  for (const [field, value] of Object.entries(keys)) {
    const dbKey = KEY_MAP[field];
    if (!dbKey) {
      errors.push(`Unknown key field: ${field}`);
      continue;
    }

    const trimmed = (value || '').trim();
    if (!trimmed) {
      // Empty value = delete the key
      db.settings.delete(dbKey);
      saved.push(field);
      continue;
    }

    // Basic format validation
    const validation = validateKeyFormat(field, trimmed);
    if (!validation.valid) {
      errors.push(`${field}: ${validation.error}`);
      continue;
    }

    // Encrypt and store
    const encrypted = encrypt(trimmed);
    db.settings.set(dbKey, encrypted);
    saved.push(field);
  }

  // Notify config to reload keys from DB
  try {
    const { reloadKeys } = require('../config');
    if (typeof reloadKeys === 'function') reloadKeys();
  } catch { /* config reload not available yet */ }

  res.json({
    saved,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// POST /api/settings/keys/test — Test connectivity for each configured key
router.post('/keys/test', async (_req, res) => {
  const results = {};

  for (const [field, dbKey] of Object.entries(KEY_MAP)) {
    const row = db.settings.get(dbKey);
    if (!row) {
      results[field] = { status: 'not_configured' };
      continue;
    }

    try {
      const plain = decrypt(row.value);
      results[field] = await testKey(field, plain);
    } catch {
      results[field] = { status: 'error', message: 'Decryption failed' };
    }
  }

  res.json({ results });
});

function validateKeyFormat(field, value) {
  if (value.length < 8) {
    return { valid: false, error: 'Key too short (minimum 8 characters)' };
  }
  // Prefix-specific validations
  if (field === 'notionToken' && !value.startsWith('ntn_') && !value.startsWith('secret_')) {
    return { valid: false, error: 'Should start with ntn_ or secret_' };
  }
  if (field === 'claudeKey' && !value.startsWith('sk-ant-')) {
    return { valid: false, error: 'Should start with sk-ant-' };
  }
  if (field === 'hubspotKey' && !value.startsWith('pat-') && value.length < 20) {
    return { valid: false, error: 'HubSpot key should start with pat- or be a legacy key' };
  }
  return { valid: true };
}

async function testKey(field, key) {
  try {
    if (field === 'claudeKey') {
      // Quick call to Anthropic to verify the key works
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (resp.ok || resp.status === 200) {
        return { status: 'connected' };
      }
      const body = await resp.json().catch(() => ({}));
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: body.error?.message || `HTTP ${resp.status}` };
    }

    if (field === 'lemlistKey') {
      // Lemlist uses Basic Auth with empty username and API key as password
      const basic = Buffer.from(':' + key).toString('base64');
      const resp = await fetch('https://api.lemlist.com/api/team', {
        headers: { Authorization: `Basic ${basic}` },
      });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }

    if (field === 'notionToken') {
      const resp = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Notion-Version': '2022-06-28',
        },
      });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid token' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }

    if (field === 'hubspotKey') {
      const resp = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }

    if (field === 'pipedriveKey') {
      const resp = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${key}`);
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API token' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }

    if (field === 'dropcontactKey') {
      const resp = await fetch('https://api.dropcontact.io/batch', {
        method: 'POST',
        headers: { 'X-Access-Token': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ email: 'test@example.com' }], siren: false }),
      });
      if (resp.ok || resp.status === 200) return { status: 'connected' };
      if (resp.status === 401 || resp.status === 403) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }

    if (field === 'apolloKey') {
      const resp = await fetch('https://api.apollo.io/v1/auth/health', {
        headers: { 'x-api-key': key },
      });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }

    if (field === 'hunterKey') {
      const resp = await fetch(`https://api.hunter.io/v2/account?api_key=${key}`);
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }

    if (field === 'calendlyKey') {
      const resp = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid token' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }

    if (field === 'salesforceKey') {
      // Salesforce uses OAuth tokens — basic validation
      return { status: 'saved', message: 'Key saved (Salesforce requires OAuth flow for full test)' };
    }

    return { status: 'unknown' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

module.exports = router;
