/**
 * SQLite adapter that provides a pg-compatible interface for testing.
 * Used when DATABASE_PATH is set (test environment).
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

let db;

function getDb() {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'test.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF');
    initSchema();
  }
  return db;
}

function initSchema() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      company TEXT,
      role TEXT DEFAULT 'client',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      token_hash TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      client TEXT,
      description TEXT,
      color TEXT DEFAULT 'var(--blue)',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS touchpoints (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS diagnostics (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      campaign_id TEXT REFERENCES campaigns(id),
      date_analyse TEXT,
      diagnostic TEXT,
      priorities TEXT DEFAULT '[]',
      nb_to_optimize INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      campaign_id TEXT REFERENCES campaigns(id),
      version INTEGER,
      date TEXT,
      messages_modified TEXT DEFAULT '[]',
      hypotheses TEXT DEFAULT '',
      result TEXT DEFAULT 'testing',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memory_patterns (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      pattern TEXT,
      category TEXT,
      data TEXT,
      confidence TEXT DEFAULT 'Faible',
      date_discovered TEXT,
      sectors TEXT DEFAULT '[]',
      targets TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT,
      title TEXT DEFAULT 'Nouvelle conversation',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT,
      filename TEXT,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      file_path TEXT,
      parsed_text TEXT,
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT REFERENCES users(id),
      key TEXT NOT NULL,
      label TEXT,
      category TEXT DEFAULT 'custom',
      sync_mode TEXT DEFAULT 'local',
      default_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT REFERENCES users(id),
      label TEXT NOT NULL,
      email_count INTEGER DEFAULT 0,
      linkedin_count INTEGER DEFAULT 0,
      week_start TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_integrations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      metadata TEXT DEFAULT '{}',
      expires_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider)
    );
  `);
}

/**
 * Execute a query with pg-compatible $1, $2 parameter syntax.
 * Returns { rows, rowCount }.
 */
function query(text, params = []) {
  const d = getDb();
  // Convert $1, $2 style to ? style
  const sqliteText = text.replace(/\$(\d+)/g, () => '?');

  // Convert array params to JSON strings for SQLite compatibility
  params = params.map(p => Array.isArray(p) ? JSON.stringify(p) : p);

  // Handle RETURNING * for INSERT/UPDATE
  const isReturning = /RETURNING\s+\*/i.test(text);
  const isInsert = /^\s*INSERT/i.test(text);
  const isUpdate = /^\s*UPDATE/i.test(text);
  const isDelete = /^\s*DELETE/i.test(text);
  const isSelect = /^\s*SELECT/i.test(text);

  // Replace PostgreSQL-specific syntax
  let adapted = sqliteText
    .replace(/::numeric/g, '')
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
