/**
 * SQLite adapter that provides a pg-compatible interface for testing.
 * Used when DATABASE_PATH is set (test environment).
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let db;

function getDb() {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'test.db');
    // `backend/data/` est gitignoré : sur un clone frais il n'existe pas, et
    // better-sqlite3 refuse d'ouvrir un fichier dont le dossier parent manque.
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF');
    initSchema();
  }
  return db;
}

// Les identifiants doivent avoir la forme d'un UUID (8-4-4-4-12) : les routes
// passent par middleware/validate-params.js, qui rejette en 400 tout id qui n'est
// ni un UUID ni un nombre. Un hex de 32 caractères sans tirets ne passe pas.
function initSchema() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      company TEXT,
      role TEXT DEFAULT 'client',
      -- Colonnes ajoutées par les migrations Postgres (009, 012, 034, 078...).
      -- Ce miroir SQLite est écrit à la main : toute colonne de la table users
      -- lue par une route doit être répliquée ici, sinon les tests API échouent.
      email_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      verification_expires DATETIME,
      reset_token TEXT,
      reset_expires DATETIME,
      language TEXT DEFAULT 'fr',
      onboarding_complete INTEGER NOT NULL DEFAULT 0,
      signal_scan_frequency TEXT NOT NULL DEFAULT 'weekly',
      active_crm_provider TEXT,
      settings TEXT DEFAULT '{}',
      data TEXT DEFAULT '{}',
      plan TEXT NOT NULL DEFAULT 'trial',
      plan_status TEXT NOT NULL DEFAULT 'trialing',
      plan_updated_at DATETIME,
      trial_ends_at DATETIME,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      token_hash TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      client TEXT,
      description TEXT,
      color TEXT DEFAULT 'var(--blue)',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      project_id TEXT REFERENCES projects(id),
      name TEXT NOT NULL,
      client TEXT,
      status TEXT DEFAULT 'prep',
      channel TEXT DEFAULT 'email',
      sector TEXT,
      sector_short TEXT,
      position TEXT,
      size TEXT,
      angle TEXT,
      zone TEXT,
      tone TEXT DEFAULT 'Pro décontracté',
      formality TEXT DEFAULT 'Vous',
      length TEXT DEFAULT 'Standard',
      cta TEXT,
      start_date TEXT,
      lemlist_id TEXT,
      iteration INTEGER DEFAULT 1,
      nb_prospects INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      planned INTEGER DEFAULT 0,
      open_rate REAL,
      reply_rate REAL,
      accept_rate_lk REAL,
      reply_rate_lk REAL,
      interested INTEGER DEFAULT 0,
      meetings INTEGER DEFAULT 0,
      stops INTEGER DEFAULT 0,
      last_collected TEXT,
      notion_page_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      ab_config TEXT,
      batch_mode INTEGER,
      batch_size INTEGER,
      current_batch INTEGER,
      last_optimized_at DATETIME,
      team_id TEXT,
      total_batches INTEGER
    );

    CREATE TABLE IF NOT EXISTS touchpoints (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      campaign_id TEXT REFERENCES campaigns(id),
      step TEXT,
      type TEXT,
      label TEXT,
      sub_type TEXT,
      timing TEXT,
      subject TEXT,
      body TEXT DEFAULT '',
      max_chars INTEGER,
      open_rate REAL,
      reply_rate REAL,
      stop_rate REAL,
      accept_rate REAL,
      interested INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      parent_step_id TEXT,
      condition_type TEXT,
      condition_value TEXT,
      branch_label TEXT,
      is_root INTEGER DEFAULT 1,
      -- Variante B de l'A/B testing (migrations 0xx) : sans ces colonnes,
      -- toute création de séquence renvoie un 500 en test.
      subject_b TEXT,
      body_b TEXT,
      open_rate_b REAL,
      reply_rate_b REAL,
      accept_rate_b REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS diagnostics (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      campaign_id TEXT REFERENCES campaigns(id),
      date_analyse TEXT,
      diagnostic TEXT,
      priorities TEXT DEFAULT '[]',
      nb_to_optimize INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      notion_page_id TEXT
    );

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      campaign_id TEXT REFERENCES campaigns(id),
      version INTEGER,
      date TEXT,
      messages_modified TEXT DEFAULT '[]',
      hypotheses TEXT DEFAULT '',
      result TEXT DEFAULT 'testing',
      rollback_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      ab_categories TEXT,
      notion_page_id TEXT,
      tested_steps TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_patterns (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      pattern TEXT,
      category TEXT,
      data TEXT,
      confidence TEXT DEFAULT 'Faible',
      date_discovered TEXT,
      sectors TEXT DEFAULT '[]',
      targets TEXT DEFAULT '[]',
      -- Colonnes ajoutées par les migrations 040 et 059 (mémoire partagée,
      -- scoring, dédoublonnage). La colonne embedding est un vecteur pgvector :
      -- sans équivalent SQLite, on ne la réplique pas (les tests ne la lisent pas).
      user_id TEXT REFERENCES users(id),
      team_id TEXT REFERENCES teams(id),
      source TEXT,
      source_test_id TEXT,
      ab_category TEXT,
      custom_category TEXT,
      applied INTEGER DEFAULT 0,
      shared INTEGER DEFAULT 0,
      confirmations INTEGER DEFAULT 1,
      confidence_score REAL,
      improvement_pct REAL,
      sample_size INTEGER DEFAULT 0,
      last_confirmed_at DATETIME,
      dismissed_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      notion_page_id TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT,
      title TEXT DEFAULT 'Nouvelle conversation',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      assistant_type TEXT,
      team_id TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      thread_id TEXT REFERENCES chat_threads(id),
      role TEXT,
      content TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT,
      filename TEXT,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      file_path TEXT,
      parsed_text TEXT,
      doc_type TEXT DEFAULT 'other',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      company TEXT,
      sector TEXT,
      website TEXT,
      team_size TEXT,
      description TEXT,
      value_prop TEXT,
      social_proof TEXT,
      pain_points TEXT,
      objections TEXT,
      persona_primary TEXT,
      persona_secondary TEXT,
      target_sectors TEXT,
      target_size TEXT,
      target_zones TEXT,
      default_tone TEXT DEFAULT 'Pro décontracté',
      default_formality TEXT DEFAULT 'Vous',
      avoid_words TEXT,
      signature_phrases TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      weekly_report INTEGER
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      project_id TEXT REFERENCES projects(id),
      user_id TEXT,
      filename TEXT,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      file_path TEXT,
      parsed_text TEXT,
      category TEXT DEFAULT 'other',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS custom_variables (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      key TEXT NOT NULL,
      label TEXT,
      category TEXT DEFAULT 'custom',
      sync_mode TEXT DEFAULT 'local',
      default_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      campaign_id TEXT REFERENCES campaigns(id),
      name TEXT NOT NULL,
      title TEXT,
      company TEXT,
      company_size TEXT,
      status TEXT DEFAULT 'new',
      status_color TEXT,
      timing TEXT,
      email TEXT,
      hubspot_contact_id TEXT,
      hubspot_deal_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      autopilot_enabled INTEGER,
      batch_number INTEGER,
      churn_factors TEXT,
      churn_score INTEGER,
      churn_scored_at DATETIME,
      city TEXT,
      country TEXT,
      crm_contact_id TEXT,
      crm_deal_id TEXT,
      crm_owner_id TEXT,
      crm_provider TEXT,
      crm_push_state TEXT,
      crm_stage TEXT,
      crm_stage_changed_at DATETIME,
      crm_stage_id TEXT,
      data TEXT,
      deal_value REAL,
      email_bounce_reason TEXT,
      email_bounced_at DATETIME,
      last_activity_at DATETIME,
      linkedin_url TEXT,
      lost_date DATETIME,
      owner_email TEXT,
      owner_id TEXT,
      personalization TEXT,
      planned_followup_date DATETIME,
      planned_followup_reason TEXT,
      reactivated_at DATETIME,
      reactivated_from_email_id TEXT,
      renewal_date DATETIME,
      score INTEGER,
      score_breakdown TEXT,
      team_id TEXT,
      won_date DATETIME
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      week TEXT NOT NULL,
      date_range TEXT,
      score TEXT DEFAULT 'ok',
      score_label TEXT,
      contacts INTEGER DEFAULT 0,
      open_rate REAL,
      reply_rate REAL,
      interested INTEGER DEFAULT 0,
      meetings INTEGER DEFAULT 0,
      synthesis TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chart_data (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      label TEXT NOT NULL,
      email_count INTEGER DEFAULT 0,
      linkedin_count INTEGER DEFAULT 0,
      week_start TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE,
      max_members INTEGER DEFAULT 5,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      team_id TEXT NOT NULL REFERENCES teams(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'viewer',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS product_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT,
      event TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_integrations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      metadata TEXT DEFAULT '{}',
      expires_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      instance_url TEXT,
      team_id TEXT,
      UNIQUE(user_id, provider)
    );
  `);
}

/** Ramène une valeur acceptée par pg vers un type que SQLite sait lier. */
function toSqliteValue(p) {
  if (p === undefined) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (p instanceof Date) return p.toISOString();
  if (p !== null && typeof p === 'object' && !Buffer.isBuffer(p)) return JSON.stringify(p);
  return p;
}

/**
 * Execute a query with pg-compatible $1, $2 parameter syntax.
 * Returns { rows, rowCount }.
 */
function query(text, params = []) {
  const d = getDb();
  // Conversion des paramètres $1, $2 de pg vers les ? positionnels de SQLite.
  // pg autorise un même $n plusieurs fois dans une requête (WHERE user_id = $1
  // OR team_id = $1) ; SQLite non : chaque ? consomme une valeur. On reconstruit
  // donc la liste dans l'ordre d'apparition au lieu de la reprendre telle quelle,
  // sinon ces requêtes échouent avec « Too few parameter values were provided ».
  const positional = [];
  const sqliteText = text.replace(/\$(\d+)/g, (_, n) => {
    positional.push(params[Number(n) - 1]);
    return '?';
  });

  // better-sqlite3 ne lie que number, string, bigint, buffer et null. pg accepte
  // en plus les booléens, les Date et les objets (colonnes JSONB) : on les
  // convertit ici, sinon toute route qui écrit un de ces types renvoie un 500
  // en test alors qu'elle fonctionne en production.
  params = positional.map(toSqliteValue);

  // Handle RETURNING * for INSERT/UPDATE
  const isReturning = /RETURNING\s+\*/i.test(text);
  const isInsert = /^\s*INSERT/i.test(text);
  const isUpdate = /^\s*UPDATE/i.test(text);
  const isDelete = /^\s*DELETE/i.test(text);
  const isSelect = /^\s*SELECT/i.test(text);

  // Replace PostgreSQL-specific syntax
  let adapted = sqliteText
    .replace(/::numeric/g, '')
    // Les fenêtres temporelles s'écrivent « now() - interval '7 days' » en pg ;
    // SQLite ne connaît pas interval et attend datetime('now','-7 days').
    .replace(/now\(\)\s*([-+])\s*interval\s*'(\d+)\s*(\w+)'/gi,
      (_, sign, amount, unit) => `datetime('now','${sign}${amount} ${unit}')`)
    .replace(/ON CONFLICT\((\w+)\) DO UPDATE SET/g, 'ON CONFLICT($1) DO UPDATE SET')
    .replace(/now\(\)/g, "datetime('now')")
    .replace(/EXCLUDED\./g, 'excluded.');

  if (isSelect) {
    const stmt = d.prepare(adapted);
    const rows = stmt.all(...params);
    return { rows, rowCount: rows.length };
  }

  if (isReturning) {
    // SQLite doesn't support RETURNING, so we need to handle it manually
    const withoutReturning = adapted.replace(/\s*RETURNING\s+\*/i, '');
    const info = d.prepare(withoutReturning).run(...params);

    if (isInsert) {
      // For inserts, we need to get the last inserted row
      // Find the table name
      const tableMatch = text.match(/INSERT\s+INTO\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        // Try to find by rowid
        const row = d.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).get(info.lastInsertRowid);
        return { rows: row ? [row] : [], rowCount: 1 };
      }
    }

    if (isUpdate) {
      // For updates, try to find the updated row - the last param is usually the ID
      const tableMatch = text.match(/UPDATE\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        const lastParam = params[params.length - 1];
        const row = d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(lastParam);
        return { rows: row ? [row] : [], rowCount: info.changes };
      }
    }

    return { rows: [], rowCount: info.changes };
  }

  const info = d.prepare(adapted).run(...params);
  return { rows: [], rowCount: info.changes };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { query, closeDb, getDb };
