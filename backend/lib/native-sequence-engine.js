/**
 * Moteur d'envoi natif des campagnes de prospection.
 *
 * Alternative à Lemlist : les emails partent de la boîte connectée de
 * l'utilisateur (Gmail/Microsoft/SMTP via lib/email-outbound), les steps
 * LinkedIn passent par le cookie li_at (api/linkedin, quotas journaliers
 * intégrés). Contrepartie assumée : volumes réduits — une boîte perso n'est
 * pas une infra d'emailing froid.
 *
 * Garde-fous :
 *  - NATIVE_EMAIL_DAILY_CAP emails de prospection / jour / utilisateur,
 *    NATIVE_EMAILS_PER_RUN par passage (le cron horaire étale la journée) ;
 *  - arrêt de séquence par prospect sur réponse détectée (Gmail API — même
 *    token OAuth que l'envoi, scope mail.google.com), bounce définitif,
 *    désinscription ou stop manuel ;
 *  - un seul passage à la fois par utilisateur (bail lib/db-lock — le cron
 *    et le bouton « Traiter maintenant » peuvent se chevaucher).
 *
 * Séquences conditionnelles : le moteur suit le chemin principal de l'arbre
 * (branches négatives/default : not_opened, not_replied…). Les branches
 * positives (opened, clicked…) supposent un tracking d'ouverture qu'un envoi
 * natif n'a pas — elles restent réservées au canal Lemlist. Comme toute
 * réponse stoppe la séquence, le chemin « pas de réponse » EST le chemin réel.
 */

const db = require('../db');
const logger = require('./logger');
const { withLock } = require('./db-lock');
const emailOutbound = require('./email-outbound');

const NATIVE_EMAIL_DAILY_CAP = 40;
const NATIVE_EMAILS_PER_RUN = 12;
const REPLY_LOOKBACK_DAYS = 14;

// Branches suivies par le chemin principal (null/default = séquence linéaire).
const MAIN_PATH_CONDITIONS = new Set(['not_opened', 'not_replied', 'not_clicked', 'not_accepted', 'default']);

/* ═══════════════════ Fonctions pures (testées) ═══════════════════ */

/** "J+3" → 3. Absent/illisible → 0 (comme api/lemlist parseDelayFromTiming). */
function parseTiming(timing) {
  if (!timing) return 0;
  const match = String(timing).match(/J\+?(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Aplati l'arbre de touchpoints en chemin principal ordonné.
 * Racines par sort_order, puis descente récursive dans les branches
 * négatives/default uniquement. Chaque step garde son délai relatif (jours
 * après le step précédent du chemin).
 */
function buildMainPath(touchpoints) {
  const byParent = new Map();
  const roots = [];
  for (const tp of touchpoints) {
    if (tp.parent_step_id) {
      if (!byParent.has(tp.parent_step_id)) byParent.set(tp.parent_step_id, []);
      byParent.get(tp.parent_step_id).push(tp);
    } else {
      roots.push(tp);
    }
  }
  const bySort = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
  roots.sort(bySort);

  const path = [];
  const visit = (tp) => {
    path.push(tp);
    const children = (byParent.get(tp.id) || [])
      .filter((c) => !c.condition_type || MAIN_PATH_CONDITIONS.has(c.condition_type))
      .sort(bySort);
    for (const child of children) visit(child);
  };
  for (const root of roots) visit(root);

  return path.map((tp) => ({ ...tp, delayDays: parseTiming(tp.timing) }));
}

/** Substitue les variables {{firstName}} etc. avec les champs du prospect. */
function renderTemplate(text, prospect) {
  if (!text) return '';
  const [firstName, ...rest] = String(prospect.name || '').trim().split(/\s+/);
  const personalization = typeof prospect.personalization === 'string'
    ? (() => { try { return JSON.parse(prospect.personalization); } catch { return {}; } })()
    : (prospect.personalization || {});
  const vars = {
    firstName: firstName || '',
    lastName: rest.join(' '),
    companyName: prospect.company || '',
    company: prospect.company || '',
    jobTitle: prospect.title || '',
    title: prospect.title || '',
    icebreaker: personalization.icebreaker || '',
  };
  return text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (vars[key] !== undefined ? vars[key] : ''))
    // Les substitutions vides laissent parfois des doubles espaces ou des
    // lignes orphelines — on nettoie sans toucher à la mise en forme voulue.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Canal effectif d'un touchpoint pour campaign_sends. */
function channelOf(tp) {
  if (tp.type === 'email') return 'email';
  if (tp.type === 'linkedin_visit') return 'linkedin_visit';
  if (tp.type === 'linkedin_invite') return 'linkedin_invite';
  // 'linkedin' historique et 'linkedin_message' → message
  return 'linkedin_message';
}

/* ═══════════════════ Journal d'envoi ═══════════════════ */

async function recordSend({ userId, campaignId, opportunityId, touchpointId, channel, status, messageId, error }) {
  await db.query(
    `INSERT INTO campaign_sends (user_id, campaign_id, opportunity_id, touchpoint_id, channel, status, message_id, error, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (opportunity_id, touchpoint_id)
     DO UPDATE SET status = $6, message_id = $7, error = $8, sent_at = now()`,
    [userId, campaignId, opportunityId, touchpointId, channel, status, messageId || null, (error || '').slice(0, 500) || null]
  );
}

async function stopSequence(userId, opportunityId, reason) {
  await db.query(
    `UPDATE opportunities SET sequence_stopped_at = now(), sequence_stop_reason = $1
     WHERE id = $2 AND user_id = $3 AND sequence_stopped_at IS NULL`,
    [reason, opportunityId, userId]
  );
}

async function emailsSentToday(userId) {
  const r = await db.query(
    `SELECT COUNT(*) AS n FROM campaign_sends
     WHERE user_id = $1 AND channel = 'email' AND status = 'sent'
       AND sent_at >= date_trunc('day', now())`,
    [userId]
  );
  return parseInt(r.rows[0].n, 10);
}

/* ═══════════════════ Envoi des steps dus ═══════════════════ */

/**
 * Envoie les steps arrivés à échéance pour une campagne native active.
 * Un step max par prospect et par passage — le rythme reste humain.
 */
async function processCampaign(campaign, ctx) {
  const report = { emailsSent: 0, linkedinActions: 0, skipped: 0, failed: 0, stopped: 0 };
  const userId = campaign.user_id;

  const [touchpoints, prospects, sends] = await Promise.all([
    db.touchpoints.listByCampaign(campaign.id),
    db.opportunities.listByCampaign(campaign.id),
    db.query(`SELECT * FROM campaign_sends WHERE campaign_id = $1`, [campaign.id]).then(r => r.rows),
  ]);

  const path = buildMainPath(touchpoints);
  if (path.length === 0) return report;

  const sendsByProspect = new Map();
  for (const s of sends) {
    if (!sendsByProspect.has(s.opportunity_id)) sendsByProspect.set(s.opportunity_id, new Map());
    sendsByProspect.get(s.opportunity_id).set(s.touchpoint_id, s);
  }

  // En mode batch, seuls les prospects du batch courant reçoivent la séquence.
  let eligible = prospects.filter(p => !p.sequence_stopped_at);
  if (campaign.batch_mode && campaign.current_batch) {
    eligible = eligible.filter(p => (p.batch_number || 0) > 0 && p.batch_number <= campaign.current_batch);
  }

  const campaignStart = campaign.start_date ? new Date(campaign.start_date).getTime() : Date.now();

  for (const prospect of eligible) {
    if (ctx.emailBudget <= 0 && ctx.linkedinExhausted) break;

    const done = sendsByProspect.get(prospect.id) || new Map();
    // Prochain step : premier touchpoint du chemin sans ligne sent/skipped.
    let next = null;
    let lastSentAt = campaignStart;
    for (const tp of path) {
      const row = done.get(tp.id);
      if (row && (row.status === 'sent' || row.status === 'skipped')) {
        if (row.status === 'sent' && row.sent_at) lastSentAt = new Date(row.sent_at).getTime();
        continue;
      }
      next = tp;
      break;
    }
    if (!next) continue; // séquence terminée

    const dueAt = lastSentAt + next.delayDays * 86400000;
    if (dueAt > Date.now()) continue;

    const channel = channelOf(next);

    if (channel === 'email') {
      if (ctx.emailBudget <= 0) continue;
      if (!prospect.email) {
        await recordSend({ userId, campaignId: campaign.id, opportunityId: prospect.id, touchpointId: next.id, channel, status: 'skipped', error: 'no_email' });
        report.skipped++;
        continue;
      }
      const subject = renderTemplate(next.subject, prospect) || `Re: ${renderTemplate(path.find(s => s.type === 'email')?.subject || campaign.name, prospect)}`;
      const body = renderTemplate(next.body, prospect);
      const result = await emailOutbound.sendPersonalEmail(userId, {
        to: prospect.email,
        toName: prospect.name,
        subject,
        body,
      });

      if (result.success) {
        await recordSend({ userId, campaignId: campaign.id, opportunityId: prospect.id, touchpointId: next.id, channel, status: 'sent', messageId: result.messageId });
        ctx.emailBudget--;
        report.emailsSent++;
      } else if (result.code === 'recipient_bounced') {
        await recordSend({ userId, campaignId: campaign.id, opportunityId: prospect.id, touchpointId: next.id, channel, status: 'failed', error: result.error });
        await stopSequence(userId, prospect.id, 'bounced');
        await insertActivity(userId, campaign.id, prospect, 'emailsBounced', `bounce:${prospect.id}:${next.id}`);
        report.stopped++;
      } else if (result.code === 'no_email_account' || result.code === 'token_refresh_failed') {
        // Plus de boîte utilisable : inutile d'itérer les autres prospects.
        ctx.emailBudget = 0;
        report.failed++;
      } else {
        await recordSend({ userId, campaignId: campaign.id, opportunityId: prospect.id, touchpointId: next.id, channel, status: 'failed', error: result.error });
        report.failed++;
      }
    } else {
      // Steps LinkedIn — best-effort : cookie absent ou quota atteint ne
      // doivent pas bloquer les emails.
      if (ctx.linkedinExhausted) continue;
      const cookie = await ctx.getLinkedinCookie();
      if (!cookie) {
        await recordSend({ userId, campaignId: campaign.id, opportunityId: prospect.id, touchpointId: next.id, channel, status: 'skipped', error: 'linkedin_not_connected' });
        report.skipped++;
        continue;
      }
      const publicId = (prospect.linkedin_url || '').match(/\/in\/([^/?]+)/)?.[1];
      if (!publicId) {
        await recordSend({ userId, campaignId: campaign.id, opportunityId: prospect.id, touchpointId: next.id, channel, status: 'skipped', error: 'no_linkedin_url' });
        report.skipped++;
        continue;
      }
      try {
        const linkedin = require('../api/linkedin');
        const message = renderTemplate(next.body, prospect);
        if (channel === 'linkedin_visit') {
          await linkedin.getProfile(cookie, publicId, userId);
        } else if (channel === 'linkedin_invite') {
          await linkedin.sendConnectionRequest(cookie, { profileUrn: publicId, message: message.slice(0, 300) }, userId);
        } else {
          await linkedin.sendMessage(cookie, { recipientUrn: publicId, message }, userId);
        }
        await recordSend({ userId, campaignId: campaign.id, opportunityId: prospect.id, touchpointId: next.id, channel, status: 'sent' });
        report.linkedinActions++;
      } catch (err) {
        if (err.code === 'RATE_LIMITED' || err.code === 'SESSION_EXPIRED') {
          ctx.linkedinExhausted = true; // on réessaiera au prochain passage
        } else {
          await recordSend({ userId, campaignId: campaign.id, opportunityId: prospect.id, touchpointId: next.id, channel, status: 'failed', error: err.message });
          report.failed++;
        }
      }
    }
  }

  if (report.emailsSent > 0) {
    await db.campaigns.update(campaign.id, { sent: (campaign.sent || 0) + report.emailsSent });
  }
  return report;
}

/* ═══════════════════ Détection de réponses (Gmail) ═══════════════════ */

async function insertActivity(userId, campaignId, prospect, type, dedupKey) {
  const [firstName, ...rest] = String(prospect.name || '').trim().split(/\s+/);
  await db.query(
    `INSERT INTO prospect_activities (user_id, campaign_id, opportunity_id, lemlist_activity_id, type, lead_email, lead_first_name, lead_last_name, company_name, happened_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (lemlist_activity_id) DO NOTHING`,
    [userId, campaignId, prospect.id, `native:${dedupKey}`, type, prospect.email || null, firstName || null, rest.join(' ') || null, prospect.company || null]
  );
}

async function gmailFetch(accessToken, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  return res.json();
}

/**
 * Détecte les réponses des prospects de campagnes natives dans la boîte Gmail
 * de l'utilisateur, stoppe leur séquence et passe la main à l'autopilot.
 * Microsoft/SMTP : pas de scope lecture — stop manuel + bounce automatique.
 */
async function checkReplies(userId, campaigns) {
  const report = { replies: 0, errors: [] };

  let account = await emailOutbound.getDefaultAccount(userId);
  if (!account || account.provider !== 'gmail') return report;

  // Prospects candidats : au moins un email envoyé, séquence encore vivante.
  const candidates = await db.query(
    `SELECT DISTINCT ON (o.id) o.*, cs.campaign_id AS send_campaign_id
     FROM opportunities o
     JOIN campaign_sends cs ON cs.opportunity_id = o.id AND cs.channel = 'email' AND cs.status = 'sent'
     WHERE o.user_id = $1 AND o.campaign_id = ANY($2)
       AND o.sequence_stopped_at IS NULL AND o.email IS NOT NULL
     ORDER BY o.id, cs.sent_at DESC`,
    [userId, campaigns.map(c => c.id)]
  );
  if (candidates.rows.length === 0) return report;

  try {
    account = await emailOutbound.refreshTokenIfNeeded(account);
  } catch (err) {
    report.errors.push(`token: ${err.message}`);
    return report;
  }
  const accessToken = emailOutbound.decryptAccount(account).decryptedAccessToken;
  if (!accessToken) return report;

  const byEmail = new Map(candidates.rows.map(p => [String(p.email).toLowerCase(), p]));
  const emails = [...byEmail.keys()];
  const replied = new Set();

  try {
    // Requêtes par lot de 15 adresses — Gmail accepte les groupes from:(a OR b).
    for (let i = 0; i < emails.length; i += 15) {
      const chunk = emails.slice(i, i + 15);
      const q = encodeURIComponent(`in:inbox newer_than:${REPLY_LOOKBACK_DAYS}d from:(${chunk.join(' OR ')})`);
      const list = await gmailFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=25`);
      for (const m of list.messages || []) {
        const msg = await gmailFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From`);
        const fromHeader = (msg.payload?.headers || []).find(h => h.name === 'From')?.value || '';
        const fromEmail = (fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader).trim().toLowerCase();
        const prospect = byEmail.get(fromEmail);
        if (!prospect || replied.has(prospect.id)) continue;
        replied.add(prospect.id);

        await stopSequence(userId, prospect.id, 'replied');
        await insertActivity(userId, prospect.campaign_id, prospect, 'emailsReplied', m.id);
        report.replies++;

        // Classification d'intention puis autopilot — best-effort : la
        // séquence est déjà stoppée, c'est l'essentiel.
        try {
          const claude = require('../api/claude');
          const { intentEnumForPrompt, isKnownIntent } = require('./reply-intents');
          const result = await claude.callClaude(
            'Return only valid JSON.',
            `Classify this reply from a cold-outreach prospect.\n\nReply (snippet): "${(msg.snippet || '').slice(0, 500)}"\n\nReturn JSON: { "intent": ${intentEnumForPrompt()}, "sentiment": "positive"|"neutral"|"negative" }`,
            200,
            'native_reply_intent'
          );
          const intent = isKnownIntent(result.parsed?.intent) ? result.parsed.intent : 'question';
          const autopilot = require('./conversation-autopilot');
          await autopilot.processReply(userId, {
            opportunityId: prospect.id,
            email: prospect.email,
            contactName: prospect.name,
            company: prospect.company,
            replyContent: msg.snippet || '',
            intent,
            sentiment: result.parsed?.sentiment || 'neutral',
            channel: 'email',
          });
        } catch (err) {
          report.errors.push(`autopilot ${prospect.email}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    report.errors.push(`gmail: ${err.message}`);
  }

  return report;
}

/* ═══════════════════ Points d'entrée ═══════════════════ */

/**
 * Passage complet pour un utilisateur : détection de réponses d'abord (pour
 * ne pas relancer quelqu'un qui vient de répondre), puis envoi des steps dus.
 * `campaignId` optionnel restreint à une campagne (bouton « Traiter maintenant »).
 */
async function runForUser(userId, { campaignId } = {}) {
  const outcome = await withLock(`native-seq-${userId}`, async () => {
    const report = { replies: 0, emailsSent: 0, linkedinActions: 0, skipped: 0, failed: 0, stopped: 0, errors: [] };

    let campaignsList = (await db.campaigns.list({ userId, status: 'active' }))
      .filter(c => c.send_channel === 'native');
    if (campaignId) campaignsList = campaignsList.filter(c => c.id === campaignId);
    if (campaignsList.length === 0) return report;

    const replyReport = await checkReplies(userId, campaignsList);
    report.replies = replyReport.replies;
    report.errors.push(...replyReport.errors);

    const sentToday = await emailsSentToday(userId);
    const ctx = {
      emailBudget: Math.max(0, Math.min(NATIVE_EMAIL_DAILY_CAP - sentToday, NATIVE_EMAILS_PER_RUN)),
      linkedinExhausted: false,
      _cookie: undefined,
      async getLinkedinCookie() {
        if (this._cookie === undefined) {
          const { getUserKey } = require('../config');
          this._cookie = (await getUserKey(userId, 'linkedin')) || null;
        }
        return this._cookie;
      },
    };

    for (const campaign of campaignsList) {
      try {
        const r = await processCampaign(campaign, ctx);
        report.emailsSent += r.emailsSent;
        report.linkedinActions += r.linkedinActions;
        report.skipped += r.skipped;
        report.failed += r.failed;
        report.stopped += r.stopped;
      } catch (err) {
        report.errors.push(`${campaign.name}: ${err.message}`);
        logger.error('native-seq', `Campaign ${campaign.id}: ${err.message}`);
      }
    }

    if (report.emailsSent + report.linkedinActions + report.replies > 0) {
      logger.info('native-seq', `User ${userId}: ${report.emailsSent} emails, ${report.linkedinActions} linkedin, ${report.replies} replies detected`);
    }
    return report;
  }, { ttlSeconds: 600 });

  // Un autre passage est en cours (cron vs « Traiter maintenant ») : rien à
  // faire, le passage en cours s'occupe des steps dus.
  if (!outcome.ran) return { locked: true, replies: 0, emailsSent: 0, linkedinActions: 0, skipped: 0, failed: 0, stopped: 0, errors: [] };
  return outcome.result;
}

/** Passage global (cron) : tous les utilisateurs ayant des campagnes natives actives. */
async function run() {
  const users = await db.query(
    `SELECT DISTINCT user_id FROM campaigns
     WHERE status = 'active' AND send_channel = 'native' AND user_id IS NOT NULL`
  );
  const summary = { users: users.rows.length, emailsSent: 0, linkedinActions: 0, replies: 0, errors: [] };
  for (const { user_id } of users.rows) {
    try {
      const r = await runForUser(user_id);
      if (r) {
        summary.emailsSent += r.emailsSent;
        summary.linkedinActions += r.linkedinActions;
        summary.replies += r.replies;
        summary.errors.push(...r.errors);
      }
    } catch (err) {
      summary.errors.push(`${user_id}: ${err.message}`);
    }
  }
  return summary;
}

module.exports = {
  run,
  runForUser,
  // Exposés pour les tests
  buildMainPath,
  parseTiming,
  renderTemplate,
  NATIVE_EMAIL_DAILY_CAP,
};
