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
  SubflowNodeConfig,
  StartNodeConfig,
  TransformNodeConfig,
  UserApprovalNodeConfig,
  WhileNodeConfig,
  WorkflowNode,
} from '../../domain/types.ts';
import { ids, nowIso } from '../../util/id.ts';
import { evaluateCel, evaluateCelBool, type CelValue } from '../cel/index.ts';
import { buildScope, runResourceAccess, varNameFor, type NodeExecResult, type RunContext } from '../context.ts';
import {
  checkHallucination,
  checkJailbreak,
  checkModeration,
  checkPii,
  type GuardrailCheckResult,
} from '../guardrails/index.ts';
import { coerceToVarType, defaultForVarType, validateAgainstSchema } from '../jsonSchema.ts';
import { renderTemplate, resolveConfigValue } from '../template.ts';
import { executeAgentNode } from './agent.ts';
import { runToolWithPolicy } from '../toolExecution.ts';

// ---------------------------------------------------------------------------

async function executeStart(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as StartNodeConfig;
  const outputs: JsonObject = {
    input_as_text: typeof ctx.run.input.input_as_text === 'string'
      ? ctx.run.input.input_as_text
      : '',
    state: structuredClone(ctx.checkpoint.state),
  };

  for (const declaration of cfg.inputVariables ?? []) {
    if (!declaration.name || declaration.name === 'input_as_text') continue;
    outputs[declaration.name] = structuredClone(
      ctx.run.input.variables?.[declaration.name] ?? null,
    ) as JsonObject[string];
  }
  for (const [name, value] of Object.entries(ctx.checkpoint.state)) {
    if (name === 'input_as_text' || name === 'state' || name in outputs) continue;
    outputs[name] = structuredClone(value) as JsonObject[string];
  }

  return { outputs, nextHandle: null };
}

async function executeSubflow(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as SubflowNodeConfig;
  const scope = buildScope(ctx);
  const depth = (ctx.run.runDepth ?? 0) + 1;
  const maxDepth = cfg.maxDepth ?? 8;
  const ancestry = ctx.run.workflowAncestry ?? [ctx.run.workflowId];
  if (depth > maxDepth) throw new Error(`subflow '${node.name}' exceeded maximum depth ${maxDepth}`);
  if (ancestry.includes(cfg.workflowId)) throw new Error(`subflow '${node.name}' would recurse into workflow '${cfg.workflowId}'`);

  const checkpoint = ctx.checkpoint;
  const active = checkpoint.subflowRuns?.active;
  const idempotencyKey = `subflow:${ctx.run.id}:${node.id}:${ctx.checkpoint.inFlightNode?.startedAt ?? 'legacy'}`;
  let child = active ? await ctx.services.childRuns.get(active.childRunId) : undefined;
  if (!child) {
    const input: import('../../domain/types.ts').RunInput = {};
    for (const mapping of cfg.inputMappings ?? []) {
      const value = resolveConfigValue(mapping.value, scope) as JsonValue;
      if (mapping.target === 'input_as_text') input.input_as_text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
      else if (mapping.target.startsWith('variables.')) {
        input.variables ??= {};
        input.variables[mapping.target.slice('variables.'.length)] = value as JsonObject[string];
      } else if (mapping.target.startsWith('state_variables.')) {
        input.state_variables ??= {};
        input.state_variables[mapping.target.slice('state_variables.'.length)] = value as JsonObject[string];
      } else throw new Error(`subflow '${node.name}' has unsupported input mapping target '${mapping.target}'`);
    }
    child = await ctx.services.childRuns.create({
      workflowId: cfg.workflowId,
      version: cfg.version,
      input,
      requestKeys: ctx.services.requestKeys,
      idempotencyKey,
      ownerId: ctx.run.ownerId,
      workspaceId: ctx.run.workspaceId,
      parentRunId: ctx.run.id,
      parentNodeId: node.id,
      rootRunId: ctx.run.rootRunId ?? ctx.run.id,
      runDepth: depth,
      workflowAncestry: [...ancestry, cfg.workflowId],
      debug: cfg.debug,
    });
    checkpoint.subflowRuns ??= {};
    checkpoint.subflowRuns.active = { childRunId: child.id, nodeId: node.id };
    ctx.run.childRunIds = [...new Set([...(ctx.run.childRunIds ?? []), child.id])];
    ctx.run.checkpoint = ctx.checkpoint as unknown as JsonObject;
    await ctx.services.storage.put('runs', ctx.run.id, ctx.run, ctx.run.workflowId);
    await ctx.emit({ type: 'subflow.started', runId: ctx.run.id, nodeId: node.id, childRunId: child.id, workflowId: cfg.workflowId, workflowVersion: cfg.version, at: nowIso() });
  }

  for (;;) {
    if (ctx.abortSignal.aborted) {
      await ctx.services.childRuns.cancel(child.id);
      return {};
    }
    if (child.status === 'awaiting_credentials') {
      try {
        child = await ctx.services.childRuns.resume(child.id, ctx.services.requestKeys);
      } catch {
        const current = await ctx.services.childRuns.get(child.id);
        const paused = current ?? child;
        const nested = paused.nestedWait;
        return {
          nestedWait: {
            wait: {
              version: 1,
              kind: 'subflow',
              parentNodeId: node.id,
              childRunId: child.id,
              leafRunId: nested?.leafRunId ?? child.id,
              leafStatus: 'awaiting_credentials',
              observedAt: nowIso(),
            },
            credentialRequirements: paused.credentialRequirements ?? { providers: [] },
          },
        };
      }
      continue;
    }
    if (child.status === 'awaiting_approval' || child.status === 'awaiting_client_tool' || child.status === 'awaiting_debug') {
      const nested = child.nestedWait;
      const leafRunId = nested?.leafRunId ?? child.id;
      const leafStatus = nested?.leafStatus ?? child.status;
      const leafApprovalId = nested?.leafApprovalId ?? child.pendingApproval?.id;
      const pending = child.pendingApproval ? {
        ...structuredClone(child.pendingApproval),
        runId: ctx.run.id,
        nodeId: node.id,
        nested: {
          childRunId: child.id,
          leafRunId,
          leafApprovalId: leafApprovalId ?? child.pendingApproval.id,
          leafNodeId: child.pendingApproval.nested?.leafNodeId ?? child.pendingApproval.nodeId,
        },
      } : undefined;
      return {
        nestedWait: {
          wait: { version: 1, kind: 'subflow', parentNodeId: node.id, childRunId: child.id, leafRunId, leafStatus, ...(leafApprovalId ? { leafApprovalId } : {}), observedAt: nowIso() },
          pendingApproval: pending,
          debugPause: child.debugPause ? { ...structuredClone(child.debugPause), nodeId: node.id } : undefined,
        },
      };
    }
    if (child.status === 'completed' || child.status === 'failed' || child.status === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
    child = (await ctx.services.childRuns.get(child.id)) ?? child;
  }
  if (child.status !== 'completed') throw new Error(`subflow child run '${child.id}' ${child.status}${child.error ? `: ${child.error}` : ''}`);
  const childScope = {
    ...scope,
    child: {
      output: child.output ?? null,
      output_text: typeof child.output === 'string' ? child.output : JSON.stringify(child.output ?? null),
      state: child.state ?? {},
      status: child.status,
      run_id: child.id,
    },
  };
  const outputs: JsonObject = {
    output: child.output ?? null,
    output_text: typeof child.output === 'string' ? child.output : JSON.stringify(child.output ?? null),
    state: child.state ?? {},
    child_run_id: child.id,
    status: child.status,
  };
  for (const mapping of cfg.outputMappings ?? []) {
    const resolved = resolveConfigValue(mapping.expression, childScope) as JsonValue;
    try {
      // Output mappings declare a contract just like Start/Transform/State
      // variables. Coerce here so downstream nodes receive the declared type
      // rather than an incidental provider/template representation.
      outputs[mapping.name] = coerceToVarType(resolved, mapping.type) as JsonObject[string];
    } catch (error) {
      throw new Error(`subflow '${node.name}' output mapping '${mapping.name}' failed type coercion to ${mapping.type}: ${(error as Error).message}`);
    }
  }
  if (checkpoint.subflowRuns) delete checkpoint.subflowRuns.active;
  await ctx.emit({ type: 'subflow.completed', runId: ctx.run.id, nodeId: node.id, childRunId: child.id, status: child.status, output: child.output, at: nowIso() });
  return { outputs, nextHandle: null };
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
  if (cfg.outputSchema) {
    const issues = validateAgainstSchema(output, cfg.outputSchema);
    if (issues.length) {
      throw new Error(
        `End '${node.name}' output failed schema validation: ` +
        issues.slice(0, 5).map((issue) => `${issue.path} ${issue.message}`).join('; '),
      );
    }
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
    const reason = typeof resume.reason === 'string' ? resume.reason : '';
    return {
      outputs: { approved, reason },
      nextHandle: approved ? 'approved' : 'rejected',
    };
  }
  const scope = buildScope(ctx);
  const message = renderTemplate(cfg.message || 'Approve to continue?', scope);
  return {
    pause: { kind: 'user_approval', message, timeoutMs: cfg.timeoutMs },
  };
}

async function executeFileSearch(node: WorkflowNode, ctx: RunContext): Promise<NodeExecResult> {
  const cfg = node.config as unknown as FileSearchNodeConfig;
  const scope = buildScope(ctx);
  const query = renderTemplate(cfg.query || '{{workflow.input_as_text}}', scope);
  const keys = ctx.services.requestKeys ?? ctx.services.storedKeys;
  const policy = cfg.executionPolicy ?? {};
  const callId = ids.toolCall();
  const executed = await runToolWithPolicy({
    signal: ctx.abortSignal,
    timeoutMs: policy.timeoutMs ?? 60_000,
    maxRetries: policy.maxRetries ?? 0,
    retryBackoffMs: policy.retryBackoffMs ?? 250,
    onAttempt: async (attempt, maxAttempts) => {
      ctx.addUsage({ toolCalls: 1 });
      await ctx.emit({ type: 'tool.started', runId: ctx.run.id, nodeId: node.id, tool: 'file_search', callId, args: { query }, attempt, maxAttempts, at: nowIso() });
    },
    onRetry: async (attempt, error, delayMs) => {
      await ctx.emit({ type: 'tool.retrying', runId: ctx.run.id, nodeId: node.id, tool: 'file_search', callId, attempt, error: error.message, delayMs, at: nowIso() });
    },
    execute: (signal) => ctx.services.vectorStores.search(cfg.vectorStoreIds ?? [], query, keys, {
      maxResults: cfg.maxResults ?? 8,
      scoreThreshold: cfg.scoreThreshold,
      signal,
      onEmbeddingUsage: (usage) => ctx.addEmbeddingUsage(usage),
    }, { subjectId: ctx.run.ownerId ?? 'default', workspaceId: ctx.run.workspaceId ?? 'default', role: 'viewer' }),
  }).catch(async (error) => {
    const attempts = Number((error as Error & { toolAttempts?: number }).toolAttempts ?? 1);
    await ctx.emit({ type: 'tool.failed', runId: ctx.run.id, nodeId: node.id, tool: 'file_search', callId, error: (error as Error).message, attempts, at: nowIso() });
    throw error;
  });
  const results = executed.value;
  const simplified = results.map((r) => ({
    fileId: r.fileId,
    filename: r.filename,
    chunkIndex: r.chunkIndex,
    score: Math.round(r.score * 1000) / 1000,
    text: r.text,
    citation: { fileId: r.fileId, filename: r.filename, chunkIndex: r.chunkIndex },
  }));
  await ctx.emit({ type: 'tool.completed', runId: ctx.run.id, nodeId: node.id, tool: 'file_search', callId, result: simplified as unknown as JsonValue, attempts: executed.attempts, at: nowIso() });
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
    abortSignal: ctx.abortSignal,
  };

  const checks: Promise<GuardrailCheckResult>[] = [];
  if (cfg.pii) checks.push(Promise.resolve(checkPii(text, cfg.settings)));
  if (cfg.moderation) checks.push(checkModeration(text, cfg.settings, guardCtx));
  if (cfg.jailbreak) checks.push(checkJailbreak(text, cfg.settings, guardCtx));
  if (cfg.hallucination) checks.push(checkHallucination(text, cfg.settings, guardCtx));

  const results = await Promise.all(checks);
  for (const result of results) {
    if (result.usage) ctx.addUsage(result.usage);
  }

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
    // Classifier diagnostics are provider-controlled text. Redact configured
    // secrets before putting them into the durable guardrail event/trace; a
    // provider may echo input or an authorization token in its explanation.
    const resolvedSecrets = await ctx.services.secrets.resolveForRun(ctx.run);
    const safeInfo = resolvedSecrets.redact(r.info) as JsonObject;
    resultsObj[r.check] = {
      tripwireTriggered: r.tripwireTriggered,
      confidence: r.confidence ?? null,
      ...(r.errored ? { error: resolvedSecrets.redact(r.error ?? 'check failed') } : {}),
      info: safeInfo,
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

  if (!passed && cfg.onTripwire === 'stop') {
    throw new Error(`Guardrails '${node.name}' tripwire triggered: ${triggered.map((result) => result.check).join(', ')}`);
  }

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
  const requiresApproval = cfg.requireApproval === 'always' || ctx.run.workflowVersion > 0;
  if (requiresApproval && !resume) {
    return {
      pause: {
        kind: 'mcp_tool',
        message: `Call MCP tool '${cfg.tool}'?`,
        toolCall: { server: cfg.serverId, tool: cfg.tool, arguments: args },
        timeoutMs: cfg.approvalTimeoutMs,
      },
    };
  }
  if (resume && resume.decision === 'rejected') {
    return {
      outputs: {
        approved: false,
        reason: typeof resume.reason === 'string' ? resume.reason : '',
        result: null,
        output_text: '',
      },
      nextHandle: null,
    };
  }

  const policy = cfg.executionPolicy ?? {};
  const callId = ids.toolCall();
  try {
    const executed = await runToolWithPolicy({
      signal: ctx.abortSignal,
      timeoutMs: policy.timeoutMs ?? 300_000,
      maxRetries: policy.maxRetries ?? 0,
      retryBackoffMs: policy.retryBackoffMs ?? 250,
      onAttempt: async (attempt, maxAttempts) => {
        ctx.addUsage({ toolCalls: 1 });
        await ctx.emit({ type: 'tool.started', runId: ctx.run.id, nodeId: node.id, tool: cfg.tool, callId, args, attempt, maxAttempts, at: nowIso() });
      },
      onRetry: async (attempt, error, delayMs) => {
        await ctx.emit({ type: 'tool.retrying', runId: ctx.run.id, nodeId: node.id, tool: cfg.tool, callId, attempt, error: error.message, delayMs, at: nowIso() });
      },
      execute: (signal) => ctx.services.mcp.callTool(cfg.serverId, cfg.tool, args, {
        signal,
        timeoutMs: policy.timeoutMs ?? 300_000,
        retryTransport: false,
        access: runResourceAccess(ctx.run),
      }),
    });
    const result = executed.value;
    await ctx.emit({
      type: 'tool.completed', runId: ctx.run.id, nodeId: node.id,
      tool: cfg.tool, callId, result, attempts: executed.attempts, at: nowIso(),
    });
    return {
      outputs: {
        result: result as JsonObject[string],
        output_text: typeof result === 'string' ? result : JSON.stringify(result),
      },
      nextHandle: null,
    };
  } catch (e) {
    const attempts = Number((e as Error & { toolAttempts?: number }).toolAttempts ?? 1);
    await ctx.emit({ type: 'tool.failed', runId: ctx.run.id, nodeId: node.id, tool: cfg.tool, callId, error: (e as Error).message, attempts, at: nowIso() });
    throw e;
  }
}

// ---------------------------------------------------------------------------

export type NodeExecutor = (node: WorkflowNode, ctx: RunContext) => Promise<NodeExecResult>;

export const NODE_EXECUTORS: Record<string, NodeExecutor> = {
  start: executeStart,
  subflow: executeSubflow,
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
