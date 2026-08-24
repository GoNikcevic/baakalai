/**
 * CRM Analytics Routes
 *
 * GET /api/analytics/pipeline      — Pipeline stage breakdown + conversion rates
 * GET /api/analytics/attribution   — Revenue attribution per campaign
 * GET /api/analytics/scoring       — Lead scoring dashboard
 * GET /api/analytics/trends        — Weekly KPI trend data
 * GET /api/analytics/channels      — Channel performance comparison
 * GET /api/analytics/health        — CRM health score + alerts
 * GET /api/analytics/renewals      — Renewal pipeline (overdue / 30 / 60 / 90 day windows)
 * GET /api/analytics/segments      — Smart segments (auto-grouping of contacts)
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

// =============================================
// GET /api/analytics/pipeline
// =============================================

router.get('/pipeline', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await db.opportunities.listByUser(userId, 10000, 0);
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

    // Avg time in stage (days since created_at / updated_at)
    const now = Date.now();
    const stageTimes = {};
    const stageCounts = {};
    for (const opp of opportunities) {
      const stage = canonicalStage(opp.status);
      const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;
      const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;
      const daysInStage = (now - updatedAt) / (1000 * 60 * 60 * 24);
      stageTimes[stage] = (stageTimes[stage] || 0) + daysInStage;
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }
    const avgTimeInStage = {};
    for (const def of STAGE_DEFS) {
      avgTimeInStage[def.stage] = stageCounts[def.stage]
        ? Math.round((stageTimes[def.stage] / stageCounts[def.stage]) * 10) / 10
        : 0;
    }

    // ── Period comparison: current 30d vs previous 30d ──
    const now30 = now - 30 * 24 * 60 * 60 * 1000;
    const now60 = now - 60 * 24 * 60 * 60 * 1000;

    const currentOpps = opportunities.filter(o => {
      const ca = o.created_at ? new Date(o.created_at).getTime() : 0;
      return ca >= now30;
    });
    const previousOpps = opportunities.filter(o => {
      const ca = o.created_at ? new Date(o.created_at).getTime() : 0;
      return ca >= now60 && ca < now30;
    });

    const curTotal = currentOpps.length;
    const curWon = currentOpps.filter(o => canonicalStage(o.status) === 'won').length;
    const curLost = currentOpps.filter(o => canonicalStage(o.status) === 'lost').length;
    const curWinRate = (curWon + curLost) > 0 ? Math.round((curWon / (curWon + curLost)) * 100) : 0;

    const prevTotal = previousOpps.length;
    const prevWon = previousOpps.filter(o => canonicalStage(o.status) === 'won').length;
    const prevLost = previousOpps.filter(o => canonicalStage(o.status) === 'lost').length;
    const prevWinRate = (prevWon + prevLost) > 0 ? Math.round((prevWon / (prevWon + prevLost)) * 100) : 0;

    const comparison = {
      current: { total: curTotal, won: curWon, lost: curLost, winRate: curWinRate },
      previous: { total: prevTotal, won: prevWon, lost: prevLost, winRate: prevWinRate },
      changes: {
        total: curTotal - prevTotal,
        won: curWon - prevWon,
        winRate: curWinRate - prevWinRate,
      },
    };

    res.json({ stages, conversions, total, avgTimeInStage, comparison });
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
      db.opportunities.listByUser(userId, 10000, 0),
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
// GET /api/analytics/scoring
// =============================================

router.get('/scoring', async (req, res, next) => {
  try {
    const result = await scoreAllContacts(req.user.id);

    res.json({
      leads: result.contacts.slice(0, 200),
      distribution: result.distribution,
      avgScore: result.avgScore,
    });
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
      db.opportunities.listByUser(userId, 10000, 0),
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
    const allOpportunities = await db.opportunities.listByUser(userId, 10000, 0);
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

    res.json({
      revenueHistory,
      pipeline: { byStage: pipelineByStage, totalValue: totalPipeline, weightedForecast: totalWeighted },
      salesCycle: { avgDays: avgSalesCycle, closedDeals: closedDeals.length },
      projectedDeals,
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
// GET /api/analytics/renewals
// =============================================

router.get('/renewals', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await db.opportunities.listByUser(userId, 10000, 0);
    const now = new Date();
    const DAY_MS = 1000 * 60 * 60 * 24;

    // Compute renewal date for each opportunity
    // Priority: renewal_date > close_date > (won_date + 365) > (updated_at + 365)
    const withRenewal = opportunities
      .filter(o => canonicalStage(o.status) !== 'lost')
      .map(o => {
        let renewalDate = null;
        if (o.renewal_date) {
          renewalDate = new Date(o.renewal_date);
        } else if (o.close_date) {
          renewalDate = new Date(o.close_date);
        } else if (o.won_date) {
          renewalDate = new Date(new Date(o.won_date).getTime() + 365 * DAY_MS);
        } else if (o.updated_at) {
          renewalDate = new Date(new Date(o.updated_at).getTime() + 365 * DAY_MS);
        }
        if (!renewalDate || isNaN(renewalDate.getTime())) return null;

        const daysUntil = Math.round((renewalDate.getTime() - now.getTime()) / DAY_MS);
        return {
          id: o.id,
          name: o.name,
          email: o.email,
          company: o.company,
          renewal_date: renewalDate.toISOString().split('T')[0],
          deal_value: Number(o.deal_value || 0),
          days_until: daysUntil,
        };
      })
      .filter(Boolean);

    // Group by renewal window
    const overdue = { count: 0, contacts: [] };
    const next30 = { count: 0, contacts: [] };
    const next60 = { count: 0, contacts: [] };
    const next90 = { count: 0, contacts: [] };
    const later = { count: 0 };

    for (const c of withRenewal) {
      if (c.days_until < 0) {
        overdue.count++;
        overdue.contacts.push(c);
      } else if (c.days_until <= 30) {
        next30.count++;
        next30.contacts.push(c);
      } else if (c.days_until <= 60) {
        next60.count++;
        next60.contacts.push(c);
      } else if (c.days_until <= 90) {
        next90.count++;
        next90.contacts.push(c);
      } else {
        later.count++;
      }
    }

    // Sort contacts by renewal date (soonest first)
    overdue.contacts.sort((a, b) => a.days_until - b.days_until);
    next30.contacts.sort((a, b) => a.days_until - b.days_until);
    next60.contacts.sort((a, b) => a.days_until - b.days_until);
    next90.contacts.sort((a, b) => a.days_until - b.days_until);

    res.json({ total: withRenewal.length, overdue, next30, next60, next90, later });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/segments
// =============================================

router.get('/segments', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const opportunities = await db.opportunities.listByUser(userId, 10000, 0);
    const now = Date.now();
    const DAY_MS = 1000 * 60 * 60 * 24;
    const DAYS_30 = 30 * DAY_MS;
    const DAYS_90 = 90 * DAY_MS;

    // Compute average deal value for Champions threshold
    const dealsWithValue = opportunities.filter(o => o.deal_value > 0);
    const avgDealValue = dealsWithValue.length > 0
      ? dealsWithValue.reduce((sum, o) => sum + Number(o.deal_value), 0) / dealsWithValue.length
      : 0;

    // Classify each opportunity into a segment
    const segments = {
      champions: { contacts: [], totalValue: 0 },
      active: { contacts: [], totalValue: 0 },
      new: { contacts: [] },
      at_risk: { contacts: [], totalChurnScore: 0 },
      dormant: { contacts: [], totalDaysSince: 0 },
    };

    for (const opp of opportunities) {
      const stage = canonicalStage(opp.status);
      const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : 0;
      const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;
      const daysSinceActivity = (now - updatedAt) / DAY_MS;
      const churnScore = opp.churn_score || 0;
      const dealValue = Number(opp.deal_value || 0);

      const contact = {
        id: opp.id,
        name: opp.name,
        email: opp.email,
        company: opp.company,
        churn_score: churnScore,
        deal_value: dealValue,
        last_activity: opp.updated_at || opp.created_at || null,
      };

      // Champions: won + above-avg deal value + low churn
      if (stage === 'won' && dealValue > avgDealValue && churnScore < 30) {
        segments.champions.contacts.push(contact);
        segments.champions.totalValue += dealValue;
      }
      // New: created in last 30 days
      else if ((now - createdAt) < DAYS_30) {
        segments.new.contacts.push(contact);
      }
      // Dormant: no activity in 90+ days
      else if ((now - updatedAt) >= DAYS_90) {
        segments.dormant.contacts.push(contact);
        segments.dormant.totalDaysSince += daysSinceActivity;
      }
      // At-risk: high churn OR inactive 30-90 days and not won
      else if (churnScore >= 50 || ((now - updatedAt) >= DAYS_30 && stage !== 'won')) {
        segments.at_risk.contacts.push(contact);
        segments.at_risk.totalChurnScore += churnScore;
      }
      // Active: recent activity + positive status
      else if ((now - updatedAt) < DAYS_30 && (stage === 'won' || stage === 'interested' || stage === 'meeting')) {
        segments.active.contacts.push(contact);
        segments.active.totalValue += dealValue;
      }
      // Fallback: if none of the above matched, put in active
      else {
        segments.active.contacts.push(contact);
        segments.active.totalValue += dealValue;
      }
    }

    const result = [
      {
        key: 'champions',
        count: segments.champions.contacts.length,
        totalValue: Math.round(segments.champions.totalValue),
        contacts: segments.champions.contacts.slice(0, 10),
      },
      {
        key: 'active',
        count: segments.active.contacts.length,
        totalValue: Math.round(segments.active.totalValue),
        contacts: segments.active.contacts.slice(0, 10),
      },
      {
        key: 'new',
        count: segments.new.contacts.length,
        contacts: segments.new.contacts.slice(0, 10),
      },
      {
        key: 'at_risk',
        count: segments.at_risk.contacts.length,
        avgChurnScore: segments.at_risk.contacts.length > 0
          ? Math.round(segments.at_risk.totalChurnScore / segments.at_risk.contacts.length)
          : 0,
        contacts: segments.at_risk.contacts.slice(0, 10),
      },
      {
        key: 'dormant',
        count: segments.dormant.contacts.length,
        daysSinceActivity: segments.dormant.contacts.length > 0
          ? Math.round(segments.dormant.totalDaysSince / segments.dormant.contacts.length)
          : 0,
        contacts: segments.dormant.contacts.slice(0, 10),
      },
    ];

    res.json({ segments: result, total: opportunities.length });
  } catch (err) {
    next(err);
  }
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
    const opportunities = await db.opportunities.listByUser(userId, 10000, 0);
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
    const [allCampaigns, allOpps] = await Promise.all([db.campaigns.list({ userId }), db.opportunities.listByUser(userId, 10000, 0)]);
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

// GET /api/analytics/scoring/csv
router.get('/scoring/csv', async (req, res, next) => {
  try {
    const result = await scoreAllContacts(req.user.id);
    const headers = ['Score', 'Name', 'Company', 'Title', 'Status', 'Campaign', 'Activity', 'Fit', 'Last Activity'];
    const rows = result.contacts.map(c => [c.score, c.name, c.company, c.title, c.status, c.campaign || '', c.breakdown?.activity || 0, c.breakdown?.fit || 0, c.lastActivity || '']);
    sendCsv(res, 'baakal-contact-score.csv', headers, rows);
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
    const opportunities = await db.opportunities.listByUser(userId, 10000, 0);
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
    const opportunities = await db.opportunities.listByUser(userId, 10000, 0);
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
    const opportunities = await db.opportunities.listByUser(userId, 10000, 0);
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

module.exports = router;
