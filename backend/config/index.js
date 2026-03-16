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

  // HubSpot tokens are now stored per-user in user_integrations table.
  // No global hubspot config needed.
};

/**
 * Reload API keys from the database (encrypted storage).
 * DB keys take priority over .env values.
 * Called after keys are saved via the settings API.
 */
async function reloadKeys() {
  try {
    const db = require('../db');
    const { decrypt } = require('./crypto');

    const keyMap = {
      lemlist_api_key: (val) => { config.lemlist.apiKey = val; },
      notion_token: (val) => { config.notion.token = val; },
      anthropic_api_key: (val) => { config.claude.apiKey = val; },
      // HubSpot tokens are per-user now (stored in user_integrations)
    };

    for (const [dbKey, setter] of Object.entries(keyMap)) {
      const row = await db.settings.get(dbKey);
      if (row) {
        try {
          setter(decrypt(row.value));
        } catch {
          // Decryption failed — keep existing .env value
        }
      }
    }
  } catch {
    // DB not ready yet — use .env values
  }
}

// Load DB keys on startup (after a short delay to let DB initialize)
setTimeout(reloadKeys, 100);

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

module.exports = { config, validateConfig, reloadKeys };
