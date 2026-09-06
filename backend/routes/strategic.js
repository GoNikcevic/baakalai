/**
 * Strategic Agents Routes
 *
 * POST /api/strategic/run-all    — Run all strategic agents
 * POST /api/strategic/run/:agent — Run a specific agent
 * GET  /api/strategic/agents     — List available agents
 */

const { Router } = require('express');
const { runAll, runOne, listAgents, AGENTS } = require('../lib/agents/strategic-orchestrator');
const db = require('../db');

const router = Router();

// GET /api/strategic/agents — List available agents
router.get('/agents', (_req, res) => {
  res.json({ agents: listAgents() });
});

// POST /api/strategic/run-all — Run all agents
router.post('/run-all', async (req, res, next) => {
  try {
    const results = await runAll(req.user.id);
    res.json(results);
  } catch (err) { next(err); }
});

// GET /api/strategic/results/:agent — Latest persisted result (no LLM call)
router.get('/results/:agent', async (req, res, next) => {
  const { agent } = req.params;
  if (!AGENTS[agent]) {
    return res.status(400).json({ error: `Unknown agent: ${agent}. Available: ${Object.keys(AGENTS).join(', ')}` });
  }
  try {
    const result = await db.query(
      `SELECT result, created_at FROM strategic_results
       WHERE user_id = $1 AND agent = $2
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, agent]
    );
    const row = result.rows[0];
    res.json({ result: row?.result || null, createdAt: row?.created_at || null });
  } catch (err) { next(err); }
});

// POST /api/strategic/run/:agent — Run a specific agent
router.post('/run/:agent', async (req, res, next) => {
  const { agent } = req.params;
  if (!AGENTS[agent]) {
    return res.status(400).json({ error: `Unknown agent: ${agent}. Available: ${Object.keys(AGENTS).join(', ')}` });
  }
  try {
    const result = await runOne(req.user.id, agent);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
