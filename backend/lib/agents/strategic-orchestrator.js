/**
 * Strategic Agent Orchestrator
 *
 * Coordinates all strategic agents and exposes them to the API/chat.
 *
 * Agents:
 * 1. Competitor Watch — competitive landscape analysis
 * 2. Timing Agent — optimal send windows
 * 3. Deal Coach — next best action for stagnant deals
 * 4. Upsell Detector — cross-sell/upsell opportunities
 * 5. Win/Loss Analyst — patterns from won vs lost deals
 * 6. Copy Optimizer — email copy analysis + improvement
 * 7. ICP Refiner — ideal customer profile refinement
 * 8. Sequence Analyzer — drop-off, optimal length, channel mix
 *
 * Can run:
 * - All agents at once (weekly, Sunday after Memory Agent)
 * - Individual agents on-demand (from chat or API)
 */

const logger = require('../logger');

const AGENTS = {
  competitor_watch: { name: 'Competitor Watch', module: './competitor-watch' },
  timing: { name: 'Timing Agent', module: './timing-agent' },
  deal_coach: { name: 'Deal Coach', module: './deal-coach' },
  upsell: { name: 'Upsell Detector', module: './upsell-detector' },
  win_loss: { name: 'Win/Loss Analyst', module: './win-loss-analyst' },
  copy_optimizer: { name: 'Copy Optimizer', module: './copy-optimizer' },
  icp_refiner: { name: 'ICP Refiner', module: './icp-refiner' },
  sequence_analyzer: { name: 'Sequence Analyzer', module: './sequence-analyzer' },
};

const AGENT_TIMEOUT_MS = 60000; // 60s per agent

/**
 * Run all strategic agents for a user (parallel with timeout).
 */
async function runAll(userId) {
  const startTime = Date.now();
  const entries = Object.entries(AGENTS);

  const settled = await Promise.allSettled(
    entries.map(([key, config]) => {
      const run = async () => {
        const agent = require(config.module);
        return agent.run(userId);
      };
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${AGENT_TIMEOUT_MS}ms`)), AGENT_TIMEOUT_MS)
      );
      return Promise.race([run(), timeout]).then(
        result => ({ key, config, result }),
        err => ({ key, config, result: { errors: [err.message] } })
      );
    })
  );

  const results = {};
  for (const s of settled) {
    const { key, config, result } = s.status === 'fulfilled' ? s.value : { key: 'unknown', config: { name: 'unknown' }, result: { errors: [s.reason?.message] } };
    results[key] = result;
    if (result.errors?.length) {
      logger.warn('strategic-orchestrator', `${config.name} failed: ${result.errors.join(', ')}`);
    } else {
      logger.info('strategic-orchestrator', `${config.name}: done`);
    }
  }

  results.duration = Date.now() - startTime;
  logger.info('strategic-orchestrator', `All agents done for user ${userId} in ${results.duration}ms`);
  return results;
}

/**
 * Run a single strategic agent.
 */
async function runOne(userId, agentKey) {
  const config = AGENTS[agentKey];
  if (!config) throw new Error(`Unknown agent: ${agentKey}. Available: ${Object.keys(AGENTS).join(', ')}`);

  const agent = require(config.module);
  return agent.run(userId);
}

/**
 * List available agents.
 */
function listAgents() {
  return Object.entries(AGENTS).map(([key, config]) => ({
    key,
    name: config.name,
  }));
}

module.exports = { runAll, runOne, listAgents, AGENTS };
