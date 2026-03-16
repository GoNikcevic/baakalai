const useSqlite = !!process.env.DATABASE_PATH;

let pool;
if (!useSqlite) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
}

let sqliteAdapter;
if (useSqlite) {
  sqliteAdapter = require('./sqlite-adapter');
}

// Helper: run a query and return rows
async function query(text, params) {
  if (useSqlite) {
    return sqliteAdapter.query(text, params);
  }
  const result = await pool.query(text, params);
  return result;
}

// =============================================
// Campaigns
// =============================================

const campaigns = {
  async list(filter = {}) {
    let sql = 'SELECT * FROM campaigns';
    const conditions = [];
    const params = [];
    let i = 1;
    if (filter.userId) {
      conditions.push(`user_id = $${i++}`);
      params.push(filter.userId);
    }
    if (filter.status) {
      conditions.push(`status = $${i++}`);
      params.push(filter.status);
    }
    if (filter.channel) {
      conditions.push(`channel = $${i++}`);
      params.push(filter.channel);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    const result = await query(sql, params);
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM campaigns WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async getByLemlistId(lemlistId) {
    const result = await query('SELECT * FROM campaigns WHERE lemlist_id = $1', [lemlistId]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(`
      INSERT INTO campaigns (name, client, status, channel, sector, sector_short, position, size,
        angle, zone, tone, formality, length, cta, start_date, lemlist_id, iteration,
        nb_prospects, sent, planned, user_id, project_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *
    `, [
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
      data.projectId || null,
    ]);
    return result.rows[0];
  },

  async update(id, data) {
    const sets = [];
    const values = [];
    let i = 1;

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
      project_id: 'project_id', projectId: 'project_id',
    };

    const seen = new Set();
    for (const [inputKey, col] of Object.entries(mapping)) {
      if (data[inputKey] !== undefined && !seen.has(col)) {
        seen.add(col);
        sets.push(`${col} = $${i++}`);
        values.push(data[inputKey]);
      }
    }

    if (sets.length === 0) return null;
    sets.push('updated_at = now()');
    values.push(id);

    const result = await query(
      `UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    const result = await query('DELETE FROM campaigns WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Touchpoints
// =============================================

const touchpoints = {
  async listByCampaign(campaignId) {
    const result = await query(
      'SELECT * FROM touchpoints WHERE campaign_id = $1 ORDER BY sort_order',
      [campaignId]
    );
    return result.rows;
  },

  async create(campaignId, data) {
    const result = await query(`
      INSERT INTO touchpoints (campaign_id, step, type, label, sub_type, timing,
        subject, body, max_chars, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
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
    ]);
    return result.rows[0];
  },

  async update(id, data) {
    const sets = [];
    const values = [];
    let i = 1;
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
        sets.push(`${col} = $${i++}`);
        values.push(data[inputKey]);
      }
    }
    if (sets.length === 0) return null;
    sets.push('updated_at = now()');
    values.push(id);
    await query(`UPDATE touchpoints SET ${sets.join(', ')} WHERE id = $${i}`, values);
  },

  async deleteByCampaign(campaignId) {
    const result = await query('DELETE FROM touchpoints WHERE campaign_id = $1', [campaignId]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Diagnostics
// =============================================

const diagnostics = {
  async listByCampaign(campaignId) {
    const result = await query(
      'SELECT * FROM diagnostics WHERE campaign_id = $1 ORDER BY date_analyse DESC',
      [campaignId]
    );
    return result.rows;
  },

  async listAll() {
    const result = await query('SELECT * FROM diagnostics ORDER BY date_analyse DESC');
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM diagnostics WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(campaignId, data) {
    const result = await query(`
      INSERT INTO diagnostics (campaign_id, date_analyse, diagnostic, priorities, nb_to_optimize)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      campaignId,
      data.dateAnalyse || new Date().toISOString().split('T')[0],
      data.diagnostic,
      data.priorities || [],
      data.nbToOptimize || 0,
    ]);
    return result.rows[0];
  },

  async delete(id) {
    const result = await query('DELETE FROM diagnostics WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Versions
// =============================================

const versions = {
  async listByCampaign(campaignId) {
    const result = await query(
      'SELECT * FROM versions WHERE campaign_id = $1 ORDER BY version DESC',
      [campaignId]
    );
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM versions WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(campaignId, data) {
    const result = await query(`
      INSERT INTO versions (campaign_id, version, date, messages_modified, hypotheses, result)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      campaignId,
      data.version,
      data.date || new Date().toISOString().split('T')[0],
      data.messagesModified || [],
      data.hypotheses || '',
      data.result || 'testing',
    ]);
    return result.rows[0];
  },

  async update(id, data) {
    const sets = [];
    const values = [];
    let i = 1;
    const mapping = {
      version: 'version', date: 'date',
      messages_modified: 'messages_modified', messagesModified: 'messages_modified',
      hypotheses: 'hypotheses',
      result: 'result',
    };
    const seen = new Set();
    for (const [inputKey, col] of Object.entries(mapping)) {
      if (data[inputKey] !== undefined && !seen.has(col)) {
        seen.add(col);
        sets.push(`${col} = $${i++}`);
        values.push(data[inputKey]);
      }
    }
    if (sets.length === 0) return null;
    values.push(id);
    const result = await query(
      `UPDATE versions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  },

  async updateResult(id, resultVal) {
    await query('UPDATE versions SET result = $1 WHERE id = $2', [resultVal, id]);
  },

  async delete(id) {
    const result = await query('DELETE FROM versions WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Memory Patterns
// =============================================

const memoryPatterns = {
  async list(filter = {}) {
    let sql = 'SELECT * FROM memory_patterns';
    const conditions = [];
    const params = [];
    let i = 1;
    if (filter.category) {
      conditions.push(`category = $${i++}`);
      params.push(filter.category);
    }
    if (filter.confidence) {
      conditions.push(`confidence = $${i++}`);
      params.push(filter.confidence);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY date_discovered DESC';
    const result = await query(sql, params);
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM memory_patterns WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(`
      INSERT INTO memory_patterns (pattern, category, data, confidence, date_discovered, sectors, targets)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      data.pattern,
      data.category,
      data.data || null,
      data.confidence || 'Faible',
      data.dateDiscovered || new Date().toISOString().split('T')[0],
      data.sectors || [],
      data.targets || [],
    ]);
    return result.rows[0];
  },

  async update(id, data) {
    const sets = [];
    const values = [];
    let i = 1;
    const mapping = {
      pattern: 'pattern', category: 'category', data: 'data',
      confidence: 'confidence',
      date_discovered: 'date_discovered', dateDiscovered: 'date_discovered',
      sectors: 'sectors', targets: 'targets',
    };
    const seen = new Set();
    for (const [inputKey, col] of Object.entries(mapping)) {
      if (data[inputKey] !== undefined && !seen.has(col)) {
        seen.add(col);
        sets.push(`${col} = $${i++}`);
        values.push(data[inputKey]);
      }
    }
    if (sets.length === 0) return null;
    values.push(id);
    const result = await query(
      `UPDATE memory_patterns SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    const result = await query('DELETE FROM memory_patterns WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Stats helpers
// =============================================

async function dashboardKpis(userId) {
  const params = userId ? [userId] : [];
  const where = userId
    ? "WHERE status = 'active' AND user_id = $1"
    : "WHERE status = 'active'";
  const result = await query(`
    SELECT
      COUNT(*) as active_campaigns,
      COALESCE(SUM(nb_prospects), 0) as total_contacts,
      ROUND(AVG(CASE WHEN open_rate IS NOT NULL THEN open_rate END)::numeric, 1) as avg_open_rate,
      ROUND(AVG(CASE WHEN reply_rate IS NOT NULL THEN reply_rate END)::numeric, 1) as avg_reply_rate,
      ROUND(AVG(CASE WHEN accept_rate_lk IS NOT NULL THEN accept_rate_lk END)::numeric, 1) as avg_accept_rate,
      COALESCE(SUM(interested), 0) as total_interested,
      COALESCE(SUM(meetings), 0) as total_meetings
    FROM campaigns ${where}
  `, params);
  return result.rows[0];
}

// =============================================
// Chat
// =============================================

const chatThreads = {
  async list(userId) {
    if (userId) {
      const result = await query(
        'SELECT * FROM chat_threads WHERE user_id = $1 ORDER BY updated_at DESC',
        [userId]
      );
      return result.rows;
    }
    const result = await query('SELECT * FROM chat_threads ORDER BY updated_at DESC');
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM chat_threads WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(title, userId) {
    const result = await query(
      'INSERT INTO chat_threads (title, user_id) VALUES ($1, $2) RETURNING *',
      [title || 'Nouvelle conversation', userId || null]
    );
    return result.rows[0];
  },

  async updateTitle(id, title) {
    await query('UPDATE chat_threads SET title = $1, updated_at = now() WHERE id = $2', [title, id]);
  },

  async touch(id) {
    await query('UPDATE chat_threads SET updated_at = now() WHERE id = $1', [id]);
  },

  async delete(id) {
    const result = await query('DELETE FROM chat_threads WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },
};

const chatMessages = {
  async listByThread(threadId) {
    const result = await query(
      'SELECT * FROM chat_messages WHERE thread_id = $1 ORDER BY created_at ASC',
      [threadId]
    );
    return result.rows;
  },

  async create(threadId, role, content, metadata) {
    const result = await query(
      'INSERT INTO chat_messages (thread_id, role, content, metadata) VALUES ($1, $2, $3, $4) RETURNING *',
      [threadId, role, content, metadata ? JSON.stringify(metadata) : null]
    );
    await chatThreads.touch(threadId);
    return result.rows[0];
  },

  async deleteByThread(threadId) {
    const result = await query('DELETE FROM chat_messages WHERE thread_id = $1', [threadId]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Settings (key-value store for encrypted API keys)
// =============================================

const settings = {
  async get(key) {
    const result = await query('SELECT * FROM settings WHERE key = $1', [key]);
    return result.rows[0] || null;
  },

  async getAll() {
    const result = await query('SELECT * FROM settings');
    return result.rows;
  },

  async set(key, value) {
    await query(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `, [key, value]);
  },

  async delete(key) {
    const result = await query('DELETE FROM settings WHERE key = $1', [key]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Users
// =============================================

const users = {
  async getByEmail(email) {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async getById(id) {
    const result = await query(
      'SELECT id, email, name, company, role, created_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(
      'INSERT INTO users (email, password_hash, name, company, role) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [data.email, data.passwordHash, data.name, data.company || null, data.role || 'client']
    );
    return result.rows[0];
  },

  async count() {
    const result = await query('SELECT COUNT(*) as c FROM users');
    return parseInt(result.rows[0].c, 10);
  },
};

// =============================================
// Refresh Tokens
// =============================================

const refreshTokens = {
  async create(userId, tokenHash, expiresAt) {
    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt]
    );
  },

  async getByHash(tokenHash) {
    const result = await query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    return result.rows[0] || null;
  },

  async deleteByHash(tokenHash) {
    const result = await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    return { changes: result.rowCount };
  },

  async deleteByUser(userId) {
    const result = await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    return { changes: result.rowCount };
  },

  async deleteExpired() {
    const result = await query("DELETE FROM refresh_tokens WHERE expires_at < now()");
    return { changes: result.rowCount };
  },
};

// =============================================
// Documents
// =============================================

const documents = {
  async listByUser(userId) {
    const result = await query(
      'SELECT id, filename, original_name, mime_type, file_size, created_at FROM documents WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM documents WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(
      'INSERT INTO documents (user_id, filename, original_name, mime_type, file_size, file_path, parsed_text) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [data.userId, data.filename, data.originalName, data.mimeType, data.fileSize, data.filePath, data.parsedText || null]
    );
    return result.rows[0];
  },

  async delete(id) {
    const result = await query('DELETE FROM documents WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },

  async getParsedTextByUser(userId) {
    const result = await query(
      'SELECT original_name, parsed_text FROM documents WHERE user_id = $1 AND parsed_text IS NOT NULL ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  },
};

// =============================================
// User Profiles
// =============================================

const profiles = {
  async get(userId) {
    const result = await query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
    return result.rows[0] || null;
  },

  async upsert(userId, data) {
    const existing = await this.get(userId);
    if (existing) {
      const sets = [];
      const vals = [];
      let i = 1;
      const fields = [
        'company', 'sector', 'website', 'team_size', 'description',
        'value_prop', 'social_proof', 'pain_points', 'objections',
        'persona_primary', 'persona_secondary', 'target_sectors',
        'target_size', 'target_zones', 'default_tone', 'default_formality',
        'avoid_words', 'signature_phrases',
      ];
      for (const f of fields) {
        if (data[f] !== undefined) {
          sets.push(`${f} = $${i++}`);
          vals.push(data[f]);
        }
      }
      if (sets.length === 0) return existing;
      sets.push('updated_at = now()');
      vals.push(userId);
      await query(`UPDATE user_profiles SET ${sets.join(', ')} WHERE user_id = $${i}`, vals);
    } else {
      await query(`
        INSERT INTO user_profiles (user_id, company, sector, website, team_size, description,
          value_prop, social_proof, pain_points, objections, persona_primary, persona_secondary,
          target_sectors, target_size, target_zones, default_tone, default_formality,
          avoid_words, signature_phrases)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        userId, data.company || null, data.sector || null, data.website || null,
        data.team_size || null, data.description || null, data.value_prop || null,
        data.social_proof || null, data.pain_points || null, data.objections || null,
        data.persona_primary || null, data.persona_secondary || null,
        data.target_sectors || null, data.target_size || null, data.target_zones || null,
        data.default_tone || 'Pro décontracté', data.default_formality || 'Vous',
        data.avoid_words || null, data.signature_phrases || null,
      ]);
    }
    return this.get(userId);
  },
};

// =============================================
// Projects
// =============================================

const projects = {
  async list(userId) {
    const result = await query(
      'SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM projects WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(
      'INSERT INTO projects (user_id, name, client, description, color) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [data.userId, data.name, data.client || null, data.description || null, data.color || 'var(--blue)']
    );
    return result.rows[0];
  },

  async update(id, data) {
    const sets = [];
    const values = [];
    let i = 1;
    const fields = ['name', 'client', 'description', 'color'];
    for (const f of fields) {
      if (data[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        values.push(data[f]);
      }
    }
    if (sets.length === 0) {
      return this.get(id);
    }
    sets.push('updated_at = now()');
    values.push(id);
    await query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${i}`, values);
    return this.get(id);
  },

  async delete(id) {
    const result = await query('DELETE FROM projects WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Project Files
// =============================================

const projectFiles = {
  async listByProject(projectId) {
    const result = await query(
      'SELECT * FROM project_files WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM project_files WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(
      'INSERT INTO project_files (project_id, user_id, filename, original_name, mime_type, file_size, file_path, parsed_text, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [data.projectId, data.userId, data.filename, data.originalName, data.mimeType, data.fileSize, data.filePath, data.parsedText || null, data.category || 'other']
    );
    return result.rows[0];
  },

  async delete(id) {
    const result = await query('DELETE FROM project_files WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },

  async getContextByProject(projectId) {
    const result = await query(
      'SELECT original_name, parsed_text, category FROM project_files WHERE project_id = $1 AND parsed_text IS NOT NULL ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  },
};

// =============================================
// Custom Variables
// =============================================

const customVariables = {
  async listByUser(userId) {
    const result = await query(
      'SELECT * FROM custom_variables WHERE user_id = $1 ORDER BY created_at ASC',
      [userId]
    );
    return result.rows;
  },

  async create(userId, data) {
    const result = await query(`
      INSERT INTO custom_variables (user_id, key, label, category, sync_mode, default_value)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      userId,
      data.key,
      data.label || data.key,
      data.category || 'custom',
      data.syncMode || 'local',
      data.defaultValue || null,
    ]);
    return result.rows[0];
  },

  async delete(id, userId) {
    const result = await query(
      'DELETE FROM custom_variables WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return { changes: result.rowCount };
  },
};

// =============================================
// Opportunities
// =============================================

const opportunities = {
  async listByUser(userId, limit = 10) {
    const result = await query(
      'SELECT * FROM opportunities WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM opportunities WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(`
      INSERT INTO opportunities (user_id, campaign_id, name, title, company, company_size, status, status_color, timing, email, hubspot_contact_id, hubspot_deal_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      data.userId || null,
      data.campaignId || null,
      data.name,
      data.title || null,
      data.company || null,
      data.companySize || null,
      data.status || 'new',
      data.statusColor || null,
      data.timing || null,
      data.email || null,
      data.hubspotContactId || null,
      data.hubspotDealId || null,
    ]);
    return result.rows[0];
  },

  async update(id, data) {
    const sets = [];
    const values = [];
    let i = 1;
    const mapping = {
      name: 'name', title: 'title', company: 'company',
      company_size: 'company_size', companySize: 'company_size',
      status: 'status', status_color: 'status_color', statusColor: 'status_color',
      timing: 'timing', email: 'email',
      hubspot_contact_id: 'hubspot_contact_id', hubspotContactId: 'hubspot_contact_id',
      hubspot_deal_id: 'hubspot_deal_id', hubspotDealId: 'hubspot_deal_id',
    };
    const seen = new Set();
    for (const [inputKey, col] of Object.entries(mapping)) {
      if (data[inputKey] !== undefined && !seen.has(col)) {
        seen.add(col);
        sets.push(`${col} = $${i++}`);
        values.push(data[inputKey]);
      }
    }
    if (sets.length === 0) return null;
    sets.push('updated_at = now()');
    values.push(id);
    const result = await query(
      `UPDATE opportunities SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    const result = await query('DELETE FROM opportunities WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Reports
// =============================================

const reports = {
  async listByUser(userId, limit = 10) {
    const result = await query(
      'SELECT * FROM reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM reports WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(`
      INSERT INTO reports (user_id, week, date_range, score, score_label, contacts, open_rate, reply_rate, interested, meetings, synthesis)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      data.userId || null,
      data.week,
      data.dateRange || null,
      data.score || 'ok',
      data.scoreLabel || null,
      data.contacts || 0,
      data.openRate || null,
      data.replyRate || null,
      data.interested || 0,
      data.meetings || 0,
      data.synthesis || null,
    ]);
    return result.rows[0];
  },

  async delete(id) {
    const result = await query('DELETE FROM reports WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },
};

// =============================================
// Chart Data
// =============================================

const chartData = {
  async listByUser(userId, limit = 12) {
    const result = await query(
      'SELECT * FROM chart_data WHERE user_id = $1 ORDER BY week_start ASC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  },

  async create(data) {
    const result = await query(`
      INSERT INTO chart_data (user_id, label, email_count, linkedin_count, week_start)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      data.userId || null,
      data.label,
      data.emailCount || 0,
      data.linkedinCount || 0,
      data.weekStart || null,
    ]);
    return result.rows[0];
  },

  async deleteByUser(userId) {
    const result = await query('DELETE FROM chart_data WHERE user_id = $1', [userId]);
    return { changes: result.rowCount };
  },
};

// =============================================
// User Integrations (per-user CRM tokens)
// =============================================

const userIntegrations = {
  async get(userId, provider) {
    const result = await query(
      'SELECT * FROM user_integrations WHERE user_id = $1 AND provider = $2',
      [userId, provider]
    );
    return result.rows[0] || null;
  },

  async listByUser(userId) {
    const result = await query(
      'SELECT * FROM user_integrations WHERE user_id = $1 ORDER BY provider',
      [userId]
    );
    return result.rows;
  },

  async upsert(userId, provider, data) {
    const existing = await this.get(userId, provider);
    if (existing) {
      const sets = ['access_token = $1', 'updated_at = now()'];
      const values = [data.accessToken];
      let i = 2;
      if (data.refreshToken !== undefined) {
        sets.push(`refresh_token = $${i++}`);
        values.push(data.refreshToken);
      }
      if (data.metadata !== undefined) {
        sets.push(`metadata = $${i++}`);
        values.push(typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata));
      }
      if (data.expiresAt !== undefined) {
        sets.push(`expires_at = $${i++}`);
        values.push(data.expiresAt);
      }
      values.push(userId, provider);
      const result = await query(
        `UPDATE user_integrations SET ${sets.join(', ')} WHERE user_id = $${i++} AND provider = $${i} RETURNING *`,
        values
      );
      return result.rows[0] || null;
    }
    const result = await query(`
      INSERT INTO user_integrations (user_id, provider, access_token, refresh_token, metadata, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      userId,
      provider,
      data.accessToken,
      data.refreshToken || null,
      data.metadata ? (typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata)) : '{}',
      data.expiresAt || null,
    ]);
    return result.rows[0];
  },

  async delete(userId, provider) {
    const result = await query(
      'DELETE FROM user_integrations WHERE user_id = $1 AND provider = $2',
      [userId, provider]
    );
    return { changes: result.rowCount };
  },
};

// =============================================
// Raw query helper (for special cases in routes)
// =============================================

async function rawQuery(text, params) {
  if (useSqlite) {
    return sqliteAdapter.query(text, params);
  }
  const result = await pool.query(text, params);
  return result;
}

async function closeDb() {
  if (useSqlite && sqliteAdapter) {
    sqliteAdapter.closeDb();
  } else if (pool) {
    await pool.end();
  }
}

module.exports = {
  query: rawQuery,
  closeDb,
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
  profiles,
  projects,
  projectFiles,
  customVariables,
  opportunities,
  reports,
  chartData,
  userIntegrations,
};
