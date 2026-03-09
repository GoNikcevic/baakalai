/**
 * Job Processors — Routes job names to their handler functions
 */

const collectStats = require('../jobs/collect-stats');
const regenerate = require('../jobs/regenerate');
const consolidate = require('../jobs/consolidate');

const handlers = {
  'collect-stats': collectStats.run,
  'regenerate': regenerate.run,
  'consolidate': consolidate.run,
};

async function process(jobName, data) {
  const handler = handlers[jobName];
  if (!handler) throw new Error(`Unknown job: ${jobName}`);
  return handler(data);
}

module.exports = { process };
