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

export type OutputFormat = 'text' | 'json' | 'widget';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type Verbosity = 'low' | 'medium' | 'high';

/** Tools attachable to an Agent node. */
export type AgentTool =
  | WebSearchTool
  | FileSearchTool
  | McpAgentTool
  | FunctionTool
  | CodeInterpreterTool
  | CustomTool;

export interface WebSearchTool {
  kind: 'web_search';
  /** Max results fetched per search. Default 5. */
  maxResults?: number;
}

export interface FileSearchTool {
  kind: 'file_search';
  vectorStoreIds: string[];
  maxResults?: number;
  /** 0..1 minimum similarity. */
  scoreThreshold?: number;
}

export interface McpAgentTool {
  kind: 'mcp';
  /** Registered MCP server id (mcp_...). */
  serverId: string;
  /** Restrict callable tools; empty/undefined = all tools. */
  allowedTools?: string[];
  /** 'never' | 'always' — whether tool calls pause the run for approval. */
  requireApproval?: 'never' | 'always';
}

export interface FunctionTool {
  kind: 'function';
  name: string;
  description?: string;
  /** JSON schema for the arguments object. */
  parameters?: JsonSchema;
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
}

/** Freeform "Custom" tool from the UI — text in / text out, described to the model. */
export interface CustomTool {
  kind: 'custom';
  name: string;
  description?: string;
  format: 'text' | 'json';
  /** Executed like FunctionTool js mode if provided; otherwise client-resolved. */
  code?: string;
}

export interface ModelParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
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
  tools: AgentTool[];
  outputFormat: OutputFormat;
  /** Required when outputFormat === 'json'. */
  outputSchema?: JsonSchema;
  /** Name for the structured-output schema (UI: response_schema). */
  outputSchemaName?: string;
  continueOnError: boolean;
  /** Cap on model+tool round-trips inside the agent loop. Default 8. */
  maxTurns?: number;
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
  /** There is always an implicit else branch with sourceHandle 'else'. */
}

export interface WhileNodeConfig {
  /** CEL condition evaluated before each iteration. */
  condition: string;
  /** Hard cap; run fails (or exits, per `onMaxIterations`) when exceeded. Default 100. */
  maxIterations?: number;
  /** 'fail' (default) or 'break' — behaviour when maxIterations is hit. */
  onMaxIterations?: 'fail' | 'break';
}

export interface TransformOutputField {
  name: string;
  type: VarType;
  /** CEL expression computing the field. */
  expression: string;
}

export interface TransformNodeConfig {
  outputs: TransformOutputField[];
}

export interface SetStateAssignment {
  /** Must be declared on the Start node. */
  name: string;
  /** CEL expression; may reference current state / node outputs / input. */
  expression: string;
}

export interface SetStateNodeConfig {
  assignments: SetStateAssignment[];
}

export interface UserApprovalNodeConfig {
  /** Message shown to the approver; supports {{...}} templating. */
  message: string;
  /** Optional timeout after which the run fails. 0/undefined = wait forever. */
  timeoutMs?: number;
}

// --- Tool nodes ---------------------------------------------------------------

export interface FileSearchNodeConfig {
  vectorStoreIds: string[];
  /** Query; supports {{...}} templating. */
  query: string;
  maxResults?: number;
  scoreThreshold?: number;
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
  continueOnError?: boolean;
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
  name: string;
  description?: string;
  /** Autosaved draft graph. */
  draft: WorkflowGraph;
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
}

// ---------------------------------------------------------------------------
// Runs, traces, approvals
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_client_tool'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
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
}

export type SpanType =
  | 'node'
  | 'llm'
  | 'tool'
  | 'guardrail'
  | 'approval'
  | 'state'
  | 'run';

export interface TraceSpan {
  id: string;
  runId: string;
  parentId?: string;
  type: SpanType;
  name: string;
  nodeId?: string;
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
}

export interface Run {
  /** run_... */
  id: string;
  workflowId: string;
  /** Version executed; 0 = draft. */
  workflowVersion: number;
  sessionId?: string;
  status: RunStatus;
  input: RunInput;
  /** Final output (End node / last agent text). */
  output?: JsonValue;
  /** Final state variable values. */
  state?: JsonObject;
  error?: string;
  pendingApproval?: PendingApproval;
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

// ---------------------------------------------------------------------------
// Run events (SSE stream)
// ---------------------------------------------------------------------------

export type RunEvent =
  | { type: 'run.created'; runId: string; at: string }
  | { type: 'run.started'; runId: string; at: string }
  | { type: 'node.started'; runId: string; nodeId: string; nodeType: NodeType; name: string; at: string }
  | { type: 'node.completed'; runId: string; nodeId: string; output?: JsonValue; at: string }
  | { type: 'node.failed'; runId: string; nodeId: string; error: string; at: string }
  | { type: 'llm.started'; runId: string; nodeId: string; model: string; at: string }
  | { type: 'llm.delta'; runId: string; nodeId: string; delta: string; at: string }
  | { type: 'llm.completed'; runId: string; nodeId: string; usage?: JsonObject; at: string }
  | { type: 'tool.started'; runId: string; nodeId: string; tool: string; args?: JsonObject; at: string }
  | { type: 'tool.completed'; runId: string; nodeId: string; tool: string; result?: JsonValue; at: string }
  | { type: 'guardrail.result'; runId: string; nodeId: string; passed: boolean; results: JsonObject; at: string }
  | { type: 'state.updated'; runId: string; nodeId: string; state: JsonObject; at: string }
  | { type: 'approval.requested'; runId: string; approval: PendingApproval; at: string }
  | { type: 'approval.resolved'; runId: string; approvalId: string; approved: boolean; at: string }
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
  name: string;
  fileCount: number;
  chunkCount: number;
  /** Embedding backend recorded at creation: 'gemini' | 'openai' | 'local'. */
  embedder: string;
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
  status: 'processing' | 'ready' | 'error';
  error?: string;
  createdAt: string;
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

export interface ChatSession {
  /** cks_... */
  id: string;
  workflowId: string;
  /** Pinned version; 0 = draft, -1 = latest published. */
  workflowVersion: number;
  user: string;
  stateVariables?: JsonObject;
  clientSecret: string;
  status: 'active' | 'expired' | 'cancelled';
  expiresAt: string;
  createdAt: string;
}

export interface ChatThreadMessage extends ChatMessage {
  id: string;
  runId?: string;
}

export interface ChatThread {
  /** th_... */
  id: string;
  sessionId: string;
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
  /** Optional web-search providers. */
  brave?: string[];
  tavily?: string[];
}

export interface ModelInfo {
  id: string;
  provider: 'gemini' | 'openai' | 'anthropic' | 'mock';
  displayName: string;
  description?: string;
}
