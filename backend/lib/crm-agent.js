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
const { getUserCrmToken } = require('./crm-token');
const pipedrive = require('../api/pipedrive');
const claude = require('../api/claude');
const { sendNurtureEmail } = require('./email-outbound');
const { notifyUser } = require('../socket');
const { buildOwnerMap, resolveOwner } = require('./crm-owner-resolver');
const { applyMappings } = require('./crm-field-mapper');
const logger = require('./logger');

const DAY_MS = 86400000;

/**
 * Run the CRM agent for a user.
 * Returns a structured report of everything that was done.
 */
// Concurrency lock — prevent duplicate runs for the same user
const _running = new Set();

async function runAgent(userId, { trigger = 'scheduled', event = null } = {}) {
  if (_running.has(userId)) {
    logger.warn('crm-agent', `Skipping — already running for user ${userId}`);
    return { skipped: true, reason: 'already running' };
  }
  _running.add(userId);

  const startTime = Date.now();
  const report = {
    trigger,
    sync: { imported: 0, updated: 0 },
    cleaning: { issues: 0, score: null },
    nurture: { evaluated: 0, sent: 0, queued: 0 },
    responses: { analyzed: 0, positive: 0, negative: 0 },
    alerts: [],
    errors: [],
  };

  // Resolve team for pattern scoping
  let teamId = null;
  try {
    const team = await db.teams.getByUser(userId);
    if (team) teamId = team.id;
  } catch { /* solo user, no team */ }

  // Detect connected CRM provider and resolve credentials
  let crmProvider = 'pipedrive';
  let token = await getUserCrmToken(userId, 'pipedrive');
  if (!token) {
    for (const p of ['hubspot', 'salesforce', 'odoo']) {
      token = await getUserCrmToken(userId, p);
      if (token) { crmProvider = p; break; }
    }
  }
  if (!token) {
    _running.delete(userId);
    report.errors.push('No CRM connected');
    return report;
  }

  // Salesforce needs instanceUrl + accessToken as credentials object
  let crmCreds = token;
  if (crmProvider === 'salesforce') {
    const { decrypt } = require('../config/crypto');
    const integration = await db.query(
      `SELECT access_token, instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`,
      [userId]
    );
    if (integration.rows[0]) {
      if (!integration.rows[0].instance_url) {
        _running.delete(userId);
        report.errors.push('Salesforce instance URL not configured');
        return report;
      }
      crmCreds = {
        accessToken: typeof token === 'string' ? token : decrypt(integration.rows[0].access_token),
        instanceUrl: integration.rows[0].instance_url,
      };
    }
  }

  // Notify user that agent is working
  try { notifyUser(userId, 'crm-agent', { status: 'running', trigger }); } catch { /* non-critical */ }

  try {
    // ── Step 1: Delta Sync ──
    await stepSync(userId, crmCreds, report, event, crmProvider);

    // Pre-load opportunities once for Steps 2-6 (avoid 3x identical query)
    const _opps = await db.opportunities.listByUser(userId, 10000, 0);

    // ── Step 2: Quick Data Quality Check ──
    await stepDataQuality(userId, token, report, _opps);

    // ── Step 3: Nurture Evaluation ──
    await stepNurture(userId, token, report);

    // ── Step 3b: LinkedIn Response Sync ──
    try {
      const { syncLinkedInResponses } = require('./linkedin-response-sync');
      const linkedinReport = await syncLinkedInResponses(userId);
      report.linkedin = linkedinReport;
    } catch (err) {
      report.errors.push(`LinkedIn sync: ${err.message}`);
    }

    // ── Step 4: Response Analysis (email + LinkedIn) ──
    try {
      const { analyzeResponses } = require('./response-analysis-agent');
      const responseReport = await analyzeResponses(userId);
      report.responses = responseReport;
    } catch (err) {
      report.errors.push(`Responses: ${err.message}`);
    }

    // ── Step 4a: Send scheduled autopilot replies ──
    try {
      const { sendScheduledReplies } = require('./conversation-autopilot');
      const autopilotReport = await sendScheduledReplies();
      report.autopilot = autopilotReport;
    } catch (err) {
      report.errors.push(`Autopilot: ${err.message}`);
    }

    // ── Step 4b: A/B Test Analysis ──
    try {
      const { analyzeAbTests } = require('./agents/ab-analyzer');
      const abReport = await analyzeAbTests(userId);
      report.abTests = abReport;
    } catch (err) {
      report.errors.push(`A/B: ${err.message}`);
    }

    // ── Step 4c: Auto-enable A/B on triggers with enough patterns ──
    try {
      const patternCount = await db.query(
        `SELECT COUNT(*) as count FROM memory_patterns
         WHERE dismissed_at IS NULL AND confidence IN ('Haute', 'Moyenne') AND applied IS NOT TRUE
         AND category IN ('Corps', 'Séquence', 'Ton', 'Angle')`,
      );
      if (parseInt(patternCount.rows[0]?.count || 0) >= 2) {
        const updated = await db.query(
          `UPDATE nurture_triggers SET ab_enabled = true
           WHERE user_id = $1 AND enabled = true AND ab_enabled IS NOT TRUE
           RETURNING id`,
          [userId]
        );
        if (updated.rows.length > 0) {
          report.abAutoEnabled = updated.rows.length;
          logger.info('crm-agent', `Auto-enabled A/B on ${updated.rows.length} triggers (enough patterns available)`);
        }
      }
    } catch (err) {
      report.errors.push(`A/B auto-enable: ${err.message}`);
    }

    // ── Step 5: Churn Scoring ──
    try {
      const { scoreAllForUser } = require('./churn-scoring');
      let deals = [];
      try {
        if (crmProvider === 'pipedrive') deals = await pipedrive.getDeals(crmCreds, 500);
        else if (crmProvider === 'salesforce') { const sf = require('../api/salesforce'); deals = await sf.getDeals(crmCreds.instanceUrl, crmCreds.accessToken); }
      } catch { /* ok */ }
      const churnReport = await scoreAllForUser(userId, { deals });
      report.churn = churnReport;
      if (churnReport.atRisk > 0) {
        report.alerts.push({
          type: 'churn_risk',
          severity: churnReport.atRisk >= 5 ? 'high' : 'warning',
          message: `${churnReport.atRisk} contact(s) à risque de churn (score >= 50)`,
        });
      }
      // Real-time notification for high churn contacts (70+)
      try {
        const highChurnResult = await db.query(
          `SELECT id, name, company, email, churn_score FROM opportunities
           WHERE user_id = $1 AND churn_score >= 70 ORDER BY churn_score DESC LIMIT 10`,
          [userId]
        );
        if (highChurnResult.rows.length > 0) {
          const { createNotification } = require('./notify');
          const critical = highChurnResult.rows.filter(c => c.churn_score >= 76);
          const high = highChurnResult.rows.filter(c => c.churn_score >= 70 && c.churn_score < 76);
          const severity = critical.length > 0 ? 'critical' : 'high';
          const names = highChurnResult.rows.slice(0, 5).map(c => c.name || c.company || c.email).join(', ');
          const extra = highChurnResult.rows.length > 5 ? ` +${highChurnResult.rows.length - 5} others` : '';
          await createNotification(userId, {
            type: 'churn_alert',
            title: `${highChurnResult.rows.length} contact(s) at high churn risk`,
            body: `${names}${extra} — churn score 70+. Review in Clients page.`,
            metadata: {
              contactIds: highChurnResult.rows.map(c => c.id),
              count: highChurnResult.rows.length,
              criticalCount: critical.length,
              highCount: high.length,
              severity,
            },
          });
        }
      } catch { /* notification is non-blocking */ }
    } catch (err) {
      report.errors.push(`Churn: ${err.message}`);
    }

    // ── Step 5b: Auto-enrich new imports with missing data (max 20/day) ──
    try {
      const { enrichContacts } = require('./enrich-agent');
      const enrichReport = await enrichContacts(userId, 'all', { limit: 20 });
      report.enrich = { enriched: enrichReport.enriched, notFound: enrichReport.notFound, total: enrichReport.total };
      if (enrichReport.enriched > 0) {
        logger.info('crm-agent', `Auto-enriched ${enrichReport.enriched}/${enrichReport.total} contacts for user ${userId}`);
      }
    } catch (err) {
      report.errors.push(`Enrich: ${err.message}`);
    }

    // ── Step 6: AI Analysis (if significant changes) ──
    if (report.sync.imported > 0 || report.alerts.length > 0 || trigger === 'manual') {
      await stepAnalysis(userId, report, teamId);
    }

  } catch (err) {
    report.errors.push(err.message);
    logger.error('crm-agent', `Agent failed for user ${userId}: ${err.message}`);
  } finally {
    report.duration = Date.now() - startTime;

    // Notify completion (non-critical)
    try {
      notifyUser(userId, 'crm-agent', {
        status: 'done',
        trigger,
        summary: `Sync: +${report.sync.imported}, Nurture: ${report.nurture.sent} envoy\u00E9s / ${report.nurture.queued} en attente`,
        alerts: report.alerts.length,
        duration: report.duration,
      });
    } catch { /* never block cleanup */ }

    logger.info('crm-agent', `User ${userId} [${trigger}]: sync +${report.sync.imported}/${report.sync.updated}, nurture ${report.nurture.sent}/${report.nurture.queued}, alerts ${report.alerts.length} (${report.duration}ms)`);

    _running.delete(userId);
  }
  return report;
}

// ── Step 1: Delta Sync ──

async function stepSync(userId, token, report, event, crmProvider = 'pipedrive') {
  try {
    // If triggered by a webhook event, skip full sync (already handled by webhook route)
    if (event?.type && (event.type.startsWith('deal_') || event.type === 'person_updated')) {
      logger.info('crm-agent', `Skipping full sync — webhook event: ${event.type}`);
      return;
    }

    // Fetch contacts from the connected CRM
    let persons = [];
    if (crmProvider === 'pipedrive') {
      persons = await pipedrive.listAllPersons(token);
    } else if (crmProvider === 'salesforce') {
      const salesforce = require('../api/salesforce');
      persons = await salesforce.listContacts(token.instanceUrl, token.accessToken);
    } else if (crmProvider === 'hubspot') {
      const hubspot = require('../api/hubspot');
      persons = await hubspot.listAllContacts(token);
    } else if (crmProvider === 'odoo') {
      const odoo = require('../api/odoo');
      persons = await odoo.listAllContacts(token);
    }
    const existingOpps = await db.opportunities.listByUser(userId, 10000, 0);
    const existingByEmail = new Map();
    for (const o of existingOpps) {
      if (o.email) existingByEmail.set(o.email.toLowerCase(), o);
    }

    // Build CRM owner map (works for any provider)
    let ownerMap = new Map();
    try {
      ownerMap = await buildOwnerMap(crmProvider, token, userId);
    } catch { /* owner mapping is optional */ }

    for (const raw of (persons || [])) {
      const email = Array.isArray(raw.email)
        ? (raw.email.find(e => e.primary)?.value || raw.email[0]?.value || null)
        : (raw.email || null);
      if (!email) continue;

      // Resolve owner (unified across all CRM providers)
      const { crmOwnerId, ownerEmail, ownerId } = resolveOwner(crmProvider, raw, ownerMap);

      const existing = existingByEmail.get(email.toLowerCase());

      if (!existing) {
        await db.opportunities.create({
          userId,
          name: raw.name || 'Unknown',
          email,
          title: raw.job_title || raw.title || null,
          company: raw.org_name || raw.org_id?.name || raw.company || null,
          status: 'imported',
          crmProvider,
          crmContactId: String(raw.id),
          crmOwnerId,
          ownerEmail,
          ownerId,
        });
        report.sync.imported++;
      } else {
        // Update if CRM data is different
        const updates = {};
        if (raw.name && raw.name !== existing.name) updates.name = raw.name;
        const title = raw.job_title || raw.title;
        if (title && title !== existing.title) updates.title = title;
        if (raw.job_title && raw.job_title !== existing.title) updates.title = raw.job_title;
        const company = raw.org_name || raw.org_id?.name || '';
        if (company && company !== existing.company) updates.company = company;
        if (!existing.crm_contact_id) updates.crm_contact_id = String(raw.id);
        // Sync owner
        if (crmOwnerId && crmOwnerId !== existing.crm_owner_id) {
          updates.crm_owner_id = crmOwnerId;
          if (ownerEmail) updates.owner_email = ownerEmail;
          if (ownerId) updates.owner_id = ownerId;
        }

        if (Object.keys(updates).length > 0) {
          await db.opportunities.update(existing.id, updates);
          report.sync.updated++;
        }

        // Apply field mappings (product lines, etc.)
        try {
          const mapped = await applyMappings(userId, crmProvider, raw);
          if (mapped.productLineIds.length > 0) {
            for (const plId of mapped.productLineIds) {
              await db.query(
                `INSERT INTO opportunity_product_lines (opportunity_id, product_line_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [existing.id, plId]
              );
            }
          }
          const fieldUpdates = {};
          if (mapped.customFields.status && mapped.customFields.status !== existing.status) fieldUpdates.status = mapped.customFields.status;
          if (mapped.customFields.renewal_date) fieldUpdates.renewal_date = mapped.customFields.renewal_date;
          if (Object.keys(fieldUpdates).length > 0) {
            await db.opportunities.update(existing.id, fieldUpdates);
          }
        } catch { /* mapping is optional */ }
      }
    }
    // Sync deal values + lifecycle dates from CRM deals
    try {
      let deals = [];
      if (crmProvider === 'pipedrive') deals = await pipedrive.getDeals(token, 500);
      else if (crmProvider === 'salesforce') { const sf = require('../api/salesforce'); deals = await sf.getDeals(token.instanceUrl, token.accessToken); }

      for (const deal of deals) {
        const personId = deal.personId ? String(deal.personId) : null;
        if (!personId) continue;

        const opp = await db.query(
          `SELECT id, status, won_date, lost_date, deal_value FROM opportunities WHERE user_id = $1 AND crm_contact_id = $2 LIMIT 1`,
          [userId, personId]
        );
        if (!opp.rows[0]) continue;
        const o = opp.rows[0];

        const updates = {};
        if (deal.value && deal.value !== parseFloat(o.deal_value)) updates.deal_value = deal.value;
        if (deal.status === 'won' && o.status !== 'won') { updates.status = 'won'; updates.won_date = new Date().toISOString(); }
        if (deal.status === 'lost' && o.status !== 'lost') { updates.status = 'lost'; updates.lost_date = new Date().toISOString(); }

        if (Object.keys(updates).length > 0) {
          await db.opportunities.update(o.id, updates);
        }
      }
    } catch { /* deal sync is optional */ }
  } catch (err) {
    report.errors.push(`Sync: ${err.message}`);
  }
}

// ── Step 2: Data Quality ──

async function stepDataQuality(userId, token, report, opps = null) {
  try {
    if (!opps) opps = await db.opportunities.listByUser(userId, 10000, 0);

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
        case 'deal_lost':
          matched = opps.filter(o => {
            if (o.status !== 'lost') return false;
            const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
            return age >= days && age < days + 7; // window of 7 days after loss
          });
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
        case 'onboarding_check':
          matched = opps.filter(o => {
            if (o.status !== 'won') return false;
            const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
            return age >= days && age < days + 3; // window of 3 days
          });
          break;
        case 'renewal_reminder':
          // Match won deals where renewal_date is within X days from now (or past due)
          matched = opps.filter(o => {
            if (o.status !== 'won') return false;
            if (o.renewal_date) {
              // Use renewal_date from CRM field mapping
              const daysUntilRenewal = (new Date(o.renewal_date).getTime() - now) / DAY_MS;
              return daysUntilRenewal <= days && daysUntilRenewal >= -7; // X days before + 7 days grace
            }
            // Fallback: use won_date + trigger days as estimated renewal
            const wonDate = o.won_date || o.updated_at || o.created_at;
            if (!wonDate) return false;
            const age = (now - new Date(wonDate).getTime()) / DAY_MS;
            return age >= days;
          });
          break;
        case 'upsell_opportunity':
          matched = opps.filter(o => {
            if (o.status !== 'won') return false;
            const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
            return age >= days;
          });
          break;
        case 'feedback_request':
          matched = opps.filter(o => {
            if (o.status !== 'won') return false;
            const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
            return age >= days && age < days + 7;
          });
          break;
      }

      // Filter already-emailed
      matched = matched.filter(o => o.email && !recentSet.has(o.email.toLowerCase()));
      report.nurture.evaluated += matched.length;

      // A/B testing: split contacts using epsilon-greedy bandit
      const abEnabled = trigger.ab_enabled && matched.length >= 4;
      const abGroupId = abEnabled ? `ab_${trigger.id}_${Date.now()}` : null;

      // Compute bandit weights from past A/B results for this trigger
      let banditBias = 0.5; // default 50/50
      if (abEnabled) {
        try {
          const past = await db.query(
            `SELECT variant,
              COUNT(*) FILTER (WHERE replied_at IS NOT NULL OR sentiment = 'positive') AS wins,
              COUNT(*) AS total
             FROM nurture_emails
             WHERE trigger_id = $1 AND ab_group_id IS NOT NULL AND variant IS NOT NULL
             GROUP BY variant`,
            [trigger.id]
          );
          const statsA = past.rows.find(r => r.variant === 'A');
          const statsB = past.rows.find(r => r.variant === 'B');
          if (statsA && statsB && (parseInt(statsA.total) + parseInt(statsB.total)) >= 6) {
            const rateA = parseInt(statsA.total) > 0 ? parseInt(statsA.wins) / parseInt(statsA.total) : 0;
            const rateB = parseInt(statsB.total) > 0 ? parseInt(statsB.wins) / parseInt(statsB.total) : 0;
            // Epsilon-greedy: 20% exploration, 80% exploitation
            const epsilon = 0.2;
            banditBias = rateA >= rateB
              ? 1 - epsilon / 2   // A wins → 90% chance of A
              : epsilon / 2;       // B wins → 10% chance of A (= 90% B)
          }
        } catch { /* fallback to 50/50 */ }
      }

      for (let idx = 0; idx < Math.min(matched.length, 10); idx++) {
        const opp = matched[idx];
        try {
          // Generate email(s) — A/B or single
          const emailContent = await generateNurtureEmail(trigger, opp, { abTest: abEnabled && idx < 2, teamId });

          // Determine which variant to use (bandit allocation)
          let variant = null;
          let email;
          const usedPatternIds = emailContent.patternIds || [];
          if (abEnabled && emailContent.A && emailContent.B) {
            variant = Math.random() < banditBias ? 'A' : 'B';
            email = emailContent[variant];
          } else {
            email = emailContent.subject ? emailContent : (emailContent.A || emailContent);
          }

          if (trigger.mode === 'auto') {
            const result = await sendNurtureEmail(userId, {
              triggerId: trigger.id,
              opportunityId: opp.id,
              to: opp.email,
              toName: opp.name,
              subject: email.subject,
              body: email.body,
              crmProvider,
              patternIds: usedPatternIds,
            });
            if (result.success) {
              // Tag with variant info
              if (variant && result.emailId) {
                await db.query(`UPDATE nurture_emails SET variant = $1, ab_group_id = $2 WHERE id = $3`, [variant, abGroupId, result.emailId]);
              }
              report.nurture.sent++;
            } else report.errors.push(`Email to ${opp.name}: ${result.error}`);
          } else {
            // Queue for approval with variant info
            await db.query(`
              INSERT INTO nurture_emails (user_id, trigger_id, opportunity_id, to_email, to_name, subject, body, status, variant, ab_group_id, pattern_ids)
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
            `, [userId, trigger.id, opp.id, opp.email, opp.name, email.subject, email.body, variant, abGroupId, usedPatternIds]);
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

/**
 * Generate nurture email(s). If abTest=true, returns { A: {subject,body}, B: {subject,body} }
 * Otherwise returns { subject, body }
 */
async function generateNurtureEmail(trigger, opp, { abTest = false, teamId = null } = {}) {
  const template = trigger.email_template || {};

  // Load relevant memory patterns — contextual (pgvector) or fallback (recency-based)
  let patternsContext = '';
  let patternIds = [];
  try {
    let allPatterns;
    // Try contextual search via pgvector first
    const { findRelevantPatterns, ENABLED: pgvEnabled } = require('./vector-store');
    if (pgvEnabled) {
      const context = `${trigger.trigger_type} ${opp.company || ''} ${opp.title || ''} ${(trigger.conditions?.sectors || []).join(' ')}`;
      allPatterns = await findRelevantPatterns(context, 10);
    }
    // Fallback to recency-based
    if (!allPatterns || allPatterns.length === 0) {
      allPatterns = await db.memoryPatterns.listForPrompt(10, teamId);
    }
    if (allPatterns.length > 0) {
      patternIds = allPatterns.map(p => p.id);
      patternsContext = `\n\nPATTERNS QUI FONCTIONNENT (m\u00E9moire cross-campagne) :\n` +
        allPatterns.map(p => `- ${p.applied ? '[APPROUV\u00c9]' : `[${p.confidence}]`} ${p.pattern}`).join('\n') +
        `\nApplique en priorit\u00e9 les patterns APPROUV\u00c9S.`;
    }
  } catch { /* patterns optional */ }

  // Load trigger effectiveness if available
  let effectivenessContext = '';
  const conditions = trigger.conditions || {};
  const effectiveness = conditions._effectiveness;
  if (effectiveness && effectiveness.total >= 3) {
    effectivenessContext = `\n\nEFFICACIT\u00C9 DE CE TRIGGER : ${effectiveness.successRate}% de r\u00E9ponses positives sur ${effectiveness.total} envois.`;
    if (effectiveness.successRate < 30) {
      effectivenessContext += ` Le taux est faible \u2014 essaie un angle diff\u00E9rent.`;
    } else if (effectiveness.successRate >= 60) {
      effectivenessContext += ` Le taux est bon \u2014 garde un ton similaire.`;
    }
  }

  const contactCtx = `${opp.name} (${opp.title || ''}) chez ${opp.company || ''}`;
  const triggerCtx = `${trigger.trigger_type} \u2014 ${trigger.name}`;
  const toneCtx = template.tone || 'professionnel mais chaleureux';

  if (abTest) {
    const prompt = `G\u00E9n\u00E8re DEUX variantes d'email personnel (PAS marketing) pour A/B testing.
- Contact : ${contactCtx}
- Trigger : ${triggerCtx}
- Ton : ${toneCtx}
- Max 6 lignes chaque, texte simple, doit sembler humain

Variante A : approche directe et concise
Variante B : approche diff\u00E9rente (angle, sujet, ou ton)
Les deux doivent \u00EAtre radicalement diff\u00E9rentes pour que le test soit significatif.${patternsContext}${effectivenessContext}

Retourne un JSON : { "A": { "subject": "...", "body": "..." }, "B": { "subject": "...", "body": "..." } }`;

    try {
      const result = await claude.callClaude('Retourne uniquement du JSON valide.', prompt, 800);
      let parsed = result.parsed;
      if (!parsed) {
        const match = (result.raw || '').match(/\{[\s\S]*"A"[\s\S]*"B"[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      }
      if (parsed?.A?.subject && parsed?.B?.subject) return { ...parsed, patternIds };
    } catch { /* fallback to single */ }
  }

  // Single email (no A/B or A/B generation failed)
  const prompt = `G\u00E9n\u00E8re un email personnel (PAS marketing) pour :
- ${contactCtx}
- Trigger : ${triggerCtx}
- Ton : ${toneCtx}
- Max 6 lignes, texte simple, doit sembler humain${patternsContext}${effectivenessContext}

Retourne un JSON : { "subject": "...", "body": "..." }`;

  try {
    const result = await claude.callClaude('Retourne uniquement du JSON valide.', prompt, 500);
    if (result.parsed) return { ...result.parsed, patternIds };
    const match = (result.raw || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (match) return { ...JSON.parse(match[0]), patternIds };
  } catch { /* fallback below */ }

  return {
    subject: `Suivi \u2014 ${opp.company || opp.name}`,
    body: `Bonjour ${(opp.name || '').split(' ')[0]},\n\nJe me permets de revenir vers vous.\n\nBien cordialement`,
    patternIds,
  };
}

// ── Step 6: AI Analysis ──

async function stepAnalysis(userId, report, teamId = null) {
  try {
    const { sync, cleaning, nurture, alerts } = report;
    const hasChanges = sync.imported > 0 || nurture.sent > 0 || nurture.queued > 0;
    if (!hasChanges && alerts.length === 0) return;

    // Churn risk alerts now handled by Step 5 (churn-scoring engine)
    const opps = await db.opportunities.listByUser(userId, 500, 0);

    // New contacts alert
    if (sync.imported > 0) {
      report.alerts.push({
        type: 'new_contacts',
        severity: 'info',
        message: `${sync.imported} nouveau(x) contact(s) import\u00E9(s) depuis Pipedrive`,
      });
    }

    // ── CRM-driven memory patterns ──
    // Analyze deal data and create patterns when we have enough signal
    if (opps.length >= 10) {
      try {
        await generateCrmPatterns(userId, opps, teamId);
      } catch (err) {
        logger.warn('crm-agent', `CRM pattern generation failed: ${err.message}`);
      }
    }
  } catch (err) {
    report.errors.push(`Analysis: ${err.message}`);
  }
}

/**
 * Generate memory patterns from CRM deal data.
 * Only creates patterns when there's statistically meaningful signal.
 */
async function generateCrmPatterns(userId, opps, teamId = null) {
  // Wrap create to auto-inject teamId
  const createPattern = (data) => db.memoryPatterns.create({ ...data, teamId });
  const now = Date.now();
  const won = opps.filter(o => o.status === 'won');
  const lost = opps.filter(o => o.status === 'lost');
  const total = opps.length;

  if (total < 10) return; // not enough data

  // Pattern 1: Win rate
  if (won.length + lost.length >= 5) {
    const winRate = Math.round((won.length / (won.length + lost.length)) * 100);
    const existing = await db.memoryPatterns.list({ category: 'Cible', limit: 50 });
    const hasWinRate = existing.some(p => p.pattern.includes('taux de conversion CRM'));
    if (!hasWinRate) {
      await createPattern({
        pattern: `Taux de conversion CRM : ${winRate}% (${won.length} gagn\u00E9s / ${won.length + lost.length} conclus)`,
        category: 'Cible',
        data: JSON.stringify({ source: 'crm_analysis', won: won.length, lost: lost.length, total }),
        confidence: total >= 50 ? 'Haute' : total >= 20 ? 'Moyenne' : 'Faible',
        sectors: [],
        targets: [],
      });
    }
  }

  // Pattern 2: Average deal velocity (time to won)
  if (won.length >= 3) {
    const velocities = won
      .filter(o => o.created_at && o.updated_at)
      .map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / DAY_MS);
    if (velocities.length >= 3) {
      const avgDays = Math.round(velocities.reduce((s, v) => s + v, 0) / velocities.length);
      const existing = await db.memoryPatterns.list({ category: 'Timing', limit: 50 });
      const hasVelocity = existing.some(p => p.pattern.includes('cycle de vente moyen'));
      if (!hasVelocity) {
        await createPattern({
          pattern: `Cycle de vente moyen : ${avgDays} jours (sur ${velocities.length} deals gagn\u00E9s)`,
          category: 'Timing',
          data: JSON.stringify({ source: 'crm_analysis', avgDays, sampleSize: velocities.length }),
          confidence: velocities.length >= 10 ? 'Haute' : 'Moyenne',
          sectors: [],
          targets: [],
        });
      }
    }
  }

  // Pattern 3: Stagnation threshold — at what point do deals die?
  if (lost.length >= 3) {
    const stagnation = lost
      .filter(o => o.created_at && o.updated_at)
      .map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / DAY_MS);
    if (stagnation.length >= 3) {
      const avgStagnation = Math.round(stagnation.reduce((s, v) => s + v, 0) / stagnation.length);
      const existing = await db.memoryPatterns.list({ category: 'Timing', limit: 50 });
      const hasStagnation = existing.some(p => p.pattern.includes('deals perdus stagnent'));
      if (!hasStagnation) {
        await createPattern({
          pattern: `Les deals perdus stagnent en moyenne ${avgStagnation} jours avant d'\u00EAtre clos \u2014 relancer avant ce seuil`,
          category: 'Timing',
          data: JSON.stringify({ source: 'crm_analysis', avgStagnation, sampleSize: stagnation.length }),
          confidence: stagnation.length >= 10 ? 'Haute' : 'Moyenne',
          sectors: [],
          targets: [],
        });
      }
    }
  }

  // Pattern 4: Best-performing company sizes (if available)
  if (won.length >= 5) {
    const sizeGroups = {};
    for (const o of won) {
      const size = o.company_size || 'unknown';
      if (size === 'unknown') continue;
      sizeGroups[size] = (sizeGroups[size] || 0) + 1;
    }
    const topSize = Object.entries(sizeGroups).sort((a, b) => b[1] - a[1])[0];
    if (topSize && topSize[1] >= 3) {
      const existing = await db.memoryPatterns.list({ category: 'Cible', limit: 50 });
      const hasSizePattern = existing.some(p => p.pattern.includes('taille d\'entreprise qui convertit'));
      if (!hasSizePattern) {
        await createPattern({
          pattern: `La taille d'entreprise qui convertit le mieux : ${topSize[0]} (${topSize[1]} deals gagn\u00E9s)`,
          category: 'Cible',
          data: JSON.stringify({ source: 'crm_analysis', sizeGroups }),
          confidence: topSize[1] >= 10 ? 'Haute' : 'Moyenne',
          sectors: [],
          targets: [],
        });
      }
    }
  }

  // Patterns 5-7 (timing, subject lines, email length) removed — now handled by
  // strategic agents: Timing Agent, Copy Optimizer (more thorough analysis + dedup)

  // Pattern 8: Best responding job title/function
  try {
    const responded = await db.query(
      `SELECT o.title, COUNT(*) as count FROM nurture_emails ne
       JOIN opportunities o ON o.id = ne.opportunity_id
       WHERE ne.user_id = $1 AND ne.analyzed_at IS NOT NULL AND o.title IS NOT NULL AND o.title != ''
       GROUP BY o.title HAVING COUNT(*) >= 2
       ORDER BY COUNT(*) DESC LIMIT 1`,
      [userId]
    );
    if (responded.rows.length > 0) {
      const topTitle = responded.rows[0];
      const existing = await db.memoryPatterns.list({ category: 'Cible', limit: 50 });
      const hasTitle = existing.some(p => p.pattern.includes('fonction qui r\u00E9pond le mieux'));
      if (!hasTitle) {
        await createPattern({
          pattern: `La fonction qui r\u00E9pond le mieux aux emails d'activation : ${topTitle.title} (${topTitle.count} r\u00E9ponses)`,
          category: 'Cible',
          data: JSON.stringify({ source: 'title_analysis', title: topTitle.title, count: parseInt(topTitle.count, 10) }),
          confidence: parseInt(topTitle.count, 10) >= 10 ? 'Haute' : 'Moyenne',
          sectors: [], targets: [],
        });
      }
    }
  } catch { /* optional */ }

  // Pattern 9: Multi-touch effectiveness (how many touches before response)
  try {
    const touchCounts = await db.query(
      `SELECT ne.opportunity_id, COUNT(*) as touches,
              bool_or(ne.analyzed_at IS NOT NULL) as got_response
       FROM nurture_emails ne
       WHERE ne.user_id = $1 AND ne.status = 'sent' AND ne.opportunity_id IS NOT NULL
       GROUP BY ne.opportunity_id HAVING COUNT(*) >= 2`,
      [userId]
    );
    if (touchCounts.rows.length >= 5) {
      const withResponse = touchCounts.rows.filter(r => r.got_response);
      if (withResponse.length >= 3) {
        const avgTouches = Math.round(withResponse.reduce((s, r) => s + parseInt(r.touches, 10), 0) / withResponse.length * 10) / 10;
        const existing = await db.memoryPatterns.list({ category: 'Timing', limit: 50 });
        const hasTouch = existing.some(p => p.pattern.includes('touches avant r\u00E9ponse'));
        if (!hasTouch) {
          await createPattern({
            pattern: `En moyenne ${avgTouches} touches avant d'obtenir une r\u00E9ponse (sur ${withResponse.length} contacts)`,
            category: 'Timing',
            data: JSON.stringify({ source: 'multitouch_analysis', avgTouches, sampleSize: withResponse.length }),
            confidence: withResponse.length >= 10 ? 'Haute' : 'Moyenne',
            sectors: [], targets: [],
          });
        }
      }
    }
  } catch { /* optional */ }
}

// ── Run for all users ──

async function runAllAgents() {
  const users = await db.query(
    `SELECT DISTINCT user_id FROM user_integrations WHERE provider IN ('pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable') AND access_token IS NOT NULL`
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
