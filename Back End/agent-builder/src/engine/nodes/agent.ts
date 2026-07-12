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
  AgentTool,
  ChatMessage,
  FunctionTool,
  JsonObject,
  JsonValue,
  WorkflowNode,
} from '../../domain/types.ts';
import { chatWithModel, type LLMMessage, type LLMToolCall, type LLMToolDef } from '../../providers/index.ts';
import { runFunctionCode, runInterpreterCode } from '../../tools/sandbox.ts';
import { webSearch } from '../../tools/webSearch.ts';
import { nowIso } from '../../util/id.ts';
import { buildScope, varNameFor, type NodeExecResult, type RunContext } from '../context.ts';
import { extractJson, validateAgainstSchema } from '../jsonSchema.ts';
import { renderTemplate } from '../template.ts';

interface ToolBinding {
  def: LLMToolDef;
  kind: 'web_search' | 'file_search' | 'code_interpreter' | 'function_js' | 'function_http' | 'client' | 'mcp' | 'custom_js';
  tool: AgentTool;
  /** For mcp bindings. */
  serverId?: string;
  mcpToolName?: string;
  requireApproval?: boolean;
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
              'The last expression (or console output) is returned. No network or filesystem access.',
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
        const reg = await ctx.services.mcp.get(tool.serverId);
        if (!reg) {
          throw new Error(`agent references unknown MCP server '${tool.serverId}'`);
        }
        let tools = reg.tools ?? [];
        if (!tools.length) {
          tools = await ctx.services.mcp.listTools(tool.serverId);
        }
        const allowed = tool.allowedTools?.length ? new Set(tool.allowedTools) : null;
        for (const t of tools) {
          if (allowed && !allowed.has(t.name)) continue;
          bindings.push({
            kind: 'mcp',
            tool,
            serverId: tool.serverId,
            mcpToolName: t.name,
            requireApproval: tool.requireApproval === 'always',
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
  return bindings;
}

async function executeBinding(
  ctx: RunContext,
  binding: ToolBinding,
  args: JsonObject,
): Promise<JsonValue> {
  const keys = ctx.services.requestKeys ?? ctx.services.storedKeys;
  switch (binding.kind) {
    case 'web_search': {
      const t = binding.tool as Extract<AgentTool, { kind: 'web_search' }>;
      const query = typeof args.query === 'string' ? args.query : JSON.stringify(args);
      const results = await webSearch(query, keys, t.maxResults ?? 5);
      return results as unknown as JsonValue;
    }
    case 'file_search': {
      const t = binding.tool as Extract<AgentTool, { kind: 'file_search' }>;
      const query = typeof args.query === 'string' ? args.query : JSON.stringify(args);
      const results = await ctx.services.vectorStores.search(t.vectorStoreIds, query, keys, {
        maxResults: t.maxResults ?? 8,
        scoreThreshold: t.scoreThreshold,
      });
      return results.map((r) => ({
        filename: r.filename,
        score: Math.round(r.score * 1000) / 1000,
        text: r.text,
      })) as unknown as JsonValue;
    }
    case 'code_interpreter': {
      const t = binding.tool as Extract<AgentTool, { kind: 'code_interpreter' }>;
      const code = typeof args.code === 'string' ? args.code : '';
      const { result, logs } = await runInterpreterCode(code, t.timeoutMs ?? 5000);
      return logs.length ? ({ result, logs } as unknown as JsonValue) : result;
    }
    case 'function_js': {
      const fn = binding.tool as FunctionTool;
      if (fn.execution.mode !== 'js') throw new Error('mismatched execution mode');
      const { result } = await runFunctionCode(fn.execution.code, args);
      return result;
    }
    case 'custom_js': {
      const t = binding.tool as Extract<AgentTool, { kind: 'custom' }>;
      const { result } = await runFunctionCode(t.code ?? '', args);
      return result;
    }
    case 'function_http': {
      const fn = binding.tool as FunctionTool;
      if (fn.execution.mode !== 'http') throw new Error('mismatched execution mode');
      const res = await fetch(fn.execution.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(fn.execution.headers ?? {}) },
        body: JSON.stringify(args),
        signal: AbortSignal.any([AbortSignal.timeout(60_000), ctx.abortSignal]),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`function endpoint HTTP ${res.status}: ${text.slice(0, 400)}`);
      try {
        return JSON.parse(text) as JsonValue;
      } catch {
        return text;
      }
    }
    case 'mcp': {
      return ctx.services.mcp.callTool(binding.serverId!, binding.mcpToolName!, args);
    }
    default:
      throw new Error(`tool kind '${binding.kind}' cannot be executed server-side`);
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
  const byName = new Map(bindings.map((b) => [b.def.name, b]));

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
          await ctx.emit({
            type: 'tool.started', runId: ctx.run.id, nodeId: node.id,
            tool: call.name, args: call.arguments, at: nowIso(),
          });
          try {
            const result = await executeBinding(ctx, binding, call.arguments);
            content = toolResultToString(result);
            ctx.addUsage({ toolCalls: 1 });
            await ctx.emit({
              type: 'tool.completed', runId: ctx.run.id, nodeId: node.id,
              tool: call.name, result, at: nowIso(),
            });
          } catch (e) {
            content = `Error executing tool: ${(e as Error).message}`;
            await ctx.emit({
              type: 'tool.completed', runId: ctx.run.id, nodeId: node.id,
              tool: call.name, result: content, at: nowIso(),
            });
          }
        }
      } else if (resume.decision === 'rejected') {
        content = 'The user declined this tool call. Do not retry it; continue without it.';
      } else if (resume.clientResult !== undefined) {
        content = toolResultToString(resume.clientResult as JsonValue);
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
    const lastIsUser =
      messages.length > 0 && messages[messages.length - 1].role === 'user';
    if (cfg.userMessage) {
      // explicit user message always appended (it may differ from the input)
      messages.push({ role: 'user', content: userMessage || '(no input)' });
    } else if (!lastIsUser) {
      // includeChatHistory already ends with the current user input — don't
      // duplicate it; only append when the transcript doesn't end with it.
      messages.push({ role: 'user', content: userMessage || '(no input)' });
    }

    loop = { messages, turn: 0 };
  }

  // ---- the loop ----
  for (;;) {
    // process an in-flight tool batch first
    if (loop.batch) {
      const batch = loop.batch;
      while (batch.index < batch.calls.length) {
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

        const needsApproval =
          binding.kind === 'mcp' && binding.requireApproval === true;
        const isClient = binding.kind === 'client';

        if (needsApproval || isClient) {
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
            },
          };
        }

        await ctx.emit({
          type: 'tool.started', runId: ctx.run.id, nodeId: node.id,
          tool: call.name, args: call.arguments, at: nowIso(),
        });
        let content: string;
        try {
          const result = await executeBinding(ctx, binding, call.arguments);
          content = toolResultToString(result);
          ctx.addUsage({ toolCalls: 1 });
          await ctx.emit({
            type: 'tool.completed', runId: ctx.run.id, nodeId: node.id,
            tool: call.name, result, at: nowIso(),
          });
        } catch (e) {
          content = `Error executing tool: ${(e as Error).message}`;
          await ctx.emit({
            type: 'tool.completed', runId: ctx.run.id, nodeId: node.id,
            tool: call.name, result: content, at: nowIso(),
          });
        }
        batch.results.push({ id: call.id, name: call.name, content });
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

    await ctx.emit({
      type: 'llm.started', runId: ctx.run.id, nodeId: node.id, model: cfg.model, at: nowIso(),
    });

    const response = await chatWithModel(
      {
        model: cfg.model,
        messages: loop.messages,
        tools: bindings.length ? bindings.map((b) => b.def) : undefined,
        temperature: cfg.modelParams?.temperature,
        maxTokens: cfg.modelParams?.maxTokens,
        topP: cfg.modelParams?.topP,
        reasoningEffort: cfg.reasoningEffort,
        jsonSchema:
          cfg.outputFormat === 'json' && cfg.outputSchema
            ? { name: cfg.outputSchemaName || 'response_schema', schema: cfg.outputSchema }
            : undefined,
        onDelta: (delta) => {
          void ctx.emit({
            type: 'llm.delta', runId: ctx.run.id, nodeId: node.id, delta, at: nowIso(),
          });
        },
        abortSignal: ctx.abortSignal,
      },
      ctx.services.requestKeys,
      ctx.services.storedKeys,
    );

    ctx.addUsage({
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      llmCalls: 1,
    });
    await ctx.emit({
      type: 'llm.completed', runId: ctx.run.id, nodeId: node.id,
      usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
      at: nowIso(),
    });

    if (response.toolCalls.length) {
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
