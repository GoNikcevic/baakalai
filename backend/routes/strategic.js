/**
 * Strategic Agents Routes
 *
 * POST /api/strategic/run-all    — Run all strategic agents
 * POST /api/strategic/run/:agent — Run a specific agent
 * GET  /api/strategic/agents     — List available agents
 */

const { Router } = require('express');
const { runAll, runOne, listAgents, AGENTS } = require('../lib/agents/strategic-orchestrator');
const { runDealReactivation, runAutoUpsell, getChainConfig, approvePendingExecution } = require('../lib/agent-chains');
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

// ═══════════════════════════════════════════════════
// Agent Chains (L4 autonomous actions)
// ═══════════════════════════════════════════════════

// GET /api/strategic/chains/config — Get chain config for current user
router.get('/chains/config', async (req, res, next) => {
  try {
    const config = await getChainConfig(req.user.id);
    res.json({
      deal_reactivation: config.deal_reactivation,
      auto_upsell: config.auto_upsell,
      adaptive_prospection: config.adaptive_prospection,
    });
  } catch (err) { next(err); }
});

// PUT /api/strategic/chains/config — Update chain config
router.put('/chains/config', async (req, res, next) => {
  try {
    const { deal_reactivation, auto_upsell, adaptive_prospection } = req.body;
    const updates = [];
    const values = [req.user.id];
    let idx = 2;

    if (deal_reactivation) {
      updates.push(`deal_reactivation = $${idx}::jsonb`);
      values.push(JSON.stringify(deal_reactivation));
      idx++;
    }
    if (auto_upsell) {
      updates.push(`auto_upsell = $${idx}::jsonb`);
      values.push(JSON.stringify(auto_upsell));
      idx++;
    }
    if (adaptive_prospection) {
      updates.push(`adaptive_prospection = $${idx}::jsonb`);
      values.push(JSON.stringify(adaptive_prospection));
      idx++;
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No config provided' });

    // Ensure row exists
    await db.query('INSERT INTO agent_chain_configs (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
    await db.query(
      `UPDATE agent_chain_configs SET ${updates.join(', ')}, updated_at = now() WHERE user_id = $1`,
      values
    );

    const config = await getChainConfig(req.user.id);
    res.json(config);
  } catch (err) { next(err); }
});

// POST /api/strategic/chains/run/:chain — Run a specific chain manually
router.post('/chains/run/:chain', async (req, res, next) => {
  const { chain } = req.params;
  try {
    let result;
    if (chain === 'deal_reactivation') result = await runDealReactivation(req.user.id);
    else if (chain === 'auto_upsell') result = await runAutoUpsell(req.user.id);
    else return res.status(400).json({ error: `Unknown chain: ${chain}` });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/strategic/chains/history — Get chain execution history
router.get('/chains/history', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT * FROM agent_chain_executions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ executions: result.rows });
  } catch (err) { next(err); }
});

// POST /api/strategic/chains/approve/:id — Approve a pending chain execution
router.post('/chains/approve/:id', async (req, res, next) => {
  try {
    const result = await approvePendingExecution(req.params.id, req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
