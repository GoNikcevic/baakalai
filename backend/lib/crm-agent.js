/**
 * CRM Agent — Unified intelligent agent for CRM management
 *
 * Replaces separate cron jobs (sync, cleaning, nurture) with a single
 * intelligent agent that evaluates context and takes the right actions.
 *
 * Triggers:
 * - Scheduled: daily (replaces 3 crons)
 * - Event: webhook from Pipedrive (deal_won, deal_updated, etc.)
 * - Chat: user asks "relance les deals stagnants"
 * - Manual: user clicks "run" in the UI
 *
 * Actions (prioritized):
 * 1. Delta sync: only sync what changed since last run
 * 2. Data quality: detect new issues, skip already-flagged
 * 3. Nurture evaluation: check triggers, generate emails
 * 4. Alerts: notify user of important changes (churn risk, deal won)
 */

const db = require('../db');
const { getUserKey } = require('../config');
const pipedrive = require('../api/pipedrive');
const claude = require('../api/claude');
const { sendNurtureEmail } = require('./email-outbound');
const { notifyUser } = require('../socket');
const logger = require('./logger');

const DAY_MS = 86400000;

/**
 * Run the CRM agent for a user.
 * Returns a structured report of everything that was done.
 */
async function runAgent(userId, { trigger = 'scheduled', event = null } = {}) {
  const startTime = Date.now();
  const report = {
    trigger,
    sync: { imported: 0, updated: 0 },
    cleaning: { issues: 0, score: null },
    nurture: { evaluated: 0, sent: 0, queued: 0 },
    alerts: [],
    errors: [],
  };

  const crmProvider = 'pipedrive'; // TODO: detect from user integrations
  const token = await getUserKey(userId, crmProvider);
  if (!token) {
    report.errors.push('No CRM connected');
    return report;
  }

  // Notify user that agent is working
  notifyUser(userId, 'crm-agent', { status: 'running', trigger });

  try {
    // ── Step 1: Delta Sync ──
    await stepSync(userId, token, report, event);

    // ── Step 2: Quick Data Quality Check ──
    await stepDataQuality(userId, token, report);

    // ── Step 3: Nurture Evaluation ──
    await stepNurture(userId, token, report);

    // ── Step 4: AI Analysis (if significant changes) ──
    if (report.sync.imported > 0 || report.alerts.length > 0 || trigger === 'manual') {
      await stepAnalysis(userId, report);
    }

  } catch (err) {
    report.errors.push(err.message);
    logger.error('crm-agent', `Agent failed for user ${userId}: ${err.message}`);
  }

  report.duration = Date.now() - startTime;

  // Notify completion
  notifyUser(userId, 'crm-agent', {
    status: 'done',
    trigger,
    summary: `Sync: +${report.sync.imported}, Nurture: ${report.nurture.sent} envoy\u00E9s / ${report.nurture.queued} en attente`,
    alerts: report.alerts.length,
    duration: report.duration,
  });

  logger.info('crm-agent', `User ${userId} [${trigger}]: sync +${report.sync.imported}/${report.sync.updated}, nurture ${report.nurture.sent}/${report.nurture.queued}, alerts ${report.alerts.length} (${report.duration}ms)`);

  return report;
}

// ── Step 1: Delta Sync ──

async function stepSync(userId, token, report, event) {
  try {
    // If triggered by a specific event, only sync that contact
    if (event?.type === 'person_updated' && event?.personId) {
      // TODO: single-person sync via webhook
      return;
    }

    const persons = await pipedrive.listAllPersons(token);
    const existingOpps = await db.opportunities.listByUser(userId, 10000, 0);
    const existingByEmail = new Map();
    for (const o of existingOpps) {
      if (o.email) existingByEmail.set(o.email.toLowerCase(), o);
    }

    for (const raw of (persons || [])) {
      const email = Array.isArray(raw.email)
        ? (raw.email.find(e => e.primary)?.value || raw.email[0]?.value || null)
        : (raw.email || null);
      if (!email) continue;

      const existing = existingByEmail.get(email.toLowerCase());

      if (!existing) {
        await db.opportunities.create({
          userId,
          name: raw.name || 'Unknown',
          email,
          title: raw.job_title || null,
          company: raw.org_name || raw.org_id?.name || null,
          status: 'imported',
          crmProvider: 'pipedrive',
          crmContactId: String(raw.id),
        });
        report.sync.imported++;
      } else {
        // Update if Pipedrive data is different
        const updates = {};
        if (raw.name && raw.name !== existing.name) updates.name = raw.name;
        if (raw.job_title && raw.job_title !== existing.title) updates.title = raw.job_title;
        const company = raw.org_name || raw.org_id?.name || '';
        if (company && company !== existing.company) updates.company = company;
        if (!existing.crm_contact_id) updates.crm_contact_id = String(raw.id);

        if (Object.keys(updates).length > 0) {
          await db.opportunities.update(existing.id, updates);
          report.sync.updated++;
        }
      }
    }
  } catch (err) {
    report.errors.push(`Sync: ${err.message}`);
  }
}

// ── Step 2: Data Quality ──

async function stepDataQuality(userId, token, report) {
  try {
    const opps = await db.opportunities.listByUser(userId, 10000, 0);

    let issues = 0;
    const missingEmail = opps.filter(o => !o.email).length;
    const duplicates = findDuplicates(opps);

    issues = missingEmail + duplicates.length;
    report.cleaning.issues = issues;

    // Compute quick score
    let score = 100;
    score -= duplicates.length * 3;
    score -= missingEmail * 1;
    report.cleaning.score = Math.max(0, Math.round(score));

    if (duplicates.length > 5) {
      report.alerts.push({
        type: 'data_quality',
        severity: 'warning',
        message: `${duplicates.length} doublons d\u00E9tect\u00E9s dans votre CRM`,
      });
    }
  } catch (err) {
    report.errors.push(`Quality: ${err.message}`);
  }
}

function findDuplicates(opps) {
  const byEmail = new Map();
  for (const o of opps) {
    if (!o.email) continue;
    const key = o.email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(o);
  }
  return [...byEmail.values()].filter(g => g.length > 1);
}

// ── Step 3: Nurture ──

async function stepNurture(userId, token, report) {
  try {
    // Get triggers
    const triggersResult = await db.query(
      `SELECT * FROM nurture_triggers WHERE user_id = $1 AND enabled = true`,
      [userId]
    );
    if (triggersResult.rows.length === 0) return;

    const opps = await db.opportunities.listByUser(userId, 10000, 0);
    const now = Date.now();

    // Get recently emailed contacts to avoid duplication
    const recentEmails = await db.query(
      `SELECT DISTINCT to_email FROM nurture_emails WHERE user_id = $1 AND created_at > now() - interval '7 days'`,
      [userId]
    );
    const recentSet = new Set(recentEmails.rows.map(r => r.to_email?.toLowerCase()));

    for (const trigger of triggersResult.rows) {
      const conditions = trigger.conditions || {};
      const days = conditions.days || 30;
      let matched = [];

      switch (trigger.trigger_type) {
        case 'deal_won':
          matched = opps.filter(o => o.status === 'won');
          break;
        case 'deal_stagnant':
          matched = opps.filter(o => {
            if (o.status === 'won' || o.status === 'lost') return false;
            const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
            return age >= days;
          });
          break;
        case 'inactive_contact':
          matched = opps.filter(o => {
            const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
            return age >= days && o.status !== 'lost';
          });
          break;
      }

      // Filter already-emailed
      matched = matched.filter(o => o.email && !recentSet.has(o.email.toLowerCase()));
      report.nurture.evaluated += matched.length;

      for (const opp of matched.slice(0, 10)) { // max 10 per trigger per run
        try {
          // Generate email with Claude
          const emailContent = await generateNurtureEmail(trigger, opp);

          if (trigger.mode === 'auto') {
            const result = await sendNurtureEmail(userId, {
              triggerId: trigger.id,
              opportunityId: opp.id,
              to: opp.email,
              toName: opp.name,
              subject: emailContent.subject,
              body: emailContent.body,
              crmProvider: 'pipedrive',
            });
            if (result.success) report.nurture.sent++;
            else report.errors.push(`Email to ${opp.name}: ${result.error}`);
          } else {
            // Queue for approval
            await db.query(`
              INSERT INTO nurture_emails (user_id, trigger_id, opportunity_id, to_email, to_name, subject, body, status)
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            `, [userId, trigger.id, opp.id, opp.email, opp.name, emailContent.subject, emailContent.body]);
            report.nurture.queued++;
          }

          recentSet.add(opp.email.toLowerCase()); // prevent dups within same run
        } catch (err) {
          report.errors.push(`Nurture ${opp.name}: ${err.message}`);
        }
      }

      // Update last_run
      await db.query(`UPDATE nurture_triggers SET last_run = now() WHERE id = $1`, [trigger.id]);
    }
  } catch (err) {
    report.errors.push(`Nurture: ${err.message}`);
  }
}

async function generateNurtureEmail(trigger, opp) {
  const template = trigger.email_template || {};
  const prompt = `G\u00E9n\u00E8re un email personnel (PAS marketing) pour :
- ${opp.name} (${opp.title || ''}) chez ${opp.company || ''}
- Trigger : ${trigger.trigger_type} \u2014 ${trigger.name}
- Ton : ${template.tone || 'professionnel mais chaleureux'}
- Max 6 lignes, texte simple
Retourne un JSON : { "subject": "...", "body": "..." }`;

  try {
    const result = await claude.callClaude('Retourne uniquement du JSON valide.', prompt, 500);
    if (result.parsed) return result.parsed;
    const match = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* fallback below */ }

  return {
    subject: `Suivi \u2014 ${opp.company || opp.name}`,
    body: `Bonjour ${(opp.name || '').split(' ')[0]},\n\nJe me permets de revenir vers vous.\n\nBien cordialement`,
  };
}

// ── Step 4: AI Analysis ──

async function stepAnalysis(userId, report) {
  try {
    const { sync, cleaning, nurture, alerts } = report;
    const hasChanges = sync.imported > 0 || nurture.sent > 0 || nurture.queued > 0;
    if (!hasChanges && alerts.length === 0) return;

    // Detect churn risk and add alerts
    const opps = await db.opportunities.listByUser(userId, 500, 0);
    const now = Date.now();
    const churnRisk = opps.filter(o => {
      const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
      return age >= 90 && o.status !== 'lost';
    });

    if (churnRisk.length > 0) {
      report.alerts.push({
        type: 'churn_risk',
        severity: 'high',
        message: `${churnRisk.length} contact(s) sans activit\u00E9 depuis 90+ jours`,
        contacts: churnRisk.slice(0, 5).map(o => o.name),
      });
    }

    // New contacts alert
    if (sync.imported > 0) {
      report.alerts.push({
        type: 'new_contacts',
        severity: 'info',
        message: `${sync.imported} nouveau(x) contact(s) import\u00E9(s) depuis Pipedrive`,
      });
    }
  } catch (err) {
    report.errors.push(`Analysis: ${err.message}`);
  }
}

// ── Run for all users ──

async function runAllAgents() {
  const users = await db.query(
    `SELECT DISTINCT user_id FROM user_integrations WHERE provider = 'pipedrive' AND access_token IS NOT NULL`
  );

  const results = [];
  for (const { user_id } of users.rows) {
    try {
      const report = await runAgent(user_id, { trigger: 'scheduled' });
      results.push({ userId: user_id, ...report });
    } catch (err) {
      logger.error('crm-agent', `Agent failed for ${user_id}: ${err.message}`);
    }
  }

  return results;
}

module.exports = { runAgent, runAllAgents };
