const useSqlite = !!process.env.DATABASE_PATH;

if (useSqlite) {
  console.warn('⚠️  SQLite mode is intended for local development only. Set DATABASE_URL for production.');
}

let pool;
if (!useSqlite) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    // Scalability: explicit pool sizing for 1000+ users
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Recycle connections to avoid stale TCP sockets
    maxLifetimeMillis: 1800000, // 30 minutes
  });

  // Log pool errors (don't crash)
  pool.on('error', (err) => {
    console.error('[db] Idle client error:', err.message);
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
    } else if (!filter.includeArchived) {
      // Exclude archived by default unless explicitly asked
      conditions.push(`(status IS NULL OR status != 'archived')`);
    }
    if (filter.channel) {
      conditions.push(`channel = $${i++}`);
      params.push(filter.channel);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    // Pagination support
    if (filter.limit) {
      sql += ` LIMIT $${i++}`;
      params.push(filter.limit);
    }
    if (filter.offset) {
      sql += ` OFFSET $${i++}`;
      params.push(filter.offset);
    }
    const result = await query(sql, params);
    return result.rows;
  },

  async count(filter = {}) {
    let sql = 'SELECT COUNT(*) as total FROM campaigns';
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
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    const result = await query(sql, params);
    return parseInt(result.rows[0].total, 10);
  },

  // Batch load touchpoints for multiple campaigns (eliminates N+1)
  async listWithTouchpoints(filter = {}) {
    const campaignRows = await this.list(filter);
    if (campaignRows.length === 0) return [];

    const ids = campaignRows.map(c => c.id);
    const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(',');
    const tpResult = await query(
      `SELECT * FROM touchpoints WHERE campaign_id IN (${placeholders}) ORDER BY sort_order`,
      ids
    );

    const tpMap = {};
    for (const tp of tpResult.rows) {
      if (!tpMap[tp.campaign_id]) tpMap[tp.campaign_id] = [];
      tpMap[tp.campaign_id].push(tp);
    }

    return campaignRows.map(c => ({
      ...c,
      sequence: tpMap[c.id] || [],
    }));
  },

  async get(id) {
    const result = await query('SELECT * FROM campaigns WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  // Get campaign with all related data in batch (eliminates N+1)
  async getWithRelations(id) {
    const [campResult, tpResult, diagResult, verResult] = await Promise.all([
      query('SELECT * FROM campaigns WHERE id = $1', [id]),
      query('SELECT * FROM touchpoints WHERE campaign_id = $1 ORDER BY sort_order', [id]),
      query('SELECT * FROM diagnostics WHERE campaign_id = $1 ORDER BY date_analyse DESC', [id]),
      query('SELECT * FROM versions WHERE campaign_id = $1 ORDER BY version DESC', [id]),
    ]);
    const campaign = campResult.rows[0] || null;
    if (!campaign) return null;
    return {
      campaign,
      sequence: tpResult.rows,
      diagnostics: diagResult.rows,
      history: verResult.rows,
    };
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
      ab_config: 'ab_config', abConfig: 'ab_config',
      last_optimized_at: 'last_optimized_at', lastOptimizedAt: 'last_optimized_at',
      batch_mode: 'batch_mode', batchMode: 'batch_mode',
      batch_size: 'batch_size', batchSize: 'batch_size',
      current_batch: 'current_batch', currentBatch: 'current_batch',
      total_batches: 'total_batches', totalBatches: 'total_batches',
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
    // Normalize type — Claude or upstream callers may emit camelCase, shorthand,
    // or legacy generic "linkedin". Coerce everything to one of the 5 valid CHECK values.
    const ALLOWED_TYPES = ['email', 'linkedin', 'linkedin_visit', 'linkedin_invite', 'linkedin_message'];
    const rawType = String(data.type || '').trim();
    const normalized = rawType.toLowerCase().replace(/[\s-]+/g, '_');
    const stepStr = String(data.step || '').toUpperCase();

    const inferLinkedinFromStep = () => {
      if (stepStr.startsWith('LV')) return 'linkedin_visit';
      if (stepStr.startsWith('LM')) return 'linkedin_message';
      if (stepStr.startsWith('LI') || stepStr === 'L1') return 'linkedin_invite';
      return 'linkedin_message';
    };

    let type;
    if (normalized === 'email' || normalized === 'mail' || stepStr.startsWith('E')) {
      type = 'email';
    } else if (normalized === 'linkedin_visit' || normalized === 'linkedinvisit' || normalized === 'visit' || normalized === 'profile_visit' || normalized === 'profilevisit') {
      type = 'linkedin_visit';
    } else if (normalized === 'linkedin_invite' || normalized === 'linkedininvite' || normalized === 'invite' || normalized === 'linkedin_connection' || normalized === 'linkedinconnection' || normalized === 'connection' || normalized === 'connect' || normalized === 'linkedin_note' || normalized === 'note') {
      type = 'linkedin_invite';
    } else if (normalized === 'linkedin_message' || normalized === 'linkedinmessage' || normalized === 'linkedinsendmessage' || normalized === 'linkedin_send_message' || normalized === 'message' || normalized === 'linkedin_msg' || normalized === 'msg') {
      type = 'linkedin_message';
    } else if (normalized === 'linkedin' || normalized.startsWith('linkedin')) {
      type = inferLinkedinFromStep();
    } else if (ALLOWED_TYPES.includes(normalized)) {
      type = normalized;
    } else {
      console.warn(`[touchpoints] Unknown type "${rawType}" for step "${data.step}" — defaulting to email`);
      type = 'email';
    }

    // Enforce 300-char limit on connection invites + null subject
    let body = data.body || '';
    let subject = data.subject || null;
    let bodyB = data.bodyB || data.body_b || null;
    let subjectB = data.subjectB || data.subject_b || null;
    let maxChars = data.maxChars || null;

    if (type === 'linkedin_invite') {
      maxChars = 300;
      subject = null;
      subjectB = null;
      if (body.length > 300) {
        console.warn(`[touchpoints] Truncating linkedin_invite body from ${body.length} to 300 chars (step: ${data.step})`);
        body = body.slice(0, 300);
      }
      if (bodyB && bodyB.length > 300) {
        bodyB = bodyB.slice(0, 300);
      }
    }
    if (type === 'linkedin_visit') {
      body = '';
      subject = null;
      bodyB = null;
      subjectB = null;
    }
    if (type === 'linkedin_message') {
      subject = null;
      subjectB = null;
    }

    const result = await query(`
      INSERT INTO touchpoints (campaign_id, step, type, label, sub_type, timing,
        subject, body, subject_b, body_b, max_chars, sort_order,
        parent_step_id, condition_type, condition_value, branch_label, is_root)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      campaignId,
      data.step,
      type,
      data.label || null,
      data.subType || null,
      data.timing || null,
      subject,
      body,
      subjectB,
      bodyB,
      maxChars,
      data.sortOrder || 0,
      data.parentStepId || null,
      data.conditionType || null,
      data.conditionValue || null,
      data.branchLabel || null,
      data.isRoot !== undefined ? data.isRoot : true,
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
      // Conditional/branching fields
      parent_step_id: 'parent_step_id', parentStepId: 'parent_step_id',
      condition_type: 'condition_type', conditionType: 'condition_type',
      condition_value: 'condition_value', conditionValue: 'condition_value',
      branch_label: 'branch_label', branchLabel: 'branch_label',
      is_root: 'is_root', isRoot: 'is_root',
      // A/B variant B fields
      subject_b: 'subject_b', subjectB: 'subject_b',
      body_b: 'body_b', bodyB: 'body_b',
      open_rate_b: 'open_rate_b', openRateB: 'open_rate_b',
      reply_rate_b: 'reply_rate_b', replyRateB: 'reply_rate_b',
      accept_rate_b: 'accept_rate_b', acceptRateB: 'accept_rate_b',
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

  async listTreeByCampaign(campaignId) {
    const result = await query(
      'SELECT * FROM touchpoints WHERE campaign_id = $1 ORDER BY sort_order',
      [campaignId]
    );
    const all = result.rows;
    // Build tree: root steps have is_root=true or parent_step_id=null
    const roots = all.filter(t => !t.parent_step_id);
    function attachChildren(node) {
      node.children = all.filter(t => t.parent_step_id === node.id);
      node.children.forEach(attachChildren);
      return node;
    }
    return roots.map(attachChildren);
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
  async listByCampaign(campaignId, limit) {
    let sql = 'SELECT * FROM diagnostics WHERE campaign_id = $1 ORDER BY date_analyse DESC';
    const params = [campaignId];
    if (limit) {
      sql += ' LIMIT $2';
      params.push(limit);
    }
    const result = await query(sql, params);
    return result.rows;
  },

  async listAll(limit = 100) {
    const result = await query(
      'SELECT * FROM diagnostics ORDER BY date_analyse DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  },

  async listByUserCampaigns(userId, limit = 50) {
    const result = await query(`
      SELECT d.*, c.name as campaign_name, c.sector as campaign_sector
      FROM diagnostics d
      JOIN campaigns c ON c.id = d.campaign_id
      WHERE c.user_id = $1
      ORDER BY d.date_analyse DESC
      LIMIT $2
    `, [userId, limit]);
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

  async deleteByCampaign(campaignId) {
    const result = await query('DELETE FROM diagnostics WHERE campaign_id = $1', [campaignId]);
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

  // Batch load latest version for multiple campaigns
  async latestForCampaigns(campaignIds) {
    if (campaignIds.length === 0) return {};
    const placeholders = campaignIds.map((_, idx) => `$${idx + 1}`).join(',');
    const result = await query(`
      SELECT DISTINCT ON (campaign_id) *
      FROM versions
      WHERE campaign_id IN (${placeholders})
      ORDER BY campaign_id, version DESC
    `, campaignIds);
    const map = {};
    for (const row of result.rows) {
      map[row.campaign_id] = row;
    }
    return map;
  },

  async get(id) {
    const result = await query('SELECT * FROM versions WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(campaignId, data) {
    const result = await query(`
      INSERT INTO versions (campaign_id, version, date, messages_modified, hypotheses, result, rollback_data, tested_steps, ab_categories)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      campaignId,
      data.version,
      data.date || new Date().toISOString().split('T')[0],
      data.messagesModified || [],
      data.hypotheses || '',
      data.result || 'testing',
      data.rollbackData || null,
      data.testedSteps || [],
      data.abCategories || [],
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
      rollback_data: 'rollback_data', rollbackData: 'rollback_data',
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

  async deleteByCampaign(campaignId) {
    const result = await query('DELETE FROM versions WHERE campaign_id = $1', [campaignId]);
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
    // Default limit to prevent unbounded loads
    const limit = filter.limit || 100;
    sql += ` LIMIT $${i++}`;
    params.push(limit);
    if (filter.offset) {
      sql += ` OFFSET $${i++}`;
      params.push(filter.offset);
    }
    const result = await query(sql, params);
    return result.rows;
  },

  async count(filter = {}) {
    let sql = 'SELECT COUNT(*) as total FROM memory_patterns';
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
    const result = await query(sql, params);
    return parseInt(result.rows[0].total, 10);
  },

  async get(id) {
    const result = await query('SELECT * FROM memory_patterns WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(`
      INSERT INTO memory_patterns (pattern, category, data, confidence, date_discovered, sectors, targets,
        ab_category, custom_category, source_test_id, sample_size, improvement_pct, confirmations)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      data.pattern,
      data.category,
      data.data || null,
      data.confidence || 'Faible',
      data.dateDiscovered || new Date().toISOString().split('T')[0],
      data.sectors || [],
      data.targets || [],
      data.ab_category || data.abCategory || null,
      data.custom_category || data.customCategory || null,
      data.sourceTestId || data.source_test_id || null,
      data.sample_size || data.sampleSize || 0,
      data.improvement_pct || data.improvementPct || null,
      data.confirmations || 1,
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
      ab_category: 'ab_category', abCategory: 'ab_category',
      custom_category: 'custom_category', customCategory: 'custom_category',
      source_test_id: 'source_test_id', sourceTestId: 'source_test_id',
      sample_size: 'sample_size', sampleSize: 'sample_size',
      improvement_pct: 'improvement_pct', improvementPct: 'improvement_pct',
      confirmations: 'confirmations',
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

  async pruneOld(daysOld = 90) {
    const result = await query(
      `DELETE FROM memory_patterns WHERE confidence = 'Faible' AND created_at < NOW() - INTERVAL '1 day' * $1 RETURNING id`,
      [daysOld]
    );
    return result.rows.length;
  },
};

// =============================================
// Templates
// =============================================

const templates = {
  async list() {
    const result = await query('SELECT * FROM templates ORDER BY popularity DESC, created_at DESC');
    return result.rows;
  },
  async get(id) {
    const result = await query('SELECT * FROM templates WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
  async create(data) {
    const result = await query(
      `INSERT INTO templates (name, sector, channel, description, tags, popularity, source, source_campaign_id, sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [data.name, data.sector, data.channel || 'email', data.description, data.tags || [], data.popularity || 0, data.source || 'static', data.sourceCampaignId || null, JSON.stringify(data.sequence)]
    );
    return result.rows[0];
  },
  async incrementPopularity(id) {
    await query('UPDATE templates SET popularity = popularity + 1 WHERE id = $1', [id]);
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
  async list(userId, limit = 50) {
    if (userId) {
      const result = await query(
        'SELECT * FROM chat_threads WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
        [userId, limit]
      );
      return result.rows;
    }
    const result = await query('SELECT * FROM chat_threads ORDER BY updated_at DESC LIMIT $1', [limit]);
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
  async listByThread(threadId, limit = 100) {
    const result = await query(
      'SELECT * FROM chat_messages WHERE thread_id = $1 ORDER BY created_at ASC LIMIT $2',
      [threadId, limit]
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
    const result = await query('SELECT id, email, name, company, role, password_hash, email_verified, language, created_at FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async getById(id) {
    const result = await query(
      'SELECT id, email, name, company, role, language, created_at FROM users WHERE id = $1',
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

  async deleteAllByUser(userId) {
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
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
      'SELECT id, filename, original_name, mime_type, file_size, doc_type, created_at FROM documents WHERE user_id = $1 ORDER BY created_at DESC',
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
      'INSERT INTO documents (user_id, filename, original_name, mime_type, file_size, file_path, parsed_text, doc_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [data.userId, data.filename, data.originalName, data.mimeType, data.fileSize, data.filePath, data.parsedText || null, data.docType || 'other']
    );
    return result.rows[0];
  },

  async delete(id) {
    const result = await query('DELETE FROM documents WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },

  async updateParsedText(id, parsedText) {
    const result = await query(
      'UPDATE documents SET parsed_text = $1 WHERE id = $2 RETURNING *',
      [parsedText, id]
    );
    return result.rows[0] || null;
  },

  async getParsedTextByUser(userId, limit = 10) {
    const result = await query(
      'SELECT original_name, parsed_text, doc_type FROM documents WHERE user_id = $1 AND parsed_text IS NOT NULL ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
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

  // Batch load projects with file counts and campaign counts (eliminates N+1)
  async listWithCounts(userId) {
    const result = await query(`
      SELECT p.*,
        COALESCE(fc.file_count, 0)::int as file_count,
        COALESCE(cc.campaign_count, 0)::int as campaign_count
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) as file_count FROM project_files GROUP BY project_id
      ) fc ON fc.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as campaign_count FROM campaigns WHERE user_id = $1 GROUP BY project_id
      ) cc ON cc.project_id = p.id
      WHERE p.user_id = $1
      ORDER BY p.updated_at DESC
    `, [userId]);
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
  async listByUser(userId, limit = 20, offset = 0) {
    const result = await query(
      'SELECT * FROM opportunities WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    return result.rows;
  },

  async listByCampaign(campaignId) {
    const result = await query(
      'SELECT * FROM opportunities WHERE campaign_id = $1 ORDER BY created_at DESC',
      [campaignId]
    );
    return result.rows;
  },

  async get(id) {
    const result = await query('SELECT * FROM opportunities WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data) {
    const result = await query(`
      INSERT INTO opportunities (user_id, campaign_id, name, title, company, company_size, status, status_color, timing, email, linkedin_url, hubspot_contact_id, hubspot_deal_id, crm_provider, crm_contact_id, crm_deal_id, owner_id, owner_email, crm_owner_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
      data.linkedinUrl || null,
      data.hubspotContactId || null,
      data.hubspotDealId || null,
      data.crmProvider || data.crm_provider || null,
      data.crmContactId || data.crm_contact_id || null,
      data.crmDealId || data.crm_deal_id || null,
      data.ownerId || data.owner_id || null,
      data.ownerEmail || data.owner_email || null,
      data.crmOwnerId || data.crm_owner_id || null,
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
      linkedin_url: 'linkedin_url', linkedinUrl: 'linkedin_url',
      batch_number: 'batch_number', batchNumber: 'batch_number',
      hubspot_contact_id: 'hubspot_contact_id', hubspotContactId: 'hubspot_contact_id',
      hubspot_deal_id: 'hubspot_deal_id', hubspotDealId: 'hubspot_deal_id',
      crm_provider: 'crm_provider', crmProvider: 'crm_provider',
      crm_contact_id: 'crm_contact_id', crmContactId: 'crm_contact_id',
      crm_deal_id: 'crm_deal_id', crmDealId: 'crm_deal_id',
      personalization: 'personalization',
      churn_score: 'churn_score', churnScore: 'churn_score',
      churn_factors: 'churn_factors', churnFactors: 'churn_factors',
      owner_id: 'owner_id', ownerId: 'owner_id',
      owner_email: 'owner_email', ownerEmail: 'owner_email',
      crm_owner_id: 'crm_owner_id', crmOwnerId: 'crm_owner_id',
    };
    const jsonbCols = new Set(['personalization', 'churn_factors']);
    const seen = new Set();
    for (const [inputKey, col] of Object.entries(mapping)) {
      if (data[inputKey] !== undefined && !seen.has(col)) {
        seen.add(col);
        sets.push(`${col} = $${i++}`);
        const val = data[inputKey];
        values.push(jsonbCols.has(col) && typeof val === 'object' ? JSON.stringify(val) : val);
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

  async updateScore(id, score, scoreBreakdown) {
    const result = await query(
      `UPDATE opportunities SET score = $1, score_breakdown = $2 WHERE id = $3 RETURNING *`,
      [score, JSON.stringify(scoreBreakdown), id]
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    const result = await query('DELETE FROM opportunities WHERE id = $1', [id]);
    return { changes: result.rowCount };
  },

  async findByEmail(userId, email) {
    if (!email) return null;
    const result = await query(
      'SELECT * FROM opportunities WHERE user_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1',
      [userId, email]
    );
    return result.rows[0] || null;
  },
};

// =============================================
// Reports
// =============================================

const reports = {
  async listByUser(userId, limit = 20, offset = 0) {
    const result = await query(
      'SELECT * FROM reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
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
  async listByUser(userId, limit = 52) {
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
// Job Queue (PostgreSQL-backed, replaces in-memory queue)
// =============================================

const jobQueue = {
  async add(jobName, data = {}, opts = {}) {
    const priority = opts.priority || 0;
    const maxAttempts = opts.maxAttempts || 3;
    const result = await query(`
      INSERT INTO job_queue (job_name, data, priority, max_attempts, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `, [jobName, JSON.stringify(data), priority, maxAttempts]);
    return result.rows[0];
  },

  async claimNext() {
    // Atomic claim: grab the oldest pending job and mark it processing
    const result = await query(`
      UPDATE job_queue SET status = 'processing', started_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM job_queue
        WHERE status = 'pending' AND (run_after IS NULL OR run_after <= now())
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    return result.rows[0] || null;
  },

  async complete(id) {
    await query(
      "UPDATE job_queue SET status = 'completed', completed_at = now() WHERE id = $1",
      [id]
    );
  },

  async fail(id, errorMsg) {
    // Check if we should retry or move to dead letter
    const job = await query('SELECT * FROM job_queue WHERE id = $1', [id]);
    const row = job.rows[0];
    if (row && row.attempts < row.max_attempts) {
      // Exponential backoff: 2^attempts seconds
      const backoffSec = Math.pow(2, row.attempts);
      await query(
        "UPDATE job_queue SET status = 'pending', last_error = $1, run_after = now() + ($2 || ' seconds')::interval WHERE id = $3",
        [errorMsg, backoffSec.toString(), id]
      );
    } else {
      await query(
        "UPDATE job_queue SET status = 'dead', last_error = $1, completed_at = now() WHERE id = $2",
        [errorMsg, id]
      );
    }
  },

  async getDeadLetterQueue(limit = 50) {
    const result = await query(
      "SELECT * FROM job_queue WHERE status = 'dead' ORDER BY completed_at DESC LIMIT $1",
      [limit]
    );
    return result.rows;
  },

  async cleanup(olderThanDays = 7) {
    const result = await query(
      "DELETE FROM job_queue WHERE status = 'completed' AND completed_at < now() - ($1 || ' days')::interval",
      [olderThanDays.toString()]
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

// Health check: verify DB connection is alive
async function healthCheck() {
  if (useSqlite) return { ok: true, mode: 'sqlite' };
  try {
    const result = await pool.query('SELECT 1 as ok');
    const poolStats = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
    return { ok: result.rows[0].ok === 1, mode: 'postgresql', pool: poolStats };
  } catch (err) {
    return { ok: false, mode: 'postgresql', error: err.message };
  }
}

// =============================================
// Recommendation Feedback
// =============================================

const recoFeedback = {
  async create(userId, patternId, patternText, feedback) {
    const result = await query(
      `INSERT INTO recommendation_feedback (user_id, pattern_id, pattern_text, feedback) VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, patternId, patternText, feedback]
    );
    return result.rows[0];
  },
  async listByUser(userId) {
    const result = await query(
      `SELECT * FROM recommendation_feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    return result.rows;
  },
};

// =============================================
// Notifications
// =============================================

const notifications = {
  async create(userId, type, title, body, metadata) {
    const result = await query(
      `INSERT INTO notifications (user_id, type, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, type, title, body || null, metadata ? JSON.stringify(metadata) : '{}']
    );
    return result.rows[0];
  },

  async listByUser(userId, limit = 20, offset = 0) {
    const result = await query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  },

  async countUnread(userId) {
    const result = await query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = false`,
      [userId]
    );
    return result.rows[0].count;
  },

  async markRead(id, userId) {
    const result = await query(
      `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId]
    );
    return result.rows[0] || null;
  },

  async markAllRead(userId) {
    await query(
      `UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`,
      [userId]
    );
  },
};

// =============================================
// Prospect Activities (Lemlist replies, opens, etc.)
// =============================================

const prospectActivities = {
  async listByCampaign(campaignId, { type, limit = 50, offset = 0 } = {}) {
    const conditions = ['campaign_id = $1'];
    const params = [campaignId];
    let idx = 2;
    if (type) {
      conditions.push(`type = $${idx++}`);
      params.push(type);
    }
    params.push(limit, offset);
    const result = await query(
      `SELECT * FROM prospect_activities WHERE ${conditions.join(' AND ')} ORDER BY happened_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params
    );
    return result.rows;
  },

  async listByUser(userId, { type, limit = 50, offset = 0 } = {}) {
    const conditions = ['user_id = $1'];
    const params = [userId];
    let idx = 2;
    if (type) {
      conditions.push(`type = $${idx++}`);
      params.push(type);
    }
    params.push(limit, offset);
    const result = await query(
      `SELECT pa.*, c.name as campaign_name FROM prospect_activities pa LEFT JOIN campaigns c ON c.id = pa.campaign_id WHERE ${conditions.join(' AND ')} ORDER BY pa.happened_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params
    );
    return result.rows;
  },

  async countByCampaign(campaignId, type) {
    const conditions = ['campaign_id = $1'];
    const params = [campaignId];
    if (type) {
      conditions.push('type = $2');
      params.push(type);
    }
    const result = await query(
      `SELECT COUNT(*) as count FROM prospect_activities WHERE ${conditions.join(' AND ')}`,
      params
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  },

  async upsert(data) {
    const result = await query(`
      INSERT INTO prospect_activities (user_id, campaign_id, opportunity_id, lemlist_activity_id, type, lead_email, lead_first_name, lead_last_name, company_name, sequence_step, happened_at, content, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (lemlist_activity_id) DO UPDATE SET content = COALESCE(EXCLUDED.content, prospect_activities.content)
      RETURNING *
    `, [
      data.userId || null,
      data.campaignId || null,
      data.opportunityId || null,
      data.lemlistActivityId,
      data.type,
      data.leadEmail || null,
      data.leadFirstName || null,
      data.leadLastName || null,
      data.companyName || null,
      data.sequenceStep || null,
      data.happenedAt || new Date(),
      data.content || null,
      data.source || 'lemlist',
    ]);
    return result.rows[0] || null;
  },

  async bulkUpsert(activities) {
    let inserted = 0;
    for (const a of activities) {
      const row = await this.upsert(a);
      if (row) inserted++;
    }
    return inserted;
  },
};

// =============================================
// CRM Cleaning Reports
// =============================================

const crmCleaningReports = {
  async create(data) {
    const result = await query(`
      INSERT INTO crm_cleaning_reports (user_id, provider, score, total_contacts, summary, issues, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      data.userId,
      data.provider,
      data.score,
      data.totalContacts || 0,
      JSON.stringify(data.summary || {}),
      JSON.stringify(data.issues || []),
      data.status || 'pending',
    ]);
    return result.rows[0];
  },

  async get(id) {
    const result = await query('SELECT * FROM crm_cleaning_reports WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async listByUser(userId, limit = 20) {
    const result = await query(
      'SELECT * FROM crm_cleaning_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  },

  async update(id, data) {
    const sets = [];
    const values = [];
    let i = 1;
    if (data.status !== undefined) { sets.push(`status = $${i++}`); values.push(data.status); }
    if (data.fixesApplied !== undefined) { sets.push(`fixes_applied = $${i++}`); values.push(JSON.stringify(data.fixesApplied)); }
    if (data.score !== undefined) { sets.push(`score = $${i++}`); values.push(data.score); }
    if (sets.length === 0) return null;
    sets.push('updated_at = now()');
    values.push(id);
    const result = await query(
      `UPDATE crm_cleaning_reports SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  },
};

// =============================================
// Teams & Members
// =============================================

const teams = {
  async create(data) {
    const result = await query(`
      INSERT INTO teams (name, created_by)
      VALUES ($1, $2)
      RETURNING *
    `, [data.name, data.createdBy]);
    const team = result.rows[0];
    await query(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ($1, $2, 'admin')
    `, [team.id, data.createdBy]);
    return team;
  },

  async get(id) {
    const result = await query('SELECT * FROM teams WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async getByInviteCode(code) {
    const result = await query('SELECT * FROM teams WHERE invite_code = $1', [code]);
    return result.rows[0] || null;
  },

  async getByUser(userId) {
    const result = await query(`
      SELECT t.*, tm.role FROM teams t
      INNER JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = $1
      LIMIT 1
    `, [userId]);
    return result.rows[0] || null;
  },

  async getMembers(teamId) {
    const result = await query(`
      SELECT tm.id, tm.role, tm.joined_at, u.id as user_id, u.name, u.email, u.company
      FROM team_members tm
      INNER JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1
      ORDER BY tm.joined_at
    `, [teamId]);
    return result.rows;
  },

  async addMember(teamId, userId, role = 'viewer') {
    const team = await query('SELECT max_members FROM teams WHERE id = $1', [teamId]);
    const members = await query('SELECT COUNT(*) as count FROM team_members WHERE team_id = $1', [teamId]);
    if (parseInt(members.rows[0]?.count || 0, 10) >= (team.rows[0]?.max_members || 5)) {
      throw new Error('Nombre maximum de membres atteint (5)');
    }
    const result = await query(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (team_id, user_id) DO UPDATE SET role = $3
      RETURNING *
    `, [teamId, userId, role]);
    return result.rows[0];
  },

  async updateMemberRole(teamId, userId, role) {
    const result = await query(
      `UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3 RETURNING *`,
      [role, teamId, userId]
    );
    return result.rows[0] || null;
  },

  async removeMember(teamId, userId) {
    await query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
  },

  async migrateUserData(teamId, userId) {
    await query('UPDATE campaigns SET team_id = $1 WHERE user_id = $2 AND team_id IS NULL', [teamId, userId]);
    await query('UPDATE opportunities SET team_id = $1 WHERE user_id = $2 AND team_id IS NULL', [teamId, userId]);
    await query('UPDATE nurture_triggers SET team_id = $1 WHERE user_id = $2 AND team_id IS NULL', [teamId, userId]);
    await query('UPDATE email_accounts SET team_id = $1 WHERE user_id = $2 AND team_id IS NULL', [teamId, userId]);
    await query('UPDATE user_integrations SET team_id = $1 WHERE user_id = $2 AND team_id IS NULL', [teamId, userId]);
  },
};

module.exports = {
  query: rawQuery,
  closeDb,
  healthCheck,
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
  jobQueue,
  recoFeedback,
  templates,
  notifications,
  prospectActivities,
  crmCleaningReports,
  teams,
};
