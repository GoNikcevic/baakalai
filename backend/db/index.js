const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'bakal.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      client          TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'prep'
                      CHECK (status IN ('active','prep','terminated','optimizing')),
      channel         TEXT NOT NULL DEFAULT 'email'
                      CHECK (channel IN ('email','linkedin','multi')),
      sector          TEXT,
      sector_short    TEXT,
      position        TEXT,
      size            TEXT,
      angle           TEXT,
      zone            TEXT,
      tone            TEXT DEFAULT 'Pro décontracté',
      formality       TEXT DEFAULT 'Vous',
      length          TEXT DEFAULT 'Standard',
      cta             TEXT,
      start_date      TEXT,
      lemlist_id      TEXT,
      iteration       INTEGER DEFAULT 1,
      nb_prospects    INTEGER DEFAULT 0,
      sent            INTEGER DEFAULT 0,
      planned         INTEGER DEFAULT 0,
      open_rate       REAL,
      reply_rate      REAL,
      accept_rate_lk  REAL,
      reply_rate_lk   REAL,
      interested      INTEGER DEFAULT 0,
      meetings        INTEGER DEFAULT 0,
      stops           REAL,
      last_collected  TEXT,
      notion_page_id  TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS touchpoints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      step            TEXT NOT NULL,
      type            TEXT NOT NULL CHECK (type IN ('email','linkedin')),
      label           TEXT,
      sub_type        TEXT,
      timing          TEXT,
      subject         TEXT,
      body            TEXT,
      max_chars       INTEGER,
      open_rate       REAL,
      reply_rate      REAL,
      stop_rate       REAL,
      accept_rate     REAL,
      interested      INTEGER DEFAULT 0,
      sort_order      INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS diagnostics (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      date_analyse    TEXT DEFAULT (date('now')),
      diagnostic      TEXT NOT NULL,
      priorities      TEXT,
      nb_to_optimize  INTEGER DEFAULT 0,
      notion_page_id  TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS versions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      version         INTEGER NOT NULL,
      date            TEXT DEFAULT (date('now')),
      messages_modified TEXT,
      hypotheses      TEXT,
      result          TEXT DEFAULT 'testing'
                      CHECK (result IN ('testing','improved','degraded','neutral')),
      notion_page_id  TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_patterns (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern         TEXT NOT NULL,
      category        TEXT NOT NULL
                      CHECK (category IN ('Objets','Corps','Timing','LinkedIn','Secteur','Cible')),
      data            TEXT,
      confidence      TEXT DEFAULT 'Faible'
                      CHECK (confidence IN ('Haute','Moyenne','Faible')),
      date_discovered TEXT DEFAULT (date('now')),
      sectors         TEXT,
      targets         TEXT,
      notion_page_id  TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_campaigns_lemlist ON campaigns(lemlist_id);
    CREATE INDEX IF NOT EXISTS idx_touchpoints_campaign ON touchpoints(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_diagnostics_campaign ON diagnostics(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_versions_campaign ON versions(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_patterns(category);
    CREATE INDEX IF NOT EXISTS idx_memory_confidence ON memory_patterns(confidence);

    CREATE TABLE IF NOT EXISTS chat_threads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT DEFAULT 'Nouvelle conversation',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id       INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content         TEXT NOT NULL,
      metadata        TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id);

    CREATE TABLE IF NOT EXISTS settings (
      key             TEXT PRIMARY KEY,
      value           TEXT NOT NULL,
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      name            TEXT NOT NULL,
      company         TEXT,
      role            TEXT NOT NULL DEFAULT 'client'
                      CHECK (role IN ('admin','client')),
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash      TEXT NOT NULL UNIQUE,
      expires_at      TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS documents (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename        TEXT NOT NULL,
      original_name   TEXT NOT NULL,
      mime_type       TEXT,
      file_size       INTEGER,
      file_path       TEXT NOT NULL,
      parsed_text     TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
  `);

  // Add user_id column to campaigns if not present
  try {
    db.prepare("SELECT user_id FROM campaigns LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE campaigns ADD COLUMN user_id INTEGER REFERENCES users(id)");
  }

  // Add user_id column to chat_threads if not present
  try {
    db.prepare("SELECT user_id FROM chat_threads LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE chat_threads ADD COLUMN user_id INTEGER REFERENCES users(id)");
  }
}

// =============================================
// Campaigns
// =============================================

const campaigns = {
  list(filter = {}) {
    let sql = 'SELECT * FROM campaigns';
    const conditions = [];
    const params = [];
    if (filter.userId) {
      conditions.push('user_id = ?');
      params.push(filter.userId);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.channel) {
      conditions.push('channel = ?');
      params.push(filter.channel);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    return getDb().prepare(sql).all(...params);
  },

  get(id) {
    return getDb().prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  },

  getByLemlistId(lemlistId) {
    return getDb().prepare('SELECT * FROM campaigns WHERE lemlist_id = ?').get(lemlistId);
  },

  create(data) {
    const stmt = getDb().prepare(`
      INSERT INTO campaigns (name, client, status, channel, sector, sector_short, position, size,
        angle, zone, tone, formality, length, cta, start_date, lemlist_id, iteration,
        nb_prospects, sent, planned, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.name,
      data.client,
      data.status || 'prep',
      data.channel || 'email',
      data.sector || null,
      data.sectorShort || null,
      data.position || null,
      data.size || null,
      data.angle || null,
      data.zone || null,
      data.tone || 'Pro décontracté',
      data.formality || 'Vous',
      data.length || 'Standard',
      data.cta || null,
      data.startDate || null,
      data.lemlistId || null,
      data.iteration || 1,
      data.nbProspects || 0,
      data.sent || 0,
      data.planned || 0,
      data.userId || null,
    );
    return { id: result.lastInsertRowid, ...data };
  },

  update(id, data) {
    const sets = [];
    const values = [];

    const mapping = {
      name: 'name', client: 'client', status: 'status', channel: 'channel',
      sector: 'sector', sector_short: 'sector_short', sectorShort: 'sector_short',
      position: 'position', size: 'size', angle: 'angle', zone: 'zone',
      tone: 'tone', formality: 'formality', length: 'length', cta: 'cta',
      start_date: 'start_date', startDate: 'start_date',
      lemlist_id: 'lemlist_id', lemlistId: 'lemlist_id',
      iteration: 'iteration',
      nb_prospects: 'nb_prospects', nbProspects: 'nb_prospects',
      sent: 'sent', planned: 'planned',
      open_rate: 'open_rate', openRate: 'open_rate',
      reply_rate: 'reply_rate', replyRate: 'reply_rate',
      accept_rate_lk: 'accept_rate_lk', acceptRateLk: 'accept_rate_lk',
      reply_rate_lk: 'reply_rate_lk', replyRateLk: 'reply_rate_lk',
      interested: 'interested', meetings: 'meetings', stops: 'stops',
      last_collected: 'last_collected', lastCollected: 'last_collected',
      notion_page_id: 'notion_page_id', notionPageId: 'notion_page_id',
    };

    const seen = new Set();
    for (const [inputKey, col] of Object.entries(mapping)) {
      if (data[inputKey] !== undefined && !seen.has(col)) {
        seen.add(col);
        sets.push(`${col} = ?`);
        values.push(data[inputKey]);
      }
    }

    if (sets.length === 0) return null;
    sets.push("updated_at = datetime('now')");
    values.push(id);

    getDb().prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.get(id);
  },

  delete(id) {
    return getDb().prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  },
};

// =============================================
// Touchpoints
// =============================================

const touchpoints = {
  listByCampaign(campaignId) {
    return getDb()
      .prepare('SELECT * FROM touchpoints WHERE campaign_id = ? ORDER BY sort_order')
      .all(campaignId);
  },

  create(campaignId, data) {
    const stmt = getDb().prepare(`
      INSERT INTO touchpoints (campaign_id, step, type, label, sub_type, timing,
        subject, body, max_chars, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      campaignId,
      data.step,
      data.type,
      data.label || null,
      data.subType || null,
      data.timing || null,
      data.subject || null,
      data.body || '',
      data.maxChars || null,
      data.sortOrder || 0,
    );
    return { id: result.lastInsertRowid };
  },

  update(id, data) {
    const sets = [];
    const values = [];
    const mapping = {
      step: 'step', type: 'type', label: 'label',
      sub_type: 'sub_type', subType: 'sub_type',
      timing: 'timing', subject: 'subject', body: 'body',
      max_chars: 'max_chars', maxChars: 'max_chars',
      open_rate: 'open_rate', openRate: 'open_rate',
      reply_rate: 'reply_rate', replyRate: 'reply_rate',
      stop_rate: 'stop_rate', stopRate: 'stop_rate',
      accept_rate: 'accept_rate', acceptRate: 'accept_rate',
      interested: 'interested',
      sort_order: 'sort_order', sortOrder: 'sort_order',
    };
    const seen = new Set();
    for (const [inputKey, col] of Object.entries(mapping)) {
      if (data[inputKey] !== undefined && !seen.has(col)) {
        seen.add(col);
        sets.push(`${col} = ?`);
        values.push(data[inputKey]);
      }
    }
    if (sets.length === 0) return null;
    sets.push("updated_at = datetime('now')");
    values.push(id);
    getDb().prepare(`UPDATE touchpoints SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  deleteByCampaign(campaignId) {
    return getDb().prepare('DELETE FROM touchpoints WHERE campaign_id = ?').run(campaignId);
  },
};

// =============================================
// Diagnostics
// =============================================

const diagnostics = {
  listByCampaign(campaignId) {
    return getDb()
      .prepare('SELECT * FROM diagnostics WHERE campaign_id = ? ORDER BY date_analyse DESC')
      .all(campaignId);
  },

  create(campaignId, data) {
    const stmt = getDb().prepare(`
      INSERT INTO diagnostics (campaign_id, date_analyse, diagnostic, priorities, nb_to_optimize)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      campaignId,
      data.dateAnalyse || new Date().toISOString().split('T')[0],
      data.diagnostic,
      JSON.stringify(data.priorities || []),
      data.nbToOptimize || 0,
    );
    return { id: result.lastInsertRowid };
  },
};

// =============================================
// Versions
// =============================================

const versions = {
  listByCampaign(campaignId) {
    return getDb()
      .prepare('SELECT * FROM versions WHERE campaign_id = ? ORDER BY version DESC')
      .all(campaignId);
  },

  create(campaignId, data) {
    const stmt = getDb().prepare(`
      INSERT INTO versions (campaign_id, version, date, messages_modified, hypotheses, result)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      campaignId,
      data.version,
      data.date || new Date().toISOString().split('T')[0],
      JSON.stringify(data.messagesModified || []),
      data.hypotheses || '',
      data.result || 'testing',
    );
    return { id: result.lastInsertRowid };
  },

  updateResult(id, result) {
    getDb().prepare('UPDATE versions SET result = ? WHERE id = ?').run(result, id);
  },
};

// =============================================
// Memory Patterns
// =============================================

const memoryPatterns = {
  list(filter = {}) {
    let sql = 'SELECT * FROM memory_patterns';
    const conditions = [];
    const params = [];
    if (filter.category) {
      conditions.push('category = ?');
      params.push(filter.category);
    }
    if (filter.confidence) {
      conditions.push('confidence = ?');
      params.push(filter.confidence);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY date_discovered DESC';
    return getDb().prepare(sql).all(...params);
  },

  create(data) {
    const stmt = getDb().prepare(`
      INSERT INTO memory_patterns (pattern, category, data, confidence, date_discovered, sectors, targets)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.pattern,
      data.category,
      data.data || '',
      data.confidence || 'Faible',
      data.dateDiscovered || new Date().toISOString().split('T')[0],
      JSON.stringify(data.sectors || []),
      JSON.stringify(data.targets || []),
    );
    return { id: result.lastInsertRowid };
  },

  update(id, data) {
    const sets = [];
    const values = [];
    if (data.confidence) { sets.push('confidence = ?'); values.push(data.confidence); }
    if (data.sectors) { sets.push('sectors = ?'); values.push(JSON.stringify(data.sectors)); }
    if (data.targets) { sets.push('targets = ?'); values.push(JSON.stringify(data.targets)); }
    if (sets.length === 0) return;
    values.push(id);
    getDb().prepare(`UPDATE memory_patterns SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },
};

// =============================================
// Stats helpers
// =============================================

function dashboardKpis(userId) {
  const where = userId
    ? "WHERE status = 'active' AND user_id = ?"
    : "WHERE status = 'active'";
  const params = userId ? [userId] : [];
  return getDb().prepare(`
    SELECT
      COUNT(*) as active_campaigns,
      COALESCE(SUM(nb_prospects), 0) as total_contacts,
      ROUND(AVG(CASE WHEN open_rate IS NOT NULL THEN open_rate END), 1) as avg_open_rate,
      ROUND(AVG(CASE WHEN reply_rate IS NOT NULL THEN reply_rate END), 1) as avg_reply_rate,
      ROUND(AVG(CASE WHEN accept_rate_lk IS NOT NULL THEN accept_rate_lk END), 1) as avg_accept_rate,
      COALESCE(SUM(interested), 0) as total_interested,
      COALESCE(SUM(meetings), 0) as total_meetings
    FROM campaigns ${where}
  `).get(...params);
}

// =============================================
// Chat
// =============================================

const chatThreads = {
  list(userId) {
    if (userId) {
      return getDb()
        .prepare('SELECT * FROM chat_threads WHERE user_id = ? ORDER BY updated_at DESC')
        .all(userId);
    }
    return getDb()
      .prepare('SELECT * FROM chat_threads ORDER BY updated_at DESC')
      .all();
  },

  get(id) {
    return getDb().prepare('SELECT * FROM chat_threads WHERE id = ?').get(id);
  },

  create(title, userId) {
    const stmt = getDb().prepare('INSERT INTO chat_threads (title, user_id) VALUES (?, ?)');
    const result = stmt.run(title || 'Nouvelle conversation', userId || null);
    return { id: result.lastInsertRowid, title: title || 'Nouvelle conversation' };
  },

  updateTitle(id, title) {
    getDb().prepare("UPDATE chat_threads SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id);
  },

  touch(id) {
    getDb().prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?").run(id);
  },

  delete(id) {
    return getDb().prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
  },
};

const chatMessages = {
  listByThread(threadId) {
    return getDb()
      .prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId);
  },

  create(threadId, role, content, metadata) {
    const stmt = getDb().prepare(
      'INSERT INTO chat_messages (thread_id, role, content, metadata) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(threadId, role, content, metadata ? JSON.stringify(metadata) : null);
    chatThreads.touch(threadId);
    return { id: result.lastInsertRowid, threadId, role, content, metadata };
  },

  deleteByThread(threadId) {
    return getDb().prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(threadId);
  },
};

// =============================================
// Settings (key-value store for encrypted API keys)
// =============================================

const settings = {
  get(key) {
    return getDb().prepare('SELECT * FROM settings WHERE key = ?').get(key);
  },

  getAll() {
    return getDb().prepare('SELECT * FROM settings').all();
  },

  set(key, value) {
    getDb().prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
  },

  delete(key) {
    return getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
  },
};

// =============================================
// Users
// =============================================

const users = {
  getByEmail(email) {
    return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  getById(id) {
    return getDb().prepare('SELECT id, email, name, company, role, created_at FROM users WHERE id = ?').get(id);
  },

  create(data) {
    const stmt = getDb().prepare(
      'INSERT INTO users (email, password_hash, name, company, role) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(
      data.email,
      data.passwordHash,
      data.name,
      data.company || null,
      data.role || 'client',
    );
    return { id: result.lastInsertRowid, email: data.email, name: data.name, role: data.role || 'client' };
  },

  count() {
    return getDb().prepare('SELECT COUNT(*) as c FROM users').get().c;
  },
};

// =============================================
// Refresh Tokens
// =============================================

const refreshTokens = {
  create(userId, tokenHash, expiresAt) {
    getDb().prepare(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(userId, tokenHash, expiresAt);
  },

  getByHash(tokenHash) {
    return getDb().prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
  },

  deleteByHash(tokenHash) {
    return getDb().prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
  },

  deleteByUser(userId) {
    return getDb().prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
  },

  deleteExpired() {
    return getDb().prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')").run();
  },
};

// =============================================
// Documents
// =============================================

const documents = {
  listByUser(userId) {
    return getDb().prepare(
      'SELECT id, filename, original_name, mime_type, file_size, created_at FROM documents WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId);
  },

  get(id) {
    return getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id);
  },

  create(data) {
    const stmt = getDb().prepare(
      'INSERT INTO documents (user_id, filename, original_name, mime_type, file_size, file_path, parsed_text) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(
      data.userId, data.filename, data.originalName, data.mimeType, data.fileSize, data.filePath, data.parsedText || null
    );
    return { id: result.lastInsertRowid, ...data };
  },

  delete(id) {
    return getDb().prepare('DELETE FROM documents WHERE id = ?').run(id);
  },

  getParsedTextByUser(userId) {
    return getDb().prepare(
      'SELECT original_name, parsed_text FROM documents WHERE user_id = ? AND parsed_text IS NOT NULL ORDER BY created_at DESC'
    ).all(userId);
  },
};

module.exports = {
  getDb,
  campaigns,
  touchpoints,
  diagnostics,
  versions,
  memoryPatterns,
  dashboardKpis,
  chatThreads,
  chatMessages,
  settings,
  users,
  refreshTokens,
  documents,
};
