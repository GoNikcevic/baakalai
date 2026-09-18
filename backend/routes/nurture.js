/**
 * Nurture Routes · Email accounts, triggers, and nurture email management
 *
 * POST /api/nurture/email-accounts · Add SMTP email account
 * GET  /api/nurture/email-accounts · List email accounts
 * POST /api/nurture/email-accounts/test · Test email connection
 * DELETE /api/nurture/email-accounts/:id · Remove email account
 *
 * POST /api/nurture/triggers · Create a nurture trigger
 * GET  /api/nurture/triggers · List triggers
 * PATCH /api/nurture/triggers/:id · Update trigger
 * DELETE /api/nurture/triggers/:id · Delete trigger
 * POST /api/nurture/triggers/:id/run · Manually run a trigger
 *
 * GET  /api/nurture/emails · List nurture emails (pending/sent), optional ?chain= filter
 * POST /api/nurture/emails/:id/approve · Approve a pending email
 * POST /api/nurture/emails/:id/cancel · Cancel a pending email
 * POST /api/nurture/run · Run nurture engine for current user
 *
 * POST /api/nurture/send · Send a one-off personal email
 */

const { Router } = require('express');
const db = require('../db');
const { encrypt } = require('../config/crypto');
const { sendPersonalEmail, sendNurtureEmail, testEmailAccount } = require('../lib/email-outbound');
const { runNurtureEngine } = require('../lib/nurture-engine');
const { matchContacts } = require('../lib/trigger-matching');
const { getStagnantDays } = require('../lib/stagnation');
const logger = require('../lib/logger');

const router = Router();

const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');

// ═══════════════════════════════════════════════════
//  Stats · historique consolidé de l'automatisation
// ═══════════════════════════════════════════════════

// GET /api/nurture/stats · l'équivalent des KPIs de l'Historique de
// prospection, côté Automatisation : emails de relance (nurture_emails),
// actions des workflows (campaign_sends liées à un enrollment), workflows par
// objectif et envois par mois. Les réponses viennent des enrollments stoppés
// pour cause de réponse · c'est le signal de succès du moteur, pas un
// tracking d'ouverture (inexistant sur ces envois).
router.get('/stats', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [emails, byTrigger, workflows, wfActions, monthly] = await Promise.all([
      db.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
               COUNT(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '30 days')::int AS sent_30d,
               COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
               COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
          FROM nurture_emails WHERE user_id = $1
      `, [userId]),
      db.query(`
        SELECT COALESCE(t.trigger_type, 'custom') AS type, COUNT(*)::int AS sent
          FROM nurture_emails e
          LEFT JOIN nurture_triggers t ON t.id = e.trigger_id
         WHERE e.user_id = $1 AND e.status = 'sent'
         GROUP BY 1 ORDER BY 2 DESC
      `, [userId]),
      db.query(`
        SELECT goal,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'active')::int AS active,
               COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
               COUNT(*) FILTER (WHERE stop_reason = 'replied')::int AS replied
          FROM sequence_enrollments
         WHERE user_id = $1 AND status <> 'draft'
         GROUP BY goal
      `, [userId]),
      db.query(`
        SELECT COUNT(*)::int AS sent,
               COUNT(*) FILTER (WHERE sent_at > now() - interval '30 days')::int AS sent_30d
          FROM campaign_sends
         WHERE user_id = $1 AND enrollment_id IS NOT NULL AND status = 'sent'
      `, [userId]),
      db.query(`
        SELECT to_char(date_trunc('month', sent_at), 'YYYY-MM') AS month,
               COUNT(*) FILTER (WHERE source = 'nurture')::int AS nurture,
               COUNT(*) FILTER (WHERE source = 'workflow')::int AS workflow
          FROM (
            SELECT sent_at, 'nurture' AS source FROM nurture_emails
             WHERE user_id = $1 AND status = 'sent'
               AND sent_at >= date_trunc('month', now()) - interval '5 months'
            UNION ALL
            SELECT sent_at, 'workflow' AS source FROM campaign_sends
             WHERE user_id = $1 AND enrollment_id IS NOT NULL AND status = 'sent'
               AND sent_at >= date_trunc('month', now()) - interval '5 months'
          ) s
         GROUP BY 1 ORDER BY 1
      `, [userId]),
    ]);

    res.json({
      emails: emails.rows[0],
      workflowActions: wfActions.rows[0],
      byTrigger: byTrigger.rows,
      workflows: workflows.rows,
      monthly: monthly.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════
//  Email Accounts
// ═══════════════════════════════════════════════════

// POST /api/nurture/email-accounts · Add SMTP account
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
      `SELECT id, provider, email_address, smtp_host, smtp_port, status, is_default, created_at,
              signature_text, signature_image
       FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC`,
      [req.user.id]
    );
    res.json({ accounts: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/email-accounts/test · Test connection
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

// PATCH /api/nurture/email-accounts/:id/signature · { signatureText, signatureImage }
// Texte ≤ 2000 caractères ; image en data-URI (png/jpeg/gif/webp) ≤ 300 Ko
// décodés, embarquée inline CID à l'envoi (lib/email-outbound.js). null efface.
router.patch('/email-accounts/:id/signature', async (req, res, next) => {
  try {
    const { signatureText, signatureImage } = req.body || {};

    const text = signatureText == null ? null : String(signatureText).trim().slice(0, 2000) || null;

    let image = null;
    if (signatureImage != null && signatureImage !== '') {
      const m = String(signatureImage).match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return res.status(400).json({ error: 'Image must be a png/jpeg/gif/webp data URI' });
      if (Buffer.from(m[2], 'base64').length > 300 * 1024) {
        return res.status(400).json({ error: 'Image too large (max 300 KB)' });
      }
      image = signatureImage;
    }

    const result = await db.query(
      `UPDATE email_accounts SET signature_text = $1, signature_image = $2, updated_at = now()
       WHERE id = $3 AND user_id = $4
       RETURNING id, signature_text, signature_image`,
      [text, image, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Account not found' });
    res.json({ account: result.rows[0] });
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
    const { name, conditions, emailTemplate, mode, enabled, abEnabled } = req.body;
    const sets = [];
    const values = [];
    let i = 1;
    if (name !== undefined) { sets.push(`name = $${i++}`); values.push(name); }
    if (conditions !== undefined) { sets.push(`conditions = $${i++}`); values.push(JSON.stringify(conditions)); }
    if (abEnabled !== undefined) { sets.push(`ab_enabled = $${i++}`); values.push(abEnabled); }
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

// POST /api/nurture/triggers/:id/run · Manually run a specific trigger
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

// GET /api/nurture/emails · List emails (with optional status filter)
router.get('/emails', async (req, res, next) => {
  try {
    const status = req.query.status || null;
    const chain = req.query.chain || null; // 'deal_reactivation' | 'auto_upsell'
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    let sql = `SELECT ne.*, nt.name as trigger_name
               FROM nurture_emails ne
               LEFT JOIN nurture_triggers nt ON nt.id = ne.trigger_id
               WHERE ne.user_id = $1`;
    const params = [req.user.id];
    if (status) {
      sql += ` AND ne.status = $${params.length + 1}`;
      params.push(status);
    }
    if (chain) {
      sql += ` AND ne.metadata ->> 'chain' = $${params.length + 1}`;
      params.push(chain);
    }
    sql += ` ORDER BY ne.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query(sql, params);
    res.json({ emails: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/emails/:id/approve · Approve and send a pending email
//
// Un échec d'envoi doit sortir en NON-2xx. Avant ce correctif la route
// répondait 200 avec `{ success: false, error }` : le client (`services/
// api-client.js`) ne lève que sur `!res.ok`, donc le `catch` des appelants
// n'était jamais atteint et le clic « Approuver » ne produisait ni envoi ni
// message · l'email restait pending, puis mourait 14 jours plus tard sur
// l'expiration de `stepNurture`. C'est la cause du « 0 email envoyé » :
// aucune boîte mail n'a jamais été connectée et rien ne le disait.
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
      existingEmailId: e.id,
    });

    // If this email came from an autonomous chain (deal_reactivation/auto_upsell),
    // keep agent_chain_executions in sync with the real send outcome · before any
    // early return, so a failed send is recorded too.
    await db.query(
      `UPDATE agent_chain_executions SET status = $1, executed_at = now()
       WHERE nurture_email_id = $2 AND status = 'pending'`,
      [result.success ? 'executed' : 'failed', e.id]
    );

    // Reactivation/upsell emails: give the reply a week before this candidate can
    // resurface in the queue, as a baseline safety net when the CRM isn't updated.
    // If a real reply arrives sooner, the existing response-analysis/autopilot flow
    // (Pipedrive-only today) already updates status/planned_followup_date faster.
    const chain = e.metadata?.chain;
    if (result.success && e.opportunity_id && (chain === 'deal_reactivation' || chain === 'auto_upsell')) {
      await db.query(
        `UPDATE opportunities SET planned_followup_date = now() + interval '7 days', planned_followup_reason = 'post_send_cooldown' WHERE id = $1`,
        [e.opportunity_id]
      );
    }

    if (!result.success) {
      // 422 plutôt que 500 : la requête est valide, c'est l'envoi qui n'aboutit
      // pas (config manquante ou refus du serveur SMTP). `code` permet au front
      // de proposer l'action corrective au lieu d'afficher un message brut.
      return res.status(422).json({ error: result.error, code: result.code || 'send_failed' });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/emails/approve-batch · Approve and send up to 20 pending
// emails in one call. Envois séquentiels (un compte SMTP perso n'aime pas les
// rafales) ; au-delà de 20, le front ré-appelle avec le reste.
const APPROVE_BATCH_MAX = 20;
router.post('/emails/approve-batch', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, APPROVE_BATCH_MAX) : [];
    if (!ids.length) return res.status(400).json({ error: 'ids (array) is required' });

    const rows = await db.query(
      `SELECT * FROM nurture_emails WHERE id = ANY($1) AND user_id = $2 AND status = 'pending'`,
      [ids, req.user.id]
    );

    let sent = 0;
    let failed = 0;
    const results = [];
    for (const e of rows.rows) {
      const result = await sendNurtureEmail(req.user.id, {
        triggerId: e.trigger_id,
        opportunityId: e.opportunity_id,
        to: e.to_email,
        toName: e.to_name,
        subject: e.subject,
        body: e.body,
        existingEmailId: e.id,
      });

      // Même synchro que /emails/:id/approve : refléter l'issue réelle de l'envoi
      // dans agent_chain_executions, puis cooldown 7j sur l'opportunité pour les
      // chaînes reactivation/upsell.
      await db.query(
        `UPDATE agent_chain_executions SET status = $1, executed_at = now()
         WHERE nurture_email_id = $2 AND status = 'pending'`,
        [result.success ? 'executed' : 'failed', e.id]
      );
      const chain = e.metadata?.chain;
      if (result.success && e.opportunity_id && (chain === 'deal_reactivation' || chain === 'auto_upsell')) {
        await db.query(
          `UPDATE opportunities SET planned_followup_date = now() + interval '7 days', planned_followup_reason = 'post_send_cooldown' WHERE id = $1`,
          [e.opportunity_id]
        );
      }

      if (result.success) sent++; else failed++;
      results.push({ id: e.id, success: result.success, error: result.error || null });
    }

    res.json({ sent, failed, skipped: ids.length - rows.rows.length, results });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/emails/cancel-batch · Cancel pending emails in bulk
// (purge d'un backlog obsolète sans cliquer 70 fois).
router.post('/emails/cancel-batch', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids (array) is required' });
    const result = await db.query(
      `UPDATE nurture_emails SET status = 'cancelled' WHERE id = ANY($1) AND user_id = $2 AND status = 'pending'`,
      [ids, req.user.id]
    );
    res.json({ ok: true, cancelled: result.rowCount });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/emails/:id/cancel
router.post('/emails/:id/cancel', async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE nurture_emails SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (result.rows[0]) {
      await db.query(
        `UPDATE agent_chain_executions SET status = 'blocked'
         WHERE nurture_email_id = $1 AND status = 'pending'`,
        [result.rows[0].id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/run · Run CRM agent (sync + clean + nurture)
router.post('/run', async (req, res, next) => {
  try {
    const { runAgent } = require('../lib/crm-agent');
    const report = await runAgent(req.user.id, { trigger: 'manual' });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/run-scoped · Relance CADRÉE, issue du dialogue de l'assistant
//
// /run ci-dessus lance l'agent complet sur tous les triggers actifs : il ignore le
// périmètre, l'angle et le mode. Tant que l'assistant exécutait sans rien demander, ça
// n'avait aucune conséquence visible. Depuis qu'il cadre en trois questions, y router la
// relance reviendrait à jeter les trois réponses de l'utilisateur et à envoyer autre chose
// que ce qu'il vient de valider. D'où ce chemin séparé : une population explicite, un
// angle transmis au rédacteur, un mode d'envoi respecté.
const SCOPED_RUN_MAX = 25;
const SCOPED_RUN_DEFAULT = 5;

const SCOPED_POPULATIONS = {
  // Deals ouverts sans activité depuis N jours · même base que le compte-rendu de lecture
  // (COALESCE(last_activity_at, created_at), jamais updated_at que l'import réécrit).
  deal_stagnant: {
    chain: 'deal_reactivation',
    where: `status NOT IN ('won', 'lost') AND COALESCE(last_activity_at, created_at) < NOW() - ($2::int * INTERVAL '1 day')`,
  },
  inactive_contact: {
    chain: 'deal_reactivation',
    where: `status <> 'lost' AND COALESCE(last_activity_at, created_at) < NOW() - ($2::int * INTERVAL '1 day')`,
  },
  upsell_opportunity: {
    chain: 'auto_upsell',
    where: `status = 'won'`,
  },
  churn_risk: {
    chain: 'auto_upsell',
    // Seuil partagé avec la file de priorités et le scoring, sinon le chat proposerait
    // une population « à risque » différente de celle que l'app affiche.
    where: `status = 'won' AND churn_score >= ${require('../lib/churn-scoring').AT_RISK_THRESHOLD}`,
  },
};

router.post('/run-scoped', async (req, res, next) => {
  try {
    const { triggerType, angle, mode, contactIds } = req.body || {};
    const population = SCOPED_POPULATIONS[triggerType];
    if (!population && !Array.isArray(contactIds)) {
      return res.status(400).json({
        error: `triggerType must be one of: ${Object.keys(SCOPED_POPULATIONS).join(', ')} (or pass contactIds)`,
      });
    }

    const limit = Math.min(
      Math.max(parseInt(req.body?.limit, 10) || SCOPED_RUN_DEFAULT, 1),
      SCOPED_RUN_MAX
    );
    const days = parseInt(req.body?.days, 10) || await getStagnantDays(req.user.id);

    // Dédup (règle produit) : jamais deux emails au même contact à 7 jours d'intervalle,
    // et jamais un doublon d'un email déjà en attente d'approbation.
    const dedup = `AND NOT EXISTS (
      SELECT 1 FROM nurture_emails ne
      WHERE ne.user_id = o.user_id AND ne.opportunity_id = o.id
        AND (ne.status = 'pending' OR ne.created_at > NOW() - INTERVAL '7 days')
    )`;

    let candidates;
    if (Array.isArray(contactIds) && contactIds.length > 0) {
      candidates = await db.query(
        `SELECT o.id, o.name, o.company, o.email, o.deal_value, o.status FROM opportunities o
         WHERE o.user_id = $1 AND o.id = ANY($2::uuid[]) AND o.email IS NOT NULL AND o.email <> ''
         ${dedup}
         ORDER BY o.deal_value DESC NULLS LAST LIMIT $3`,
        [req.user.id, contactIds.slice(0, SCOPED_RUN_MAX), limit]
      );
    } else {
      candidates = await db.query(
        // `$2::int >= 0` est un garde-fou de typage, pas un filtre : les populations
        // « clients » n'utilisent pas le seuil de jours, et Postgres refuse un paramètre
        // fourni mais jamais référencé (« could not determine data type of parameter $2 »).
        `SELECT o.id, o.name, o.company, o.email, o.deal_value, o.status FROM opportunities o
         WHERE o.user_id = $1 AND $2::int >= 0 AND o.email IS NOT NULL AND o.email <> ''
           AND ${population.where}
         ${dedup}
         ORDER BY o.deal_value DESC NULLS LAST LIMIT $3`,
        [req.user.id, days, limit]
      );
    }

    if (candidates.rows.length === 0) {
      return res.json({ sent: 0, queued: 0, skipped: 0, message: 'aucun contact éligible (déjà relancé récemment, ou sans email)' });
    }

    const dealCoach = require('../lib/agents/deal-coach');
    const upsellDetector = require('../lib/agents/upsell-detector');

    let sent = 0;
    let queued = 0;
    const skipped = [];
    const drafts = [];

    for (const opp of candidates.rows) {
      // Un client gagné n'est pas un deal à réactiver : le rédacteur suit le contact,
      // pas le libellé du raccourci cliqué.
      const useUpsell = opp.status === 'won';
      const draft = useUpsell
        ? await upsellDetector.draftOne(req.user.id, opp.id, { angle })
        : await dealCoach.coachAndDraftOne(req.user.id, opp.id, { angle });

      if (draft.error) {
        skipped.push({ name: opp.name, reason: draft.error });
        continue;
      }

      const chain = useUpsell ? 'auto_upsell' : 'deal_reactivation';
      const inserted = await db.query(
        `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, to_name, subject, body, status, pattern_ids, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8) RETURNING id`,
        [
          req.user.id, opp.id, opp.email, opp.name, draft.subject, draft.body,
          draft.patternIds || [],
          JSON.stringify({ chain, source: 'chat_scoped', angle: angle || null }),
        ]
      );
      const emailId = inserted.rows[0].id;

      // Même trace que la file de réactivation, pour que l'attribution (« Deals touchés »)
      // et l'historique comptent aussi les relances lancées depuis le chat.
      await db.query(
        `INSERT INTO agent_chain_executions (user_id, chain_type, trigger_agent, trigger_data, steps_completed, result, status, nurture_email_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
        [
          req.user.id, chain, useUpsell ? 'upsell_detector' : 'deal_coach',
          JSON.stringify({ opportunityId: opp.id, source: 'chat_scoped' }), ['draft_scoped'],
          JSON.stringify({ subject: draft.subject, contact: opp.name }), emailId,
        ]
      );

      if (mode === 'auto') {
        const result = await sendNurtureEmail(req.user.id, {
          opportunityId: opp.id,
          to: opp.email,
          toName: opp.name,
          subject: draft.subject,
          body: draft.body,
          existingEmailId: emailId,
        });
        await db.query(
          `UPDATE agent_chain_executions SET status = $1, executed_at = now() WHERE nurture_email_id = $2 AND status = 'pending'`,
          [result.success ? 'executed' : 'failed', emailId]
        );
        if (result.success) {
          sent += 1;
        } else {
          // L'email reste en base, l'utilisateur pourra le renvoyer depuis la file.
          skipped.push({ name: opp.name, reason: result.error || 'send_failed' });
        }
      } else {
        queued += 1;
      }

      drafts.push({ contact: opp.name, company: opp.company, subject: draft.subject });
    }

    logger.info('nurture', 'Scoped run from chat', {
      userId: req.user.id, triggerType, mode: mode || 'approval', sent, queued, skipped: skipped.length,
    });

    res.json({ sent, queued, skipped: skipped.length, skippedDetail: skipped, drafts, angle: angle || null });
  } catch (err) {
    next(err);
  }
});

// POST /api/nurture/preview · Preview what would happen without sending
router.post('/preview', async (req, res, next) => {
  try {
    const { getUserCrmToken } = require('../lib/crm-token');
    const claude = require('../api/claude');

    const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [req.user.id]);
    const activeCrm = userRow.rows[0]?.active_crm_provider || 'pipedrive';
    const token = await getUserCrmToken(req.user.id, activeCrm);
    if (!token) return res.status(400).json({ error: 'CRM non connect\u00E9' });

    // Get triggers
    const triggers = await db.query(
      'SELECT * FROM nurture_triggers WHERE user_id = $1 AND enabled = true',
      [req.user.id]
    );
    if (triggers.rows.length === 0) return res.json({ previews: [], message: 'Aucun trigger actif' });

    const opps = await db.opportunities.listByUser(req.user.id, 10000, 0);
    const now = Date.now();

    // Get recently emailed to exclude
    const recent = await db.query(
      'SELECT DISTINCT to_email FROM nurture_emails WHERE user_id = $1 AND created_at > now() - interval \'7 days\'',
      [req.user.id]
    );
    const recentSet = new Set(recent.rows.map(r => r.to_email?.toLowerCase()));

    // Même repli que le cron, sinon la preview affiche autre chose que ce qui
    // partira réellement (cf. lib/stagnation.js).
    const stagnantDays = await getStagnantDays(req.user.id);

    const previews = [];

    for (const trigger of triggers.rows) {
      // Même logique de matching que le cron (lib/trigger-matching.js) · 
      // la preview affichait des contacts calculés sur updated_at alors que
      // le cron déclenchait sur last_activity_at.
      let matched = matchContacts(trigger, opps, now, { stagnantDays });

      // Types évalués uniquement en run manuel (newsletter_*) : signaler
      // plutôt que d'ignorer silencieusement.
      if (matched === null) {
        previews.push({
          triggerId: trigger.id,
          triggerName: trigger.name,
          triggerType: trigger.trigger_type,
          mode: trigger.mode,
          contactsCount: null,
          contacts: [],
          sampleEmail: null,
          manualOnly: true,
        });
        continue;
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
          const patterns = await db.memoryPatterns.listForPrompt(8, null, req.user.id);
          if (patterns.length > 0) {
            patternsCtx = '\n\nPATTERNS QUI FONCTIONNENT :\n' +
              patterns.map(p => `- ${p.applied ? '[APPROUV\u00c9]' : ''} ${p.pattern}`).join('\n') +
              '\nApplique en priorit\u00e9 les patterns APPROUV\u00c9S.';
          }
        } catch { /* optional */ }

        const prompt = `G\u00E9n\u00E8re un email personnel pour :
- ${sample.name} (${sample.title || ''}) chez ${sample.company || ''}
- Trigger : ${trigger.trigger_type}, ${trigger.name}
- Ton : ${template.tone || 'professionnel mais chaleureux'}
- Max 6 lignes, texte simple${patternsCtx}
Retourne un JSON : { "subject": "...", "body": "..." }`;

        const result = await claude.callClaude('Retourne uniquement du JSON valide.', prompt, 500);
        if (result.parsed) sampleEmail = result.parsed;
        else {
          const m = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
          if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } }
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

// ═══════════════════════════════════════════════════
//  OAuth Email Connection (Gmail + Microsoft)
// ═══════════════════════════════════════════════════

// Temporary state store for OAuth flows (maps state → userId)
const _oauthStates = new Map();
const MAX_OAUTH_STATES = 1000;

// Cleanup expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _oauthStates) {
    if (val.expiresAt < now) _oauthStates.delete(key);
  }
}, 300000).unref();

// GET /api/nurture/email-accounts/connect/gmail · Start Gmail OAuth flow
router.get('/email-accounts/connect/gmail', (req, res, next) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });
    if (_oauthStates.size >= MAX_OAUTH_STATES) return res.status(429).json({ error: 'Too many pending OAuth requests' });

    const state = require('crypto').randomBytes(16).toString('hex');
    _oauthStates.set(state, { userId: req.user.id, provider: 'gmail', expiresAt: Date.now() + 600000 });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: APP_URL + '/api/nurture/email-accounts/callback/gmail',
      response_type: 'code',
      scope: 'https://mail.google.com/ email profile',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (err) { next(err); }
});

// GET /api/nurture/email-accounts/callback/gmail · Gmail OAuth callback
async function gmailCallback(req, res) {
  const { code, state } = req.query;
  const oauthData = _oauthStates.get(state);

  if (!oauthData || oauthData.expiresAt < Date.now()) {
    return res.redirect(APP_URL + '/settings?email_error=invalid_state');
  }
  _oauthStates.delete(state);

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: APP_URL + '/api/nurture/email-accounts/callback/gmail',
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokens = await tokenRes.json();

    // Get user email from Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userRes.ok) throw new Error('Failed to get user info');
    const googleUser = await userRes.json();

    // Store in email_accounts with encrypted tokens
    const encryptedAccess = encrypt(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
    const expiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Upsert: if email already exists for this user, update tokens
    const existing = await db.query(
      `SELECT id FROM email_accounts WHERE user_id = $1 AND email_address = $2`,
      [oauthData.userId, googleUser.email]
    );

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE email_accounts SET access_token = $1, refresh_token = $2, token_expiry = $3, status = 'active', updated_at = now() WHERE id = $4`,
        [encryptedAccess, encryptedRefresh, expiry, existing.rows[0].id]
      );
    } else {
      await db.query(`
        INSERT INTO email_accounts (user_id, provider, email_address, access_token, refresh_token, token_expiry, status)
        VALUES ($1, 'gmail', $2, $3, $4, $5, 'active')
      `, [oauthData.userId, googleUser.email, encryptedAccess, encryptedRefresh, expiry]);
    }

    logger.info('email-oauth', `Gmail connected for user ${oauthData.userId}: ${googleUser.email}`);
    res.redirect(APP_URL + '/settings?email_connected=gmail');
  } catch (err) {
    logger.error('email-oauth', `Gmail OAuth failed: ${err.message}`);
    res.redirect(APP_URL + '/settings?email_error=gmail_failed');
  }
}

// GET /api/nurture/email-accounts/connect/microsoft · Start Microsoft OAuth flow
router.get('/email-accounts/connect/microsoft', (req, res, next) => {
  try {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'Microsoft OAuth not configured' });
    if (_oauthStates.size >= MAX_OAUTH_STATES) return res.status(429).json({ error: 'Too many pending OAuth requests' });

    const state = require('crypto').randomBytes(16).toString('hex');
    _oauthStates.set(state, { userId: req.user.id, provider: 'microsoft', expiresAt: Date.now() + 600000 });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: APP_URL + '/api/nurture/email-accounts/callback/microsoft',
      response_type: 'code',
      scope: 'https://outlook.office365.com/SMTP.Send offline_access email openid profile',
      response_mode: 'query',
      state,
    });

    res.json({ url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` });
  } catch (err) { next(err); }
});

// GET /api/nurture/email-accounts/callback/microsoft · Microsoft OAuth callback
async function microsoftCallback(req, res) {
  const { code, state } = req.query;
  const oauthData = _oauthStates.get(state);

  if (!oauthData || oauthData.expiresAt < Date.now()) {
    return res.redirect(APP_URL + '/settings?email_error=invalid_state');
  }
  _oauthStates.delete(state);

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        redirect_uri: APP_URL + '/api/nurture/email-accounts/callback/microsoft',
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokens = await tokenRes.json();

    // Get user email from Microsoft Graph
    const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userRes.ok) throw new Error('Failed to get user info');
    const msUser = await userRes.json();
    const email = msUser.mail || msUser.userPrincipalName;

    // Store encrypted tokens
    const encryptedAccess = encrypt(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
    const expiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    const existing = await db.query(
      `SELECT id FROM email_accounts WHERE user_id = $1 AND email_address = $2`,
      [oauthData.userId, email]
    );

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE email_accounts SET access_token = $1, refresh_token = $2, token_expiry = $3, status = 'active', updated_at = now() WHERE id = $4`,
        [encryptedAccess, encryptedRefresh, expiry, existing.rows[0].id]
      );
    } else {
      await db.query(`
        INSERT INTO email_accounts (user_id, provider, email_address, access_token, refresh_token, token_expiry, status)
        VALUES ($1, 'microsoft', $2, $3, $4, $5, 'active')
      `, [oauthData.userId, email, encryptedAccess, encryptedRefresh, expiry]);
    }

    logger.info('email-oauth', `Microsoft connected for user ${oauthData.userId}: ${email}`);
    res.redirect(APP_URL + '/settings?email_connected=microsoft');
  } catch (err) {
    logger.error('email-oauth', `Microsoft OAuth failed: ${err.message}`);
    res.redirect(APP_URL + '/settings?email_error=microsoft_failed');
  }
}

// GET /api/nurture/ab-results · Get A/B test results
router.get('/ab-results', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT ab_group_id, variant,
        COUNT(*) AS sent,
        COUNT(*) FILTER (WHERE replied_at IS NOT NULL OR sentiment = 'positive') AS replies,
        MIN(subject) AS sample_subject,
        MIN(created_at) AS started_at
      FROM nurture_emails
      WHERE user_id = $1 AND ab_group_id IS NOT NULL AND status = 'sent'
      GROUP BY ab_group_id, variant
      ORDER BY MIN(created_at) DESC
    `, [req.user.id]);

    // Group by ab_group_id
    const groups = {};
    for (const r of result.rows) {
      if (!groups[r.ab_group_id]) groups[r.ab_group_id] = { id: r.ab_group_id, startedAt: r.started_at, variants: {} };
      groups[r.ab_group_id].variants[r.variant] = {
        sent: parseInt(r.sent),
        replies: parseInt(r.replies),
        replyRate: parseInt(r.sent) > 0 ? Math.round((parseInt(r.replies) / parseInt(r.sent)) * 100) : 0,
        sampleSubject: r.sample_subject,
      };
    }

    res.json({ tests: Object.values(groups) });
  } catch (err) { next(err); }
});

// POST /api/nurture/send · Send a one-off personal email (from chat or UI)
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
module.exports.gmailCallback = gmailCallback;
module.exports.microsoftCallback = microsoftCallback;
module.exports._oauthStates = _oauthStates;
