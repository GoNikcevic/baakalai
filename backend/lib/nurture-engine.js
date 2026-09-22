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
const { getUserCrmToken } = require('./crm-token');
const pipedrive = require('../api/pipedrive');
const claude = require('../api/claude');
const linkedin = require('../api/linkedin');
const { sendNurtureEmail } = require('./email-outbound');
const { getPatternContext, getTeamId } = require('./email-context');
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

  // Get CRM token · always use user's active_crm_provider
  const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [userId]);
  const crmProvider = userRow.rows[0]?.active_crm_provider || 'pipedrive';
  const crmToken = await getUserCrmToken(userId, crmProvider);
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
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) throw new Error('Salesforce instance URL not configured');
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
  // Partagé par les triggers newsletter sur un même run.
  const sfEmailActivityCache = new Map();

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

      // 'renewal_reminder' est le nom écrit par l'UI et le cron (crm-agent) ;
      // 'renewal' est l'ancien nom · les deux doivent matcher ici, sinon le
      // run manuel ignore silencieusement les triggers créés depuis l'UI.
      case 'renewal':
      case 'renewal_reminder': {
        const daysBefore = conditions.days || 30;
        const now = Date.now();
        // Load opportunities with renewal_date set
        const oppsWithRenewal = await db.query(
          `SELECT o.* FROM opportunities o
            WHERE o.user_id = (SELECT user_id FROM nurture_triggers WHERE id = $1)
              AND o.campaign_id IS NULL
              AND o.renewal_date IS NOT NULL AND o.status != 'lost'`,
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

      case 'churn_risk': {
        // Comme renewal_reminder : l'information vit dans notre base (le score
        // est calculé chez nous), pas dans le CRM. Même fenêtre que le cron
        // (lib/trigger-matching.js) pour que les deux chemins voient la même
        // population : signalés entre J+days et J+days+7.
        const { AT_RISK_THRESHOLD } = require('./churn-scoring');
        const days = conditions.days || 0;
        const atRisk = await db.query(
          `SELECT o.* FROM opportunities o
            WHERE o.user_id = (SELECT user_id FROM nurture_triggers WHERE id = $1)
              AND o.campaign_id IS NULL
              AND o.status = 'won'
              AND o.churn_score >= $2
              AND o.churn_flagged_at IS NOT NULL
              AND o.churn_flagged_at <= now() - ($3::int * INTERVAL '1 day')
              AND o.churn_flagged_at > now() - (($3::int + 7) * INTERVAL '1 day')`,
          [trigger.id, AT_RISK_THRESHOLD, days]
        );
        for (const o of (atRisk.rows || [])) {
          const contact = contacts.find(c => c.id === o.crm_contact_id);
          if (contact) matched.push(normalizeContact(contact, { name: o.company, status: 'won' }));
          else matched.push({ id: o.id, name: o.name, email: o.email, title: o.title || '', company: o.company || '', dealName: null, dealStage: null, dealStatus: 'churn_risk' });
        }
        break;
      }

      case 'newsletter_inactive': {
        // Contacts à qui l'org a envoyé des emails suivis et qui ne les ont ni
        // ouverts ni répondus. Sans suivi d'ouverture, l'information n'existe
        // pas : on ne déclenche rien plutôt que de relancer toute la base.
        if (crmProvider !== 'salesforce') break;
        try {
          const activity = await loadSalesforceEmailActivity(userId, crmToken, conditions.days || 30, sfEmailActivityCache);
          if (!activity) break;
          if (!activity.trackingAvailable || activity.trackedCount === 0) {
            logger.warn('nurture-engine', `newsletter_inactive ignoré : le suivi d'ouverture n'est pas actif dans l'org Salesforce (${activity.trackedCount} email suivi sur la période)`);
            break;
          }
          if (activity.truncated) {
            logger.warn('nurture-engine', 'newsletter_inactive ignoré : volume d\'emails au-dessus du plafond, une ouverture a pu être coupée');
            break;
          }
          for (const [email, data] of activity.byContact) {
            if (data.trackedSent > 0 && !data.engaged) {
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
        // Contacts qui ont ouvert ou répondu · alerter le commercial.
        if (crmProvider !== 'salesforce') break;
        const minEngagements = conditions.min_engagements || 2;
        try {
          const activity = await loadSalesforceEmailActivity(userId, crmToken, conditions.days || 30, sfEmailActivityCache);
          if (!activity) break;
          for (const [email, data] of activity.byContact) {
            if (data.opens + data.replies >= minEngagements) {
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

/**
 * Activité email d'une org Salesforce sur les N derniers jours, agrégée par
 * contact. L'ouverture vient des champs de suivi (Enhanced Email) : le champ
 * Status ne la mesure pas, il décrit l'état du message côté Salesforce.
 * @returns {Promise<{byContact: Map, trackedCount: number, trackingAvailable: boolean, truncated: boolean}|null>}
 */
async function loadSalesforceEmailActivity(userId, crmToken, days, cache) {
  const window = Math.max(1, parseInt(days, 10) || 30);
  // Les deux triggers newsletter tombent sur la même fenêtre : on ne rapatrie
  // pas deux fois les mêmes milliers d'emails dans un run.
  if (cache?.has(window)) return cache.get(window);
  const loading = loadSalesforceEmailActivityUncached(userId, crmToken, window);
  cache?.set(window, loading);
  return loading;
}

async function loadSalesforceEmailActivityUncached(userId, crmToken, window) {
  const sf = require('../api/salesforce');
  const integration = await db.query(
    `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [userId]
  );
  const instanceUrl = integration.rows[0]?.instance_url;
  if (!instanceUrl) return null;

  const { messages, trackingAvailable, truncated } = await sf.getEmailMessages(instanceUrl, crmToken, {
    since: `LAST_N_DAYS:${window}`,
    limit: 10000,
    paginate: true,
  });

  const byContact = new Map();
  let trackedCount = 0;
  const touch = (address) => {
    const key = String(address || '').trim().toLowerCase();
    if (!key) return null;
    if (!byContact.has(key)) byContact.set(key, { trackedSent: 0, opens: 0, replies: 0, engaged: false });
    return byContact.get(key);
  };

  for (const m of messages) {
    if (m.incoming) {
      // Un message entrant est une réponse du contact : engagement certain.
      const entry = touch(m.from);
      if (entry) { entry.replies++; entry.engaged = true; }
      continue;
    }
    if (m.isTracked) trackedCount++;
    for (const address of m.toAddresses) {
      const entry = touch(address);
      if (!entry) continue;
      if (m.isTracked) entry.trackedSent++;
      if (m.isOpened) { entry.opens++; entry.engaged = true; }
      if (m.status === '2' || m.status === '4') entry.engaged = true; // Replied / Forwarded
    }
  }

  return { byContact, trackedCount, trackingAvailable, truncated };
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
 * Format the memory-pattern block injected into generation prompts.
 * Même format que crm-agent (generateNurtureEmail) pour que les deux moteurs
 * apprennent de la même mémoire de la même façon.
 */
function buildPatternsBlock(patternCtx) {
  if (!patternCtx?.text) return '';
  return `\n\nPATTERNS QUI FONCTIONNENT (mémoire cross-campagne) :\n${patternCtx.text}\nApplique en priorité les patterns APPROUVÉS.`;
}

/**
 * Generate a personalized email for a contact using Claude.
 * `patternCtx` ({ text, ids } de getPatternContext) est optionnel · sans lui,
 * la génération reste possible mais n'exploite pas la mémoire.
 */
/**
 * Consigne d'intention propre à certains triggers. Sans elle, un déclencheur
 * « client à risque » produisait un email de suivi générique, quand ce n'est
 * pas un pitch : exactement ce qu'il ne faut pas envoyer à un client qui a un
 * pied dehors (même raison d'être que lib/agents/retention.js).
 */
function triggerIntent(triggerType) {
  if (triggerType !== 'churn_risk') return '';
  return `
- Intention : ce client montre des signes de désengagement. L'email sert à rouvrir le dialogue et à faire remonter le problème, rien d'autre.
- Ne vends RIEN : pas d'upsell, pas de nouvelle offre, pas de devis, pas de relance de renouvellement.
- Pose une question ouverte à laquelle il est facile de répondre honnêtement.
- Ne mentionne jamais un score, un signal détecté ou un système automatique.
- Ne culpabilise pas sur le silence.`;
}

async function generateEmail(trigger, contact, patternCtx = null) {
  const template = trigger.email_template || {};
  const prompt = `Tu es un commercial B2B. Génère un email professionnel et personnel (PAS un email marketing).

Contexte :
- Destinataire : ${contact.name} (${contact.title}) chez ${contact.company}
- Email : ${contact.email}
- Trigger : ${trigger.trigger_type}, ${trigger.name}
${contact.dealName ? `- Deal : ${contact.dealName} (${contact.dealStatus})` : ''}
${template.context ? `- Contexte additionnel : ${template.context}` : ''}

Instructions :
- Ton : ${template.tone || 'professionnel mais chaleureux'}
- L'email doit sembler écrit par un humain, pas généré
- Pas de template marketing, pas de header/footer fancy
- Maximum 6 lignes
- Tutoiement : ${template.formality === 'tu' ? 'oui' : 'non, vouvoyer'}${triggerIntent(trigger.trigger_type)}
${require('./human-style').HUMAN_STYLE_RULES_FR}${buildPatternsBlock(patternCtx)}

Retourne un JSON : { "subject": "...", "body": "..." }`;

  const result = await claude.callClaude(
    'Tu génères des emails de suivi client. Retourne uniquement du JSON valide.',
    prompt,
    500
  );

  const { humanizeFields } = require('./human-style');
  if (result.parsed) return humanizeFields(result.parsed, ['subject', 'body']);

  // Fallback: try to extract JSON from the response
  const text = result.raw || '';
  const jsonMatch = text.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
  if (jsonMatch) {
    try { return humanizeFields(JSON.parse(jsonMatch[0]), ['subject', 'body']); } catch { /* fall through */ }
  }

  return {
    subject: `Des nouvelles de ${contact.company}`,
    body: `Bonjour ${contact.name.split(' ')[0]},\n\nOù en êtes-vous de votre côté sur notre dernier échange ? Un mot suffit, je m'adapte.\n\nBien cordialement`,
  };
}

/**
 * Generate a personalized LinkedIn message or connection note via Claude.
 */
async function generateLinkedInContent(trigger, contact, actionType, patternCtx = null) {
  const template = trigger.email_template || {};
  const isConnect = actionType === 'linkedin_connect';
  const maxChars = isConnect ? 280 : 600;

  const prompt = isConnect
    ? `Tu es un commercial B2B. Génère une note de connexion LinkedIn courte et personnalisée (max 280 caractères).

Contexte :
- Destinataire : ${contact.name} (${contact.title}) chez ${contact.company}
- Trigger : ${trigger.trigger_type}, ${trigger.name}
${contact.dealName ? `- Deal : ${contact.dealName} (${contact.dealStatus})` : ''}
${template.context ? `- Contexte : ${template.context}` : ''}

Instructions :
- Ton naturel, pas commercial
- Référencer le contexte business de manière subtile
- Finir par une ouverture (curiosité ou valeur)
- Max 280 caractères
${require('./human-style').HUMAN_STYLE_RULES_FR}${buildPatternsBlock(patternCtx)}

Retourne un JSON : { "note": "..." }`
    : `Tu es un commercial B2B. Génère un message LinkedIn personnalisé (3-4 phrases max).

Contexte :
- Destinataire : ${contact.name} (${contact.title}) chez ${contact.company}
- Trigger : ${trigger.trigger_type}, ${trigger.name}
${contact.dealName ? `- Deal : ${contact.dealName} (${contact.dealStatus})` : ''}
${template.context ? `- Contexte : ${template.context}` : ''}

Instructions :
- Ton : ${template.tone || 'professionnel mais chaleureux'}
- Message court et naturel, pas de pitch
- Proposer une valeur concrète ou poser une question pertinente
- ${template.formality === 'tu' ? 'Tutoyer' : 'Vouvoyer'}
${require('./human-style').HUMAN_STYLE_RULES_FR}${buildPatternsBlock(patternCtx)}

Retourne un JSON : { "message": "..." }`;

  const result = await claude.callClaude(
    'Retourne uniquement du JSON valide.',
    prompt,
    isConnect ? 300 : 500,
    'nurture_linkedin'
  );

  const { humanize } = require('./human-style');
  if (isConnect) {
    const note = result.parsed?.note
      || (result.raw || '').match(/"note"\s*:\s*"([^"]+)"/)?.[1]
      || `Bonjour ${contact.name.split(' ')[0]}, votre profil a retenu mon attention.`;
    return { note: humanize(note).slice(0, maxChars) };
  }

  const message = result.parsed?.message
    || (result.raw || '').match(/"message"\s*:\s*"([^"]+)"/)?.[1]
    || `Bonjour ${contact.name.split(' ')[0]}, on avait échangé il y a quelque temps. Où en êtes-vous sur le sujet ?`;
  return { message: humanize(message).slice(0, maxChars) };
}

/**
 * Execute a LinkedIn action (connect, message, visit) for a nurture contact.
 * Logs to prospect_activities for memory/learning.
 */
async function executeLinkedInAction(userId, trigger, contact, actionType, patternCtx = null) {
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
    const { note } = await generateLinkedInContent(trigger, contact, 'linkedin_connect', patternCtx);
    await linkedin.sendConnectionRequest(cookie, { profileUrn: publicId, message: note }, userId);
    content = { action: 'connect', note };
  } else if (actionType === 'linkedin_message' && publicId) {
    const { message } = await generateLinkedInContent(trigger, contact, 'linkedin_message', patternCtx);
    await linkedin.sendMessage(cookie, { recipientUrn: publicId, message }, userId);
    content = { action: 'message', message };
  } else {
    throw new Error(`Cannot execute ${actionType}: missing LinkedIn profile ID`);
  }

  // Log in nurture_emails for tracking/UI consistency.
  // pattern_ids (migration 048) : seuls connect/message génèrent du copy à
  // partir de la mémoire · une simple visite n'utilise aucun pattern.
  const usedPatternIds = actionType === 'linkedin_visit' ? [] : (patternCtx?.ids || []);
  await db.query(`
    INSERT INTO nurture_emails (user_id, trigger_id, opportunity_id, to_email, to_name, subject, body, status, action_type, pattern_ids)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', $8, $9)
  `, [
    userId, trigger.id, opp?.id || null, contact.email, contact.name,
    actionType.replace('linkedin_', 'LinkedIn '),
    JSON.stringify(content),
    actionType,
    usedPatternIds,
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

  // Mémoire cross-campagne : résolue UNE fois par run (les patterns ne varient
  // pas d'un contact à l'autre). Le teamId est résolu comme dans crm-agent
  // (db.teams.getByUser, via le helper email-context). Best-effort : sans
  // mémoire, la génération continue · elle n'apprend juste rien.
  let patternCtx = { text: '', ids: [] };
  try {
    const teamId = await getTeamId(userId);
    patternCtx = await getPatternContext(teamId, userId);
  } catch { /* mémoire optionnelle */ }

  for (const { trigger, contacts } of matches) {
    // Determine action type: email (default), linkedin_connect, linkedin_message, linkedin_visit
    const actionType = trigger.action_type || 'email';
    const isLinkedIn = actionType.startsWith('linkedin_');

    for (const contact of contacts) {
      try {
        results.triggered++;

        if (isLinkedIn) {
          // Execute LinkedIn action
          const result = await executeLinkedInAction(userId, trigger, contact, actionType, patternCtx);
          if (result.success) results.sent++;
        } else {
          // Generate personalized email
          const { subject, body } = await generateEmail(trigger, contact, patternCtx);

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
              patternIds: patternCtx.ids,
            });

            if (sendResult.success) {
              results.sent++;
            } else {
              results.errors.push({ contact: contact.name, error: sendResult.error });
            }
          } else {
            // Queue for approval · pattern_ids = patterns réellement injectés
            // dans le prompt (avant : [] en dur, la boucle d'apprentissage ne
            // pouvait jamais attribuer un succès à un pattern).
            await db.query(`
              INSERT INTO nurture_emails (user_id, trigger_id, opportunity_id, to_email, to_name, subject, body, status, pattern_ids)
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
            `, [userId, trigger.id, opp?.id || null, contact.email, contact.name, subject, body, patternCtx.ids]);
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
