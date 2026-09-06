/**
 * Lifecycle Emails — Automated email sequences for user onboarding and retention.
 *
 * Sequences:
 * 1. Onboarding (post-signup): welcome → setup guide → first campaign → tips
 * 2. Retention (inactive users): re-engagement → feature highlight → personal check-in
 *
 * Sent via Resend (system emails, not user SMTP).
 * Scheduled by the orchestrator (daily check).
 */

const db = require('../db');
const { sendEmail } = require('./email');
const logger = require('./logger');

const APP_URL = process.env.APP_URL || 'https://app.baakal.ai';
const DAY_MS = 86400000;

// ── Email Templates ──

const ONBOARDING_SEQUENCE = [
  {
    delay: 0, // Immediately after signup
    key: 'welcome',
    subject: 'Bienvenue sur baakalai 👋',
    html: (user) => `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: #6E57FA; color: white; border-radius: 12px; font-weight: 700; font-size: 22px;">b</div>
        </div>
        <h2 style="font-size: 20px; margin-bottom: 12px;">Bienvenue ${user.name?.split(' ')[0] || ''} !</h2>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          Tu as rejoint baakalai — l'outil qui orchestre ta prospection et ton CRM avec l'IA.
          Chaque email envoyé, chaque réponse analysée rend le système plus intelligent.
        </p>
        <p style="font-size: 14px; font-weight: 600; margin-bottom: 16px;">Pour démarrer en 3 étapes :</p>
        <ol style="color: #71717a; font-size: 14px; line-height: 2; padding-left: 20px; margin-bottom: 24px;">
          <li>Connecte ton CRM (Pipedrive, HubSpot, Odoo...)</li>
          <li>Configure ton premier trigger d'activation</li>
          <li>Lance ta première campagne via le chat IA</li>
        </ol>
        <a href="${APP_URL}/chat" style="display: inline-block; background: #6E57FA; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Ouvrir baakalai →
        </a>
      </div>
    `,
  },
  {
    delay: 1, // Day 1
    key: 'setup_guide',
    subject: 'Connecte ton CRM en 2 minutes',
    html: (user) => `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="font-size: 20px; margin-bottom: 12px;">Connecte ton CRM</h2>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          ${user.name?.split(' ')[0] || 'Salut'}, baakalai fonctionne mieux quand il est connecté à ton CRM.
          Pipedrive, HubSpot, Salesforce, Odoo — tout se fait en un clic depuis les paramètres.
        </p>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 24px;">
          Une fois connecté, l'IA détecte automatiquement les deals stagnants,
          les contacts inactifs et les opportunités d'upsell.
        </p>
        <a href="${APP_URL}/settings" style="display: inline-block; background: #6E57FA; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Connecter mon CRM →
        </a>
      </div>
    `,
  },
  {
    delay: 3, // Day 3
    key: 'first_campaign',
    subject: 'Lance ta première campagne en 5 minutes',
    html: (user) => `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="font-size: 20px; margin-bottom: 12px;">Ta première campagne</h2>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          Tape dans le chat : "Crée une campagne de prospection pour [ton secteur]".
          L'IA génère une séquence complète (email + LinkedIn) en 30 secondes.
        </p>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 24px;">
          Tu peux ensuite la déployer sur Lemlist, Apollo ou Smartlead en un clic.
        </p>
        <a href="${APP_URL}/chat" style="display: inline-block; background: #6E57FA; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Créer ma campagne →
        </a>
      </div>
    `,
  },
  {
    delay: 7, // Day 7
    key: 'tips',
    subject: '3 astuces pour tirer le max de baakalai',
    html: (user) => `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="font-size: 20px; margin-bottom: 12px;">3 astuces pro</h2>
        <ol style="color: #71717a; font-size: 14px; line-height: 2.2; padding-left: 20px; margin-bottom: 24px;">
          <li><strong>Active le A/B testing</strong> sur tes triggers — baakalai teste automatiquement 2 variantes et garde la meilleure.</li>
          <li><strong>Consulte la Mémoire IA</strong> — elle apprend de chaque campagne et chaque réponse. Approuve les patterns qui te parlent.</li>
          <li><strong>Installe l'extension Chrome</strong> — ajoute des contacts depuis LinkedIn et vois leur statut CRM en direct.</li>
        </ol>
        <a href="${APP_URL}/memory" style="display: inline-block; background: #6E57FA; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Voir la Mémoire IA →
        </a>
      </div>
    `,
  },
];

const RETENTION_SEQUENCE = [
  {
    inactiveDays: 7, // 7 days without login
    key: 'reengagement',
    subject: 'Tes prospects t\'attendent 👀',
    html: (user, stats) => `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="font-size: 20px; margin-bottom: 12px;">${user.name?.split(' ')[0] || 'Salut'}, ça fait un moment !</h2>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          Pendant ton absence, l'IA a continué de travailler :
        </p>
        ${stats.newPatterns > 0 ? `<p style="font-size: 14px; margin-bottom: 8px;">📊 <strong>${stats.newPatterns} nouveaux patterns</strong> découverts</p>` : ''}
        ${stats.pendingEmails > 0 ? `<p style="font-size: 14px; margin-bottom: 8px;">📬 <strong>${stats.pendingEmails} emails</strong> en attente d'approbation</p>` : ''}
        ${stats.stagnantDeals > 0 ? `<p style="font-size: 14px; margin-bottom: 8px;">⚠️ <strong>${stats.stagnantDeals} deals</strong> stagnants détectés</p>` : ''}
        <div style="margin-top: 24px;">
          <a href="${APP_URL}/dashboard" style="display: inline-block; background: #6E57FA; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Voir mon dashboard →
          </a>
        </div>
      </div>
    `,
  },
  {
    inactiveDays: 14, // 14 days
    key: 'feature_highlight',
    subject: 'As-tu essayé les agents stratégiques ?',
    html: (user) => `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="font-size: 20px; margin-bottom: 12px;">Fonctionnalité que tu n'as peut-être pas vue</h2>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          Chaque dimanche, 8 agents IA analysent tes données pour trouver :
        </p>
        <ul style="color: #71717a; font-size: 14px; line-height: 2; padding-left: 20px; margin-bottom: 24px;">
          <li>Le meilleur jour/heure pour envoyer tes emails</li>
          <li>Les patterns qui marchent vs ceux qui ne convertissent pas</li>
          <li>Les deals à risque et les actions recommandées</li>
          <li>Les opportunités d'upsell sur tes clients existants</li>
        </ul>
        <a href="${APP_URL}/memory" style="display: inline-block; background: #6E57FA; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Voir ce que l'IA a trouvé →
        </a>
      </div>
    `,
  },
  {
    inactiveDays: 30, // 30 days
    key: 'personal_checkin',
    subject: 'On peut t\'aider ?',
    html: (user) => `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="font-size: 20px; margin-bottom: 12px;">${user.name?.split(' ')[0] || 'Salut'}, tout va bien ?</h2>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          Ça fait un mois qu'on ne t'a pas vu sur baakalai.
          Si quelque chose ne marche pas ou si tu as besoin d'aide pour configurer l'outil,
          réponds directement à cet email — Goran te répondra personnellement.
        </p>
        <p style="color: #71717a; font-size: 14px; line-height: 1.7; margin-bottom: 24px;">
          Si baakalai ne correspond pas à tes besoins actuels, pas de souci.
          Ton compte reste actif et tes données sont conservées.
        </p>
        <a href="${APP_URL}/dashboard" style="display: inline-block; background: #6E57FA; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Revenir sur baakalai →
        </a>
      </div>
    `,
  },
];

// ── Onboarding: send next email in sequence ──

async function processOnboarding() {
  const report = { sent: 0, skipped: 0, errors: [] };

  try {
    const users = await db.query(
      `SELECT id, name, email, created_at, data FROM users WHERE created_at > now() - interval '14 days'`
    );

    for (const user of users.rows) {
      const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.data) || {};
      const sentEmails = userData._onboarding_sent || [];
      const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTime()) / DAY_MS);

      for (const step of ONBOARDING_SEQUENCE) {
        if (sentEmails.includes(step.key)) continue;
        if (daysSinceSignup < step.delay) continue;

        // Un « Bienvenue » dix jours après l'inscription fait plus de mal que
        // de bien : au-delà d'une semaine de retard sur son créneau, l'étape
        // est marquée comme traitée sans être envoyée.
        if (daysSinceSignup > step.delay + 7) {
          sentEmails.push(step.key);
          await db.query(
            `UPDATE users SET data = jsonb_set(COALESCE(data, '{}')::jsonb, '{_onboarding_sent}', $1::jsonb) WHERE id = $2`,
            [JSON.stringify(sentEmails), user.id]
          );
          continue;
        }

        try {
          await sendEmail({
            to: user.email,
            subject: step.subject,
            html: step.html(user),
          });

          sentEmails.push(step.key);
          await db.query(
            `UPDATE users SET data = jsonb_set(COALESCE(data, '{}')::jsonb, '{_onboarding_sent}', $1::jsonb) WHERE id = $2`,
            [JSON.stringify(sentEmails), user.id]
          );
          report.sent++;
          logger.info('lifecycle', `Onboarding [${step.key}] sent to ${user.email}`);
        } catch (err) {
          report.errors.push(`${user.email}: ${err.message}`);
        }

        // Un seul email par utilisateur et par run : la séquence est un
        // goutte-à-goutte quotidien, jamais une rafale de rattrapage.
        break;
      }
    }
  } catch (err) {
    report.errors.push(`onboarding: ${err.message}`);
  }

  return report;
}

// ── Retention: re-engage inactive users ──

async function processRetention() {
  const report = { sent: 0, skipped: 0, errors: [] };

  try {
    // chat_messages ne porte pas user_id : l'activité passe par chat_threads.
    // (La version précédente jetait une erreur SQL à chaque run — la retention
    // n'a donc jamais envoyé un seul email.)
    const users = await db.query(
      `SELECT u.id, u.name, u.email, u.data,
        EXTRACT(EPOCH FROM (now() - COALESCE(
          (SELECT MAX(m.created_at) FROM chat_messages m
             JOIN chat_threads t ON t.id = m.thread_id
            WHERE t.user_id = u.id),
          u.created_at
        ))) / 86400 AS days_inactive
       FROM users u
       WHERE u.created_at < now() - interval '14 days'`
    );

    for (const user of users.rows) {
      let daysInactive = Math.floor(parseFloat(user.days_inactive) || 0);
      const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.data) || {};
      const sentRetention = userData._retention_sent || [];

      // Plancher d'inactivité : posé au rallumage de l'orchestrateur
      // (2026-08-04) sur les comptes existants, pour que la reprise ne
      // déclenche pas une rafale de relances sur des mois d'inactivité
      // accumulée pendant que les crons étaient éteints. L'inactivité de ces
      // comptes se mesure depuis le plancher ; les nouveaux comptes n'en ont
      // pas et suivent le comportement normal.
      if (userData._retention_floor) {
        const floorDays = Math.floor((Date.now() - new Date(userData._retention_floor).getTime()) / DAY_MS);
        if (Number.isFinite(floorDays)) daysInactive = Math.min(daysInactive, Math.max(0, floorDays));
      }

      // Palier le plus profond applicable — jamais plusieurs à la fois. Un
      // utilisateur inactif 35 jours reçoit le « personal check-in », pas les
      // trois relances de l'échelle dans la même minute.
      const applicable = RETENTION_SEQUENCE.filter(s => daysInactive >= s.inactiveDays);
      const step = applicable[applicable.length - 1];
      if (!step || sentRetention.includes(step.key)) continue;

      try {
        // Gather stats for the re-engagement email
        let stats = {};
        if (step.key === 'reengagement') {
          const [patterns, pending, stagnant] = await Promise.all([
            db.query('SELECT COUNT(*) AS c FROM memory_patterns WHERE date_discovered > now() - interval \'7 days\''),
            db.query('SELECT COUNT(*) AS c FROM nurture_emails WHERE user_id = $1 AND status = \'pending\'', [user.id]),
            db.query('SELECT COUNT(*) AS c FROM opportunities WHERE user_id = $1 AND status = \'open\' AND updated_at < now() - interval \'14 days\'', [user.id]),
          ]);
          stats = {
            newPatterns: parseInt(patterns.rows[0]?.c || 0),
            pendingEmails: parseInt(pending.rows[0]?.c || 0),
            stagnantDeals: parseInt(stagnant.rows[0]?.c || 0),
          };
        }

        await sendEmail({
          to: user.email,
          subject: step.subject,
          html: step.html(user, stats),
        });

        // Les paliers moins profonds sont marqués aussi : une fois le
        // check-in 30 jours parti, la relance 7 jours n'a plus de sens.
        const newSent = [...new Set([...sentRetention, ...applicable.map(s => s.key)])];
        await db.query(
          `UPDATE users SET data = jsonb_set(COALESCE(data, '{}')::jsonb, '{_retention_sent}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(newSent), user.id]
        );
        report.sent++;
        logger.info('lifecycle', `Retention [${step.key}] sent to ${user.email} (inactive ${daysInactive}d)`);
      } catch (err) {
        report.errors.push(`${user.email}: ${err.message}`);
      }
    }
  } catch (err) {
    report.errors.push(`retention: ${err.message}`);
  }

  return report;
}

// ── Main entry point (called by orchestrator daily) ──

async function runLifecycleEmails() {
  const onboarding = await processOnboarding();
  const retention = await processRetention();

  return {
    onboarding,
    retention,
    total: onboarding.sent + retention.sent,
  };
}

module.exports = { runLifecycleEmails, processOnboarding, processRetention };
