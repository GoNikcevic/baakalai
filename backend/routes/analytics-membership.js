/**
 * Membership Analytics Routes
 *
 * GET /api/analytics/membership · Full membership analytics dashboard data
 * GET /api/analytics/membership/cohorts · Cohort retention analysis
 * GET /api/analytics/membership/ltv · LTV by segment
 */

const { Router } = require('express');
const db = require('../db');

const router = Router();

// GET /api/analytics/membership · Full dashboard
router.get('/', async (req, res, next) => {
  try {
    // 1. Overview KPIs
    const kpis = await db.query(`
      SELECT
        COUNT(*) AS total_contacts,
        COUNT(*) FILTER (WHERE status = 'won') AS total_won,
        COUNT(*) FILTER (WHERE status = 'lost') AS total_lost,
        COUNT(*) FILTER (WHERE churn_score >= 50) AS at_risk,
        ROUND(AVG(deal_value) FILTER (WHERE deal_value > 0), 2) AS avg_deal_value,
        ROUND(SUM(deal_value) FILTER (WHERE status = 'won'), 2) AS total_revenue,
        ROUND(AVG(EXTRACT(EPOCH FROM (won_date - created_at)) / 86400) FILTER (WHERE won_date IS NOT NULL), 1) AS avg_cycle_days,
        ROUND(AVG(churn_score) FILTER (WHERE churn_score IS NOT NULL), 1) AS avg_churn_score
      FROM opportunities WHERE user_id = $1
    `, [req.user.id]);

    // 2. Win rate by owner/rep
    const byOwner = await db.query(`
      SELECT
        COALESCE(owner_email, 'unassigned') AS rep,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'won') AS won,
        COUNT(*) FILTER (WHERE status = 'lost') AS lost,
        ROUND(SUM(deal_value) FILTER (WHERE status = 'won'), 2) AS revenue
      FROM opportunities WHERE user_id = $1
      GROUP BY owner_email
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) FILTER (WHERE status = 'won') DESC
    `, [req.user.id]);

    // 3. Revenue by company size
    const bySize = await db.query(`
      SELECT
        COALESCE(company_size, 'unknown') AS segment,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'won') AS won,
        ROUND(AVG(deal_value) FILTER (WHERE deal_value > 0), 2) AS avg_value,
        ROUND(SUM(deal_value) FILTER (WHERE status = 'won'), 2) AS revenue
      FROM opportunities WHERE user_id = $1
      GROUP BY company_size
      ORDER BY SUM(deal_value) FILTER (WHERE status = 'won') DESC NULLS LAST
    `, [req.user.id]);

    // 4. Churn distribution
    const churnDist = await db.query(`
      SELECT
        CASE
          WHEN churn_score >= 76 THEN 'critical'
          WHEN churn_score >= 51 THEN 'high'
          WHEN churn_score >= 26 THEN 'medium'
          ELSE 'low'
        END AS band,
        COUNT(*) AS count,
        ROUND(AVG(deal_value) FILTER (WHERE deal_value > 0), 2) AS avg_value
      FROM opportunities WHERE user_id = $1 AND churn_score IS NOT NULL
      GROUP BY 1
      ORDER BY MIN(churn_score)
    `, [req.user.id]);

    // 5. Tenure distribution (months since won)
    const tenure = await db.query(`
      SELECT
        CASE
          WHEN EXTRACT(EPOCH FROM (now() - won_date)) / 2592000 < 1 THEN '< 1 month'
          WHEN EXTRACT(EPOCH FROM (now() - won_date)) / 2592000 < 3 THEN '1-3 months'
          WHEN EXTRACT(EPOCH FROM (now() - won_date)) / 2592000 < 6 THEN '3-6 months'
          WHEN EXTRACT(EPOCH FROM (now() - won_date)) / 2592000 < 12 THEN '6-12 months'
          ELSE '12+ months'
        END AS band,
        COUNT(*) AS count,
        ROUND(SUM(deal_value), 2) AS total_value
      FROM opportunities WHERE user_id = $1 AND won_date IS NOT NULL
      GROUP BY 1
    `, [req.user.id]);

    // 6. Monthly trend (wins + revenue last 12 months)
    const trend = await db.query(`
      SELECT
        TO_CHAR(won_date, 'YYYY-MM') AS month,
        COUNT(*) AS wins,
        ROUND(SUM(deal_value), 2) AS revenue
      FROM opportunities
      WHERE user_id = $1 AND won_date IS NOT NULL AND won_date > now() - interval '12 months'
      GROUP BY 1
      ORDER BY 1
    `, [req.user.id]);

    // 7. Upcoming renewals (next 60 days)
    const renewals = await db.query(`
      SELECT id, name, company, email, renewal_date, deal_value, churn_score
      FROM opportunities
      WHERE user_id = $1 AND renewal_date IS NOT NULL
        AND renewal_date BETWEEN now() AND now() + interval '60 days'
        AND status != 'lost'
      ORDER BY renewal_date ASC
      LIMIT 20
    `, [req.user.id]);

    res.json({
      kpis: kpis.rows[0] || {},
      byOwner: byOwner.rows,
      bySize: bySize.rows,
      churnDistribution: churnDist.rows,
      tenure: tenure.rows,
      monthlyTrend: trend.rows,
      upcomingRenewals: renewals.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/analytics/membership/cohorts · Monthly cohort retention
router.get('/cohorts', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS cohort,
        COUNT(*) AS entered,
        COUNT(*) FILTER (WHERE status = 'won') AS converted,
        COUNT(*) FILTER (WHERE status = 'lost') AS lost,
        COUNT(*) FILTER (WHERE status NOT IN ('won', 'lost')) AS active,
        ROUND(AVG(deal_value) FILTER (WHERE deal_value > 0), 2) AS avg_value
      FROM opportunities WHERE user_id = $1 AND created_at > now() - interval '12 months'
      GROUP BY 1
      ORDER BY 1
    `, [req.user.id]);

    res.json({ cohorts: result.rows });
  } catch (err) { next(err); }
});

// GET /api/analytics/membership/ltv · LTV by segment
router.get('/ltv', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        COALESCE(company_size, 'unknown') AS segment,
        COUNT(*) AS clients,
        ROUND(AVG(deal_value), 2) AS avg_deal,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(lost_date, now()) - won_date)) / 2592000), 1) AS avg_tenure_months,
        ROUND(AVG(deal_value) * AVG(EXTRACT(EPOCH FROM (COALESCE(lost_date, now()) - won_date)) / 2592000), 2) AS estimated_ltv
      FROM opportunities
      WHERE user_id = $1 AND status = 'won' AND won_date IS NOT NULL AND deal_value > 0
      GROUP BY company_size
      HAVING COUNT(*) >= 2
      ORDER BY estimated_ltv DESC
    `, [req.user.id]);

    res.json({ segments: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
