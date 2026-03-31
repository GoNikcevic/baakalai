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

async function getWorkflow(campaignId) {
  return lemlistFetch(`/campaigns/${campaignId}/workflow`);
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

// --- Workflow / branching tree transformation ---

function transformWorkflowToTree(workflow) {
  if (!workflow || !workflow.steps) return [];

  const CONDITION_LABELS = {
    opened: 'Si ouvert',
    not_opened: 'Si pas ouvert',
    replied: 'Si répondu',
    not_replied: 'Si pas répondu',
    clicked: 'Si cliqué',
    not_clicked: 'Si pas cliqué',
    accepted: 'Si accepté',
    not_accepted: 'Si pas accepté',
    default: 'Par défaut',
  };

  function mapNode(node, parentId = null, condition = null, sortOrder = 0) {
    const step = {
      step: node.step || node.name || `S${sortOrder + 1}`,
      type: node.type === 'linkedin_connection' ? 'linkedin' : 'email',
      label: node.label || node.name || '',
      subType: node.subType || '',
      timing: node.delay ? `J+${node.delay}` : 'J+0',
      subject: node.subject || null,
      body: node.body || node.text || '',
      maxChars: node.type === 'linkedin_connection' ? 300 : null,
      parentStepId: parentId,
      conditionType: condition,
      conditionValue: null,
      branchLabel: condition ? (CONDITION_LABELS[condition] || condition) : null,
      isRoot: !parentId,
      sortOrder,
      children: [],
    };

    let nextSort = sortOrder + 1;

    if (node.conditions && Array.isArray(node.conditions)) {
      for (const cond of node.conditions) {
        if (cond.steps && Array.isArray(cond.steps)) {
          for (const child of cond.steps) {
            const childNode = mapNode(child, node.id, cond.type || cond.condition, nextSort);
            step.children.push(childNode);
            nextSort = childNode._nextSort || nextSort + 1;
          }
        }
      }
    }

    if (node.next && Array.isArray(node.next)) {
      for (const next of node.next) {
        const childNode = mapNode(next, node.id, 'default', nextSort);
        step.children.push(childNode);
        nextSort = childNode._nextSort || nextSort + 1;
      }
    }

    step._nextSort = nextSort;
    return step;
  }

  const roots = (workflow.steps || []).filter(s => !s.parentId);
  return roots.map((r, i) => mapNode(r, null, null, i));
}

function flattenTree(tree) {
  const result = [];
  function walk(nodes) {
    for (const node of nodes) {
      const { children, _nextSort, ...rest } = node;
      result.push(rest);
      if (children && children.length > 0) walk(children);
    }
  }
  walk(Array.isArray(tree) ? tree : [tree]);
  return result;
}

module.exports = {
  listCampaigns,
  getCampaign,
  getCampaignStats,
  getSequences,
  updateSequenceStep,
  getWorkflow,
  transformCampaignStats,
  transformStepStats,
  transformWorkflowToTree,
  flattenTree,
};
