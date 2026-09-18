/**
 * CRM Digest · email hebdo « À traiter cette semaine ».
 *
 * Lundi 8h45 Paris (avant le reporting agent de 9h). Là où weekly-report ne
 * couvre que les utilisateurs avec campagnes de prospection actives, ce digest
 * s'adresse aux utilisateurs CRM : churn, deals stagnants, upsells, emails en
 * attente d'approbation, signaux · la même liste priorisée que le dashboard
 * (lib/priorities.js), sans appel LLM (données déjà prescriptives).
 *
 * Opt-out : catégorie `crm_digest` (lib/email-prefs.js, migration 101 · 
 * l'ancien interrupteur unique profiles.weekly_report a été migré).
 * Digest vide → pas d'envoi.
 */

const db = require('../../db');
const { sendEmail } = require('../../lib/email');
const { buildTodayList } = require('../../lib/priorities');
const logger = require('../../lib/logger');

const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');

const MAX_DIGEST_ITEMS = 10;

const TYPE_LABELS = {
  nurture_approval: { fr: 'Email prêt', en: 'Email ready', color: '#6E57FA' },
  deal_stagnant: { fr: 'Deal stagnant', en: 'Stagnant deal', color: '#f59e0b' },
  upsell: { fr: 'Upsell', en: 'Upsell', color: '#22c55e' },
  churn_risk: { fr: 'Risque churn', en: 'Churn risk', color: '#ef4444' },
  signal: { fr: 'Signal', en: 'Signal', color: '#3b82f6' },
  sla_breach: { fr: 'SLA dépassé', en: 'SLA breach', color: '#dc2626' },
};

// Détail lisible d'une violation SLA · le digest est le seul rendu backend
// bilingue, les items ne portent que slaKind/daysOverdue (le front traduit).
function slaDetail(item, isEN) {
  const d = item.daysOverdue;
  if (item.slaKind === 'new_lead') {
    return isEN ? `New lead never contacted for ${d} days` : `Lead entrant jamais contacté depuis ${d} jours`;
  }
  if (item.slaKind === 'followup_overdue') {
    return isEN ? `Planned follow-up overdue by ${d} days` : `Relance prévue dépassée de ${d} jours`;
  }
  return isEN ? `Open deal with no activity for ${d} days` : `Deal ouvert sans activité depuis ${d} jours`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function scoreColor(score) {
  if (score >= 75) return '#ef4444';
  if (score >= 55) return '#f59e0b';
  return '#22c55e';
}

async function runCrmDigests() {
  logger.info('crm-digest', 'Starting weekly CRM digests');

  const users = await db.query(
    `SELECT id, email, name, language FROM users WHERE onboarding_complete = true`
  );

  let sent = 0;
  let skipped = 0;
  for (const user of users.rows) {
    try {
      const result = await sendDigestToUser(user.id, user);
      if (result.sent) sent++; else skipped++;
    } catch (err) {
      logger.warn('crm-digest', `Failed for ${user.email}: ${err.message}`);
    }
  }

  logger.info('crm-digest', `Done: ${sent} sent, ${skipped} skipped`);
  return { sent, skipped };
}

/**
 * Envoie le digest à un utilisateur. `userRow` évite une requête quand on
 * vient de runCrmDigests ; la route de test l'omet.
 */
async function sendDigestToUser(userId, userRow = null) {
  let user = userRow;
  if (!user) {
    const r = await db.query(`SELECT id, email, name, language FROM users WHERE id = $1`, [userId]);
    user = r.rows[0];
    if (!user) return { sent: false, reason: 'user_not_found' };
  }

  // Scan data quality hebdo AVANT les early returns : l'historique du score doit
  // s'accumuler même pour un utilisateur opted-out ou sans action en attente.
  const { runWeeklyScans } = require('../../lib/crm-cleaning-agent');
  await runWeeklyScans(user.id).catch((err) =>
    logger.warn('crm-digest', `Weekly DQ scan failed for ${user.email}: ${err.message}`));
  const dqTrend = await computeDqTrend(user.id).catch(() => null);

  // Photo hebdo du forecast · matière première de la calibration dominicale
  // (forecast-engine.calibrate). Avant les early returns, même logique que DQ.
  const { takeSnapshot } = require('../../lib/forecast-engine');
  await takeSnapshot(user.id).catch((err) =>
    logger.warn('crm-digest', `Forecast snapshot failed for ${user.email}: ${err.message}`));

  // Photo du travail de la semaine écoulée (migration 105) · alimente l'en-tête
  // de ce digest et l'historique du bloc « Cette semaine » du dashboard. Avant
  // les early returns, même logique que le scan DQ : l'historique doit
  // s'accumuler même pour un utilisateur désabonné.
  const { snapshotWeek } = require('../../lib/activity-digest');
  const activity = await snapshotWeek(user.id, 1).catch((err) => {
    logger.warn('crm-digest', `Activity snapshot failed for ${user.email}: ${err.message}`);
    return null;
  });

  // Catégorie crm_digest (migration 101) · remplace l'interrupteur unique
  // profiles.weekly_report, dont les opt-outs existants ont été migrés.
  const { isEmailEnabled, emailFooter, unsubscribeHeaders } = require('../../lib/email-prefs');
  if (!(await isEmailEnabled(user.id, 'crm_digest'))) {
    return { sent: false, reason: 'opted_out' };
  }

  const list = await buildTodayList(user.id);
  if (list.items.length === 0) {
    return { sent: false, reason: 'empty' };
  }

  const lang = user.language || 'fr';
  const isEN = lang === 'en';
  const count = list.counts.total;

  const subject = isEN
    ? `${count} CRM action(s) waiting for you this week`
    : `${count} action(s) CRM vous attendent cette semaine`;

  await sendEmail({
    to: user.email,
    subject,
    html: buildDigestHTML(user, list, lang, dqTrend, activity) + emailFooter(user.id, 'crm_digest', lang),
    headers: unsubscribeHeaders(user.id, 'crm_digest'),
  });

  return { sent: true, count };
}

/**
 * Score data quality : moyenne des derniers scores par provider (hors lignes
 * sentinelles `__*__` qui portent score 0 par construction), comparée à la
 * même moyenne il y a ~7 jours. Renvoie null sans historique exploitable.
 */
async function computeDqTrend(userId) {
  const r = await db.query(
    `SELECT provider, score, created_at FROM crm_cleaning_reports
     WHERE user_id = $1 AND provider NOT LIKE '\\_\\_%'
       AND created_at > now() - interval '60 days'
     ORDER BY created_at ASC`,
    [userId]
  );
  if (r.rows.length === 0) return null;

  const avgAt = (cutoff) => {
    const latestPerProvider = new Map();
    for (const row of r.rows) {
      if (new Date(row.created_at) <= cutoff) latestPerProvider.set(row.provider, row.score);
    }
    if (latestPerProvider.size === 0) return null;
    const scores = [...latestPerProvider.values()];
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  };

  const current = avgAt(new Date());
  const previous = avgAt(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  return { current, previous, delta: current != null && previous != null ? current - previous : null };
}

function money(value, isEN) {
  const n = Math.round(Number(value) || 0);
  return isEN ? `€${n.toLocaleString('en-US')}` : `${n.toLocaleString('fr-FR')} €`;
}

/** « A, B et C » sans virgule avant le dernier terme. */
function joinClauses(clauses, isEN) {
  if (clauses.length <= 1) return clauses.join('');
  const last = clauses[clauses.length - 1];
  return `${clauses.slice(0, -1).join(', ')} ${isEN ? 'and' : 'et'} ${last}`;
}

/**
 * Phrase d'ouverture du bilan : ce que le travail a produit, pas ce qu'il a
 * coûté. Sans résultat, on bascule sur la veille plutôt que d'afficher des
 * zéros, qui se lisent comme une panne.
 */
function activitySentence(activity, isEN) {
  const { results, counters } = activity;
  const clauses = [];

  if (results.reactivatedCount > 0) {
    const n = results.reactivatedCount;
    const value = results.reactivatedValue > 0
      ? (isEN ? ` (${money(results.reactivatedValue, true)} in pipeline touched)`
              : ` (${money(results.reactivatedValue, false)} de pipeline touché)`)
      : '';
    clauses.push(isEN
      ? `got ${n} stalled deal${n > 1 ? 's' : ''} moving again${value}`
      : `fait repartir ${n} deal${n > 1 ? 's' : ''} dormant${n > 1 ? 's' : ''}${value}`);
  }

  if (results.replies > 0) {
    const n = results.replies;
    clauses.push(isEN
      ? `got ${n} repl${n > 1 ? 'ies' : 'y'} from clients who had gone quiet`
      : `obtenu ${n} réponse${n > 1 ? 's' : ''} de clients qui ne répondaient plus`);
  }

  if (results.churnAlerts > 0) {
    const n = results.churnAlerts;
    clauses.push(isEN
      ? `flagged ${n} client${n > 1 ? 's' : ''} starting to drift away`
      : `repéré ${n} client${n > 1 ? 's' : ''} en train de décrocher`);
  }

  if (clauses.length === 0) {
    const n = counters.accountsReviewed;
    return isEN
      ? `Last week baakalai reviewed ${n} account${n > 1 ? 's' : ''} and found nothing that needs you.`
      : `La semaine dernière, baakalai a relu ${n} compte${n > 1 ? 's' : ''} sans rien trouver qui mérite votre attention.`;
  }

  return isEN
    ? `Last week baakalai ${joinClauses(clauses, true)}.`
    : `La semaine dernière, baakalai a ${joinClauses(clauses, false)}.`;
}

/**
 * En-tête « le travail de la semaine ». Trois couches dans l'ordre : le
 * résultat, le volume qui le rend crédible, puis ce qui attend l'utilisateur.
 * La troisième n'est pas un aveu : sans elle, les deux premières ne sont
 * qu'une vitrine, et une vitrine ne se fait croire qu'une fois.
 */
function activityHTML(activity, lang) {
  if (!activity || !activity.hasWork) return '';
  const isEN = lang === 'en';
  const { counters, minutes, pending } = activity;
  const { formatDuration } = require('../../lib/activity-digest');

  // La phrase d'ouverture dit déjà « a relu N comptes » quand la semaine est
  // calme : on ne répète pas la ligne juste en dessous.
  const r = activity.results;
  const quiet = !(r.reactivatedCount || r.replies || r.churnAlerts);

  const volume = [
    quiet ? null : { n: counters.accountsReviewed, fr: ['compte relu', 'comptes relus'], en: ['account reviewed', 'accounts reviewed'] },
    { n: counters.signals, fr: ['signal qualifié', 'signaux qualifiés'], en: ['signal qualified', 'signals qualified'] },
    { n: counters.followUps, fr: ['relance rédigée', 'relances rédigées'], en: ['follow-up written', 'follow-ups written'] },
    { n: counters.issuesFound, fr: ['fiche à corriger repérée', 'fiches à corriger repérées'], en: ['record flagged for cleanup', 'records flagged for cleanup'] },
  ].filter((v) => v && v.n > 0)
    .map((v) => `${v.n} ${(isEN ? v.en : v.fr)[v.n > 1 ? 1 : 0]}`)
    .join(' · ');

  const waiting = [];
  if (pending.approvals > 0) {
    const d = pending.approvalsOldestDays;
    waiting.push(isEN
      ? `${pending.approvals} follow-up${pending.approvals > 1 ? 's' : ''} waiting for your approval${d > 1 ? `, the oldest for ${d} days` : ''}`
      : `${pending.approvals} relance${pending.approvals > 1 ? 's' : ''} en attente de votre validation${d > 1 ? `, la plus ancienne depuis ${d} jours` : ''}`);
  }
  if (pending.noEmail > 0) {
    waiting.push(isEN
      ? `${pending.noEmail} account${pending.noEmail > 1 ? 's' : ''} with no valid email, impossible to work on`
      : `${pending.noEmail} compte${pending.noEmail > 1 ? 's' : ''} sans email valide, impossible à travailler`);
  }

  return `
  <tr><td style="padding:20px 32px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ff;border:1px solid #e4dcff;border-radius:10px;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#4E3ED1;">
          ${isEN ? 'The work behind it' : 'Le travail de la semaine'}
        </div>
        <div style="font-size:15px;line-height:1.5;color:#27272a;margin-top:8px;">
          ${esc(activitySentence(activity, isEN))}
        </div>
        ${volume ? `
        <div style="font-size:12px;color:#71717a;margin-top:10px;">
          ${esc(volume)}.
          ${minutes >= 60
            ? esc(isEN
                ? `That is ${formatDuration(minutes, 'en')} of work nobody had to do.`
                : `Soit ${formatDuration(minutes, 'fr')} de travail que personne n'a eu à faire.`)
            : ''}
        </div>` : ''}
        ${waiting.length > 0 ? `
        <div style="font-size:12px;color:#B45309;background:#fef3c7;border-radius:6px;padding:8px 10px;margin-top:12px;">
          ${waiting.map((w) => esc(w)).join('<br>')}
        </div>` : ''}
      </td></tr>
    </table>
  </td></tr>`;
}

function buildDigestHTML(user, list, lang, dqTrend = null, activity = null) {
  const isEN = lang === 'en';
  const c = list.counts;

  // Alerte uniquement sur une vraie dégradation (> 5 pts en une semaine) · 
  // un score stable ou en hausse ne mérite pas de place dans le digest.
  const dqWarningHTML = (dqTrend && dqTrend.delta != null && dqTrend.delta < -5) ? `
    <tr><td style="padding:10px 24px;">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:13px;color:#991b1b;">
        ${isEN
          ? `⚠️ Your CRM data quality score dropped from ${dqTrend.previous} to ${dqTrend.current} this week, check the Data Quality page.`
          : `⚠️ Votre score de qualité CRM est passé de ${dqTrend.previous} à ${dqTrend.current} cette semaine, jetez un œil à la page Data Quality.`}
      </div>
    </td></tr>` : '';

  const chips = [
    { label: isEN ? 'Emails ready' : 'Emails prêts', value: c.nurturePending, color: '#6E57FA' },
    { label: isEN ? 'Stagnant deals' : 'Deals stagnants', value: c.dealCoach, color: '#f59e0b' },
    { label: 'Upsells', value: c.upsell, color: '#22c55e' },
    { label: isEN ? 'Churn risks' : 'Risques churn', value: c.churnRisks, color: '#ef4444' },
    { label: isEN ? 'Signals' : 'Signaux', value: c.signals, color: '#3b82f6' },
    { label: isEN ? 'SLA breaches' : 'SLA dépassés', value: c.slaBreaches, color: '#dc2626' },
  ].filter((chip) => chip.value > 0);

  const chipsHTML = chips.map((chip) => `
    <td style="padding:8px;text-align:center;">
      <div style="font-size:24px;font-weight:700;color:${chip.color};">${chip.value}</div>
      <div style="font-size:11px;color:#71717a;margin-top:4px;">${esc(chip.label)}</div>
    </td>
  `).join('');

  const itemRows = list.items.slice(0, MAX_DIGEST_ITEMS).map((item) => {
    const meta = TYPE_LABELS[item.type] || TYPE_LABELS.deal_stagnant;
    const who = [item.contactName || item.contactEmail || item.title, item.company]
      .filter(Boolean).join(' @ ');
    const detail = item.type === 'nurture_approval' ? item.subject
      : item.type === 'sla_breach' ? slaDetail(item, isEN)
      : (item.reason || item.title || '');
    return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;white-space:nowrap;">
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;color:${meta.color};background:${meta.color}14;">${esc(isEN ? meta.en : meta.fr)}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:13px;font-weight:600;color:#27272a;">${esc(who)}</div>
        ${detail ? `<div style="font-size:12px;color:#71717a;margin-top:2px;">${esc(detail)}</div>` : ''}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">
        <span style="font-size:12px;font-weight:700;color:${scoreColor(item.score)};">${item.score}</span>
      </td>
    </tr>`;
  }).join('');

  const more = list.items.length > MAX_DIGEST_ITEMS
    ? `<div style="font-size:12px;color:#71717a;margin-top:8px;text-align:center;">${isEN ? `+ ${list.items.length - MAX_DIGEST_ITEMS} more on your dashboard` : `+ ${list.items.length - MAX_DIGEST_ITEMS} autres sur votre dashboard`}</div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

  <!-- Header -->
  <tr><td style="background:#18181b;padding:24px 32px;">
    <div style="display:inline-flex;align-items:center;gap:10px;">
      <div style="width:32px;height:32px;background:#fff;color:#18181b;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;">b</div>
      <span style="color:#fff;font-size:18px;font-weight:600;">baakal.ai</span>
    </div>
    <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:8px;">
      ${isEN ? 'Your CRM knows who to follow up. Here is the list.' : 'Votre CRM sait qui relancer. Voici la liste.'}
    </div>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:24px 32px 0;">
    <div style="font-size:15px;color:#27272a;">
      ${isEN ? `Hi ${esc(user.name?.split(' ')[0] || 'there')},` : `Bonjour ${esc(user.name?.split(' ')[0] || '')},`}
    </div>
    <div style="font-size:13px;color:#71717a;margin-top:4px;">
      ${isEN ? `${list.counts.total} prioritized action(s) are waiting in your CRM this week.` : `${list.counts.total} action(s) priorisée(s) vous attendent dans votre CRM cette semaine.`}
    </div>
  </td></tr>

  <!-- Le travail de la semaine écoulée -->
  ${activityHTML(activity, lang)}

  <!-- Counts -->
  ${chips.length > 0 ? `
  <tr><td style="padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border-radius:8px;">
      <tr>${chipsHTML}</tr>
    </table>
  </td></tr>` : ''}

  <!-- Data quality drop warning -->
  ${dqWarningHTML}

  <!-- Items -->
  <tr><td style="padding:0 32px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:8px;overflow:hidden;">
      ${itemRows}
    </table>
    ${more}
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:8px 32px 24px;" align="center">
    <a href="${APP_URL}" style="display:inline-block;background:#6E57FA;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
      ${isEN ? 'Handle it now' : 'Traiter maintenant'} →
    </a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#fafafa;padding:16px 32px;border-top:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#a1a1aa;text-align:center;">
      Powered by <a href="${APP_URL}" style="color:#71717a;">Baakalai</a>, baakal.ai
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// buildDigestHTML est exporté pour pouvoir rendre le digest sans l'envoyer.
module.exports = { runCrmDigests, sendDigestToUser, buildDigestHTML };
