/**
 * Signal Routes — Signal-based prospecting
 *
 * GET    /api/signals             — List detected signals (with filters)
 * GET    /api/signals/configs     — List signal configs
 * POST   /api/signals/configs     — Create a signal config
 * PATCH  /api/signals/configs/:id — Update config
 * DELETE /api/signals/configs/:id — Delete config
 * POST   /api/signals/:id/action  — Take action on a signal (add to CRM, email, dismiss)
 * POST   /api/signals/scan        — Manually trigger signal scan
 */

const { Router } = require('express');
const db = require('../db');
const logger = require('../lib/logger');

const router = Router();

// GET /api/signals — List signals
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status || null;
    const signalType = req.query.type || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    let sql = `SELECT * FROM signals WHERE user_id = $1`;
    const params = [req.user.id];

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    if (signalType) {
      params.push(signalType);
      sql += ` AND signal_type = $${params.length}`;
    }

    sql += ` ORDER BY detected_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query(sql, params);

    // Also get counts by status
    const counts = await db.query(
      `SELECT status, COUNT(*) AS count FROM signals WHERE user_id = $1 GROUP BY status`,
      [req.user.id]
    );

    res.json({
      signals: result.rows,
      counts: Object.fromEntries(counts.rows.map(r => [r.status, parseInt(r.count)])),
    });
  } catch (err) { next(err); }
});

// GET /api/signals/configs — List configs
router.get('/configs', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT * FROM signal_configs WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ configs: result.rows });
  } catch (err) { next(err); }
});

// POST /api/signals/configs — Create config
router.post('/configs', async (req, res, next) => {
  try {
    const { name, signalTypes, targetSectors, targetTitles, targetCompanySizes, targetKeywords, targetCompetitors, frequency } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const result = await db.query(`
      INSERT INTO signal_configs (user_id, name, signal_types, target_sectors, target_titles, target_company_sizes, target_keywords, target_competitors, frequency)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [
      req.user.id, name,
      signalTypes || ['funding', 'hiring', 'news'],
      targetSectors || [],
      targetTitles || [],
      targetCompanySizes || [],
      targetKeywords || [],
      targetCompetitors || [],
      frequency || 'daily',
    ]);

    res.json({ config: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/signals/configs/:id
router.patch('/configs/:id', async (req, res, next) => {
  try {
    const { name, signalTypes, targetSectors, targetTitles, targetKeywords, targetCompetitors, enabled, frequency } = req.body;
    const sets = [];
    const values = [];
    let i = 1;

    if (name !== undefined) { sets.push(`name = $${i++}`); values.push(name); }
    if (signalTypes !== undefined) { sets.push(`signal_types = $${i++}`); values.push(signalTypes); }
    if (targetSectors !== undefined) { sets.push(`target_sectors = $${i++}`); values.push(targetSectors); }
    if (targetTitles !== undefined) { sets.push(`target_titles = $${i++}`); values.push(targetTitles); }
    if (targetKeywords !== undefined) { sets.push(`target_keywords = $${i++}`); values.push(targetKeywords); }
    if (targetCompetitors !== undefined) { sets.push(`target_competitors = $${i++}`); values.push(targetCompetitors); }
    if (enabled !== undefined) { sets.push(`enabled = $${i++}`); values.push(enabled); }
    if (frequency !== undefined) { sets.push(`frequency = $${i++}`); values.push(frequency); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    values.push(req.params.id, req.user.id);
    const result = await db.query(
      `UPDATE signal_configs SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      values
    );

    res.json({ config: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/signals/configs/:id
router.delete('/configs/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM signal_configs WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/signals/:id/action — Take action on a signal
router.post('/:id/action', async (req, res, next) => {
  try {
    const { action } = req.body; // add_to_crm, send_email, add_to_lemlist, dismiss
    const signal = await db.query(`SELECT * FROM signals WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!signal.rows[0]) return res.status(404).json({ error: 'Signal not found' });
    const s = signal.rows[0];

    let opportunityId = null;

    if (action === 'add_to_crm') {
      // Create opportunity from signal
      const opp = await db.opportunities.create({
        userId: req.user.id,
        name: s.contact_name || s.company_name || 'Unknown',
        email: s.contact_email || null,
        title: s.contact_title || null,
        company: s.company_name || null,
        status: 'new',
        linkedinUrl: s.contact_linkedin || null,
      });
      opportunityId = opp.id;
    } else if (action === 'send_email' && s.contact_email) {
      // Generate and queue a personalized email
      const claude = require('../api/claude');
      const prompt = `Generate a short, personal outreach email based on this signal.

Signal: ${s.title}
Context: ${s.description}
Contact: ${s.contact_name || 'Decision maker'} (${s.contact_title || ''}) at ${s.company_name || ''}
Signal type: ${s.signal_type}

Write a 4-5 line email that references the signal naturally (don't say "I saw a signal").
Be specific and relevant. Return JSON: { "subject": "...", "body": "..." }`;

      const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'signal_outreach');
      let email = result.parsed;
      if (!email) {
        const m = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
        if (m) email = JSON.parse(m[0]);
      }

      if (email?.subject && email?.body) {
        const { sendNurtureEmail } = require('../lib/email-outbound');
        await sendNurtureEmail(req.user.id, {
          to: s.contact_email,
          toName: s.contact_name,
          subject: email.subject,
          body: email.body,
        });
      }
    }

    // Update signal status
    await db.query(
      `UPDATE signals SET status = $1, action_taken = $2, opportunity_id = $3, actioned_at = now() WHERE id = $4`,
      [action === 'dismiss' ? 'dismissed' : 'actioned', action, opportunityId, s.id]
    );

    res.json({ ok: true, action, opportunityId });
  } catch (err) { next(err); }
});

// POST /api/signals/scan — Manual signal scan
router.post('/scan', async (req, res, next) => {
  try {
    const { run } = require('../lib/agents/signal-agent');
    const report = await run(req.user.id);
    res.json(report);
  } catch (err) { next(err); }
});

// POST /api/signals/:id/linkedin-outreach — Send LinkedIn connection from signal
router.post('/:id/linkedin-outreach', async (req, res, next) => {
  try {
    const signal = await db.query(`SELECT * FROM signals WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!signal.rows[0]) return res.status(404).json({ error: 'Signal not found' });
    const s = signal.rows[0];
    if (!s.contact_linkedin) return res.status(400).json({ error: 'No LinkedIn URL for this contact' });

    const { getUserKey } = require('../config');
    const cookie = await getUserKey(req.user.id, 'linkedin');
    if (!cookie) return res.status(400).json({ error: 'LinkedIn not connected. Add your li_at cookie in Settings.' });

    const linkedin = require('../api/linkedin');
    const claude = require('../api/claude');

    // Generate note
    const noteResult = await claude.callClaude('Return only valid JSON.', `Write a LinkedIn connection note (max 280 chars).
Signal: ${s.title}. Contact: ${s.contact_name} at ${s.company_name}.
Be specific, reference the signal naturally. Return JSON: { "note": "..." }`, 300, 'linkedin_note');

    let note = noteResult.parsed?.note || `Bonjour, votre profil a retenu mon attention. Curieux d'échanger.`;
    const publicId = s.contact_linkedin.match(/\/in\/([^/?]+)/)?.[1];
    if (!publicId) return res.status(400).json({ error: 'Invalid LinkedIn URL' });

    await linkedin.sendConnectionRequest(cookie, { profileUrn: publicId, message: note.slice(0, 300) }, req.user.id);

    await db.query(
      `INSERT INTO linkedin_outreach (user_id, signal_id, type, linkedin_url, message, status) VALUES ($1, $2, 'connection', $3, $4, 'sent')`,
      [req.user.id, s.id, s.contact_linkedin, note]
    );
    await db.query(`UPDATE signals SET status = 'actioned', action_taken = 'linkedin_connect', actioned_at = now() WHERE id = $1`, [s.id]);

    res.json({ ok: true, note });
  } catch (err) { next(err); }
});

// GET /api/signals/linkedin/status — LinkedIn connection status + daily counts
router.get('/linkedin/status', async (req, res, next) => {
  try {
    const { getUserKey } = require('../config');
    const cookie = await getUserKey(req.user.id, 'linkedin');
    if (!cookie) return res.json({ connected: false });

    const linkedin = require('../api/linkedin');
    const counts = linkedin.getDailyCounts(req.user.id);

    // Cookie exists = connected (skip live test — LinkedIn blocks datacenter IPs)
    res.json({ connected: true, name: 'LinkedIn', counts });
  } catch (err) { next(err); }
});

// GET /api/signals/stats — Signal dashboard KPIs
router.get('/stats', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'new') AS pending,
        COUNT(*) FILTER (WHERE status = 'actioned') AS actioned,
        COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed,
        COUNT(*) FILTER (WHERE detected_at > now() - interval '7 days') AS this_week,
        COUNT(*) FILTER (WHERE detected_at > now() - interval '7 days' AND status = 'actioned') AS actioned_this_week,
        ROUND(AVG(relevance_score) FILTER (WHERE status = 'new'), 1) AS avg_relevance,
        COUNT(DISTINCT company_name) FILTER (WHERE detected_at > now() - interval '30 days') AS unique_companies_30d
      FROM signals WHERE user_id = $1
    `, [req.user.id]);

    // Top signal types
    const byType = await db.query(`
      SELECT signal_type, COUNT(*) AS count,
        COUNT(*) FILTER (WHERE status = 'actioned') AS actioned
      FROM signals WHERE user_id = $1 AND detected_at > now() - interval '30 days'
      GROUP BY signal_type ORDER BY count DESC
    `, [req.user.id]);

    // Weekly trend (last 8 weeks)
    const trend = await db.query(`
      SELECT TO_CHAR(detected_at, 'YYYY-"W"IW') AS week, COUNT(*) AS count
      FROM signals WHERE user_id = $1 AND detected_at > now() - interval '8 weeks'
      GROUP BY 1 ORDER BY 1
    `, [req.user.id]);

    res.json({
      kpis: result.rows[0] || {},
      byType: byType.rows,
      weeklyTrend: trend.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/signals/company/:name — Signal history for a company
router.get('/company/:name', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, signal_type, title, description, source_url, relevance_score,
             contact_name, contact_title, contact_email, contact_linkedin,
             status, action_taken, detected_at
      FROM signals
      WHERE user_id = $1 AND LOWER(company_name) = LOWER($2)
      ORDER BY detected_at DESC LIMIT 50
    `, [req.user.id, req.params.name]);

    // Get CRM contacts for this company
    const contacts = await db.query(
      `SELECT id, name, email, title, status, churn_score, deal_value FROM opportunities
       WHERE user_id = $1 AND LOWER(company) = LOWER($2)`,
      [req.user.id, req.params.name]
    );

    res.json({
      companyName: req.params.name,
      signals: result.rows,
      contacts: contacts.rows,
    });
  } catch (err) { next(err); }
});

// POST /api/signals/:id/create-sequence — Create a mini outreach sequence from a signal
router.post('/:id/create-sequence', async (req, res, next) => {
  try {
    const signal = await db.query(`SELECT * FROM signals WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!signal.rows[0]) return res.status(404).json({ error: 'Signal not found' });
    const s = signal.rows[0];

    const claude = require('../api/claude');
    const prompt = `Create a 3-step outreach sequence for this prospect based on the detected signal.

Signal: ${s.title}
Context: ${s.description || ''}
Contact: ${s.contact_name || 'Decision maker'} (${s.contact_title || ''}) at ${s.company_name || ''}
Signal type: ${s.signal_type}

Generate 3 touchpoints:
- E1 (Day 0): Initial email referencing the signal
- E2 (Day 3): Follow-up with value proposition
- E3 (Day 7): Break-up email

Each email: personal tone, max 5 lines, reference the signal naturally.
Return JSON:
{
  "name": "Campaign name",
  "steps": [
    { "step": "E1", "timing": "J+0", "subject": "...", "body": "..." },
    { "step": "E2", "timing": "J+3", "subject": "...", "body": "..." },
    { "step": "E3", "timing": "J+7", "subject": "...", "body": "..." }
  ]
}`;

    const result = await claude.callClaude('Return only valid JSON.', prompt, 1200, 'signal_sequence');
    let sequence = result.parsed;
    if (!sequence) {
      const m = (result.content || '').match(/\{[\s\S]*"name"[\s\S]*"steps"[\s\S]*\}/);
      if (m) sequence = JSON.parse(m[0]);
    }

    if (!sequence?.steps?.length) {
      return res.status(500).json({ error: 'Could not generate sequence' });
    }

    // E1 part dans la file d'approbation nurture si le contact a un email —
    // avec la dédup standard (7 jours création / 2 heures envoi).
    let queuedEmailId = null;
    if (s.contact_email) {
      const e1 = sequence.steps[0];
      const dup = await db.query(
        `SELECT id FROM nurture_emails
         WHERE user_id = $1 AND LOWER(to_email) = LOWER($2)
           AND (created_at > now() - interval '7 days' OR sent_at > now() - interval '2 hours')
         LIMIT 1`,
        [req.user.id, s.contact_email]
      );
      if (dup.rows.length === 0 && e1?.subject && e1?.body) {
        const inserted = await db.query(
          `INSERT INTO nurture_emails (user_id, to_email, to_name, subject, body, status, metadata)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6)
           RETURNING id`,
          [req.user.id, s.contact_email, s.contact_name || null, e1.subject, e1.body,
           JSON.stringify({ chain: 'signal_sequence', signal_id: s.id, step: e1.step, timing: e1.timing })]
        );
        queuedEmailId = inserted.rows[0].id;
      }
    }

    // La séquence est persistée sur le signal AVANT de le marquer actioned :
    // un signal actioned sans trace de ce qui a été créé était un mensonge.
    await db.query(
      `UPDATE signals SET sequence = $1, status = 'actioned', action_taken = 'sequence_created', actioned_at = now() WHERE id = $2`,
      [JSON.stringify(sequence), s.id]
    );

    res.json({ sequence, signal: s, queuedEmailId });
  } catch (err) { next(err); }
});

module.exports = router;
