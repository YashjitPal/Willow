/**
 * Engine context: the serializable interpreter state (checkpoint), the
 * variable scope builder, and the services bundle node executors receive.
 */

import type { AppConfig } from '../config.ts';
import type {
  ChatMessage,
  JsonObject,
  JsonValue,
  ProviderKeys,
  Run,
  RunEvent,
  StartNodeConfig,
  WorkflowGraph,
  WorkflowNode,
} from '../domain/types.ts';
import type { McpManager } from '../mcp/manager.ts';
import type { VectorStoreService } from '../rag/vectorStore.ts';
import type { Storage } from '../storage/index.ts';
import type { CelValue } from './cel/index.ts';

/** Serializable machine state persisted while a run is paused. */
export interface EngineCheckpoint {
  /** Node to execute next (or re-execute on resume). */
  currentNodeId: string | null;
  /** Node executed immediately before currentNodeId (loop re-entry detection). */
  lastNodeId?: string | null;
  state: JsonObject;
  /** Outputs keyed by node variable name. */
  nodeOutputs: Record<string, JsonValue>;
  history: ChatMessage[];
  /** while nodeId -> iterations so far. */
  whileCounters: Record<string, number>;
  lastAgentText: string;
  /** Node-specific resume payload (set by the resume API). */
  resume?: JsonObject;
  [key: string]: JsonValue | undefined | null | Record<string, JsonValue> | ChatMessage[] | Record<string, number> | JsonObject;
}

export interface EngineServices {
  storage: Storage;
  config: AppConfig;
  mcp: McpManager;
  vectorStores: VectorStoreService;
  /** Keys sent with the run request (highest precedence). */
  requestKeys?: ProviderKeys;
  /** Keys stored via the settings API. */
  storedKeys?: ProviderKeys;
}

export interface NodePause {
  kind: 'user_approval' | 'mcp_tool' | 'client_tool';
  message: string;
  toolCall?: { server?: string; tool: string; arguments: JsonObject };
  /** State needed to resume this node mid-flight. */
  resumeState?: JsonObject;
}

export interface NodeExecResult {
  /** Outputs stored under the node's variable name. */
  outputs?: JsonObject;
  /** Which sourceHandle to follow (null = default edge). */
  nextHandle?: string | null;
  /** Pause the run awaiting external input. */
  pause?: NodePause;
  /** Messages appended to the conversation history. */
  historyAppend?: ChatMessage[];
  /** Set by End nodes (and errors) — terminal output. */
  finalOutput?: JsonValue;
  /** Force-terminate the run after this node (End). */
  terminal?: boolean;
}

export interface RunContext {
  run: Run;
  graph: WorkflowGraph;
  /** node id -> variable name */
  varNames: Map<string, string>;
  checkpoint: EngineCheckpoint;
  services: EngineServices;
  emit: (event: RunEvent) => Promise<void>;
  abortSignal: AbortSignal;
  /** Resume payload for the node being re-entered (cleared after read). */
  takeResume: () => JsonObject | undefined;
  addUsage: (usage: { inputTokens?: number; outputTokens?: number; llmCalls?: number; toolCalls?: number }) => void;
}

/** Build the CEL/template variable scope from the current checkpoint. */
export function buildScope(ctx: RunContext): Record<string, CelValue> {
  const cp = ctx.checkpoint;
  const start = ctx.graph.nodes.find((n) => n.type === 'start');
  const startCfg = (start?.config ?? {}) as unknown as StartNodeConfig;

  const inputAsText = typeof ctx.run.input.input_as_text === 'string'
    ? ctx.run.input.input_as_text
    : '';

  const workflow: JsonObject = { input_as_text: inputAsText };
  for (const iv of startCfg.inputVariables ?? []) {
    if (iv.name === 'input_as_text') continue;
    const v = ctx.run.input.variables?.[iv.name];
    workflow[iv.name] = (v === undefined ? null : v) as JsonObject[string];
  }

  const scope: Record<string, CelValue> = {
    workflow: workflow as CelValue,
    state: cp.state as CelValue,
    input_as_text: inputAsText,
  };
  for (const [varName, outputs] of Object.entries(cp.nodeOutputs)) {
    scope[varName] = outputs as CelValue;
  }
  return scope;
}

/** Variable name for a node (falls back to its id). */
export function varNameFor(ctx: RunContext, node: WorkflowNode): string {
  return ctx.varNames.get(node.id) ?? node.id;
}
