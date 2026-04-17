/**
 * Apollo.io API Client
 *
 * Campaign management, sequence steps, contact search, and stats via Apollo API.
 * All API functions require an explicit apiKey parameter (per-user isolation).
 *
 * Apollo sequences support conditional steps that branch on open/reply/click.
 * Steps have `trigger_on` and `parent_step_id` fields for tree structure.
 */

const { withRetry } = require('../lib/retry');

const BASE_URL = 'https://api.apollo.io/v1';

// --- Authenticated fetch wrapper ---

async function apolloFetch(apiKey, endpoint, options = {}) {
  if (!apiKey) {
    throw new Error('Apollo API key is required');
  }
  const url = `${BASE_URL}${endpoint}`;

  return withRetry(async () => {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(
        new Error(`Apollo API ${res.status}: ${body}`),
        { status: res.status }
      );
    }
    return res.json();
  }, { maxRetries: 2, baseDelay: 1000 });
}

// --- Campaign endpoints ---

async function listCampaigns(apiKey) {
  return apolloFetch(apiKey, '/emailer_campaigns');
}

async function getCampaign(apiKey, campaignId) {
  return apolloFetch(apiKey, `/emailer_campaigns/${campaignId}`);
}

async function getSequenceSteps(apiKey, campaignId) {
  return apolloFetch(apiKey, `/emailer_campaigns/${campaignId}/emailer_steps`);
}

async function updateStep(apiKey, stepId, data) {
  return apolloFetch(apiKey, `/emailer_steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

async function searchContacts(apiKey, query) {
  return apolloFetch(apiKey, '/contacts/search', {
    method: 'POST',
    body: JSON.stringify(query),
  });
}

// --- Activities ---

/**
 * Fetch emailer touches (activities) for an Apollo campaign.
 * POST /v1/emailer_campaigns/{id}/emailer_touches with pagination.
 * Returns individual contact interactions (sent, opened, replied, bounced).
 */
async function getEmailerTouches(apiKey, campaignId, { page = 1, perPage = 100 } = {}) {
  return apolloFetch(apiKey, `/emailer_campaigns/${campaignId}/emailer_touches`, {
    method: 'POST',
    body: JSON.stringify({ page, per_page: perPage }),
  });
}

/**
 * Fetch all activities for an Apollo campaign, paginating automatically.
 * Filters by status type and maps to our standard activity format.
 */
async function getAllActivities(apiKey, campaignId) {
  const all = [];
  let page = 1;
  const PER_PAGE = 100;

  while (true) {
    let data;
    try {
      data = await getEmailerTouches(apiKey, campaignId, { page, perPage: PER_PAGE });
    } catch (err) {
      // If the touches endpoint doesn't exist, return empty
      if (err.status === 404 || err.status === 422) break;
      throw err;
    }

    const touches = data.emailer_touches || data.contacts || [];
    if (touches.length === 0) break;

    for (const t of touches) {
      // Map Apollo touch statuses to activity types
      const status = (t.status || t.emailer_touch_status || '').toLowerCase();
      let type = null;
      if (status.includes('replied') || status.includes('reply')) type = 'emailsReplied';
      else if (status.includes('opened') || status.includes('open')) type = 'emailsOpened';
      else if (status.includes('clicked') || status.includes('click')) type = 'emailsClicked';
      else if (status.includes('bounced') || status.includes('bounce')) type = 'emailsBounced';
      else if (status.includes('sent')) continue; // skip sent activities

      if (!type) continue;

      all.push({
        _id: t.id || `apollo_${campaignId}_${t.contact_id || t.email}_${t.created_at || Date.now()}`,
        type,
        leadEmail: t.email || t.contact_email || null,
        leadFirstName: t.first_name || t.contact_first_name || null,
        leadLastName: t.last_name || t.contact_last_name || null,
        companyName: t.organization_name || t.company || null,
        sequenceStep: t.emailer_step_position ?? t.step_number ?? null,
        createdAt: t.created_at || t.updated_at || null,
        extractedText: t.body || t.reply_text || t.text || null,
      });
    }

    if (touches.length < PER_PAGE) break;
    page++;
    if (all.length >= 1000) break;
  }

  return all;
}

// --- Data transformation ---

/**
 * Transform Apollo campaign data into standard Bakal stats format.
 */
function transformCampaignStats(campaign) {
  const stats = {
    contacts: 0,
    openRate: null,
    replyRate: null,
    interested: 0,
    meetings: 0,
  };

  if (!campaign) return stats;

  stats.contacts = campaign.num_contacts || campaign.total_contacts || 0;

  const sent = campaign.emails_sent || campaign.num_sent || 0;
  if (sent > 0) {
    const opened = campaign.emails_opened || campaign.unique_opens || 0;
    const replied = campaign.emails_replied || campaign.unique_replies || 0;
    stats.openRate = Math.round((opened / sent) * 100);
    stats.replyRate = Math.round((replied / sent) * 100);
  }

  stats.interested = campaign.interested_count || 0;
  stats.meetings = campaign.meetings_booked || 0;

  return stats;
}

// --- Tree transform functions ---

/**
 * Map Apollo trigger_on values to standard condition types.
 */
function mapTrigger(triggerOn) {
  const map = {
    opened: 'opened',
    not_opened: 'not_opened',
    replied: 'replied',
    not_replied: 'not_replied',
    clicked: 'clicked',
  };
  return map[triggerOn] || null;
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
  };
  return labels[conditionType] || null;
}

/**
 * Determine step type from Apollo step data.
 */
function stepType(step) {
  if (step.type === 'linkedin_message' || step.type === 'linkedin_connection') {
    return 'linkedin';
  }
  return 'email';
}

/**
 * Convert Apollo steps array to a tree structure with conditions.
 *
 * Apollo steps have:
 *   - id: unique step ID
 *   - position: order in flat list
 *   - trigger_on: null (root) or 'opened'/'replied'/'clicked' etc.
 *   - parent_step_id: null (root) or parent step's ID
 *   - subject, body, wait_time, type
 */
function transformToTree(steps) {
  if (!steps || !Array.isArray(steps) || steps.length === 0) return [];

  // Build lookup map
  const nodeMap = new Map();
  const roots = [];

  // Create nodes
  for (const step of steps) {
    const condType = mapTrigger(step.trigger_on);
    const node = {
      step: step.step_label || `E${step.position + 1}`,
      type: stepType(step),
      label: step.label || step.subject || `Step ${step.position + 1}`,
      timing: step.wait_time != null ? `J+${step.wait_time}` : 'J+0',
      subject: step.subject || null,
      body: step.body || '',
      conditionType: condType,
      branchLabel: conditionLabel(condType),
      isRoot: !step.parent_step_id,
      sortOrder: step.position || 0,
      children: [],
      _id: step.id,
      _parentId: step.parent_step_id || null,
    };
    nodeMap.set(step.id, node);
  }

  // Link children to parents
  for (const node of nodeMap.values()) {
    if (node._parentId && nodeMap.has(node._parentId)) {
      nodeMap.get(node._parentId).children.push(node);
    } else {
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
  apolloFetch,
  listCampaigns,
  getCampaign,
  getSequenceSteps,
  updateStep,
  searchContacts,
  transformCampaignStats,
  transformToTree,
  flattenTree,
  getEmailerTouches,
  getAllActivities,
};
