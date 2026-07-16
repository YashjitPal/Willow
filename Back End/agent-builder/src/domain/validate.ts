/**
 * Graph validation — structural checks run before save/publish/execute.
 * Returns errors (block execution) and warnings (surfaced to the UI).
 */

import { parse as parseCel } from '../engine/cel/index.ts';
import type { CelNode } from '../engine/cel/parser.ts';
import { inferContracts, type NodeDataContract } from './contracts.ts';
import { normalizeGraph } from './normalize.ts';
import type {
  IfElseNodeConfig,
  JsonObject,
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
  /** Inferred input/output fields for the canvas data-contract inspector. */
  contracts: NodeDataContract[];
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

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function checkIdentifier(value: string, label: string, nodeId: string, errors: ValidationIssue[]): void {
  if (!IDENTIFIER.test(value)) {
    errors.push({
      nodeId,
      message: `${label} '${value}' must be a CEL identifier (letters, numbers, underscores)`,
    });
  }
}

function checkCel(expr: string): string | null {
  try {
    parseCel(expr);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const CEL_GLOBALS = new Set([
  'size',
  'string',
  'int',
  'double',
  'bool',
  'type',
  'matches',
  'min',
  'max',
  'has',
]);

/**
 * Return root identifiers referenced by an expression.  CEL method calls and
 * macro variables are deliberately handled separately so `items.exists(x,
 * x > 0)` only reports `items`.
 */
function referencedRoots(ast: CelNode, bound = new Set<string>(), out = new Set<string>()): Set<string> {
  switch (ast.kind) {
    case 'ident':
      if (!bound.has(ast.name) && !CEL_GLOBALS.has(ast.name)) out.add(ast.name);
      break;
    case 'member':
      referencedRoots(ast.obj, bound, out);
      break;
    case 'index':
      referencedRoots(ast.obj, bound, out);
      referencedRoots(ast.index, bound, out);
      break;
    case 'call': {
      if (ast.callee) referencedRoots(ast.callee, bound, out);
      // List/map macros bind their first identifier argument only in the
      // predicate/body expression.
      const macro = new Set(['filter', 'map', 'exists', 'all', 'exists_one']).has(ast.name);
      if (macro && ast.args[0]?.kind === 'ident' && ast.args.length >= 2) {
        for (const arg of ast.args.slice(2)) referencedRoots(arg, bound, out);
        const nested = new Set(bound);
        nested.add(ast.args[0].name);
        referencedRoots(ast.args[1], nested, out);
      } else {
        for (const arg of ast.args) referencedRoots(arg, bound, out);
      }
      break;
    }
    case 'list':
      for (const item of ast.items) referencedRoots(item, bound, out);
      break;
    case 'map':
      for (const entry of ast.entries) {
        referencedRoots(entry.key, bound, out);
        referencedRoots(entry.value, bound, out);
      }
      break;
    case 'unary':
      referencedRoots(ast.operand, bound, out);
      break;
    case 'binary':
      referencedRoots(ast.left, bound, out);
      referencedRoots(ast.right, bound, out);
      break;
    case 'ternary':
      referencedRoots(ast.cond, bound, out);
      referencedRoots(ast.then, bound, out);
      referencedRoots(ast.else, bound, out);
      break;
    case 'lit':
      break;
  }
  return out;
}

function collectExpressions(value: unknown, out: string[] = [], key?: string): string[] {
  // Tool implementation bodies are source code, not workflow templates.
  if (key === 'code') return out;
  if (typeof value === 'string') {
    if (value.startsWith('$cel:')) {
      out.push(value.slice('$cel:'.length).trim());
      return out;
    }
    let cursor = 0;
    while (cursor < value.length) {
      const open = value.indexOf('{{', cursor);
      if (open < 0) break;
      const close = value.indexOf('}}', open + 2);
      if (close < 0) break;
      const expression = value.slice(open + 2, close).trim();
      if (expression) out.push(expression);
      cursor = close + 2;
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExpressions(item, out, key);
  } else if (value && typeof value === 'object') {
    for (const [entryKey, item] of Object.entries(value)) {
      collectExpressions(item, out, entryKey);
    }
  }
  return out;
}

function warnUnknownReferences(graph: WorkflowGraph, warnings: ValidationIssue[]): void {
  const { varNames } = normalizeGraph(graph);
  const known = new Set(['workflow', 'state', 'input_as_text', ...varNames.values()]);
  for (const node of graph.nodes) {
    for (const expression of collectExpressions(node.config)) {
      let ast: CelNode;
      try {
        ast = parseCel(expression);
      } catch {
        continue; // syntax diagnostics are emitted by the node-specific checks
      }
      for (const root of referencedRoots(ast)) {
        if (!known.has(root)) {
          warnings.push({
            nodeId: node.id,
            message: `'${node.name}' references unknown variable '${root}' in '${expression}'`,
          });
        }
      }
    }
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
    const declaredInputs = new Set<string>();
    for (const iv of cfg.inputVariables ?? []) {
      if (!iv.name) {
        errors.push({ nodeId: start.id, message: 'input variable with empty name' });
      } else if (declaredInputs.has(iv.name)) {
        errors.push({ nodeId: start.id, message: `duplicate input variable '${iv.name}'` });
      } else {
        declaredInputs.add(iv.name);
        checkIdentifier(iv.name, 'input variable', start.id, errors);
      }
    }
    for (const sv of cfg.stateVariables ?? []) {
      if (!sv.name) errors.push({ nodeId: start.id, message: 'state variable with empty name' });
      else if (declaredState.has(sv.name)) {
        errors.push({ nodeId: start.id, message: `duplicate state variable '${sv.name}'` });
      } else {
        declaredState.add(sv.name);
        checkIdentifier(sv.name, 'state variable', start.id, errors);
      }
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
        if (node.config.maxTurns !== undefined &&
            (typeof node.config.maxTurns !== 'number' || node.config.maxTurns < 1 || node.config.maxTurns > 100)) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' maxTurns must be between 1 and 100` });
        }
        const params = node.config.modelParams;
        if (params && typeof params === 'object' && !Array.isArray(params)) {
          const temperature = (params as JsonObject).temperature;
          const topP = (params as JsonObject).topP;
          if (typeof temperature === 'number' && (temperature < 0 || temperature > 2)) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' temperature must be between 0 and 2` });
          }
          if (typeof topP === 'number' && (topP < 0 || topP > 1)) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' topP must be between 0 and 1` });
          }
        }
        break;
      }
      case 'ifElse': {
        const cfg = node.config as unknown as IfElseNodeConfig;
        if (!cfg.branches?.length) {
          errors.push({ nodeId: node.id, message: `If/else '${node.name}' has no condition branches` });
        }
        const branchIds = new Set<string>();
        for (const b of cfg.branches ?? []) {
          if (!b.id || branchIds.has(b.id)) {
            errors.push({ nodeId: node.id, message: `If/else '${node.name}' has duplicate or empty branch id '${b.id ?? ''}'` });
          } else {
            branchIds.add(b.id);
          }
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
        const outputNames = new Set<string>();
        for (const o of cfg.outputs ?? []) {
          if (!o.name) errors.push({ nodeId: node.id, message: `Transform '${node.name}' has an output with no name` });
          else if (outputNames.has(o.name)) errors.push({ nodeId: node.id, message: `Transform '${node.name}' has duplicate output '${o.name}'` });
          else {
            outputNames.add(o.name);
            checkIdentifier(o.name, 'transform output', node.id, errors);
          }
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

  // Catch misspelled node/state/workflow variables before execution.  These
  // remain warnings because dynamic values can be supplied by future node
  // types or provider-specific extensions.
  warnUnknownReferences(graph, warnings);

  return { valid: errors.length === 0, errors, warnings, contracts: inferContracts(graph) };
}
