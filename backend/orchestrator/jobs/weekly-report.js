/**
 * Weekly Report Agent
 *
 * Runs every Monday at 9am Paris via orchestrator cron.
 * For each active user: gathers stats, generates recommendations
 * via Claude Sonnet, builds HTML email, sends via Resend.
 */

const db = require('../../db');
const { callClaude } = require('../../api/claude');
const { sendEmail } = require('../../lib/email');
const logger = require('../../lib/logger');

const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');

async function runWeeklyReports() {
  logger.info('weekly-report', 'Starting weekly reports');

  // Find users with active campaigns
  const usersResult = await db.query(
    "SELECT DISTINCT u.id, u.email, u.name, u.language FROM users u " +
    "INNER JOIN campaigns c ON c.user_id = u.id WHERE c.status = 'active'"
  );
  const users = usersResult.rows || [];

  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    try {
      // Opt-out : catégorie weekly_report (lib/email-prefs.js, migration 101)
      const { isEmailEnabled, emailFooter, unsubscribeHeaders } = require('../../lib/email-prefs');
      if (!(await isEmailEnabled(user.id, 'weekly_report'))) {
        skipped++;
        continue;
      }

      const report = await buildUserReport(user);
      if (!report) { skipped++; continue; }

      await sendEmail({
        to: user.email,
        subject: report.subject,
        html: report.html + emailFooter(user.id, 'weekly_report', user.language || 'fr'),
        headers: unsubscribeHeaders(user.id, 'weekly_report'),
      });

      sent++;
      logger.info('weekly-report', `Sent to ${user.email}`);
    } catch (err) {
      logger.warn('weekly-report', `Failed for ${user.email}: ${err.message}`);
    }
  }

  logger.info('weekly-report', `Done: ${sent} sent, ${skipped} skipped`);
  return { sent, skipped };
}

async function buildUserReport(user) {
  const lang = user.language || 'fr';
  const campaigns = await db.campaigns.list({ userId: user.id, limit: 20 });
  const active = campaigns.filter(c => c.status === 'active');

  if (active.length === 0) return null;

  // Aggregate stats
  const totalContacts = active.reduce((s, c) => s + (c.nb_prospects || 0), 0);
  const avgOpen = active.filter(c => c.open_rate != null).reduce((s, c, _, a) => s + c.open_rate / a.length, 0);
  const avgReply = active.filter(c => c.reply_rate != null).reduce((s, c, _, a) => s + c.reply_rate / a.length, 0);
  const totalMeetings = active.reduce((s, c) => s + (c.meetings || 0), 0);

  // Generate recommendations via Claude
  const recs = await generateRecommendations(active, { totalContacts, avgOpen, avgReply, totalMeetings }, lang);

  // Build HTML
  const subject = lang === 'en'
    ? `Your weekly Baakalai report, ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : `Votre rapport hebdomadaire Baakalai, ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;

  const html = buildEmailHTML(user, active, { totalContacts, avgOpen, avgReply, totalMeetings }, recs, lang);

  return { subject, html, stats: { totalContacts, avgOpen, avgReply, totalMeetings } };
}

async function generateRecommendations(campaigns, stats, lang) {
  const campaignSummary = campaigns.map(c =>
    `"${c.name}": ${c.nb_prospects || 0} prospects, open ${c.open_rate || 0}%, reply ${c.reply_rate || 0}%, ${c.meetings || 0} meetings`
  ).join('\n');

  const prompt = lang === 'en'
    ? `Based on these campaign stats, give exactly 3 short actionable recommendations (1 line each). Focus on what to improve this week. Reply as a JSON array of 3 strings.`
    : `A partir de ces stats de campagne, donne exactement 3 recommandations courtes et actionnables (1 ligne chacune). Focus sur quoi améliorer cette semaine. Réponds en JSON array de 3 strings.`;

  try {
    const result = await callClaude(prompt, campaignSummary, 500, 'weeklyReport');
    if (result.parsed && Array.isArray(result.parsed)) return result.parsed.slice(0, 3);
    const match = result.raw.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]).slice(0, 3);
  } catch { /* fallback */ }

  return lang === 'en'
    ? ['Review your lowest-performing campaign subject lines', 'Consider A/B testing your best campaign', 'Add more prospects to campaigns under 50 contacts']
    : ['Revois les objets de tes campagnes les moins performantes', 'Lance un A/B test sur ta meilleure campagne', 'Ajoute plus de prospects aux campagnes sous 50 contacts'];
}

function buildEmailHTML(user, campaigns, stats, recommendations, lang) {
  const isEN = lang === 'en';
  const statCards = [
    { label: isEN ? 'Contacts reached' : 'Contacts atteints', value: stats.totalContacts, color: '#2AB7CA' },
    { label: isEN ? 'Open rate' : "Taux d'ouverture", value: `${Math.round(stats.avgOpen)}%`, color: '#FED766' },
    { label: isEN ? 'Reply rate' : 'Taux de réponse', value: `${Math.round(stats.avgReply)}%`, color: '#FE4A49' },
    { label: isEN ? 'Meetings booked' : 'RDV obtenus', value: stats.totalMeetings, color: '#16a34a' },
  ];

  const statsHTML = statCards.map(s => `
    <td style="padding:8px;text-align:center;width:25%;">
      <div style="font-size:24px;font-weight:700;color:${s.color};">${s.value}</div>
      <div style="font-size:11px;color:#71717a;margin-top:4px;">${s.label}</div>
    </td>
  `).join('');

  const campaignRows = campaigns.slice(0, 5).map(c => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;border-bottom:1px solid #f0f0f0;">${c.name}</td>
      <td style="padding:8px 12px;font-size:12px;color:#71717a;border-bottom:1px solid #f0f0f0;">${c.nb_prospects || 0}</td>
      <td style="padding:8px 12px;font-size:12px;color:#71717a;border-bottom:1px solid #f0f0f0;">${c.open_rate || 0}%</td>
      <td style="padding:8px 12px;font-size:12px;color:#71717a;border-bottom:1px solid #f0f0f0;">${c.reply_rate || 0}%</td>
    </tr>
  `).join('');

  const recsHTML = recommendations.map(r => `
    <li style="margin-bottom:8px;font-size:13px;color:#27272a;line-height:1.5;">${r}</li>
  `).join('');

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
      ${isEN ? 'Your weekly report' : 'Votre rapport hebdomadaire'}
    </div>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:24px 32px 0;">
    <div style="font-size:15px;color:#27272a;">
      ${isEN ? `Hi ${user.name?.split(' ')[0] || 'there'},` : `Bonjour ${user.name?.split(' ')[0] || ''},`}
    </div>
    <div style="font-size:13px;color:#71717a;margin-top:4px;">
      ${isEN ? "Here's your prospecting performance this week." : 'Voici tes performances de prospection cette semaine.'}
    </div>
  </td></tr>

  <!-- Stats -->
  <tr><td style="padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border-radius:8px;">
      <tr>${statsHTML}</tr>
    </table>
  </td></tr>

  <!-- Campaigns -->
  <tr><td style="padding:0 32px 16px;">
    <div style="font-size:14px;font-weight:600;color:#27272a;margin-bottom:8px;">
      ${isEN ? 'Active campaigns' : 'Campagnes actives'}
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:8px;overflow:hidden;">
      <tr style="background:#fafafa;">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#71717a;font-weight:600;">${isEN ? 'Campaign' : 'Campagne'}</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#71717a;font-weight:600;">${isEN ? 'Prospects' : 'Prospects'}</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#71717a;font-weight:600;">${isEN ? 'Opens' : 'Ouverture'}</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#71717a;font-weight:600;">${isEN ? 'Replies' : 'Réponse'}</th>
      </tr>
      ${campaignRows}
    </table>
  </td></tr>

  <!-- Recommendations -->
  <tr><td style="padding:0 32px 20px;">
    <div style="font-size:14px;font-weight:600;color:#27272a;margin-bottom:8px;">
      ${isEN ? '💡 Recommendations' : '💡 Recommandations'}
    </div>
    <ul style="margin:0;padding-left:20px;">${recsHTML}</ul>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 32px 24px;" align="center">
    <a href="${APP_URL}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
      ${isEN ? 'View dashboard' : 'Voir le dashboard'} →
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

module.exports = { runWeeklyReports, buildUserReport };
