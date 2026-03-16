const { Router } = require('express');
const db = require('../db');
const hubspotSync = require('../orchestrator/jobs/hubspot-sync');

const router = Router();

// GET /api/dashboard — Aggregated KPIs + active campaigns (scoped to user)
router.get('/', async (req, res, next) => {
  try {
    const kpis = await db.dashboardKpis(req.user.id);
    const campaigns = await db.campaigns.list({ status: 'active', userId: req.user.id });

    res.json({ kpis, campaigns });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/memory — Cross-campaign patterns
router.get('/memory', async (req, res, next) => {
  try {
    const { category, confidence } = req.query;
    const patterns = await db.memoryPatterns.list({ category, confidence });

    res.json({ patterns });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/opportunities
router.get('/opportunities', async (req, res, next) => {
  try {
    const opportunities = await db.opportunities.listByUser(req.user.id);
    res.json({ opportunities });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/reports
router.get('/reports', async (req, res, next) => {
  try {
    const reports = await db.reports.listByUser(req.user.id);
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

// POST /api/dashboard/opportunities — Create opportunity
router.post('/opportunities', async (req, res, next) => {
  try {
    const opportunity = await db.opportunities.create({ ...req.body, userId: req.user.id });

    // Auto-sync to HubSpot if status warrants it
    hubspotSync.onStatusChange({
      opportunityId: opportunity.id,
      newStatus: opportunity.status,
    }).catch(console.error);

    res.status(201).json(opportunity);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dashboard/opportunities/:id — Update opportunity (triggers HubSpot sync on status change)
router.patch('/opportunities/:id', async (req, res, next) => {
  try {
    const existing = await db.opportunities.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Opportunity not found' });
    if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = await db.opportunities.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'No changes' });

    // Trigger HubSpot sync on status change
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

module.exports = router;
