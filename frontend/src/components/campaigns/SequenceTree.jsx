/* ═══════════════════════════════════════════════════
   Sequence Tree Component
   Renders touchpoints as a tree with conditional branches,
   or linearly (backward compatible) when no parent info exists.
   ═══════════════════════════════════════════════════ */

import { useMemo } from 'react';
import SequenceStep from './SequenceStep';

/**
 * Build tree from flat list of steps.
 * If no step has parentStepId / parent_step_id, returns the list as-is
 * (each node gets an empty children array) so the rendering is linear.
 */
function buildTree(steps) {
  if (!steps || steps.length === 0) return [];

  // Check if any step carries parent info — if not, keep linear
  const hasTree = steps.some(
    (s) =>
      s.parentStepId ||
      s.parent_step_id ||
      (s.children && s.children.length > 0)
  );
  if (!hasTree) return steps.map((s) => ({ ...s, children: [] }));

  // Index every node by id
  const map = new Map();
  const roots = [];

  steps.forEach((s) => {
    map.set(s.id, { ...s, children: s.children ? [...s.children] : [] });
  });

  steps.forEach((s) => {
    const parentId = s.parentStepId || s.parent_step_id;
    const node = map.get(s.id);
    if (parentId && map.has(parentId)) {
      map.get(parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

const MAX_DEPTH = 3;

const conditionColors = {
  opened: 'var(--success)',
  not_opened: 'var(--warning)',
  replied: 'var(--blue)',
  not_replied: 'var(--danger)',
  accepted: 'var(--purple)',
  not_accepted: 'var(--warning)',
  clicked: 'var(--success)',
  default: 'var(--text-muted)',
};

function BranchNode({ node, depth = 0 }) {
  const condType = node.conditionType || node.condition_type;
  const condColor = conditionColors[condType] || conditionColors.default;
  const label = node.branchLabel || node.branch_label;

  return (
    <div className="seq-tree-branch" style={{ marginLeft: depth * 24 }}>
      {label && (
        <div className="seq-tree-condition" style={{ borderColor: condColor }}>
          <span
            className="seq-tree-condition-dot"
            style={{ background: condColor }}
          />
          <span className="seq-tree-condition-label">{label}</span>
        </div>
      )}
      <SequenceStep step={node} faded={false} />
      {node.children && node.children.length > 0 && depth < MAX_DEPTH && (
        <div className="seq-tree-children">
          {node.children.map((child) => (
            <BranchNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SequenceTree({ sequence }) {
  const tree = useMemo(() => buildTree(sequence || []), [sequence]);

  if (tree.length === 0) {
    return (
      <div
        style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}
      >
        Aucun touchpoint
      </div>
    );
  }

  return (
    <div className="seq-tree">
      {tree.map((node) => (
        <BranchNode key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}
