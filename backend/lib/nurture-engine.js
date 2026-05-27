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
const linkedin = require('../api/linkedin');
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

  // Get CRM data (multi-provider)
  let contacts = [];
  let deals = [];
  if (crmProvider === 'pipedrive') {
    contacts = await pipedrive.listAllPersons(crmToken);
    deals = await pipedrive.getDeals(crmToken, 500);
  } else if (crmProvider === 'salesforce') {
    const sf = require('../api/salesforce');
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [userId]
    );
    const instanceUrl = integration.rows[0]?.instance_url || 'https://login.salesforce.com';
    contacts = await sf.listContacts(instanceUrl, crmToken);
    deals = await sf.getDeals(instanceUrl, crmToken);
  } else if (crmProvider === 'hubspot') {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=500&properties=email,firstname,lastname,jobtitle,company', {
      headers: { Authorization: `Bearer ${crmToken}` },
    });
    if (res.ok) { const d = await res.json(); contacts = (d.results || []).map(c => ({ id: c.id, name: `${c.properties?.firstname || ''} ${c.properties?.lastname || ''}`.trim(), email: c.properties?.email, job_title: c.properties?.jobtitle, org_name: c.properties?.company })); }
  } else if (crmProvider === 'odoo') {
    const odoo = require('../api/odoo');
    contacts = await odoo.listAllContacts(crmToken);
    deals = await odoo.getDeals(crmToken);
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
          const lastUpdate = new Date(deal.updatedAt || deal.createdAt).getTime();
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
        const daysBefore = conditions.days || 30;
        const now = Date.now();
        // Load opportunities with renewal_date set
        const oppsWithRenewal = await db.query(
          `SELECT o.* FROM opportunities o WHERE o.user_id = (SELECT user_id FROM nurture_triggers WHERE id = $1) AND o.renewal_date IS NOT NULL AND o.status != 'lost'`,
          [trigger.id]
        );
        for (const o of (oppsWithRenewal.rows || [])) {
          const renewalTime = new Date(o.renewal_date).getTime();
          const daysUntilRenewal = (renewalTime - now) / DAY_MS;
          // Match if within window: X days before to 7 days after
          if (daysUntilRenewal <= daysBefore && daysUntilRenewal >= -7) {
            const contact = contacts.find(c => c.id === o.crm_contact_id);
            if (contact) matched.push(normalizeContact(contact, { name: o.company, status: 'open' }));
            else matched.push({ id: o.id, name: o.name, email: o.email, title: o.title || '', company: o.company || '', dealName: null, dealStage: null, dealStatus: 'renewal' });
          }
        }
        break;
      }

      case 'newsletter_inactive': {
        // Contacts who received newsletters (via Fonteva/Salesforce) but never opened/replied
        if (crmProvider !== 'salesforce') break;
        const sf = require('../api/salesforce');
        const integration = await db.query(
          `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [userId]
        );
        const instanceUrl = integration.rows[0]?.instance_url;
        if (!instanceUrl) break;

        const days = conditions.days || 30;
        const since = `LAST_N_DAYS:${days}`;
        try {
          const emails = await sf.getEmailMessages(instanceUrl, crmToken, { since, limit: 500 });
          // Group by recipient — find those with only status 0 (New) or 3 (Sent), never 1 (Read) or 2 (Replied)
          const byRecipient = {};
          for (const e of emails) {
            const to = e.to?.toLowerCase();
            if (!to) continue;
            if (!byRecipient[to]) byRecipient[to] = { hasOpened: false, hasSent: false };
            if (e.status === '0' || e.status === '3') byRecipient[to].hasSent = true;
            if (e.status === '1' || e.status === '2' || e.status === '4') byRecipient[to].hasOpened = true;
          }
          for (const [email, data] of Object.entries(byRecipient)) {
            if (data.hasSent && !data.hasOpened) {
              const contact = contacts.find(c => c.email?.toLowerCase() === email);
              if (contact) matched.push(normalizeContact(contact));
            }
          }
        } catch (err) {
          logger.warn('nurture-engine', `newsletter_inactive failed: ${err.message}`);
        }
        break;
      }

      case 'newsletter_engaged': {
        // Contacts who actively engaged with newsletters (replied/forwarded) — notify sales or start sequence
        if (crmProvider !== 'salesforce') break;
        const sfE = require('../api/salesforce');
        const integE = await db.query(
          `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [userId]
        );
        const instanceUrlE = integE.rows[0]?.instance_url;
        if (!instanceUrlE) break;

        const daysE = conditions.days || 30;
        const minEngagements = conditions.min_engagements || 2;
        try {
          const emails = await sfE.getEmailMessages(instanceUrlE, crmToken, { since: `LAST_N_DAYS:${daysE}`, limit: 500 });
          // Count engagements (read + replied + forwarded) per recipient
          const engagements = {};
          for (const e of emails) {
            const to = e.to?.toLowerCase();
            if (!to) continue;
            if (e.status === '1' || e.status === '2' || e.status === '4') {
              engagements[to] = (engagements[to] || 0) + 1;
            }
          }
          for (const [email, count] of Object.entries(engagements)) {
            if (count >= minEngagements) {
              const contact = contacts.find(c => c.email?.toLowerCase() === email);
              if (contact) matched.push(normalizeContact(contact));
            }
          }
        } catch (err) {
          logger.warn('nurture-engine', `newsletter_engaged failed: ${err.message}`);
        }
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
 * Generate a personalized LinkedIn message or connection note via Claude.
 */
async function generateLinkedInContent(trigger, contact, actionType) {
  const template = trigger.email_template || {};
  const isConnect = actionType === 'linkedin_connect';
  const maxChars = isConnect ? 280 : 600;

  const prompt = isConnect
    ? `Tu es un commercial B2B. Génère une note de connexion LinkedIn courte et personnalisée (max 280 caractères).

Contexte :
- Destinataire : ${contact.name} (${contact.title}) chez ${contact.company}
- Trigger : ${trigger.trigger_type} — ${trigger.name}
${contact.dealName ? `- Deal : ${contact.dealName} (${contact.dealStatus})` : ''}
${template.context ? `- Contexte : ${template.context}` : ''}

Instructions :
- Ton naturel, pas commercial
- Référencer le contexte business de manière subtile
- Finir par une ouverture (curiosité ou valeur)
- Max 280 caractères

Retourne un JSON : { "note": "..." }`
    : `Tu es un commercial B2B. Génère un message LinkedIn personnalisé (3-4 phrases max).

Contexte :
- Destinataire : ${contact.name} (${contact.title}) chez ${contact.company}
- Trigger : ${trigger.trigger_type} — ${trigger.name}
${contact.dealName ? `- Deal : ${contact.dealName} (${contact.dealStatus})` : ''}
${template.context ? `- Contexte : ${template.context}` : ''}

Instructions :
- Ton : ${template.tone || 'professionnel mais chaleureux'}
- Message court et naturel, pas de pitch
- Proposer une valeur concrète ou poser une question pertinente
- ${template.formality === 'tu' ? 'Tutoyer' : 'Vouvoyer'}

Retourne un JSON : { "message": "..." }`;

  const result = await claude.callClaude(
    'Retourne uniquement du JSON valide.',
    prompt,
    isConnect ? 300 : 500,
    'nurture_linkedin'
  );

  if (isConnect) {
    const note = result.parsed?.note
      || (result.content || '').match(/"note"\s*:\s*"([^"]+)"/)?.[1]
      || `Bonjour ${contact.name.split(' ')[0]}, votre profil a retenu mon attention.`;
    return { note: note.slice(0, maxChars) };
  }

  const message = result.parsed?.message
    || (result.content || '').match(/"message"\s*:\s*"([^"]+)"/)?.[1]
    || `Bonjour ${contact.name.split(' ')[0]}, je me permets de vous contacter suite à notre échange.`;
  return { message: message.slice(0, maxChars) };
}

/**
 * Execute a LinkedIn action (connect, message, visit) for a nurture contact.
 * Logs to prospect_activities for memory/learning.
 */
async function executeLinkedInAction(userId, trigger, contact, actionType) {
  const cookie = await getUserKey(userId, 'linkedin');
  if (!cookie) throw new Error('LinkedIn not connected');

  // Find LinkedIn URL from opportunity or contact
  const opp = await db.opportunities.findByEmail(userId, contact.email);
  const linkedinUrl = opp?.linkedin_url || contact.linkedin_url;
  if (!linkedinUrl && actionType !== 'linkedin_visit') {
    throw new Error('No LinkedIn URL for contact');
  }

  const publicId = linkedinUrl ? linkedinUrl.match(/\/in\/([^/?]+)/)?.[1] : null;

  let content = {};

  if (actionType === 'linkedin_visit' && publicId) {
    await linkedin.getProfile(cookie, publicId);
    content = { action: 'visit' };
  } else if (actionType === 'linkedin_connect' && publicId) {
    const { note } = await generateLinkedInContent(trigger, contact, 'linkedin_connect');
    await linkedin.sendConnectionRequest(cookie, { profileUrn: publicId, message: note }, userId);
    content = { action: 'connect', note };
  } else if (actionType === 'linkedin_message' && publicId) {
    const { message } = await generateLinkedInContent(trigger, contact, 'linkedin_message');
    await linkedin.sendMessage(cookie, { recipientUrn: publicId, message }, userId);
    content = { action: 'message', message };
  } else {
    throw new Error(`Cannot execute ${actionType}: missing LinkedIn profile ID`);
  }

  // Log in nurture_emails for tracking/UI consistency
  await db.query(`
    INSERT INTO nurture_emails (user_id, trigger_id, opportunity_id, to_email, to_name, subject, body, status, action_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', $8)
  `, [
    userId, trigger.id, opp?.id || null, contact.email, contact.name,
    actionType.replace('linkedin_', 'LinkedIn '),
    JSON.stringify(content),
    actionType,
  ]);

  // Log in prospect_activities for memory & learning
  const activityType = actionType === 'linkedin_connect' ? 'linkedin_connect_sent'
    : actionType === 'linkedin_message' ? 'linkedin_message_sent'
    : 'linkedin_visit';

  await db.query(`
    INSERT INTO prospect_activities (user_id, lead_email, type, content, source, created_at)
    VALUES ($1, $2, $3, $4, 'nurture_linkedin', now())
  `, [userId, contact.email, activityType, JSON.stringify(content)]);

  return { success: true, actionType, contact: contact.name };
}

/**
 * Run the nurture engine for a user.
 * Evaluates triggers → generates emails/LinkedIn actions → sends (or queues).
 */
async function runNurtureEngine(userId) {
  const matches = await evaluateTriggers(userId);
  const results = { triggered: 0, sent: 0, queued: 0, errors: [] };

  for (const { trigger, contacts } of matches) {
    // Determine action type: email (default), linkedin_connect, linkedin_message, linkedin_visit
    const actionType = trigger.action_type || 'email';
    const isLinkedIn = actionType.startsWith('linkedin_');

    for (const contact of contacts) {
      try {
        results.triggered++;

        if (isLinkedIn) {
          // Execute LinkedIn action
          const result = await executeLinkedInAction(userId, trigger, contact, actionType);
          if (result.success) results.sent++;
        } else {
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
              INSERT INTO nurture_emails (user_id, trigger_id, opportunity_id, to_email, to_name, subject, body, status, pattern_ids)
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
            `, [userId, trigger.id, opp?.id || null, contact.email, contact.name, subject, body, []]);
            results.queued++;
          }
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

module.exports = { evaluateTriggers, generateEmail, generateLinkedInContent, executeLinkedInAction, runNurtureEngine, runAllNurture };
