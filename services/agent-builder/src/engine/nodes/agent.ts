/**
 * Agent node executor: one full agent loop — instructions + history + tools,
 * iterating model <-> tool calls until a final answer (or maxTurns).
 *
 * Supports pausing mid-loop for MCP tool approval and client-executed tools:
 * the entire loop state (messages, pending calls, collected results, turn
 * counter) is serialized into the pause's resumeState and reconstructed on
 * resume.
 */

import type {
  AgentNodeConfig,
  AgentHandoff,
  AgentTool,
  ChatMessage,
  FunctionTool,
  JsonObject,
  JsonValue,
  WorkflowNode,
} from '../../domain/types.ts';
import { chatWithModel, getProvider, providerForModel, unsupportedInputAttachmentKinds, type LLMInputAttachment, type LLMMessage, type LLMRequest, type LLMToolCall, type LLMToolDef } from '../../providers/index.ts';
import { runFunctionCode, runInterpreterCode } from '../../tools/sandbox.ts';
import { webSearch } from '../../tools/webSearch.ts';
import { assertSafeOutboundUrl } from '../../http/outboundUrl.ts';
import { nowIso } from '../../util/id.ts';
import { buildScope, runResourceAccess, varNameFor, type NodeExecResult, type RunContext } from '../context.ts';
import { extractJson, validateAgainstSchema } from '../jsonSchema.ts';
import { renderTemplate } from '../template.ts';
import { runToolWithPolicy } from '../toolExecution.ts';
import { compactMessagesForInputBudget, type InputCompactionMetadata } from '../inputBudget.ts';

interface ToolBinding {
  def: LLMToolDef;
  kind: 'web_search' | 'file_search' | 'code_interpreter' | 'function_js' | 'function_http' | 'client' | 'mcp' | 'custom_js' | 'handoff';
  tool: AgentTool;
  handoff?: AgentHandoff;
  /** For mcp bindings. */
  serverId?: string;
  mcpToolName?: string;
  requireApproval?: boolean;
}

function traceMessageSummary(messages: LLMMessage[]): JsonObject[] {
  return messages.map((message) => ({
    role: message.role,
    contentCharacters: message.content.length,
    ...(message.role === 'user' && message.attachments?.length ? {
      attachments: message.attachments.map((attachment) => ({
        name: attachment.name,
        mimeType: attachment.mimeType,
        kind: attachment.kind ?? null,
        encodedBytes: attachment.dataBase64.length,
      })) as unknown as JsonObject[string],
    } : {}),
    ...(message.role === 'assistant' && message.toolCalls?.length ? {
      toolCalls: message.toolCalls.map((call) => ({ id: call.id, name: call.name })) as unknown as JsonObject[string],
    } : {}),
    ...(message.role === 'tool' ? { toolCallId: message.toolCallId, name: message.name } : {}),
  }));
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'tool';
}

async function buildToolBindings(
  ctx: RunContext,
  cfg: AgentNodeConfig,
): Promise<ToolBinding[]> {
  const bindings: ToolBinding[] = [];
  const used = new Set<string>();
  const unique = (name: string): string => {
    let n = sanitizeToolName(name);
    let k = 2;
    while (used.has(n)) n = `${sanitizeToolName(name)}_${k++}`;
    used.add(n);
    return n;
  };

  for (const tool of cfg.tools ?? []) {
    switch (tool.kind) {
      case 'web_search':
        bindings.push({
          kind: 'web_search',
          tool,
          def: {
            name: unique('web_search'),
            description: 'Search the web. Returns a list of results with title, url and snippet.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string', description: 'The search query' } },
              required: ['query'],
            },
          },
        });
        break;
      case 'file_search':
        bindings.push({
          kind: 'file_search',
          tool,
          def: {
            name: unique('file_search'),
            description:
              'Search the attached knowledge base (vector stores) for relevant passages.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string', description: 'The search query' } },
              required: ['query'],
            },
          },
        });
        break;
      case 'code_interpreter':
        bindings.push({
          kind: 'code_interpreter',
          tool,
          def: {
            name: unique('run_code'),
            description:
              'Execute JavaScript code in a sandbox and return the result. ' +
              'The last expression (or console output) is returned. No network or filesystem access. ' +
              (tool.files?.length
                ? `Attached files: ${tool.files.map((file) => file.name).join(', ')}. Use listFiles() and readFile(name).`
                : 'No files are attached.'),
            parameters: {
              type: 'object',
              properties: { code: { type: 'string', description: 'JavaScript code to run' } },
              required: ['code'],
            },
          },
        });
        break;
      case 'function': {
        const fn = tool as FunctionTool;
        const kind =
          fn.execution.mode === 'js' ? 'function_js'
          : fn.execution.mode === 'http' ? 'function_http'
          : 'client';
        bindings.push({
          kind,
          tool,
          def: {
            name: unique(fn.name || 'function'),
            description: fn.description,
            parameters: fn.parameters ?? { type: 'object', properties: {} },
          },
        });
        break;
      }
      case 'custom': {
        bindings.push({
          kind: tool.code ? 'custom_js' : 'client',
          tool,
          def: {
            name: unique(tool.name || 'custom_tool'),
            description: tool.description,
            parameters: {
              type: 'object',
              properties: { input: { type: 'string', description: 'Tool input' } },
              required: ['input'],
            },
          },
        });
        break;
      }
      case 'mcp': {
        const access = runResourceAccess(ctx.run);
        const reg = await ctx.services.mcp.get(tool.serverId, access);
        if (!reg) {
          throw new Error(`agent references unknown MCP server '${tool.serverId}'`);
        }
        let tools = reg.tools ?? [];
        if (!tools.length) {
          tools = await ctx.services.mcp.listTools(tool.serverId, false, access);
        }
        const allowed = tool.allowedTools?.length ? new Set(tool.allowedTools) : null;
        for (const t of tools) {
          if (allowed && !allowed.has(t.name)) continue;
          bindings.push({
            kind: 'mcp',
            tool,
            serverId: tool.serverId,
            mcpToolName: t.name,
            // Published runs enforce approval even for stale versions created
            // before release-time safety validation existed.
            requireApproval: tool.requireApproval === 'always' || ctx.run.workflowVersion > 0,
            def: {
              name: unique(`${reg.label}__${t.name}`),
              description: t.description ?? `Tool ${t.name} on MCP server ${reg.label}`,
              parameters: t.inputSchema ?? { type: 'object', properties: {} },
            },
          });
        }
        break;
      }
      default:
        break;
    }
  }
  for (const handoff of cfg.handoffs ?? []) {
    const target = ctx.graph.nodes.find((candidate) => candidate.id === handoff.targetNodeId);
    if (!target) throw new Error(`agent handoff references unknown target '${handoff.targetNodeId}'`);
    const targetLabel = target.name || target.id;
    const name = unique(handoff.toolName || `transfer_to_${targetLabel}`);
    bindings.push({
      kind: 'handoff',
      tool: handoff as unknown as AgentTool,
      handoff,
      def: {
        name,
        description: handoff.description || `Transfer control to specialist '${targetLabel}'.`,
        parameters: {
          type: 'object',
          properties: { reason: { type: 'string', description: 'Why this specialist should handle the next turn.' } },
          additionalProperties: false,
        },
      },
    });
  }
  return bindings;
}

async function executeBinding(
  ctx: RunContext,
  binding: ToolBinding,
  args: JsonObject,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<JsonValue> {
  const keys = ctx.services.requestKeys ?? ctx.services.storedKeys;
  switch (binding.kind) {
    case 'web_search': {
      const t = binding.tool as Extract<AgentTool, { kind: 'web_search' }>;
      const query = typeof args.query === 'string' ? args.query : JSON.stringify(args);
      const results = await webSearch(query, keys, t.maxResults ?? 5, signal);
      return results as unknown as JsonValue;
    }
    case 'file_search': {
      const t = binding.tool as Extract<AgentTool, { kind: 'file_search' }>;
      const query = typeof args.query === 'string' ? args.query : JSON.stringify(args);
      const results = await ctx.services.vectorStores.search(t.vectorStoreIds, query, keys, {
        maxResults: t.maxResults ?? 8,
        scoreThreshold: t.scoreThreshold,
        signal,
        onEmbeddingUsage: (usage) => ctx.addEmbeddingUsage(usage),
      }, { subjectId: ctx.run.ownerId ?? 'default', workspaceId: ctx.run.workspaceId ?? 'default', role: 'viewer' });
      return results.map((r) => ({
        fileId: r.fileId,
        filename: r.filename,
        chunkIndex: r.chunkIndex,
        score: Math.round(r.score * 1000) / 1000,
        text: r.text,
        citation: { fileId: r.fileId, filename: r.filename, chunkIndex: r.chunkIndex },
      })) as unknown as JsonValue;
    }
    case 'code_interpreter': {
      const t = binding.tool as Extract<AgentTool, { kind: 'code_interpreter' }>;
      const code = typeof args.code === 'string' ? args.code : '';
      const { result, logs } = await runInterpreterCode(code, timeoutMs, t.files ?? [], signal);
      return logs.length ? ({ result, logs } as unknown as JsonValue) : result;
    }
    case 'function_js': {
      const fn = binding.tool as FunctionTool;
      if (fn.execution.mode !== 'js') throw new Error('mismatched execution mode');
      const { result } = await runFunctionCode(fn.execution.code, args, timeoutMs, signal);
      return result;
    }
    case 'custom_js': {
      const t = binding.tool as Extract<AgentTool, { kind: 'custom' }>;
      const { result } = await runFunctionCode(t.code ?? '', args, timeoutMs, signal);
      return result;
    }
    case 'function_http': {
      const fn = binding.tool as FunctionTool;
      if (fn.execution.mode !== 'http') throw new Error('mismatched execution mode');
      const secrets = await ctx.services.secrets.resolveForRun(ctx.run);
      const scope = buildScope(ctx);
      const render = (template: string) => secrets.render(template, (protectedTemplate) => renderTemplate(protectedTemplate, scope));
      const url = render(fn.execution.url);
      const headers = Object.fromEntries(Object.entries(fn.execution.headers ?? {}).map(([name, value]) => {
        const rendered = render(value);
        // Fetch headers are ByteStrings. Percent-encode only values containing
        // characters outside that range so arbitrary secret text remains usable.
        return [name, [...rendered].some((char) => char.codePointAt(0)! > 255) ? encodeURIComponent(rendered) : rendered];
      }));
      try {
        const safeUrl = await assertSafeOutboundUrl(url, ctx.services.config.allowPrivateNetworks);
        const res = await fetch(safeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(args),
          signal,
          // Never forward user-configured headers or URL secrets to a redirect target.
          redirect: 'error',
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`function endpoint HTTP ${res.status}: ${secrets.redact(text).slice(0, 400)}`);
        try {
          return secrets.redact(JSON.parse(text) as JsonValue);
        } catch {
          return secrets.redact(text);
        }
      } catch (error) {
        throw new Error(secrets.redact((error as Error).message));
      }
    }
    case 'mcp': {
      return ctx.services.mcp.callTool(binding.serverId!, binding.mcpToolName!, args, {
        signal,
        timeoutMs,
        retryTransport: false,
        access: runResourceAccess(ctx.run),
      });
    }
    default:
      throw new Error(`tool kind '${binding.kind}' cannot be executed server-side`);
  }
}

function defaultToolTimeout(binding: ToolBinding): number {
  if (binding.kind === 'client') return 0;
  if (binding.kind === 'web_search') return 20_000;
  if (binding.kind === 'file_search' || binding.kind === 'function_http') return 60_000;
  if (binding.kind === 'mcp') return 300_000;
  return 5_000;
}

function toolPolicy(binding: ToolBinding) {
  const policy = binding.tool.executionPolicy ?? {};
  const legacyTimeout = binding.tool.kind === 'code_interpreter' ? binding.tool.timeoutMs : undefined;
  return {
    timeoutMs: policy.timeoutMs ?? legacyTimeout ?? defaultToolTimeout(binding),
    maxRetries: policy.maxRetries ?? 0,
    retryBackoffMs: policy.retryBackoffMs ?? 250,
    timeoutBehavior: policy.timeoutBehavior ?? 'error_as_result',
  };
}

function normalizeBindingResult(binding: ToolBinding, value: JsonValue): JsonValue {
  if (binding.tool.kind !== 'custom' || binding.tool.format !== 'json') return value;
  if (typeof value !== 'string') return value;
  try {
    return extractJson(value);
  } catch (error) {
    throw new Error(`custom tool '${binding.def.name}' expected JSON output: ${(error as Error).message}`);
  }
}

function toolResultToString(v: JsonValue): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 0) ?? 'null';
}

/** Serialized agent-loop state for pause/resume. */
interface AgentLoopState {
  messages: LLMMessage[];
  turn: number;
  toolChoiceSatisfied?: boolean;
  /** Pending tool-call batch being processed. */
  batch?: {
    calls: LLMToolCall[];
    index: number;
    results: Array<{ id: string; name: string; content: string }>;
  };
  [key: string]: unknown;
}

export async function executeAgentNode(
  node: WorkflowNode,
  ctx: RunContext,
): Promise<NodeExecResult> {
  const cfg = node.config as unknown as AgentNodeConfig;
  const scope = buildScope(ctx);
  const varName = varNameFor(ctx, node);
  const maxTurns = cfg.maxTurns ?? ctx.services.config.defaultMaxTurns;

  const bindings = await buildToolBindings(ctx, cfg);
  let toolChoice = cfg.toolChoice ?? 'auto';
  if (typeof toolChoice === 'object') {
    const requested = toolChoice.name;
    const selected = bindings.find((binding) => binding.def.name === requested);
    if (!selected) throw new Error(`agent '${node.name}' requires unknown tool '${requested}'`);
    toolChoice = { name: selected.def.name };
  }
  const byName = new Map(bindings.map((b) => [b.def.name, b]));
  const executeTracedCall = async (call: LLMToolCall, binding: ToolBinding): Promise<JsonValue> => {
    const policy = toolPolicy(binding);
    try {
      const executed = await runToolWithPolicy({
        signal: ctx.abortSignal,
        timeoutMs: policy.timeoutMs,
        maxRetries: policy.maxRetries,
        retryBackoffMs: policy.retryBackoffMs,
        onAttempt: async (attempt, maxAttempts) => {
          ctx.addUsage({ toolCalls: 1 });
          await ctx.emit({
            type: 'tool.started', runId: ctx.run.id, nodeId: node.id,
            tool: call.name, callId: call.id, args: call.arguments, attempt, maxAttempts, at: nowIso(),
          });
        },
        onRetry: async (attempt, error, delayMs) => {
          await ctx.emit({
            type: 'tool.retrying', runId: ctx.run.id, nodeId: node.id,
            tool: call.name, callId: call.id, attempt, error: error.message, delayMs, at: nowIso(),
          });
        },
        execute: (signal) => executeBinding(ctx, binding, call.arguments, signal, policy.timeoutMs),
      });
      const result = normalizeBindingResult(binding, executed.value);
      await ctx.emit({ type: 'tool.completed', runId: ctx.run.id, nodeId: node.id, tool: call.name, callId: call.id, result, attempts: executed.attempts, at: nowIso() });
      return result;
    } catch (error) {
      const attempts = Number((error as Error & { toolAttempts?: number }).toolAttempts ?? 1);
      await ctx.emit({ type: 'tool.failed', runId: ctx.run.id, nodeId: node.id, tool: call.name, callId: call.id, error: (error as Error).message, attempts, at: nowIso() });
      if (policy.timeoutBehavior === 'raise_exception') throw error;
      throw error;
    }
  };
  const executeServerCall = async (call: LLMToolCall, binding: ToolBinding) => {
    try {
      const result = await executeTracedCall(call, binding);
      return { id: call.id, name: call.name, content: toolResultToString(result) };
    } catch (error) {
      if (toolPolicy(binding).timeoutBehavior === 'raise_exception') throw error;
      return { id: call.id, name: call.name, content: `Error executing tool: ${(error as Error).message}` };
    }
  };

  // ---- restore or build loop state ----
  const resume = ctx.takeResume();
  let loop: AgentLoopState;

  if (resume && resume.agentLoop) {
    loop = resume.agentLoop as unknown as AgentLoopState;
    // Apply the approval decision / client tool result to the pending call.
    const batch = loop.batch;
    if (batch) {
      const call = batch.calls[batch.index];
      let content: string;
      if (resume.decision === 'approved') {
        const binding = byName.get(call.name);
        if (!binding) {
          content = `Error: tool '${call.name}' is no longer available`;
        } else {
          try {
            const result = await executeTracedCall(call, binding);
            content = toolResultToString(result);
          } catch (e) {
            if (toolPolicy(binding).timeoutBehavior === 'raise_exception') throw e;
            content = `Error executing tool: ${(e as Error).message}`;
          }
        }
      } else if (resume.decision === 'rejected') {
        content = resume.reason
          ? `The user declined this tool call: ${String(resume.reason)}. Do not retry it; continue without it.`
          : 'The user declined this tool call. Do not retry it; continue without it.';
      } else if (resume.clientResult !== undefined) {
        const binding = byName.get(call.name);
        const result = binding
          ? normalizeBindingResult(binding, resume.clientResult as JsonValue)
          : resume.clientResult as JsonValue;
        content = toolResultToString(result);
      } else {
        content = 'Tool call was not completed.';
      }
      batch.results.push({ id: call.id, name: call.name, content });
      batch.index += 1;
    }
  } else {
    // ---- fresh start: build messages ----
    const system = renderTemplate(cfg.instructions ?? '', scope);
    const messages: LLMMessage[] = [];
    if (system.trim()) messages.push({ role: 'system', content: system });

    if (cfg.includeChatHistory) {
      for (const h of ctx.checkpoint.history) {
        if (h.role === 'user') messages.push({ role: 'user', content: h.content });
        else if (h.role === 'assistant') messages.push({ role: 'assistant', content: h.content });
        else messages.push({ role: 'system', content: h.content });
      }
    }

    const userMessage = cfg.userMessage
      ? renderTemplate(cfg.userMessage, scope)
      : String(scope.input_as_text ?? '');
    const documentContext = (ctx.run.input.attachments ?? [])
      .filter((attachment) => attachment.kind === 'document' && attachment.extractedText)
      .map((attachment) => `Attached document (${attachment.name}):\n${attachment.extractedText}`)
      .join('\n\n');
    const mediaAttachments = (ctx.run.input.attachments ?? [])
      .filter((attachment): attachment is typeof attachment & { kind: 'image' | 'audio' | 'video' } => attachment.kind === 'image' || attachment.kind === 'audio' || attachment.kind === 'video')
      .map((attachment): LLMInputAttachment => ({ name: attachment.name, mimeType: attachment.mimeType, dataBase64: attachment.contentBase64, kind: attachment.kind }));
    const provider = providerForModel(cfg.model);
    const unsupportedKinds = unsupportedInputAttachmentKinds(provider, cfg.model, [{ role: 'user', content: '', attachments: mediaAttachments }]);
    if (unsupportedKinds.length) {
      const modalities = unsupportedKinds.join(' and ');
      const imagesOnly = unsupportedKinds.every((kind) => kind === 'image');
      const guidance = provider === 'mock'
        ? 'select a provider-backed multimodal model'
        : provider === 'gemini'
          ? 'select Gemini 1.5 or newer for image, audio, and video input'
          : imagesOnly && provider === 'openai'
            ? 'select a vision-capable OpenAI model such as GPT-4o, GPT-4.1, or GPT-5'
            : imagesOnly
              ? 'select Claude 3 or newer for image input'
              : 'select a Gemini multimodal model for inline audio or video';
      throw new Error(`agent '${node.name}' model '${cfg.model}' does not support ${modalities} attachments; ${guidance}`);
    }
    const userContent = documentContext ? `${userMessage || '(no input)'}\n\n${documentContext}` : userMessage;
    const lastIsUser =
      messages.length > 0 && messages[messages.length - 1].role === 'user';
    if (cfg.userMessage) {
      // explicit user message always appended (it may differ from the input)
      messages.push({ role: 'user', content: userContent || '(no input)', ...(mediaAttachments.length ? { attachments: mediaAttachments } : {}) });
    } else if (lastIsUser && (documentContext || mediaAttachments.length)) {
      const last = messages[messages.length - 1];
      if (last.role === 'user') {
        last.content = documentContext ? `${last.content}\n\n${documentContext}` : last.content;
        if (mediaAttachments.length) last.attachments = mediaAttachments;
      }
    } else if (!lastIsUser) {
      // includeChatHistory already ends with the current user input — don't
      // duplicate it; only append when the transcript doesn't end with it.
      messages.push({ role: 'user', content: userContent || '(no input)', ...(mediaAttachments.length ? { attachments: mediaAttachments } : {}) });
    }

    loop = { messages, turn: 0 };
  }

  // ---- the loop ----
  for (;;) {
    // process an in-flight tool batch first
    if (loop.batch) {
      const batch = loop.batch;
      while (batch.index < batch.calls.length) {
        if (cfg.parallelToolCalls !== false) {
          const runnable: Array<{ call: LLMToolCall; binding: ToolBinding }> = [];
          let nextIndex = batch.index;
          while (nextIndex < batch.calls.length) {
            const candidate = batch.calls[nextIndex];
            const candidateBinding = byName.get(candidate.name);
            if (!candidateBinding || candidateBinding.kind === 'handoff' || candidateBinding.kind === 'client' || (candidateBinding.kind === 'mcp' && candidateBinding.requireApproval === true)) break;
            runnable.push({ call: candidate, binding: candidateBinding });
            nextIndex += 1;
          }
          if (runnable.length) {
            batch.index = nextIndex;
            batch.results.push(...await Promise.all(runnable.map(({ call, binding }) => executeServerCall(call, binding))));
            continue;
          }
        }
        const call = batch.calls[batch.index];
        const binding = byName.get(call.name);

        if (!binding) {
          batch.results.push({
            id: call.id,
            name: call.name,
            content: `Error: unknown tool '${call.name}'`,
          });
          batch.index += 1;
          continue;
        }

        if (binding.kind === 'handoff' && binding.handoff) {
          const target = ctx.graph.nodes.find((candidate) => candidate.id === binding.handoff!.targetNodeId);
          if (!target || target.type !== 'agent') {
            throw new Error(`handoff target '${binding.handoff.targetNodeId}' is not an Agent node`);
          }
          const reason = typeof call.arguments.reason === 'string' ? call.arguments.reason : undefined;
          await ctx.emit({
            type: 'agent.handoff',
            runId: ctx.run.id,
            nodeId: node.id,
            targetNodeId: target.id,
            targetName: target.name,
            ...(reason ? { reason } : {}),
            at: nowIso(),
          });
          return {
            outputs: {
              output_text: '',
              handoff_target: target.id,
              ...(reason ? { handoff_reason: reason } : {}),
            },
            nextNodeId: target.id,
          };
        }

        const needsApproval =
          binding.kind === 'mcp' && binding.requireApproval === true;
        const isClient = binding.kind === 'client';

        if (needsApproval || isClient) {
          const policy = toolPolicy(binding);
          return {
            pause: {
              kind: isClient ? 'client_tool' : 'mcp_tool',
              message: isClient
                ? `Agent '${node.name}' requests client-side tool '${call.name}'`
                : `Agent '${node.name}' wants to call MCP tool '${binding.mcpToolName}' — approve?`,
              toolCall: {
                server: binding.serverId,
                tool: binding.mcpToolName ?? call.name,
                arguments: call.arguments,
              },
              resumeState: { agentLoop: loop as unknown as JsonObject },
              timeoutMs: binding.tool.kind === 'mcp' ? binding.tool.approvalTimeoutMs : policy.timeoutMs,
            },
          };
        }

        batch.results.push(await executeServerCall(call, binding));
        batch.index += 1;
      }
      // batch done -> append tool result messages
      for (const r of batch.results) {
        loop.messages.push({ role: 'tool', content: r.content, toolCallId: r.id, name: r.name });
      }
      loop.batch = undefined;
    }

    if (loop.turn >= maxTurns) {
      throw new Error(
        `agent '${node.name}' exceeded maxTurns (${maxTurns}) without a final answer`,
      );
    }
    loop.turn += 1;
    const effectiveToolChoice = loop.toolChoiceSatisfied && cfg.resetToolChoice !== false && toolChoice !== 'none'
      ? 'auto'
      : toolChoice;

    const requestTools = bindings.length && effectiveToolChoice !== 'none' ? bindings.map((binding) => binding.def) : undefined;
    const requestBase: Omit<LLMRequest, 'messages'> = {
      model: cfg.model,
      tools: requestTools,
      toolChoice: effectiveToolChoice,
      parallelToolCalls: cfg.parallelToolCalls !== false,
      temperature: cfg.modelParams?.temperature,
      maxTokens: cfg.modelParams?.maxTokens,
      topP: cfg.modelParams?.topP,
      promptCache: cfg.promptCache,
      reasoningEffort: cfg.reasoningEffort,
      verbosity: cfg.verbosity,
      jsonSchema: cfg.outputFormat === 'json' && cfg.outputSchema ? { name: cfg.outputSchemaName || 'response_schema', schema: cfg.outputSchema } : undefined,
      // Streaming changes some provider envelopes, so include it in preflight.
      onDelta: () => {},
    };
    let requestMessages = loop.messages;
    let inputCompaction: InputCompactionMetadata | undefined;
    if (cfg.maxInputTokensPerCall !== undefined) {
      try {
        const compacted = compactMessagesForInputBudget(
          loop.messages,
          (messages) => new TextEncoder().encode(JSON.stringify(getProvider(providerForModel(cfg.model)).prepareRequestBody({ ...requestBase, messages }))).byteLength,
          cfg.maxInputTokensPerCall,
        );
        requestMessages = compacted.messages;
        inputCompaction = compacted.metadata;
      } catch (error) {
        throw new Error(`agent '${node.name}' input bound exceeded: ${(error as Error).message}`);
      }
    }

    await ctx.emit({
      type: 'llm.started', runId: ctx.run.id, nodeId: node.id, model: cfg.model,
      request: {
        messageSummary: traceMessageSummary(requestMessages) as unknown as JsonObject[string],
        tools: (effectiveToolChoice === 'none' ? [] : bindings.map((binding) => binding.def.name)) as unknown as JsonObject[string],
        toolChoice: effectiveToolChoice as unknown as JsonObject[string],
        parallelToolCalls: cfg.parallelToolCalls !== false,
        reasoningEffort: cfg.reasoningEffort ?? null,
        verbosity: cfg.verbosity ?? null,
        temperature: cfg.modelParams?.temperature ?? null,
        maxTokens: cfg.modelParams?.maxTokens ?? null,
        topP: cfg.modelParams?.topP ?? null,
        promptCache: cfg.promptCache
          ? { policy: cfg.promptCache.policy, retention: cfg.promptCache.retention ?? null, keyConfigured: Boolean(cfg.promptCache.key) }
          : null,
        outputSchema: cfg.outputFormat === 'json' ? cfg.outputSchema ?? null : null,
        ...(inputCompaction ? { inputCompaction: inputCompaction as unknown as JsonObject[string] } : {}),
      },
      at: nowIso(),
    });

    const modelTimeoutMs = cfg.modelTimeoutMs ?? 120_000;
    const modelAbort = new AbortController();
    let deadlineReached = false;
    const abortFromRun = () => modelAbort.abort(ctx.abortSignal.reason);
    if (ctx.abortSignal.aborted) abortFromRun();
    else ctx.abortSignal.addEventListener('abort', abortFromRun, { once: true });
    const deadline = modelTimeoutMs > 0
      ? setTimeout(() => {
          deadlineReached = true;
          modelAbort.abort(new Error(`model call timed out after ${modelTimeoutMs} ms`));
        }, modelTimeoutMs)
      : undefined;
    deadline?.unref?.();

    let response;
    try {
      response = await chatWithModel(
        {
        model: cfg.model,
        messages: requestMessages,
        tools: requestTools,
        toolChoice: effectiveToolChoice,
        parallelToolCalls: cfg.parallelToolCalls !== false,
        temperature: cfg.modelParams?.temperature,
        maxTokens: cfg.modelParams?.maxTokens,
        topP: cfg.modelParams?.topP,
        promptCache: cfg.promptCache,
        reasoningEffort: cfg.reasoningEffort,
        verbosity: cfg.verbosity,
        jsonSchema:
          cfg.outputFormat === 'json' && cfg.outputSchema
            ? { name: cfg.outputSchemaName || 'response_schema', schema: cfg.outputSchema }
            : undefined,
        onDelta: (delta) => {
          void ctx.emit({
            type: 'llm.delta', runId: ctx.run.id, nodeId: node.id, delta, at: nowIso(),
          });
        },
          abortSignal: modelAbort.signal,
        },
        ctx.services.requestKeys,
        ctx.services.storedKeys,
      );
    } catch (error) {
      if (deadlineReached && !ctx.abortSignal.aborted) {
        throw new Error(`agent '${node.name}' model call timed out after ${modelTimeoutMs} ms`);
      }
      throw error;
    } finally {
      if (deadline) clearTimeout(deadline);
      ctx.abortSignal.removeEventListener('abort', abortFromRun);
    }

    ctx.addUsage({
      ...response.usage,
      llmCalls: 1,
    });
    await ctx.emit({
      type: 'llm.completed', runId: ctx.run.id, nodeId: node.id,
      output: response.text,
      toolCalls: response.toolCalls,
      finishReason: response.finishReason,
      usage: { ...response.usage },
      at: nowIso(),
    });

    if (response.toolCalls.length) {
      loop.toolChoiceSatisfied = true;
      loop.messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });
      loop.batch = { calls: response.toolCalls, index: 0, results: [] };
      continue;
    }

    // ---- final answer ----
    const outputText = response.text;
    const outputs: JsonObject = { output_text: outputText };

    if (cfg.outputFormat === 'json') {
      let parsed: JsonValue;
      try {
        parsed = extractJson(outputText);
      } catch (e) {
        throw new Error(
          `agent '${node.name}' was configured for JSON output but returned unparseable text: ${(e as Error).message}`,
        );
      }
      if (cfg.outputSchema) {
        const issues = validateAgainstSchema(parsed, cfg.outputSchema);
        if (issues.length) {
          throw new Error(
            `agent '${node.name}' JSON output failed schema validation: ` +
            issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; '),
          );
        }
      }
      outputs.output_parsed = parsed as JsonObject[string];
    }

    const historyAppend: ChatMessage[] = [];
    if (cfg.writeToConversationHistory && outputText) {
      historyAppend.push({
        role: 'assistant',
        content: outputText,
        nodeId: node.id,
        at: nowIso(),
      });
    }

    ctx.checkpoint.lastAgentText = outputText;
    return { outputs, historyAppend, nextHandle: null };
  }
}

export { buildToolBindings };
export type { ToolBinding };
