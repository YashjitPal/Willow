/**
 * Willow Agent Builder — typed browser/Node client SDK.
 *
 * Zero dependencies; works in the Dashboard (Vite) and in Node >= 18.
 *
 *   import { AgentBuilderClient } from '<repo>/Back End/agent-builder/client/index.ts';
 *   const ab = new AgentBuilderClient({ baseUrl: 'http://127.0.0.1:8787' });
 *   const { workflow } = await ab.createWorkflow({ name: 'My workflow' });
 *   await ab.saveDraft(workflow.id, reactFlowJson);           // autosave
 *   const { run } = await ab.startRun(workflow.id, { input_as_text: 'hi' });
 *   ab.streamRunEvents(run.id, (e) => console.log(e.type, e));
 */

// ---- shared types (mirror of src/domain/types.ts, trimmed to the wire) ----

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

/** Agent-node fields commonly authored by SDK consumers. */
export type AgentNodeConfig = JsonObject & {
  /** Conservative per-call input bound used by runtime and deployment budgets. */
  maxInputTokensPerCall?: number;
};

export interface ProviderKeys {
  gemini?: string[];
  openai?: string[];
  anthropic?: string[];
  brave?: string[];
  tavily?: string[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  draftRevision: number;
  latestVersion: number;
  nodeCount: number;
  createdAt: string;
  expiresAt?: string;
  updatedAt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  categories: string[];
  tags: string[];
  riskLevel: 'low' | 'medium' | 'high';
  preview?: {
    nodes: Array<{ id: string; type: string; name: string }>;
    edges: Array<{ source: string; target: string; sourceHandle?: string }>;
    contracts: NodeDataContract[];
    safetyFindings: SafetyFinding[];
    riskFactors: Array<{
      code: 'MODEL_GENERATION' | 'HUMAN_DECISION' | 'SENSITIVE_DATA' | 'KNOWLEDGE_RETRIEVAL' | 'BOUNDED_LOOP' | 'RECOVERY_PATH' | 'EXTERNAL_ACTION';
      level: 'low' | 'medium' | 'high';
      nodeId: string;
      message: string;
    }>;
  };
  verification?: {
    cases: Array<{
      name: string;
      input: RunInput;
      approval?: boolean;
      expectedStatus: 'completed';
      expectedOutputContains: string;
      expectedNodeIds: string[];
    }>;
  };
}

export type EvaluationGraderType = 'contains' | 'equals' | 'regex' | 'run_status' | 'event_count' | 'model_judge' | 'label_model_judge';

export interface EvaluationGrader {
  id: string;
  name: string;
  type: EvaluationGraderType;
  target?: 'output' | 'error';
  nodeId?: string;
  spanType?: 'run' | 'node' | 'llm' | 'tool' | 'guardrail' | 'approval' | 'state';
  occurrence?: number;
  field?: 'output' | 'status' | 'error' | 'duration' | 'usage' | 'arguments' | 'result' | 'toolCalls';
  workflowVersion?: number;
  expected?: JsonValue;
  eventType?: string;
  model?: string;
  rubric?: string;
  /** Allowed labels for a categorical model judge. */
  labels?: string[];
  /** Labels that count as passing for a categorical model judge. */
  passingLabels?: string[];
  threshold?: number;
  weight?: number;
  reference?: 'test_case_expected';
}

export interface EvaluationDefinition {
  id: string;
  workflowId: string;
  name: string;
  graders: EvaluationGrader[];
  testCases: EvaluationTestCase[];
  datasetId?: string;
  datasetVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationTestCase {
  id: string;
  name: string;
  input: RunInput;
  version: number;
  expectedOutput?: JsonValue;
}

export interface EvaluationDataset {
  id: string;
  workflowId: string;
  name: string;
  description?: string;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationDatasetVersion {
  id: string;
  datasetId: string;
  workflowId: string;
  version: number;
  testCases: EvaluationTestCase[];
  sha256: string;
  createdAt: string;
}

export interface EvaluationUsage {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
  estimatedCostUsd?: number;
  unpricedLlmCalls?: number;
  unpricedModelCalls?: number;
  pricingCatalogVersion?: string;
  pricingStatus?: 'priced' | 'partial' | 'unpriced' | string;
  byModel?: Record<string, {
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    reasoningTokens?: number;
    llmCalls?: number;
    estimatedCostUsd?: number;
    pricing?: { status?: 'priced' | 'unpriced' | 'partial' | string; estimatedCostUsd?: number };
  }>;
}

export interface EvaluationRun {
  id: string;
  evaluationId: string;
  workflowId: string;
  status: 'queued' | 'running' | 'awaiting_credentials' | 'completed' | 'failed' | 'cancelled';
  credentialRequirements?: { providers: Array<'gemini' | 'openai' | 'anthropic'> };
  runIds: string[];
  /** Filters used to select runs. The resolved runIds remain immutable. */
  selection?: EvaluationRunSelection;
  caseRuns?: Array<{ testCaseId: string; runId?: string }>;
  totalRuns: number;
  completedRuns: number;
  score: number;
  usage?: EvaluationUsage;
  datasetSnapshot?: EvaluationDatasetVersion;
  results: Array<{
    runId: string;
    status: RunStatus;
    score: number;
    usage?: EvaluationUsage;
    annotation?: {
      rating: 'positive' | 'negative';
      feedback?: string;
      reviewerId: string;
      updatedAt: string;
    };
    results: Array<{
      graderId: string;
      name: string;
      passed: boolean;
      score: number;
      detail: string;
      /** Categorical verdict returned by a label_model_judge grader. */
      label?: string;
      targetFound?: boolean;
      targetKey?: string;
      model?: string;
      provider?: string;
      usage?: EvaluationUsage;
    }>;
  }>;
  createdAt: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Trace filters supported by the evaluation "add a run" flow. */
export interface EvaluationRunSelection {
  model?: string;
  tool?: string;
  /** Inclusive ISO-8601 lower bound for the run creation time. */
  from?: string;
  /** Inclusive ISO-8601 upper bound for the run creation time. */
  to?: string;
}

export interface EvaluationRunRequest {
  /** Explicit trace IDs. Omit to evaluate test cases or select traces with filters. */
  runIds?: string[];
  filters?: EvaluationRunSelection;
}

export interface TraceRetentionResult {
  enabled: boolean;
  maxRuns: number;
  maxAgeDays: number;
  dryRun?: boolean;
  deleted?: number;
  protected?: number;
  candidates?: number;
  scanned?: number;
  startedAt?: string;
  finishedAt?: string;
  skipped?: 'disabled' | 'throttled' | 'lease_held';
  error?: string;
}

export interface CredentialVaultRotation {
  targetKeyId: string;
  migrated: number;
  total: number;
}

export interface CredentialVaultStatus {
  mode: 'local' | 'environment';
  activeKeyId: string;
  keyCount: number;
  encryptedRecords: number;
  rotation?: CredentialVaultRotation;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  draft: { nodes: JsonObject[]; edges: JsonObject[] };
  draftRevision: number;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersion {
  workflowId: string;
  version: number;
  graph: Workflow['draft'];
  publishedAt: string;
  notes?: string;
  sourceDraftRevision?: number;
  sourceDraftHash?: string;
  validation?: PortableWorkflow['workflow']['validation'];
  dependencies?: Array<{ nodeId: string; workflowId: string; version: number }>;
}

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

export interface WorkflowCollaborationSnapshot {
  type: 'collaboration.snapshot';
  workflowId: string;
  threads: WorkflowReviewThread[];
  presence: WorkflowPresence[];
}

export type WorkflowCollaborationStreamEvent = WorkflowCollaborationSnapshot | WorkflowCollaborationEvent;

export interface ScopedSecret {
  id: string;
  name: string;
  description?: string;
  kind: 'secret';
  scope: 'workflow' | 'deployment';
  scopeId: string;
  workflowId: string;
  environment?: string;
  revision: number;
  hasValue: true;
  maskedValue: '[REDACTED]';
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecretInput {
  name: string;
  value: string;
  description?: string;
}

export interface UpdateSecretInput {
  expectedRevision: number;
  name?: string;
  value?: string;
  description?: string;
}

export interface PortableWorkflow {
  kind: 'willow.agent-workflow';
  formatVersion: 1;
  exportedAt: string;
  dependencies?: {
    subflows: Array<{ nodeId: string; workflowId: string; version: number }>;
  };
  workflow: {
    name: string;
    description?: string;
    graph: Workflow['draft'];
    validation?: {
      valid: boolean;
      errors: Array<{ nodeId?: string; edgeId?: string; message: string }>;
      warnings: Array<{ nodeId?: string; edgeId?: string; message: string }>;
      contracts?: NodeDataContract[];
      safetyFindings?: SafetyFinding[];
    };
  };
}

export interface SdkCodeBundleManifest {
  formatVersion: 1;
  generator: {
    name: 'willow-agent-builder';
    version: string;
  };
  target: {
    framework: 'openai-agents-sdk';
    package: string;
    version: string;
  };
  compatibility: {
    mode: 'hybrid';
    warnings: string[];
  };
  agents: Array<{ id: string; name?: string }>;
  transitions: Array<{ source: string; target: string; handle: string | null }>;
  handoffCandidates: Array<{ source: string; target: string }>;
  subflows: Array<{ nodeId: string; workflowId: string; version: number }>;
}

export interface SdkCodeBundle {
  mode: 'agents-sdk';
  language: 'typescript' | 'python';
  entrypoint: string;
  dependencies: Array<{
    name: string;
    version: string;
    kind: 'runtime' | 'development';
  }>;
  installCommand: string;
  runCommand: string;
  manifest: SdkCodeBundleManifest;
  files: Record<string, string>;
}

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
  /** Stable machine-readable validator code, when supplied by the backend. */
  code?: string;
  /** Optional actionable remediation for safety and configuration warnings. */
  remediation?: string;
  severity?: 'error' | 'warning' | 'info' | string;
}

export type ContractType = 'string' | 'number' | 'boolean' | 'object' | 'list' | 'unknown';

export interface ContractField {
  name: string;
  type: ContractType;
  required?: boolean;
  description?: string;
}

export interface NodeDataContract {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  inputs: ContractField[];
  outputs: ContractField[];
}

export interface WorkflowContractDiff {
  fromVersion: number;
  toVersion: number;
  added: NodeDataContract[];
  removed: NodeDataContract[];
  changed: Array<{ nodeId: string; before: NodeDataContract; after: NodeDataContract }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  contracts: NodeDataContract[];
  safetyFindings?: SafetyFinding[];
}

export interface SafetyFinding {
  code: string;
  level: 'warning' | string;
  severity: 'medium' | 'high' | string;
  nodeId?: string;
  relatedNodeId?: string;
  message: string;
  remediation: string;
}

export type RunStatus =
  | 'queued' | 'running' | 'awaiting_approval' | 'awaiting_client_tool'
  | 'awaiting_credentials'
  | 'awaiting_debug'
  | 'completed' | 'failed' | 'cancelled';

export interface PendingApproval {
  id: string;
  runId: string;
  nodeId: string;
  kind: 'user_approval' | 'mcp_tool' | 'client_tool';
  message: string;
  toolCall?: { server?: string; tool: string; arguments: JsonObject };
  createdAt: string;
  expiresAt?: string;
  nested?: { childRunId: string; leafRunId: string; leafApprovalId: string; leafNodeId: string };
}

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

export interface ApprovalActor {
  id: string;
  subjectId: string;
  workspaceId: string;
  role: 'viewer' | 'editor' | 'publisher' | 'admin';
  kind: 'anonymous' | 'bootstrap' | 'api_key';
  apiKeyId?: string;
}

export interface Run {
  id: string;
  workflowId: string;
  workflowVersion: number;
  ownerId?: string;
  workspaceId?: string;
  sessionId?: string;
  deploymentId?: string;
  deploymentReleaseId?: string;
  deploymentRevision?: number;
  parentRunId?: string;
  parentNodeId?: string;
  rootRunId?: string;
  runDepth?: number;
  workflowAncestry?: string[];
  childRunIds?: string[];
  status: RunStatus;
  input: RunInput;
  output?: JsonValue;
  state?: JsonObject;
  error?: string;
  pendingApproval?: PendingApproval;
  nestedWait?: NestedRunWait;
  debug?: { breakpointNodeIds: string[]; pauseBeforeFirst?: boolean; skipNodeIdOnce?: string; stepRemaining?: number };
  debugPause?: { nodeId: string; lastNodeId?: string; state: JsonObject; nodeOutputs: JsonObject; pausedAt: string };
  credentialRequirements?: { providers: Array<'gemini' | 'openai' | 'anthropic'> };
  usage: {
    inputTokens: number; outputTokens: number; llmCalls: number; toolCalls: number;
    estimatedCostUsd?: number; unpricedLlmCalls?: number; pricingCatalogVersion?: string;
    embeddingInputTokens?: number; embeddingOperations?: number; unpricedEmbeddingOperations?: number;
    byModel?: Record<string, JsonObject>; byEmbeddingModel?: Record<string, JsonObject>;
  };
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export type BatchStatus =
  | 'queued' | 'running' | 'awaiting_credentials' | 'awaiting_approval'
  | 'awaiting_client_tool' | 'awaiting_debug' | 'cancelling'
  | 'completed' | 'cancelled' | 'failed';

export interface BatchItem {
  index: number;
  runId?: string;
  status: BatchStatus | 'pending';
  error?: string;
  credentialRequirements?: { providers: Array<'gemini' | 'openai' | 'anthropic'> };
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

export interface BatchListOptions {
  workflowId?: string;
  status?: BatchStatus;
  limit?: number;
  offset?: number;
}

export interface BatchListResponse {
  data: BatchJob[];
  has_more: boolean;
}

export interface EvaluationRunListOptions {
  status?: EvaluationRun['status'];
  limit?: number;
  offset?: number;
}

export type RunEvent =
  | { type: 'run.created'; runId: string; at: string }
  | { type: 'run.started'; runId: string; at: string }
  | { type: 'node.started'; runId: string; nodeId: string; nodeType: string; name: string; input?: JsonObject; config?: JsonObject; at: string }
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
  | { type: 'approval.expired'; runId: string; approvalId: string; at: string }
  | { type: 'credentials.required'; runId: string; providers: string[]; at: string }
  | { type: 'debug.paused'; runId: string; nodeId: string; state: JsonObject; nodeOutputs: JsonObject; at: string }
  | { type: 'debug.resumed'; runId: string; mode: 'continue' | 'step'; at: string }
  | { type: 'agent.handoff'; runId: string; nodeId: string; targetNodeId: string; targetName: string; reason?: string; at: string }
  | { type: 'subflow.started'; runId: string; nodeId: string; childRunId: string; workflowId: string; workflowVersion: number; at: string }
  | { type: 'subflow.paused'; runId: string; nodeId: string; childRunId: string; leafRunId: string; status: NestedRunWait['leafStatus']; approvalId?: string; at: string }
  | { type: 'subflow.resumed'; runId: string; nodeId: string; childRunId: string; leafRunId: string; at: string }
  | { type: 'subflow.completed'; runId: string; nodeId: string; childRunId: string; status: RunStatus; output?: JsonValue; at: string }
  | { type: 'run.completed'; runId: string; output?: JsonValue; at: string }
  | { type: 'run.failed'; runId: string; error: string; at: string }
  | { type: 'run.cancelled'; runId: string; at: string };

export interface RealtimeSessionGrant {
  id: string;
  runId: string;
  createdAt: string;
  expiresAt: string;
  connectionExpiresAt: string;
  capabilities: Array<'events' | 'run.cancel' | 'approval.resolve'>;
  websocket: {
    url: string;
    protocols: [string, string];
  };
}

export type RealtimeServerEvent =
  | { type: 'session.created'; session: { id: string; runId: string; connectionExpiresAt: string } }
  | { type: 'run.snapshot'; run: Run }
  | { type: 'run.event'; runId: string; sequence: number; event: RunEvent }
  | { type: 'pong'; at: string }
  | { type: 'session.completed'; runId: string; status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>; cursor: number }
  | { type: 'command.completed'; requestId?: string; command: 'run.cancel' | 'approval.resolve'; run: Run }
  | { type: 'command.error'; requestId?: string; command: string; error: { code: string; message: string } }
  | { type: 'error'; error: { code: string; message: string } };

export type RealtimeClientCommand =
  | { type: 'ping'; requestId?: string }
  | { type: 'run.cancel'; requestId?: string }
  | { type: 'approval.resolve'; requestId?: string; approvalId: string; approved?: boolean; result?: JsonValue; reason?: string };

export interface RealtimeWebSocketLike {
  readonly protocol: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string; wasClean?: boolean }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type RealtimeWebSocketConstructor = new (url: string, protocols: string[]) => RealtimeWebSocketLike;

export interface RealtimeStreamHandle {
  (): void;
  send(command: RealtimeClientCommand): boolean;
  readonly connected: boolean;
}

export interface TraceSpan {
  id: string;
  runId: string;
  parentId?: string;
  type: 'node' | 'llm' | 'tool' | 'guardrail' | 'approval' | 'state' | 'subflow' | 'run';
  name: string;
  nodeId?: string;
  /** Stable 1-based occurrence among spans with the same type and node. */
  occurrence?: number;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  data?: JsonObject;
}

export interface TraceComparison {
  leftRunId: string;
  rightRunId: string;
  statusChanged: boolean;
  outputChanged: boolean;
  errorChanged: boolean;
  usageDelta: Record<string, number>;
  spans: Array<{
    key: string;
    left?: TraceSpan;
    right?: TraceSpan;
    statusChanged: boolean;
    nameChanged: boolean;
    durationDeltaMs?: number;
    outputChanged: boolean;
    usageChanged: boolean;
  }>;
}

export interface PortableTraceExport {
  kind: 'willow.run-trace';
  formatVersion: 1;
  exportedAt: string;
  run: Pick<Run, 'id' | 'workflowId' | 'workflowVersion' | 'status' | 'input' | 'usage'> & { output?: JsonValue; error?: string };
  events: RunEvent[];
  spans: TraceSpan[];
}

export interface RunInput {
  input_as_text?: string;
  variables?: JsonObject;
  state_variables?: JsonObject;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  attachments?: RunAttachment[];
}

export interface RunAttachment {
  name: string;
  mimeType: string;
  contentBase64: string;
  kind?: 'image' | 'audio' | 'video' | 'document';
  extractedText?: string;
  bytes?: number;
  sha256?: string;
}

export type McpServerAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'headers'; headers: Record<string, string> };

export interface McpServer {
  id: string;
  label: string;
  description?: string;
  origin: 'hosted' | 'third-party' | 'custom';
  connector?: string;
  transport: 'streamable-http' | 'sse' | 'stdio';
  url?: string;
  status: 'unconnected' | 'connected' | 'error';
  lastError?: string;
  tools?: Array<{ name: string; description?: string; inputSchema?: JsonObject }>;
  createdAt: string;
  updatedAt: string;
}

export interface McpConnector {
  key: string;
  name: string;
  tier: 'hosted' | 'third-party';
  iconUrl?: string;
  color?: string;
  url?: string;
  features?: string[];
  authHint?: 'oauth' | 'token' | 'none';
}

export interface VectorStore {
  id: string;
  ownerId?: string;
  workspaceId?: string;
  name: string;
  fileCount: number;
  chunkCount: number;
  embedder: string;
  embeddingUsage?: {
    ingestion: EmbeddingUsageSummary;
    search: EmbeddingUsageSummary;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EmbeddingUsageSummary {
  operations: number;
  requestCount: number;
  reportedInputTokens: number;
  unreportedTokenOperations: number;
  unpricedOperations: number;
  estimatedCostUsd: number;
}

export interface VectorStoreFile {
  id: string;
  storeId: string;
  filename: string;
  bytes: number;
  chunkCount: number;
  status: 'processing' | 'ready' | 'error' | 'cancelled';
  stage?: 'queued' | 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'completed';
  processedUnits?: number;
  totalUnits?: number;
  embeddingUsage?: Array<{
    provider: string;
    model: string;
    operation: 'ingestion' | 'search';
    status: 'completed' | 'failed' | 'cancelled';
    requestCount: number;
    inputTokens?: number;
    tokenStatus: 'reported' | 'not_reported' | 'not_applicable';
    pricing: { status: 'priced' | 'unpriced'; estimatedCostUsd?: number };
    at: string;
  }>;
  mimeType?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export type ChatKitClientSecret = `chatkit_token_cks_${string}_${string}`;

export interface ChatSessionDeployment {
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
}

export interface ChatDeployment {
  id: string; workflowId: string; ownerId?: string; workspaceId?: string; name: string; environment: string; activeVersion: number; activeReleaseId: string; candidateReleaseId?: string; candidateTrafficPercent?: number; cohortSalt?: string; previousVersions: number[];
  allowedOrigins: string[]; sessionRateLimitPerMinute: number; maxActiveSessions: number; maxConcurrentRuns: number; maxRunsPerMinute: number; maxRunsPerDay: number; maxTokensPerDay?: number; maxEstimatedCostUsdPerDay?: number; unpricedCostPolicy?: 'deny'; status: 'active' | 'paused' | 'archived';
  revision: number; createdAt: string; updatedAt: string;
}
export interface DeploymentRelease { id: string; deploymentId: string; workflowId: string; sequence: number; workflowVersion: number; previousReleaseId?: string; rollbackOfReleaseId?: string; promotedFromReleaseId?: string; kind: 'initial' | 'staged' | 'promotion' | 'rollback'; createdBy: string; createdAt: string }
export type DeploymentPricingStatus = 'priced' | 'partial' | 'unpriced';
export interface DeploymentPricingUsage {
  inputTokens: number;
  outputTokens: number;
  embeddingInputTokens: number;
  embeddingOperations: number;
  llmCalls: number;
  estimatedCostUsd: number;
  unpricedLlmCalls: number;
  unpricedEmbeddingOperations: number;
  unpricedModelCalls: number;
  pricingStatus: DeploymentPricingStatus;
  pricingCatalogVersions: string[];
}
export interface DeploymentUsage extends DeploymentPricingUsage { activeSessions: number; sessionsLastMinute: number; totalSessions: number; activeRuns: number; runsLastMinute: number; runsToday: number; totalRuns: number; maxTokensPerDay?: number; maxEstimatedCostUsdPerDay?: number; tokensUsedToday: number; estimatedCostUsdUsedToday: number; activeReservedTokens: number; activeReservedEstimatedCostUsd: number; tokenOverageToday: number; estimatedCostUsdOverageToday: number }
export interface DeploymentReleaseMetric extends DeploymentPricingUsage { releaseId: string; workflowVersion: number; sessions: number; runs: number }

/** Public session metadata. The session credential is never included here. */
export interface ChatSession {
  id: string;
  workflowId: string;
  workflowVersion: number;
  deploymentId?: string;
  deploymentReleaseId?: string;
  deploymentRevision?: number;
  deployment: ChatSessionDeployment;
  user: string;
  stateVariables?: JsonObject;
  /** Credential hashing scheme version; not the credential itself. */
  secretVersion?: 1;
  status: 'active' | 'expired' | 'cancelled';
  expiresAt: string;
  createdAt?: string;
}

/** Credential-bearing response returned only when a session secret is minted. */
export interface ChatSessionCredentialResponse {
  session: ChatSession;
  client_secret: ChatKitClientSecret;
  expires_at: string;
}

export interface ChatThread {
  id: string;
  sessionId: string;
  deploymentId?: string;
  deploymentReleaseId?: string;
  deploymentRevision?: number;
  workflowId: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachments?: RunAttachment[];
    runId?: string;
    status?: 'in_progress' | 'completed' | 'failed' | 'cancelled';
    idempotencyKey?: string;
    at?: string;
  }>;
  state?: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  description?: string;
  inputModalities: Array<'text' | 'image' | 'audio' | 'video'>;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  limitsSource: 'provider' | 'pinned' | 'unknown';
  limitsCatalogVersion?: string;
}

export interface OpenApiOperation {
  operationId: string;
  tags?: string[];
  summary?: string;
  parameters?: JsonObject[];
  requestBody?: JsonObject;
  responses: JsonObject;
  'x-willow-route-pattern'?: string;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  jsonSchemaDialect?: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string }>;
  tags?: Array<{ name: string }>;
  security?: JsonObject[];
  'x-willow-websockets'?: JsonObject;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: JsonObject;
}

export type GovernanceRole = 'viewer' | 'editor' | 'publisher' | 'admin';

export interface ManagedApiKey {
  id: string;
  name: string;
  prefix: string;
  role: GovernanceRole;
  scopes: string[];
  createdAt: string;
  createdBy: string;
  subjectId?: string;
  workspaceId?: string;
  authority?: 'platform' | 'workspace';
  expiresAt?: string;
  revokedAt?: string;
}

export interface GovernanceAuditEvent {
  id: string;
  occurredAt: string;
  actor: { id: string; subjectId: string; workspaceId: string; role: GovernanceRole; kind: 'anonymous' | 'bootstrap' | 'api_key'; apiKeyId?: string };
  action: string;
  outcome: 'success' | 'denied' | 'error';
  requestId: string;
  method: string;
  path: string;
  ip?: string;
  resourceId?: string;
}

export interface RunQuery {
  workflowId?: string;
  status?: string;
  nodeId?: string;
  type?: string;
  from?: string;
  to?: string;
  error?: string;
  model?: string;
  tool?: string;
  cursor?: string;
  limit?: number;
}

export interface WorkflowPublishedReferrer {
  nodeId: string;
  workflowId: string;
  version: number;
  parentWorkflowId: string;
  parentVersion: number;
}

export interface WorkflowDeletionBlockers {
  publishedReferrers: WorkflowPublishedReferrer[];
  deploymentIds: string[];
  batchIds?: string[];
  runIds?: string[];
}

// ---- client ----

export interface AgentBuilderClientOptions {
  baseUrl?: string;
  /** Bearer token when the server sets AGENT_BUILDER_API_TOKEN. */
  apiToken?: string;
  /** Per-request LLM keys (e.g. from UserDataContext.apiKeys). */
  providerKeys?: ProviderKeys | (() => ProviderKeys | undefined);
  fetch?: typeof fetch;
  /** Browser WebSocket implementation; injectable for Node runtimes and tests. */
  webSocket?: RealtimeWebSocketConstructor;
}

export class AgentBuilderApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AgentBuilderApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AgentBuilderClient {
  readonly baseUrl: string;
  private apiToken?: string;
  private providerKeys?: AgentBuilderClientOptions['providerKeys'];
  private fetchImpl: typeof fetch;
  private webSocketImpl?: RealtimeWebSocketConstructor;

  constructor(opts: AgentBuilderClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
    this.apiToken = opts.apiToken;
    this.providerKeys = opts.providerKeys;
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
    this.webSocketImpl = opts.webSocket;
  }

  /** Replace the bearer credential used by subsequent SDK requests. */
  setApiToken(token?: string): void {
    const normalized = token?.trim();
    this.apiToken = normalized || undefined;
  }

  private keys(): ProviderKeys | undefined {
    return typeof this.providerKeys === 'function' ? this.providerKeys() : this.providerKeys;
  }

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;
    const keys = this.keys();
    if (keys) headers['x-provider-keys'] = JSON.stringify(keys);
    Object.assign(headers, extraHeaders);

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new AgentBuilderApiError(res.status, 'bad_response', `non-JSON response: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
      throw new AgentBuilderApiError(res.status, err?.code ?? 'error', err?.message ?? `HTTP ${res.status}`, err?.details);
    }
    return data as T;
  }

  // ---- health / settings / models ----

  health(): Promise<{ ok: boolean; version: string }> {
    return this.request('GET', '/api/v1/health');
  }

  getOpenApiDocument(): Promise<OpenApiDocument> {
    return this.request('GET', '/api/v1/openapi.json');
  }

  getStoredKeys(): Promise<{ keys: Record<string, string[]> }> {
    return this.request('GET', '/api/v1/settings/keys');
  }

  saveStoredKeys(keys: ProviderKeys): Promise<{ ok: boolean }> {
    return this.request('PUT', '/api/v1/settings/keys', keys);
  }

  getCredentialVaultStatus(): Promise<{ vault: CredentialVaultStatus }> {
    return this.request('GET', '/api/v1/admin/credential-vault');
  }

  rotateCredentialVault(): Promise<{ vault: { activeKeyId: string; keyCount: number; migrated: number } }> {
    return this.request('POST', '/api/v1/admin/credential-vault/rotate');
  }

  retireUnusedCredentialVaultKeys(): Promise<{ vault: { activeKeyId: string; keyCount: number; retired: string[] } }> {
    return this.request('POST', '/api/v1/admin/credential-vault/retire-unused');
  }

  listApiKeys(): Promise<{ keys: ManagedApiKey[] }> {
    return this.request('GET', '/api/v1/admin/api-keys');
  }

  createApiKey(input: { name: string; role: GovernanceRole; scopes?: string[]; expiresAt?: string; subjectId?: string; workspaceId?: string }): Promise<{ key: ManagedApiKey; token: string }> {
    return this.request('POST', '/api/v1/admin/api-keys', input);
  }

  revokeApiKey(id: string): Promise<{ revoked: true }> {
    return this.request('DELETE', `/api/v1/admin/api-keys/${encodeURIComponent(id)}`);
  }

  listAuditEvents(limit = 100, offset = 0): Promise<{ events: GovernanceAuditEvent[] }> {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.request('GET', `/api/v1/admin/audit?${query}`);
  }

  listModels(provider?: string): Promise<{ models: ModelInfo[]; errors: Record<string, string> }> {
    const q = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return this.request('GET', `/api/v1/models${q}`);
  }

  // ---- workflows ----

  listWorkflows(): Promise<{ workflows: WorkflowSummary[] }> {
    return this.request('GET', '/api/v1/workflows');
  }

  listWorkflowTemplates(): Promise<{ templates: WorkflowTemplate[] }> {
    return this.request('GET', '/api/v1/workflow-templates');
  }

  createWorkflowFromTemplate(input: {
    templateId: string;
    name?: string;
    description?: string;
  }): Promise<{ workflow: Workflow; validation: ValidationResult }> {
    return this.request('POST', '/api/v1/workflows/from-template', input);
  }

  createWorkflow(input: { name?: string; description?: string; graph?: unknown } = {}): Promise<{
    workflow: Workflow;
    validation: ValidationResult;
  }> {
    return this.request('POST', '/api/v1/workflows', input);
  }

  getWorkflow(id: string): Promise<{ workflow: Workflow }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(id)}`);
  }

  updateWorkflow(id: string, patch: { name?: string; description?: string }, expectedRevision?: number): Promise<{ workflow: Workflow }> {
    return this.request('PATCH', `/api/v1/workflows/${encodeURIComponent(id)}`, {
      ...patch,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
  }

  deleteWorkflow(id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/v1/workflows/${encodeURIComponent(id)}`);
  }

  listWorkflowReviewThreads(id: string, includeResolved = true): Promise<{ threads: WorkflowReviewThread[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(id)}/comments?includeResolved=${includeResolved}`);
  }

  createWorkflowReviewThread(id: string, input: {
    body: string;
    anchor: WorkflowReviewAnchor;
    displayName?: string;
  }): Promise<{ thread: WorkflowReviewThread }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(id)}/comments`, input);
  }

  replyToWorkflowReviewThread(id: string, threadId: string, input: {
    body: string;
    expectedRevision: number;
    displayName?: string;
  }): Promise<{ thread: WorkflowReviewThread }> {
    return this.request(
      'POST',
      `/api/v1/workflows/${encodeURIComponent(id)}/comments/${encodeURIComponent(threadId)}/replies`,
      input,
    );
  }

  setWorkflowReviewThreadStatus(
    id: string,
    threadId: string,
    status: 'open' | 'resolved',
    expectedRevision: number,
  ): Promise<{ thread: WorkflowReviewThread }> {
    return this.request(
      'PATCH',
      `/api/v1/workflows/${encodeURIComponent(id)}/comments/${encodeURIComponent(threadId)}`,
      { status, expectedRevision },
    );
  }

  deleteWorkflowReviewThread(id: string, threadId: string, expectedRevision: number): Promise<{ ok: boolean }> {
    return this.request(
      'DELETE',
      `/api/v1/workflows/${encodeURIComponent(id)}/comments/${encodeURIComponent(threadId)}?expectedRevision=${encodeURIComponent(expectedRevision)}`,
    );
  }

  listWorkflowSecrets(id: string): Promise<{ secrets: ScopedSecret[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(id)}/secrets`);
  }

  createWorkflowSecret(id: string, input: CreateSecretInput): Promise<{ secret: ScopedSecret }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(id)}/secrets`, input);
  }

  updateWorkflowSecret(id: string, secretId: string, input: UpdateSecretInput): Promise<{ secret: ScopedSecret }> {
    return this.request(
      'PATCH',
      `/api/v1/workflows/${encodeURIComponent(id)}/secrets/${encodeURIComponent(secretId)}`,
      input,
    );
  }

  deleteWorkflowSecret(id: string, secretId: string, expectedRevision: number): Promise<{ ok: boolean }> {
    return this.request(
      'DELETE',
      `/api/v1/workflows/${encodeURIComponent(id)}/secrets/${encodeURIComponent(secretId)}?expectedRevision=${expectedRevision}`,
    );
  }

  listWorkflowPresence(id: string): Promise<{ presence: WorkflowPresence[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(id)}/presence`);
  }

  updateWorkflowPresence(id: string, input: {
    clientId: string;
    displayName?: string;
    color?: string;
    cursor?: { x: number; y: number };
    selectedNodeIds?: string[];
    activeNodeId?: string;
    ttlSeconds?: number;
  }): Promise<{ presence: WorkflowPresence }> {
    return this.request('PUT', `/api/v1/workflows/${encodeURIComponent(id)}/presence`, input);
  }

  leaveWorkflowPresence(id: string, clientId: string): Promise<{ ok: boolean }> {
    return this.request(
      'DELETE',
      `/api/v1/workflows/${encodeURIComponent(id)}/presence?clientId=${encodeURIComponent(clientId)}`,
    );
  }

  /** Stream review and presence updates. Reconnects receive a fresh authoritative snapshot. */
  streamWorkflowCollaboration(
    id: string,
    onEvent: (event: WorkflowCollaborationStreamEvent) => void,
    opts: { maxReconnects?: number; onError?: (error: Error) => void } = {},
  ): () => void {
    const controller = new AbortController();
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;

    void (async () => {
      const maxReconnects = Math.max(0, opts.maxReconnects ?? 3);
      for (let attempt = 0; !controller.signal.aborted; attempt++) {
        try {
          const response = await this.fetchImpl(
            `${this.baseUrl}/api/v1/workflows/${encodeURIComponent(id)}/collaboration/events`,
            { headers, signal: controller.signal },
          );
          if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            let separator: number;
            while ((separator = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, separator);
              buffer = buffer.slice(separator + 2);
              let eventType = '';
              let data = '';
              for (const line of frame.split('\n')) {
                if (line.startsWith('event:')) eventType = line.slice(6).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
              }
              if (!data || !eventType) continue;
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                onEvent({ ...parsed, type: eventType } as WorkflowCollaborationStreamEvent);
              } catch { /* skip malformed frame */ }
            }
          }
          if (attempt >= maxReconnects) return;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (attempt >= maxReconnects) {
            opts.onError?.(error as Error);
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)));
      }
    })();

    return () => controller.abort();
  }

  duplicateWorkflow(id: string, name?: string): Promise<{ workflow: Workflow; validation: ValidationResult }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(id)}/duplicate`, name ? { name } : {});
  }

  exportWorkflow(id: string, version = 0): Promise<{ artifact: PortableWorkflow }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(id)}/export-workflow?version=${version}`);
  }

  importWorkflow(artifact: PortableWorkflow, name?: string): Promise<{ workflow: Workflow; validation: ValidationResult }> {
    return this.request('POST', '/api/v1/workflows/import', { artifact, name });
  }

  /** Autosave the canvas graph (raw React Flow nodes/edges JSON is accepted). */
  saveDraft(id: string, graph: unknown, expectedRevision?: number): Promise<{ workflow: Workflow; validation: ValidationResult }> {
    return this.request('PUT', `/api/v1/workflows/${encodeURIComponent(id)}/draft`, {
      graph,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
  }

  validateGraph(id: string, graph?: unknown): Promise<{ validation: ValidationResult }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(id)}/validate`, graph ? { graph } : {});
  }

  publishWorkflow(id: string, notes?: string, expectedRevision?: number, idempotencyKey?: string): Promise<{
    workflow: Workflow;
    version: WorkflowVersion;
    validation: ValidationResult;
  }> {
    return this.request(
      'POST',
      `/api/v1/workflows/${encodeURIComponent(id)}/publish`,
      { notes, ...(expectedRevision === undefined ? {} : { expectedRevision }) },
      idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
    );
  }

  listVersions(id: string): Promise<{ versions: WorkflowVersion[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(id)}/versions`);
  }

  getVersion(id: string, version: number): Promise<{ version: WorkflowVersion }> {
    return this.request(
      'GET',
      `/api/v1/workflows/${encodeURIComponent(id)}/versions/${version}`,
    );
  }

  getContractDiff(id: string, fromVersion: number, toVersion: number): Promise<{ diff: WorkflowContractDiff }> {
    return this.request(
      'GET',
      `/api/v1/workflows/${encodeURIComponent(id)}/contract-diff?from=${fromVersion}&to=${toVersion}`,
    );
  }

  restoreVersion(id: string, version: number, expectedRevision: number): Promise<{
    workflow: Workflow;
    validation: ValidationResult;
  }> {
    return this.request(
      'POST',
      `/api/v1/workflows/${encodeURIComponent(id)}/versions/${version}/restore`,
      { expectedRevision },
    );
  }

  exportCode(id: string, format: 'typescript' | 'python', version?: number): Promise<{ format: string; code: string }>;
  exportCode(id: string, format: 'typescript-sdk' | 'python-sdk', version?: number): Promise<{ format: string; bundle: SdkCodeBundle }>;
  exportCode(id: string, format: 'typescript' | 'python' | 'typescript-sdk' | 'python-sdk', version?: number): Promise<{ format: string; code?: string; bundle?: SdkCodeBundle }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(id)}/export`, { format, version });
  }

  // ---- runs ----

  startRun(workflowId: string, input: RunInput, version?: number, debug?: { breakpointNodeIds?: string[]; pauseBeforeFirst?: boolean }): Promise<{ run: Run }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(workflowId)}/runs`, {
      input,
      version,
      debug,
    });
  }

  submitBatch(workflowId: string, inputs: RunInput[] | string[], version: number, concurrency = 4): Promise<{ batch: BatchJob }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(workflowId)}/batches`, { inputs, version, concurrency });
  }

  getBatch(batchId: string): Promise<{ batch: BatchJob }> {
    return this.request('GET', `/api/v1/batches/${encodeURIComponent(batchId)}`);
  }

  cancelBatch(batchId: string): Promise<{ batch: BatchJob }> {
    return this.request('POST', `/api/v1/batches/${encodeURIComponent(batchId)}/cancel`);
  }

  resumeBatch(batchId: string): Promise<{ batch: BatchJob }> {
    return this.request('POST', `/api/v1/batches/${encodeURIComponent(batchId)}/resume`);
  }

  continueDebugRun(runId: string, clientSecret?: string): Promise<{ run: Run }> {
    return this.request('POST', `/api/v1/runs/${encodeURIComponent(runId)}/debug/continue`, undefined, clientSecret ? { 'x-chatkit-client-secret': clientSecret } : undefined);
  }

  stepDebugRun(runId: string, clientSecret?: string): Promise<{ run: Run }> {
    return this.request('POST', `/api/v1/runs/${encodeURIComponent(runId)}/debug/step`, undefined, clientSecret ? { 'x-chatkit-client-secret': clientSecret } : undefined);
  }

  getRun(runId: string, clientSecret?: string): Promise<{ run: Run }> {
    return this.request('GET', `/api/v1/runs/${encodeURIComponent(runId)}`, undefined, clientSecret ? { 'x-chatkit-client-secret': clientSecret } : undefined);
  }

  replayRun(runId: string, idempotencyKey?: string): Promise<{ run: Run }> {
    return this.request('POST', `/api/v1/runs/${encodeURIComponent(runId)}/replay`, undefined, idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined);
  }

  listRuns(workflowId: string, limit = 50): Promise<{ runs: Run[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(workflowId)}/runs?limit=${limit}`);
  }

  queryRuns(input: RunQuery = {}): Promise<{ runs: Run[]; nextCursor?: string }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size ? `?${query}` : '';
    return this.request('GET', `/api/v1/runs${suffix}`);
  }

  getTraceRetentionStatus(): Promise<TraceRetentionResult> {
    return this.request('GET', '/api/v1/traces/retention');
  }

  enforceTraceRetention(input: {
    enabled: boolean;
    maxRuns: number;
    maxAgeDays: number;
    dryRun?: boolean;
  }): Promise<TraceRetentionResult> {
    return this.request('POST', '/api/v1/traces/retention', {
      force: true,
      dryRun: input.dryRun === true,
      maxRuns: input.enabled ? input.maxRuns : 0,
      maxAgeDays: input.enabled ? input.maxAgeDays : 0,
    });
  }

  listEvaluationDatasets(workflowId: string): Promise<{ datasets: EvaluationDataset[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(workflowId)}/datasets`);
  }

  createEvaluationDataset(workflowId: string, input: {
    name: string;
    description?: string;
    testCases: EvaluationTestCase[];
  }): Promise<{ dataset: EvaluationDataset; version: EvaluationDatasetVersion }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(workflowId)}/datasets`, input);
  }

  getEvaluationDataset(id: string): Promise<{ dataset: EvaluationDataset }> {
    return this.request('GET', `/api/v1/datasets/${encodeURIComponent(id)}`);
  }

  listEvaluationDatasetVersions(id: string): Promise<{ versions: EvaluationDatasetVersion[] }> {
    return this.request('GET', `/api/v1/datasets/${encodeURIComponent(id)}/versions`);
  }

  createEvaluationDatasetVersion(id: string, testCases: EvaluationTestCase[]): Promise<{ version: EvaluationDatasetVersion }> {
    return this.request('POST', `/api/v1/datasets/${encodeURIComponent(id)}/versions`, { testCases });
  }

  getEvaluationDatasetVersion(id: string, version: number): Promise<{ version: EvaluationDatasetVersion }> {
    return this.request('GET', `/api/v1/datasets/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}`);
  }

  listEvaluations(workflowId: string): Promise<{ evaluations: EvaluationDefinition[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(workflowId)}/evaluations`);
  }

  createEvaluation(workflowId: string, input: {
    name: string;
    graders: EvaluationGrader[];
    testCases?: EvaluationTestCase[];
    dataset?: { id: string; version?: number };
  }): Promise<{ evaluation: EvaluationDefinition }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(workflowId)}/evaluations`, input);
  }

  updateEvaluation(id: string, input: {
    name?: string;
    graders?: EvaluationGrader[];
    testCases?: EvaluationTestCase[];
    dataset?: { id: string; version?: number } | null;
  }): Promise<{ evaluation: EvaluationDefinition }> {
    return this.request('PATCH', `/api/v1/evaluations/${encodeURIComponent(id)}`, input);
  }

  deleteEvaluation(id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/v1/evaluations/${encodeURIComponent(id)}`);
  }

  getEvaluation(id: string): Promise<{ evaluation: EvaluationDefinition }> {
    return this.request('GET', `/api/v1/evaluations/${encodeURIComponent(id)}`);
  }

  runEvaluation(id: string, runIds?: string[], idempotencyKey?: string): Promise<{ run: EvaluationRun }>;
  runEvaluation(id: string, input?: EvaluationRunRequest, idempotencyKey?: string): Promise<{ run: EvaluationRun }>;
  runEvaluation(id: string, input?: string[] | EvaluationRunRequest, idempotencyKey?: string): Promise<{ run: EvaluationRun }> {
    const body = Array.isArray(input) ? { runIds: input } : input ?? {};
    return this.request('POST', `/api/v1/evaluations/${encodeURIComponent(id)}/run`, body, idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined);
  }

  listBatches(options: BatchListOptions = {}): Promise<BatchListResponse> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (value !== undefined) query.set(key, String(value));
    const suffix = query.size ? `?${query}` : '';
    return this.request('GET', `/api/v1/batches${suffix}`);
  }

  listEvaluationRuns(id: string, options: EvaluationRunListOptions = {}): Promise<{ runs: EvaluationRun[] }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (value !== undefined) query.set(key, String(value));
    const suffix = query.size ? `?${query}` : '';
    return this.request('GET', `/api/v1/evaluations/${encodeURIComponent(id)}/runs${suffix}`);
  }

  getEvaluationRun(id: string): Promise<{ run: EvaluationRun }> {
    return this.request('GET', `/api/v1/evaluation-runs/${encodeURIComponent(id)}`);
  }

  annotateEvaluationResult(id: string, runId: string, annotation: { rating: 'positive' | 'negative'; feedback?: string }): Promise<{ run: EvaluationRun }> {
    return this.request(
      'PATCH',
      `/api/v1/evaluation-runs/${encodeURIComponent(id)}/results/${encodeURIComponent(runId)}/annotation`,
      annotation,
    );
  }

  cancelEvaluationRun(id: string): Promise<{ run: EvaluationRun }> {
    return this.request('POST', `/api/v1/evaluation-runs/${encodeURIComponent(id)}/cancel`);
  }

  resumeEvaluationRun(id: string, requestKeys?: ProviderKeys): Promise<{ run: EvaluationRun }> {
    return this.request(
      'POST',
      `/api/v1/evaluation-runs/${encodeURIComponent(id)}/resume`,
      undefined,
      requestKeys ? { 'x-provider-keys': JSON.stringify(requestKeys) } : undefined,
    );
  }

  getTrace(runId: string, clientSecret?: string): Promise<{ events: RunEvent[] }> {
    return this.request('GET', `/api/v1/runs/${encodeURIComponent(runId)}/trace`, undefined, clientSecret ? { 'x-chatkit-client-secret': clientSecret } : undefined);
  }

  getTraceSpans(runId: string, clientSecret?: string): Promise<{ spans: TraceSpan[] }> {
    return this.request('GET', `/api/v1/runs/${encodeURIComponent(runId)}/spans`, undefined, clientSecret ? { 'x-chatkit-client-secret': clientSecret } : undefined);
  }

  compareRuns(runId: string, otherRunId: string, clientSecret?: string): Promise<{ comparison: TraceComparison }> {
    return this.request('GET', `/api/v1/runs/${encodeURIComponent(runId)}/compare?against=${encodeURIComponent(otherRunId)}`, undefined, clientSecret ? { 'x-chatkit-client-secret': clientSecret } : undefined);
  }

  exportTrace(runId: string, clientSecret?: string): Promise<{ export: PortableTraceExport }> {
    return this.request('GET', `/api/v1/runs/${encodeURIComponent(runId)}/trace/export`, undefined, clientSecret ? { 'x-chatkit-client-secret': clientSecret } : undefined);
  }

  /** Cancel a run. Retries can be made safe with an idempotency key. */
  cancelRun(runId: string, clientSecret?: string, idempotencyKey?: string): Promise<{ run: Run }> {
    return this.request('POST', `/api/v1/runs/${encodeURIComponent(runId)}/cancel`, undefined, {
      ...(clientSecret ? { 'x-chatkit-client-secret': clientSecret } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    });
  }

  /** Resume a run paused because provider credentials were unavailable. */
  resumeRun(runId: string, clientSecret?: string): Promise<{ run: Run }> {
    return this.request('POST', `/api/v1/runs/${encodeURIComponent(runId)}/resume`, undefined, clientSecret ? { 'x-chatkit-client-secret': clientSecret } : undefined);
  }

  /** Approve/reject a pending user approval or MCP tool call. */
  resolveApproval(runId: string, approvalId: string, approved: boolean, clientSecret?: string, idempotencyKey?: string, reason?: string): Promise<{ run: Run }> {
    return this.request(
      'POST',
      `/api/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
      { approved, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
      {
        ...(clientSecret ? { 'x-chatkit-client-secret': clientSecret } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
    );
  }

  /** Provide the result of a client-executed tool. */
  submitClientToolResult(runId: string, approvalId: string, result: JsonValue, clientSecret?: string, idempotencyKey?: string): Promise<{ run: Run }> {
    return this.request(
      'POST',
      `/api/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
      { result },
      {
        ...(clientSecret ? { 'x-chatkit-client-secret': clientSecret } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
    );
  }

  /** Explicitly reject a pending client-executed tool call. */
  rejectClientTool(runId: string, approvalId: string, reason?: string, clientSecret?: string, idempotencyKey?: string): Promise<{ run: Run }> {
    return this.request(
      'POST',
      `/api/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
      { approved: false, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
      {
        ...(clientSecret ? { 'x-chatkit-client-secret': clientSecret } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
    );
  }

  createRealtimeSession(
    runId: string,
    opts: { after?: number; replay?: boolean; clientSecret?: string } = {},
  ): Promise<{ session: RealtimeSessionGrant }> {
    return this.request(
      'POST',
      '/api/v1/realtime/sessions',
      { runId, after: Math.max(0, opts.after ?? 0), replay: opts.replay !== false },
      opts.clientSecret ? { 'x-chatkit-client-secret': opts.clientSecret } : undefined,
    );
  }

  /**
   * Stream run events over a resumable WebSocket session. Every reconnect
   * mints a fresh one-time credential and resumes after the last sequence.
   */
  streamRunEventsRealtime(
    runId: string,
    onEvent: (event: RunEvent) => void,
    opts: {
      replay?: boolean;
      clientSecret?: string;
      afterEventId?: number;
      maxReconnects?: number;
      reconnectDelayMs?: number;
      webSocket?: RealtimeWebSocketConstructor;
      onMessage?: (message: RealtimeServerEvent) => void;
      onEventId?: (id: number) => void;
      onError?: (error: Error) => void;
      onDone?: (status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>) => void;
    } = {},
  ): RealtimeStreamHandle {
    const WebSocketImpl = opts.webSocket
      ?? this.webSocketImpl
      ?? (globalThis as unknown as { WebSocket?: RealtimeWebSocketConstructor }).WebSocket;
    let stopped = false;
    let socket: RealtimeWebSocketLike | undefined;
    let cursor = Math.max(0, opts.afterEventId ?? 0);
    let done = false;
    let connected = false;

    const websocketUrl = (path: string): string => {
      const browserOrigin = (globalThis as unknown as { location?: { origin?: string } }).location?.origin;
      if (!this.baseUrl && !browserOrigin) throw new Error('realtime WebSocket requires an absolute baseUrl or browser location');
      const origin = this.baseUrl
        ? new URL(this.baseUrl || '/', browserOrigin ? `${browserOrigin.replace(/\/+$/, '')}/` : undefined).toString()
        : browserOrigin!;
      const url = new URL(path, `${origin.replace(/\/+$/, '')}/`);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return url.toString();
    };

    const fail = (error: unknown) => {
      if (!stopped && !done) opts.onError?.(error instanceof Error ? error : new Error(String(error)));
    };

    void (async () => {
      if (!WebSocketImpl) {
        fail(new Error('WebSocket is unavailable in this runtime'));
        return;
      }
      const maxReconnects = Math.max(0, opts.maxReconnects ?? 3);
      const baseDelay = Math.max(0, opts.reconnectDelayMs ?? 250);
      for (let attempt = 0; !stopped && !done; attempt++) {
        try {
          const { session } = await this.createRealtimeSession(runId, {
            after: cursor,
            replay: attempt === 0 ? opts.replay : true,
            clientSecret: opts.clientSecret,
          });
          if (stopped) return;
          const outcome = await new Promise<'completed' | 'disconnected'>((resolve, reject) => {
            let settled = false;
            const finish = (value: 'completed' | 'disconnected') => {
              if (settled) return;
              settled = true;
              resolve(value);
            };
            try {
              socket = new WebSocketImpl(websocketUrl(session.websocket.url), [...session.websocket.protocols]);
            } catch (error) {
              reject(error);
              return;
            }
            socket.onopen = () => { connected = true; };
            socket.onmessage = (messageEvent) => {
              try {
                const message = JSON.parse(String(messageEvent.data)) as RealtimeServerEvent;
                if (message.type === 'run.event') {
                  if (!Number.isInteger(message.sequence) || message.sequence <= cursor) return;
                  cursor = message.sequence;
                  opts.onEventId?.(cursor);
                  onEvent(message.event);
                }
                opts.onMessage?.(message);
                if (message.type === 'session.completed' && !done) {
                  done = true;
                  opts.onDone?.(message.status);
                  finish('completed');
                  socket?.close(1000, 'run settled');
                }
              } catch {
                // Ignore malformed server frames; a valid close still drives reconnect.
              }
            };
            socket.onclose = () => {
              connected = false;
              finish(done ? 'completed' : 'disconnected');
            };
            socket.onerror = () => undefined;
          });
          socket = undefined;
          connected = false;
          if (outcome === 'completed' || stopped || done) return;
          throw new Error('realtime WebSocket disconnected before the run settled');
        } catch (error) {
          socket = undefined;
          connected = false;
          if (stopped || done) return;
          if (attempt >= maxReconnects) {
            fail(error);
            return;
          }
          const delay = Math.min(5_000, baseDelay * 2 ** attempt);
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    })();

    const handle = (() => {
      stopped = true;
      connected = false;
      socket?.close(1000, 'client closed');
      socket = undefined;
    }) as RealtimeStreamHandle;
    handle.send = (command) => {
      if (!connected || !socket) return false;
      try {
        socket.send(JSON.stringify(command));
        return true;
      } catch {
        return false;
      }
    };
    Object.defineProperty(handle, 'connected', { get: () => connected });
    return handle;
  }

  /**
   * Stream run events over SSE. Returns a disposer. Uses fetch-based streaming
   * (EventSource can't send auth headers).
   */
  streamRunEvents(
    runId: string,
    onEvent: (event: RunEvent) => void,
    opts: {
      replay?: boolean;
      clientSecret?: string;
      afterEventId?: number;
      maxReconnects?: number;
      onEventId?: (id: number) => void;
      onError?: (err: Error) => void;
      onDone?: () => void;
    } = {},
  ): () => void {
    const controller = new AbortController();
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;
    if (opts.clientSecret) headers['x-chatkit-client-secret'] = opts.clientSecret;

    void (async () => {
      let cursor = Math.max(0, opts.afterEventId ?? 0);
      const maxReconnects = Math.max(0, opts.maxReconnects ?? 3);
      for (let attempt = 0; !controller.signal.aborted; attempt++) {
        let terminal = false;
        try {
          const query = new URLSearchParams();
          if (opts.replay === false) query.set('replay', 'false');
          if (cursor > 0) query.set('after', String(cursor));
          if (cursor > 0) headers['last-event-id'] = String(cursor);
          const suffix = query.size ? `?${query}` : '';
          const res = await this.fetchImpl(
            `${this.baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/events${suffix}`,
            { headers, signal: controller.signal },
          );
          if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let sep: number;
            while ((sep = buf.indexOf('\n\n')) !== -1) {
              const frame = buf.slice(0, sep);
              buf = buf.slice(sep + 2);
              let eventType = '';
              let eventId = 0;
              let data = '';
              for (const line of frame.split('\n')) {
                if (line.startsWith('id:')) eventId = Number.parseInt(line.slice(3).trim(), 10) || 0;
                else if (line.startsWith('event:')) eventType = line.slice(6).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
              }
              if (eventId > cursor) {
                cursor = eventId;
                opts.onEventId?.(cursor);
              }
              if (eventType === 'done') {
                terminal = true;
                opts.onDone?.();
                continue;
              }
              if (data) {
                try {
                  onEvent(JSON.parse(data) as RunEvent);
                } catch { /* skip malformed frame */ }
              }
            }
          }
          if (terminal) return;
          if (attempt >= maxReconnects) {
            opts.onError?.(new Error('SSE stream ended before the run settled'));
            return;
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          if (attempt >= maxReconnects) {
            opts.onError?.(e as Error);
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)));
      }
    })();

    return () => controller.abort();
  }

  // ---- MCP ----

  listMcpConnectors(): Promise<{ connectors: McpConnector[] }> {
    return this.request('GET', '/api/v1/mcp/connectors');
  }

  listMcpServers(): Promise<{ servers: McpServer[] }> {
    return this.request('GET', '/api/v1/mcp/servers');
  }

  /**
   * Register (and by default connect) an MCP server. Matches the UI's Connect
   * form: { url, label, description, authType: 'Access token / API key',
   * token } or a { connector } key from the catalog.
   */
  addMcpServer(input: {
    label?: string;
    description?: string;
    url?: string;
    connector?: string;
    command?: string;
    args?: string[];
    transport?: 'streamable-http' | 'sse' | 'stdio';
    authType?: string;
    token?: string;
    auth?: McpServerAuth;
    connect?: boolean;
  }): Promise<{ server: McpServer; warning?: string }> {
    return this.request('POST', '/api/v1/mcp/servers', input);
  }

  updateMcpServer(id: string, input: {
    label?: string;
    description?: string;
    url?: string;
    command?: string;
    args?: string[];
    transport?: McpServer['transport'];
    auth?: McpServerAuth;
  }): Promise<{ server: McpServer }> {
    return this.request('PATCH', `/api/v1/mcp/servers/${encodeURIComponent(id)}`, input);
  }

  connectMcpServer(id: string): Promise<{ server: McpServer }> {
    return this.request('POST', `/api/v1/mcp/servers/${encodeURIComponent(id)}/connect`);
  }

  deleteMcpServer(id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/v1/mcp/servers/${encodeURIComponent(id)}`);
  }

  listMcpTools(id: string, refresh = false): Promise<{ tools: McpServer['tools'] }> {
    return this.request('GET', `/api/v1/mcp/servers/${encodeURIComponent(id)}/tools${refresh ? '?refresh=true' : ''}`);
  }

  callMcpTool(id: string, tool: string, args: JsonObject): Promise<{ result: JsonValue }> {
    return this.request(
      'POST',
      `/api/v1/mcp/servers/${encodeURIComponent(id)}/tools/${encodeURIComponent(tool)}/call`,
      { arguments: args },
    );
  }

  // ---- vector stores ----

  listVectorStores(): Promise<{ stores: VectorStore[] }> {
    return this.request('GET', '/api/v1/vector-stores');
  }

  createVectorStore(name: string): Promise<{ store: VectorStore }> {
    return this.request('POST', '/api/v1/vector-stores', { name });
  }

  getVectorStore(id: string): Promise<{ store: VectorStore; files: VectorStoreFile[] }> {
    return this.request('GET', `/api/v1/vector-stores/${encodeURIComponent(id)}`);
  }

  deleteVectorStore(id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/v1/vector-stores/${encodeURIComponent(id)}`);
  }

  /** Upload a plain-text document. */
  addVectorStoreFile(storeId: string, filename: string, content: string, idempotencyKey?: string): Promise<{ file: VectorStoreFile }> {
    return this.request('POST', `/api/v1/vector-stores/${encodeURIComponent(storeId)}/files`, {
      filename,
      content,
    }, idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined);
  }

  /** Upload raw document bytes encoded as base64 (PDF, DOCX, and text formats). */
  addVectorStoreFileBase64(storeId: string, filename: string, contentBase64: string, mimeType?: string, idempotencyKey?: string): Promise<{ file: VectorStoreFile }> {
    return this.request('POST', `/api/v1/vector-stores/${encodeURIComponent(storeId)}/files`, {
      filename,
      contentBase64,
      mimeType: mimeType ?? 'application/octet-stream',
    }, idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined);
  }

  getVectorStoreFile(storeId: string, fileId: string): Promise<{ file: VectorStoreFile }> {
    return this.request(
      'GET',
      `/api/v1/vector-stores/${encodeURIComponent(storeId)}/files/${encodeURIComponent(fileId)}`,
    );
  }

  listVectorStoreFiles(storeId: string): Promise<{ files: VectorStoreFile[] }> {
    return this.request('GET', `/api/v1/vector-stores/${encodeURIComponent(storeId)}/files`);
  }

  cancelVectorStoreFileIngestion(storeId: string, fileId: string): Promise<{ file: VectorStoreFile }> {
    return this.request(
      'POST',
      `/api/v1/vector-stores/${encodeURIComponent(storeId)}/files/${encodeURIComponent(fileId)}/cancel`,
    );
  }

  deleteVectorStoreFile(storeId: string, fileId: string): Promise<{ ok: boolean }> {
    return this.request(
      'DELETE',
      `/api/v1/vector-stores/${encodeURIComponent(storeId)}/files/${encodeURIComponent(fileId)}`,
    );
  }

  searchVectorStore(storeId: string, query: string, maxResults?: number): Promise<{
    results: Array<{ filename: string; score: number; text: string }>;
  }> {
    return this.request('POST', `/api/v1/vector-stores/${encodeURIComponent(storeId)}/search`, {
      query,
      maxResults,
    });
  }

  // ---- chat sessions ----

  createChatSession(input: {
    workflowId: string;
    version?: number;
    user?: string;
    stateVariables?: JsonObject;
    expiresAfter?: number;
    deploymentId?: string;
    environment?: string;
    cohortKey?: string;
  }): Promise<ChatSessionCredentialResponse> {
    return this.request('POST', '/api/v1/chatkit/sessions', {
      workflow: {
        id: input.workflowId,
        version: input.version,
        state_variables: input.stateVariables,
      },
      user: input.user,
      expires_after: input.expiresAfter,
      deployment_id: input.deploymentId,
      environment: input.environment,
      cohort_key: input.cohortKey,
    });
  }

  listDeployments(workflowId?: string): Promise<{ deployments: ChatDeployment[] }> {
    return this.request('GET', `/api/v1/deployments${workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ''}`);
  }

  createDeployment(input: { workflowId: string; name?: string; environment: string; activeVersion?: number; allowedOrigins?: string[]; sessionRateLimitPerMinute?: number; maxActiveSessions?: number; maxConcurrentRuns?: number; maxRunsPerMinute?: number; maxRunsPerDay?: number; maxTokensPerDay?: number; maxEstimatedCostUsdPerDay?: number; unpricedCostPolicy?: 'deny' }, idempotencyKey?: string): Promise<{ deployment: ChatDeployment }> {
    return this.request('POST', '/api/v1/deployments', input, idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined);
  }

  updateDeployment(id: string, input: { expectedRevision: number; name?: string; allowedOrigins?: string[]; sessionRateLimitPerMinute?: number; maxActiveSessions?: number; maxConcurrentRuns?: number; maxRunsPerMinute?: number; maxRunsPerDay?: number; maxTokensPerDay?: number | null; maxEstimatedCostUsdPerDay?: number | null; unpricedCostPolicy?: 'deny' | null; status?: 'active' | 'paused' }): Promise<{ deployment: ChatDeployment }> {
    return this.request('PATCH', `/api/v1/deployments/${encodeURIComponent(id)}`, input);
  }

  listDeploymentSecrets(id: string): Promise<{ secrets: ScopedSecret[] }> {
    return this.request('GET', `/api/v1/deployments/${encodeURIComponent(id)}/secrets`);
  }

  createDeploymentSecret(id: string, input: CreateSecretInput): Promise<{ secret: ScopedSecret }> {
    return this.request('POST', `/api/v1/deployments/${encodeURIComponent(id)}/secrets`, input);
  }

  updateDeploymentSecret(id: string, secretId: string, input: UpdateSecretInput): Promise<{ secret: ScopedSecret }> {
    return this.request(
      'PATCH',
      `/api/v1/deployments/${encodeURIComponent(id)}/secrets/${encodeURIComponent(secretId)}`,
      input,
    );
  }

  deleteDeploymentSecret(id: string, secretId: string, expectedRevision: number): Promise<{ ok: boolean }> {
    return this.request(
      'DELETE',
      `/api/v1/deployments/${encodeURIComponent(id)}/secrets/${encodeURIComponent(secretId)}?expectedRevision=${expectedRevision}`,
    );
  }

  rolloutDeployment(id: string, version: number, expectedRevision: number): Promise<{ deployment: ChatDeployment }> {
    return this.request('POST', `/api/v1/deployments/${encodeURIComponent(id)}/rollout`, { version, expectedRevision });
  }

  rollbackDeployment(id: string, expectedRevision: number, version?: number): Promise<{ deployment: ChatDeployment }>;
  rollbackDeployment(id: string, input: { expectedRevision: number; releaseId?: string; version?: number }): Promise<{ deployment: ChatDeployment }>;
  rollbackDeployment(id: string, expectedRevisionOrInput: number | { expectedRevision: number; releaseId?: string; version?: number }, version?: number): Promise<{ deployment: ChatDeployment }> {
    const input = typeof expectedRevisionOrInput === 'number'
      ? { expectedRevision: expectedRevisionOrInput, ...(version === undefined ? {} : { version }) }
      : expectedRevisionOrInput;
    return this.request('POST', `/api/v1/deployments/${encodeURIComponent(id)}/rollback`, input);
  }

  deleteDeployment(id: string): Promise<{ deleted: true }> {
    return this.request('DELETE', `/api/v1/deployments/${encodeURIComponent(id)}`);
  }

  getDeployment(id: string): Promise<{ deployment: ChatDeployment }> {
    return this.request('GET', `/api/v1/deployments/${encodeURIComponent(id)}`);
  }

  getDeploymentUsage(id: string): Promise<{ usage: DeploymentUsage }> {
    return this.request('GET', `/api/v1/deployments/${encodeURIComponent(id)}/usage`);
  }

  listDeploymentReleases(id: string): Promise<{ releases: DeploymentRelease[] }> {
    return this.request('GET', `/api/v1/deployments/${encodeURIComponent(id)}/releases`);
  }

  stageDeployment(id: string, version: number, trafficPercent: number, expectedRevision: number): Promise<{ deployment: ChatDeployment }> {
    return this.request('POST', `/api/v1/deployments/${encodeURIComponent(id)}/stage`, { version, trafficPercent, expectedRevision });
  }

  promoteDeployment(id: string, expectedRevision: number): Promise<{ deployment: ChatDeployment }> {
    return this.request('POST', `/api/v1/deployments/${encodeURIComponent(id)}/promote`, { expectedRevision });
  }

  cancelStagedDeployment(id: string, expectedRevision: number): Promise<{ deployment: ChatDeployment }> {
    return this.request('POST', `/api/v1/deployments/${encodeURIComponent(id)}/cancel-stage`, { expectedRevision });
  }

  getDeploymentReleaseMetrics(id: string): Promise<{ metrics: DeploymentReleaseMetric[] }> {
    return this.request('GET', `/api/v1/deployments/${encodeURIComponent(id)}/release-metrics`);
  }

  getChatSession(id: string, clientSecret: string): Promise<{ session: ChatSession }> {
    return this.request('GET', `/api/v1/chatkit/sessions/${encodeURIComponent(id)}`, undefined, { 'x-chatkit-client-secret': clientSecret });
  }

  /** Mint a replacement secret. The previous secret becomes invalid immediately. */
  rotateChatSession(id: string, currentSecret: string): Promise<ChatSessionCredentialResponse> {
    return this.request('POST', `/api/v1/chatkit/sessions/${encodeURIComponent(id)}/rotate`, undefined, { 'x-chatkit-client-secret': currentSecret });
  }

  /** Revoke the session credential and cancel the session. */
  revokeChatSession(id: string, clientSecret: string): Promise<{ session: ChatSession }> {
    return this.request('POST', `/api/v1/chatkit/sessions/${encodeURIComponent(id)}/cancel`, undefined, { 'x-chatkit-client-secret': clientSecret });
  }

  cancelChatSession(id: string, clientSecret: string): Promise<{ session: ChatSession }> {
    return this.revokeChatSession(id, clientSecret);
  }

  createThread(sessionId: string, clientSecret: string): Promise<{ thread: ChatThread }> {
    return this.request('POST', `/api/v1/chatkit/sessions/${encodeURIComponent(sessionId)}/threads`, undefined, { 'x-chatkit-client-secret': clientSecret });
  }

  listThreads(sessionId: string, clientSecret: string): Promise<{ threads: ChatThread[] }> {
    return this.request('GET', `/api/v1/chatkit/sessions/${encodeURIComponent(sessionId)}/threads`, undefined, { 'x-chatkit-client-secret': clientSecret });
  }

  getThread(threadId: string, clientSecret: string): Promise<{ thread: ChatThread }> {
    return this.request('GET', `/api/v1/chatkit/threads/${encodeURIComponent(threadId)}`, undefined, { 'x-chatkit-client-secret': clientSecret });
  }

  /** Send a chat turn; stream the returned run's events for live output. */
  sendChatMessage(threadId: string, text: string, clientSecret: string, idempotencyKey?: string, attachments?: RunAttachment[]): Promise<{ thread: ChatThread; run: Run }> {
    return this.request('POST', `/api/v1/chatkit/threads/${encodeURIComponent(threadId)}/messages`, {
      text,
      ...(attachments?.length ? { attachments } : {}),
    }, {
      'x-chatkit-client-secret': clientSecret,
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    });
  }
}

export default AgentBuilderClient;
