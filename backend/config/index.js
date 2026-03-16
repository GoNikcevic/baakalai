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
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
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

module.exports = { config, validateConfig, getUserKey };
