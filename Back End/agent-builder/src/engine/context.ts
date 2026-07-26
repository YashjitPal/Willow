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
  NestedRunWait,
  RunEvent,
  StartNodeConfig,
  WorkflowGraph,
  WorkflowNode,
  SubflowNodeConfig,
} from '../domain/types.ts';
import type { McpManager } from '../mcp/manager.ts';
import type { VectorStoreService } from '../rag/vectorStore.ts';
import type { SecretService } from '../services/secrets.ts';
import type { LLMUsage } from '../providers/types.ts';
import type { Storage } from '../storage/index.ts';
import { DEFAULT_SUBJECT_ID, DEFAULT_WORKSPACE_ID, type AuthPrincipal } from '../services/governance.ts';
import type { CelValue } from './cel/index.ts';

/** Serializable machine state persisted while a run is paused. */
export interface EngineCheckpoint {
  /** Versioned proof that this checkpoint was persisted at node boundaries. */
  boundaryVersion?: 1;
  /** Present from immediately before node execution until its boundary commit. */
  inFlightNode?: { nodeId: string; startedAt: string };
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
  subflowRuns?: { active?: { childRunId: string; nodeId: string } };
  [key: string]: JsonValue | undefined | null | Record<string, JsonValue> | ChatMessage[] | Record<string, number> | JsonObject | { nodeId: string; startedAt: string } | { active?: { childRunId: string; nodeId: string } };
}

export interface EngineServices {
  storage: Storage;
  config: AppConfig;
  mcp: McpManager;
  vectorStores: VectorStoreService;
  secrets: SecretService;
  /** Keys sent with the run request (highest precedence). */
  requestKeys?: ProviderKeys;
  /** Keys stored via the settings API. */
  storedKeys?: ProviderKeys;
  childRuns: {
    create(input: import('./executor.ts').StartRunInput): Promise<Run>;
    get(runId: string): Promise<Run | undefined>;
    cancel(runId: string): Promise<Run | undefined>;
    resume(runId: string, requestKeys?: ProviderKeys): Promise<Run>;
  };
}

export interface NodePause {
  kind: 'user_approval' | 'mcp_tool' | 'client_tool';
  message: string;
  toolCall?: { server?: string; tool: string; arguments: JsonObject };
  /** State needed to resume this node mid-flight. */
  resumeState?: JsonObject;
  /** Optional durable expiry for user approvals. */
  timeoutMs?: number;
}

export interface NodeExecResult {
  /** Outputs stored under the node's variable name. */
  outputs?: JsonObject;
  /** Which sourceHandle to follow (null = default edge). */
  nextHandle?: string | null;
  /** Direct dynamic route selected by an Agent handoff. */
  nextNodeId?: string;
  /** Pause this parent until a child workflow has credentials. */
  credentialsRequired?: { providers: Array<'gemini' | 'openai' | 'anthropic'> };
  /** Mirror an interactive child-run pause onto this parent run. */
  nestedWait?: {
    wait: NestedRunWait;
    pendingApproval?: import('../domain/types.ts').PendingApproval;
    debugPause?: Run['debugPause'];
    credentialRequirements?: Run['credentialRequirements'];
  };
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
  addUsage: (usage: Partial<LLMUsage> & { llmCalls?: number; toolCalls?: number }) => void;
  addEmbeddingUsage: (usage: import('../domain/types.ts').EmbeddingOperationUsage) => void;
}

export function runResourceAccess(run: Run): Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> {
  return {
    subjectId: run.ownerId ?? DEFAULT_SUBJECT_ID,
    workspaceId: run.workspaceId ?? DEFAULT_WORKSPACE_ID,
    role: 'viewer',
  };
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
