/**
 * Agent Chains — Autonomous L4 action chains
 *
 * Chains wire existing agent outputs into automated action sequences.
 * Each chain: detect → enrich → generate → execute → learn
 *
 * Chain 1: Deal Reactivation
 *   Deal Coach (stagnant deal) → Copy Optimizer (best angle) → Timing Agent (best window)
 *   → CRM Agent nurture (generate + send) → Learning Signal (measure)
 *
 * Chain 2: Auto-Upsell
 *   Upsell Detector (score >= threshold) → Copy Optimizer (upsell angle)
 *   → Timing Agent (best window) → CRM Agent nurture (generate + send + create opp)
 *   → Learning Signal (measure)
 *
 * Safety:
 * - Per-user config with enable/disable per chain
 * - Daily quota limits
 * - Approval mode (pending → user approves → executed)
 * - Audit trail in agent_chain_executions
 * - Contacts emailed in last 7 days are excluded
 */

const db = require('../db');
const claude = require('../api/claude');
const { sendNurtureEmail } = require('./email-outbound');
const { createNotification } = require('./notify');
const logger = require('./logger');

const DAY_MS = 86400000;

// ─── Config helpers ───

async function getChainConfig(userId) {
  const result = await db.query(
    'SELECT * FROM agent_chain_configs WHERE user_id = $1',
    [userId]
  );
  if (result.rows[0]) return result.rows[0];
  // Create default config
  await db.query('INSERT INTO agent_chain_configs (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  const fresh = await db.query('SELECT * FROM agent_chain_configs WHERE user_id = $1', [userId]);
  return fresh.rows[0];
}

async function countTodayExecutions(userId, chainType) {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM agent_chain_executions
     WHERE user_id = $1 AND chain_type = $2 AND status = 'executed'
       AND created_at > CURRENT_DATE`,
    [userId, chainType]
  );
  return parseInt(result.rows[0].count);
}

async function getRecentlyEmailed(userId) {
  const result = await db.query(
    `SELECT DISTINCT LOWER(to_email) as email FROM nurture_emails
     WHERE user_id = $1 AND created_at > now() - interval '7 days'`,
    [userId]
  );
  return new Set(result.rows.map(r => r.email));
}

async function logChainExecution(userId, chainType, triggerAgent, triggerData, steps, result, status) {
  return db.query(
    `INSERT INTO agent_chain_executions (user_id, chain_type, trigger_agent, trigger_data, steps_completed, result, status, executed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [userId, chainType, triggerAgent, JSON.stringify(triggerData), steps, JSON.stringify(result), status, status === 'executed' ? new Date() : null]
  );
}

// ─── Timing enrichment (shared by both chains) ───

async function getTimingContext(userId) {
  // Pull best day/hour from memory patterns created by Timing Agent
  const patterns = await db.query(
    `SELECT pattern, data FROM memory_patterns
     WHERE category = 'Séquence' AND dismissed_at IS NULL
       AND (pattern ILIKE '%meilleur jour%' OR pattern ILIKE '%meilleure heure%')
     ORDER BY confidence DESC, updated_at DESC LIMIT 2`
  );
  let bestDay = null, bestHour = null;
  for (const p of patterns.rows) {
    const data = typeof p.data === 'string' ? JSON.parse(p.data) : p.data;
    if (data?.bestDay) bestDay = data.bestDay;
    if (data?.bestHour != null) bestHour = data.bestHour;
  }
  return { bestDay, bestHour };
}

// ─── Copy context (shared by both chains) ───

async function getCopyContext(userId) {
  const patterns = await db.query(
    `SELECT pattern FROM memory_patterns
     WHERE category = 'Séquence' AND dismissed_at IS NULL AND confidence IN ('Haute', 'Moyenne')
       AND (pattern ILIKE '%sujets efficaces%' OR pattern ILIKE '%longueur optimale%' OR pattern ILIKE '%copy%')
     ORDER BY confidence DESC LIMIT 3`
  );
  return patterns.rows.map(p => p.pattern).join('\n');
}

// ─── Memory patterns context ───

async function getPatternContext(teamId) {
  let patterns;
  try {
    patterns = await db.memoryPatterns.listForPrompt(8, teamId);
  } catch {
    patterns = [];
  }
  if (patterns.length === 0) return { text: '', ids: [] };
  return {
    text: patterns.map(p => `- ${p.applied ? '[APPROVED]' : `[${p.confidence}]`} ${p.pattern}`).join('\n'),
    ids: patterns.map(p => p.id),
  };
}

// ─── Resolve team ───

async function getTeamId(userId) {
  try {
    const team = await db.teams.getByUser(userId);
    return team?.id || null;
  } catch { return null; }
}

// ─── Detect CRM provider ───

async function getCrmProvider(userId) {
  const { getUserKey } = require('../config');
  for (const p of ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable', 'folk']) {
    const token = await getUserKey(userId, p);
    if (token) return p;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// CHAIN 1: Deal Reactivation
// ═══════════════════════════════════════════════════════════════

async function runDealReactivation(userId) {
  const config = await getChainConfig(userId);
  const chainCfg = typeof config.deal_reactivation === 'string'
    ? JSON.parse(config.deal_reactivation) : config.deal_reactivation;

  if (!chainCfg.enabled) return { skipped: true, reason: 'disabled' };

  const todayCount = await countTodayExecutions(userId, 'deal_reactivation');
  if (todayCount >= chainCfg.max_per_day) return { skipped: true, reason: 'daily_limit_reached', count: todayCount };

  const remaining = chainCfg.max_per_day - todayCount;
  const report = { chain: 'deal_reactivation', executed: 0, pending: 0, skipped: 0, errors: [] };

  try {
    // Step 1: Run Deal Coach to find stagnant deals
    const dealCoach = require('./agents/deal-coach');
    const coachReport = await dealCoach.run(userId);

    if (!coachReport.suggestions || coachReport.suggestions.length === 0) {
      return { ...report, skipped: true, reason: 'no_stagnant_deals' };
    }

    // Filter to email-actionable suggestions only
    const emailSuggestions = coachReport.suggestions.filter(s => s.action === 'email');
    if (emailSuggestions.length === 0) {
      return { ...report, skipped: true, reason: 'no_email_suggestions' };
    }

    // Step 2: Get enrichment context
    const [recentlyEmailed, timing, copyCtx, teamId] = await Promise.all([
      getRecentlyEmailed(userId),
      getTimingContext(userId),
      getCopyContext(userId),
      getTeamId(userId),
    ]);
    const patternCtx = await getPatternContext(teamId);
    const crmProvider = await getCrmProvider(userId);

    // Step 3: For each suggestion, generate and send/queue
    for (const suggestion of emailSuggestions.slice(0, remaining)) {
      try {
        // Load full opportunity data
        const oppResult = await db.query(
          'SELECT * FROM opportunities WHERE id = $1 AND user_id = $2',
          [suggestion.contactId, userId]
        );
        const opp = oppResult.rows[0];
        if (!opp || !opp.email) { report.skipped++; continue; }

        // Skip if recently emailed
        if (recentlyEmailed.has(opp.email.toLowerCase())) { report.skipped++; continue; }

        // Skip if deal value exceeds threshold
        if (chainCfg.exclude_above_value && opp.deal_value > chainCfg.exclude_above_value) {
          report.skipped++;
          continue;
        }

        // Step 4: Generate contextual email using Deal Coach suggestion + Copy patterns + Timing
        const prompt = `Generate a personal reactivation email for a stagnant deal.

CONTEXT:
- Contact: ${opp.name} (${opp.title || 'N/A'}) at ${opp.company || 'N/A'}
- Deal stagnant for ${suggestion.daysSinceUpdate || '14+'} days
- Churn score: ${opp.churn_score || 'N/A'}/100
- Deal Coach suggestion: "${suggestion.suggestion}"
- Reason: ${suggestion.reason}

${copyCtx ? `COPY PATTERNS THAT WORK:\n${copyCtx}` : ''}
${patternCtx.text ? `\nMEMORY PATTERNS:\n${patternCtx.text}` : ''}
${timing.bestDay ? `\nBEST SEND TIMING: ${timing.bestDay}${timing.bestHour != null ? ` at ${timing.bestHour}h` : ''}` : ''}

RULES:
- Max 6 lines, must sound human and personal (NOT marketing)
- Incorporate the Deal Coach suggestion naturally
- Tone: professional but warm
- The goal is to re-engage, not to sell aggressively

Return JSON: { "subject": "...", "body": "..." }`;

        const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'chain_deal_reactivation');
        let email = result.parsed;
        if (!email) {
          const m = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
          if (m) email = JSON.parse(m[0]);
        }
        if (!email?.subject || !email?.body) { report.errors.push(`${opp.name}: failed to generate email`); continue; }

        // Step 5: Execute or queue for approval
        if (chainCfg.approval_required) {
          // Queue as pending — user sees it in nurture dashboard
          await db.query(
            `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, to_name, subject, body, status, pattern_ids, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
            [userId, opp.id, opp.email, opp.name, email.subject, email.body, patternCtx.ids,
             JSON.stringify({ chain: 'deal_reactivation', deal_coach_action: suggestion.action, urgency: suggestion.urgency })]
          );
          await logChainExecution(userId, 'deal_reactivation', 'deal_coach', suggestion, ['coach', 'copy', 'timing', 'generate'], { email: email.subject, contact: opp.name }, 'pending');
          report.pending++;
        } else {
          // Auto-send
          const sendResult = await sendNurtureEmail(userId, {
            opportunityId: opp.id,
            to: opp.email,
            toName: opp.name,
            subject: email.subject,
            body: email.body,
            crmProvider,
            patternIds: patternCtx.ids,
          });
          if (sendResult.success) {
            await logChainExecution(userId, 'deal_reactivation', 'deal_coach', suggestion, ['coach', 'copy', 'timing', 'generate', 'send'], { email: email.subject, contact: opp.name, emailId: sendResult.emailId }, 'executed');
            report.executed++;
          } else {
            await logChainExecution(userId, 'deal_reactivation', 'deal_coach', suggestion, ['coach', 'copy', 'timing', 'generate'], { error: sendResult.error }, 'failed');
            report.errors.push(`${opp.name}: ${sendResult.error}`);
          }
        }
      } catch (err) {
        report.errors.push(`${suggestion.contactName}: ${err.message}`);
      }
    }

    // Notify user
    if (report.executed > 0 || report.pending > 0) {
      await createNotification(userId, {
        type: 'info',
        title: `Deal Reactivation: ${report.executed} sent, ${report.pending} pending`,
        body: `Auto-chain detected ${emailSuggestions.length} stagnant deals with email action. ${report.executed} emails sent, ${report.pending} awaiting approval.`,
        metadata: { chain: 'deal_reactivation', ...report },
      });
    }

  } catch (err) {
    report.errors.push(err.message);
    logger.error('agent-chains', `deal_reactivation failed for ${userId}: ${err.message}`);
  }

  return report;
}

// ═══════════════════════════════════════════════════════════════
// CHAIN 2: Auto-Upsell
// ═══════════════════════════════════════════════════════════════

async function runAutoUpsell(userId) {
  const config = await getChainConfig(userId);
  const chainCfg = typeof config.auto_upsell === 'string'
    ? JSON.parse(config.auto_upsell) : config.auto_upsell;

  if (!chainCfg.enabled) return { skipped: true, reason: 'disabled' };

  const todayCount = await countTodayExecutions(userId, 'auto_upsell');
  if (todayCount >= chainCfg.max_per_day) return { skipped: true, reason: 'daily_limit_reached', count: todayCount };

  const remaining = chainCfg.max_per_day - todayCount;
  const report = { chain: 'auto_upsell', executed: 0, pending: 0, skipped: 0, errors: [] };

  try {
    // Step 1: Run Upsell Detector
    const upsellDetector = require('./agents/upsell-detector');
    const upsellReport = await upsellDetector.run(userId);

    if (!upsellReport.opportunities || upsellReport.opportunities.length === 0) {
      return { ...report, skipped: true, reason: 'no_upsell_opportunities' };
    }

    // Filter by minimum score threshold
    const qualified = upsellReport.opportunities.filter(o => o.score >= (chainCfg.min_score || 50));
    if (qualified.length === 0) {
      return { ...report, skipped: true, reason: 'no_opportunities_above_threshold' };
    }

    // Step 2: Get enrichment context
    const [recentlyEmailed, timing, copyCtx, teamId] = await Promise.all([
      getRecentlyEmailed(userId),
      getTimingContext(userId),
      getCopyContext(userId),
      getTeamId(userId),
    ]);
    const patternCtx = await getPatternContext(teamId);
    const crmProvider = await getCrmProvider(userId);

    // Load product lines for cross-sell context
    let productLines = [];
    try {
      const plResult = await db.query(
        `SELECT pl.id, pl.name, pl.description FROM product_lines pl
         WHERE pl.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)`,
        [userId]
      );
      productLines = plResult.rows;
    } catch { /* no product lines */ }

    // Step 3: For each qualified opportunity, generate upsell email
    for (const opportunity of qualified.slice(0, remaining)) {
      try {
        // Load full opportunity
        const oppResult = await db.query(
          'SELECT * FROM opportunities WHERE id = $1 AND user_id = $2',
          [opportunity.contactId, userId]
        );
        const opp = oppResult.rows[0];
        if (!opp || !opp.email) { report.skipped++; continue; }
        if (recentlyEmailed.has(opp.email.toLowerCase())) { report.skipped++; continue; }

        // Determine cross-sell products
        const assignedPLIds = new Set();
        try {
          const assigns = await db.query(
            'SELECT product_line_id FROM opportunity_product_lines WHERE opportunity_id = $1',
            [opp.id]
          );
          assigns.rows.forEach(r => assignedPLIds.add(r.product_line_id));
        } catch { /* ok */ }
        const unassignedPLs = productLines.filter(pl => !assignedPLIds.has(pl.id));
        const crossSellContext = unassignedPLs.length > 0
          ? `Cross-sell products available: ${unassignedPLs.map(pl => `${pl.name} (${pl.description || ''})`).join(', ')}`
          : '';

        // Step 4: Generate upsell email
        const prompt = `Generate a personal upsell/cross-sell email for an existing client.

CONTEXT:
- Contact: ${opp.name} (${opp.title || 'N/A'}) at ${opp.company || 'N/A'}
- Client since: won deal
- Upsell score: ${opportunity.score}/100
- Reasons: ${opportunity.reasons.join(', ')}
${crossSellContext ? `- ${crossSellContext}` : ''}

${copyCtx ? `COPY PATTERNS THAT WORK:\n${copyCtx}` : ''}
${patternCtx.text ? `\nMEMORY PATTERNS:\n${patternCtx.text}` : ''}

RULES:
- Max 6 lines, must sound human and personal
- Start by acknowledging the existing relationship (they are a client)
- Naturally introduce the upsell/cross-sell value proposition
- Tone: appreciative, not pushy — this is a valued client
- Do NOT mention scores or automated systems

Return JSON: { "subject": "...", "body": "..." }`;

        const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'chain_auto_upsell');
        let email = result.parsed;
        if (!email) {
          const m = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
          if (m) email = JSON.parse(m[0]);
        }
        if (!email?.subject || !email?.body) { report.errors.push(`${opp.name}: failed to generate email`); continue; }

        if (chainCfg.approval_required) {
          await db.query(
            `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, to_name, subject, body, status, pattern_ids, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
            [userId, opp.id, opp.email, opp.name, email.subject, email.body, patternCtx.ids,
             JSON.stringify({ chain: 'auto_upsell', upsell_score: opportunity.score, reasons: opportunity.reasons, cross_sell_products: unassignedPLs.map(pl => pl.name) })]
          );
          await logChainExecution(userId, 'auto_upsell', 'upsell_detector', opportunity, ['detect', 'copy', 'timing', 'generate'], { email: email.subject, contact: opp.name, score: opportunity.score }, 'pending');
          report.pending++;
        } else {
          const sendResult = await sendNurtureEmail(userId, {
            opportunityId: opp.id,
            to: opp.email,
            toName: opp.name,
            subject: email.subject,
            body: email.body,
            crmProvider,
            patternIds: patternCtx.ids,
          });
          if (sendResult.success) {
            await logChainExecution(userId, 'auto_upsell', 'upsell_detector', opportunity, ['detect', 'copy', 'timing', 'generate', 'send'], { email: email.subject, contact: opp.name, emailId: sendResult.emailId, score: opportunity.score }, 'executed');
            report.executed++;
          } else {
            await logChainExecution(userId, 'auto_upsell', 'upsell_detector', opportunity, ['detect', 'copy', 'timing', 'generate'], { error: sendResult.error }, 'failed');
            report.errors.push(`${opp.name}: ${sendResult.error}`);
          }
        }
      } catch (err) {
        report.errors.push(`${opportunity.name}: ${err.message}`);
      }
    }

    // Notify user
    if (report.executed > 0 || report.pending > 0) {
      await createNotification(userId, {
        type: 'info',
        title: `Auto-Upsell: ${report.executed} sent, ${report.pending} pending`,
        body: `Detected ${qualified.length} upsell-ready clients (score >= ${chainCfg.min_score}). ${report.executed} emails sent, ${report.pending} awaiting approval.`,
        metadata: { chain: 'auto_upsell', ...report },
      });
    }

  } catch (err) {
    report.errors.push(err.message);
    logger.error('agent-chains', `auto_upsell failed for ${userId}: ${err.message}`);
  }

  return report;
}

// ═══════════════════════════════════════════════════════════════
// Run all chains for all users
// ═══════════════════════════════════════════════════════════════

async function runAllChains() {
  const users = await db.query('SELECT id FROM users WHERE onboarding_complete = true');
  const results = [];

  for (const { id: userId } of users.rows) {
    try {
      const [reactivation, upsell] = await Promise.all([
        runDealReactivation(userId).catch(err => ({ error: err.message })),
        runAutoUpsell(userId).catch(err => ({ error: err.message })),
      ]);
      results.push({ userId: userId.slice(0, 8), reactivation, upsell });
    } catch (err) {
      logger.error('agent-chains', `Chains failed for ${userId}: ${err.message}`);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// Approve pending chain executions (called from API)
// ═══════════════════════════════════════════════════════════════

async function approvePendingExecution(executionId, userId) {
  const exec = await db.query(
    'SELECT * FROM agent_chain_executions WHERE id = $1 AND user_id = $2 AND status = $3',
    [executionId, userId, 'pending']
  );
  if (!exec.rows[0]) return { error: 'Not found or already processed' };

  // The pending nurture_email associated with this chain is already in the DB.
  // We just update the chain status — the nurture send is triggered by user action in UI.
  await db.query(
    `UPDATE agent_chain_executions SET status = 'approved', executed_at = now() WHERE id = $1`,
    [executionId]
  );

  return { success: true };
}

module.exports = {
  runDealReactivation,
  runAutoUpsell,
  runAllChains,
  getChainConfig,
  approvePendingExecution,
};
