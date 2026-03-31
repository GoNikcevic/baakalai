/**
 * Instantly.ai API Client
 *
 * Campaign management, analytics, step updates, and lead listing via Instantly API.
 * All API functions require an explicit apiKey parameter (per-user isolation).
 *
 * Instantly uses api_key as a query parameter for authentication.
 * Sequences are mostly linear but support A/B variants and conditional
 * follow-ups based on reply status.
 */

const { withRetry } = require('../lib/retry');

const BASE_URL = 'https://api.instantly.ai/api/v1';

// --- Authenticated fetch wrapper ---

async function instantlyFetch(apiKey, endpoint, options = {}) {
  if (!apiKey) {
    throw new Error('Instantly API key is required');
  }

  // Instantly authenticates via api_key query parameter
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${endpoint}${separator}api_key=${encodeURIComponent(apiKey)}`;

  return withRetry(async () => {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(
        new Error(`Instantly API ${res.status}: ${body}`),
        { status: res.status }
      );
    }
    return res.json();
  }, { maxRetries: 2, baseDelay: 1000 });
}

// --- Campaign endpoints ---

async function listCampaigns(apiKey) {
  return instantlyFetch(apiKey, '/campaign/list');
}

async function getCampaign(apiKey, campaignId) {
  return instantlyFetch(apiKey, `/campaign/get?campaign_id=${encodeURIComponent(campaignId)}`);
}

async function getCampaignStats(apiKey, campaignId) {
  return instantlyFetch(apiKey, `/campaign/analytics?campaign_id=${encodeURIComponent(campaignId)}`);
}

async function updateStep(apiKey, campaignId, stepIndex, data) {
  return instantlyFetch(apiKey, '/campaign/step/update', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campaignId,
      step_index: stepIndex,
      ...data,
    }),
  });
}

async function listLeads(apiKey, campaignId) {
  return instantlyFetch(apiKey, `/lead/list?campaign_id=${encodeURIComponent(campaignId)}`);
}

// --- Data transformation ---

/**
 * Transform Instantly analytics into standard Bakal stats format.
 */
function transformCampaignStats(analytics) {
  const stats = {
    contacts: 0,
    openRate: null,
    replyRate: null,
    interested: 0,
    meetings: 0,
  };

  if (!analytics) return stats;

  const sent = analytics.sent || analytics.emails_sent || 0;
  stats.contacts = analytics.total_leads || analytics.leads_count || sent;

  if (sent > 0) {
    const opened = analytics.opened || analytics.unique_opened || 0;
    const replied = analytics.replied || analytics.unique_replied || 0;
    stats.openRate = Math.round((opened / sent) * 100);
    stats.replyRate = Math.round((replied / sent) * 100);
  }

  stats.interested = analytics.interested || 0;
  stats.meetings = analytics.meetings || 0;

  return stats;
}

// --- Tree transform functions ---

/**
 * Map Instantly variant/condition info to standard condition types.
 */
function mapCondition(step) {
  if (step.condition === 'replied') return 'replied';
  if (step.condition === 'not_replied') return 'not_replied';
  if (step.condition === 'opened') return 'opened';
  if (step.condition === 'not_opened') return 'not_opened';
  if (step.condition === 'clicked') return 'clicked';
  return null;
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
 * Convert Instantly sequences to a tree structure.
 *
 * Instantly sequences are primarily linear (step 1 -> step 2 -> ...),
 * but support A/B variants (multiple versions of the same step) and
 * conditional follow-ups (branch on reply status).
 *
 * Input format (from getCampaign):
 *   sequences: [
 *     { steps: [ { subject, body, delay, variants: [...], condition } ] }
 *   ]
 *
 * Variants become children of their parent step. Conditional steps
 * also become children with a conditionType set.
 */
function transformToTree(sequences) {
  if (!sequences) return [];

  // Handle both array of sequences and single sequence object
  const seqList = Array.isArray(sequences) ? sequences : [sequences];
  const roots = [];

  for (const seq of seqList) {
    const steps = seq.steps || seq.sequence || [];
    let prevNode = null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const condType = mapCondition(step);
      const isConditional = condType !== null;
      const stepLabel = `E${i + 1}`;

      const node = {
        step: stepLabel,
        type: 'email',
        label: step.label || step.subject || `Email ${i + 1}`,
        timing: step.delay != null ? `J+${step.delay}` : 'J+0',
        subject: step.subject || null,
        body: step.body || '',
        conditionType: isConditional ? condType : null,
        branchLabel: isConditional ? conditionLabel(condType) : null,
        isRoot: i === 0 && !isConditional,
        sortOrder: i,
        children: [],
      };

      // Add A/B variants as children
      if (step.variants && Array.isArray(step.variants)) {
        for (let v = 0; v < step.variants.length; v++) {
          const variant = step.variants[v];
          node.children.push({
            step: `${stepLabel}-V${v + 1}`,
            type: 'email',
            label: variant.label || `Variant ${v + 1}`,
            timing: node.timing,
            subject: variant.subject || node.subject,
            body: variant.body || '',
            conditionType: null,
            branchLabel: `Variante ${String.fromCharCode(65 + v)}`,
            isRoot: false,
            sortOrder: v,
            children: [],
          });
        }
      }

      // Conditional steps attach to previous node; linear steps are roots
      if (isConditional && prevNode) {
        prevNode.children.push(node);
      } else {
        roots.push(node);
      }

      prevNode = node;
    }
  }

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
  instantlyFetch,
  listCampaigns,
  getCampaign,
  getCampaignStats,
  updateStep,
  listLeads,
  transformCampaignStats,
  transformToTree,
  flattenTree,
};
