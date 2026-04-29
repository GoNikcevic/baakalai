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
const { buildOwnerMap, resolveOwner } = require('./crm-owner-resolver');
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
    responses: { analyzed: 0, positive: 0, negative: 0 },
    alerts: [],
    errors: [],
  };

  // Detect connected CRM provider
  let crmProvider = 'pipedrive';
  let token = await getUserKey(userId, 'pipedrive');
  if (!token) {
    for (const p of ['hubspot', 'salesforce', 'odoo']) {
      token = await getUserKey(userId, p);
      if (token) { crmProvider = p; break; }
    }
  }
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

    // ── Step 4: Response Analysis ──
    try {
      const { analyzeResponses } = require('./response-analysis-agent');
      const responseReport = await analyzeResponses(userId);
      report.responses = responseReport;
    } catch (err) {
      report.errors.push(`Responses: ${err.message}`);
    }

    // ── Step 5: Churn Scoring ──
    try {
      const { scoreAllForUser } = require('./churn-scoring');
      let deals = [];
      try { deals = await pipedrive.getDeals(token, 500); } catch { /* ok */ }
      const churnReport = await scoreAllForUser(userId, { deals });
      report.churn = churnReport;
      if (churnReport.atRisk > 0) {
        report.alerts.push({
          type: 'churn_risk',
          severity: churnReport.atRisk >= 5 ? 'high' : 'warning',
          message: `${churnReport.atRisk} contact(s) à risque de churn (score >= 50)`,
        });
      }
    } catch (err) {
      report.errors.push(`Churn: ${err.message}`);
    }

    // ── Step 6: AI Analysis (if significant changes) ──
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
          title: raw.job_title || null,
          company: raw.org_name || raw.org_id?.name || null,
          status: 'imported',
          crmProvider: 'pipedrive',
          crmContactId: String(raw.id),
          crmOwnerId,
          ownerEmail,
          ownerId,
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
          // For now, same as stagnant but only for won deals
          matched = opps.filter(o => {
            if (o.status !== 'won') return false;
            const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
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

  // Load relevant memory patterns to inform email generation
  let patternsContext = '';
  try {
    const patterns = await db.memoryPatterns.list({ confidence: 'Haute', limit: 5 });
    const mediumPatterns = await db.memoryPatterns.list({ confidence: 'Moyenne', limit: 3 });
    const allPatterns = [...patterns, ...mediumPatterns];
    if (allPatterns.length > 0) {
      patternsContext = `\n\nPATTERNS QUI FONCTIONNENT (m\u00E9moire cross-campagne) :\n` +
        allPatterns.map(p => `- [${p.confidence}] ${p.pattern} (cat\u00E9gorie: ${p.category})`).join('\n') +
        `\nUtilise ces patterns pour informer le ton, l'angle et la structure de l'email. Ne les copie pas mot pour mot.`;
    }
  } catch { /* patterns optional */ }

  // Load trigger effectiveness if available
  let effectivenessContext = '';
  const conditions = trigger.conditions || {};
  const effectiveness = conditions._effectiveness;
  if (effectiveness && effectiveness.total >= 3) {
    effectivenessContext = `\n\nEFFICACIT\u00C9 DE CE TRIGGER : ${effectiveness.successRate}% de r\u00E9ponses positives sur ${effectiveness.total} envois.`;
    if (effectiveness.successRate < 30) {
      effectivenessContext += ` Le taux est faible \u2014 essaie un angle diff\u00E9rent de ce qui a \u00E9t\u00E9 fait pr\u00E9c\u00E9demment.`;
    } else if (effectiveness.successRate >= 60) {
      effectivenessContext += ` Le taux est bon \u2014 garde un ton similaire aux emails pr\u00E9c\u00E9dents.`;
    }
  }

  const prompt = `G\u00E9n\u00E8re un email personnel (PAS marketing) pour :
- ${opp.name} (${opp.title || ''}) chez ${opp.company || ''}
- Trigger : ${trigger.trigger_type} \u2014 ${trigger.name}
- Ton : ${template.tone || 'professionnel mais chaleureux'}
- Max 6 lignes, texte simple
- L'email doit sembler \u00E9crit par un humain, pas g\u00E9n\u00E9r\u00E9${patternsContext}${effectivenessContext}

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

// ── Step 6: AI Analysis ──

async function stepAnalysis(userId, report) {
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
        await generateCrmPatterns(userId, opps);
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
async function generateCrmPatterns(userId, opps) {
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
      await db.memoryPatterns.create({
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
        await db.memoryPatterns.create({
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
        await db.memoryPatterns.create({
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
        await db.memoryPatterns.create({
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

  // Pattern 5: Best send timing (day of week analysis from nurture emails)
  try {
    const sentEmails = await db.query(
      `SELECT EXTRACT(DOW FROM sent_at) as dow, COUNT(*) as total,
              COUNT(*) FILTER (WHERE analyzed_at IS NOT NULL) as analyzed
       FROM nurture_emails WHERE user_id = $1 AND status = 'sent' AND sent_at IS NOT NULL
       GROUP BY EXTRACT(DOW FROM sent_at) HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC`,
      [userId]
    );
    if (sentEmails.rows.length >= 2) {
      const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
      const bestDay = sentEmails.rows[0];
      const existing = await db.memoryPatterns.list({ category: 'Timing', limit: 50 });
      const hasTiming = existing.some(p => p.pattern.includes('jour le plus actif'));
      if (!hasTiming) {
        await db.memoryPatterns.create({
          pattern: `Le ${dayNames[bestDay.dow]} est le jour le plus actif pour les emails d'activation (${bestDay.total} envois)`,
          category: 'Timing',
          data: JSON.stringify({ source: 'timing_analysis', dayStats: sentEmails.rows }),
          confidence: parseInt(bestDay.total, 10) >= 20 ? 'Haute' : 'Moyenne',
          sectors: [], targets: [],
        });
      }
    }
  } catch { /* optional */ }

  // Pattern 6: Email subject line analysis (questions vs statements)
  try {
    const subjects = await db.query(
      `SELECT subject, analyzed_at FROM nurture_emails
       WHERE user_id = $1 AND status = 'sent' AND subject IS NOT NULL`,
      [userId]
    );
    if (subjects.rows.length >= 10) {
      const questions = subjects.rows.filter(s => s.subject.includes('?'));
      const statements = subjects.rows.filter(s => !s.subject.includes('?'));
      const qAnalyzed = questions.filter(s => s.analyzed_at).length;
      const sAnalyzed = statements.filter(s => s.analyzed_at).length;
      const qRate = questions.length > 0 ? Math.round((qAnalyzed / questions.length) * 100) : 0;
      const sRate = statements.length > 0 ? Math.round((sAnalyzed / statements.length) * 100) : 0;

      if (questions.length >= 3 && statements.length >= 3 && Math.abs(qRate - sRate) >= 15) {
        const existing = await db.memoryPatterns.list({ category: 'Objets', limit: 50 });
        const hasSubject = existing.some(p => p.pattern.includes('objets avec question'));
        if (!hasSubject) {
          const better = qRate > sRate ? 'avec question' : 'affirmatifs';
          await db.memoryPatterns.create({
            pattern: `Les objets ${better} g\u00E9n\u00E8rent plus d'engagement (${Math.max(qRate, sRate)}% vs ${Math.min(qRate, sRate)}%)`,
            category: 'Objets',
            data: JSON.stringify({ source: 'subject_analysis', questions: questions.length, statements: statements.length, qRate, sRate }),
            confidence: subjects.rows.length >= 30 ? 'Haute' : 'Moyenne',
            sectors: [], targets: [],
          });
        }
      }
    }
  } catch { /* optional */ }

  // Pattern 7: Email body length correlation
  try {
    const emails = await db.query(
      `SELECT LENGTH(body) as len, analyzed_at FROM nurture_emails
       WHERE user_id = $1 AND status = 'sent' AND body IS NOT NULL`,
      [userId]
    );
    if (emails.rows.length >= 10) {
      const short = emails.rows.filter(e => e.len < 300);
      const long = emails.rows.filter(e => e.len >= 300);
      const shortResponse = short.filter(e => e.analyzed_at).length;
      const longResponse = long.filter(e => e.analyzed_at).length;

      if (short.length >= 3 && long.length >= 3) {
        const shortRate = Math.round((shortResponse / short.length) * 100);
        const longRate = Math.round((longResponse / long.length) * 100);
        if (Math.abs(shortRate - longRate) >= 15) {
          const existing = await db.memoryPatterns.list({ category: 'Corps', limit: 50 });
          const hasLength = existing.some(p => p.pattern.includes('emails courts') || p.pattern.includes('emails longs'));
          if (!hasLength) {
            const better = shortRate > longRate ? 'courts (<300 car.)' : 'longs (300+ car.)';
            await db.memoryPatterns.create({
              pattern: `Les emails ${better} obtiennent plus de r\u00E9ponses (${Math.max(shortRate, longRate)}% vs ${Math.min(shortRate, longRate)}%)`,
              category: 'Corps',
              data: JSON.stringify({ source: 'length_analysis', shortCount: short.length, longCount: long.length, shortRate, longRate }),
              confidence: emails.rows.length >= 30 ? 'Haute' : 'Moyenne',
              sectors: [], targets: [],
            });
          }
        }
      }
    }
  } catch { /* optional */ }

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
        await db.memoryPatterns.create({
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
          await db.memoryPatterns.create({
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
