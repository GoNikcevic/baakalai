const { Router } = require('express');
const db = require('../db');
const lemlist = require('../api/lemlist');
const { kpiCache } = require('../lib/cache');
const { getUserKey } = require('../config');
const hubspotSync = require('../orchestrator/jobs/hubspot-sync');

const router = Router();

// GET /api/dashboard · Aggregated KPIs + active campaigns (cached 5 min)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cacheKey = `kpis:${userId}`;
    const cached = kpiCache.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const [kpis, campaigns] = await Promise.all([
      db.dashboardKpis(userId),
      db.campaigns.list({ status: 'active', userId, limit: 50 }),
    ]);

    // Auto-sync stats from Lemlist if campaigns have null open_rate
    // (means stats were never collected with the working v2 endpoint)
    const stale = campaigns.some(c => c.lemlist_id && c.open_rate == null);
    if (stale) {
      // Fire-and-forget: sync in background, don't block dashboard load
      syncStatsBackground(userId).catch(() => {});
    }

    const result = { kpis, campaigns };
    kpiCache.set(cacheKey, result, 5 * 60 * 1000); // 5 min TTL
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Background stats sync · pulls fresh stats from Lemlist for all
 * user campaigns and updates the DB. Called automatically when the
 * dashboard detects stale data (open_rate == null).
 */
async function syncStatsBackground(userId) {
  try {
    const apiKey = await getUserKey(userId, 'lemlist');
    if (!apiKey) return;

    const campaigns = await db.campaigns.list({ userId });
    const linked = campaigns.filter(c => c.lemlist_id);

    for (const campaign of linked) {
      try {
        const rawStats = await lemlist.getCampaignStats(campaign.lemlist_id, apiKey);
        const stats = lemlist.transformCampaignStats(rawStats);
        await db.campaigns.update(campaign.id, {
          nb_prospects: stats.contacts,
          open_rate: stats.openRate,
          reply_rate: stats.replyRate,
          accept_rate_lk: stats.acceptRate,
          interested: stats.interested,
          meetings: stats.meetings,
          stops: stats.stops,
          last_collected: new Date().toISOString().split('T')[0],
        });
      } catch (err) {
        console.warn(`[dashboard] Stats sync failed for ${campaign.name}:`, err.message);
      }
    }

    // Invalidate KPI cache so next load shows fresh data
    kpiCache.invalidate(`kpis:${userId}`);
  } catch (err) {
    console.warn('[dashboard] Background stats sync failed:', err.message);
  }
}

// POST /api/dashboard/refresh-stats · Manual refresh of Lemlist stats (rate limited)
const rateLimit = require('express-rate-limit');
const refreshLimiter = rateLimit({ windowMs: 60000, max: 3, message: { error: 'Too many refresh requests, please wait' } });
router.post('/refresh-stats', refreshLimiter, async (req, res, next) => {
  try {
    const apiKey = await getUserKey(req.user.id, 'lemlist');
    if (!apiKey) return res.json({ ok: false, error: 'No Lemlist API key' });

    const campaigns = await db.campaigns.list({ userId: req.user.id });
    const linked = campaigns.filter(c => c.lemlist_id);
    const results = [];

    for (const campaign of linked) {
      try {
        const rawStats = await lemlist.getCampaignStats(campaign.lemlist_id, apiKey);
        const stats = lemlist.transformCampaignStats(rawStats);
        await db.campaigns.update(campaign.id, {
          nb_prospects: stats.contacts,
          open_rate: stats.openRate,
          reply_rate: stats.replyRate,
          accept_rate_lk: stats.acceptRate,
          interested: stats.interested,
          meetings: stats.meetings,
          stops: stats.stops,
          last_collected: new Date().toISOString().split('T')[0],
        });
        results.push({ campaign: campaign.name, stats, raw: rawStats ? Object.keys(rawStats) : null });
      } catch (err) {
        results.push({ campaign: campaign.name, error: err.message });
      }
    }

    kpiCache.invalidate(`kpis:${req.user.id}`);
    const kpis = await db.dashboardKpis(req.user.id);
    res.json({ ok: true, kpis, results });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/memory · Cross-campaign patterns (paginated)
router.get('/memory', async (req, res, next) => {
  try {
    const { category, confidence, lang } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const patterns = await db.memoryPatterns.list({ category, confidence, limit, offset, userId: req.user.id });

    // Translate patterns to the user's language (patterns are a mix of FR and EN from different agents)
    const targetLang = lang || 'fr';
    if (patterns.length > 0) {
      try {
        const claude = require('../api/claude');
        const textsToTranslate = patterns.slice(0, 10).map(p => p.pattern).join('\n---\n');
        const targetLabel = targetLang === 'fr' ? 'French' : 'English';
        const result = await claude.callClaude(
          `You are a translator. Translate each text to ${targetLabel}. If a text is already in ${targetLabel}, return it unchanged. Return a JSON array of translated strings, one per input.`,
          `Translate these CRM/sales insights to ${targetLabel} (keep same order, return JSON array of strings):\n\n${textsToTranslate}`,
          500, 'translate_patterns'
        );
        let translations = result.parsed;
        if (!translations && result.raw) {
          const m = result.raw.match(/\[[\s\S]*\]/);
          if (m) try { translations = JSON.parse(m[0]); } catch { /* ignore */ }
        }
        if (Array.isArray(translations)) {
          for (let i = 0; i < Math.min(translations.length, patterns.length); i++) {
            if (translations[i]) patterns[i].pattern = translations[i];
          }
        }
      } catch { /* translation is best-effort, return as-is if it fails */ }
    }

    res.json({ patterns });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/opportunities (paginated)
// Non-admin team members only see contacts they own
//
// `sort=silence` classe du plus long silence au plus court, les contacts sans
// activité connue d'abord. Ce n'est pas un confort d'affichage : la Vue globale
// trie côté client dans la fenêtre qu'elle a reçue, et le tri par défaut
// (created_at DESC) remplit cette fenêtre avec les contacts les plus RÉCENTS.
// Passé le plafond, les deals qui dorment depuis le plus longtemps, exactement
// ceux que la page existe pour retrouver, étaient donc les premiers exclus.
router.get('/opportunities', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const orderBy = req.query.sort === 'silence'
      ? 'last_activity_at ASC NULLS FIRST'
      : 'created_at DESC';

    // Filter by owner for non-admin team members
    const isAdmin = !req.teamRole || req.teamRole === 'admin';
    if (isAdmin) {
      const opportunities = await db.opportunities.listByUser(req.user.id, limit, offset, orderBy);
      res.json({ opportunities });
    } else {
      // Non-admin: only show contacts owned by this user
      const result = await db.query(
        `SELECT * FROM opportunities
         WHERE (user_id = $1 OR owner_id = $1)
         AND (owner_id = $1 OR owner_id IS NULL)
         ORDER BY ${orderBy} LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      );
      res.json({ opportunities: result.rows });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/reports (paginated)
router.get('/reports', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const reports = await db.reports.listByUser(req.user.id, limit, offset);
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/chart-data
router.get('/chart-data', async (req, res, next) => {
  try {
    const data = await db.chartData.listByUser(req.user.id);
    res.json({ chartData: data });
  } catch (err) {
    next(err);
  }
});

// POST /api/dashboard/opportunities · Create opportunity (invalidates KPI cache)
router.post('/opportunities', async (req, res, next) => {
  try {
    const { name, email, company, companySize, title, status, timing, linkedinUrl, campaignId } = req.body;
    const opportunity = await db.opportunities.create({
      userId: req.user.id, name, email, company, companySize, title,
      status: status || 'new', timing, linkedinUrl, campaignId,
    });

    // Invalidate KPI cache for this user
    kpiCache.invalidate(`kpis:${req.user.id}`);

    hubspotSync.onStatusChange({
      opportunityId: opportunity.id,
      newStatus: opportunity.status,
    }).catch(console.error);

    res.status(201).json(opportunity);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dashboard/opportunities/:id
router.patch('/opportunities/:id', async (req, res, next) => {
  try {
    const existing = await db.opportunities.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Opportunity not found' });
    if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = await db.opportunities.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'No changes' });

    const newStatus = req.body.status;
    if (newStatus && newStatus !== existing.status) {
      hubspotSync.onStatusChange({
        opportunityId: updated.id,
        newStatus,
      }).catch(console.error);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/dashboard/recommendation-feedback
router.post('/recommendation-feedback', async (req, res, next) => {
  try {
    const { patternId, patternText, feedback } = req.body;
    if (!feedback || !['useful', 'not_useful'].includes(feedback)) {
      return res.status(400).json({ error: 'Invalid feedback' });
    }
    const result = await db.recoFeedback.create(req.user.id, patternId || null, patternText, feedback);

    // If not_useful, lower confidence of the pattern
    if (feedback === 'not_useful' && patternId) {
      const pattern = await db.memoryPatterns.get(patternId);
      if (pattern && pattern.confidence === 'Haute') {
        await db.memoryPatterns.update(patternId, { confidence: 'Moyenne' });
      } else if (pattern && pattern.confidence === 'Moyenne') {
        await db.memoryPatterns.update(patternId, { confidence: 'Faible' });
      }
    }

    res.json({ saved: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/activation · Activation/retention metrics
//
// Trois incohérences corrigées ici, toutes visibles à l'écran :
//
// 1. Les segments étaient calculés sur les 500 premières opportunités
//    chargées en mémoire · au delà, les compteurs étaient faux sans le dire.
//    Tout est compté en SQL.
// 2. « Stagnant » valait 30 à 90 jours en dur, alors que la dormance est un
//    réglage de l'utilisateur (lib/stagnation.js) et que la file de
//    réactivation applique en plus la date de relance planifiée. Même
//    définition ici que lib/reactivation-queue.listDealsToReactivate, sinon
//    deux écrans annoncent deux nombres pour la même chose.
// 3. « Risque de churn » valait « 90 jours sans activité », alors que le
//    churn a un score (lib/churn-scoring.js) utilisé par la nav, la page
//    Clients à risque et le scoring. Même seuil ici : AT_RISK_THRESHOLD.
router.get('/activation', async (req, res, next) => {
  try {
    const { getStagnantDays } = require('../lib/stagnation');
    const { AT_RISK_THRESHOLD } = require('../lib/churn-scoring');
    const userId = req.user.id;
    const stagnantDays = String(await getStagnantDays(userId));

    // Deal dormant : ouvert, issu du CRM (un prospect froid de campagne n'a
    // rien à réactiver), et silencieux au delà du seuil ou dont la date de
    // relance planifiée est passée.
    const STAGNANT_COND = `
      status NOT IN ('won', 'lost')
      AND campaign_id IS NULL
      AND (
        (planned_followup_date IS NULL AND COALESCE(last_activity_at, created_at) < now() - ($2 || ' days')::interval)
        OR (planned_followup_date IS NOT NULL AND planned_followup_date <= now())
      )`;
    const CHURN_COND = `status = 'won' AND churn_score >= $3`;

    // Joignable d'abord (un deal sans email n'est pas actionnable), puis le
    // plus dormant : même classement que la carte d'action du dashboard.
    const TOP_SELECT = `
      SELECT id, name, title, company, email,
             GREATEST(0, EXTRACT(day FROM now() - COALESCE(last_activity_at, created_at))::int) AS days
        FROM opportunities
       WHERE user_id = $1 AND `;
    const TOP_ORDER = `
       ORDER BY (email IS NULL OR btrim(email) = '') ASC,
                COALESCE(last_activity_at, created_at) ASC
       LIMIT 5`;

    const [segments, topStagnantRows, topChurnRows, recentEmails, triggers] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'won')::int AS won,
               COUNT(*) FILTER (WHERE status NOT IN ('won', 'lost') AND NOT (${STAGNANT_COND}))::int AS active,
               COUNT(*) FILTER (WHERE ${STAGNANT_COND})::int AS stagnant,
               COUNT(*) FILTER (WHERE ${CHURN_COND})::int AS churn_risk
          FROM opportunities WHERE user_id = $1
      `, [userId, stagnantDays, AT_RISK_THRESHOLD]),
      db.query(`${TOP_SELECT} ${STAGNANT_COND} ${TOP_ORDER}`, [userId, stagnantDays]),
      // Le seuil de churn est ici $2, pas $3 : un paramètre déclaré mais non
      // utilisé fait échouer la requête (« could not determine data type of
      // parameter $2 »).
      db.query(
        `${TOP_SELECT} status = 'won' AND churn_score >= $2 ORDER BY churn_score DESC NULLS LAST LIMIT 5`,
        [userId, AT_RISK_THRESHOLD]
      ),
      db.query(
        `SELECT status, COUNT(*) as count FROM nurture_emails
          WHERE user_id = $1 AND created_at > now() - interval '30 days' GROUP BY status`,
        [userId]
      ),
      db.query(
        `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE enabled) as active FROM nurture_triggers WHERE user_id = $1`,
        [userId]
      ),
    ]);

    const emailStats = {};
    for (const row of recentEmails.rows) emailStats[row.status] = parseInt(row.count, 10);

    const toCard = (row) => ({
      id: row.id, name: row.name, title: row.title, company: row.company, email: row.email,
      daysSinceUpdate: row.days,
    });
    const seg = segments.rows[0];

    return res.json({
      segments: {
        total: seg.total,
        won: seg.won,
        active: seg.active,
        stagnant: seg.stagnant,
        churnRisk: seg.churn_risk,
      },
      stagnantDays: parseInt(stagnantDays, 10),
      topStagnant: topStagnantRows.rows.map(toCard),
      topChurnRisk: topChurnRows.rows.map(toCard),
      emailsLast30d: emailStats,
      triggers: {
        total: parseInt(triggers.rows[0]?.total || 0, 10),
        active: parseInt(triggers.rows[0]?.active || 0, 10),
      },
    });
  } catch (err) {
    next(err);
  }
});


/**
 * GET /api/dashboard/weekly-activity · ce que baakalai a fait cette semaine.
 *
 * Agrégé à la volée depuis les tables des agents (lib/activity-digest.js), pas
 * depuis les snapshots : le bloc doit répondre dès le premier jour, y compris
 * sur staging où l'orchestrateur est coupé.
 * `weeksAgo=1` renvoie la semaine complète précédente.
 */
router.get('/weekly-activity', async (req, res, next) => {
  try {
    const raw = parseInt(req.query.weeksAgo, 10);
    const weeksAgo = Number.isFinite(raw) ? Math.min(12, Math.max(0, raw)) : 0;

    const cacheKey = `activity:${req.user.id}:${weeksAgo}`;
    const cached = kpiCache.get(cacheKey);
    if (cached) return res.json(cached);

    const { getDashboardActivity } = require('../lib/activity-digest');
    const activity = await getDashboardActivity(req.user.id, weeksAgo);

    kpiCache.set(cacheKey, activity, 5 * 60 * 1000);
    res.json(activity);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
