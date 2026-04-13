const { Router } = require('express');
const db = require('../db');
const { encrypt, decrypt, maskKey } = require('../config/crypto');

const router = Router();

// ALL integration keys are now stored per-user in user_integrations.
// Maps frontend field names → provider slug in user_integrations table.
const PROVIDER_MAP = {
  // ── Core ──
  lemlistKey: 'lemlist',
  notionToken: 'notion',
  claudeKey: 'claude',
  // ── CRM ──
  hubspotKey: 'hubspot',
  pipedriveKey: 'pipedrive',
  salesforceKey: 'salesforce',
  folkKey: 'folk',
  // ── Enrichment ──
  dropcontactKey: 'dropcontact',
  apolloKey: 'apollo',
  hunterKey: 'hunter',
  kasprKey: 'kaspr',
  lushaKey: 'lusha',
  snovKey: 'snov',
  // ── Outreach ──
  instantlyKey: 'instantly',
  smartleadKey: 'smartlead',
  lgmKey: 'lgm',
  waalaxyKey: 'waalaxy',
  // ── LinkedIn / Scraping ──
  phantombusterKey: 'phantombuster',
  captaindataKey: 'captaindata',
  // ── Calendar ──
  calendlyKey: 'calendly',
  calcomKey: 'calcom',
  // ── Deliverability ──
  mailreachKey: 'mailreach',
  warmboxKey: 'warmbox',
};

// GET /api/settings/keys — Return masked key status (never plaintext)
router.get('/keys', async (req, res, next) => {
  try {
    const result = {};

    for (const [field, provider] of Object.entries(PROVIDER_MAP)) {
      const row = await db.userIntegrations.get(req.user.id, provider);
      if (row) {
        try {
          const plain = decrypt(row.access_token);
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
      const provider = PROVIDER_MAP[field];
      if (!provider) {
        errors.push(`Unknown key field: ${field}`);
        continue;
      }

      const trimmed = (value || '').trim();

      if (!trimmed) {
        await db.userIntegrations.delete(req.user.id, provider);
        saved.push(field);
        continue;
      }

      const validation = validateKeyFormat(field, trimmed);
      if (!validation.valid) {
        errors.push(`${field}: ${validation.error}`);
        continue;
      }

      const encrypted = encrypt(trimmed);
      await db.userIntegrations.upsert(req.user.id, provider, { accessToken: encrypted });
      saved.push(field);
    }

    res.json({
      saved,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/keys/test — Test connectivity for each configured key
router.post('/keys/test', async (req, res, next) => {
  try {
    const results = {};

    for (const [field, provider] of Object.entries(PROVIDER_MAP)) {
      const row = await db.userIntegrations.get(req.user.id, provider);
      if (!row) {
        results[field] = { status: 'not_configured' };
        continue;
      }

      try {
        const plain = decrypt(row.access_token);
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

// POST /api/settings/keys/sync-lemlist — trigger background Lemlist analysis
router.post('/keys/sync-lemlist', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { syncAndAnalyze } = require('../lib/lemlist-sync');

    // Run in background — don't await
    syncAndAnalyze(userId).catch(err => {
      console.error('[sync-lemlist] Background error:', err.message);
    });

    res.json({ status: 'started', message: 'Analyse en cours...' });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/keys/sync-outreach — trigger background outreach analysis (Apollo/Instantly/Smartlead)
router.post('/keys/sync-outreach', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { provider } = req.body;
    if (!provider || !['apollo', 'instantly', 'smartlead'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }
    const { syncOutreach } = require('../lib/outreach-sync');
    syncOutreach(userId, provider).catch(err => {
      console.error(`[sync-outreach] Background error (${provider}):`, err.message);
    });
    res.json({ status: 'started', provider });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/keys/sync-crm — trigger background CRM analysis
router.post('/keys/sync-crm', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { syncCRM } = require('../lib/crm-sync');

    // Run in background — don't await
    syncCRM(userId).catch(err => {
      console.error('[sync-crm] Background error:', err.message);
    });

    res.json({ status: 'started', message: 'Analyse CRM en cours...' });
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
    if (field === 'smartleadKey') {
      const resp = await fetch(`https://server.smartlead.ai/api/v1/campaigns?api_key=${key}&limit=1`);
      if (resp.ok) return { status: 'connected' };
      if (resp.status === 401 || resp.status === 403) return { status: 'invalid', message: 'Invalid API key' };
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

// PATCH /api/settings/language — update user's UI language preference
router.patch('/language', async (req, res, next) => {
  try {
    const { language } = req.body;
    if (!language || !['fr', 'en'].includes(language)) {
      return res.status(400).json({ error: 'Language must be "fr" or "en"' });
    }
    await db.query('UPDATE users SET language = $1 WHERE id = $2', [language, req.user.id]);
    res.json({ language });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
