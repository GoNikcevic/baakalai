/**
 * Waalaxy API Client
 *
 * Campaign management, stats, and step updates via Waalaxy API.
 * All API functions require an explicit apiKey parameter (per-user isolation).
 *
 * Waalaxy campaigns are multi-step with conditions based on LinkedIn events
 * (connection accepted, message replied, profile visited) and can include
 * both LinkedIn and email steps in a single campaign.
 */

const { withRetry } = require('../lib/retry');

const BASE_URL = 'https://api.waalaxy.com/v1';

// --- Authenticated fetch wrapper ---

async function waalaxyFetch(apiKey, endpoint, options = {}) {
  if (!apiKey) {
    throw new Error('Waalaxy API key is required');
  }
  const url = `${BASE_URL}${endpoint}`;

  return withRetry(async () => {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(
        new Error(`Waalaxy API ${res.status}: ${body}`),
        { status: res.status }
      );
    }
    return res.json();
  }, { maxRetries: 2, baseDelay: 1000 });
}

// --- Campaign endpoints ---

async function listCampaigns(apiKey) {
  return waalaxyFetch(apiKey, '/campaigns');
}

async function getCampaign(apiKey, campaignId) {
  return waalaxyFetch(apiKey, `/campaigns/${campaignId}`);
}

async function getCampaignStats(apiKey, campaignId) {
  return waalaxyFetch(apiKey, `/campaigns/${campaignId}/stats`);
}

async function updateStep(apiKey, campaignId, stepId, data) {
  return waalaxyFetch(apiKey, `/campaigns/${campaignId}/steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// --- Data transformation ---

/**
 * Transform Waalaxy campaign stats into standard Bakal stats format.
 */
function transformCampaignStats(stats) {
  const result = {
    contacts: 0,
    openRate: null,
    replyRate: null,
    acceptRate: null,
    interested: 0,
    meetings: 0,
  };

  if (!stats) return result;

  result.contacts = stats.total_prospects || stats.enrolled || 0;

  // Email stats
  const emailSent = stats.emails_sent || 0;
  if (emailSent > 0) {
    const opened = stats.emails_opened || 0;
    const replied = stats.emails_replied || 0;
    result.openRate = Math.round((opened / emailSent) * 100);
    result.replyRate = Math.round((replied / emailSent) * 100);
  }

  // LinkedIn stats
  const invitesSent = stats.invitations_sent || stats.connections_sent || 0;
  if (invitesSent > 0) {
    const accepted = stats.invitations_accepted || stats.connections_accepted || 0;
    result.acceptRate = Math.round((accepted / invitesSent) * 100);
  }

  result.interested = stats.interested || 0;
  result.meetings = stats.meetings || 0;

  return result;
}

// --- Tree transform functions ---

/**
 * Map Waalaxy step conditions to standard condition types.
 */
function mapCondition(condition) {
  const map = {
    accepted: 'accepted',
    not_accepted: 'not_accepted',
    connection_accepted: 'accepted',
    connection_not_accepted: 'not_accepted',
    replied: 'replied',
    not_replied: 'not_replied',
    message_replied: 'replied',
    message_not_replied: 'not_replied',
    opened: 'opened',
    not_opened: 'not_opened',
    email_opened: 'opened',
    email_not_opened: 'not_opened',
    clicked: 'clicked',
    visited: 'opened',
    profile_visited: 'opened',
  };
  return map[condition] || null;
}

/**
 * Map condition type to a human-readable branch label (French).
 */
function conditionLabel(conditionType) {
  const labels = {
    opened: 'Si ouvert',
    not_opened: 'Si pas ouvert',
    replied: 'Si r\u00e9pondu',
    not_replied: 'Si pas r\u00e9pondu',
    clicked: 'Si cliqu\u00e9',
    accepted: 'Si accept\u00e9',
    not_accepted: 'Si pas accept\u00e9',
  };
  return labels[conditionType] || null;
}

/**
 * Determine step channel/type from a Waalaxy step.
 */
function stepType(step) {
  const action = (step.action || step.type || step.channel || '').toLowerCase();
  if (action.includes('linkedin') || action.includes('visit') ||
      action.includes('connect') || action.includes('invite') ||
      action.includes('message') || action === 'connection_request') {
    return 'linkedin';
  }
  return 'email';
}

/**
 * Convert Waalaxy campaign to a tree structure.
 *
 * Waalaxy campaigns have steps with:
 *   - id: unique step ID
 *   - action/type: 'email', 'linkedin_message', 'connection_request', 'visit_profile', etc.
 *   - content: { subject, body/message }
 *   - delay: wait time in days
 *   - condition: trigger condition from parent step
 *   - parent_step_id: null (root) or parent step's ID
 *
 * Steps without a parent_step_id are roots.
 * Steps with conditions branch off their parent.
 */
function transformToTree(campaign) {
  if (!campaign) return [];

  const steps = campaign.steps || campaign.sequence || [];
  if (!Array.isArray(steps) || steps.length === 0) return [];

  // Build node map
  const nodeMap = new Map();
  const counters = { email: 0, linkedin: 0 };

  for (const step of steps) {
    const type = stepType(step);
    const idx = counters[type] || 0;
    counters[type] = idx + 1;
    const prefix = type === 'linkedin' ? 'L' : 'E';
    const condType = mapCondition(step.condition);

    const node = {
      _id: step.id,
      _parentId: step.parent_step_id || null,
      step: step.step_label || `${prefix}${idx + 1}`,
      type,
      label: step.label || step.content?.subject || step.action || `${type} step`,
      timing: step.delay != null ? `J+${step.delay}` : 'J+0',
      subject: step.content?.subject || null,
      body: step.content?.body || step.content?.message || '',
      conditionType: condType,
      branchLabel: conditionLabel(condType),
      isRoot: !step.parent_step_id,
      sortOrder: step.position || step.order || 0,
      children: [],
    };

    nodeMap.set(step.id, node);
  }

  // Link children to parents
  const roots = [];
  for (const node of nodeMap.values()) {
    if (node._parentId && nodeMap.has(node._parentId)) {
      nodeMap.get(node._parentId).children.push(node);
    } else {
      node.isRoot = true;
      roots.push(node);
    }
  }

  // Sort children by sortOrder
  function sortChildren(nodes) {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const n of nodes) {
      if (n.children.length > 0) sortChildren(n.children);
    }
  }
  sortChildren(roots);

  // Clean up internal fields
  function cleanup(nodes) {
    for (const n of nodes) {
      delete n._id;
      delete n._parentId;
      cleanup(n.children);
    }
  }
  cleanup(roots);

  return roots;
}

/**
 * Flatten a tree to a sorted array (depth-first walk).
 * Strips `children` from each node and assigns incrementing `sortOrder`.
 */
function flattenTree(tree) {
  const result = [];
  let order = 0;

  function walk(nodes) {
    for (const node of nodes) {
      const { children, ...flat } = node;
      flat.sortOrder = order++;
      result.push(flat);
      if (children && children.length > 0) {
        walk(children);
      }
    }
  }

  walk(Array.isArray(tree) ? tree : [tree]);
  return result;
}

module.exports = {
  waalaxyFetch,
  listCampaigns,
  getCampaign,
  getCampaignStats,
  updateStep,
  transformCampaignStats,
  transformToTree,
  flattenTree,
};
