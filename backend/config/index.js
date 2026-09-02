require('dotenv').config();

const config = {
  port: process.env.PORT || 3001,

  database: {
    url: process.env.DATABASE_URL,
  },

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },

  lemlist: {
    apiKey: process.env.LEMLIST_API_KEY,
    baseUrl: 'https://api.lemlist.com/api',
  },

  notion: {
    token: process.env.NOTION_TOKEN,
    databases: {
      resultats: process.env.NOTION_DB_RESULTATS,
      diagnostics: process.env.NOTION_DB_DIAGNOSTICS,
      historique: process.env.NOTION_DB_HISTORIQUE,
      memoire: process.env.NOTION_DB_MEMOIRE,
    },
    parentPageId: process.env.NOTION_PARENT_PAGE_ID,
  },

  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Défaut global. Conserve son rôle de commutateur Settings : s'il contient
    // "opus", il surcharge TOUTES les actions (cf. resolveModel).
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    // Le routage par action vit désormais dans config/models.js — une seule
    // source de vérité, exhaustive, surchargeable par CLAUDE_MODEL_<ACTION>
    // et CLAUDE_TIER_<TIER>.
  },

  // All integration tokens are now stored per-user in user_integrations table.
  // The .env values above serve as system-level fallbacks only.
};

/**
 * Get a user's decrypted API key for a given provider.
 * Falls back to .env config if no per-user key is stored.
 */
async function getUserKey(userId, provider) {
  try {
    const db = require('../db');
    const { decrypt } = require('./crypto');
    const row = await db.userIntegrations.get(userId, provider);
    if (row) return decrypt(row.access_token);
  } catch {
    // Decryption or DB error — fall through to .env
  }

  // Fallback to .env values for core services
  const envFallback = {
    lemlist: config.lemlist.apiKey,
    notion: config.notion.token,
    claude: config.claude.apiKey,
  };
  return envFallback[provider] || null;
}

/**
 * Which of these providers does this user have a genuinely usable connection for — a
 * user_integrations row whose access_token actually decrypts to a non-empty value. Deliberately
 * does NOT fall back to .env system-level tokens like getUserKey() does (those back internal
 * features, e.g. template generation's own Notion access — they say nothing about whether THIS
 * user has their own working connection), so a row with a corrupted/placeholder token (e.g. test
 * data seeded directly in the DB, bypassing the normal encrypt-on-save flow) is correctly treated
 * as not connected, instead of silently appearing configured everywhere "connected" is checked.
 */
async function getValidatedIntegrations(userId, providers) {
  const db = require('../db');
  const { decrypt } = require('./crypto');
  const result = await db.query(
    `SELECT provider, access_token FROM user_integrations WHERE user_id = $1 AND provider = ANY($2)`,
    [userId, providers]
  );
  return result.rows
    .filter(r => {
      try { return !!decrypt(r.access_token); } catch { return false; }
    })
    .map(r => r.provider);
}

function validateConfig(keys) {
  const missing = keys.filter((k) => {
    const value = k.split('.').reduce((obj, part) => obj?.[part], config);
    return !value;
  });
  if (missing.length > 0) {
    console.warn(
      `⚠️  Missing config keys: ${missing.join(', ')}\n` +
      '   Copy .env.example → .env and fill in your values.\n' +
      '   Or configure them in the Settings page of the app.'
    );
  }
  return missing.length === 0;
}

module.exports = { config, validateConfig, getUserKey, getValidatedIntegrations };
