/**
 * Graph validation — structural checks run before save/publish/execute.
 * Returns errors (block execution) and warnings (surfaced to the UI).
 */

import { parse as parseCel } from '../engine/cel/index.ts';
import type {
  IfElseNodeConfig,
  SetStateNodeConfig,
  StartNodeConfig,
  TransformNodeConfig,
  WhileNodeConfig,
  WorkflowGraph,
  WorkflowNode,
} from './types.ts';

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const BRANCH_HANDLES: Record<string, (node: WorkflowNode) => string[]> = {
  ifElse: (node) => {
    const cfg = node.config as unknown as IfElseNodeConfig;
    return [...(cfg.branches ?? []).map((b) => b.id), 'else'];
  },
  guardrail: () => ['pass', 'fail'],
  userApproval: () => ['approved', 'rejected'],
  while: () => ['loop', 'done'],
};

function checkCel(expr: string): string | null {
  try {
    parseCel(expr);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function validateGraph(graph: WorkflowGraph): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // --- start node ---
  const starts = graph.nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) errors.push({ message: 'workflow needs a Start node' });
  if (starts.length > 1) {
    errors.push({ message: `workflow must have exactly one Start node (found ${starts.length})` });
  }

  // --- edges reference real nodes; start has no incoming; end no outgoing ---
  for (const e of graph.edges) {
    if (!byId.has(e.source)) errors.push({ edgeId: e.id, message: `edge source '${e.source}' does not exist` });
    if (!byId.has(e.target)) errors.push({ edgeId: e.id, message: `edge target '${e.target}' does not exist` });
  }
  for (const e of graph.edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (src?.type === 'end') errors.push({ edgeId: e.id, nodeId: src.id, message: 'End nodes cannot have outgoing edges' });
    if (tgt?.type === 'start') errors.push({ edgeId: e.id, nodeId: tgt.id, message: 'Start nodes cannot have incoming edges' });
    if (src?.type === 'note' || tgt?.type === 'note') {
      warnings.push({ edgeId: e.id, message: 'edges to/from Note nodes are ignored at runtime' });
    }
  }

  // --- outgoing-edge rules per node ---
  for (const node of graph.nodes) {
    if (node.type === 'note') continue;
    const out = graph.edges.filter((e) => e.source === node.id);
    const handles = BRANCH_HANDLES[node.type]?.(node);

    if (handles) {
      for (const e of out) {
        const h = e.sourceHandle ?? '';
        if (!handles.includes(h)) {
          errors.push({
            edgeId: e.id,
            nodeId: node.id,
            message: `'${node.name}' (${node.type}) edge must use one of handles [${handles.join(', ')}], got '${h || '(none)'}'`,
          });
        }
      }
      // duplicate handle check
      const seen = new Set<string>();
      for (const e of out) {
        const h = e.sourceHandle ?? '';
        if (seen.has(h)) {
          errors.push({ edgeId: e.id, nodeId: node.id, message: `'${node.name}' has multiple edges on handle '${h}'` });
        }
        seen.add(h);
      }
      if (node.type === 'while' && !out.some((e) => e.sourceHandle === 'loop')) {
        errors.push({ nodeId: node.id, message: `While node '${node.name}' needs a 'loop' edge into its body` });
      }
      if (node.type === 'ifElse' && !out.some((e) => e.sourceHandle === 'else')) {
        warnings.push({ nodeId: node.id, message: `If/else '${node.name}' has no else edge; unmatched inputs will end the run there` });
      }
    } else if (node.type !== 'end') {
      if (out.length > 1) {
        errors.push({ nodeId: node.id, message: `'${node.name}' (${node.type}) can only have one outgoing edge (found ${out.length})` });
      }
      if (out.length === 0 && node.type !== 'start') {
        warnings.push({ nodeId: node.id, message: `'${node.name}' has no outgoing edge; the run will end after it` });
      }
      if (out.length === 0 && node.type === 'start' && graph.nodes.length > 1) {
        errors.push({ nodeId: node.id, message: 'Start node is not connected to anything' });
      }
    }
  }

  // --- per-node config checks ---
  const start = starts[0];
  const declaredState = new Set<string>();
  if (start) {
    const cfg = start.config as unknown as StartNodeConfig;
    for (const sv of cfg.stateVariables ?? []) {
      if (!sv.name) errors.push({ nodeId: start.id, message: 'state variable with empty name' });
      else if (declaredState.has(sv.name)) {
        errors.push({ nodeId: start.id, message: `duplicate state variable '${sv.name}'` });
      } else declaredState.add(sv.name);
    }
  }

  for (const node of graph.nodes) {
    switch (node.type) {
      case 'agent': {
        const model = node.config.model;
        if (!model || typeof model !== 'string') {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' has no model configured` });
        }
        if (node.config.outputFormat === 'json' && !node.config.outputSchema) {
          warnings.push({ nodeId: node.id, message: `Agent '${node.name}' uses JSON output without a schema; output will be parsed loosely` });
        }
        break;
      }
      case 'ifElse': {
        const cfg = node.config as unknown as IfElseNodeConfig;
        if (!cfg.branches?.length) {
          errors.push({ nodeId: node.id, message: `If/else '${node.name}' has no condition branches` });
        }
        for (const b of cfg.branches ?? []) {
          const err = checkCel(b.condition || '');
          if (err) errors.push({ nodeId: node.id, message: `If/else '${node.name}' branch '${b.label ?? b.id}': invalid CEL — ${err}` });
        }
        break;
      }
      case 'while': {
        const cfg = node.config as unknown as WhileNodeConfig;
        const err = checkCel(cfg.condition || '');
        if (err) errors.push({ nodeId: node.id, message: `While '${node.name}': invalid CEL condition — ${err}` });
        break;
      }
      case 'transform': {
        const cfg = node.config as unknown as TransformNodeConfig;
        if (!cfg.outputs?.length) {
          warnings.push({ nodeId: node.id, message: `Transform '${node.name}' produces no outputs` });
        }
        for (const o of cfg.outputs ?? []) {
          if (!o.name) errors.push({ nodeId: node.id, message: `Transform '${node.name}' has an output with no name` });
          const err = checkCel(o.expression || '');
          if (err) errors.push({ nodeId: node.id, message: `Transform '${node.name}' output '${o.name}': invalid CEL — ${err}` });
        }
        break;
      }
      case 'setState': {
        const cfg = node.config as unknown as SetStateNodeConfig;
        for (const a of cfg.assignments ?? []) {
          if (!a.name) {
            errors.push({ nodeId: node.id, message: `Set state '${node.name}' has an assignment with no variable name` });
            continue;
          }
          if (declaredState.size && !declaredState.has(a.name)) {
            errors.push({ nodeId: node.id, message: `Set state '${node.name}' writes undeclared state variable '${a.name}' (declare it on the Start node)` });
          }
          const err = checkCel(a.expression || '');
          if (err) errors.push({ nodeId: node.id, message: `Set state '${node.name}' assignment '${a.name}': invalid CEL — ${err}` });
        }
        break;
      }
      case 'mcp': {
        if (!node.config.serverId) errors.push({ nodeId: node.id, message: `MCP node '${node.name}' has no server selected` });
        if (!node.config.tool) errors.push({ nodeId: node.id, message: `MCP node '${node.name}' has no tool selected` });
        break;
      }
      case 'fileSearch': {
        const stores = node.config.vectorStoreIds;
        if (!Array.isArray(stores) || stores.length === 0) {
          errors.push({ nodeId: node.id, message: `File search '${node.name}' has no vector stores attached` });
        }
        break;
      }
      case 'guardrail': {
        const anyOn = ['pii', 'moderation', 'jailbreak', 'hallucination'].some(
          (k) => node.config[k] === true,
        );
        if (!anyOn) warnings.push({ nodeId: node.id, message: `Guardrails '${node.name}' has no checks enabled; it will always pass` });
        break;
      }
      default:
        break;
    }
  }

  // --- cycle detection: cycles must pass through a While node ---
  // Remove edges that target a While node (loop-back edges + normal entries
  // are both fine to cut for the DAG check because While re-entry is the only
  // legal cycle mechanism).
  const dagEdges = graph.edges.filter((e) => {
    const tgt = byId.get(e.target);
    return tgt?.type !== 'while';
  });
  const adj = new Map<string, string[]>();
  for (const e of dagEdges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  let cycleAt: string | null = null;
  const dfs = (id: string): void => {
    if (cycleAt || done.has(id)) return;
    if (visiting.has(id)) {
      cycleAt = id;
      return;
    }
    visiting.add(id);
    for (const next of adj.get(id) ?? []) dfs(next);
    visiting.delete(id);
    done.add(id);
  };
  for (const n of graph.nodes) dfs(n.id);
  if (cycleAt) {
    const n = byId.get(cycleAt);
    errors.push({
      nodeId: cycleAt,
      message: `cycle detected at '${n?.name ?? cycleAt}': loops are only allowed through a While node`,
    });
  }

  // --- reachability from start ---
  if (start) {
    const reach = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of graph.edges) {
        if (e.source === cur && !reach.has(e.target)) {
          reach.add(e.target);
          queue.push(e.target);
        }
      }
    }
    for (const n of graph.nodes) {
      if (n.type === 'note' || n.type === 'start') continue;
      if (!reach.has(n.id)) {
        warnings.push({ nodeId: n.id, message: `'${n.name}' is not reachable from Start` });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
