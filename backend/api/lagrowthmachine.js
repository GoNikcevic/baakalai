/**
 * La Growth Machine (LGM) API Client
 *
 * Workflow management, per-node stats, node updates, and audience listing via LGM API.
 * All API functions require an explicit apiKey parameter (per-user isolation).
 *
 * LGM workflows are NATIVELY tree-structured: nodes connected by edges with
 * conditions (opened, replied, connected, etc.). Each node has a channel
 * (email, linkedin, twitter) and content.
 */

const { withRetry } = require('../lib/retry');

const BASE_URL = 'https://api.lagrowthmachine.com/v1';

// --- Authenticated fetch wrapper ---

async function lgmFetch(apiKey, endpoint, options = {}) {
  if (!apiKey) {
    throw new Error('La Growth Machine API key is required');
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
        new Error(`LGM API ${res.status}: ${body}`),
        { status: res.status }
      );
    }
    return res.json();
  }, { maxRetries: 2, baseDelay: 1000 });
}

// --- Workflow endpoints ---

async function listWorkflows(apiKey) {
  return lgmFetch(apiKey, '/workflows');
}

async function getWorkflow(apiKey, workflowId) {
  return lgmFetch(apiKey, `/workflows/${workflowId}`);
}

async function getWorkflowStats(apiKey, workflowId) {
  return lgmFetch(apiKey, `/workflows/${workflowId}/stats`);
}

async function updateNode(apiKey, workflowId, nodeId, data) {
  return lgmFetch(apiKey, `/workflows/${workflowId}/nodes/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

async function listAudiences(apiKey) {
  return lgmFetch(apiKey, '/audiences');
}

// --- Data transformation ---

/**
 * Transform LGM workflow stats into standard Bakal stats format.
 */
function transformWorkflowStats(stats) {
  const result = {
    contacts: 0,
    openRate: null,
    replyRate: null,
    acceptRate: null,
    interested: 0,
    meetings: 0,
  };

  if (!stats) return result;

  result.contacts = stats.total_leads || stats.enrolled || 0;

  // Email stats
  const emailSent = stats.emails_sent || 0;
  if (emailSent > 0) {
    const opened = stats.emails_opened || 0;
    const replied = stats.emails_replied || 0;
    result.openRate = Math.round((opened / emailSent) * 100);
    result.replyRate = Math.round((replied / emailSent) * 100);
  }

  // LinkedIn stats
  const lkSent = stats.linkedin_invites_sent || stats.connections_sent || 0;
  if (lkSent > 0) {
    const accepted = stats.linkedin_invites_accepted || stats.connections_accepted || 0;
    result.acceptRate = Math.round((accepted / lkSent) * 100);
  }

  result.interested = stats.interested || stats.positive_replies || 0;
  result.meetings = stats.meetings || 0;

  return result;
}

// --- Tree transform functions ---

/**
 * Map LGM edge conditions to standard condition types.
 */
function mapCondition(edgeCondition) {
  const map = {
    opened: 'opened',
    not_opened: 'not_opened',
    replied: 'replied',
    not_replied: 'not_replied',
    clicked: 'clicked',
    accepted: 'accepted',
    not_accepted: 'not_accepted',
    connected: 'accepted',
    not_connected: 'not_accepted',
  };
  return map[edgeCondition] || null;
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
 * Determine node channel/type.
 */
function nodeType(node) {
  const channel = (node.channel || node.type || '').toLowerCase();
  if (channel.includes('linkedin')) return 'linkedin';
  if (channel.includes('twitter') || channel.includes('x')) return 'twitter';
  return 'email';
}

/**
 * Generate a step label from a node.
 */
function stepLabel(node, index) {
  const type = nodeType(node);
  const prefix = type === 'linkedin' ? 'L' : type === 'twitter' ? 'T' : 'E';
  return node.step_label || `${prefix}${index + 1}`;
}

/**
 * Convert LGM workflow to a tree structure.
 *
 * LGM workflows are natively graph-structured:
 *   workflow.nodes: [ { id, channel, content: { subject, body }, delay, label } ]
 *   workflow.edges: [ { from, to, condition } ]
 *
 * We build the tree by mapping nodes and connecting them via edges.
 * Nodes with no incoming edge are roots.
 */
function transformToTree(workflow) {
  if (!workflow) return [];

  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];

  if (nodes.length === 0) return [];

  // Build edge lookup: parent -> [{ targetId, condition }]
  const childEdges = new Map();    // parentId -> [{ targetId, condition }]
  const hasParent = new Set();

  for (const edge of edges) {
    const fromId = edge.from || edge.source;
    const toId = edge.to || edge.target;
    if (!childEdges.has(fromId)) childEdges.set(fromId, []);
    childEdges.get(fromId).push({ targetId: toId, condition: edge.condition });
    hasParent.add(toId);
  }

  // Build node lookup
  const nodeMap = new Map();
  const counters = { email: 0, linkedin: 0, twitter: 0 };

  for (const node of nodes) {
    const type = nodeType(node);
    const idx = counters[type] || 0;
    counters[type] = idx + 1;

    nodeMap.set(node.id, {
      _id: node.id,
      step: stepLabel(node, idx),
      type,
      label: node.label || node.content?.subject || `${type} step`,
      timing: node.delay != null ? `J+${node.delay}` : 'J+0',
      subject: node.content?.subject || null,
      body: node.content?.body || node.content?.message || '',
      conditionType: null,   // set when linking via edges
      branchLabel: null,
      isRoot: !hasParent.has(node.id),
      sortOrder: node.position || node.order || 0,
      children: [],
    });
  }

  // Link children via edges
  for (const [parentId, targets] of childEdges.entries()) {
    const parentNode = nodeMap.get(parentId);
    if (!parentNode) continue;

    for (const { targetId, condition } of targets) {
      const childNode = nodeMap.get(targetId);
      if (!childNode) continue;

      const condType = mapCondition(condition);
      childNode.conditionType = condType;
      childNode.branchLabel = conditionLabel(condType);
      childNode.isRoot = false;
      parentNode.children.push(childNode);
    }
  }

  // Collect roots (nodes with no incoming edge)
  const roots = [];
  for (const node of nodeMap.values()) {
    if (node.isRoot) roots.push(node);
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
  lgmFetch,
  listWorkflows,
  getWorkflow,
  getWorkflowStats,
  updateNode,
  listAudiences,
  transformWorkflowStats,
  transformToTree,
  flattenTree,
};
