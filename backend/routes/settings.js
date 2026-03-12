const { Router } = require('express');
const db = require('../db');
const { encrypt, decrypt, maskKey } = require('../config/crypto');

const router = Router();

// The API keys we manage — maps frontend field names to DB keys
const KEY_MAP = {
  // ── Core ──
  lemlistKey: 'lemlist_api_key',
  notionToken: 'notion_token',
  claudeKey: 'anthropic_api_key',
  // ── CRM ──
  hubspotKey: 'hubspot_api_key',
  pipedriveKey: 'pipedrive_api_key',
  salesforceKey: 'salesforce_api_key',
  folkKey: 'folk_api_key',
  // ── Enrichment ──
  dropcontactKey: 'dropcontact_api_key',
  apolloKey: 'apollo_api_key',
  hunterKey: 'hunter_api_key',
  kasprKey: 'kaspr_api_key',
  lushaKey: 'lusha_api_key',
  snovKey: 'snov_api_key',
  // ── Outreach ──
  instantlyKey: 'instantly_api_key',
  lgmKey: 'lgm_api_key',
  waalaxyKey: 'waalaxy_api_key',
  // ── LinkedIn / Scraping ──
  phantombusterKey: 'phantombuster_api_key',
  captaindataKey: 'captaindata_api_key',
  // ── Calendar ──
  calendlyKey: 'calendly_api_key',
  calcomKey: 'calcom_api_key',
  // ── Deliverability ──
  mailreachKey: 'mailreach_api_key',
  warmboxKey: 'warmbox_api_key',
};

// GET /api/settings/keys — Return masked key status (never plaintext)
router.get('/keys', async (_req, res, next) => {
  try {
    const result = {};

    for (const [field, dbKey] of Object.entries(KEY_MAP)) {
      const row = await db.settings.get(dbKey);
      if (row) {
        try {
          const plain = decrypt(row.value);
          result[field] = { configured: true, masked: maskKey(plain), updatedAt: row.updated_at };
        } catch {
          result[field] = { configured: false, masked: null, updatedAt: null };
        }
      } else {
        result[field] = { configured: false, masked: null, updatedAt: null };
      }
    }

    res.json({ keys: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/keys — Save one or more API keys (encrypted)
router.post('/keys', async (req, res, next) => {
  try {
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
        await db.settings.delete(dbKey);
        saved.push(field);
        continue;
      }

      const validation = validateKeyFormat(field, trimmed);
      if (!validation.valid) {
        errors.push(`${field}: ${validation.error}`);
        continue;
      }

      const encrypted = encrypt(trimmed);
      await db.settings.set(dbKey, encrypted);
      saved.push(field);
    }

    try {
      const { reloadKeys } = require('../config');
      if (typeof reloadKeys === 'function') await reloadKeys();
    } catch { /* config reload not available yet */ }

    res.json({
      saved,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/keys/test — Test connectivity for each configured key
router.post('/keys/test', async (_req, res, next) => {
  try {
    const results = {};

    for (const [field, dbKey] of Object.entries(KEY_MAP)) {
      const row = await db.settings.get(dbKey);
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
  } catch (err) {
    next(err);
  }
});

function validateKeyFormat(field, value) {
  if (value.length < 8) return { valid: false, error: 'Key too short (minimum 8 characters)' };
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

async function testBearer(url, key) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (resp.ok) return { status: 'connected' };
  if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
  return { status: 'error', message: `HTTP ${resp.status}` };
}

async function testKey(field, key) {
  try {
    if (field === 'claudeKey') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (resp.ok) return { status: 'connected' };
      const body = await resp.json().catch(() => ({}));
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: body.error?.message || `HTTP ${resp.status}` };
    }
    if (field === 'lemlistKey') {
      const basic = Buffer.from(':' + key).toString('base64');
      const resp = await fetch('https://api.lemlist.com/api/team', { headers: { Authorization: `Basic ${basic}` } });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'notionToken') {
      const resp = await fetch('https://api.notion.com/v1/users/me', {
        headers: { 'Authorization': `Bearer ${key}`, 'Notion-Version': '2022-06-28' },
      });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid token' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'hubspotKey') return testBearer('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', key);
    if (field === 'calendlyKey') return testBearer('https://api.calendly.com/users/me', key);
    if (field === 'calcomKey') return testBearer('https://api.cal.com/v1/me', key);
    if (field === 'instantlyKey') return testBearer('https://api.instantly.ai/api/v1/authenticate', key);
    if (field === 'folkKey') return testBearer('https://api.folk.app/v1/me', key);
    if (field === 'pipedriveKey') {
      const resp = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${key}`);
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API token' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'hunterKey') {
      const resp = await fetch(`https://api.hunter.io/v2/account?api_key=${key}`);
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'dropcontactKey') {
      const resp = await fetch('https://api.dropcontact.io/batch', {
        method: 'POST',
        headers: { 'X-Access-Token': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ email: 'test@example.com' }], siren: false }),
      });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401 || resp.status === 403) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'apolloKey') {
      const resp = await fetch('https://api.apollo.io/v1/auth/health', { headers: { 'x-api-key': key } });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'phantombusterKey') {
      const resp = await fetch('https://api.phantombuster.com/api/v2/agents/fetch-all', { headers: { 'X-Phantombuster-Key': key } });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'snovKey') {
      const resp = await fetch('https://api.snov.io/v1/get-balance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: key }),
      });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (['salesforceKey', 'waalaxyKey', 'mailreachKey', 'warmboxKey'].includes(field)) {
      return { status: 'saved', message: 'Key saved (no auto-test available for this service)' };
    }
    if (field === 'kasprKey') {
      const resp = await fetch('https://api.kaspr.io/v1/credits', { headers: { 'Authorization': key, 'Content-Type': 'application/json' } });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401 || resp.status === 403) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'lushaKey') {
      const resp = await fetch('https://api.lusha.com/v1/contacts?limit=1', { headers: { 'api_key': key } });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401 || resp.status === 403) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'lgmKey') {
      const resp = await fetch(`https://apiv2.lagrowthmachine.com/flow/members?apikey=${encodeURIComponent(key)}&limit=1`);
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401 || resp.status === 403) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    if (field === 'captaindataKey') {
      const resp = await fetch('https://api.captaindata.co/v3/project', { headers: { 'Authorization': `x-api-key ${key}` } });
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401 || resp.status === 403) return { status: 'invalid', message: 'Invalid API key' };
      return { status: 'error', message: `HTTP ${resp.status}` };
    }
    return { status: 'unknown' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

module.exports = router;
