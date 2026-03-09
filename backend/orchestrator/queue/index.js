/**
 * Job Queue — Abstraction layer
 *
 * Phase A: Simple in-memory queue (sequential processing)
 * Phase B: Swap to BullMQ + Redis for parallel processing
 *
 * Usage:
 *   const queue = require('./queue');
 *   queue.add('collect-stats', { campaignId: '123' });
 */

const processors = require('./processors');

// --- In-memory queue (Phase A) ---

const pending = [];
let processing = false;

async function add(jobName, data = {}) {
  pending.push({ jobName, data, createdAt: new Date() });
  if (!processing) processNext();
}

async function processNext() {
  if (pending.length === 0) { processing = false; return; }
  processing = true;
  const job = pending.shift();
  try {
    await processors.process(job.jobName, job.data);
  } catch (err) {
    console.error(`[queue] Job ${job.jobName} failed:`, err.message);
    // TODO: retry logic, dead-letter handling
  }
  processNext();
}

module.exports = { add };

// --- BullMQ upgrade (Phase B) ---
// const { Queue, Worker } = require('bullmq');
// const connection = { host: process.env.REDIS_HOST, port: 6379 };
// const queue = new Queue('orchestrator', { connection });
// new Worker('orchestrator', async (job) => {
//   await processors.process(job.name, job.data);
// }, { connection, concurrency: 3 });
// module.exports = queue;
