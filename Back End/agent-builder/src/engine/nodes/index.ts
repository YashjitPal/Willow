/**
 * Node executor registry — every node type except `agent` (see agent.ts).
 */

import type {
  EndNodeConfig,
  FileSearchNodeConfig,
  GuardrailNodeConfig,
  IfElseNodeConfig,
  JsonObject,
  JsonValue,
  McpNodeConfig,
  SetStateNodeConfig,
  StartNodeConfig,
  TransformNodeConfig,
  UserApprovalNodeConfig,
  WhileNodeConfig,
  WorkflowNode,
} from '../../domain/types.ts';
import { nowIso } from '../../util/id.ts';
import { evaluateCel, evaluateCelBool, type CelValue } from '../cel/index.ts';
import { buildScope, varNameFor, type NodeExecResult, type RunContext } from '../context.ts';
import {
  checkHallucination,
  checkJailbreak,
  checkModeration,
  checkPii,
  type GuardrailCheckResult,
} from '../guardrails/index.ts';
import { coerceToVarType, defaultForVarType } from '../jsonSchema.ts';
import { renderTemplate, resolveConfigValue } from '../template.ts';
import { executeAgentNode } from './agent.ts';

// ---------------------------------------------------------------------------

async function executeStart(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  // State initialization happens in the executor before the loop; Start is a
  // pass-through at runtime.
  return { nextHandle: null };
}

async function executeEnd(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as EndNodeConfig;
  const scope = buildScope(ctx);
  let output: JsonValue;
  if (cfg.output !== undefined && cfg.output !== null && cfg.output !== '') {
    output = resolveConfigValue(cfg.output, scope) as JsonValue;
  } else {
    output = ctx.checkpoint.lastAgentText || null;
  }
  return { finalOutput: output, terminal: true };
}

async function executeNote(): Promise<NodeExecResult> {
  return { nextHandle: null };
}

async function executeIfElse(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as IfElseNodeConfig;
  const scope = buildScope(ctx);
  for (const branch of cfg.branches ?? []) {
    const cond = (branch.condition ?? '').trim();
    if (!cond) continue;
    if (evaluateCelBool(cond, scope)) {
      return {
        outputs: { matched: branch.label ?? branch.id },
        nextHandle: branch.id,
      };
    }
  }
  return { outputs: { matched: 'else' }, nextHandle: 'else' };
}

/** Node ids inside a While node's body (reachable from its 'loop' edge without passing through the While node itself). */
function whileBodyNodes(ctx: RunContext, whileId: string): Set<string> {
  const body = new Set<string>();
  const loopEdge = ctx.graph.edges.find(
    (e) => e.source === whileId && e.sourceHandle === 'loop',
  );
  if (!loopEdge) return body;
  const queue = [loopEdge.target];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === whileId || body.has(cur)) continue;
    body.add(cur);
    for (const e of ctx.graph.edges) {
      if (e.source === cur) queue.push(e.target);
    }
  }
  return body;
}

async function executeWhile(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as WhileNodeConfig;
  const scope = buildScope(ctx);
  const max = cfg.maxIterations ?? ctx.services.config.defaultMaxIterations;
  const counters = ctx.checkpoint.whileCounters;

  // Fresh entry (arriving from outside the loop body) restarts the counter —
  // a previous pass may have exited the body via a branch that bypassed this
  // node, leaving a stale count behind.
  const cameFrom = ctx.checkpoint.lastNodeId;
  if (counters[node.id] !== undefined && (!cameFrom || !whileBodyNodes(ctx, node.id).has(cameFrom))) {
    delete counters[node.id];
  }

  const done = () => {
    const iterations = counters[node.id] ?? 0;
    delete counters[node.id]; // reset for potential outer re-entry
    return {
      outputs: { iterations },
      nextHandle: 'done',
    } satisfies NodeExecResult;
  };

  const current = counters[node.id] ?? 0;
  if (current >= max) {
    if ((cfg.onMaxIterations ?? 'fail') === 'break') return done();
    throw new Error(
      `While '${node.name}' exceeded maxIterations (${max}). ` +
      `Increase the cap or set onMaxIterations to 'break'.`,
    );
  }

  const condition = evaluateCelBool((cfg.condition ?? 'false').trim() || 'false', scope);
  if (!condition) return done();

  counters[node.id] = current + 1;
  return { outputs: { iterations: counters[node.id] }, nextHandle: 'loop' };
}

async function executeTransform(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as TransformNodeConfig;
  const scope = buildScope(ctx);
  const outputs: JsonObject = {};
  for (const field of cfg.outputs ?? []) {
    if (!field.name) continue;
    const raw = evaluateCel(field.expression, scope);
    outputs[field.name] = coerceToVarType(raw as JsonValue, field.type) as JsonObject[string];
  }
  return { outputs, nextHandle: null };
}

async function executeSetState(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as SetStateNodeConfig;
  const start = ctx.graph.nodes.find((n) => n.type === 'start');
  const decls = ((start?.config ?? {}) as unknown as StartNodeConfig).stateVariables ?? [];
  const declByName = new Map(decls.map((d) => [d.name, d]));

  const scope = buildScope(ctx);
  const updates: JsonObject = {};
  for (const a of cfg.assignments ?? []) {
    if (!a.name) continue;
    const decl = declByName.get(a.name);
    const raw = evaluateCel(a.expression, scope) as JsonValue;
    updates[a.name] = (decl ? coerceToVarType(raw, decl.type) : raw) as JsonObject[string];
    // update scope so later assignments in the same node see the new value
    (scope.state as Record<string, CelValue>)[a.name] = updates[a.name] as CelValue;
  }
  Object.assign(ctx.checkpoint.state, updates);

  await ctx.emit({
    type: 'state.updated',
    runId: ctx.run.id,
    nodeId: node.id,
    state: structuredClone(ctx.checkpoint.state),
    at: nowIso(),
  });
  return { outputs: { updated: Object.keys(updates) }, nextHandle: null };
}

async function executeUserApproval(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as UserApprovalNodeConfig;
  const resume = ctx.takeResume();
  if (resume && (resume.decision === 'approved' || resume.decision === 'rejected')) {
    const approved = resume.decision === 'approved';
    return {
      outputs: { approved },
      nextHandle: approved ? 'approved' : 'rejected',
    };
  }
  const scope = buildScope(ctx);
  const message = renderTemplate(cfg.message || 'Approve to continue?', scope);
  return {
    pause: { kind: 'user_approval', message },
  };
}

async function executeFileSearch(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as FileSearchNodeConfig;
  const scope = buildScope(ctx);
  const query = renderTemplate(cfg.query || '{{workflow.input_as_text}}', scope);
  const keys = ctx.services.requestKeys ?? ctx.services.storedKeys;
  const results = await ctx.services.vectorStores.search(cfg.vectorStoreIds ?? [], query, keys, {
    maxResults: cfg.maxResults ?? 8,
    scoreThreshold: cfg.scoreThreshold,
  });
  const simplified = results.map((r) => ({
    filename: r.filename,
    score: Math.round(r.score * 1000) / 1000,
    text: r.text,
  }));
  return {
    outputs: {
      results: simplified as unknown as JsonObject[string],
      output_text: simplified.map((r) => r.text).join('\n\n'),
      query,
    },
    nextHandle: null,
  };
}

async function executeGuardrail(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as GuardrailNodeConfig;
  const scope = buildScope(ctx);
  const inputTemplate = cfg.input || '{{workflow.input_as_text}}';
  let text: string;
  try {
    text = renderTemplate(inputTemplate, scope);
  } catch (e) {
    throw new Error(`Guardrails '${node.name}' input template failed: ${(e as Error).message}`);
  }

  const guardCtx = {
    keys: ctx.services.requestKeys,
    storedKeys: ctx.services.storedKeys,
    vectorStores: ctx.services.vectorStores,
    checkModel: cfg.settings?.checkModel || 'gemini-3-flash',
  };

  const checks: Promise<GuardrailCheckResult>[] = [];
  if (cfg.pii) checks.push(Promise.resolve(checkPii(text, cfg.settings)));
  if (cfg.moderation) checks.push(checkModeration(text, cfg.settings, guardCtx));
  if (cfg.jailbreak) checks.push(checkJailbreak(text, cfg.settings, guardCtx));
  if (cfg.hallucination) checks.push(checkHallucination(text, cfg.settings, guardCtx));

  const results = await Promise.all(checks);

  // Errored checks: fail-secure unless continueOnError.
  const errored = results.filter((r) => r.errored);
  if (errored.length && !cfg.continueOnError) {
    throw new Error(
      `Guardrails '${node.name}' could not run: ` +
      errored.map((r) => `${r.check}: ${r.error}`).join('; '),
    );
  }

  const triggered = results.filter((r) => r.tripwireTriggered);
  const passed = triggered.length === 0;

  // PII masking rewrites the checked text on pass — including occurrences
  // already recorded in the conversation history, so downstream agents with
  // includeChatHistory never see the raw values.
  let outputText = text;
  let masked = false;
  for (const r of results) {
    if (r.maskedText) {
      outputText = r.maskedText;
      masked = true;
    }
  }
  if (masked && text) {
    for (const h of ctx.checkpoint.history) {
      if (h.content.includes(text)) {
        h.content = h.content.split(text).join(outputText);
      }
    }
  }

  const resultsObj: JsonObject = {};
  for (const r of results) {
    resultsObj[r.check] = {
      tripwireTriggered: r.tripwireTriggered,
      confidence: r.confidence ?? null,
      ...(r.errored ? { error: r.error ?? 'check failed' } : {}),
      info: r.info,
    } as JsonObject[string];
  }

  await ctx.emit({
    type: 'guardrail.result',
    runId: ctx.run.id,
    nodeId: node.id,
    passed,
    results: resultsObj,
    at: nowIso(),
  });

  return {
    outputs: {
      passed,
      output_text: outputText,
      results: resultsObj as JsonObject[string],
      triggered: triggered.map((t) => t.check) as unknown as JsonObject[string],
    },
    nextHandle: passed ? 'pass' : 'fail',
  };
}

async function executeMcpNode(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as McpNodeConfig;
  const scope = buildScope(ctx);
  const args = resolveConfigValue(cfg.arguments ?? {}, scope) as JsonObject;

  const resume = ctx.takeResume();
  if (cfg.requireApproval === 'always' && !resume) {
    return {
      pause: {
        kind: 'mcp_tool',
        message: `Call MCP tool '${cfg.tool}'?`,
        toolCall: { server: cfg.serverId, tool: cfg.tool, arguments: args },
      },
    };
  }
  if (resume && resume.decision === 'rejected') {
    return {
      outputs: { approved: false, result: null, output_text: '' },
      nextHandle: null,
    };
  }

  await ctx.emit({
    type: 'tool.started', runId: ctx.run.id, nodeId: node.id,
    tool: cfg.tool, args, at: nowIso(),
  });
  try {
    const result = await ctx.services.mcp.callTool(cfg.serverId, cfg.tool, args);
    ctx.addUsage({ toolCalls: 1 });
    await ctx.emit({
      type: 'tool.completed', runId: ctx.run.id, nodeId: node.id,
      tool: cfg.tool, result, at: nowIso(),
    });
    return {
      outputs: {
        result: result as JsonObject[string],
        output_text: typeof result === 'string' ? result : JSON.stringify(result),
      },
      nextHandle: null,
    };
  } catch (e) {
    if (cfg.continueOnError) {
      await ctx.emit({
        type: 'tool.completed', runId: ctx.run.id, nodeId: node.id,
        tool: cfg.tool, result: `error: ${(e as Error).message}`, at: nowIso(),
      });
      return {
        outputs: { result: null, output_text: '', error: (e as Error).message },
        nextHandle: null,
      };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------

export type NodeExecutor = (node: WorkflowNode, ctx: RunContext) => Promise<NodeExecResult>;

export const NODE_EXECUTORS: Record<string, NodeExecutor> = {
  start: executeStart,
  agent: executeAgentNode,
  end: executeEnd,
  note: executeNote,
  ifElse: executeIfElse,
  while: executeWhile,
  transform: executeTransform,
  setState: executeSetState,
  userApproval: executeUserApproval,
  fileSearch: executeFileSearch,
  guardrail: executeGuardrail,
  mcp: executeMcpNode,
};

/** Initial state variable values for a run (declarations + overrides). */
export function initialState(
  graph: { nodes: WorkflowNode[] },
  overrides: JsonObject | undefined,
): JsonObject {
  const start = graph.nodes.find((n) => n.type === 'start');
  const decls = ((start?.config ?? {}) as unknown as StartNodeConfig).stateVariables ?? [];
  const state: JsonObject = {};
  for (const d of decls) {
    let value: JsonValue =
      d.initialValue !== undefined && d.initialValue !== null
        ? d.initialValue
        : defaultForVarType(d.type);
    if (overrides && d.name in overrides) {
      value = overrides[d.name];
    }
    state[d.name] = coerceToVarType(value, d.type) as JsonObject[string];
  }
  return state;
}
