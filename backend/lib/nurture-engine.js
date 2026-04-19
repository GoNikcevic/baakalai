/**
 * Nurture Trigger Engine
 *
 * Evaluates CRM conditions and triggers personalized emails.
 * Runs as a cron job (daily) or on-demand.
 *
 * Supported triggers:
 * - deal_won: deal status changed to won → welcome/onboarding email
 * - deal_stagnant: deal not updated in X days → follow-up email
 * - inactive_contact: no activity in X days → re-engagement email
 * - renewal: X days before/after a date field → renewal reminder
 * - custom: arbitrary conditions on contact/deal fields
 */

const db = require('../db');
const { getUserKey } = require('../config');
const pipedrive = require('../api/pipedrive');
const claude = require('../api/claude');
const { sendNurtureEmail } = require('./email-outbound');
const logger = require('./logger');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Evaluate all enabled triggers for a user.
 * Returns array of { trigger, contacts[] } that matched.
 */
async function evaluateTriggers(userId) {
  const triggers = await db.query(
    `SELECT * FROM nurture_triggers WHERE user_id = $1 AND enabled = true`,
    [userId]
  );

  if (triggers.rows.length === 0) return [];

  // Get CRM token
  const crmProvider = triggers.rows[0].crm_provider || 'pipedrive';
  const crmToken = await getUserKey(userId, crmProvider);
  if (!crmToken) return [];

  // Get CRM data
  let contacts = [];
  let deals = [];
  if (crmProvider === 'pipedrive') {
    contacts = await pipedrive.listAllPersons(crmToken);
    deals = await pipedrive.getDeals(crmToken, 500);
  }

  const results = [];

  for (const trigger of triggers.rows) {
    const conditions = trigger.conditions || {};
    const matched = [];

    switch (trigger.trigger_type) {
      case 'deal_won': {
        const wonDeals = deals.filter(d => d.status === 'won');
        const days = conditions.days || 1;
        for (const deal of wonDeals) {
          const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;
          if (dealAge <= days + 1 && dealAge >= days - 1) {
            const contact = contacts.find(c => c.id === deal.personId);
            if (contact) matched.push(normalizeContact(contact, deal));
          }
        }
        break;
      }

      case 'deal_stagnant': {
        const days = conditions.days || 30;
        const openDeals = deals.filter(d => d.status === 'open');
        for (const deal of openDeals) {
          const lastUpdate = new Date(deal.createdAt).getTime(); // TODO: use update_time
          if ((Date.now() - lastUpdate) / DAY_MS >= days) {
            const contact = contacts.find(c => c.id === deal.personId);
            if (contact) matched.push(normalizeContact(contact, deal));
          }
        }
        break;
      }

      case 'inactive_contact': {
        const days = conditions.days || 60;
        const now = Date.now();
        for (const c of contacts) {
          const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;
          if (lastUpdate > 0 && (now - lastUpdate) / DAY_MS >= days) {
            matched.push(normalizeContact(c));
          }
        }
        break;
      }

      case 'renewal': {
        // TODO: needs custom field mapping for renewal date
        break;
      }

      default:
        break;
    }

    // Filter out contacts we already emailed for this trigger recently
    if (matched.length > 0) {
      const recentEmails = await db.query(
        `SELECT to_email FROM nurture_emails WHERE trigger_id = $1 AND created_at > now() - interval '7 days'`,
        [trigger.id]
      );
      const recentSet = new Set(recentEmails.rows.map(r => r.to_email?.toLowerCase()));
      const filtered = matched.filter(m => m.email && !recentSet.has(m.email.toLowerCase()));

      if (filtered.length > 0) {
        results.push({ trigger, contacts: filtered });
      }
    }
  }

  return results;
}

function normalizeContact(raw, deal = null) {
  const email = Array.isArray(raw.email)
    ? (raw.email.find(e => e.primary)?.value || raw.email[0]?.value || null)
    : (raw.email || null);
  return {
    id: raw.id,
    name: raw.name || '',
    email,
    title: raw.job_title || '',
    company: raw.org_name || raw.org_id?.name || '',
    dealName: deal?.name || null,
    dealStage: deal?.stage || null,
    dealStatus: deal?.status || null,
  };
}

/**
 * Generate a personalized email for a contact using Claude.
 */
async function generateEmail(trigger, contact) {
  const template = trigger.email_template || {};
  const prompt = `Tu es un commercial B2B. Génère un email professionnel et personnel (PAS un email marketing).

Contexte :
- Destinataire : ${contact.name} (${contact.title}) chez ${contact.company}
- Email : ${contact.email}
- Trigger : ${trigger.trigger_type} — ${trigger.name}
${contact.dealName ? `- Deal : ${contact.dealName} (${contact.dealStatus})` : ''}
${template.context ? `- Contexte additionnel : ${template.context}` : ''}

Instructions :
- Ton : ${template.tone || 'professionnel mais chaleureux'}
- L'email doit sembler écrit par un humain, pas généré
- Pas de template marketing, pas de header/footer fancy
- Maximum 6 lignes
- Tutoiement : ${template.formality === 'tu' ? 'oui' : 'non, vouvoyer'}

Retourne un JSON : { "subject": "...", "body": "..." }`;

  const result = await claude.callClaude(
    'Tu génères des emails de suivi client. Retourne uniquement du JSON valide.',
    prompt,
    500
  );

  if (result.parsed) return result.parsed;

  // Fallback: try to extract JSON from the response
  const text = result.content || '';
  const jsonMatch = text.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
  }

  return {
    subject: `Suivi — ${contact.company}`,
    body: `Bonjour ${contact.name.split(' ')[0]},\n\nJe me permets de revenir vers vous concernant notre échange.\n\nBien cordialement`,
  };
}

/**
 * Run the nurture engine for a user.
 * Evaluates triggers → generates emails → sends (or queues for approval).
 */
async function runNurtureEngine(userId) {
  const matches = await evaluateTriggers(userId);
  const results = { triggered: 0, sent: 0, queued: 0, errors: [] };

  for (const { trigger, contacts } of matches) {
    for (const contact of contacts) {
      try {
        results.triggered++;

        // Generate personalized email
        const { subject, body } = await generateEmail(trigger, contact);

        // Find opportunity in Baakalai DB
        const opp = await db.opportunities.findByEmail(userId, contact.email);

        if (trigger.mode === 'auto') {
          // Send immediately
          const sendResult = await sendNurtureEmail(userId, {
            triggerId: trigger.id,
            opportunityId: opp?.id || null,
            to: contact.email,
            toName: contact.name,
            subject,
            body,
            crmProvider: trigger.crm_provider || 'pipedrive',
          });

          if (sendResult.success) {
            results.sent++;
          } else {
            results.errors.push({ contact: contact.name, error: sendResult.error });
          }
        } else {
          // Queue for approval
          await db.query(`
            INSERT INTO nurture_emails (user_id, trigger_id, opportunity_id, to_email, to_name, subject, body, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
          `, [userId, trigger.id, opp?.id || null, contact.email, contact.name, subject, body]);
          results.queued++;
        }
      } catch (err) {
        results.errors.push({ contact: contact.name, error: err.message });
        logger.error('nurture-engine', `Failed for ${contact.name}: ${err.message}`);
      }
    }

    // Update last_run
    await db.query(
      `UPDATE nurture_triggers SET last_run = now() WHERE id = $1`,
      [trigger.id]
    );
  }

  logger.info('nurture-engine', `User ${userId}: ${results.triggered} triggered, ${results.sent} sent, ${results.queued} queued`);
  return results;
}

/**
 * Run nurture engine for ALL users with enabled triggers.
 * Called by the orchestrator cron.
 */
async function runAllNurture() {
  const users = await db.query(
    `SELECT DISTINCT user_id FROM nurture_triggers WHERE enabled = true`
  );

  const allResults = [];
  for (const { user_id } of users.rows) {
    try {
      const result = await runNurtureEngine(user_id);
      allResults.push({ userId: user_id, ...result });
    } catch (err) {
      logger.error('nurture-engine', `Failed for user ${user_id}: ${err.message}`);
      allResults.push({ userId: user_id, error: err.message });
    }
  }

  return allResults;
}

module.exports = { evaluateTriggers, generateEmail, runNurtureEngine, runAllNurture };
