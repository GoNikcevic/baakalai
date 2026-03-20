const { config } = require('../config');
const { withRetry } = require('../lib/retry');

const BASE_URL = config.lemlist.baseUrl;

async function lemlistFetch(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      ...options,
      // Lemlist uses API key as basic auth password
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`:${config.lemlist.apiKey}`).toString('base64')}`,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(
        new Error(`Lemlist API ${res.status}: ${body}`),
        { status: res.status }
      );
    }
    return res.json();
  }, { maxRetries: 2, baseDelay: 1000 });
}

// --- Campaign endpoints ---

async function listCampaigns() {
  return lemlistFetch('/campaigns');
}

async function getCampaign(campaignId) {
  return lemlistFetch(`/campaigns/${campaignId}`);
}

async function getCampaignStats(campaignId) {
  return lemlistFetch(`/campaigns/${campaignId}/export`);
}

async function getSequences(campaignId) {
  return lemlistFetch(`/campaigns/${campaignId}/sequences`);
}

async function updateSequenceStep(campaignId, stepId, data) {
  return lemlistFetch(`/campaigns/${campaignId}/sequences/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// --- Data transformation ---

function transformCampaignStats(raw) {
  // Transform raw Lemlist export into our internal format
  const stats = {
    contacts: 0,
    openRate: null,
    replyRate: null,
    acceptRate: null,
    interested: 0,
    meetings: 0,
    stops: null,
  };

  if (!raw || !Array.isArray(raw)) return stats;

  stats.contacts = raw.length;

  const withEmail = raw.filter((r) => r.emailsSent > 0);
  if (withEmail.length > 0) {
    const opened = raw.filter((r) => r.emailsOpened > 0).length;
    const replied = raw.filter((r) => r.emailsReplied > 0).length;
    const unsubscribed = raw.filter((r) => r.unsubscribeStatus === 'unsubscribed').length;
    stats.openRate = Math.round((opened / withEmail.length) * 100);
    stats.replyRate = Math.round((replied / withEmail.length) * 100);
    stats.stops = Math.round((unsubscribed / withEmail.length) * 100);
  }

  const withLinkedIn = raw.filter((r) => r.linkedinConnectionSent);
  if (withLinkedIn.length > 0) {
    const accepted = raw.filter((r) => r.linkedinConnectionAccepted).length;
    stats.acceptRate = Math.round((accepted / withLinkedIn.length) * 100);
  }

  const interested = raw.filter((r) => r.leadStatus === 'interested');
  stats.interested = interested.length;

  return stats;
}

function transformStepStats(raw, stepIndex) {
  if (!raw || !Array.isArray(raw)) return null;

  const step = {};
  const relevant = raw.filter((r) => (r.emailsSent || 0) > stepIndex || r.sequenceStep > stepIndex);

  if (relevant.length === 0) return null;

  const opened = relevant.filter((r) => r[`emailOpened_${stepIndex}`]).length;
  const replied = relevant.filter((r) => r[`emailReplied_${stepIndex}`]).length;

  step.open = relevant.length > 0 ? Math.round((opened / relevant.length) * 100) : 0;
  step.reply = relevant.length > 0 ? Math.round((replied / relevant.length) * 100) : 0;

  return step;
}

module.exports = {
  listCampaigns,
  getCampaign,
  getCampaignStats,
  getSequences,
  updateSequenceStep,
  transformCampaignStats,
  transformStepStats,
};
