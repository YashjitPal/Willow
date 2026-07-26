/**
 * Graph validation — structural checks run before save/publish/execute.
 * Returns errors (block execution) and warnings (surfaced to the UI).
 */

import { parse as parseCel } from '../engine/cel/index.ts';
import { coerceToVarType, validateSchemaDefinition } from '../engine/jsonSchema.ts';
import type { CelNode } from '../engine/cel/parser.ts';
import { inferContracts, type NodeDataContract } from './contracts.ts';
import { normalizeGraph } from './normalize.ts';
import { pinnedModelTokenLimits } from './modelCapabilities.ts';
import { providerForKnownModel } from '../providers/types.ts';
import type {
  AgentNodeConfig,
  FileSearchNodeConfig,
  GuardrailNodeConfig,
  IfElseNodeConfig,
  JsonObject,
  McpNodeConfig,
  SetStateNodeConfig,
  SubflowNodeConfig,
  StartNodeConfig,
  TransformNodeConfig,
  UserApprovalNodeConfig,
  WhileNodeConfig,
  WorkflowGraph,
  WorkflowNode,
} from './types.ts';

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
  code?: 'CONTRACT_UNKNOWN_PROPERTY' | 'CONTRACT_OPTIONAL_PROPERTY' | 'CONTRACT_TYPE_MISMATCH' | 'CONTRACT_SOURCE_NOT_UPSTREAM';
  path?: string;
  severity?: 'warning' | 'error';
  remediation?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Inferred input/output fields for the canvas data-contract inspector. */
  contracts: NodeDataContract[];
  /** Advisory static-analysis findings; absence does not prove a workflow is safe. */
  safetyFindings: SafetyFinding[];
}

export interface SafetyFinding {
  code:
    | 'SAFETY_UNTRUSTED_INSTRUCTIONS'
    | 'SAFETY_MCP_APPROVAL_DISABLED'
    | 'SAFETY_SENSITIVE_TOOL_NO_APPROVAL'
    | 'SAFETY_FREEFORM_OUTPUT_TO_MCP'
    | 'SAFETY_UNTRUSTED_INPUT_TO_MCP'
    | 'SAFETY_PRIVILEGED_PATH_UNGUARDED';
  level: 'warning';
  severity: 'medium' | 'high';
  nodeId: string;
  relatedNodeId?: string;
  message: string;
  remediation: string;
}

const SENSITIVE_QUERY = /^(?:access[_-]?token|api[_-]?key|key|token|secret|password|authorization)$/i;
const SENSITIVE_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i;
const SECRET_REFERENCE = /\{\{\s*secrets\.[A-Z][A-Z0-9_]{0,127}\s*\}\}/g;

function usesOnlyValidSecretReferences(value: unknown): boolean {
  if (typeof value !== 'string' || !SECRET_REFERENCE.test(value)) { SECRET_REFERENCE.lastIndex = 0; return false; }
  SECRET_REFERENCE.lastIndex = 0;
  const stripped = value.replace(SECRET_REFERENCE, '');
  SECRET_REFERENCE.lastIndex = 0;
  return !/\{\{\s*secrets\./i.test(stripped);
}

function httpCredentialError(tool: { execution?: { mode?: unknown; url?: unknown; headers?: unknown } }, label: string): string | undefined {
  if (tool.execution?.mode !== 'http') return undefined;
  if (tool.execution.headers && typeof tool.execution.headers === 'object') {
    const entries = Object.entries(tool.execution.headers as object);
    if (entries.length > 0 && entries.every(([, value]) => usesOnlyValidSecretReferences(value))) return undefined;
    if (entries.length > 0 && entries.every(([, value]) => value === '[REDACTED]')) return undefined;
    const names = entries.map(([name]) => name);
    if (names.some((name) => SENSITIVE_HEADER.test(name)) || names.length > 0) return `${label} embeds HTTP header values; store credentials outside the workflow graph`;
  }
  if (typeof tool.execution.url === 'string') {
    try {
      const url = new URL(tool.execution.url);
      let sensitiveQuery = false;
      url.searchParams.forEach((value, name) => { if (SENSITIVE_QUERY.test(name) && !usesOnlyValidSecretReferences(value)) sensitiveQuery = true; });
      if (url.username || url.password || sensitiveQuery) {
        return `${label} embeds credentials in its HTTP URL; store credentials outside the workflow graph`;
      }
    } catch { /* normal URL validation reports this separately */ }
  }
  return undefined;
}

export function embeddedHttpCredentialErrors(graph: WorkflowGraph): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'agent') continue;
    const tools = Array.isArray(node.config.tools) ? node.config.tools as unknown as Array<{ kind?: string; name?: string; execution?: { mode?: unknown; url?: unknown; headers?: unknown } }> : [];
    for (const tool of tools) {
      if (tool.kind !== 'function') continue;
      const message = httpCredentialError(tool, `Agent '${node.name}' function '${tool.name}'`);
      if (message) errors.push({ nodeId: node.id, code: 'EMBEDDED_HTTP_CREDENTIAL' as never, severity: 'error', message });
    }
  }
  return errors;
}

export function stripEmbeddedHttpCredentials(graph: WorkflowGraph): WorkflowGraph {
  for (const node of graph.nodes) {
    if (node.type !== 'agent' || !Array.isArray(node.config.tools)) continue;
    for (const tool of node.config.tools as unknown as Array<{ kind?: string; execution?: { mode?: string; url?: string; headers?: unknown } }>) {
      if (tool.kind !== 'function' || tool.execution?.mode !== 'http') continue;
      if (tool.execution.headers && typeof tool.execution.headers === 'object') {
        tool.execution.headers = Object.fromEntries(Object.entries(tool.execution.headers as object).map(([name, value]) => [name, usesOnlyValidSecretReferences(value) ? value : '[REDACTED]']));
      }
      if (typeof tool.execution.url === 'string') {
        try {
          const url = new URL(tool.execution.url);
          url.username = '';
          url.password = '';
          const remove: string[] = [];
          url.searchParams.forEach((value, name) => { if (SENSITIVE_QUERY.test(name) && !usesOnlyValidSecretReferences(value)) remove.push(name); });
          for (const name of remove) url.searchParams.delete(name);
          tool.execution.url = url.toString();
        } catch { /* URL validation handles malformed values */ }
      }
    }
  }
  return graph;
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
const ERROR_POLICY_NODES = new Set(['agent', 'subflow', 'fileSearch', 'mcp', 'ifElse', 'while', 'userApproval', 'transform', 'setState']);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SENSITIVE_TOOL_NAME = /(?:^|[_-])(delete|remove|destroy|write|update|create|send|publish|charge|pay|purchase|transfer|refund|invite|grant|revoke)(?:$|[_-])/i;

function configStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) configStrings(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) configStrings(item, out);
  return out;
}

function isActiveGuardrail(node: WorkflowNode): boolean {
  return node.type === 'guardrail' && ['pii', 'moderation', 'jailbreak', 'hallucination']
    .some((check) => node.config[check] === true);
}

function isPrivilegedNode(node: WorkflowNode): boolean {
  if (node.type === 'mcp') return true;
  if (node.type !== 'agent') return false;
  const tools = Array.isArray(node.config.tools) ? node.config.tools as unknown as Array<Record<string, unknown>> : [];
  return tools.some((tool) =>
    tool.kind === 'mcp' ||
    (tool.kind === 'function' && (tool.execution as { mode?: unknown } | undefined)?.mode === 'http'));
}

/** True when at least one executable Start-to-target route bypasses an active guardrail. */
function hasUnguardedPath(graph: WorkflowGraph, targetId: string): boolean {
  const startIds = graph.nodes.filter((node) => node.type === 'start').map((node) => node.id);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const transitions = new Map<string, Array<{ target: string; handle?: string | null }>>();
  for (const edge of graph.edges) {
    if (byId.get(edge.source)?.type === 'note' || byId.get(edge.target)?.type === 'note') continue;
    const list = transitions.get(edge.source) ?? [];
    list.push({ target: edge.target, handle: edge.sourceHandle });
    transitions.set(edge.source, list);
  }
  for (const node of graph.nodes) {
    if (node.type !== 'agent' || !Array.isArray(node.config.handoffs)) continue;
    const list = transitions.get(node.id) ?? [];
    for (const handoff of node.config.handoffs as unknown as Array<{ targetNodeId?: unknown }>) {
      if (typeof handoff.targetNodeId === 'string') list.push({ target: handoff.targetNodeId });
    }
    transitions.set(node.id, list);
  }

  const queue = startIds.map((nodeId) => ({ nodeId, guarded: false }));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.nodeId}:${current.guarded ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (current.nodeId === targetId && !current.guarded) return true;
    const node = byId.get(current.nodeId);
    if (!node) continue;
    for (const transition of transitions.get(current.nodeId) ?? []) {
      let guarded = current.guarded;
      if (isActiveGuardrail(node)) {
        guarded = guarded || node.config.onTripwire === 'stop' || transition.handle === 'pass';
      }
      queue.push({ nodeId: transition.target, guarded });
    }
  }
  return false;
}

function analyzeSafety(graph: WorkflowGraph): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const { varNames } = normalizeGraph(graph);
  const agentByVariable = new Map<string, WorkflowNode>();
  const freeformByVariable = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    const variable = varNames.get(node.id) ?? node.id;
    if (node.type === 'agent') agentByVariable.set(variable, node);
    if (
      (node.type === 'agent' && node.config.outputFormat === 'text') ||
      node.type === 'fileSearch' || node.type === 'mcp' || node.type === 'subflow'
    ) freeformByVariable.set(variable, node);
  }
  const add = (finding: SafetyFinding) => {
    if (!findings.some((existing) => existing.code === finding.code && existing.nodeId === finding.nodeId && existing.relatedNodeId === finding.relatedNodeId)) findings.push(finding);
  };

  for (const node of graph.nodes) {
    if (isPrivilegedNode(node) && hasUnguardedPath(graph, node.id)) {
      add({
        code: 'SAFETY_PRIVILEGED_PATH_UNGUARDED', level: 'warning', severity: 'high', nodeId: node.id,
        message: `Privileged node '${node.name}' is reachable through a path that does not pass an active guardrail.`,
        remediation: 'Place an enabled Guardrails node on every route to this node; route only its pass output onward, or configure the tripwire to stop the run.',
      });
    }
    if (node.type === 'agent') {
      const instructions = String(node.config.instructions ?? '');
      const directlyUntrusted = /{{\s*(?:workflow(?:\.|\[)|input_as_text\b|state(?:\.|\[))/i.test(instructions);
      const referencesFreeformOutput = [...freeformByVariable.keys()].some((variable) => {
        const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`{{\\s*${escaped}\\.(?:output_text|result|output)(?:\\.|\\[|\\s*}})`, 'i').test(instructions);
      });
      if (directlyUntrusted || referencesFreeformOutput) {
        add({
          code: 'SAFETY_UNTRUSTED_INSTRUCTIONS', level: 'warning', severity: 'high', nodeId: node.id,
          message: `Agent '${node.name}' interpolates workflow/user input into instructions, where untrusted text can influence developer-level context.`,
          remediation: 'Keep untrusted input in user messages or typed data fields; use structured validation and delimit data rather than interpolating it into instructions.',
        });
      }
      for (const tool of (node.config.tools ?? []) as unknown as Array<Record<string, unknown>>) {
        if (tool.kind === 'mcp' && tool.requireApproval !== 'always') {
          add({
            code: 'SAFETY_MCP_APPROVAL_DISABLED', level: 'warning', severity: 'medium', nodeId: node.id,
            message: `Agent '${node.name}' can invoke MCP tools without human approval.`,
            remediation: "Set the attached MCP tool's approval policy to 'always', especially for tools that read sensitive data or take external actions.",
          });
          const allowed = Array.isArray(tool.allowedTools) ? tool.allowedTools.filter((name): name is string => typeof name === 'string') : [];
          if (allowed.some((name) => SENSITIVE_TOOL_NAME.test(name))) {
            add({
              code: 'SAFETY_SENSITIVE_TOOL_NO_APPROVAL', level: 'warning', severity: 'high', nodeId: node.id,
              message: `Agent '${node.name}' exposes action-like MCP tools without approval.`,
              remediation: "Require approval and restrict allowedTools to the minimum necessary set; enforce authorization again inside the MCP server.",
            });
          }
        } else if (tool.kind === 'function' && (tool.execution as { mode?: unknown } | undefined)?.mode === 'http') {
          add({
            code: 'SAFETY_SENSITIVE_TOOL_NO_APPROVAL', level: 'warning', severity: 'high', nodeId: node.id,
            message: `Agent '${node.name}' has a server-side HTTP function tool with no human approval gate.`,
            remediation: 'Use a client-side approval step or an explicit User Approval node before external side effects, and enforce authorization/idempotency at the destination.',
          });
        }
      }
    }

    if (node.type === 'mcp') {
      const requiresApproval = node.config.requireApproval === 'always';
      if (!requiresApproval) {
        add({
          code: 'SAFETY_MCP_APPROVAL_DISABLED', level: 'warning', severity: 'medium', nodeId: node.id,
          message: `MCP node '${node.name}' invokes '${String(node.config.tool ?? '')}' without human approval.`,
          remediation: "Set requireApproval to 'always' and keep server-side authorization checks in place.",
        });
        if (SENSITIVE_TOOL_NAME.test(String(node.config.tool ?? ''))) {
          add({
            code: 'SAFETY_SENSITIVE_TOOL_NO_APPROVAL', level: 'warning', severity: 'high', nodeId: node.id,
            message: `MCP node '${node.name}' appears to invoke an external action without approval.`,
            remediation: 'Require approval before the call and use least-privilege credentials, authorization checks, and idempotency controls in the MCP server.',
          });
        }
      }
      const argumentText = configStrings(node.config.arguments).join('\n');
      if (/(?:{{\s*(?:workflow\.)?input_as_text(?:\s*}}|\b)|\b(?:workflow\.)?input_as_text\b)/i.test(argumentText)) {
        add({
          code: 'SAFETY_UNTRUSTED_INPUT_TO_MCP', level: 'warning', severity: 'high', nodeId: node.id,
          message: `Raw workflow input directly supplies MCP arguments for '${node.name}'.`,
          remediation: 'Extract only the required fields into a strict structured schema, validate or allowlist their values, and pass those typed fields to the MCP call.',
        });
      }
      for (const [variable, agent] of agentByVariable) {
        if (agent.config.outputFormat !== 'text') continue;
        const direct = new RegExp(`(?:{{\\s*${variable}\\.output_text\\s*}}|\\b${variable}\\.output_text\\b)`, 'i');
        if (direct.test(argumentText)) {
          add({
            code: 'SAFETY_FREEFORM_OUTPUT_TO_MCP', level: 'warning', severity: 'high', nodeId: node.id, relatedNodeId: agent.id,
            message: `Freeform output from Agent '${agent.name}' directly supplies MCP arguments for '${node.name}'.`,
            remediation: 'Use strict structured output, validate/allowlist each argument, and add human approval before the MCP call when it can access sensitive data or take actions.',
          });
        }
      }
    }
  }
  return findings;
}

const RELEASE_BLOCKING_SAFETY_CODES = new Set<SafetyFinding['code']>([
  'SAFETY_UNTRUSTED_INSTRUCTIONS',
  'SAFETY_MCP_APPROVAL_DISABLED',
  'SAFETY_FREEFORM_OUTPUT_TO_MCP',
  'SAFETY_UNTRUSTED_INPUT_TO_MCP',
  'SAFETY_PRIVILEGED_PATH_UNGUARDED',
]);

/** Converts high-confidence advisory findings into release-boundary errors. */
export function releaseSafetyErrors(validation: Pick<ValidationResult, 'safetyFindings'>): ValidationIssue[] {
  return validation.safetyFindings
    .filter((finding) => RELEASE_BLOCKING_SAFETY_CODES.has(finding.code))
    .map((finding) => ({
      nodeId: finding.nodeId,
      code: finding.code as never,
      severity: 'error',
      message: `${finding.message} ${finding.remediation}`,
    }));
}

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

type StaticType = 'string' | 'number' | 'boolean' | 'object' | 'list' | 'unknown';
interface ResolvedField { type: StaticType; required: boolean; missing?: boolean }

function schemaStaticType(schema: JsonObject | undefined): StaticType {
  const type = schema?.type;
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'array') return 'list';
  if (type === 'string' || type === 'boolean' || type === 'object') return type;
  return 'unknown';
}

function resolveNodeField(node: WorkflowNode, path: string[]): ResolvedField | undefined {
  if (!path.length) return undefined;
  if (ERROR_POLICY_NODES.has(node.type) && node.config.onError !== 'fail' && path[0] === 'error') {
    if (path.length === 1) return { type: 'object', required: false };
    const errorFields: Record<string, StaticType> = { type: 'string', message: 'string', nodeId: 'string', nodeType: 'string' };
    return errorFields[path[1]]
      ? { type: errorFields[path[1]], required: true, missing: path.length > 2 }
      : { type: 'unknown', required: false, missing: true };
  }
  if (node.type === 'agent') {
    if (path[0] === 'output_text') return { type: 'string', required: true, missing: path.length > 1 };
    if (path[0] !== 'output_parsed' || node.config.outputFormat !== 'json') return undefined;
    let schema = node.config.outputSchema as JsonObject | undefined;
    let required = true;
    if (path.length === 1) return { type: 'object', required: true };
    for (const segment of path.slice(1)) {
      const properties = schema?.properties as JsonObject | undefined;
      const child = properties?.[segment] as JsonObject | undefined;
      if (!child) return schema?.additionalProperties === false ? { type: 'unknown', required: false, missing: true } : undefined;
      const requiredNames = Array.isArray(schema?.required) ? schema.required as unknown[] : [];
      required = required && requiredNames.includes(segment);
      schema = child;
    }
    return { type: schemaStaticType(schema), required };
  }
  const fixed: Record<string, StaticType> = node.type === 'fileSearch'
    ? { results: 'list', output_text: 'string', query: 'string' }
    : node.type === 'mcp' ? { result: 'unknown', output_text: 'string', approved: 'boolean' }
    : node.type === 'ifElse' ? { matched: 'string' }
    : node.type === 'while' ? { iterations: 'number' }
    : node.type === 'setState' ? { updated: 'list' }
    : node.type === 'userApproval' ? { approved: 'boolean' }
    : {};
  if (node.type === 'transform') {
    const field = ((node.config.outputs ?? []) as unknown as Array<{ name?: string; type?: StaticType }>).find((item) => item.name === path[0]);
    return field ? { type: field.type ?? 'unknown', required: true, missing: path.length > 1 } : { type: 'unknown', required: false, missing: true };
  }
  if (fixed[path[0]]) return { type: fixed[path[0]], required: true, missing: path.length > 1 };
  return undefined;
}

function directReference(expression: unknown, nodesByVar: Map<string, WorkflowNode>): { variable: string; path: string[]; node: WorkflowNode } | undefined {
  if (typeof expression !== 'string') return undefined;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_.]*)$/.exec(expression.trim());
  if (!match) return undefined;
  const node = nodesByVar.get(match[1]);
  return node ? { variable: match[1], path: match[2].split('.'), node } : undefined;
}

function analyzeContractCompatibility(graph: WorkflowGraph, errors: ValidationIssue[], warnings: ValidationIssue[]): void {
  const { varNames } = normalizeGraph(graph);
  const nodesByVar = new Map(graph.nodes.map((node) => [varNames.get(node.id) ?? node.id, node]));
  const ancestors = (targetId: string): Set<string> => {
    const result = new Set<string>();
    const queue = graph.edges.filter((edge) => edge.target === targetId).map((edge) => edge.source);
    while (queue.length) {
      const id = queue.shift()!;
      if (result.has(id)) continue;
      result.add(id);
      for (const edge of graph.edges) if (edge.target === id) queue.push(edge.source);
    }
    return result;
  };
  const inspect = (target: WorkflowNode, expression: string, expected?: StaticType, configPath?: string) => {
    const reference = directReference(expression, nodesByVar);
    if (!reference) return;
    const resolved = resolveNodeField(reference.node, reference.path);
    const path = `${reference.variable}.${reference.path.join('.')}`;
    if (!ancestors(target.id).has(reference.node.id) && reference.node.id !== target.id) {
      warnings.push({ code: 'CONTRACT_SOURCE_NOT_UPSTREAM', severity: 'warning', nodeId: target.id, path: configPath ?? path, message: `'${target.name}' references '${path}', but '${reference.node.name}' is not on an upstream executable path`, remediation: 'Connect the producing node upstream of this node or remove the reference.' });
    }
    if (resolved?.missing) {
      errors.push({ code: 'CONTRACT_UNKNOWN_PROPERTY', severity: 'error', nodeId: target.id, path: configPath ?? path, message: `'${target.name}' references missing output property '${path}'`, remediation: 'Add the property to the producer structured-output schema or update the reference.' });
      return;
    }
    if (resolved && !resolved.required) {
      warnings.push({ code: 'CONTRACT_OPTIONAL_PROPERTY', severity: 'warning', nodeId: target.id, path: configPath ?? path, message: `'${target.name}' references optional output property '${path}'`, remediation: 'Make the property required in the producer schema or handle its absence explicitly.' });
    }
    if (expected && resolved && resolved.type !== 'unknown' && expected !== resolved.type) {
      errors.push({ code: 'CONTRACT_TYPE_MISMATCH', severity: 'error', nodeId: target.id, path: configPath ?? path, message: `'${target.name}' expects ${expected} at '${configPath ?? path}', but '${path}' is ${resolved.type}`, remediation: `Change the target type to ${resolved.type} or transform the value explicitly before this node.` });
    }
  };

  const start = graph.nodes.find((node) => node.type === 'start');
  const stateTypes = new Map(((start?.config.stateVariables ?? []) as unknown as Array<{ name: string; type: StaticType }>).map((item) => [item.name, item.type]));
  for (const node of graph.nodes) {
    if (!['transform', 'setState', 'ifElse', 'while'].includes(node.type)) {
      for (const expression of collectExpressions(node.config)) inspect(node, expression);
    }
    if (node.type === 'transform') {
      for (const [index, output] of ((node.config.outputs ?? []) as unknown as Array<{ type: StaticType; expression: string }>).entries()) inspect(node, output.expression, output.type, `outputs[${index}].expression`);
    } else if (node.type === 'setState') {
      for (const [index, assignment] of ((node.config.assignments ?? []) as unknown as Array<{ name: string; expression: string }>).entries()) inspect(node, assignment.expression, stateTypes.get(assignment.name), `assignments[${index}].expression`);
    } else if (node.type === 'ifElse') {
      for (const [index, branch] of ((node.config.branches ?? []) as unknown as Array<{ condition: string }>).entries()) inspect(node, branch.condition, 'boolean', `branches[${index}].condition`);
    } else if (node.type === 'while') {
      inspect(node, String(node.config.condition ?? ''), 'boolean', 'condition');
    }
  }
}

export function validateGraph(graph: WorkflowGraph): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  errors.push(...embeddedHttpCredentialErrors(graph));
  const executableEdges = graph.edges.filter((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    return source?.type !== 'note' && target?.type !== 'note';
  });
  const routingEdges = [
    ...executableEdges,
    ...graph.nodes.flatMap((node) => node.type === 'agent' && Array.isArray(node.config.handoffs)
      ? (node.config.handoffs as unknown as Array<{ targetNodeId?: string }>).flatMap((handoff) => handoff.targetNodeId
        ? [{ id: `handoff:${node.id}:${handoff.targetNodeId}`, source: node.id, target: handoff.targetNodeId }]
        : [])
      : []),
  ];

  // --- start node ---
  const starts = graph.nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) errors.push({ message: 'workflow needs a Start node' });
  if (starts.length > 1) {
    errors.push({ message: `workflow must have exactly one Start node (found ${starts.length})` });
  }

  // --- edges reference real nodes; start has no incoming; end no outgoing ---
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (!e.id.trim()) errors.push({ edgeId: e.id, message: 'edge id cannot be empty' });
    if (edgeIds.has(e.id)) errors.push({ edgeId: e.id, message: `duplicate edge id '${e.id}'` });
    edgeIds.add(e.id);
    if (!byId.has(e.source)) errors.push({ edgeId: e.id, message: `edge source '${e.source}' does not exist` });
    if (!byId.has(e.target)) errors.push({ edgeId: e.id, message: `edge target '${e.target}' does not exist` });
    if (e.targetHandle !== null && e.targetHandle !== undefined) {
      const target = byId.get(e.target);
      if (e.targetHandle !== 'loop_back' || target?.type !== 'while') {
        errors.push({ edgeId: e.id, nodeId: target?.id, message: `invalid target handle '${e.targetHandle}'` });
      }
    }
  }
  for (const e of graph.edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (src?.type === 'end') errors.push({ edgeId: e.id, nodeId: src.id, message: 'End nodes cannot have outgoing edges' });
    if (tgt?.type === 'start') errors.push({ edgeId: e.id, nodeId: tgt.id, message: 'Start nodes cannot have incoming edges' });
  }

  // --- outgoing-edge rules per node ---
  for (const node of graph.nodes) {
    if (node.type === 'note') continue;
    const out = executableEdges.filter((e) => e.source === node.id);
    const rawPolicy = ERROR_POLICY_NODES.has(node.type) ? (node.config as JsonObject).onError : undefined;
    const onError = rawPolicy ?? 'fail';
    if (ERROR_POLICY_NODES.has(node.type) && !['fail', 'continue', 'branch'].includes(String(onError))) {
      errors.push({ nodeId: node.id, message: `'${node.name}' has invalid onError policy '${String(onError)}'` });
    }
    const baseHandles = BRANCH_HANDLES[node.type]?.(node);
    const handles = baseHandles
      ? [...baseHandles, ...(onError === 'branch' ? ['error'] : [])]
      : undefined;

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
      for (const handle of handles) {
        if (!out.some((edge) => (edge.sourceHandle ?? '') === handle)) {
          errors.push({ nodeId: node.id, message: `'${node.name}' (${node.type}) needs an edge on handle '${handle}'` });
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
    } else if (node.type !== 'end') {
      if (onError === 'branch') {
        for (const edge of out) {
          const handle = edge.sourceHandle ?? '';
          if (handle !== '' && handle !== 'error') {
            errors.push({ edgeId: edge.id, nodeId: node.id, message: `'${node.name}' edge must use the default or 'error' handle` });
          }
        }
        if (out.filter((edge) => (edge.sourceHandle ?? '') === '').length > 1 || out.filter((edge) => edge.sourceHandle === 'error').length > 1) {
          errors.push({ nodeId: node.id, message: `'${node.name}' has duplicate default or error transitions` });
        }
        if (!out.some((edge) => edge.sourceHandle === 'error')) {
          errors.push({ nodeId: node.id, message: `'${node.name}' needs an edge on handle 'error'` });
        }
      } else if (out.some((edge) => edge.sourceHandle !== null && edge.sourceHandle !== undefined)) {
        errors.push({ nodeId: node.id, message: `'${node.name}' does not support handled error edges unless onError is 'branch'` });
      } else if (out.length > 1) {
        errors.push({ nodeId: node.id, message: `'${node.name}' (${node.type}) can only have one outgoing edge (found ${out.length})` });
      }
      const hasDynamicHandoff = node.type === 'agent' && Array.isArray(node.config.handoffs) && node.config.handoffs.length > 0;
      if (out.length === 0 && node.type !== 'start' && !hasDynamicHandoff) {
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
      if (!['string', 'number', 'boolean', 'object', 'list'].includes(iv.type)) {
        errors.push({ nodeId: start.id, message: `input variable '${iv.name}' has invalid type '${String(iv.type)}'` });
      } else if (iv.defaultValue !== undefined) {
        try { coerceToVarType(iv.defaultValue, iv.type); }
        catch { errors.push({ nodeId: start.id, message: `input variable '${iv.name}' has an invalid ${iv.type} default value` }); }
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
      if (!['string', 'number', 'boolean', 'object', 'list'].includes(sv.type)) {
        errors.push({ nodeId: start.id, message: `state variable '${sv.name}' has invalid type '${String(sv.type)}'` });
      } else if (sv.initialValue !== undefined) {
        try { coerceToVarType(sv.initialValue, sv.type); }
        catch { errors.push({ nodeId: start.id, message: `state variable '${sv.name}' has an invalid ${sv.type} default value` }); }
      }
    }
  }

  for (const node of graph.nodes) {
    switch (node.type) {
      case 'subflow': {
        const subflowConfig = node.config as unknown as SubflowNodeConfig;
        if (typeof subflowConfig.workflowId !== 'string' || !subflowConfig.workflowId.trim()) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' needs a workflowId` });
        if (!Number.isInteger(subflowConfig.version) || subflowConfig.version < 1) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' version must be a positive published version` });
        if (subflowConfig.maxDepth !== undefined && (!Number.isInteger(subflowConfig.maxDepth) || subflowConfig.maxDepth < 1 || subflowConfig.maxDepth > 32)) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' maxDepth must be between 1 and 32` });
        const targets = new Set<string>();
        for (const mapping of subflowConfig.inputMappings ?? []) {
          if (!mapping || typeof mapping.target !== 'string' || !mapping.target.trim()) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' has an invalid input mapping target` });
          else if (targets.has(mapping.target)) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' has duplicate input mapping '${mapping.target}'` });
          else targets.add(mapping.target);
          if (mapping.target && !['input_as_text'].includes(mapping.target) && !/^(variables|state_variables)\.[A-Za-z_][A-Za-z0-9_]*$/.test(mapping.target)) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' input mapping '${mapping.target}' must target input_as_text, variables.<name>, or state_variables.<name>` });
        }
        const outputs = new Set<string>();
        for (const mapping of subflowConfig.outputMappings ?? []) {
          if (!mapping || typeof mapping.name !== 'string' || !mapping.name.trim() || outputs.has(mapping.name)) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' has an invalid or duplicate output mapping` });
          else outputs.add(mapping.name);
          if (!mapping || !['string', 'number', 'boolean', 'object', 'list'].includes(mapping.type)) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' output mapping '${mapping?.name ?? ''}' has an invalid type` });
          if (!mapping || typeof mapping.expression !== 'string' || !mapping.expression.trim()) errors.push({ nodeId: node.id, message: `Subflow '${node.name}' output mapping '${mapping?.name ?? ''}' needs an expression` });
        }
        break;
      }
      case 'agent': {
        const agentConfig = node.config as unknown as AgentNodeConfig;
        const model = node.config.model;
        if (!model || typeof model !== 'string') {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' has no model configured` });
        } else if (!providerForKnownModel(model)) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' uses unverified model '${model}'. Select a model returned by the model catalog; Willow will not guess its provider.` });
        }
        if (agentConfig.handoffs !== undefined) {
          if (!Array.isArray(agentConfig.handoffs)) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' handoffs must be an array` });
          } else {
            const handoffNames = new Set<string>();
            for (const handoff of agentConfig.handoffs) {
              if (!handoff || typeof handoff !== 'object' || typeof handoff.targetNodeId !== 'string' || !handoff.targetNodeId.trim()) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' has an invalid handoff target` });
                continue;
              }
              const target = byId.get(handoff.targetNodeId);
              if (!target || target.type !== 'agent') {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' handoff target '${handoff.targetNodeId}' must reference an Agent node` });
              } else if (target.id === node.id) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' cannot hand off to itself` });
              }
              const toolName = handoff.toolName;
              if (toolName !== undefined && (typeof toolName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(toolName))) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' handoff toolName must be a valid function name` });
              }
              if (toolName && handoffNames.has(toolName)) errors.push({ nodeId: node.id, message: `Agent '${node.name}' has duplicate handoff tool '${toolName}'` });
              if (toolName) handoffNames.add(toolName);
            }
          }
        }
        if (node.config.outputFormat === 'json' && !node.config.outputSchema) {
          warnings.push({ nodeId: node.id, message: `Agent '${node.name}' uses JSON output without a schema; output will be parsed loosely` });
        }
        if (node.config.outputFormat === 'json' && node.config.outputSchema) {
          const outputSchema = node.config.outputSchema as JsonObject;
          const schemaIssues = validateSchemaDefinition(outputSchema);
          for (const issue of schemaIssues) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' output schema ${issue.path}: ${issue.message}` });
          }
          if (outputSchema.type !== 'object') {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' output schema root type must be object` });
          }
        }
        if (node.config.maxTurns !== undefined &&
            (typeof node.config.maxTurns !== 'number' || node.config.maxTurns < 1 || node.config.maxTurns > 100)) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' maxTurns must be between 1 and 100` });
        }
        if (agentConfig.maxInputTokensPerCall !== undefined &&
            (!Number.isInteger(agentConfig.maxInputTokensPerCall) || agentConfig.maxInputTokensPerCall < 1 || agentConfig.maxInputTokensPerCall > 10_000_000)) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' maxInputTokensPerCall must be an integer between 1 and 10000000` });
        }
        const knownLimits = typeof model === 'string' ? pinnedModelTokenLimits(model) : { limitsSource: 'unknown' as const };
        const modelTimeoutMs = agentConfig.modelTimeoutMs;
        if (modelTimeoutMs !== undefined &&
            (!Number.isInteger(modelTimeoutMs) ||
              (modelTimeoutMs !== 0 && (modelTimeoutMs < 100 || modelTimeoutMs > 600_000)))) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' model timeout must be 0 or between 100 and 600000 ms` });
        }
        const params = node.config.modelParams;
        if (params && typeof params === 'object' && !Array.isArray(params)) {
          const temperature = (params as JsonObject).temperature;
          const topP = (params as JsonObject).topP;
          const maxTokens = (params as JsonObject).maxTokens;
          if (typeof temperature === 'number' && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' temperature must be between 0 and 2` });
          }
          if (typeof topP === 'number' && (!Number.isFinite(topP) || topP < 0 || topP > 1)) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' topP must be between 0 and 1` });
          }
          if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1_000_000)) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' maxTokens must be an integer between 1 and 1000000` });
          }
          if (typeof maxTokens === 'number' && knownLimits.maxOutputTokens !== undefined && maxTokens > knownLimits.maxOutputTokens) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' maxTokens exceeds model '${model}' output limit (${knownLimits.maxOutputTokens})` });
          }
          if (typeof maxTokens === 'number' && agentConfig.maxInputTokensPerCall !== undefined && knownLimits.contextWindowTokens !== undefined && maxTokens + agentConfig.maxInputTokensPerCall > knownLimits.contextWindowTokens) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' configured input and output limits exceed model '${model}' context window (${knownLimits.contextWindowTokens})` });
          }
        }
        const promptCache = agentConfig.promptCache;
        if (promptCache !== undefined) {
          if (!promptCache || typeof promptCache !== 'object' || Array.isArray(promptCache) || !['auto', 'enabled', 'disabled'].includes(promptCache.policy)) {
            errors.push({ nodeId: node.id, message: `Agent '${node.name}' has invalid prompt cache policy` });
          } else {
            const provider = typeof model === 'string' ? providerForKnownModel(model) : undefined;
            if (promptCache.key !== undefined && (typeof promptCache.key !== 'string' || !promptCache.key.trim() || promptCache.key.length > 64)) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' prompt cache key must be 1 to 64 characters` });
            }
            if (promptCache.retention !== undefined && !['in-memory', '5m', '1h', '24h'].includes(promptCache.retention)) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' has invalid prompt cache retention` });
            }
            if (promptCache.policy !== 'enabled' && (promptCache.key !== undefined || promptCache.retention !== undefined)) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' prompt cache key/retention require policy 'enabled'` });
            }
            if (provider === 'openai') {
              if (promptCache.policy === 'disabled') errors.push({ nodeId: node.id, message: `Agent '${node.name}' cannot disable OpenAI provider-managed prompt caching` });
              if (promptCache.retention && !['in-memory', '24h'].includes(promptCache.retention)) errors.push({ nodeId: node.id, message: `Agent '${node.name}' OpenAI prompt cache retention must be in-memory or 24h` });
            } else if (provider === 'anthropic') {
              if (promptCache.key !== undefined) errors.push({ nodeId: node.id, message: `Agent '${node.name}' Anthropic prompt caching does not support cache keys` });
              if (promptCache.retention && !['5m', '1h'].includes(promptCache.retention)) errors.push({ nodeId: node.id, message: `Agent '${node.name}' Anthropic prompt cache retention must be 5m or 1h` });
              if (promptCache.policy === 'enabled' && !String(agentConfig.instructions ?? '').trim()) errors.push({ nodeId: node.id, message: `Agent '${node.name}' Anthropic prompt caching requires non-empty instructions` });
            } else if (promptCache.policy === 'enabled' || promptCache.key !== undefined || promptCache.retention !== undefined) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' prompt cache controls are not supported by model '${model}'` });
            }
          }
        }
        if (agentConfig.reasoningEffort !== undefined && !['minimal', 'low', 'medium', 'high'].includes(agentConfig.reasoningEffort)) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' has invalid reasoning effort` });
        }
        if (agentConfig.verbosity !== undefined && !['low', 'medium', 'high'].includes(agentConfig.verbosity)) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' has invalid verbosity` });
        }
        if (agentConfig.verbosity !== undefined && typeof model === 'string' && !model.toLowerCase().startsWith('gpt-5')) {
          warnings.push({ nodeId: node.id, message: `Agent '${node.name}' verbosity is only applied to GPT-5 models` });
        }
        if (agentConfig.reasoningEffort !== undefined && typeof model === 'string') {
          const normalizedModel = model.toLowerCase().replace(/^models\//, '');
          const supportsReasoning = /^(gpt-5|o1|o3|o4)/.test(normalizedModel) || /^gemini-(2\.5|[3-9])/.test(normalizedModel);
          if (!supportsReasoning) warnings.push({ nodeId: node.id, message: `Agent '${node.name}' reasoning effort is not supported by model '${model}'` });
        }
        if (typeof model === 'string' && /^(gpt-5|o1|o3|o4)/.test(model.toLowerCase()) && params && typeof params === 'object' && !Array.isArray(params)) {
          if ((params as JsonObject).temperature !== undefined || (params as JsonObject).topP !== undefined) {
            warnings.push({ nodeId: node.id, message: `Agent '${node.name}' temperature and topP are ignored by reasoning models` });
          }
        }
        if (agentConfig.outputFormat !== undefined && !['text', 'json'].includes(agentConfig.outputFormat)) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' has invalid output format` });
        }
        const toolChoice = agentConfig.toolChoice;
        const validSpecificTool = toolChoice && typeof toolChoice === 'object' && !Array.isArray(toolChoice) && typeof (toolChoice as JsonObject).name === 'string' && Boolean(String((toolChoice as JsonObject).name).trim());
        if (toolChoice !== undefined && !(typeof toolChoice === 'string' && ['auto', 'required', 'none'].includes(toolChoice)) && !validSpecificTool) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' has invalid tool choice` });
        }
        if ((agentConfig.toolChoice === 'required' || validSpecificTool) && !(agentConfig.tools?.length)) {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' requires a tool call but has no tools` });
        }
        if (agentConfig.parallelToolCalls !== undefined && typeof agentConfig.parallelToolCalls !== 'boolean') {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' parallel tool calls must be boolean` });
        }
        if (agentConfig.resetToolChoice !== undefined && typeof agentConfig.resetToolChoice !== 'boolean') {
          errors.push({ nodeId: node.id, message: `Agent '${node.name}' reset tool choice must be boolean` });
        }
        const localToolNames = new Set<string>();
        for (const tool of agentConfig.tools ?? []) {
          const policy = tool.executionPolicy;
          if (policy) {
            if (policy.timeoutMs !== undefined && (!Number.isInteger(policy.timeoutMs) || (policy.timeoutMs !== 0 && (policy.timeoutMs < 100 || policy.timeoutMs > 600_000)))) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' tool timeout must be 0 or between 100 and 600000 ms` });
            }
            if (policy.maxRetries !== undefined && (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 5)) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' tool maxRetries must be between 0 and 5` });
            }
            if (policy.retryBackoffMs !== undefined && (!Number.isInteger(policy.retryBackoffMs) || policy.retryBackoffMs < 0 || policy.retryBackoffMs > 60_000)) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' tool retryBackoffMs must be between 0 and 60000` });
            }
            if (policy.timeoutBehavior !== undefined && !['error_as_result', 'raise_exception'].includes(policy.timeoutBehavior)) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' tool timeoutBehavior is invalid` });
            }
            if (tool.kind === 'function' && tool.execution?.mode === 'client' && (policy.maxRetries ?? 0) > 0) {
              errors.push({ nodeId: node.id, message: `Agent '${node.name}' client tools cannot be retried by the backend` });
            }
          }
          if (tool.kind === 'function' || tool.kind === 'custom') {
            const name = tool.name?.trim();
            if (!name) errors.push({ nodeId: node.id, message: `Agent '${node.name}' has a ${tool.kind} tool with no name` });
            else if (localToolNames.has(name)) errors.push({ nodeId: node.id, message: `Agent '${node.name}' has duplicate local tool name '${name}'` });
            else localToolNames.add(name);
          }
          switch (tool.kind) {
            case 'web_search':
              if (tool.maxResults !== undefined && (!Number.isInteger(tool.maxResults) || tool.maxResults < 1 || tool.maxResults > 10)) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' web search maxResults must be between 1 and 10` });
              }
              break;
            case 'file_search':
              if (!Array.isArray(tool.vectorStoreIds) || tool.vectorStoreIds.length === 0 || tool.vectorStoreIds.some((id) => typeof id !== 'string' || !id.trim())) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' file search needs at least one vector store` });
              }
              if (tool.maxResults !== undefined && (!Number.isInteger(tool.maxResults) || tool.maxResults < 1 || tool.maxResults > 50)) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' file search maxResults must be between 1 and 50` });
              }
              if (tool.scoreThreshold !== undefined && (typeof tool.scoreThreshold !== 'number' || tool.scoreThreshold < 0 || tool.scoreThreshold > 1)) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' file search scoreThreshold must be between 0 and 1` });
              }
              break;
            case 'mcp':
              if (!tool.serverId?.trim()) errors.push({ nodeId: node.id, message: `Agent '${node.name}' MCP tool needs a serverId` });
              if (tool.allowedTools && tool.allowedTools.some((name) => typeof name !== 'string' || !name.trim())) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' MCP allowedTools contains an empty name` });
              }
              if (tool.requireApproval !== undefined && !['never', 'always'].includes(tool.requireApproval)) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' MCP approval policy must be never or always` });
              }
              if (tool.approvalTimeoutMs !== undefined && (!Number.isInteger(tool.approvalTimeoutMs) ||
                  (tool.approvalTimeoutMs !== 0 && (tool.approvalTimeoutMs < 10 || tool.approvalTimeoutMs > 604_800_000)))) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' MCP approval timeout must be 0 or between 10 and 604800000 ms` });
              }
              break;
            case 'function':
              if (!tool.execution || !['js', 'http', 'client'].includes(tool.execution.mode)) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' function '${tool.name}' has invalid execution mode` });
              } else if (tool.execution.mode === 'js' && !tool.execution.code?.trim()) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' function '${tool.name}' needs JavaScript code` });
              } else if (tool.execution.mode === 'http') {
                try {
                  const url = new URL(tool.execution.url);
                  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
                } catch {
                  errors.push({ nodeId: node.id, message: `Agent '${node.name}' function '${tool.name}' needs a valid HTTP URL` });
                }
              }
              break;
            case 'custom':
              if (!['text', 'json'].includes(tool.format)) errors.push({ nodeId: node.id, message: `Agent '${node.name}' custom tool '${tool.name}' has invalid format` });
              if (tool.code !== undefined && !tool.code.trim()) errors.push({ nodeId: node.id, message: `Agent '${node.name}' custom tool '${tool.name}' has empty code` });
              break;
            case 'code_interpreter': {
              if (tool.timeoutMs !== undefined &&
                  (typeof tool.timeoutMs !== 'number' || !Number.isFinite(tool.timeoutMs) || tool.timeoutMs < 100 || tool.timeoutMs > 120_000)) {
                errors.push({ nodeId: node.id, message: `Agent '${node.name}' code interpreter timeout must be between 100 and 120000 ms` });
              }
              const names = new Set<string>();
              let totalBytes = 0;
              for (const file of tool.files ?? []) {
                if (!file.name?.trim()) {
                  errors.push({ nodeId: node.id, message: `Agent '${node.name}' has a code interpreter attachment with no name` });
                  continue;
                }
                if (names.has(file.name)) errors.push({ nodeId: node.id, message: `Agent '${node.name}' has duplicate code interpreter attachment '${file.name}'` });
                names.add(file.name);
                const bytes = new TextEncoder().encode(file.content ?? '').byteLength;
                if (bytes > 2 * 1024 * 1024) errors.push({ nodeId: node.id, message: `Agent '${node.name}' attachment '${file.name}' exceeds 2 MB` });
                totalBytes += bytes;
              }
              if (totalBytes > 5 * 1024 * 1024) errors.push({ nodeId: node.id, message: `Agent '${node.name}' code interpreter attachments exceed 5 MB total` });
              break;
            }
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
        const maxIterations = cfg.maxIterations;
        if (maxIterations !== undefined && (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10000)) {
          errors.push({ nodeId: node.id, message: `While '${node.name}' maxIterations must be an integer between 1 and 10000` });
        }
        if (cfg.onMaxIterations !== undefined && cfg.onMaxIterations !== 'fail' && cfg.onMaxIterations !== 'break') {
          errors.push({ nodeId: node.id, message: `While '${node.name}' onMaxIterations must be 'fail' or 'break'` });
        }
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
          // Set state is deliberately the only writer of workflow state. Every
          // assignment must therefore target an explicit Start declaration,
          // including workflows that declare no state variables at all.
          if (!declaredState.has(a.name)) {
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
        const policy = (node.config as unknown as McpNodeConfig).executionPolicy;
        if (policy?.timeoutMs !== undefined && (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 600_000)) errors.push({ nodeId: node.id, message: `MCP node '${node.name}' timeout must be between 100 and 600000 ms` });
        if (policy?.maxRetries !== undefined && (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 5)) errors.push({ nodeId: node.id, message: `MCP node '${node.name}' maxRetries must be between 0 and 5` });
        if (policy?.retryBackoffMs !== undefined && (!Number.isInteger(policy.retryBackoffMs) || policy.retryBackoffMs < 0 || policy.retryBackoffMs > 60_000)) errors.push({ nodeId: node.id, message: `MCP node '${node.name}' retryBackoffMs must be between 0 and 60000` });
        const approvalTimeoutMs = (node.config as unknown as McpNodeConfig).approvalTimeoutMs;
        if (approvalTimeoutMs !== undefined && (!Number.isInteger(approvalTimeoutMs) ||
            (approvalTimeoutMs !== 0 && (approvalTimeoutMs < 10 || approvalTimeoutMs > 604_800_000)))) {
          errors.push({ nodeId: node.id, message: `MCP node '${node.name}' approval timeout must be 0 or between 10 and 604800000 ms` });
        }
        break;
      }
      case 'userApproval': {
        const timeoutMs = (node.config as unknown as UserApprovalNodeConfig).timeoutMs;
        if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || (timeoutMs !== 0 && (timeoutMs < 10 || timeoutMs > 604_800_000)))) {
          errors.push({ nodeId: node.id, message: `User approval '${node.name}' timeout must be 0 or between 10 and 604800000 milliseconds` });
        }
        break;
      }
      case 'fileSearch': {
        const fileSearchConfig = node.config as unknown as FileSearchNodeConfig;
        const stores = fileSearchConfig.vectorStoreIds;
        if (!Array.isArray(stores) || stores.length === 0) {
          errors.push({ nodeId: node.id, message: `File search '${node.name}' has no vector stores attached` });
        }
        if (fileSearchConfig.maxResults !== undefined && (!Number.isInteger(fileSearchConfig.maxResults) || fileSearchConfig.maxResults < 1 || fileSearchConfig.maxResults > 50)) {
          errors.push({ nodeId: node.id, message: `File search '${node.name}' max results must be between 1 and 50` });
        }
        if (fileSearchConfig.scoreThreshold !== undefined && (typeof fileSearchConfig.scoreThreshold !== 'number' || fileSearchConfig.scoreThreshold < 0 || fileSearchConfig.scoreThreshold > 1)) {
          errors.push({ nodeId: node.id, message: `File search '${node.name}' score threshold must be between 0 and 1` });
        }
        const policy = fileSearchConfig.executionPolicy;
        if (policy?.timeoutMs !== undefined && (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 600_000)) errors.push({ nodeId: node.id, message: `File search '${node.name}' timeout must be between 100 and 600000 ms` });
        if (policy?.maxRetries !== undefined && (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 5)) errors.push({ nodeId: node.id, message: `File search '${node.name}' maxRetries must be between 0 and 5` });
        if (policy?.retryBackoffMs !== undefined && (!Number.isInteger(policy.retryBackoffMs) || policy.retryBackoffMs < 0 || policy.retryBackoffMs > 60_000)) errors.push({ nodeId: node.id, message: `File search '${node.name}' retryBackoffMs must be between 0 and 60000` });
        break;
      }
      case 'end': {
        const outputSchema = node.config.outputSchema;
        if (outputSchema !== undefined) {
          if (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) {
            errors.push({ nodeId: node.id, message: `End '${node.name}' output schema must be an object` });
          } else {
            for (const issue of validateSchemaDefinition(outputSchema as JsonObject)) {
              errors.push({ nodeId: node.id, message: `End '${node.name}' output schema ${issue.path}: ${issue.message}` });
            }
          }
        }
        break;
      }
      case 'guardrail': {
        const guardrailConfig = node.config as unknown as GuardrailNodeConfig;
        const anyOn = ['pii', 'moderation', 'jailbreak', 'hallucination'].some(
          (k) => node.config[k] === true,
        );
        if (!anyOn) warnings.push({ nodeId: node.id, message: `Guardrails '${node.name}' has no checks enabled; it will always pass` });
        if (guardrailConfig.onTripwire !== undefined && !['branch', 'stop'].includes(guardrailConfig.onTripwire)) {
          errors.push({ nodeId: node.id, message: `Guardrails '${node.name}' has an invalid tripwire action` });
        }
        const settings = guardrailConfig.settings;
        // NaN passes ordinary range comparisons, but is not a usable
        // threshold and would silently disable every classifier tripwire.
        if (settings?.confidenceThreshold !== undefined && (typeof settings.confidenceThreshold !== 'number' || !Number.isFinite(settings.confidenceThreshold) || settings.confidenceThreshold < 0 || settings.confidenceThreshold > 1)) {
          errors.push({ nodeId: node.id, message: `Guardrails '${node.name}' confidence threshold must be between 0 and 1` });
        }
        if (settings?.piiMode !== undefined && !['block', 'mask'].includes(settings.piiMode)) {
          errors.push({ nodeId: node.id, message: `Guardrails '${node.name}' has an invalid PII action` });
        }
        if (guardrailConfig.hallucination && !settings?.hallucinationVectorStoreId) {
          errors.push({ nodeId: node.id, message: `Guardrails '${node.name}' hallucination check needs a vector store` });
        }
        if (guardrailConfig.input !== undefined && !guardrailConfig.input.trim()) {
          errors.push({ nodeId: node.id, message: `Guardrails '${node.name}' input template cannot be empty` });
        }
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
  // Agent handoffs are runtime control-flow edges just like canvas edges.
  // Include them here so a handoff-only (or mixed edge/handoff) cycle cannot
  // bypass validation and spin indefinitely outside an explicit While node.
  const dagEdges = routingEdges.filter((e) => {
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
      for (const e of routingEdges) {
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

    const canReachEnd = new Set(graph.nodes.filter((node) => node.type === 'end').map((node) => node.id));
    const reverseQueue = [...canReachEnd];
    while (reverseQueue.length) {
      const current = reverseQueue.shift()!;
      for (const edge of routingEdges) {
        if (edge.target === current && !canReachEnd.has(edge.source)) {
          canReachEnd.add(edge.source);
          reverseQueue.push(edge.source);
        }
      }
    }
    for (const node of graph.nodes) {
      if (node.type === 'note' || !reach.has(node.id)) continue;
      if (!canReachEnd.has(node.id)) {
        errors.push({ nodeId: node.id, message: `'${node.name}' cannot reach an End node` });
      }
    }
  }

  // Catch misspelled node/state/workflow variables before execution.  These
  // remain warnings because dynamic values can be supplied by future node
  // types or provider-specific extensions.
  warnUnknownReferences(graph, warnings);
  analyzeContractCompatibility(graph, errors, warnings);

  return { valid: errors.length === 0, errors, warnings, contracts: inferContracts(graph), safetyFindings: analyzeSafety(graph) };
}
