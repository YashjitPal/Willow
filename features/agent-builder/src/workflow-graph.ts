/**
 * Pure graph helpers for the Agent Builder canvas: the starter graph a new
 * workflow opens with, and the naming utilities that keep node namespaces and
 * duplicated ids unique.
 *
 * Everything here is closure-free and safe to call outside React.
 */

import { Node, Edge } from '@xyflow/react';

// Initial nodes for canvas. Every executable path ends explicitly so the
// starter is immediately publishable and has no implicit terminal behavior.
export const initialNodes: Node[] = [
  {
    id: '1',
    type: 'start',
    data: { label: 'Start' },
    position: { x: 50, y: 125 },
  },
  {
    id: '2',
    type: 'agent',
    data: { label: 'Agent' },
    position: { x: 300, y: 125 },
  },
  {
    id: '3',
    type: 'end',
    data: { label: 'End', config: {} },
    position: { x: 550, y: 125 },
  }
];

export const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', type: 'custom', style: { stroke: '#404040', strokeWidth: 2.5 } },
  { id: 'e2-3', source: '2', target: '3', type: 'custom', style: { stroke: '#404040', strokeWidth: 2.5 } },
];

/** Slugs a node label into a safe workflow variable name. */
export const toWorkflowVarName = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_') || 'node';

/**
 * Rewrites namespace references inside an arbitrary config value, following
 * only `namespace.` / `namespace[` uses so bare words are left alone.
 */
export const replaceNamespaces = (value: unknown, replacements: Map<string, string>): unknown => {
  if (typeof value === 'string') {
    let next = value;
    for (const [from, to] of replacements) {
      next = next.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*(?:\\.|\\[))`, 'g'), to);
    }
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => replaceNamespaces(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, replaceNamespaces(child, replacements)]));
  }
  return value;
};

/**
 * Maps each node id to a unique variable namespace, avoiding the three names
 * the workflow runtime reserves for itself.
 */
export const nodeNamespaces = (sourceNodes: Node[]): Map<string, string> => {
  const result = new Map<string, string>();
  const used = new Set(['workflow', 'state', 'input_as_text']);
  for (const node of sourceNodes) {
    const base = toWorkflowVarName(String(node.data?.label ?? 'Node'));
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    result.set(node.id, name);
  }
  return result;
};

/** Picks an unused `<base>_copy` id, recording it in `used` as a side effect. */
export const nextGraphId = (base: string, used: Set<string>): string => {
  let candidate = `${base}_copy`;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_copy_${suffix++}`;
  used.add(candidate);
  return candidate;
};
