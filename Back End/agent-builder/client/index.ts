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
  latestVersion: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  categories: string[];
}

export type EvaluationGraderType = 'contains' | 'equals' | 'regex' | 'run_status' | 'event_count';

export interface EvaluationGrader {
  id: string;
  name: string;
  type: EvaluationGraderType;
  target?: 'output' | 'error';
  expected: JsonValue;
  eventType?: string;
}

export interface EvaluationDefinition {
  id: string;
  workflowId: string;
  name: string;
  graders: EvaluationGrader[];
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationRun {
  id: string;
  evaluationId: string;
  workflowId: string;
  runIds: string[];
  score: number;
  results: Array<{
    runId: string;
    status: RunStatus;
    score: number;
    results: Array<{
      graderId: string;
      name: string;
      passed: boolean;
      score: number;
      detail: string;
    }>;
  }>;
  createdAt: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  draft: { nodes: JsonObject[]; edges: JsonObject[] };
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
}

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
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

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  contracts: NodeDataContract[];
}

export type RunStatus =
  | 'queued' | 'running' | 'awaiting_approval' | 'awaiting_client_tool'
  | 'completed' | 'failed' | 'cancelled';

export interface PendingApproval {
  id: string;
  runId: string;
  nodeId: string;
  kind: 'user_approval' | 'mcp_tool' | 'client_tool';
  message: string;
  toolCall?: { server?: string; tool: string; arguments: JsonObject };
  createdAt: string;
}

export interface Run {
  id: string;
  workflowId: string;
  workflowVersion: number;
  sessionId?: string;
  status: RunStatus;
  input: JsonObject;
  output?: JsonValue;
  state?: JsonObject;
  error?: string;
  pendingApproval?: PendingApproval;
  usage: { inputTokens: number; outputTokens: number; llmCalls: number; toolCalls: number };
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface RunEvent {
  type: string;
  runId: string;
  at: string;
  [k: string]: JsonValue | PendingApproval | undefined;
}

export interface RunInput {
  input_as_text?: string;
  variables?: JsonObject;
  state_variables?: JsonObject;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

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
  url?: string;
  features?: string[];
  authHint?: 'oauth' | 'token' | 'none';
}

export interface VectorStore {
  id: string;
  name: string;
  fileCount: number;
  chunkCount: number;
  embedder: string;
  createdAt: string;
  updatedAt: string;
}

export interface VectorStoreFile {
  id: string;
  storeId: string;
  filename: string;
  bytes: number;
  chunkCount: number;
  status: 'processing' | 'ready' | 'error';
  error?: string;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  sessionId: string;
  workflowId: string;
  messages: Array<{ id: string; role: string; content: string; runId?: string; at?: string }>;
  state?: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  description?: string;
}

// ---- client ----

export interface AgentBuilderClientOptions {
  baseUrl?: string;
  /** Bearer token when the server sets AGENT_BUILDER_API_TOKEN. */
  apiToken?: string;
  /** Per-request LLM keys (e.g. from UserDataContext.apiKeys). */
  providerKeys?: ProviderKeys | (() => ProviderKeys | undefined);
  fetch?: typeof fetch;
}

export class AgentBuilderApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AgentBuilderApiError';
    this.status = status;
    this.code = code;
  }
}

export class AgentBuilderClient {
  readonly baseUrl: string;
  private apiToken?: string;
  private providerKeys?: AgentBuilderClientOptions['providerKeys'];
  private fetchImpl: typeof fetch;

  constructor(opts: AgentBuilderClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
    this.apiToken = opts.apiToken;
    this.providerKeys = opts.providerKeys;
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
  }

  private keys(): ProviderKeys | undefined {
    return typeof this.providerKeys === 'function' ? this.providerKeys() : this.providerKeys;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;
    const keys = this.keys();
    if (keys) headers['x-provider-keys'] = JSON.stringify(keys);

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
      const err = (data as { error?: { code?: string; message?: string } })?.error;
      throw new AgentBuilderApiError(res.status, err?.code ?? 'error', err?.message ?? `HTTP ${res.status}`);
    }
    return data as T;
  }

  // ---- health / settings / models ----

  health(): Promise<{ ok: boolean; version: string }> {
    return this.request('GET', '/api/v1/health');
  }

  getStoredKeys(): Promise<{ keys: Record<string, string[]> }> {
    return this.request('GET', '/api/v1/settings/keys');
  }

  saveStoredKeys(keys: ProviderKeys): Promise<{ ok: boolean }> {
    return this.request('PUT', '/api/v1/settings/keys', keys);
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

  updateWorkflow(id: string, patch: { name?: string; description?: string }): Promise<{ workflow: Workflow }> {
    return this.request('PATCH', `/api/v1/workflows/${encodeURIComponent(id)}`, patch);
  }

  deleteWorkflow(id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/v1/workflows/${encodeURIComponent(id)}`);
  }

  /** Autosave the canvas graph (raw React Flow nodes/edges JSON is accepted). */
  saveDraft(id: string, graph: unknown): Promise<{ workflow: Workflow; validation: ValidationResult }> {
    return this.request('PUT', `/api/v1/workflows/${encodeURIComponent(id)}/draft`, { graph });
  }

  validateGraph(id: string, graph?: unknown): Promise<{ validation: ValidationResult }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(id)}/validate`, graph ? { graph } : {});
  }

  publishWorkflow(id: string, notes?: string): Promise<{
    workflow: Workflow;
    version: { version: number };
    validation: ValidationResult;
  }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(id)}/publish`, { notes });
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

  restoreVersion(id: string, version: number): Promise<{
    workflow: Workflow;
    validation: ValidationResult;
  }> {
    return this.request(
      'POST',
      `/api/v1/workflows/${encodeURIComponent(id)}/versions/${version}/restore`,
    );
  }

  exportCode(id: string, format: 'typescript' | 'python', version?: number): Promise<{ format: string; code: string }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(id)}/export`, { format, version });
  }

  // ---- runs ----

  startRun(workflowId: string, input: RunInput, version?: number): Promise<{ run: Run }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(workflowId)}/runs`, {
      input,
      version,
    });
  }

  getRun(runId: string): Promise<{ run: Run }> {
    return this.request('GET', `/api/v1/runs/${encodeURIComponent(runId)}`);
  }

  listRuns(workflowId: string, limit = 50): Promise<{ runs: Run[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(workflowId)}/runs?limit=${limit}`);
  }

  listEvaluations(workflowId: string): Promise<{ evaluations: EvaluationDefinition[] }> {
    return this.request('GET', `/api/v1/workflows/${encodeURIComponent(workflowId)}/evaluations`);
  }

  createEvaluation(workflowId: string, input: {
    name: string;
    graders: EvaluationGrader[];
  }): Promise<{ evaluation: EvaluationDefinition }> {
    return this.request('POST', `/api/v1/workflows/${encodeURIComponent(workflowId)}/evaluations`, input);
  }

  updateEvaluation(id: string, input: {
    name?: string;
    graders?: EvaluationGrader[];
  }): Promise<{ evaluation: EvaluationDefinition }> {
    return this.request('PATCH', `/api/v1/evaluations/${encodeURIComponent(id)}`, input);
  }

  deleteEvaluation(id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/v1/evaluations/${encodeURIComponent(id)}`);
  }

  getEvaluation(id: string): Promise<{ evaluation: EvaluationDefinition }> {
    return this.request('GET', `/api/v1/evaluations/${encodeURIComponent(id)}`);
  }

  runEvaluation(id: string, runIds?: string[]): Promise<{ run: EvaluationRun }> {
    return this.request('POST', `/api/v1/evaluations/${encodeURIComponent(id)}/run`, runIds ? { runIds } : {});
  }

  listEvaluationRuns(id: string): Promise<{ runs: EvaluationRun[] }> {
    return this.request('GET', `/api/v1/evaluations/${encodeURIComponent(id)}/runs`);
  }

  getTrace(runId: string): Promise<{ events: RunEvent[] }> {
    return this.request('GET', `/api/v1/runs/${encodeURIComponent(runId)}/trace`);
  }

  cancelRun(runId: string): Promise<{ run: Run }> {
    return this.request('POST', `/api/v1/runs/${encodeURIComponent(runId)}/cancel`);
  }

  /** Approve/reject a pending user approval or MCP tool call. */
  resolveApproval(runId: string, approvalId: string, approved: boolean): Promise<{ run: Run }> {
    return this.request(
      'POST',
      `/api/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
      { approved },
    );
  }

  /** Provide the result of a client-executed tool. */
  submitClientToolResult(runId: string, approvalId: string, result: JsonValue): Promise<{ run: Run }> {
    return this.request(
      'POST',
      `/api/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
      { result },
    );
  }

  /**
   * Stream run events over SSE. Returns a disposer. Uses fetch-based streaming
   * (EventSource can't send auth headers).
   */
  streamRunEvents(
    runId: string,
    onEvent: (event: RunEvent) => void,
    opts: { replay?: boolean; onError?: (err: Error) => void; onDone?: () => void } = {},
  ): () => void {
    const controller = new AbortController();
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;
    const replay = opts.replay === false ? '?replay=false' : '';

    void (async () => {
      try {
        const res = await this.fetchImpl(
          `${this.baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/events${replay}`,
          { headers, signal: controller.signal },
        );
        if (!res.ok || !res.body) {
          throw new Error(`SSE HTTP ${res.status}`);
        }
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
            let data = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (eventType === 'done') {
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
        opts.onDone?.();
      } catch (e) {
        if (!controller.signal.aborted) opts.onError?.(e as Error);
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
    auth?: JsonObject;
    connect?: boolean;
  }): Promise<{ server: McpServer; warning?: string }> {
    return this.request('POST', '/api/v1/mcp/servers', input);
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

  /** Upload a text file (pass file contents; binary should be text-extracted first). */
  addVectorStoreFile(storeId: string, filename: string, content: string): Promise<{ file: VectorStoreFile }> {
    return this.request('POST', `/api/v1/vector-stores/${encodeURIComponent(storeId)}/files`, {
      filename,
      content,
    });
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
  }): Promise<{ session: JsonObject; client_secret: string; expires_at: string }> {
    return this.request('POST', '/api/v1/chatkit/sessions', {
      workflow: {
        id: input.workflowId,
        version: input.version,
        state_variables: input.stateVariables,
      },
      user: input.user,
      expires_after: input.expiresAfter,
    });
  }

  cancelChatSession(id: string): Promise<{ session: JsonObject }> {
    return this.request('POST', `/api/v1/chatkit/sessions/${encodeURIComponent(id)}/cancel`);
  }

  createThread(sessionId: string): Promise<{ thread: ChatThread }> {
    return this.request('POST', `/api/v1/chatkit/sessions/${encodeURIComponent(sessionId)}/threads`);
  }

  listThreads(sessionId: string): Promise<{ threads: ChatThread[] }> {
    return this.request('GET', `/api/v1/chatkit/sessions/${encodeURIComponent(sessionId)}/threads`);
  }

  getThread(threadId: string): Promise<{ thread: ChatThread }> {
    return this.request('GET', `/api/v1/chatkit/threads/${encodeURIComponent(threadId)}`);
  }

  /** Send a chat turn; stream the returned run's events for live output. */
  sendChatMessage(threadId: string, text: string): Promise<{ thread: ChatThread; run: Run }> {
    return this.request('POST', `/api/v1/chatkit/threads/${encodeURIComponent(threadId)}/messages`, {
      text,
    });
  }
}

export default AgentBuilderClient;
