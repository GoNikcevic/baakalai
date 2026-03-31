/**
 * CRM Analytics Routes
 *
 * GET /api/analytics/pipeline      — Pipeline stage breakdown + conversion rates
 * GET /api/analytics/attribution   — Revenue attribution per campaign
 * GET /api/analytics/scoring       — Lead scoring dashboard
 * GET /api/analytics/trends        — Weekly KPI trend data
 * GET /api/analytics/channels      — Channel performance comparison
 * GET /api/analytics/health        — CRM health score + alerts
 */

const { Router } = require('express');
const db = require('../db');
const { scoreOpportunities } = require('../lib/lead-scoring');

const router = Router();

// ── Stage definitions (ordered for funnel) ──

const STAGE_DEFS = [
  { stage: 'new', label: 'Nouveau' },
  { stage: 'interested', label: 'Intéressé' },
  { stage: 'meeting', label: 'RDV' },
  { stage: 'negotiation', label: 'Négociation' },
  { stage: 'won', label: 'Gagné' },
  { stage: 'lost', label: 'Perdu' },
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

    res.json({ stages, conversions, total, avgTimeInStage });
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
    const [allCampaigns, allOpportunities] = await Promise.all([
      db.campaigns.list({ userId }),
      db.opportunities.listByUser(userId, 10000, 0),
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

    res.json({ campaigns, totals });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/analytics/scoring
// =============================================

router.get('/scoring', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [opportunities, allCampaigns, profile] = await Promise.all([
      db.opportunities.listByUser(userId, 10000, 0),
      db.campaigns.list({ userId }),
      db.profiles.get(userId),
    ]);

    // Build campaign map
    const campaignMap = {};
    for (const c of allCampaigns) campaignMap[c.id] = c;

    // Score all opportunities
    const scored = scoreOpportunities(opportunities, profile, campaignMap);
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Distribution buckets
    const distribution = { high: 0, medium: 0, low: 0 };
    let totalScore = 0;
    for (const opp of scored) {
      const s = opp.score || 0;
      totalScore += s;
      if (s >= 70) distribution.high++;
      else if (s >= 40) distribution.medium++;
      else distribution.low++;
    }

    const leads = scored.map(opp => ({
      id: opp.id,
      name: opp.name,
      company: opp.company,
      title: opp.title,
      status: opp.status,
      score: opp.score || 0,
      scoreBreakdown: opp.scoreBreakdown || { engagement: 0, fit: 0 },
      campaign: campaignMap[opp.campaign_id]?.name || null,
      updatedAt: opp.updated_at,
    }));

    res.json({
      leads,
      distribution,
      avgScore: scored.length > 0
        ? Math.round((totalScore / scored.length) * 10) / 10
        : 0,
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
    const [chartRows, reports] = await Promise.all([
      db.chartData.listByUser(userId),
      db.reports.listByUser(userId, 52, 0),
    ]);

    let weeks;

    if (chartRows.length > 0) {
      // Build report lookup by week label
      const reportByWeek = {};
      for (const r of reports) reportByWeek[r.week] = r;

      weeks = chartRows.map(row => {
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
      weeks = reports.map(r => ({
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

module.exports = router;
