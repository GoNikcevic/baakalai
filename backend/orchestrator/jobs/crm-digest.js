/**
 * CRM Digest — email hebdo « À traiter cette semaine ».
 *
 * Lundi 8h45 Paris (avant le reporting agent de 9h). Là où weekly-report ne
 * couvre que les utilisateurs avec campagnes de prospection actives, ce digest
 * s'adresse aux utilisateurs CRM : churn, deals stagnants, upsells, emails en
 * attente d'approbation, signaux — la même liste priorisée que le dashboard
 * (lib/priorities.js), sans appel LLM (données déjà prescriptives).
 *
 * Opt-out : réutilise profiles.weekly_report (un seul interrupteur pour tous
 * les emails de rapport). Digest vide → pas d'envoi.
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

// Détail lisible d'une violation SLA — le digest est le seul rendu backend
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

  // Photo hebdo du forecast — matière première de la calibration dominicale
  // (forecast-engine.calibrate). Avant les early returns, même logique que DQ.
  const { takeSnapshot } = require('../../lib/forecast-engine');
  await takeSnapshot(user.id).catch((err) =>
    logger.warn('crm-digest', `Forecast snapshot failed for ${user.email}: ${err.message}`));

  const profile = await db.profiles.get(user.id).catch(() => null);
  if (profile && profile.weekly_report === false) {
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
    html: buildDigestHTML(user, list, lang, dqTrend),
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

function buildDigestHTML(user, list, lang, dqTrend = null) {
  const isEN = lang === 'en';
  const c = list.counts;

  // Alerte uniquement sur une vraie dégradation (> 5 pts en une semaine) —
  // un score stable ou en hausse ne mérite pas de place dans le digest.
  const dqWarningHTML = (dqTrend && dqTrend.delta != null && dqTrend.delta < -5) ? `
    <tr><td style="padding:10px 24px;">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:13px;color:#991b1b;">
        ${isEN
          ? `⚠️ Your CRM data quality score dropped from ${dqTrend.previous} to ${dqTrend.current} this week — check the Data Quality page.`
          : `⚠️ Votre score de qualité CRM est passé de ${dqTrend.previous} à ${dqTrend.current} cette semaine — jetez un œil à la page Data Quality.`}
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
      Powered by <a href="${APP_URL}" style="color:#71717a;">Baakalai</a> — baakal.ai
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { runCrmDigests, sendDigestToUser };
