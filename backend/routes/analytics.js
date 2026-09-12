/**
 * CRM Analytics Routes
 *
 * GET /api/analytics/pipeline      — Pipeline stage breakdown + conversion rates
 * GET /api/analytics/attribution   — Revenue attribution per campaign
 * GET /api/analytics/trends        — Weekly KPI trend data
 * GET /api/analytics/channels      — Channel performance comparison
 * GET /api/analytics/health        — CRM health score + alerts
 * GET /api/analytics/engagement    — Engagement scoring (0-100 per contact)
 */

const { Router } = require('express');
const db = require('../db');
const { scoreOpportunities, scoreAllContacts } = require('../lib/contact-scoring');

const router = Router();

// ── Stage definitions (ordered for funnel) ──

const STAGE_DEFS = [
  { stage: 'new', label: 'New', labelFr: 'Nouveau' },
  { stage: 'interested', label: 'Interested', labelFr: 'Intéressé' },
  { stage: 'meeting', label: 'Meeting', labelFr: 'RDV' },
  { stage: 'negotiation', label: 'Negotiation', labelFr: 'Négociation' },
  { stage: 'won', label: 'Won', labelFr: 'Gagné' },
  { stage: 'lost', label: 'Lost', labelFr: 'Perdu' },
];

// Map various status values to canonical stages
function canonicalStage(status) {
  const s = (status || 'new').toLowerCase().trim();
  const mapping = {
    'new': 'new',
    'nouveau': 'new',
    'interested': 'interested',
    'interesse': 'interested',
    'intéressé': 'interested',
    'meeting': 'meeting',
    'rdv': 'meeting',
    'call planifie': 'meeting',
    'call planifié': 'meeting',
    'negotiation': 'negotiation',
    'négociation': 'negotiation',
    'won': 'won',
    'gagné': 'won',
    'lost': 'lost',
    'perdu': 'lost',
    'rappeler': 'interested',
  };
  return mapping[s] || 'new';
}

// ── Filtres transverses produit / secteur (barre de filtres Analytics) ──
// Les routes de cette page agrègent déjà en mémoire sur listByUser : on filtre
// donc en JS après chargement — zéro changement de comportement sans filtre.
// `productLine` = UUID de product_lines. `sector` = secteur normalisé
// (lib/sector-classifier.js) — ne couvre que les textes bruts déjà classifiés
// en cache (sector_normalization_cache), jamais de classification à la volée
// ici : coûteux (appel Claude) et hors-sujet pour un simple filtre d'écran.

// Valeur spéciale des deux filtres : deals sans ligne produit / sans secteur
// déterminé — sinon invisibles dans les deux dropdowns (ils n'apparaissent dans
// aucune option nommée puisqu'ils n'ont justement rien d'assigné).
const UNASSIGNED = '__unassigned__';

async function resolveAnalyticsFilters(userId, query) {
  const productLine = String(query?.productLine || '').trim();
  const sector = String(query?.sector || '').trim();
  let productOppIds = null;
  if (productLine === UNASSIGNED) {
    const r = await db.query(
      `SELECT o.id FROM opportunities o
       LEFT JOIN opportunity_product_lines opl ON opl.opportunity_id = o.id
       WHERE o.user_id = $1 AND opl.opportunity_id IS NULL`,
      [userId]
    );
    productOppIds = new Set(r.rows.map(x => x.id));
  } else if (productLine) {
    const r = await db.query(
      `SELECT opl.opportunity_id FROM opportunity_product_lines opl
       JOIN opportunities o ON o.id = opl.opportunity_id
       WHERE opl.product_line_id = $1 AND o.user_id = $2`,
      [productLine, userId]
    );
    productOppIds = new Set(r.rows.map(x => x.opportunity_id));
  }
  let sectorOppIds = null;
  if (sector === UNASSIGNED) {
    const r = await db.query(
      `SELECT o.id FROM opportunities o
       WHERE o.user_id = $1
         AND o.id NOT IN (
           SELECT o2.id FROM opportunities o2
           JOIN sector_normalization_cache snc
             ON lower(snc.raw_text) = lower(o2.data->>'sector') AND snc.scope = 'client_industry'
           WHERE o2.user_id = $1 AND snc.normalized_sector != 'non_determine'
         )`,
      [userId]
    );
    sectorOppIds = new Set(r.rows.map(x => x.id));
  } else if (sector) {
    const r = await db.query(
      `SELECT o.id FROM opportunities o
       JOIN sector_normalization_cache snc
         ON lower(snc.raw_text) = lower(o.data->>'sector') AND snc.scope = 'client_industry'
       WHERE o.user_id = $1 AND snc.normalized_sector = $2`,
      [userId, sector]
    );
    sectorOppIds = new Set(r.rows.map(x => x.id));
  }
  // Période : filtre sur created_at (date d'entrée du deal dans le pipeline),
  // même convention que les cohortes de création et le flux mensuel.
  const from = String(query?.from || '').trim();
  const to = String(query?.to || '').trim();
  return { productLine, productOppIds, sector, sectorOppIds, from, to, active: !!(productLine || sector || from || to) };
}

function applyAnalyticsFilters(opps, filters) {
  if (!filters?.active) return opps;
  let list = opps;
  if (filters.productOppIds) list = list.filter(o => filters.productOppIds.has(o.id));
  if (filters.sectorOppIds) list = list.filter(o => filters.sectorOppIds.has(o.id));
  if (filters.from) {
    const fromTs = new Date(filters.from).getTime();
    if (!isNaN(fromTs)) list = list.filter(o => o.created_at && new Date(o.created_at).getTime() >= fromTs);
  }
  if (filters.to) {
    // Inclusif de toute la journée "to" (fin de journée, pas minuit).
    const toTs = new Date(filters.to).getTime() + 24 * 60 * 60 * 1000 - 1;
    if (!isNaN(toTs)) list = list.filter(o => o.created_at && new Date(o.created_at).getTime() <= toTs);
  }
  return list;
}

async function listFilteredOpportunities(userId, query) {
  const opps = await db.opportunities.listByUser(userId, 10000, 0);
  return applyAnalyticsFilters(opps, await resolveAnalyticsFilters(userId, query));
}

// Pour les routes en SQL pur (/stages) : liste d'IDs autorisés, ou null
// si aucun filtre — à passer en $n::uuid[] avec `($n::uuid[] IS NULL OR id = ANY($n))`.
async function filteredOppIds(userId, query) {
  const filters = await resolveAnalyticsFilters(userId, query);
  if (!filters.active) return null;
  const opps = await db.opportunities.listByUser(userId, 10000, 0);
  return applyAnalyticsFilters(opps, filters).map(o => o.id);
}

// =============================================
// GET /api/analytics/sectors — options du filtre « secteur »
// =============================================
// Ne renvoie que les secteurs déjà classifiés (sector_normalization_cache) —
// alimenté au fil de l'eau par le scoring de churn/contact (lib/sector-classifier.js).
// Aucune classification à la volée ici.

router.get('/sectors', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT snc.normalized_sector AS sector, COUNT(*)::int AS count
       FROM opportunities o
       JOIN sector_normalization_cache snc
         ON lower(snc.raw_text) = lower(o.data->>'sector') AND snc.scope = 'client_industry'
       WHERE o.user_id = $1 AND snc.normalized_sector != 'non_determine'
       GROUP BY snc.normalized_sector
       ORDER BY count DESC`,
      [req.user.id]
    );

    // Secteur non déterminé : brut vide, classifié "non_determine", ou jamais
    // encore classifié — tout ce qui n'apparaît pas ci-dessus.
    const unassigned = await db.query(
      `SELECT COUNT(*)::int AS count FROM opportunities o
       WHERE o.user_id = $1
         AND o.id NOT IN (
           SELECT o2.id FROM opportunities o2
           JOIN sector_normalization_cache snc
             ON lower(snc.raw_text) = lower(o2.data->>'sector') AND snc.scope = 'client_industry'
           WHERE o2.user_id = $1 AND snc.normalized_sector != 'non_determine'
         )`,
      [req.user.id]
    );

    const sectors = r.rows;
    if (unassigned.rows[0].count > 0) {
      sectors.push({ sector: UNASSIGNED, count: unassigned.rows[0].count });
    }
    res.json({ sectors });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/product-lines — options du filtre « ligne produit »
// =============================================
// Comptages scopés sur le tenant (req.user.id), contrairement à /crm/product-lines
// qui compte par team_id — nécessaire pour rester cohérent avec le reste des
// filtres Analytics, tous scopés utilisateur.

router.get('/product-lines', async (req, res, next) => {
  try {
    // LEFT JOIN : une ligne produit sans deal assigné doit rester visible
    // (count 0), pas disparaître — le FILTER ne compte que les deals du
    // user courant parmi celles visibles à son équipe.
    const r = await db.query(
      `SELECT pl.id, pl.name, pl.icon,
              COUNT(opl.opportunity_id) FILTER (WHERE o.user_id = $1)::int AS count
       FROM product_lines pl
       LEFT JOIN opportunity_product_lines opl ON opl.product_line_id = pl.id
       LEFT JOIN opportunities o ON o.id = opl.opportunity_id
       WHERE pl.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)
       GROUP BY pl.id, pl.name, pl.icon
       ORDER BY count DESC`,
      [req.user.id]
    );

    const unassigned = await db.query(
      `SELECT COUNT(*)::int AS count FROM opportunities o
       LEFT JOIN opportunity_product_lines opl ON opl.opportunity_id = o.id
       WHERE o.user_id = $1 AND opl.opportunity_id IS NULL`,
      [req.user.id]
    );

    const productLines = r.rows;
    if (unassigned.rows[0].count > 0) {
      productLines.push({ id: UNASSIGNED, name: null, icon: null, count: unassigned.rows[0].count });
    }
    res.json({ productLines });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/pipeline
// =============================================

router.get('/pipeline', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await listFilteredOpportunities(userId, req.query);
    const total = opportunities.length;

    // Count per stage
    const counts = {};
    for (const def of STAGE_DEFS) counts[def.stage] = 0;
    for (const opp of opportunities) {
      const stage = canonicalStage(opp.status);
      counts[stage] = (counts[stage] || 0) + 1;
    }

    const stages = STAGE_DEFS.map(def => ({
      stage: def.stage,
      label: def.label,
      labelFr: def.labelFr,
      count: counts[def.stage] || 0,
      percentage: total > 0 ? Math.round(((counts[def.stage] || 0) / total) * 1000) / 10 : 0,
    }));

    // Conversion rates between consecutive funnel stages (excluding lost)
    const funnelStages = STAGE_DEFS.filter(d => d.stage !== 'lost');
    const conversions = [];
    for (let i = 0; i < funnelStages.length - 1; i++) {
      const from = funnelStages[i].stage;
      const to = funnelStages[i + 1].stage;
      const fromCount = counts[from] || 0;
      const toCount = counts[to] || 0;
      // Conversion = how many moved to next stage out of those who were in this or later stages
      const enteredFrom = funnelStages.slice(i).reduce((sum, s) => sum + (counts[s.stage] || 0), 0);
      const enteredTo = funnelStages.slice(i + 1).reduce((sum, s) => sum + (counts[s.stage] || 0), 0);
      conversions.push({
        from,
        to,
        rate: enteredFrom > 0 ? Math.round((enteredTo / enteredFrom) * 1000) / 10 : 0,
      });
    }

    // ── Flux mensuel : créés / gagnés / perdus / solde net, 12 derniers mois ──
    // Un même mois peut compter un deal créé ET gagné (dates différentes) : les
    // trois compteurs sont indépendants, dérivés chacun de sa propre colonne date.
    const monthKey = (d) => {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    };
    const refNow = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      months.push(monthKey(new Date(refNow.getFullYear(), refNow.getMonth() - i, 1)));
    }
    const flowMap = Object.fromEntries(months.map(m => [m, { period: m, created: 0, won: 0, lost: 0 }]));
    const cohortMap = Object.fromEntries(months.map(m => [m, { period: m, created: 0, won: 0, lost: 0, open: 0 }]));
    for (const opp of opportunities) {
      const stage = canonicalStage(opp.status);
      if (opp.created_at) {
        const k = monthKey(opp.created_at);
        if (flowMap[k]) flowMap[k].created++;
        if (cohortMap[k]) {
          cohortMap[k].created++;
          if (stage === 'won') cohortMap[k].won++;
          else if (stage === 'lost') cohortMap[k].lost++;
          else cohortMap[k].open++;
        }
      }
      if (opp.won_date) {
        const k = monthKey(opp.won_date);
        if (flowMap[k]) flowMap[k].won++;
      }
      if (opp.lost_date) {
        const k = monthKey(opp.lost_date);
        if (flowMap[k]) flowMap[k].lost++;
      }
    }
    const flow = months.map(m => {
      const f = flowMap[m];
      return { ...f, net: f.created - f.won - f.lost };
    });
    // Cohortes de création : issue ACTUELLE des deals créés ce mois-là (pas leur
    // date de clôture) — répond à « les deals créés en mars, où en sont-ils aujourd'hui ? »
    const cohorts = months.map(m => {
      const c = cohortMap[m];
      const closed = c.won + c.lost;
      return { ...c, winRate: closed > 0 ? Math.round((c.won / closed) * 100) : null };
    });

    // ── Taille des deals ouverts : distribution + concentration ──
    const openDeals = opportunities.filter(o => {
      const s = canonicalStage(o.status);
      return s !== 'won' && s !== 'lost' && Number(o.deal_value) > 0;
    });
    const SIZE_BUCKETS = [
      { label: '< 1k€', max: 1000 },
      { label: '1k–5k€', max: 5000 },
      { label: '5k–20k€', max: 20000 },
      { label: '20k–50k€', max: 50000 },
      { label: '> 50k€', max: Infinity },
    ];
    const sizeDistribution = SIZE_BUCKETS.map(b => ({ label: b.label, count: 0 }));
    for (const o of openDeals) {
      const v = Number(o.deal_value);
      const idx = SIZE_BUCKETS.findIndex(b => v < b.max);
      sizeDistribution[idx === -1 ? SIZE_BUCKETS.length - 1 : idx].count++;
    }
    const totalOpenValue = openDeals.reduce((sum, o) => sum + Number(o.deal_value), 0);
    const top5Value = [...openDeals]
      .sort((a, b) => Number(b.deal_value) - Number(a.deal_value))
      .slice(0, 5)
      .reduce((sum, o) => sum + Number(o.deal_value), 0);
    const dealSize = {
      distribution: sizeDistribution,
      totalOpenValue: Math.round(totalOpenValue),
      top5Value: Math.round(top5Value),
      top5Pct: totalOpenValue > 0 ? Math.round((top5Value / totalOpenValue) * 100) : 0,
    };

    // Gagnés/perdus sur les 30 derniers jours — distinct des comptages "stages"
    // qui sont all-time. La date qui compte est celle de clôture (won_date /
    // lost_date), pas la date de création.
    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const outcomes30d = {
      won: opportunities.filter(o => o.won_date && new Date(o.won_date).getTime() >= cutoff30).length,
      lost: opportunities.filter(o => o.lost_date && new Date(o.lost_date).getTime() >= cutoff30).length,
    };

    res.json({ stages, conversions, total, flow, cohorts, dealSize, outcomes30d });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/attribution
// =============================================

router.get('/attribution', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [allCampaigns, allOpportunities, touchAgg, touchedDeals] = await Promise.all([
      db.campaigns.list({ userId }),
      listFilteredOpportunities(userId, req.query),
      // Attribution deals touchés/non touchés : un deal est « touché » dès
      // qu'un email baakalai (nurture OU chain) lui a été réellement envoyé.
      // Périmètre plus large que /crm/reactivation-stats (chains seules).
      db.query(`
        WITH touch AS (
          SELECT o.id, o.deal_value, o.status, o.reactivated_at,
                 COUNT(ne.id) AS emails_sent,
                 BOOL_OR(ne.replied_at IS NOT NULL) AS replied
          FROM opportunities o
          LEFT JOIN nurture_emails ne
            ON ne.opportunity_id = o.id AND ne.user_id = o.user_id AND ne.status = 'sent'
          WHERE o.user_id = $1
          GROUP BY o.id
        )
        SELECT
          COUNT(*) FILTER (WHERE emails_sent > 0) AS touched_count,
          COALESCE(SUM(deal_value) FILTER (WHERE emails_sent > 0), 0) AS touched_value,
          COUNT(*) FILTER (WHERE emails_sent = 0) AS untouched_count,
          COALESCE(SUM(deal_value) FILTER (WHERE emails_sent = 0), 0) AS untouched_value,
          COUNT(*) FILTER (WHERE emails_sent > 0 AND status = 'won') AS touched_won,
          COALESCE(SUM(deal_value) FILTER (WHERE emails_sent > 0 AND status = 'won'), 0) AS touched_won_value,
          COUNT(*) FILTER (WHERE emails_sent = 0 AND status = 'won') AS untouched_won,
          COUNT(*) FILTER (WHERE emails_sent > 0 AND replied) AS touched_replied,
          COUNT(*) FILTER (WHERE reactivated_at IS NOT NULL) AS reactivated_count,
          COALESCE(SUM(deal_value) FILTER (WHERE reactivated_at IS NOT NULL), 0) AS reactivated_value
        FROM touch
      `, [userId]),
      db.query(`
        SELECT o.name, o.company, o.deal_value, o.status, o.reactivated_at,
               COUNT(ne.id) AS emails_sent,
               MAX(ne.sent_at) AS last_touch_at,
               BOOL_OR(ne.replied_at IS NOT NULL) AS replied
        FROM opportunities o
        JOIN nurture_emails ne
          ON ne.opportunity_id = o.id AND ne.user_id = o.user_id AND ne.status = 'sent'
        WHERE o.user_id = $1
        GROUP BY o.id, o.name, o.company, o.deal_value, o.status, o.reactivated_at
        ORDER BY MAX(ne.sent_at) DESC
        LIMIT 50
      `, [userId]),
    ]);

    // Group opportunities by campaign_id
    const oppByCampaign = {};
    for (const opp of allOpportunities) {
      const cid = opp.campaign_id || '__none__';
      if (!oppByCampaign[cid]) oppByCampaign[cid] = [];
      oppByCampaign[cid].push(opp);
    }

    const campaigns = allCampaigns.map(c => {
      const opps = oppByCampaign[c.id] || [];
      const interested = opps.filter(o => {
        const s = canonicalStage(o.status);
        return s === 'interested' || s === 'meeting' || s === 'negotiation' || s === 'won';
      }).length;
      const meetings = c.meetings || opps.filter(o => {
        const s = canonicalStage(o.status);
        return s === 'meeting' || s === 'negotiation' || s === 'won';
      }).length;
      const prospects = c.nb_prospects || c.sent || 0;
      const conversionRate = prospects > 0
        ? Math.round((meetings / prospects) * 1000) / 10
        : 0;

      return {
        id: c.id,
        name: c.name,
        channel: c.channel || 'email',
        prospects,
        meetings,
        interested,
        conversionRate,
        costPerMeeting: 'N/A',
        roi: null,
      };
    });

    const totals = {
      prospects: campaigns.reduce((s, c) => s + c.prospects, 0),
      meetings: campaigns.reduce((s, c) => s + c.meetings, 0),
      interested: campaigns.reduce((s, c) => s + c.interested, 0),
      avgConversion: 0,
    };
    totals.avgConversion = totals.prospects > 0
      ? Math.round((totals.meetings / totals.prospects) * 1000) / 10
      : 0;

    const ta = touchAgg.rows[0];
    const num = (v) => parseFloat(v) || 0;
    const dealTouch = {
      touched: {
        count: parseInt(ta.touched_count),
        value: num(ta.touched_value),
        won: parseInt(ta.touched_won),
        wonValue: num(ta.touched_won_value),
        replied: parseInt(ta.touched_replied),
        replyRate: ta.touched_count > 0
          ? Math.round((ta.touched_replied / ta.touched_count) * 100) : 0,
      },
      untouched: {
        count: parseInt(ta.untouched_count),
        value: num(ta.untouched_value),
        won: parseInt(ta.untouched_won),
      },
      reactivated: { count: parseInt(ta.reactivated_count), value: num(ta.reactivated_value) },
      deals: touchedDeals.rows.map(d => ({
        name: d.name,
        company: d.company,
        dealValue: num(d.deal_value),
        status: d.status,
        emailsSent: parseInt(d.emails_sent),
        lastTouchAt: d.last_touch_at,
        replied: d.replied,
        reactivatedAt: d.reactivated_at,
      })),
    };

    res.json({ campaigns, totals, dealTouch });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/trends
// =============================================

router.get('/trends', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Date range filtering — defaults to last 90 days
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const defaultTo = now.toISOString().split('T')[0];
    const fromDate = req.query.from || defaultFrom;
    const toDate = req.query.to || defaultTo;
    const fromMs = new Date(fromDate).getTime();
    const toMs = new Date(toDate + 'T23:59:59.999Z').getTime();

    const [chartRows, reports] = await Promise.all([
      db.chartData.listByUser(userId),
      db.reports.listByUser(userId, 52, 0),
    ]);

    let weeks;

    if (chartRows.length > 0) {
      // Build report lookup by week label
      const reportByWeek = {};
      for (const r of reports) reportByWeek[r.week] = r;

      weeks = chartRows
        .filter(row => {
          if (!row.week_start) return true;
          const ws = new Date(row.week_start).getTime();
          return ws >= fromMs && ws <= toMs;
        })
        .map(row => {
          const report = reportByWeek[row.label] || {};
          return {
            label: row.label,
            weekStart: row.week_start || null,
            emailCount: row.email_count || 0,
            linkedinCount: row.linkedin_count || 0,
            openRate: report.open_rate != null ? report.open_rate : null,
            replyRate: report.reply_rate != null ? report.reply_rate : null,
            interested: report.interested || 0,
            meetings: report.meetings || 0,
          };
        });
    } else {
      // Generate from reports if no chart_data
      weeks = reports
        .filter(r => {
          const ca = r.created_at ? new Date(r.created_at).getTime() : 0;
          return ca >= fromMs && ca <= toMs;
        })
        .map(r => ({
          label: r.week,
          weekStart: r.date_range ? r.date_range.split(' - ')[0] : null,
          emailCount: r.contacts || 0,
          linkedinCount: 0,
          openRate: r.open_rate,
          replyRate: r.reply_rate,
          interested: r.interested || 0,
          meetings: r.meetings || 0,
        })).reverse(); // oldest first
    }

    res.json({ weeks });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/channels
// =============================================

router.get('/channels', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const allCampaigns = await db.campaigns.list({ userId });

    // Group by channel
    const groups = {};
    for (const c of allCampaigns) {
      const ch = c.channel || 'email';
      if (!groups[ch]) groups[ch] = [];
      groups[ch].push(c);
    }

    const channels = Object.entries(groups).map(([channel, cList]) => {
      const count = cList.length;
      const totalProspects = cList.reduce((s, c) => s + (c.nb_prospects || c.sent || 0), 0);
      const interested = cList.reduce((s, c) => s + (c.interested || 0), 0);
      const meetings = cList.reduce((s, c) => s + (c.meetings || 0), 0);

      // Averages (only from campaigns that have data)
      const withOpenRate = cList.filter(c => c.open_rate != null && c.open_rate > 0);
      const avgOpenRate = withOpenRate.length > 0
        ? Math.round(withOpenRate.reduce((s, c) => s + c.open_rate, 0) / withOpenRate.length * 10) / 10
        : null;

      const withReplyRate = cList.filter(c => c.reply_rate != null && c.reply_rate > 0);
      const avgReplyRate = withReplyRate.length > 0
        ? Math.round(withReplyRate.reduce((s, c) => s + c.reply_rate, 0) / withReplyRate.length * 10) / 10
        : null;

      const withAcceptRate = cList.filter(c => c.accept_rate_lk != null && c.accept_rate_lk > 0);
      const avgAcceptRate = withAcceptRate.length > 0
        ? Math.round(withAcceptRate.reduce((s, c) => s + c.accept_rate_lk, 0) / withAcceptRate.length * 10) / 10
        : null;

      const result = { channel, campaigns: count, totalProspects, interested, meetings };
      if (avgOpenRate != null) result.avgOpenRate = avgOpenRate;
      if (avgReplyRate != null) result.avgReplyRate = avgReplyRate;
      if (avgAcceptRate != null) result.avgAcceptRate = avgAcceptRate;
      return result;
    });

    // Determine best channel by reply rate
    let bestChannel = null;
    let bestValue = -1;
    for (const ch of channels) {
      const val = ch.avgReplyRate || 0;
      if (val > bestValue) {
        bestValue = val;
        bestChannel = { channel: ch.channel, metric: 'replyRate', value: val };
      }
    }

    res.json({ channels, bestChannel });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/health
// =============================================

router.get('/health', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [opportunities, allCampaigns, profile] = await Promise.all([
      listFilteredOpportunities(userId, req.query),
      db.campaigns.list({ userId }),
      db.profiles.get(userId),
    ]);

    const now = Date.now();
    const DAY_MS = 1000 * 60 * 60 * 24;
    const alerts = [];

    // -- Stale leads: no update in 7+ days --
    const staleLeads = opportunities.filter(opp => {
      const stage = canonicalStage(opp.status);
      if (stage === 'won' || stage === 'lost') return false;
      const updated = opp.updated_at ? new Date(opp.updated_at).getTime() : 0;
      return (now - updated) > 7 * DAY_MS;
    });
    if (staleLeads.length > 0) {
      alerts.push({
        type: 'stale_leads',
        severity: 'warning',
        message: `${staleLeads.length} lead${staleLeads.length > 1 ? 's' : ''} sans activité depuis 7+ jours`,
        count: staleLeads.length,
      });
    }

    // -- Stuck deals: in negotiation 14+ days --
    const stuckDeals = opportunities.filter(opp => {
      const stage = canonicalStage(opp.status);
      if (stage !== 'negotiation') return false;
      const updated = opp.updated_at ? new Date(opp.updated_at).getTime() : 0;
      return (now - updated) > 14 * DAY_MS;
    });
    if (stuckDeals.length > 0) {
      alerts.push({
        type: 'stuck_deals',
        severity: 'danger',
        message: `${stuckDeals.length} deal${stuckDeals.length > 1 ? 's' : ''} bloqué${stuckDeals.length > 1 ? 's' : ''} en négociation depuis 14+ jours`,
        count: stuckDeals.length,
      });
    }

    // -- No follow-up: interested leads without timing set --
    const noFollowup = opportunities.filter(opp => {
      const stage = canonicalStage(opp.status);
      return stage === 'interested' && !opp.timing;
    });
    if (noFollowup.length > 0) {
      alerts.push({
        type: 'no_followup',
        severity: 'info',
        message: `${noFollowup.length} intéressé${noFollowup.length > 1 ? 's' : ''} sans relance planifiée`,
        count: noFollowup.length,
      });
    }

    // -- Compute sub-scores --

    // Pipeline velocity: lower is better for time-in-stage; invert for score
    const activeOpps = opportunities.filter(o => {
      const s = canonicalStage(o.status);
      return s !== 'won' && s !== 'lost';
    });
    let pipelineVelocity = 50; // default if no data
    if (activeOpps.length > 0) {
      const avgDays = activeOpps.reduce((sum, opp) => {
        const updated = opp.updated_at ? new Date(opp.updated_at).getTime() : now;
        return sum + (now - updated) / DAY_MS;
      }, 0) / activeOpps.length;
      // 0 days -> 100, 30+ days -> 0
      pipelineVelocity = Math.max(0, Math.min(100, Math.round(100 - (avgDays / 30) * 100)));
    }

    // Lead quality: avg lead score
    const campaignMap = {};
    for (const c of allCampaigns) campaignMap[c.id] = c;
    const scored = scoreOpportunities(opportunities, profile, campaignMap);
    let leadQuality = 0;
    if (scored.length > 0) {
      leadQuality = Math.round(scored.reduce((s, o) => s + (o.score || 0), 0) / scored.length);
    }

    // Follow-up rate: % of active leads that have timing or were updated within 7 days
    let followupRate = 100;
    if (activeOpps.length > 0) {
      const withFollowup = activeOpps.filter(opp => {
        if (opp.timing) return true;
        const updated = opp.updated_at ? new Date(opp.updated_at).getTime() : 0;
        return (now - updated) < 7 * DAY_MS;
      });
      followupRate = Math.round((withFollowup.length / activeOpps.length) * 100);
    }

    // Conversion health: based on funnel shape
    let conversionHealth = 50;
    if (opportunities.length > 0) {
      const wonCount = opportunities.filter(o => canonicalStage(o.status) === 'won').length;
      const meetingCount = opportunities.filter(o => {
        const s = canonicalStage(o.status);
        return s === 'meeting' || s === 'negotiation' || s === 'won';
      }).length;
      const interestedCount = opportunities.filter(o => {
        const s = canonicalStage(o.status);
        return s !== 'new' && s !== 'lost';
      }).length;

      // Score based on having leads progressing through the funnel
      const progressRate = interestedCount / opportunities.length;
      const meetingRate = meetingCount / Math.max(interestedCount, 1);
      const winRate = wonCount / Math.max(meetingCount, 1);

      conversionHealth = Math.round(
        (progressRate * 40 + meetingRate * 30 + winRate * 30) * 100
      );
      conversionHealth = Math.min(100, Math.max(0, conversionHealth));
    }

    // Weighted overall score
    const score = Math.round(
      pipelineVelocity * 0.25 +
      leadQuality * 0.25 +
      followupRate * 0.25 +
      conversionHealth * 0.25
    );

    let label;
    if (score > 80) label = 'Excellent';
    else if (score > 60) label = 'Bon';
    else if (score > 40) label = 'À surveiller';
    else label = 'Critique';

    res.json({
      score,
      label,
      alerts,
      breakdown: {
        pipelineVelocity,
        leadQuality,
        followupRate,
        conversionHealth,
      },
    });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/forecast
// =============================================

router.get('/forecast', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const allOpportunities = await listFilteredOpportunities(userId, req.query);
    const now = Date.now();
    const DAY_MS = 1000 * 60 * 60 * 24;

    // Date range filtering — defaults to last 90 days
    const defaultFrom = new Date(now - 90 * DAY_MS).toISOString().split('T')[0];
    const defaultTo = new Date(now).toISOString().split('T')[0];
    const fromDate = req.query.from || defaultFrom;
    const toDate = req.query.to || defaultTo;
    const fromMs = new Date(fromDate).getTime();
    const toMs = new Date(toDate + 'T23:59:59.999Z').getTime();

    const opportunities = allOpportunities.filter(o => {
      const d = o.updated_at || o.created_at;
      if (!d) return true;
      const ts = new Date(d).getTime();
      return ts >= fromMs && ts <= toMs;
    });

    // ── Historical closed revenue (by month) ──
    const wonDeals = opportunities.filter(o => canonicalStage(o.status) === 'won' && o.deal_value);
    const monthlyRevenue = {};
    for (const deal of wonDeals) {
      const date = deal.won_date || deal.updated_at || deal.created_at;
      const month = new Date(date).toISOString().slice(0, 7);
      monthlyRevenue[month] = (monthlyRevenue[month] || 0) + Number(deal.deal_value);
    }
    const revenueHistory = Object.entries(monthlyRevenue)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({ month, revenue: Math.round(revenue) }));

    // ── Win probability per stage (from historical funnel) ──
    const counts = {};
    for (const def of STAGE_DEFS) counts[def.stage] = 0;
    for (const opp of opportunities) counts[canonicalStage(opp.status)] = (counts[canonicalStage(opp.status)] || 0) + 1;

    const funnelStages = ['new', 'interested', 'meeting', 'negotiation', 'won'];
    const wonCount = counts['won'] || 0;
    const stageProbability = {};
    for (const stage of funnelStages) {
      const stageAndBeyond = funnelStages.slice(funnelStages.indexOf(stage)).reduce((sum, s) => sum + (counts[s] || 0), 0);
      stageProbability[stage] = stageAndBeyond > 0 && wonCount > 0 ? Math.round((wonCount / stageAndBeyond) * 100) / 100 : 0;
    }
    stageProbability['won'] = 1;
    stageProbability['lost'] = 0;

    // ── Pipeline deals — weighted forecast ──
    const pipelineDeals = opportunities.filter(o => {
      const s = canonicalStage(o.status);
      return s !== 'won' && s !== 'lost' && o.deal_value;
    });

    const pipelineByStage = [];
    for (const stage of ['new', 'interested', 'meeting', 'negotiation']) {
      const stageDeals = pipelineDeals.filter(o => canonicalStage(o.status) === stage);
      const totalValue = stageDeals.reduce((sum, o) => sum + Number(o.deal_value || 0), 0);
      const probability = stageProbability[stage] || 0;
      pipelineByStage.push({
        stage,
        label: STAGE_DEFS.find(d => d.stage === stage)?.label || stage,
        deals: stageDeals.length,
        totalValue: Math.round(totalValue),
        probability: Math.round(probability * 100),
        weightedValue: Math.round(totalValue * probability),
      });
    }

    const totalPipeline = pipelineByStage.reduce((sum, s) => sum + s.totalValue, 0);
    const totalWeighted = pipelineByStage.reduce((sum, s) => sum + s.weightedValue, 0);

    // ── Sales cycle analysis ──
    const closedDeals = opportunities.filter(o => canonicalStage(o.status) === 'won' && o.created_at);
    let avgSalesCycle = 0;
    if (closedDeals.length > 0) {
      const totalDays = closedDeals.reduce((sum, o) => {
        const close = new Date(o.won_date || o.updated_at).getTime();
        const create = new Date(o.created_at).getTime();
        return sum + (close - create) / DAY_MS;
      }, 0);
      avgSalesCycle = Math.round(totalDays / closedDeals.length);
    }

    // ── Projected close dates for active pipeline ──
    const projectedDeals = pipelineDeals.slice(0, 20).map(o => {
      const stage = canonicalStage(o.status);
      const stageIdx = funnelStages.indexOf(stage);
      const remainingStages = funnelStages.length - 1 - stageIdx;
      const daysPerStage = avgSalesCycle > 0 ? avgSalesCycle / (funnelStages.length - 1) : 14;
      const estDaysToClose = Math.round(remainingStages * daysPerStage);
      const projectedDate = new Date(now + estDaysToClose * DAY_MS).toISOString().split('T')[0];
      return {
        id: o.id, name: o.name, company: o.company, stage,
        dealValue: Number(o.deal_value || 0),
        probability: Math.round((stageProbability[stage] || 0) * 100),
        weightedValue: Math.round(Number(o.deal_value || 0) * (stageProbability[stage] || 0)),
        estDaysToClose, projectedCloseDate: projectedDate,
      };
    }).sort((a, b) => b.weightedValue - a.weightedValue);

    // ── Churn-adjusted retention ──
    const atRiskRevenue = wonDeals.filter(o => (o.churn_score || 0) >= 50).reduce((sum, o) => sum + Number(o.deal_value || 0), 0);
    const totalWonRevenue = wonDeals.reduce((sum, o) => sum + Number(o.deal_value || 0), 0);

    // Forecast intelligent : probabilité PAR DEAL calibrée sur l'historique
    // réel du tenant (cycle appris, activité, lead score, calibration) —
    // best-effort, l'ancien forecast par stage reste le repli d'affichage.
    let memoryForecast = null;
    try {
      const { computeForecast } = require('../lib/forecast-engine');
      memoryForecast = await computeForecast(userId);
    } catch (err) {
      require('../lib/logger').warn('analytics', `memoryForecast failed: ${err.message}`);
    }

    res.json({
      revenueHistory,
      pipeline: { byStage: pipelineByStage, totalValue: totalPipeline, weightedForecast: totalWeighted },
      salesCycle: { avgDays: avgSalesCycle, closedDeals: closedDeals.length },
      projectedDeals,
      memoryForecast,
      retention: {
        totalWonRevenue: Math.round(totalWonRevenue),
        atRiskRevenue: Math.round(atRiskRevenue),
        safeRevenue: Math.round(totalWonRevenue - atRiskRevenue),
        atRiskCount: wonDeals.filter(o => (o.churn_score || 0) >= 50).length,
      },
    });
  } catch (err) { next(err); }
});


// =============================================
// GET /api/analytics/engagement
// =============================================

// Engagement endpoint now returns unified contact scores (backwards compatible)
router.get('/engagement', async (req, res, next) => {
  try {
    const result = await scoreAllContacts(req.user.id);

    res.json({
      avgScore: result.avgScore,
      distribution: result.distribution,
      contacts: result.contacts.slice(0, 50),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/engagement/csv — now uses unified contact scoring
router.get('/engagement/csv', async (req, res, next) => {
  try {
    const result = await scoreAllContacts(req.user.id);
    const headers = ['Score', 'Name', 'Email', 'Company', 'Status', 'Last Activity'];
    const rows = result.contacts.map(c => [c.score, c.name, c.email, c.company, c.status, c.lastActivity || '']);
    sendCsv(res, 'baakal-contact-score.csv', headers, rows);
  } catch (err) { next(err); }
});

// ── CSV Export helpers ──

function escapeCsv(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function sendCsv(res, filename, headers, rows) {
  const BOM = '\uFEFF';
  const csv = BOM + [headers.map(escapeCsv).join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// GET /api/analytics/pipeline/csv
router.get('/pipeline/csv', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await listFilteredOpportunities(userId, req.query);
    const total = opportunities.length;
    const counts = {}; const stageTimes = {}; const stageCounts2 = {};
    for (const def of STAGE_DEFS) counts[def.stage] = 0;
    const now = Date.now();
    for (const opp of opportunities) {
      const stage = canonicalStage(opp.status);
      counts[stage] = (counts[stage] || 0) + 1;
      const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;
      stageTimes[stage] = (stageTimes[stage] || 0) + (now - updatedAt) / 86400000;
      stageCounts2[stage] = (stageCounts2[stage] || 0) + 1;
    }
    const headers = ['Stage', 'Label', 'Count', 'Percentage', 'Avg Days in Stage'];
    const rows = STAGE_DEFS.map(def => [
      def.stage, def.label, counts[def.stage] || 0,
      total > 0 ? (((counts[def.stage] || 0) / total) * 100).toFixed(1) + '%' : '0%',
      stageCounts2[def.stage] ? (stageTimes[def.stage] / stageCounts2[def.stage]).toFixed(1) : '0',
    ]);
    sendCsv(res, 'baakal-pipeline.csv', headers, rows);
  } catch (err) { next(err); }
});

// GET /api/analytics/attribution/csv
router.get('/attribution/csv', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [allCampaigns, allOpps] = await Promise.all([db.campaigns.list({ userId }), listFilteredOpportunities(userId, req.query)]);
    const oppByCampaign = {};
    for (const opp of allOpps) { const cid = opp.campaign_id || '__none__'; if (!oppByCampaign[cid]) oppByCampaign[cid] = []; oppByCampaign[cid].push(opp); }
    const headers = ['Campaign', 'Channel', 'Prospects', 'Interested', 'Meetings', 'Conversion %'];
    const rows = allCampaigns.map(c => {
      const opps = oppByCampaign[c.id] || [];
      const interested = opps.filter(o => { const s = canonicalStage(o.status); return s === 'interested' || s === 'meeting' || s === 'negotiation' || s === 'won'; }).length;
      const meetings = c.meetings || opps.filter(o => { const s = canonicalStage(o.status); return s === 'meeting' || s === 'negotiation' || s === 'won'; }).length;
      const prospects = c.nb_prospects || c.sent || 0;
      return [c.name, c.channel || 'email', prospects, interested, meetings, prospects > 0 ? ((meetings / prospects) * 100).toFixed(1) + '%' : '0%'];
    });
    sendCsv(res, 'baakal-attribution.csv', headers, rows);
  } catch (err) { next(err); }
});

// GET /api/analytics/trends/csv
router.get('/trends/csv', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [chartRows, reports] = await Promise.all([db.chartData.listByUser(userId), db.reports.listByUser(userId, 52, 0)]);
    let weeks;
    if (chartRows.length > 0) {
      const reportByWeek = {}; for (const r of reports) reportByWeek[r.week] = r;
      weeks = chartRows.map(row => { const r = reportByWeek[row.label] || {}; return { label: row.label, weekStart: row.week_start || '', emailCount: row.email_count || 0, linkedinCount: row.linkedin_count || 0, openRate: r.open_rate ?? '', replyRate: r.reply_rate ?? '', interested: r.interested || 0, meetings: r.meetings || 0 }; });
    } else {
      weeks = reports.map(r => ({ label: r.week, weekStart: r.date_range ? r.date_range.split(' - ')[0] : '', emailCount: r.contacts || 0, linkedinCount: 0, openRate: r.open_rate ?? '', replyRate: r.reply_rate ?? '', interested: r.interested || 0, meetings: r.meetings || 0 })).reverse();
    }
    const headers = ['Week', 'Start Date', 'Emails', 'LinkedIn', 'Open Rate %', 'Reply Rate %', 'Interested', 'Meetings'];
    const rows = weeks.map(w => [w.label, w.weekStart, w.emailCount, w.linkedinCount, w.openRate, w.replyRate, w.interested, w.meetings]);
    sendCsv(res, 'baakal-trends.csv', headers, rows);
  } catch (err) { next(err); }
});

// GET /api/analytics/channels/csv
router.get('/channels/csv', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const allCampaigns = await db.campaigns.list({ userId });
    const groups = {}; for (const c of allCampaigns) { const ch = c.channel || 'email'; if (!groups[ch]) groups[ch] = []; groups[ch].push(c); }
    const headers = ['Channel', 'Campaigns', 'Prospects', 'Interested', 'Meetings', 'Open Rate %', 'Reply Rate %'];
    const rows = Object.entries(groups).map(([ch, cList]) => {
      const totalP = cList.reduce((s, c) => s + (c.nb_prospects || c.sent || 0), 0);
      const interested = cList.reduce((s, c) => s + (c.interested || 0), 0);
      const meetings = cList.reduce((s, c) => s + (c.meetings || 0), 0);
      const wO = cList.filter(c => c.open_rate > 0); const avgO = wO.length > 0 ? (wO.reduce((s, c) => s + c.open_rate, 0) / wO.length).toFixed(1) : '';
      const wR = cList.filter(c => c.reply_rate > 0); const avgR = wR.length > 0 ? (wR.reduce((s, c) => s + c.reply_rate, 0) / wR.length).toFixed(1) : '';
      return [ch, cList.length, totalP, interested, meetings, avgO, avgR];
    });
    sendCsv(res, 'baakal-channels.csv', headers, rows);
  } catch (err) { next(err); }
});

// GET /api/analytics/health/csv
router.get('/health/csv', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await listFilteredOpportunities(userId, req.query);
    const now = Date.now(); const DAY_MS = 86400000;
    const activeOpps = opportunities.filter(o => { const s = canonicalStage(o.status); return s !== 'won' && s !== 'lost'; });
    const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updated_at).getTime() : 0; return (now - u) > 7 * DAY_MS; });
    const stuck = opportunities.filter(o => { if (canonicalStage(o.status) !== 'negotiation') return false; const u = o.updated_at ? new Date(o.updated_at).getTime() : 0; return (now - u) > 14 * DAY_MS; });
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Total Opportunities', opportunities.length], ['Active (in pipeline)', activeOpps.length],
      ['Stale Leads (7+ days)', stale.length], ['Stuck Deals (14+ days)', stuck.length],
      ['Won', opportunities.filter(o => canonicalStage(o.status) === 'won').length],
      ['Lost', opportunities.filter(o => canonicalStage(o.status) === 'lost').length],
    ];
    sendCsv(res, 'baakal-health.csv', headers, rows);
  } catch (err) { next(err); }
});

// GET /api/analytics/forecast/csv
router.get('/forecast/csv', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await listFilteredOpportunities(userId, req.query);
    const counts = {}; for (const opp of opportunities) counts[canonicalStage(opp.status)] = (counts[canonicalStage(opp.status)] || 0) + 1;
    const wonCount = counts['won'] || 0;
    const funnelStages = ['new', 'interested', 'meeting', 'negotiation', 'won'];
    const pipelineDeals = opportunities.filter(o => { const s = canonicalStage(o.status); return s !== 'won' && s !== 'lost' && o.deal_value; });
    const headers = ['Name', 'Company', 'Stage', 'Deal Value', 'Probability %', 'Weighted Value'];
    const rows = pipelineDeals.map(o => {
      const stage = canonicalStage(o.status);
      const stageAndBeyond = funnelStages.slice(funnelStages.indexOf(stage)).reduce((sum, s) => sum + (counts[s] || 0), 0);
      const prob = stageAndBeyond > 0 && wonCount > 0 ? Math.round((wonCount / stageAndBeyond) * 100) : 0;
      return [o.name, o.company, stage, o.deal_value || 0, prob, Math.round(Number(o.deal_value || 0) * prob / 100)];
    });
    sendCsv(res, 'baakal-forecast.csv', headers, rows);
  } catch (err) { next(err); }
});

// GET /api/analytics/renewals/csv
router.get('/renewals/csv', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await listFilteredOpportunities(userId, req.query);
    const now = new Date();
    const DAY_MS = 86400000;
    const rows = opportunities
      .filter(o => canonicalStage(o.status) !== 'lost')
      .map(o => {
        let rd = o.renewal_date ? new Date(o.renewal_date)
          : o.close_date ? new Date(o.close_date)
          : o.won_date ? new Date(new Date(o.won_date).getTime() + 365 * DAY_MS)
          : o.updated_at ? new Date(new Date(o.updated_at).getTime() + 365 * DAY_MS) : null;
        if (!rd || isNaN(rd.getTime())) return null;
        const days = Math.round((rd.getTime() - now.getTime()) / DAY_MS);
        const window = days < 0 ? 'Overdue' : days <= 30 ? '0-30 days' : days <= 60 ? '30-60 days' : days <= 90 ? '60-90 days' : '90+ days';
        return [o.name, o.email, o.company, rd.toISOString().split('T')[0], days, o.deal_value || 0, window];
      })
      .filter(Boolean)
      .sort((a, b) => a[4] - b[4]);
    const headers = ['Name', 'Email', 'Company', 'Renewal Date', 'Days Until', 'Deal Value', 'Window'];
    sendCsv(res, 'baakal-renewals.csv', headers, rows);
  } catch (err) { next(err); }
});

// =============================================
// GET /api/analytics/stages — étapes de pipeline CRM réelles (migration 092)
// =============================================
// Contrairement à /pipeline (statuts canoniques dérivés de `status`), ici ce
// sont les étapes telles que l'utilisateur les a nommées dans SON CRM,
// rapatriées par le delta sync. L'historique des transitions ne démarre qu'à
// l'installation du tracking — le front doit l'afficher honnêtement.

router.get('/stages', async (req, res, next) => {
  try {
    const userId = req.user.id;
    // null = pas de filtre actif (le prédicat $2::uuid[] IS NULL court-circuite)
    const oppIds = await filteredOppIds(userId, req.query);

    const dist = await db.query(
      `SELECT crm_stage AS stage, COUNT(*)::int AS count, COALESCE(SUM(deal_value), 0)::float AS value
       FROM opportunities
       WHERE user_id = $1 AND crm_stage IS NOT NULL AND status NOT IN ('won', 'lost')
         AND ($2::uuid[] IS NULL OR id = ANY($2))
       GROUP BY crm_stage`,
      [userId, oppIds]
    );

    if (dist.rows.length === 0) {
      const any = await db.query(
        `SELECT 1 FROM opportunities WHERE user_id = $1 AND crm_stage IS NOT NULL LIMIT 1`,
        [userId]
      );
      if (!any.rows[0]) return res.json({ available: false });
    }

    // Ordre naturel du pipeline quand le CRM le fournit (Pipedrive/HubSpot) ;
    // sinon tri par volume décroissant.
    let order = null;
    try {
      const { resolveCrmForUser } = require('../lib/crm-token');
      const { getStageLabelMap } = require('../lib/stage-tracking');
      const { provider, creds } = await resolveCrmForUser(userId);
      const map = provider ? await getStageLabelMap(provider, creds) : null;
      if (map && map.size > 0) order = [...map.values()];
    } catch { /* best-effort */ }

    const stages = dist.rows.sort((a, b) => {
      if (order) {
        const ia = order.indexOf(a.stage);
        const ib = order.indexOf(b.stage);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      }
      return b.count - a.count;
    });

    // Où meurent les deals : l'étape d'origine de la DERNIÈRE transition d'un
    // deal perdu (from_stage) — pas son étape courante, qui est souvent une
    // étape terminale type « Closed lost » sans valeur diagnostique.
    const lost = await db.query(
      `SELECT COALESCE(h.from_stage, o.crm_stage) AS stage, COUNT(*)::int AS count
       FROM opportunities o
       LEFT JOIN LATERAL (
         SELECT from_stage FROM opportunity_stage_history h
         WHERE h.opportunity_id = o.id AND h.from_stage IS NOT NULL
         ORDER BY h.changed_at DESC LIMIT 1
       ) h ON true
       WHERE o.user_id = $1 AND o.status = 'lost' AND COALESCE(h.from_stage, o.crm_stage) IS NOT NULL
         AND ($2::uuid[] IS NULL OR o.id = ANY($2))
       GROUP BY 1 ORDER BY count DESC LIMIT 12`,
      [userId, oppIds]
    );

    const transitions = await db.query(
      `SELECT from_stage AS "from", to_stage AS "to", COUNT(*)::int AS count
       FROM opportunity_stage_history
       WHERE user_id = $1 AND from_stage IS NOT NULL
         AND ($2::uuid[] IS NULL OR opportunity_id = ANY($2))
       GROUP BY from_stage, to_stage ORDER BY count DESC LIMIT 15`,
      [userId, oppIds]
    );

    const since = await db.query(
      `SELECT MIN(changed_at) AS since FROM opportunity_stage_history WHERE user_id = $1`,
      [userId]
    );

    // Temps moyen passé par étape : uniquement les séjours TERMINÉS (une
    // transition suivante existe) — un deal encore dans son étape actuelle
    // n'a pas de durée finale connue, l'inclure biaiserait la moyenne vers le bas.
    const avgDays = await db.query(
      `WITH ordered AS (
         SELECT to_stage, changed_at,
                LEAD(changed_at) OVER (PARTITION BY opportunity_id ORDER BY changed_at) AS next_changed_at
         FROM opportunity_stage_history
         WHERE user_id = $1
           AND ($2::uuid[] IS NULL OR opportunity_id = ANY($2))
       )
       SELECT to_stage AS stage,
              ROUND(AVG(EXTRACT(EPOCH FROM (next_changed_at - changed_at)) / 86400)::numeric, 1) AS avg_days,
              COUNT(*)::int AS completed_stints
       FROM ordered
       WHERE next_changed_at IS NOT NULL
       GROUP BY to_stage
       ORDER BY avg_days DESC NULLS LAST`,
      [userId, oppIds]
    );

    res.json({
      available: true,
      stages,
      lostByStage: lost.rows,
      transitions: transitions.rows,
      avgDaysByStage: avgDays.rows,
      historySince: since.rows[0]?.since || null,
    });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/lost-reasons — pourquoi les deals sont perdus
// =============================================
// lost_reason (migration 095) vient soit du CRM (Pipedrive, natif), soit d'une
// saisie manuelle dans baakalai. Les deals perdus sans raison encore connue
// sont remontés à part pour que l'utilisateur puisse les taguer (PATCH
// /api/crm/opportunities/:id/lost-reason).

router.get('/lost-reasons', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await listFilteredOpportunities(userId, req.query);
    const lost = opportunities.filter(o => canonicalStage(o.status) === 'lost');

    const distMap = {};
    let untaggedValue = 0;
    for (const o of lost) {
      if (!o.lost_reason) {
        untaggedValue += Number(o.deal_value || 0);
        continue;
      }
      if (!distMap[o.lost_reason]) distMap[o.lost_reason] = { reason: o.lost_reason, count: 0, value: 0 };
      distMap[o.lost_reason].count++;
      distMap[o.lost_reason].value += Number(o.deal_value || 0);
    }
    const distribution = Object.values(distMap)
      .map(d => ({ ...d, value: Math.round(d.value) }))
      .sort((a, b) => b.count - a.count);

    const allUntagged = lost
      .filter(o => !o.lost_reason)
      .sort((a, b) => new Date(b.lost_date || b.updated_at) - new Date(a.lost_date || a.updated_at));
    const untagged = allUntagged.slice(0, 50).map(o => ({
      id: o.id, name: o.name, company: o.company,
      dealValue: Number(o.deal_value || 0), lostDate: o.lost_date,
    }));

    res.json({
      totalLost: lost.length,
      taggedCount: lost.length - allUntagged.length,
      untaggedCount: allUntagged.length,
      untaggedValue: Math.round(untaggedValue),
      distribution,
      untagged,
    });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/geography — répartition géographique du portefeuille
// =============================================
// Pays = colonne CRM (migration 093) normalisée en ISO-2, sinon TLD de l'email.
// Les TLD génériques (.com, .io) ne donnent rien : la part « non déterminé »
// est retournée telle quelle — le front doit l'afficher honnêtement.

router.get('/geography', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { resolveCountry } = require('../lib/geo');
    const opportunities = await listFilteredOpportunities(userId, req.query);

    const byCountry = new Map();
    let undetermined = 0;
    let fromCrm = 0;

    for (const opp of opportunities) {
      const resolved = resolveCountry(opp);
      if (!resolved) { undetermined++; continue; }
      if (resolved.source === 'crm') fromCrm++;

      let row = byCountry.get(resolved.code);
      if (!row) {
        row = { code: resolved.code, contacts: 0, clients: 0, openDeals: 0, openValue: 0, wonValue: 0 };
        byCountry.set(resolved.code, row);
      }
      row.contacts++;
      const stage = canonicalStage(opp.status);
      const value = parseFloat(opp.deal_value) || 0;
      if (stage === 'won') {
        row.clients++;
        row.wonValue += value;
      } else if (stage !== 'lost' && value > 0) {
        row.openDeals++;
        row.openValue += value;
      }
    }

    const countries = [...byCountry.values()]
      .map(r => ({ ...r, openValue: Math.round(r.openValue), wonValue: Math.round(r.wonValue) }))
      .sort((a, b) => b.contacts - a.contacts);

    const total = opportunities.length;
    res.json({
      countries,
      total,
      undetermined,
      // Part des pays issus du CRM (vs déduits du TLD email) — indicateur de fiabilité
      crmCoverage: total > 0 ? Math.round((fromCrm / total) * 100) : 0,
    });
  } catch (err) {
    next(err);
  }
});

// =============================================
// buildAnalyticsContext — agrégats CRM pour l'Assistant (routes/ai.js)
// =============================================
// Paquet d'agrégats SQL calculés à la volée : les réponses de l'Assistant ne
// peuvent citer que ce que la base contient vraiment.

async function buildAnalyticsContext(userId, filterQuery = null) {
  const ctx = {};

  // Restriction produit éventuelle. Quand un filtre est actif, les blocs
  // globaux (emails d'activation, forecast, patterns) sont omis : ils ne sont
  // pas filtrables et mélangeraient des périmètres — Claude citerait des
  // chiffres « globaux » comme s'ils étaient filtrés.
  let oppIds = null;
  if (filterQuery) {
    const filters = await resolveAnalyticsFilters(userId, filterQuery);
    if (filters.active) {
      const opps = await db.opportunities.listByUser(userId, 10000, 0);
      oppIds = applyAnalyticsFilters(opps, filters).map(o => o.id);
      ctx.filters_applied = {};
      if (filters.productLine) {
        try {
          const pl = await db.query('SELECT name FROM product_lines WHERE id = $1', [filters.productLine]);
          ctx.filters_applied.product_line = pl.rows[0]?.name || filters.productLine;
        } catch { ctx.filters_applied.product_line = filters.productLine; }
      }
    }
  }

  const totals = await db.query(
    `SELECT
       COUNT(*)::int AS contacts,
       COUNT(*) FILTER (WHERE status NOT IN ('won','lost') AND deal_value > 0)::int AS open_deals,
       COALESCE(SUM(deal_value) FILTER (WHERE status NOT IN ('won','lost')), 0)::float AS open_value,
       COUNT(*) FILTER (WHERE status = 'won' AND won_date > now() - interval '365 days')::int AS won_365d,
       COUNT(*) FILTER (WHERE status = 'lost' AND lost_date > now() - interval '365 days')::int AS lost_365d,
       COUNT(*) FILTER (WHERE status = 'won' AND won_date > now() - interval '90 days')::int AS won_90d,
       COUNT(*) FILTER (WHERE status = 'lost' AND lost_date > now() - interval '90 days')::int AS lost_90d,
       COUNT(*) FILTER (WHERE reactivated_at IS NOT NULL)::int AS deals_reactivated,
       ROUND(AVG(EXTRACT(EPOCH FROM (won_date - created_at)) / 86400)
         FILTER (WHERE status = 'won' AND won_date > created_at))::int AS avg_cycle_days,
       COUNT(*) FILTER (WHERE status = 'won' AND churn_score >= 60)::int AS clients_at_churn_risk,
       COUNT(*) FILTER (WHERE last_activity_at < now() - interval '30 days'
         AND status NOT IN ('won','lost') AND deal_value > 0)::int AS open_deals_quiet_30d
     FROM opportunities WHERE user_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2))`,
    [userId, oppIds]
  );
  ctx.totals = totals.rows[0];
  const w = ctx.totals.won_365d, l = ctx.totals.lost_365d;
  ctx.totals.win_rate_365d = (w + l) > 0 ? Math.round((w / (w + l)) * 100) : null;

  const stages = await db.query(
    `SELECT crm_stage AS stage, COUNT(*)::int AS count, COALESCE(SUM(deal_value), 0)::float AS value
     FROM opportunities
     WHERE user_id = $1 AND crm_stage IS NOT NULL AND status NOT IN ('won','lost')
       AND ($2::uuid[] IS NULL OR id = ANY($2))
     GROUP BY crm_stage ORDER BY count DESC LIMIT 15`,
    [userId, oppIds]
  );
  if (stages.rows.length > 0) ctx.open_deals_by_crm_stage = stages.rows;

  if (oppIds !== null) return ctx;

  const emails = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'sent' AND created_at > now() - interval '30 days')::int AS sent_30d,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_approval
     FROM nurture_emails WHERE user_id = $1`,
    [userId]
  );
  ctx.activation_emails = emails.rows[0];

  try {
    const { computeForecast } = require('../lib/forecast-engine');
    const f = await computeForecast(userId);
    ctx.forecast = { scenarios: f.scenarios, counts: f.counts, context: f.context };
  } catch { /* forecast optionnel */ }

  try {
    let teamId = null;
    const team = await db.teams.getByUser(userId);
    if (team) teamId = team.id;
    const patterns = await db.memoryPatterns.listForPrompt(5, teamId, userId);
    if (patterns.length > 0) {
      ctx.learned_patterns = patterns.map(p => p.pattern).filter(Boolean);
    }
  } catch { /* mémoire optionnelle */ }

  return ctx;
}

module.exports = router;
// Réutilisé par le playbook à la demande (routes/ai.js) — mêmes agrégats,
// même garantie : rien qui ne vienne pas de la base.
module.exports.buildAnalyticsContext = buildAnalyticsContext;
