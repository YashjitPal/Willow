/**
 * Willow Agent Builder — canonical domain model.
 *
 * This is the single source of truth for the workflow graph, node configs,
 * runs, traces, sessions, and every persisted entity. The HTTP API, the
 * execution engine, the persistence layer and the client SDK all compile
 * against these types.
 *
 * Design notes:
 *  - The model is a superset of what the current canvas UI persists
 *    (label / instructions / guardrail toggles); every panel field the UI
 *    renders has a real home here so the frontend can be wired up
 *    field-by-field without backend changes.
 *  - Semantics follow OpenAI Agent Builder (AgentKit): typed node outputs,
 *    `{{...}}` variable templating, CEL conditions/expressions, global state
 *    declared on Start and mutated only by Set state, guardrail pass/fail
 *    branches, durable pause/resume for approvals.
 *  - No TypeScript enums (Node.js type-stripping requires erasable syntax);
 *    string-literal unions everywhere.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** Variable/data types used for state variables, inputs and transform outputs. */
export type VarType = 'string' | 'number' | 'boolean' | 'object' | 'list';

/** A JSON-Schema-ish object (subset validated by engine/jsonSchema.ts). */
export type JsonSchema = JsonObject;

// ---------------------------------------------------------------------------
// Node configs
// ---------------------------------------------------------------------------

export type NodeType =
  | 'start'
  | 'agent'
  | 'subflow'
  | 'end'
  | 'note'
  | 'fileSearch'
  | 'guardrail'
  | 'mcp'
  | 'ifElse'
  | 'while'
  | 'userApproval'
  | 'transform'
  | 'setState';

export interface StateVarDecl {
  name: string;
  type: VarType;
  /** Initial value; parsed according to `type`. */
  initialValue?: JsonValue;
}

export interface InputVarDecl {
  name: string;
  type: VarType;
  description?: string;
  /** Used when the caller omits this input; inputs without a default are required. */
  defaultValue?: JsonValue;
}

export interface StartNodeConfig {
  /**
   * Workflow inputs. `input_as_text: string` is always present implicitly;
   * additional typed inputs may be declared for API-invoked workflows.
   */
  inputVariables: InputVarDecl[];
  /** Global state declarations. Only Set state nodes may write these. */
  stateVariables: StateVarDecl[];
}

// --- Agent node -------------------------------------------------------------

export type OutputFormat = 'text' | 'json';
export type ToolChoice = 'auto' | 'required' | 'none' | { name: string };
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type Verbosity = 'low' | 'medium' | 'high';
export type NodeErrorPolicy = 'fail' | 'continue' | 'branch';

/** Tools attachable to an Agent node. */
export type AgentTool =
  | WebSearchTool
  | FileSearchTool
  | McpAgentTool
  | FunctionTool
  | CodeInterpreterTool
  | CustomTool;

export interface ToolExecutionPolicy {
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  timeoutBehavior?: 'error_as_result' | 'raise_exception';
}

export interface WebSearchTool {
  kind: 'web_search';
  /** Max results fetched per search. Default 5. */
  maxResults?: number;
  executionPolicy?: ToolExecutionPolicy;
}

export interface FileSearchTool {
  kind: 'file_search';
  vectorStoreIds: string[];
  maxResults?: number;
  /** 0..1 minimum similarity. */
  scoreThreshold?: number;
  executionPolicy?: ToolExecutionPolicy;
}

export interface McpAgentTool {
  kind: 'mcp';
  /** Registered MCP server id (mcp_...). */
  serverId: string;
  /** Restrict callable tools; empty/undefined = all tools. */
  allowedTools?: string[];
  /** 'never' | 'always' — whether tool calls pause the run for approval. */
  requireApproval?: 'never' | 'always';
  /** Maximum time to wait for human approval, ms. 0/undefined waits indefinitely. */
  approvalTimeoutMs?: number;
  executionPolicy?: ToolExecutionPolicy;
}

export interface FunctionTool {
  kind: 'function';
  name: string;
  description?: string;
  /** JSON schema for the arguments object. */
  parameters?: JsonSchema;
  executionPolicy?: ToolExecutionPolicy;
  /**
   * How the function executes when the model calls it:
   *  - js:   `code` body run in a sandbox: (args, context) => result
   *  - http: POST `url` with JSON args, response body returned to the model
   *  - client: surfaced to the caller via SSE and awaited (like OpenAI
   *    client-side tools); resolved through the runs API.
   */
  execution:
    | { mode: 'js'; code: string }
    | { mode: 'http'; url: string; headers?: Record<string, string> }
    | { mode: 'client' };
}

export interface CodeInterpreterTool {
  kind: 'code_interpreter';
  /** Wall-clock limit per execution, ms. Default 5000. */
  timeoutMs?: number;
  /** Text attachments exposed to the sandbox through readFile()/files. */
  files?: Array<{ name: string; content: string; mimeType?: string }>;
  executionPolicy?: ToolExecutionPolicy;
}

/** Freeform "Custom" tool from the UI — text in / text out, described to the model. */
export interface CustomTool {
  kind: 'custom';
  name: string;
  description?: string;
  format: 'text' | 'json';
  /** Executed like FunctionTool js mode if provided; otherwise client-resolved. */
  code?: string;
  executionPolicy?: ToolExecutionPolicy;
}

export interface ModelParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface PromptCacheConfig {
  /** auto leaves provider defaults unchanged; enabled requests explicit provider caching; disabled opts out where supported. */
  policy: 'auto' | 'enabled' | 'disabled';
  /** OpenAI Responses prompt cache routing key. Never emitted to traces. */
  key?: string;
  /** Provider-native retention: OpenAI in-memory/24h; Anthropic 5m/1h. */
  retention?: 'in-memory' | '5m' | '1h' | '24h';
}

export interface AgentNodeConfig {
  /** System prompt; supports {{...}} templating. */
  instructions: string;
  /** Optional extra user message; supports {{...}} templating. */
  userMessage?: string;
  /** Provider model id, e.g. "gemini-3-flash", "gpt-5", "claude-sonnet-5", "mock/echo". */
  model: string;
  includeChatHistory: boolean;
  writeToConversationHistory: boolean;
  reasoningEffort?: ReasoningEffort;
  verbosity?: Verbosity;
  modelParams?: ModelParams;
  promptCache?: PromptCacheConfig;
  tools: AgentTool[];
  /** Whether the model may, must, or must not call an attached tool. */
  toolChoice?: ToolChoice;
  /** Allow the model to request multiple tools in one turn. Default true. */
  parallelToolCalls?: boolean;
  /** Reset required/specific choice to auto after a tool batch. Default true. */
  resetToolChoice?: boolean;
  outputFormat: OutputFormat;
  /** Required when outputFormat === 'json'. */
  outputSchema?: JsonSchema;
  /** Name for the structured-output schema (UI: response_schema). */
  outputSchemaName?: string;
  continueOnError: boolean;
  onError?: NodeErrorPolicy;
  /** Cap on model+tool round-trips inside the agent loop. Default 8. */
  maxTurns?: number;
  /**
   * Maximum UTF-8 request bytes sent to the model per turn. Budgeted
   * deployments require this explicit fail-closed input bound.
   */
  maxInputTokensPerCall?: number;
  /** Wall-clock limit for each model call, ms. Default 120000; 0 disables it. */
  modelTimeoutMs?: number;
  /** Model-visible transfers to another Agent node in this workflow. */
  handoffs?: AgentHandoff[];
}

export interface AgentHandoff {
  /** Target Agent node id. */
  targetNodeId: string;
  /** Stable function name exposed to the model. */
  toolName?: string;
  /** Guidance shown to the model when choosing this specialist. */
  description?: string;
}

export interface SubflowInputMapping {
  /** Child Start input field; input_as_text is implicit. */
  target: string;
  /** Template/CEL-compatible value resolved against the parent scope. */
  value: JsonValue;
}

export interface SubflowOutputMapping {
  name: string;
  type: VarType;
  expression: string;
}

export interface SubflowNodeConfig {
  /** Referenced workflow id. */
  workflowId: string;
  /** Immutable published version; draft/latest are intentionally unsupported. */
  version: number;
  inputMappings?: SubflowInputMapping[];
  outputMappings?: SubflowOutputMapping[];
  onError?: NodeErrorPolicy;
  maxDepth?: number;
  /** Optional debugger settings applied inside the child workflow. */
  debug?: { breakpointNodeIds?: string[]; pauseBeforeFirst?: boolean };
}

// --- Logic / data nodes ------------------------------------------------------

export interface IfElseBranch {
  /** Stable branch id — used as edge sourceHandle. */
  id: string;
  label?: string;
  /** CEL expression over {input, state, node outputs}. */
  condition: string;
}

export interface IfElseNodeConfig {
  /** Ordered; first truthy condition wins. */
  branches: IfElseBranch[];
  onError?: NodeErrorPolicy;
  /** There is always an implicit else branch with sourceHandle 'else'. */
}

export interface WhileNodeConfig {
  /** CEL condition evaluated before each iteration. */
  condition: string;
  /** Hard cap; run fails (or exits, per `onMaxIterations`) when exceeded. Default 100. */
  maxIterations?: number;
  /** 'fail' (default) or 'break' — behaviour when maxIterations is hit. */
  onMaxIterations?: 'fail' | 'break';
  onError?: NodeErrorPolicy;
}

export interface TransformOutputField {
  name: string;
  type: VarType;
  /** CEL expression computing the field. */
  expression: string;
}

export interface TransformNodeConfig {
  outputs: TransformOutputField[];
  onError?: NodeErrorPolicy;
}

export interface SetStateAssignment {
  /** Must be declared on the Start node. */
  name: string;
  /** CEL expression; may reference current state / node outputs / input. */
  expression: string;
}

export interface SetStateNodeConfig {
  assignments: SetStateAssignment[];
  onError?: NodeErrorPolicy;
}

export interface UserApprovalNodeConfig {
  /** Message shown to the approver; supports {{...}} templating. */
  message: string;
  /** Optional timeout after which the run fails. 0/undefined = wait forever. */
  timeoutMs?: number;
  onError?: NodeErrorPolicy;
}

// --- Tool nodes ---------------------------------------------------------------

export interface FileSearchNodeConfig {
  vectorStoreIds: string[];
  /** Query; supports {{...}} templating. */
  query: string;
  maxResults?: number;
  scoreThreshold?: number;
  executionPolicy?: ToolExecutionPolicy;
  onError?: NodeErrorPolicy;
}

export interface GuardrailCheckSettings {
  /** PII entities to detect; empty = all built-ins. */
  piiEntities?: string[];
  /** 'block' (default) or 'mask' — masking rewrites the text and passes. */
  piiMode?: 'block' | 'mask';
  /** Moderation categories; empty = all. */
  moderationCategories?: string[];
  /** 0..1 confidence threshold for LLM-based checks. Default 0.7. */
  confidenceThreshold?: number;
  /** Vector store consulted by the hallucination check. */
  hallucinationVectorStoreId?: string;
  /** Model used for LLM-based checks (jailbreak/hallucination/moderation fallback). */
  checkModel?: string;
}

export interface GuardrailNodeConfig {
  pii: boolean;
  moderation: boolean;
  jailbreak: boolean;
  hallucination: boolean;
  continueOnError: boolean;
  /** Route through fail handle (default) or stop the run on a tripwire. */
  onTripwire?: 'branch' | 'stop';
  /** Input to check; template, defaults to '{{workflow.input_as_text}}'. */
  input?: string;
  settings?: GuardrailCheckSettings;
}

export interface McpNodeConfig {
  /** Registered MCP server id. */
  serverId: string;
  /** Tool to invoke. */
  tool: string;
  /**
   * Arguments object; string values support {{...}} templating,
   * `$cel:`-prefixed strings are evaluated as CEL.
   */
  arguments: JsonObject;
  requireApproval: 'never' | 'always';
  /** Maximum time to wait for human approval, ms. 0/undefined waits indefinitely. */
  approvalTimeoutMs?: number;
  continueOnError?: boolean;
  onError?: NodeErrorPolicy;
  executionPolicy?: ToolExecutionPolicy;
}

export interface EndNodeConfig {
  /**
   * Template or CEL (via $cel: prefix) producing the workflow output.
   * Defaults to the last agent's output_text.
   */
  output?: string;
  /** Optional schema the final output must satisfy (JSON output). */
  outputSchema?: JsonSchema;
}

export interface NoteNodeConfig {
  text: string;
}

export type NodeConfig =
  | { type: 'start'; config: StartNodeConfig }
  | { type: 'agent'; config: AgentNodeConfig }
  | { type: 'subflow'; config: SubflowNodeConfig }
  | { type: 'end'; config: EndNodeConfig }
  | { type: 'note'; config: NoteNodeConfig }
  | { type: 'fileSearch'; config: FileSearchNodeConfig }
  | { type: 'guardrail'; config: GuardrailNodeConfig }
  | { type: 'mcp'; config: McpNodeConfig }
  | { type: 'ifElse'; config: IfElseNodeConfig }
  | { type: 'while'; config: WhileNodeConfig }
  | { type: 'userApproval'; config: UserApprovalNodeConfig }
  | { type: 'transform'; config: TransformNodeConfig }
  | { type: 'setState'; config: SetStateNodeConfig };

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export interface WorkflowNode {
  id: string;
  type: NodeType;
  /**
   * Display name; also the variable namespace for the node's outputs
   * (normalized: "My Agent" -> my_agent). Must be unique after normalization.
   */
  name: string;
  /** Canvas position (round-tripped for the frontend, ignored by the engine). */
  position?: { x: number; y: number };
  config: JsonObject; // concrete shape per NodeConfig; kept loose for storage
}

/**
 * Edge source handles:
 *  - default flow: undefined / null
 *  - ifElse: branch id or 'else' (frontend legacy 'if' maps to first branch)
 *  - guardrail: 'pass' | 'fail'
 *  - userApproval: 'approved' | 'rejected'
 *  - while: 'loop' (body entry) | 'done' (exit)
 * A while body's last node connects back to the while node (targetHandle 'loop_back'
 * or plain edge — both accepted).
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ---------------------------------------------------------------------------
// Workflow entity + versions
// ---------------------------------------------------------------------------

export interface Workflow {
  /** wf_... */
  id: string;
  /** Stable subject that owns this workflow. Missing legacy values map to the default subject. */
  ownerId?: string;
  /** Tenant/workspace boundary. Missing legacy values map to the default workspace. */
  workspaceId?: string;
  name: string;
  description?: string;
  /** Autosaved draft graph. */
  draft: WorkflowGraph;
  /** Monotonic optimistic-concurrency token for draft and publish mutations. */
  draftRevision: number;
  /** Latest published version number; 0 = never published. */
  latestVersion: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface WorkflowVersion {
  workflowId: string;
  version: number; // 1..n
  graph: WorkflowGraph;
  publishedAt: string;
  notes?: string;
  /** Draft revision and canonical graph digest captured before publication. */
  sourceDraftRevision?: number;
  sourceDraftHash?: string;
  /** Immutable validation/safety findings captured at publish time. */
  validation?: WorkflowSafetySnapshot;
  /** Exact published workflow versions required by pinned subflow nodes. */
  dependencies?: WorkflowDependency[];
}

// ---------------------------------------------------------------------------
// Workflow collaboration
// ---------------------------------------------------------------------------

export type WorkflowReviewAnchor =
  | { type: 'canvas'; x: number; y: number }
  | { type: 'node'; nodeId: string; fieldPath?: string }
  | { type: 'edge'; edgeId: string };

export interface WorkflowCollaborator {
  subjectId: string;
  actorId: string;
  role: 'viewer' | 'editor' | 'publisher' | 'admin';
  displayName?: string;
}

export interface WorkflowReviewMessage {
  id: string;
  body: string;
  author: WorkflowCollaborator;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowReviewThread {
  id: string;
  workflowId: string;
  workspaceId: string;
  anchor: WorkflowReviewAnchor;
  status: 'open' | 'resolved';
  revision: number;
  draftRevision: number;
  messages: WorkflowReviewMessage[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: WorkflowCollaborator;
}

export interface WorkflowPresence {
  workflowId: string;
  workspaceId: string;
  clientId: string;
  collaborator: WorkflowCollaborator;
  cursor?: { x: number; y: number };
  selectedNodeIds: string[];
  activeNodeId?: string;
  color?: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface WorkflowCollaborationEvent {
  seq: number;
  workflowId: string;
  type: 'review.created' | 'review.updated' | 'review.deleted' | 'presence.updated' | 'presence.left';
  at: string;
  thread?: WorkflowReviewThread;
  threadId?: string;
  presence?: WorkflowPresence;
}

export interface WorkflowDependency {
  nodeId: string;
  workflowId: string;
  version: number;
}

export interface WorkflowSafetyIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export interface WorkflowSafetySnapshot {
  valid: boolean;
  errors: WorkflowSafetyIssue[];
  warnings: WorkflowSafetyIssue[];
  contracts?: WorkflowContractSnapshot[];
  safetyFindings?: WorkflowSafetyFindingSnapshot[];
}

export interface WorkflowContractFieldSnapshot {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface WorkflowContractSnapshot {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  inputs: WorkflowContractFieldSnapshot[];
  outputs: WorkflowContractFieldSnapshot[];
}

export interface WorkflowContractDiff {
  fromVersion: number;
  toVersion: number;
  added: WorkflowContractSnapshot[];
  removed: WorkflowContractSnapshot[];
  changed: Array<{
    nodeId: string;
    before: WorkflowContractSnapshot;
    after: WorkflowContractSnapshot;
  }>;
}

export interface WorkflowSafetyFindingSnapshot {
  code: string;
  level: 'warning';
  severity: 'medium' | 'high';
  nodeId: string;
  relatedNodeId?: string;
  message: string;
  remediation: string;
}

// ---------------------------------------------------------------------------
// Runs, traces, approvals
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_client_tool'
  | 'awaiting_credentials'
  | 'awaiting_debug'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Optional bounded files supplied with a ChatKit user turn. */
  attachments?: RunAttachment[];
  /** Node that produced it (assistant messages). */
  nodeId?: string;
  at?: string;
}

export interface RunInput {
  /** The chat/user input; exposed as workflow.input_as_text. */
  input_as_text?: string;
  /** Additional declared workflow inputs. */
  variables?: JsonObject;
  /** Overrides for declared state variables' initial values. */
  state_variables?: JsonObject;
  /** Prior conversation (chat sessions prepend this). */
  history?: ChatMessage[];
  /** Validated bounded inline attachments; arbitrary filesystem paths are never accepted. */
  attachments?: RunAttachment[];
}

export interface RunAttachment {
  name: string;
  mimeType: string;
  contentBase64: string;
  kind?: 'image' | 'audio' | 'video' | 'document';
  /** Deterministically extracted at run creation for document replay. */
  extractedText?: string;
  bytes?: number;
  /** Content digest used to detect dataset drift without exposing file contents. */
  sha256?: string;
}

export interface PendingApproval {
  /** appr_... */
  id: string;
  runId: string;
  nodeId: string;
  kind: 'user_approval' | 'mcp_tool' | 'client_tool';
  /** Rendered message / tool call summary shown to the approver. */
  message: string;
  /** For mcp_tool / client_tool: the pending call. */
  toolCall?: { server?: string; tool: string; arguments: JsonObject };
  createdAt: string;
  expiresAt?: string;
  /** Present when this approval is owned by a nested subflow run. */
  nested?: {
    childRunId: string;
    leafRunId: string;
    leafApprovalId: string;
    leafNodeId: string;
  };
}

/** Durable description of an interactive child run mirrored onto its parent. */
export interface NestedRunWait {
  version: 1;
  kind: 'subflow';
  parentNodeId: string;
  childRunId: string;
  leafRunId: string;
  leafStatus: 'awaiting_approval' | 'awaiting_client_tool' | 'awaiting_credentials' | 'awaiting_debug';
  leafApprovalId?: string;
  observedAt: string;
}

/** Authenticated identity that resolved a durable approval. */
export interface ApprovalActor {
  id: string;
  subjectId: string;
  workspaceId: string;
  role: 'viewer' | 'editor' | 'publisher' | 'admin';
  kind: 'anonymous' | 'bootstrap' | 'api_key';
  apiKeyId?: string;
}

export type SpanType =
  | 'node'
  | 'llm'
  | 'tool'
  | 'guardrail'
  | 'approval'
  | 'state'
  | 'subflow'
  | 'run';

export interface TraceSpan {
  id: string;
  runId: string;
  parentId?: string;
  type: SpanType;
  name: string;
  nodeId?: string;
  /** Stable 1-based occurrence among spans with the same type and node. */
  occurrence?: number;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  /** Inputs/outputs/usage/error details. */
  data?: JsonObject;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
  toolCalls: number;
  /** Cost from priced calls only. Check unpricedLlmCalls before treating this as a total. */
  estimatedCostUsd: number;
  unpricedLlmCalls: number;
  /** Provider-reported tokens used to embed file-search queries. */
  embeddingInputTokens: number;
  embeddingOperations: number;
  /** Embedding operations whose tokens or price were not authoritatively reported. */
  unpricedEmbeddingOperations: number;
  pricingCatalogVersion: string;
  /** Provider/model buckets preserve enough detail to audit mixed-model workflows. */
  byModel: Record<string, ModelUsageBucket>;
  byEmbeddingModel: Record<string, EmbeddingModelUsageBucket>;
}

export interface EmbeddingModelUsageBucket {
  provider: 'gemini' | 'openai' | 'local';
  model: string;
  inputTokens: number;
  operations: number;
  unreportedTokenOperations: number;
  pricing: EmbeddingPricingSnapshot;
}

export type ModelPricingSnapshot =
  | {
      status: 'priced';
      catalogVersion: string;
      currency: 'USD';
      inputUsdPerMillion: number;
      outputUsdPerMillion: number;
      cachedInputUsdPerMillion?: number;
      cacheWriteInputUsdPerMillion?: number;
      estimatedCostUsd: number;
    }
  | {
      status: 'unpriced';
      catalogVersion: string;
      currency: 'USD';
    };

export interface ModelUsageBucket {
  provider: 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'mock';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
  llmCalls: number;
  pricing: ModelPricingSnapshot;
}

export interface Run {
  /** run_... */
  id: string;
  workflowId: string;
  /** Version executed; 0 = draft. */
  workflowVersion: number;
  /** Resource ownership; legacy runs derive this from their workflow. */
  ownerId?: string;
  workspaceId?: string;
  sessionId?: string;
  deploymentId?: string;
  deploymentReleaseId?: string;
  deploymentRevision?: number;
  deploymentRunAdmissionId?: string;
  parentRunId?: string;
  parentNodeId?: string;
  rootRunId?: string;
  runDepth?: number;
  workflowAncestry?: string[];
  childRunIds?: string[];
  /** Internal retry key for deduplicating run creation requests. */
  idempotencyKey?: string;
  /** Canonical request signature paired with idempotencyKey. */
  idempotencySignature?: string;
  status: RunStatus;
  input: RunInput;
  /** Final output (End node / last agent text). */
  output?: JsonValue;
  /** Final state variable values. */
  state?: JsonObject;
  error?: string;
  pendingApproval?: PendingApproval;
  nestedWait?: NestedRunWait;
  debug?: { breakpointNodeIds: string[]; pauseBeforeFirst?: boolean; skipNodeIdOnce?: string; stepRemaining?: number };
  debugPause?: { nodeId: string; lastNodeId?: string; state: JsonObject; nodeOutputs: JsonObject; pausedAt: string };
  /** Provider names needed to continue; never contains credential material. */
  credentialRequirements?: { providers: Array<'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm'> };
  usage: RunUsage;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  /** Serialized engine checkpoint while paused (opaque to clients). */
  checkpoint?: JsonObject;
  /**
   * Normalized graph snapshot captured at run creation — the run always
   * executes/resumes against this, immune to concurrent draft edits.
   * Stripped from API responses.
   */
  graph?: WorkflowGraph;
}

export type BatchStatus =
  | 'queued'
  | 'running'
  | 'awaiting_credentials'
  | 'awaiting_approval'
  | 'awaiting_client_tool'
  | 'awaiting_debug'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type BatchItemStatus = BatchStatus | 'pending';

export interface BatchItem {
  index: number;
  input: RunInput;
  runId?: string;
  status: BatchItemStatus;
  error?: string;
  credentialRequirements?: { providers: Array<'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm'> };
  startedAt?: string;
  endedAt?: string;
}

export interface BatchJob {
  id: string;
  workflowId: string;
  workflowVersion: number;
  concurrency: number;
  status: BatchStatus;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  items: BatchItem[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  cancelRequested?: boolean;
}

// ---------------------------------------------------------------------------
// Run events (SSE stream)
// ---------------------------------------------------------------------------

export type RunEvent =
  | { type: 'run.created'; runId: string; at: string }
  | { type: 'run.started'; runId: string; at: string }
  | { type: 'run.recovered'; runId: string; nodeId?: string; at: string }
  | { type: 'node.started'; runId: string; nodeId: string; nodeType: NodeType; name: string; input?: JsonObject; config?: JsonObject; at: string }
  | { type: 'node.completed'; runId: string; nodeId: string; output?: JsonValue; at: string }
  | { type: 'node.failed'; runId: string; nodeId: string; error: string; at: string }
  | { type: 'llm.started'; runId: string; nodeId: string; model: string; request?: JsonObject; at: string }
  | { type: 'llm.delta'; runId: string; nodeId: string; delta: string; at: string }
  | { type: 'llm.completed'; runId: string; nodeId: string; output?: string; toolCalls?: Array<{ id: string; name: string; arguments: JsonObject }>; finishReason?: string; usage?: JsonObject; at: string }
  | { type: 'tool.started'; runId: string; nodeId: string; tool: string; callId?: string; args?: JsonObject; attempt?: number; maxAttempts?: number; at: string }
  | { type: 'tool.retrying'; runId: string; nodeId: string; tool: string; callId?: string; attempt: number; error: string; delayMs: number; at: string }
  | { type: 'tool.completed'; runId: string; nodeId: string; tool: string; callId?: string; result?: JsonValue; attempts?: number; at: string }
  | { type: 'tool.failed'; runId: string; nodeId: string; tool: string; callId?: string; error: string; attempts?: number; at: string }
  | { type: 'guardrail.result'; runId: string; nodeId: string; passed: boolean; results: JsonObject; at: string }
  | { type: 'state.updated'; runId: string; nodeId: string; state: JsonObject; at: string }
  | { type: 'approval.requested'; runId: string; approval: PendingApproval; at: string }
  | { type: 'approval.resolved'; runId: string; approvalId: string; approved: boolean; reason?: string; resolvedBy?: ApprovalActor; at: string }
  | { type: 'debug.paused'; runId: string; nodeId: string; state: JsonObject; nodeOutputs: JsonObject; at: string }
  | { type: 'debug.resumed'; runId: string; mode: 'continue' | 'step'; at: string }
  | { type: 'agent.handoff'; runId: string; nodeId: string; targetNodeId: string; targetName: string; reason?: string; at: string }
  | { type: 'subflow.started'; runId: string; nodeId: string; childRunId: string; workflowId: string; workflowVersion: number; at: string }
  | { type: 'subflow.paused'; runId: string; nodeId: string; childRunId: string; leafRunId: string; status: NestedRunWait['leafStatus']; approvalId?: string; at: string }
  | { type: 'subflow.resumed'; runId: string; nodeId: string; childRunId: string; leafRunId: string; at: string }
  | { type: 'subflow.completed'; runId: string; nodeId: string; childRunId: string; status: RunStatus; output?: JsonValue; at: string }
  | { type: 'approval.expired'; runId: string; approvalId: string; at: string }
  | { type: 'credentials.required'; runId: string; providers: string[]; at: string }
  | { type: 'run.completed'; runId: string; output?: JsonValue; at: string }
  | { type: 'run.failed'; runId: string; error: string; at: string }
  | { type: 'run.cancelled'; runId: string; at: string };

// ---------------------------------------------------------------------------
// MCP registry
// ---------------------------------------------------------------------------

export type McpTransportType = 'streamable-http' | 'sse' | 'stdio';

export interface McpServerRegistration {
  /** mcp_... */
  id: string;
  /** Stable subject owner; missing legacy values map to the default subject. */
  ownerId?: string;
  /** Tenant/workspace boundary; missing legacy values map to the default workspace. */
  workspaceId?: string;
  /** UI label, e.g. gmail_mcp. */
  label: string;
  description?: string;
  /** 'hosted' = from the built-in connector catalog; 'custom' = user URL. */
  origin: 'hosted' | 'third-party' | 'custom';
  /** Connector catalog key when origin is hosted/third-party (e.g. 'gmail'). */
  connector?: string;
  transport: McpTransportType;
  /** URL for http/sse; command line for stdio. */
  url?: string;
  command?: string;
  args?: string[];
  auth:
    | { type: 'none' }
    | { type: 'bearer'; token: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'headers'; headers: Record<string, string> };
  /** Cached tool list from the last successful connect. */
  tools?: McpToolInfo[];
  status: 'unconnected' | 'connected' | 'error';
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface McpConnectorCatalogEntry {
  key: string;
  name: string;
  tier: 'hosted' | 'third-party';
  iconUrl?: string;
  color?: string;
  features?: string[];
  /** Known public MCP endpoint, when one exists. */
  url?: string;
  authHint?: 'oauth' | 'token' | 'none';
}

// ---------------------------------------------------------------------------
// Vector stores (File search)
// ---------------------------------------------------------------------------

export interface VectorStore {
  /** vs_... */
  id: string;
  /** Stable owner/workspace; legacy stores derive default ownership. */
  ownerId?: string;
  workspaceId?: string;
  name: string;
  fileCount: number;
  chunkCount: number;
  /** Embedding backend recorded at creation: 'gemini' | 'openai' | 'local'. */
  embedder: string;
  embeddingUsage?: {
    ingestion: EmbeddingUsageSummary;
    search: EmbeddingUsageSummary;
  };
  createdAt: string;
  updatedAt: string;
}

export interface VectorStoreFile {
  /** vsf_... */
  id: string;
  storeId: string;
  filename: string;
  bytes: number;
  chunkCount: number;
  status: 'processing' | 'ready' | 'error' | 'cancelled';
  stage?: 'queued' | 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'completed';
  processedUnits?: number;
  totalUnits?: number;
  mimeType?: string;
  error?: string;
  embeddingUsage?: EmbeddingOperationUsage[];
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface EmbeddingPricingSnapshot {
  status: 'priced' | 'unpriced';
  catalogVersion: string;
  currency: 'USD';
  inputUsdPerMillion?: number;
  estimatedCostUsd?: number;
}

export interface EmbeddingOperationUsage {
  provider: 'gemini' | 'openai' | 'local';
  model: string;
  operation: 'ingestion' | 'search';
  status: 'completed' | 'failed' | 'cancelled';
  requestCount: number;
  /** Present only when reported by the provider. */
  inputTokens?: number;
  tokenStatus: 'reported' | 'not_reported' | 'not_applicable';
  pricing: EmbeddingPricingSnapshot;
  at: string;
}

export interface EmbeddingUsageSummary {
  operations: number;
  requestCount: number;
  reportedInputTokens: number;
  unreportedTokenOperations: number;
  unpricedOperations: number;
  estimatedCostUsd: number;
}

export interface VectorSearchResult {
  fileId: string;
  filename: string;
  chunkIndex: number;
  score: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Chat sessions (ChatKit-style)
// ---------------------------------------------------------------------------

export interface ChatDeployment {
  id: string;
  workflowId: string;
  /** Resource ownership; legacy deployments derive this from their workflow. */
  ownerId?: string;
  workspaceId?: string;
  name: string;
  environment: string;
  activeVersion: number;
  activeReleaseId: string;
  candidateReleaseId?: string;
  candidateTrafficPercent?: number;
  cohortSalt?: string;
  previousVersions: number[];
  allowedOrigins: string[];
  sessionRateLimitPerMinute: number;
  maxActiveSessions: number;
  maxConcurrentRuns: number;
  maxRunsPerMinute: number;
  maxRunsPerDay: number;
  /** Hard daily ceiling over input + output model tokens. */
  maxTokensPerDay?: number;
  /** Hard daily ceiling over priced model usage. */
  maxEstimatedCostUsdPerDay?: number;
  /** USD enforcement must fail closed when a reachable model is not priced. */
  unpricedCostPolicy?: 'deny';
  status: 'active' | 'paused' | 'archived';
  revision: number;
  /** Internal serialization token shared by control changes and session mints. */
  mutationRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRelease {
  id: string;
  deploymentId: string;
  workflowId: string;
  sequence: number;
  workflowVersion: number;
  previousReleaseId?: string;
  rollbackOfReleaseId?: string;
  promotedFromReleaseId?: string;
  kind: 'initial' | 'staged' | 'promotion' | 'rollback';
  createdBy: string;
  createdAt: string;
}

export interface ChatSession {
  /** cks_... */
  id: string;
  workflowId: string;
  /** Resolved, immutable version used for every turn; 0 is explicit draft preview. */
  workflowVersion: number;
  deploymentId?: string;
  deploymentReleaseId?: string;
  deploymentRevision?: number;
  origin?: string;
  deployment: {
    selection: 'latest' | 'pinned' | 'draft' | 'deployment';
    source: 'published' | 'draft';
    requestedVersion: number | 'latest';
    resolvedVersion: number;
    resolvedAt: string;
    deploymentId?: string;
    environment?: string;
    releaseId?: string;
    deploymentRevision?: number;
    route?: 'active' | 'candidate';
    candidateTrafficPercent?: number;
    cohortKeyHash?: string;
  };
  user: string;
  stateVariables?: JsonObject;
  /** Legacy plaintext credential; migrated to a hash after successful authentication. */
  clientSecret?: string;
  clientSecretHash?: string;
  clientSecretSalt?: string;
  secretVersion?: 1;
  status: 'active' | 'expired' | 'cancelled';
  expiresAt: string;
  createdAt: string;
}

export interface ChatThreadMessage extends ChatMessage {
  id: string;
  runId?: string;
  status?: 'in_progress' | 'completed' | 'failed' | 'cancelled';
  idempotencyKey?: string;
}

export interface ChatThread {
  /** th_... */
  id: string;
  sessionId: string;
  deploymentId?: string;
  deploymentReleaseId?: string;
  deploymentRevision?: number;
  workflowId: string;
  messages: ChatThreadMessage[];
  /** Rolling state carried across turns. */
  state?: JsonObject;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Provider settings
// ---------------------------------------------------------------------------

export interface ProviderKeys {
  gemini?: string[];
  openai?: string[];
  anthropic?: string[];
  grok?: string[];
  kimi?: string[];
  glm?: string[];
  /** Optional web-search providers. */
  brave?: string[];
  tavily?: string[];
}

export interface ModelInfo {
  id: string;
  provider: 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'mock';
  displayName: string;
  description?: string;
  inputModalities: Array<'text' | 'image' | 'audio' | 'video'>;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  limitsSource: 'provider' | 'pinned' | 'unknown';
  limitsCatalogVersion?: string;
}
