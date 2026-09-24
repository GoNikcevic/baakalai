/**
 * Moteur d'envoi natif des séquences.
 *
 * Deux conteneurs partagent le même moteur depuis la migration 103 :
 *  - les campagnes de prospection en canal natif (send_channel = 'native') · 
 *    une séquence partagée par tous les prospects de la campagne ;
 *  - les enrollments (sequence_enrollments) · un workflow de relance sur
 *    mesure pour UN contact CRM (réactivation, upsell, prévention churn),
 *    proposé par l'agent et approuvé par l'utilisateur avant tout envoi.
 * La frontière crm-scope reste intacte : un enrollment référence le contact
 * CRM (campaign_id IS NULL), il ne le transforme jamais en prospect de
 * campagne.
 *
 * Alternative à Lemlist : les emails partent de la boîte connectée de
 * l'utilisateur (Gmail/Microsoft/SMTP via lib/email-outbound), les steps
 * LinkedIn passent par le cookie li_at (api/linkedin, quotas journaliers
 * intégrés). Contrepartie assumée : volumes réduits · une boîte perso n'est
 * pas une infra d'emailing froid.
 *
 * Garde-fous :
 *  - NATIVE_EMAIL_DAILY_CAP emails / jour / BOÎTE (migration 112 · le plafond
 *    protège la délivrabilité d'une adresse, le compter par utilisateur
 *    punissait celui qui en connecte plusieurs, ce que font précisément les
 *    commerciaux pour ne pas se faire bannir), NATIVE_EMAILS_PER_RUN par
 *    passage et par utilisateur (le cron horaire étale la journée) ;
 *  - arrêt de séquence par prospect sur réponse détectée, bounce définitif,
 *    désinscription ou stop manuel. La détection lit la boîte de l'utilisateur :
 *    Gmail via le même token OAuth que l'envoi (scope mail.google.com), Outlook
 *    via Microsoft Graph, qui demande un consentement séparé de l'envoi
 *    (migration 111, lib/microsoft-graph.js). Un SMTP de domaine custom n'offre
 *    aucune API de lecture : l'arrêt sur réponse y reste manuel ;
 *  - un seul passage à la fois par utilisateur (bail lib/db-lock · le cron
 *    et le bouton « Traiter maintenant » peuvent se chevaucher).
 *
 * Séquences conditionnelles : le moteur suit le chemin principal de l'arbre
 * (branches négatives/default : not_opened, not_replied…). Exception depuis
 * la migration 103 : la branche « accepted » d'une invitation LinkedIn est
 * exécutable · l'acceptation est vérifiée à l'exécution via le journal
 * linkedin_connect_accepted (lib/linkedin-response-sync) et l'état live des
 * invitations envoyées. Les autres branches positives (opened, clicked)
 * supposent un tracking d'ouverture qu'un envoi natif n'a pas · elles restent
 * réservées au canal Lemlist. Comme toute réponse stoppe la séquence, le
 * chemin « pas de réponse » EST le chemin réel.
 */

const db = require('../db');
const logger = require('./logger');
const { withLock } = require('./db-lock');
const emailOutbound = require('./email-outbound');

const NATIVE_EMAIL_DAILY_CAP = 40;
const NATIVE_EMAILS_PER_RUN = 12;
const REPLY_LOOKBACK_DAYS = 14;
const DAY_MS = 86400000;

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
 * négatives/default. Avec { accepted: true } (l'invitation LinkedIn du
 * prospect a été acceptée), les branches « accepted » sont suivies et les
 * branches « not_accepted » écartées. Chaque step garde son délai relatif
 * (jours après le step précédent du chemin).
 */
function buildMainPath(touchpoints, { accepted = false } = {}) {
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

  const followed = (c) => {
    if (!c.condition_type) return true;
    if (accepted) {
      if (c.condition_type === 'accepted') return true;
      if (c.condition_type === 'not_accepted') return false;
    }
    return MAIN_PATH_CONDITIONS.has(c.condition_type);
  };

  const path = [];
  const visit = (tp) => {
    path.push(tp);
    const children = (byParent.get(tp.id) || []).filter(followed).sort(bySort);
    for (const child of children) visit(child);
  };
  for (const root of roots) visit(root);

  return path.map((tp) => ({ ...tp, delayDays: parseTiming(tp.timing) }));
}

/**
 * Budget d'envoi d'un passage. Deux limites, deux rôles distincts :
 *  - le plafond JOURNALIER protège la délivrabilité d'une adresse : il se
 *    compte par boîte. Le compter par utilisateur, comme avant la migration
 *    112, punissait celui qui en connecte plusieurs, ce que font précisément
 *    les commerciaux pour ne pas se faire bannir ;
 *  - le quota PAR PASSAGE étale la journée pour l'utilisateur : il reste
 *    global, sinon le cron horaire enverrait tout d'un coup dès qu'une
 *    deuxième boîte est connectée.
 *
 * `defaultAccountId` sert de clé aux envois sans boîte explicite (relances CRM,
 * workflows) : ils partent bien de cette boîte-là, ils doivent donc peser
 * dessus.
 */
function createEmailBudget(sentTodayByAccount, defaultAccountId) {
  return {
    runBudget: NATIVE_EMAILS_PER_RUN,
    sentTodayByAccount,
    budgetFor(accountId) {
      if (this.runBudget <= 0) return 0;
      const key = accountId || defaultAccountId;
      if (!key) return 0;
      return Math.min(this.runBudget, Math.max(0, NATIVE_EMAIL_DAILY_CAP - (this.sentTodayByAccount.get(key) || 0)));
    },
    consume(accountId) {
      const key = accountId || defaultAccountId;
      this.runBudget--;
      if (key) this.sentTodayByAccount.set(key, (this.sentTodayByAccount.get(key) || 0) + 1);
    },
    defaultAccountId,
  };
}

/** L'arbre contient-il une branche « accepted » exécutable en natif ? */
function hasAcceptedBranch(touchpoints) {
  return touchpoints.some((tp) => tp.condition_type === 'accepted');
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
    // lignes orphelines · on nettoie sans toucher à la mise en forme voulue.
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

/** publicId LinkedIn d'un prospect, ou null. */
function publicIdOf(prospect) {
  return (prospect.linkedin_url || '').match(/\/in\/([^/?]+)/)?.[1]?.toLowerCase() || null;
}

/* ═══════════════════ Journal d'envoi ═══════════════════ */

async function recordSend({ userId, campaignId, enrollmentId, opportunityId, touchpointId, channel, status, messageId, error, emailAccountId }) {
  await db.query(
    `INSERT INTO campaign_sends (user_id, campaign_id, enrollment_id, opportunity_id, touchpoint_id, channel, status, message_id, error, email_account_id, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (opportunity_id, touchpoint_id)
     DO UPDATE SET status = $7, message_id = $8, error = $9, email_account_id = $10, sent_at = now()`,
    [userId, campaignId || null, enrollmentId || null, opportunityId, touchpointId, channel, status, messageId || null, (error || '').slice(0, 500) || null, emailAccountId || null]
  );
}

async function stopSequence(userId, opportunityId, reason) {
  await db.query(
    `UPDATE opportunities SET sequence_stopped_at = now(), sequence_stop_reason = $1
     WHERE id = $2 AND user_id = $3 AND sequence_stopped_at IS NULL`,
    [reason, opportunityId, userId]
  );
}

async function stopEnrollment(enrollmentId, reason) {
  await db.sequenceEnrollments.setStatus(enrollmentId, 'stopped', { stopReason: reason });
}

/**
 * Cookie li_at expiré : les steps LinkedIn sont silencieusement reportés à
 * chaque passage · sans signal, l'utilisateur ne s'en aperçoit jamais.
 * Notification persistée + socket (lib/notify), au plus une par 24 h.
 */
async function notifyLinkedinExpired(userId) {
  try {
    const recent = await db.query(
      `SELECT id FROM notifications
       WHERE user_id = $1 AND type = 'linkedin_expired' AND created_at > now() - interval '24 hours'
       LIMIT 1`,
      [userId]
    );
    if (recent.rows.length > 0) return;
    const { createNotification } = require('./notify');
    await createNotification(userId, {
      type: 'linkedin_expired',
      title: 'Session LinkedIn expirée',
      body: 'Vos étapes LinkedIn (visites, invitations, messages) sont en pause. Recollez votre cookie li_at dans Réglages → LinkedIn pour reprendre.',
      metadata: { source: 'native-sequence-engine' },
    });
  } catch (err) {
    logger.warn('native-seq', `notify linkedin_expired: ${err.message}`);
  }
}

/**
 * Emails envoyés aujourd'hui, PAR BOÎTE.
 *
 * Le plafond protège la délivrabilité d'une adresse : le compter par
 * utilisateur revenait à punir celui qui en connecte plusieurs, alors que c'est
 * précisément ce que font les commerciaux pour ne pas se faire bannir. Les
 * envois antérieurs à la migration 112 n'ont pas de boîte enregistrée : ils
 * sont imputés à la boîte par défaut, qui est celle qui les a réellement faits.
 *
 * @returns {Promise<Map<string, number>>} clé = id de boîte, ou 'legacy'.
 */
async function emailsSentTodayByAccount(userId) {
  const r = await db.query(
    `SELECT COALESCE(email_account_id::text, 'legacy') AS account, COUNT(*) AS n
     FROM campaign_sends
     WHERE user_id = $1 AND channel = 'email' AND status = 'sent'
       AND sent_at >= date_trunc('day', now())
     GROUP BY 1`,
    [userId]
  );
  return new Map(r.rows.map(row => [row.account, parseInt(row.n, 10)]));
}

/* ═══════════════════ Avancement d'un prospect dans son chemin ═══════════════════ */

/**
 * Envoie LE prochain step dû d'un prospect dans son chemin · un step max par
 * passage, le rythme reste humain. Retourne :
 *   'sent' | 'skipped' | 'failed' | 'stopped' | 'waiting' | 'sequence_done'
 * `ids` = { campaignId } ou { enrollmentId } selon le conteneur ;
 * `onBounce(reason)` arrête la séquence du bon côté (opportunité ou enrollment).
 */
async function advanceOneStep({ prospect, path, done, baseTime, ctx, ids, report, onBounce }) {
  const userId = ctx.userId;

  // Prochain step : premier touchpoint du chemin sans ligne sent/skipped.
  let next = null;
  let lastSentAt = baseTime;
  for (const tp of path) {
    const row = done.get(tp.id);
    if (row && (row.status === 'sent' || row.status === 'skipped')) {
      if (row.status === 'sent' && row.sent_at) lastSentAt = new Date(row.sent_at).getTime();
      continue;
    }
    next = tp;
    break;
  }
  if (!next) return 'sequence_done';

  const dueAt = lastSentAt + next.delayDays * 86400000;
  if (dueAt > Date.now()) return 'waiting';

  const channel = channelOf(next);
  const base = { userId, ...ids, opportunityId: prospect.id, touchpointId: next.id, channel };

  if (channel === 'email') {
    // `accountId` = boîte choisie pour cette campagne (migration 112) ; les
    // workflows CRM n'en portent pas et partent de la boîte par défaut.
    const accountId = ctx.accountId || null;
    if (ctx.budgetFor(accountId) <= 0) return 'waiting';
    if (!prospect.email) {
      await recordSend({ ...base, status: 'skipped', error: 'no_email' });
      report.skipped++;
      return 'skipped';
    }
    // Étape de workflow : le corps stocké est une CONSIGNE, pas un email.
    // L'email est écrit ici, au moment de l'envoi, avec ce qu'on sait du
    // contact et de ce qui lui a déjà été envoyé dans ce parcours.
    //
    // Si la génération échoue on n'envoie RIEN : expédier la consigne telle
    // quelle mettrait une note de service sous les yeux d'un client. Une
    // étape non partie se rattrape au passage suivant, un email absurde non.
    const { isConsigneStep, generateStepEmail } = require('./workflow-step-email');
    let subject;
    let body;

    if (isConsigneStep(next)) {
      // `campaign_sends` ne garde ni objet ni corps : on repart des CONSIGNES
      // des étapes déjà parties, ce qui suffit à ne pas redire la même chose.
      const previous = path
        .filter(s => s.type === 'email' && s.id !== next.id && done.has(s.id))
        .map(s => ({ subject: null, body: s.body }));
      const written = await generateStepEmail({
        consigne: next.body,
        prospect,
        previous,
        isFirst: previous.length === 0,
      });
      if (!written) {
        await recordSend({ ...base, status: 'skipped', error: 'generation_failed' });
        report.skipped++;
        return 'skipped';
      }
      subject = written.subject;
      body = written.body;
    } else {
      subject = renderTemplate(next.subject, prospect)
        || `Re: ${renderTemplate(path.find(s => s.type === 'email')?.subject || '', prospect) || 'notre échange'}`;
      body = renderTemplate(next.body, prospect);
    }
    const result = await emailOutbound.sendPersonalEmail(userId, {
      to: prospect.email,
      toName: prospect.name,
      subject,
      body,
      accountId,
    });

    if (result.success) {
      // On trace la boîte que l'envoi a REELLEMENT utilisée, pas celle qu'on a
      // demandée : en cas de repli (boîte supprimée, expirée), le plafond doit
      // suivre l'adresse qui a vraiment servi.
      await recordSend({ ...base, status: 'sent', messageId: result.messageId, emailAccountId: result.accountId });
      ctx.consume(result.accountId);
      report.emailsSent++;
      return 'sent';
    }
    if (result.code === 'recipient_bounced') {
      await recordSend({ ...base, status: 'failed', error: result.error });
      await onBounce('bounced');
      report.stopped++;
      return 'stopped';
    }
    if (result.code === 'no_email_account' || result.code === 'token_refresh_failed') {
      // Plus de boîte utilisable : inutile d'itérer les autres prospects.
      ctx.runBudget = 0;
      report.failed++;
      return 'failed';
    }
    await recordSend({ ...base, status: 'failed', error: result.error });
    report.failed++;
    return 'failed';
  }

  // Steps LinkedIn · best-effort : cookie absent ou quota atteint ne
  // doivent pas bloquer les emails.
  if (ctx.linkedinExhausted) return 'waiting';
  const cookie = await ctx.getLinkedinCookie();
  if (!cookie) {
    await recordSend({ ...base, status: 'skipped', error: 'linkedin_not_connected' });
    report.skipped++;
    return 'skipped';
  }
  const publicId = publicIdOf(prospect);
  if (!publicId) {
    await recordSend({ ...base, status: 'skipped', error: 'no_linkedin_url' });
    report.skipped++;
    return 'skipped';
  }
  // Inviter quelqu'un qui a déjà accepté (connexion antérieure au workflow)
  // ferait échouer l'appel en boucle : on consomme le step sans l'exécuter.
  if (channel === 'linkedin_invite' && await ctx.isAccepted(prospect)) {
    await recordSend({ ...base, status: 'skipped', error: 'already_connected' });
    report.skipped++;
    return 'skipped';
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
    await recordSend({ ...base, status: 'sent' });
    report.linkedinActions++;
    return 'sent';
  } catch (err) {
    if (err.code === 'RATE_LIMITED' || err.code === 'SESSION_EXPIRED') {
      ctx.linkedinExhausted = true; // on réessaiera au prochain passage
      if (err.code === 'SESSION_EXPIRED') await notifyLinkedinExpired(userId);
      return 'waiting';
    }
    await recordSend({ ...base, status: 'failed', error: err.message });
    report.failed++;
    return 'failed';
  }
}

/* ═══════════════════ Envoi des steps dus · campagnes ═══════════════════ */

async function processCampaign(campaign, ctx) {
  const report = { emailsSent: 0, linkedinActions: 0, skipped: 0, failed: 0, stopped: 0 };
  const userId = campaign.user_id;
  // Expéditeur de CETTE campagne (migration 112). Les campagnes sont traitées
  // l'une après l'autre dans un même passage : poser la boîte ici suffit, et
  // chaque campagne repose la sienne.
  ctx.accountId = campaign.email_account_id || null;

  const [touchpoints, prospects, sends] = await Promise.all([
    db.touchpoints.listByCampaign(campaign.id),
    db.opportunities.listByCampaign(campaign.id),
    db.query(`SELECT * FROM campaign_sends WHERE campaign_id = $1`, [campaign.id]).then(r => r.rows),
  ]);

  const pathDefault = buildMainPath(touchpoints);
  if (pathDefault.length === 0) return report;
  // La branche « accepted » n'est aplatie que si l'arbre en contient une · 
  // et l'état d'acceptation n'est consulté que dans ce cas (un appel
  // LinkedIn par passage au maximum, mutualisé dans ctx).
  const withAccepted = hasAcceptedBranch(touchpoints);
  const pathAccepted = withAccepted ? buildMainPath(touchpoints, { accepted: true }) : null;

  const sendsByProspect = new Map();
  for (const s of sends) {
    if (!s.touchpoint_id) continue; // journal orphelin (step supprimé), historique seulement
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
    if (ctx.budgetFor(ctx.accountId) <= 0 && ctx.linkedinExhausted) break;

    const path = (withAccepted && await ctx.isAccepted(prospect)) ? pathAccepted : pathDefault;
    await advanceOneStep({
      prospect,
      path,
      done: sendsByProspect.get(prospect.id) || new Map(),
      baseTime: campaignStart,
      ctx,
      ids: { campaignId: campaign.id },
      report,
      onBounce: async (reason) => {
        await stopSequence(userId, prospect.id, reason);
        await insertActivity(userId, campaign.id, prospect, 'emailsBounced', `bounce:${prospect.id}`);
      },
    });
  }

  if (report.emailsSent > 0) {
    await db.campaigns.update(campaign.id, { sent: (campaign.sent || 0) + report.emailsSent });
  }
  return report;
}

/* ═══════════════════ Envoi des steps dus · enrollments (relances CRM) ═══════════════════ */

async function processEnrollments(enrollments, ctx) {
  const report = { emailsSent: 0, linkedinActions: 0, skipped: 0, failed: 0, stopped: 0, completed: 0 };

  for (const enrollment of enrollments) {
    if (ctx.budgetFor(ctx.accountId) <= 0 && ctx.linkedinExhausted) break;

    const [touchpoints, prospect, sends] = await Promise.all([
      db.touchpoints.listByEnrollment(enrollment.id),
      db.opportunities.get(enrollment.opportunity_id),
      db.query(`SELECT * FROM campaign_sends WHERE enrollment_id = $1`, [enrollment.id]).then(r => r.rows),
    ]);
    if (!prospect || touchpoints.length === 0) continue;

    const accepted = hasAcceptedBranch(touchpoints) && await ctx.isAccepted(prospect);
    const path = buildMainPath(touchpoints, { accepted });
    if (path.length === 0) continue;

    const done = new Map();
    for (const s of sends) {
      if (s.touchpoint_id) done.set(s.touchpoint_id, s);
    }

    const baseTime = new Date(enrollment.started_at || enrollment.approved_at || enrollment.created_at).getTime();

    // Sortie de sécurité « durée maximale ». Rien ne bornait un enrollment
    // jusqu'ici : un contact pouvait rester en parcours indéfiniment si aucune
    // autre sortie ne tombait, et l'Historique ne l'aurait jamais vu sortir.
    // La borne vit sur le workflow (migration 114) ; les enrollments d'agent
    // qui n'en ont pas gardent leur comportement d'avant.
    if (enrollment.workflow_id) {
      const wf = await db.workflows.get(enrollment.workflow_id);
      const maxDays = wf?.max_duration_days;
      if (maxDays && Date.now() - baseTime > maxDays * 86400000) {
        await stopEnrollment(enrollment.id, 'max_duration');
        report.stopped++;
        continue;
      }
    }

    const outcome = await advanceOneStep({
      prospect,
      path,
      done,
      baseTime,
      ctx,
      ids: { enrollmentId: enrollment.id },
      report,
      onBounce: (reason) => stopEnrollment(enrollment.id, reason),
    });

    if (outcome === 'sequence_done') {
      await db.sequenceEnrollments.setStatus(enrollment.id, 'completed');
      report.completed++;
    }
  }

  return report;
}

/* ═══════════════════ Détection de réponses (Gmail + Outlook) ═══════════════════ */

async function insertActivity(userId, campaignId, prospect, type, dedupKey) {
  const [firstName, ...rest] = String(prospect.name || '').trim().split(/\s+/);
  await db.query(
    `INSERT INTO prospect_activities (user_id, campaign_id, opportunity_id, lemlist_activity_id, type, lead_email, lead_first_name, lead_last_name, company_name, happened_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (lemlist_activity_id) DO NOTHING`,
    [userId, campaignId || null, prospect.id, `native:${dedupKey}`, type, prospect.email || null, firstName || null, rest.join(' ') || null, prospect.company || null]
  );
}

async function gmailFetch(accessToken, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  return res.json();
}

/**
 * Détecte les réponses des prospects (campagnes natives ET enrollments) dans
 * les boîtes de l'utilisateur, stoppe leur séquence et passe la main à
 * l'autopilot.
 *
 * TOUTES les boîtes actives sont interrogées, pas seulement celle par défaut :
 * depuis la migration 112 une campagne part de la boîte de son choix, et la
 * réponse arrive dans celle-là. Ne regarder que la boîte par défaut ferait
 * tourner les autres campagnes à l'aveugle, ce qui serait pire que l'absence
 * de choix d'expéditeur.
 *
 * Un SMTP de domaine custom n'offre aucune API de lecture : l'arrêt sur
 * réponse y reste manuel (arbitrage Goran, non prioritaire).
 */
async function checkReplies(userId, campaigns, enrollments) {
  const report = { replies: 0, errors: [] };

  const accounts = (await emailOutbound.listActiveAccounts(userId))
    .filter(a => a.provider === 'gmail' || a.provider === 'microsoft');
  if (accounts.length === 0) return report;

  // Prospects candidats : au moins un email envoyé, séquence encore vivante.
  const candidates = [];
  if (campaigns.length > 0) {
    const r = await db.query(
      `SELECT DISTINCT ON (o.id) o.*
       FROM opportunities o
       JOIN campaign_sends cs ON cs.opportunity_id = o.id AND cs.channel = 'email' AND cs.status = 'sent'
       WHERE o.user_id = $1 AND o.campaign_id = ANY($2)
         AND o.sequence_stopped_at IS NULL AND o.email IS NOT NULL
       ORDER BY o.id, cs.sent_at DESC`,
      [userId, campaigns.map(c => c.id)]
    );
    for (const row of r.rows) candidates.push({ prospect: row, enrollmentId: null });
  }
  if (enrollments.length > 0) {
    const r = await db.query(
      `SELECT DISTINCT ON (o.id) o.*, se.id AS live_enrollment_id
       FROM sequence_enrollments se
       JOIN opportunities o ON o.id = se.opportunity_id
       JOIN campaign_sends cs ON cs.enrollment_id = se.id AND cs.channel = 'email' AND cs.status = 'sent'
       WHERE se.user_id = $1 AND se.id = ANY($2) AND o.email IS NOT NULL
       ORDER BY o.id, cs.sent_at DESC`,
      [userId, enrollments.map(e => e.id)]
    );
    for (const row of r.rows) candidates.push({ prospect: row, enrollmentId: row.live_enrollment_id });
  }
  if (candidates.length === 0) return report;

  const byEmail = new Map(candidates.map(c => [String(c.prospect.email).toLowerCase(), c]));
  const replied = new Set();

  // Une réponse trouvée se traite de la même façon quel que soit le fournisseur :
  // on stoppe la séquence, on trace l'activité, on classe l'intention et on
  // passe la main à l'autopilot (qui alerte l'utilisateur dans tous les cas).
  const handleReply = async (candidate, { messageId, snippet }) => {
    const prospect = candidate.prospect;
    if (replied.has(prospect.id)) return;
    replied.add(prospect.id);

    if (candidate.enrollmentId) {
      await stopEnrollment(candidate.enrollmentId, 'replied');
    } else {
      await stopSequence(userId, prospect.id, 'replied');
    }
    await insertActivity(userId, prospect.campaign_id, prospect, 'emailsReplied', messageId);
    report.replies++;

    // Classification d'intention puis autopilot · best-effort : la séquence
    // est déjà stoppée, c'est l'essentiel.
    try {
      const claude = require('../api/claude');
      const { intentEnumForPrompt, isKnownIntent } = require('./reply-intents');
      const result = await claude.callClaude(
        'Return only valid JSON.',
        `Classify this reply from an outreach prospect.\n\nReply (snippet): "${(snippet || '').slice(0, 500)}"\n\nReturn JSON: { "intent": ${intentEnumForPrompt()}, "sentiment": "positive"|"neutral"|"negative" }`,
        200,
        'native_reply_intent'
      );
      const intent = isKnownIntent(result.parsed?.intent) ? result.parsed.intent : 'question';

      // Le motif de sortie est l'unité de l'Historique et des statistiques.
      // La classification tombait APRÈS l'arrêt et n'était jamais écrite :
      // « Rendez-vous demandé » ne pouvait donc pas exister comme motif. On ne
      // réordonne pas pour autant (l'arrêt doit rester garanti même si le
      // classifieur échoue) : on précise le motif une fois qu'il est connu.
      // « Rendez-vous demandé » et jamais « RDV pris » : c'est une lecture de
      // la réponse, pas un fait.
      if (candidate.enrollmentId && intent === 'meeting_request') {
        await db.query(
          `UPDATE sequence_enrollments SET stop_reason = 'meeting_requested', updated_at = now()
            WHERE id = $1 AND stop_reason = 'replied'`,
          [candidate.enrollmentId]
        );
      }

      const autopilot = require('./conversation-autopilot');
      await autopilot.processReply(userId, {
        opportunityId: prospect.id,
        email: prospect.email,
        contactName: prospect.name,
        company: prospect.company,
        replyContent: snippet || '',
        intent,
        sentiment: result.parsed?.sentiment || 'neutral',
        channel: 'email',
        // Conteneur de la conversation : le compteur de tours repart de zéro
        // dans un nouveau workflow (la campagne est lue sur le contact
        // lui-même, cf. conversation-autopilot).
        enrollmentId: candidate.enrollmentId || null,
      });
    } catch (err) {
      report.errors.push(`autopilot ${prospect.email}: ${err.message}`);
    }
  };

  // Une boîte en panne (jeton expiré, consentement révoqué) ne doit pas
  // empêcher de regarder les autres : chaque boîte a son try.
  for (const account of accounts) {
    try {
      if (account.provider === 'gmail') {
        await checkRepliesGmail(account, byEmail, handleReply, report);
      } else {
        await checkRepliesOutlook(account, byEmail, handleReply, report);
      }
    } catch (err) {
      report.errors.push(`${account.email_address}: ${err.message}`);
    }
  }

  return report;
}

/** Lecture Gmail · même jeton OAuth que l'envoi, il faut donc le rafraîchir. */
async function checkRepliesGmail(account, byEmail, handleReply, report) {
  let fresh;
  try {
    fresh = await emailOutbound.refreshTokenIfNeeded(account);
  } catch (err) {
    report.errors.push(`token ${account.email_address}: ${err.message}`);
    return;
  }
  const accessToken = emailOutbound.decryptAccount(fresh).decryptedAccessToken;
  if (!accessToken) return;

  const emails = [...byEmail.keys()];
  // Requêtes par lot de 15 adresses · Gmail accepte les groupes from:(a OR b).
  for (let i = 0; i < emails.length; i += 15) {
    const chunk = emails.slice(i, i + 15);
    const q = encodeURIComponent(`in:inbox newer_than:${REPLY_LOOKBACK_DAYS}d from:(${chunk.join(' OR ')})`);
    const list = await gmailFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=25`);
    for (const m of list.messages || []) {
      const msg = await gmailFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From`);
      const fromHeader = (msg.payload?.headers || []).find(h => h.name === 'From')?.value || '';
      const fromEmail = (fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader).trim().toLowerCase();
      const candidate = byEmail.get(fromEmail);
      if (candidate) await handleReply(candidate, { messageId: m.id, snippet: msg.snippet || '' });
    }
  }
}

/**
 * Lecture Outlook · jeton Graph distinct de celui de l'envoi (migration 111).
 * Un jeton d'ENVOI expiré n'empêche donc pas de voir les réponses : une boîte à
 * reconnecter ferait sinon tourner les séquences à l'aveugle en plus de ne plus
 * envoyer.
 */
async function checkRepliesOutlook(account, byEmail, handleReply, report) {
  const graph = require('./microsoft-graph');
  const token = await graph.getReadToken(account);
  if (!token) {
    // Consentement jamais donné : on le signale une fois par passage, sans
    // crier · l'interface porte le bouton qui le répare.
    if (!graph.hasReadGrant(account)) {
      report.errors.push(`outlook: lecture des réponses non autorisée pour ${account.email_address}`);
    }
    return;
  }

  const since = new Date(Date.now() - REPLY_LOOKBACK_DAYS * DAY_MS).toISOString();
  const messages = await graph.listInboxSince(token, since);
  for (const msg of messages) {
    const candidate = byEmail.get(msg.fromEmail);
    if (candidate) await handleReply(candidate, { messageId: msg.id, snippet: msg.snippet });
  }
}

/* ═══════════════════ Points d'entrée ═══════════════════ */

/**
 * Passage complet pour un utilisateur : détection de réponses d'abord (pour
 * ne pas relancer quelqu'un qui vient de répondre), puis envoi des steps dus
 * des campagnes natives et des enrollments actifs.
 * `campaignId` restreint à une campagne, `enrollmentId` à un enrollment
 * (boutons « Traiter maintenant »).
 */
async function runForUser(userId, { campaignId, enrollmentId } = {}) {
  const outcome = await withLock(`native-seq-${userId}`, async () => {
    const report = { replies: 0, emailsSent: 0, linkedinActions: 0, skipped: 0, failed: 0, stopped: 0, completed: 0, errors: [] };

    let campaignsList = (await db.campaigns.list({ userId, status: 'active' }))
      .filter(c => c.send_channel === 'native');
    let enrollmentsList = await db.sequenceEnrollments.listByUser(userId, { status: 'active' });
    if (campaignId) {
      campaignsList = campaignsList.filter(c => c.id === campaignId);
      enrollmentsList = [];
    }
    if (enrollmentId) {
      enrollmentsList = enrollmentsList.filter(e => e.id === enrollmentId);
      campaignsList = [];
    }
    if (campaignsList.length === 0 && enrollmentsList.length === 0) return report;

    const replyReport = await checkReplies(userId, campaignsList, enrollmentsList);
    report.replies = replyReport.replies;
    report.errors.push(...replyReport.errors);
    if (replyReport.replies > 0) {
      // Les stops posés par checkReplies doivent être vus par ce passage.
      enrollmentsList = await db.sequenceEnrollments.listByUser(userId, { status: 'active' });
      if (enrollmentId) enrollmentsList = enrollmentsList.filter(e => e.id === enrollmentId);
      if (campaignId) enrollmentsList = [];
    }

    const sentTodayByAccount = await emailsSentTodayByAccount(userId);
    const defaultAccount = await emailOutbound.getDefaultAccount(userId);
    // Les envois d'avant la 112 (sans boîte enregistrée) sont imputés à la
    // boîte par défaut : c'est elle qui les a faits, tout partait d'elle.
    if (sentTodayByAccount.has('legacy') && defaultAccount) {
      const legacy = sentTodayByAccount.get('legacy');
      sentTodayByAccount.set(defaultAccount.id, (sentTodayByAccount.get(defaultAccount.id) || 0) + legacy);
      sentTodayByAccount.delete('legacy');
    }

    const ctx = {
      userId,
      ...createEmailBudget(sentTodayByAccount, defaultAccount?.id || null),
      linkedinExhausted: false,
      _cookie: undefined,
      _acceptedSet: undefined,
      async getLinkedinCookie() {
        if (this._cookie === undefined) {
          const { getUserKey } = require('../config');
          this._cookie = (await getUserKey(userId, 'linkedin')) || null;
        }
        return this._cookie;
      },
      /**
       * L'invitation LinkedIn de ce prospect a-t-elle été acceptée ?
       * Sources, chargées une fois par passage : le journal
       * linkedin_connect_accepted (posé par lib/linkedin-response-sync) et
       * l'état live des invitations envoyées (best-effort · un échec API ne
       * bloque pas le passage, la branche négative reste le défaut).
       */
      async isAccepted(prospect) {
        const publicId = publicIdOf(prospect);
        if (!publicId) return false;
        if (this._acceptedSet === undefined) {
          const set = new Set();
          try {
            const acts = await db.query(
              `SELECT content FROM prospect_activities
               WHERE user_id = $1 AND type = 'linkedin_connect_accepted'
                 AND created_at > now() - interval '90 days'`,
              [userId]
            );
            for (const row of acts.rows) {
              try {
                const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                if (content?.publicId) set.add(String(content.publicId).toLowerCase());
                const fromUrl = (content?.linkedin_url || '').match(/\/in\/([^/?]+)/)?.[1];
                if (fromUrl) set.add(fromUrl.toLowerCase());
              } catch { /* ligne illisible, on passe */ }
            }
          } catch (err) {
            logger.warn('native-seq', `accepted set (db): ${err.message}`);
          }
          const cookie = await this.getLinkedinCookie();
          if (cookie) {
            try {
              const linkedin = require('../api/linkedin');
              const invitations = await linkedin.getSentInvitations(cookie, { count: 100 });
              for (const inv of invitations) {
                if (inv.status === 'ACCEPTED' && inv.toPublicId) set.add(String(inv.toPublicId).toLowerCase());
              }
            } catch (err) {
              if (err.code === 'RATE_LIMITED' || err.code === 'SESSION_EXPIRED') this.linkedinExhausted = true;
              if (err.code === 'SESSION_EXPIRED') await notifyLinkedinExpired(userId);
            }
          }
          this._acceptedSet = set;
        }
        return this._acceptedSet.has(publicId);
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

    if (enrollmentsList.length > 0) {
      try {
        const r = await processEnrollments(enrollmentsList, ctx);
        report.emailsSent += r.emailsSent;
        report.linkedinActions += r.linkedinActions;
        report.skipped += r.skipped;
        report.failed += r.failed;
        report.stopped += r.stopped;
        report.completed += r.completed;
      } catch (err) {
        report.errors.push(`enrollments: ${err.message}`);
        logger.error('native-seq', `Enrollments user ${userId}: ${err.message}`);
      }
    }

    if (report.emailsSent + report.linkedinActions + report.replies > 0) {
      logger.info('native-seq', `User ${userId}: ${report.emailsSent} emails, ${report.linkedinActions} linkedin, ${report.replies} replies detected`);
    }
    return report;
  }, { ttlSeconds: 600 });

  // Un autre passage est en cours (cron vs « Traiter maintenant ») : rien à
  // faire, le passage en cours s'occupe des steps dus.
  if (!outcome.ran) return { locked: true, replies: 0, emailsSent: 0, linkedinActions: 0, skipped: 0, failed: 0, stopped: 0, completed: 0, errors: [] };
  return outcome.result;
}

/** Passage global (cron) : tous les utilisateurs ayant des campagnes natives
 *  actives ou des enrollments actifs. */
async function run() {
  const users = await db.query(
    `SELECT user_id FROM campaigns
     WHERE status = 'active' AND send_channel = 'native' AND user_id IS NOT NULL
     UNION
     SELECT user_id FROM sequence_enrollments WHERE status = 'active'`
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
  hasAcceptedBranch,
  parseTiming,
  renderTemplate,
  createEmailBudget,
  NATIVE_EMAIL_DAILY_CAP,
  NATIVE_EMAILS_PER_RUN,
};
