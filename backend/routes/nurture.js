/**
 * Nurture Routes — Email accounts, triggers, and nurture email management
 *
 * POST /api/nurture/email-accounts       — Add SMTP email account
 * GET  /api/nurture/email-accounts       — List email accounts
 * POST /api/nurture/email-accounts/test  — Test email connection
 * DELETE /api/nurture/email-accounts/:id — Remove email account
 *
 * POST /api/nurture/triggers             — Create a nurture trigger
 * GET  /api/nurture/triggers             — List triggers
 * PATCH /api/nurture/triggers/:id        — Update trigger
 * DELETE /api/nurture/triggers/:id       — Delete trigger
 * POST /api/nurture/triggers/:id/run     — Manually run a trigger
 *
 * GET  /api/nurture/emails               — List nurture emails (pending/sent)
 * POST /api/nurture/emails/:id/approve   — Approve a pending email
 * POST /api/nurture/emails/:id/cancel    — Cancel a pending email
 * POST /api/nurture/run                  — Run nurture engine for current user
 *
 * POST /api/nurture/send                 — Send a one-off personal email
 */

const { Router } = require('express');
const db = require('../db');
const { encrypt } = require('../config/crypto');
const { sendPersonalEmail, sendNurtureEmail, testEmailAccount } = require('../lib/email-outbound');
const { runNurtureEngine } = require('../lib/nurture-engine');
const logger = require('../lib/logger');

const router = Router();

// ═══════════════════════════════════════════════════
//  Email Accounts
// ═══════════════════════════════════════════════════

// POST /api/nurture/email-accounts — Add SMTP account
router.post('/email-accounts', async (req, res, next) => {
  try {
    const { provider, emailAddress, smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
    if (!emailAddress) return res.status(400).json({ error: 'Email address is required' });

    const encryptedPass = smtpPass ? encrypt(smtpPass) : null;

    const result = await db.query(`
      INSERT INTO email_accounts (user_id, provider, email_address, smtp_host, smtp_port, smtp_user, smtp_pass)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, provider, email_address, smtp_host, smtp_port, status, created_at
    `, [
      req.user.id,
      provider || 'smtp',
      emailAddress,
      smtpHost || null,
      smtpPort || 587,
      smtpUser || emailAddress,
      encryptedPass,
    ]);

    res.json({ account: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/nurture/email-accounts
router.get('/email-accounts', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, provider, email_address, smtp_host, smtp_port, status, is_default, created_at
       FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC`,
      [req.user.id]
    );
    res.json({ accounts: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/email-accounts/test — Test connection
router.post('/email-accounts/test', async (req, res, next) => {
  try {
    const { id } = req.body;
    const account = await db.query(
      `SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    if (!account.rows[0]) return res.status(404).json({ error: 'Account not found' });

    const result = await testEmailAccount(account.rows[0]);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nurture/email-accounts/:id
router.delete('/email-accounts/:id', async (req, res, next) => {
  try {
    await db.query(
      `DELETE FROM email_accounts WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════
//  Triggers
// ═══════════════════════════════════════════════════

// POST /api/nurture/triggers
router.post('/triggers', async (req, res, next) => {
  try {
    const { name, triggerType, conditions, actionType, emailTemplate, mode, crmProvider } = req.body;
    if (!name || !triggerType) return res.status(400).json({ error: 'name and triggerType are required' });

    const result = await db.query(`
      INSERT INTO nurture_triggers (user_id, name, trigger_type, conditions, action_type, email_template, mode, crm_provider)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      req.user.id,
      name,
      triggerType,
      JSON.stringify(conditions || {}),
      actionType || 'email',
      emailTemplate ? JSON.stringify(emailTemplate) : null,
      mode || 'approval',
      crmProvider || 'pipedrive',
    ]);

    res.json({ trigger: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/nurture/triggers
router.get('/triggers', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT * FROM nurture_triggers WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ triggers: result.rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/nurture/triggers/:id
router.patch('/triggers/:id', async (req, res, next) => {
  try {
    const { name, conditions, emailTemplate, mode, enabled } = req.body;
    const sets = [];
    const values = [];
    let i = 1;
    if (name !== undefined) { sets.push(`name = $${i++}`); values.push(name); }
    if (conditions !== undefined) { sets.push(`conditions = $${i++}`); values.push(JSON.stringify(conditions)); }
    if (emailTemplate !== undefined) { sets.push(`email_template = $${i++}`); values.push(JSON.stringify(emailTemplate)); }
    if (mode !== undefined) { sets.push(`mode = $${i++}`); values.push(mode); }
    if (enabled !== undefined) { sets.push(`enabled = $${i++}`); values.push(enabled); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    sets.push('updated_at = now()');
    values.push(req.params.id, req.user.id);
    const result = await db.query(
      `UPDATE nurture_triggers SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      values
    );
    res.json({ trigger: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nurture/triggers/:id
router.delete('/triggers/:id', async (req, res, next) => {
  try {
    await db.query(
      `DELETE FROM nurture_triggers WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/triggers/:id/run — Manually run a specific trigger
router.post('/triggers/:id/run', async (req, res, next) => {
  try {
    const result = await runNurtureEngine(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════
//  Nurture Emails
// ═══════════════════════════════════════════════════

// GET /api/nurture/emails — List emails (with optional status filter)
router.get('/emails', async (req, res, next) => {
  try {
    const status = req.query.status || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    let sql = `SELECT ne.*, nt.name as trigger_name
               FROM nurture_emails ne
               LEFT JOIN nurture_triggers nt ON nt.id = ne.trigger_id
               WHERE ne.user_id = $1`;
    const params = [req.user.id];
    if (status) {
      sql += ` AND ne.status = $2`;
      params.push(status);
    }
    sql += ` ORDER BY ne.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query(sql, params);
    res.json({ emails: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/emails/:id/approve — Approve and send a pending email
router.post('/emails/:id/approve', async (req, res, next) => {
  try {
    const email = await db.query(
      `SELECT * FROM nurture_emails WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [req.params.id, req.user.id]
    );
    if (!email.rows[0]) return res.status(404).json({ error: 'Email not found or already processed' });

    const e = email.rows[0];
    const result = await sendNurtureEmail(req.user.id, {
      triggerId: e.trigger_id,
      opportunityId: e.opportunity_id,
      to: e.to_email,
      toName: e.to_name,
      subject: e.subject,
      body: e.body,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/emails/:id/cancel
router.post('/emails/:id/cancel', async (req, res, next) => {
  try {
    await db.query(
      `UPDATE nurture_emails SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/run — Run CRM agent (sync + clean + nurture)
router.post('/run', async (req, res, next) => {
  try {
    const { runAgent } = require('../lib/crm-agent');
    const report = await runAgent(req.user.id, { trigger: 'manual' });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/preview — Preview what would happen without sending
router.post('/preview', async (req, res, next) => {
  try {
    const { getUserKey } = require('../config');
    const pipedrive = require('../api/pipedrive');
    const claude = require('../api/claude');

    const token = await getUserKey(req.user.id, 'pipedrive');
    if (!token) return res.status(400).json({ error: 'CRM non connect\u00E9' });

    // Get triggers
    const triggers = await db.query(
      'SELECT * FROM nurture_triggers WHERE user_id = $1 AND enabled = true',
      [req.user.id]
    );
    if (triggers.rows.length === 0) return res.json({ previews: [], message: 'Aucun trigger actif' });

    const opps = await db.opportunities.listByUser(req.user.id, 10000, 0);
    const now = Date.now();
    const DAY = 86400000;

    // Get recently emailed to exclude
    const recent = await db.query(
      'SELECT DISTINCT to_email FROM nurture_emails WHERE user_id = $1 AND created_at > now() - interval \'7 days\'',
      [req.user.id]
    );
    const recentSet = new Set(recent.rows.map(r => r.to_email?.toLowerCase()));

    const previews = [];

    for (const trigger of triggers.rows) {
      const conditions = trigger.conditions || {};
      const days = conditions.days || 30;
      let matched = [];

      switch (trigger.trigger_type) {
        case 'deal_won': matched = opps.filter(o => o.status === 'won'); break;
        case 'deal_lost': matched = opps.filter(o => o.status === 'lost' && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY >= days && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY < days + 7); break;
        case 'deal_stagnant': matched = opps.filter(o => o.status !== 'won' && o.status !== 'lost' && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY >= days); break;
        case 'inactive_contact': matched = opps.filter(o => o.status !== 'lost' && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY >= days); break;
        case 'onboarding_check': matched = opps.filter(o => o.status === 'won' && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY >= days && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY < days + 3); break;
        case 'renewal_reminder': case 'upsell_opportunity': matched = opps.filter(o => o.status === 'won' && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY >= days); break;
        case 'feedback_request': matched = opps.filter(o => o.status === 'won' && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY >= days && (now - new Date(o.updated_at || o.created_at).getTime()) / DAY < days + 7); break;
      }

      matched = matched.filter(o => o.email && !recentSet.has(o.email.toLowerCase()));

      if (matched.length === 0) continue;

      // Generate ONE sample email for preview (with memory patterns)
      const sample = matched[0];
      const template = trigger.email_template || {};
      let sampleEmail = null;
      try {
        // Load memory patterns for better email generation
        let patternsCtx = '';
        try {
          const patterns = await db.memoryPatterns.list({ confidence: 'Haute', limit: 3 });
          if (patterns.length > 0) {
            patternsCtx = '\n\nPATTERNS QUI FONCTIONNENT :\n' +
              patterns.map(p => `- ${p.pattern}`).join('\n') +
              '\nInspire-toi de ces patterns pour le ton et l\'angle.';
          }
        } catch { /* optional */ }

        const prompt = `G\u00E9n\u00E8re un email personnel pour :
- ${sample.name} (${sample.title || ''}) chez ${sample.company || ''}
- Trigger : ${trigger.trigger_type} \u2014 ${trigger.name}
- Ton : ${template.tone || 'professionnel mais chaleureux'}
- Max 6 lignes, texte simple${patternsCtx}
Retourne un JSON : { "subject": "...", "body": "..." }`;

        const result = await claude.callClaude('Retourne uniquement du JSON valide.', prompt, 500);
        if (result.parsed) sampleEmail = result.parsed;
        else {
          const m = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
          if (m) sampleEmail = JSON.parse(m[0]);
        }
      } catch { /* skip preview generation */ }

      previews.push({
        triggerId: trigger.id,
        triggerName: trigger.name,
        triggerType: trigger.trigger_type,
        mode: trigger.mode,
        contactsCount: matched.length,
        contacts: matched.slice(0, 5).map(o => ({ id: o.id, name: o.name, email: o.email, company: o.company })),
        sampleEmail,
      });
    }

    res.json({ previews });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/send — Send a one-off personal email (from chat or UI)
router.post('/send', async (req, res, next) => {
  try {
    const { to, toName, subject, body, opportunityId } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required' });
    }

    const result = await sendNurtureEmail(req.user.id, {
      to,
      toName,
      subject,
      body,
      opportunityId,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
