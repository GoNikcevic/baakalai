/* ===============================================================================
   BAKAL — Outreach Deploy
   Creates campaigns on Apollo, Instantly, and Smartlead from Baakal-generated
   sequences. Maps Lemlist variables to each provider's format.
   =============================================================================== */

const { getUserKey } = require('../config');
const { withRetry } = require('./retry');
const logger = require('./logger');

// Variable mapping from Lemlist format to each provider's format
const VARIABLE_MAP = {
  apollo: {
    '{{firstName}}': '{{first_name}}',
    '{{lastName}}': '{{last_name}}',
    '{{companyName}}': '{{company}}',
    '{{jobTitle}}': '{{title}}',
  },
  instantly: {
    '{{firstName}}': '{{firstName}}',
    '{{lastName}}': '{{lastName}}',
    '{{companyName}}': '{{companyName}}',
    '{{jobTitle}}': '{{jobTitle}}',
  },
  smartlead: {
    '{{firstName}}': '{{first_name}}',
    '{{lastName}}': '{{last_name}}',
    '{{companyName}}': '{{company_name}}',
    '{{jobTitle}}': '{{job_title}}',
  },
};

/**
 * Replace Lemlist-style variables with provider-specific equivalents.
 */
function mapVariables(text, provider) {
  if (!text) return text;
  const map = VARIABLE_MAP[provider] || {};
  let result = text;
  for (const [from, to] of Object.entries(map)) {
    result = result.replace(new RegExp(from.replace(/[{}]/g, '\\$&'), 'g'), to);
  }
  return result;
}

/**
 * Extract day number from timing string like "J+3".
 */
function extractDays(timing) {
  const match = (timing || '').match(/J\+(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// Apollo — Create campaign with emailer_steps in a single call
// ---------------------------------------------------------------------------

async function deployToApollo(apiKey, campaignName, steps) {
  const emailerSteps = steps.map((s) => ({
    type: 'auto_email',
    wait_time: s.days,
    subject_template: s.subject || '',
    body_template: s.body || '',
  }));

  const res = await withRetry(async () => {
    const r = await fetch('https://api.apollo.io/api/v1/emailer_campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({
        name: campaignName,
        emailer_steps: emailerSteps,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Apollo API ${r.status}: ${body}`);
    }
    return r.json();
  }, { maxRetries: 2, baseDelay: 1000 });

  const campaignId = res.emailer_campaign?.id || res.id || null;
  logger.info('outreach-deploy', `Apollo campaign created: ${campaignId}`, { campaignName });
  return { success: true, campaignId, provider: 'apollo' };
}

// ---------------------------------------------------------------------------
// Instantly — Create campaign, then add steps one by one
// ---------------------------------------------------------------------------

async function deployToInstantly(apiKey, campaignName, steps) {
  // 1. Create the campaign
  const createRes = await withRetry(async () => {
    const r = await fetch(`https://api.instantly.ai/api/v1/campaign/add?api_key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: campaignName }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Instantly create campaign ${r.status}: ${body}`);
    }
    return r.json();
  }, { maxRetries: 2, baseDelay: 1000 });

  const campaignId = createRes.id;
  if (!campaignId) throw new Error('Instantly did not return a campaign ID');

  // 2. Add each step as a sequence step
  for (const s of steps) {
    await withRetry(async () => {
      const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          type: 'email',
          wait: s.days,
          variants: [
            { subject: s.subject || '', body: s.body || '' },
          ],
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`Instantly add step ${r.status}: ${body}`);
      }
      return r.json();
    }, { maxRetries: 2, baseDelay: 1000 });
  }

  logger.info('outreach-deploy', `Instantly campaign created: ${campaignId}`, { campaignName });
  return { success: true, campaignId, provider: 'instantly' };
}

// ---------------------------------------------------------------------------
// Smartlead — Create campaign, then save all sequences in one call
// ---------------------------------------------------------------------------

async function deployToSmartlead(apiKey, campaignName, steps) {
  // 1. Create the campaign
  const createRes = await withRetry(async () => {
    const r = await fetch(`https://server.smartlead.ai/api/v1/campaigns/create?api_key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: campaignName }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Smartlead create campaign ${r.status}: ${body}`);
    }
    return r.json();
  }, { maxRetries: 2, baseDelay: 1000 });

  const campaignId = createRes.id;
  if (!campaignId) throw new Error('Smartlead did not return a campaign ID');

  // 2. Save all sequences at once
  const sequences = steps.map((s, i) => ({
    seq_number: i + 1,
    seq_delay_details: { delay_in_days: s.days },
    subject: s.subject || '',
    email_body: s.body || '',
  }));

  await withRetry(async () => {
    const r = await fetch(`https://server.smartlead.ai/api/v1/campaigns/${campaignId}/sequences?api_key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequences }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Smartlead save sequences ${r.status}: ${body}`);
    }
    return r.json();
  }, { maxRetries: 2, baseDelay: 1000 });

  logger.info('outreach-deploy', `Smartlead campaign created: ${campaignId}`, { campaignName });
  return { success: true, campaignId, provider: 'smartlead' };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Deploy a Baakal-generated sequence to an outreach tool as a new campaign.
 *
 * @param {string} userId
 * @param {string} provider — 'apollo' | 'instantly' | 'smartlead'
 * @param {string} campaignName
 * @param {Array} touchpoints — array of { step, type, subject, body, timing }
 * @returns {{ success: boolean, campaignId: string, provider: string }}
 */
async function deployToOutreach(userId, provider, campaignName, touchpoints) {
  const apiKey = await getUserKey(userId, provider);
  if (!apiKey) throw new Error(`No ${provider} API key configured`);

  // Map variables and build steps — only email steps
  const steps = touchpoints
    .filter((tp) => tp.type === 'email')
    .map((tp) => ({
      subject: mapVariables(tp.subject, provider),
      body: mapVariables(tp.body, provider),
      timing: tp.timing,
      days: extractDays(tp.timing),
      step: tp.step,
    }));

  if (steps.length === 0) {
    throw new Error('No email steps found in touchpoints');
  }

  if (provider === 'apollo') {
    return deployToApollo(apiKey, campaignName, steps);
  } else if (provider === 'instantly') {
    return deployToInstantly(apiKey, campaignName, steps);
  } else if (provider === 'smartlead') {
    return deployToSmartlead(apiKey, campaignName, steps);
  }

  throw new Error(`Deploy not supported for provider: ${provider}`);
}

module.exports = { deployToOutreach, mapVariables, VARIABLE_MAP };
