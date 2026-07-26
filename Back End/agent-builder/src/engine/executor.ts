/**
 * Run engine: creates runs, executes the graph interpreter loop, persists
 * trace events, streams them to subscribers, and handles pause/resume
 * (user approvals, MCP tool approvals, client tools) plus cancellation.
 */

import type { AppConfig } from '../config.ts';
import { createHash } from 'node:crypto';
import { normalizeGraph } from '../domain/normalize.ts';
import type {
  ChatMessage,
  ChatThread,
  ApprovalActor,
  BatchJob,
  JsonObject,
  JsonValue,
  PendingApproval,
  NestedRunWait,
  Run,
  RunAttachment,
  RunEvent,
  RunInput,
  RunUsage,
  StartNodeConfig,
  Workflow,
  WorkflowGraph,
  WorkflowVersion,
  ProviderKeys,
} from '../domain/types.ts';
import { validateGraph } from '../domain/validate.ts';
import type { McpManager } from '../mcp/manager.ts';
import type { VectorStoreService } from '../rag/vectorStore.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { PRICING_CATALOG_VERSION, priceModelUsage } from '../services/pricing.ts';
import { loadProviderKeys } from '../services/providerCredentials.ts';
import { providerForModel } from '../providers/types.ts';
import { resolveKey } from '../providers/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { createLogger } from '../util/log.ts';
import { DEFAULT_SUBJECT_ID, DEFAULT_WORKSPACE_ID, type AuthPrincipal } from '../services/governance.ts';
import type { SecretService } from '../services/secrets.ts';
import { buildScope, type EngineCheckpoint, type RunContext } from './context.ts';
import { coerceToVarType } from './jsonSchema.ts';
import { buildTraceSpans } from './trace.ts';
import { compareTraceRuns, portableTraceExport, type PortableTraceExport, type TraceComparison } from './traceCompare.ts';
import { sanitizeTraceValue, summarizeTraceStructure } from './traceData.ts';
import { initialState, NODE_EXECUTORS } from './nodes/index.ts';
import { extractDocumentText } from '../rag/extractText.ts';

function emptyRunUsage(): RunUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    llmCalls: 0,
    toolCalls: 0,
    estimatedCostUsd: 0,
    unpricedLlmCalls: 0,
    embeddingInputTokens: 0,
    embeddingOperations: 0,
    unpricedEmbeddingOperations: 0,
    pricingCatalogVersion: PRICING_CATALOG_VERSION,
    byModel: {},
    byEmbeddingModel: {},
  };
}

function ensureDetailedUsage(run: Run): void {
  if (run.usage.byModel === undefined) {
    run.usage.estimatedCostUsd = 0;
    run.usage.unpricedLlmCalls = run.usage.llmCalls;
    run.usage.pricingCatalogVersion = 'legacy-unversioned';
    run.usage.byModel = {};
  }
  run.usage.embeddingInputTokens ??= 0;
  run.usage.embeddingOperations ??= 0;
  run.usage.unpricedEmbeddingOperations ??= 0;
  run.usage.byEmbeddingModel ??= {};
}

const log = createLogger('engine');

export interface StartRunInput {
  workflowId: string;
  /** 0 = draft, -1 = latest published, n = specific version. */
  version?: number;
  input: RunInput;
  sessionId?: string;
  deploymentId?: string;
  deploymentReleaseId?: string;
  deploymentRevision?: number;
  deploymentRunAdmissionId?: string;
  ownerId?: string;
  workspaceId?: string;
  parentRunId?: string;
  parentNodeId?: string;
  rootRunId?: string;
  runDepth?: number;
  workflowAncestry?: string[];
  requestKeys?: ProviderKeys;
  idempotencyKey?: string;
  debug?: { breakpointNodeIds?: string[]; pauseBeforeFirst?: boolean };
  /** Internal immutable graph override for reproducible deferred execution. */
  graphSnapshot?: WorkflowGraph;
}

type Subscriber = (event: RunEvent, seq: number) => void;

interface PersistedEvent {
  seq: number;
  event: RunEvent;
}

interface RunIdempotencyClaim {
  signature: string;
  runId: string;
  createdAt: string;
}

interface RunLease {
  owner: string;
  expiresAt: string;
}

type CredentialProvider = 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm';

export class CredentialsRequiredError extends Error {
  providers: CredentialProvider[];
  constructor(providers: CredentialProvider[]) {
    super(`credentials required to continue run for provider(s): ${providers.join(', ')}; supply x-provider-keys or configure stored settings`);
    this.name = 'CredentialsRequiredError';
    this.providers = providers;
  }
}

function providersReachableFrom(graph: WorkflowGraph, startIds: string[]): CredentialProvider[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const providers = new Set<CredentialProvider>();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node || node.type === 'note') continue;
    if (node.type === 'agent') {
      const provider = providerForModel(String(node.config.model ?? ''));
      if (provider !== 'mock') providers.add(provider);
      // Handoffs are dynamic edges and are not present in graph.edges. Include
      // their targets in credential reachability so a delegated agent pauses
      // for credentials instead of failing inside its first model call.
      const handoffs = Array.isArray(node.config.handoffs)
        ? node.config.handoffs as unknown as Array<{ targetNodeId?: unknown }>
        : [];
      for (const handoff of handoffs) {
        if (typeof handoff.targetNodeId === 'string' && handoff.targetNodeId.trim()) queue.push(handoff.targetNodeId);
      }
    } else if (node.type === 'guardrail' &&
        (node.config.moderation === true || node.config.jailbreak === true || node.config.hallucination === true)) {
      const settings = node.config.settings as JsonObject | undefined;
      // Guardrails have a deterministic heuristic path and their default
      // classifier is intentionally best-effort (the node reports an error
      // when no key is available). Only an explicitly configured classifier
      // model participates in run-level credential preflight.
      const configuredModel = typeof settings?.checkModel === 'string' ? settings.checkModel : undefined;
      if (configuredModel) {
        const provider = providerForModel(configuredModel);
        if (provider !== 'mock') providers.add(provider);
      }
    }
    for (const edge of graph.edges) {
      if (edge.source === id && byId.get(edge.target)?.type !== 'note') queue.push(edge.target);
    }
  }
  return [...providers].sort();
}

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AUDIO_MIME_TYPES = new Set(['audio/aac', 'audio/flac', 'audio/mp3', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-wav']);
const VIDEO_MIME_TYPES = new Set(['video/3gpp', 'video/avi', 'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/x-flv', 'video/x-ms-wmv', 'video/x-msvideo']);
const DOCUMENT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

async function normalizeRunInput(graph: WorkflowGraph, raw: RunInput | undefined): Promise<RunInput> {
  const input = structuredClone(raw ?? {});
  if (input.input_as_text !== undefined && typeof input.input_as_text !== 'string') {
    throw new Error("invalid run input: 'input_as_text' must be a string");
  }
  if (input.variables !== undefined && (!input.variables || typeof input.variables !== 'object' || Array.isArray(input.variables))) {
    throw new Error("invalid run input: 'variables' must be a JSON object");
  }
  if (input.state_variables !== undefined && (!input.state_variables || typeof input.state_variables !== 'object' || Array.isArray(input.state_variables))) {
    throw new Error("invalid run input: 'state_variables' must be a JSON object");
  }
  if (input.attachments !== undefined) {
    if (!Array.isArray(input.attachments)) throw new Error("invalid run input: 'attachments' must be an array");
    if (input.attachments.length > 8) throw new Error('invalid run input: attachments cannot exceed 8 files');
    let totalBytes = 0;
    const normalized: RunAttachment[] = [];
    for (const [index, rawAttachment] of input.attachments.entries()) {
      if (!rawAttachment || typeof rawAttachment !== 'object' || Array.isArray(rawAttachment)) throw new Error(`invalid run input: attachment ${index + 1} must be an object`);
      const attachment = rawAttachment as unknown as Record<string, unknown>;
      const name = typeof attachment.name === 'string' ? attachment.name.trim() : '';
      const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.toLowerCase().split(';')[0].trim() : '';
      if (!name || name.length > 255 || /[\\/\0]/.test(name)) throw new Error(`invalid run input: attachment ${index + 1} has an invalid name`);
      if (!IMAGE_MIME_TYPES.has(mimeType) && !AUDIO_MIME_TYPES.has(mimeType) && !VIDEO_MIME_TYPES.has(mimeType) && !DOCUMENT_MIME_TYPES.has(mimeType)) throw new Error(`invalid run input: attachment '${name}' has unsupported MIME type '${mimeType}'`);
      if (typeof attachment.contentBase64 !== 'string' || !isCanonicalBase64(attachment.contentBase64)) {
        throw new Error(`invalid run input: attachment '${name}' needs base64 content`);
      }
      const bytes = Buffer.from(attachment.contentBase64, 'base64');
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error(`invalid run input: attachment '${name}' exceeds 5 MB`);
      totalBytes += bytes.byteLength;
      if (totalBytes > 20 * 1024 * 1024) throw new Error('invalid run input: attachments exceed 20 MB total');
      const kind = IMAGE_MIME_TYPES.has(mimeType)
        ? 'image'
        : AUDIO_MIME_TYPES.has(mimeType)
          ? 'audio'
          : VIDEO_MIME_TYPES.has(mimeType)
            ? 'video'
            : 'document';
      const extractedText = kind === 'document'
        ? await extractDocumentText(name, bytes, mimeType)
        : undefined;
      normalized.push({
        name,
        mimeType,
        contentBase64: bytes.toString('base64'),
        kind,
        ...(extractedText !== undefined ? { extractedText } : {}),
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    input.attachments = normalized;
  }

  const start = graph.nodes.find((node) => node.type === 'start');
  const config = (start?.config ?? {}) as unknown as StartNodeConfig;
  const inputDecls = new Map(
    (config.inputVariables ?? [])
      .filter((decl) => decl.name !== 'input_as_text')
      .map((decl) => [decl.name, decl]),
  );
  const stateDecls = new Map((config.stateVariables ?? []).map((decl) => [decl.name, decl]));

  const providedVariables = input.variables ?? {};
  if (input.variables || inputDecls.size > 0) {
    const normalized: JsonObject = {};
    for (const [name, value] of Object.entries(providedVariables)) {
      const declaration = inputDecls.get(name);
      if (!declaration) {
        throw new Error(`invalid run input: unknown workflow variable '${name}'`);
      }
      try {
        normalized[name] = coerceToVarType(value, declaration.type) as JsonObject[string];
      } catch (error) {
        throw new Error(
          `invalid run input: workflow variable '${name}' must be ${declaration.type}: ${(error as Error).message}`,
        );
      }
    }
    for (const declaration of inputDecls.values()) {
      if (!(declaration.name in providedVariables)) {
        if (declaration.defaultValue !== undefined) {
          normalized[declaration.name] = coerceToVarType(declaration.defaultValue, declaration.type) as JsonObject[string];
        } else {
          throw new Error(`invalid run input: missing required workflow variable '${declaration.name}'`);
        }
      }
    }
    input.variables = normalized;
  }

  if (input.state_variables) {
    const normalized: JsonObject = {};
    for (const [name, value] of Object.entries(input.state_variables)) {
      const declaration = stateDecls.get(name);
      if (!declaration) {
        throw new Error(`invalid run input: unknown state variable '${name}'`);
      }
      try {
        normalized[name] = coerceToVarType(value, declaration.type) as JsonObject[string];
      } catch (error) {
        throw new Error(
          `invalid run input: state variable '${name}' must be ${declaration.type}: ${(error as Error).message}`,
        );
      }
    }
    input.state_variables = normalized;
  }

  return input;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export class RunEngine {
  private subscribers = new Map<string, Set<Subscriber>>();
  private aborts = new Map<string, AbortController>();
  private eventSeq = new Map<string, number>();
  private active = 0;
  private queue: Array<() => void> = [];
  private approvalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Request-scoped provider keys may need to cross an asynchronous subflow
   * return, but must never be serialized into a run or checkpoint. */
  private transientProviderKeys = new Map<string, ProviderKeys>();
  private runCreationLocks = new Map<string, { request: string; promise: Promise<Run> }>();
  private debugResuming = new Set<string>();
  private retentionPromise?: Promise<Record<string, unknown>>;
  private readonly leaseOwner = ids.run();

  private storage: Storage;
  private config: AppConfig;
  private mcp: McpManager;
  private vectorStores: VectorStoreService;
  private secrets: SecretService;

  constructor(
    storage: Storage,
    config: AppConfig,
    mcp: McpManager,
    vectorStores: VectorStoreService,
    secrets: SecretService,
  ) {
    this.storage = storage;
    this.config = config;
    this.mcp = mcp;
    this.vectorStores = vectorStores;
    this.secrets = secrets;
  }

  // ------------------------------------------------------------------
  // events
  // ------------------------------------------------------------------

  subscribe(runId: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.subscribers.set(runId, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) this.subscribers.delete(runId);
    };
  }

  async pastEvents(runId: string): Promise<RunEvent[]> {
    return (await this.pastEventRecords(runId)).map((record) => record.event);
  }

  async pastEventRecords(runId: string, after = 0): Promise<PersistedEvent[]> {
    const rows = await this.storage.list<PersistedEvent>(COLLECTIONS.spans, { ref: runId });
    return rows
      .map((r) => r.doc)
      .sort((a, b) => a.seq - b.seq)
      .filter((record) => record.seq > after);
  }

  async traceSpans(runId: string): Promise<import('../domain/types.ts').TraceSpan[] | undefined> {
    const run = await this.getRun(runId);
    if (!run) return undefined;
    return buildTraceSpans(run, await this.pastEvents(runId));
  }

  async incrementalTraceSpans(runId: string, after: number): Promise<{
    spans: import('../domain/types.ts').TraceSpan[];
    cursor: number;
  } | undefined> {
    const run = await this.getRun(runId);
    if (!run) return undefined;
    const records = await this.pastEventRecords(runId);
    const cursor = records.at(-1)?.seq ?? 0;
    const all = buildTraceSpans(run, records.map((record) => record.event));
    if (after <= 0) return { spans: all, cursor };
    if (after >= cursor) return { spans: [], cursor };
    const before = buildTraceSpans(
      run,
      records.filter((record) => record.seq <= after).map((record) => record.event),
    );
    const previous = new Map(before.map((span) => [span.id, JSON.stringify(span)]));
    return {
      spans: all.filter((span) => previous.get(span.id) !== JSON.stringify(span)),
      cursor,
    };
  }

  async compareRuns(leftRunId: string, rightRunId: string): Promise<TraceComparison | undefined> {
    const [left, right] = await Promise.all([this.getRun(leftRunId), this.getRun(rightRunId)]);
    if (!left || !right) return undefined;
    const [leftSpans, rightSpans] = await Promise.all([this.traceSpans(leftRunId), this.traceSpans(rightRunId)]);
    return compareTraceRuns(left, right, leftSpans ?? [], rightSpans ?? []);
  }

  async portableTraceExport(runId: string): Promise<PortableTraceExport | undefined> {
    const run = await this.getRun(runId);
    if (!run) return undefined;
    const [events, spans] = await Promise.all([this.pastEvents(runId), this.traceSpans(runId)]);
    return portableTraceExport(run, events, spans ?? []);
  }

  private async emit(runId: string, event: RunEvent): Promise<void> {
    if (!this.eventSeq.has(runId)) {
      const existing = await this.storage.count(COLLECTIONS.spans, runId);
      this.eventSeq.set(runId, existing);
    }
    const seq = (this.eventSeq.get(runId) ?? 0) + 1;
    this.eventSeq.set(runId, seq);
    const persistedEvent = sanitizeTraceValue(event) as unknown as RunEvent;
    await this.storage.put(
      COLLECTIONS.spans,
      `${runId}_e${String(seq).padStart(6, '0')}`,
      { seq, event: persistedEvent },
      runId,
    );
    const subs = this.subscribers.get(runId);
    if (subs) {
      for (const fn of subs) {
        try {
          fn(persistedEvent, seq);
        } catch { /* subscriber errors must not break the run */ }
      }
    }
    if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') {
      void this.maybeEnforceTraceRetention().catch((error) => log.error(`trace retention failed: ${(error as Error).message}`));
    }
  }

  // ------------------------------------------------------------------
  // run lifecycle
  // ------------------------------------------------------------------

  /** Resume only checkpoints proven to be between nodes. In-flight outcomes
   * are uncertain and must never be replayed blindly. */
  async recoverInterruptedRuns(): Promise<number> {
    const rows = await this.storage.list<Run>(COLLECTIONS.runs);
    let n = 0;
    for (const { doc } of rows) {
      const run = await this.normalizeRunOwnership(doc);
      if (run.status === 'queued') {
        const graph = run.graph ?? normalizeGraph((await this.resolveGraph(run.workflowId, run.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
        const missing = await this.missingCredentials(providersReachableFrom(graph, [(run.checkpoint as unknown as EngineCheckpoint | undefined)?.currentNodeId ?? graph.nodes.find((node) => node.type === 'start')!.id]), undefined, run.workspaceId);
        if (missing.length) {
          if (await this.markCredentialsRequired(run, missing, 'queued')) n++;
          continue;
        }
        await this.emit(run.id, { type: 'run.recovered', runId: run.id, nodeId: (run.checkpoint as unknown as EngineCheckpoint | undefined)?.currentNodeId ?? undefined, at: nowIso() });
        this.schedule(run.id, graph);
        n++;
      } else if (run.status === 'running' && run.checkpoint) {
        const checkpoint = run.checkpoint as unknown as EngineCheckpoint;
        const interruptedGraph = run.graph ?? normalizeGraph((await this.resolveGraph(run.workflowId, run.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
        const interruptedNode = checkpoint.inFlightNode ? interruptedGraph.nodes.find((node) => node.id === checkpoint.inFlightNode!.nodeId) : undefined;
        // Subflow execution is idempotent by its deterministic child key. Requeue
        // any interrupted subflow node, even if the parent checkpoint was not
        // persisted after child creation; the executor will reattach or create
        // the same child rather than blindly duplicating work.
        if (interruptedNode?.type === 'subflow') {
          run.status = 'queued';
          const claimed = await this.storage.compareAndSwap(COLLECTIONS.runs, run.id, 'status', 'running', run, run.workflowId);
          if (!claimed) continue;
          await this.emit(run.id, { type: 'run.recovered', runId: run.id, nodeId: interruptedNode.id, at: nowIso() });
          this.schedule(run.id, interruptedGraph);
          n++;
          continue;
        }
        if (checkpoint.boundaryVersion === 1 && !checkpoint.inFlightNode) {
          const graph = run.graph ?? normalizeGraph((await this.resolveGraph(run.workflowId, run.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
          const missing = await this.missingCredentials(providersReachableFrom(graph, checkpoint.currentNodeId ? [checkpoint.currentNodeId] : []), undefined, run.workspaceId);
          if (missing.length) {
            if (await this.markCredentialsRequired(run, missing, 'running')) n++;
            continue;
          }
          run.status = 'queued';
          const claimed = await this.storage.compareAndSwap(
            COLLECTIONS.runs,
            run.id,
            'status',
            'running',
            run,
            run.workflowId,
          );
          if (!claimed) continue;
          await this.emit(run.id, { type: 'run.recovered', runId: run.id, nodeId: checkpoint.currentNodeId ?? undefined, at: nowIso() });
          this.schedule(run.id, graph);
          n++;
          continue;
        }
        run.status = 'failed';
        run.error = checkpoint.inFlightNode
          ? `interrupted by server restart while node '${checkpoint.inFlightNode.nodeId}' was in flight; execution outcome is uncertain`
          : 'interrupted by server restart with a legacy checkpoint whose execution boundary is uncertain';
        run.endedAt = nowIso();
        await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
        await this.completeDeploymentAdmission(run);
        await this.emit(run.id, {
          type: 'run.failed',
          runId: run.id,
          error: run.error,
          at: nowIso(),
        });
        n++;
      } else if ((run.status === 'awaiting_approval' || run.status === 'awaiting_client_tool') && !run.nestedWait && run.pendingApproval?.expiresAt) {
        this.armApprovalTimeout(run.id, run.pendingApproval);
      }
    }
    // Reconcile parent waits whose child changed while this process was down.
    for (const { doc } of rows) {
      if (!doc.nestedWait) continue;
      const child = await this.getRun(doc.nestedWait.childRunId);
      if (!child) continue;
      const childLeaf = child.nestedWait?.leafRunId ?? child.id;
      const childApproval = child.nestedWait?.leafApprovalId ?? child.pendingApproval?.id;
      if (child.status !== doc.status || childLeaf !== doc.nestedWait.leafRunId || childApproval !== doc.nestedWait.leafApprovalId) {
        await this.wakeWaitingParent(child);
        n++;
      }
    }
    if (n) log.warn(`recovered or safely settled ${n} interrupted run(s) after restart`);
    return n;
  }

  private async missingCredentials(
    providers: CredentialProvider[],
    requestKeys?: ProviderKeys,
    workspaceId?: string,
  ): Promise<CredentialProvider[]> {
    const stored = await loadProviderKeys(this.storage, workspaceId);
    return providers.filter((provider) => {
      try {
        resolveKey(provider, requestKeys, stored);
        return false;
      } catch {
        return true;
      }
    });
  }

  private async markCredentialsRequired(run: Run, providers: CredentialProvider[], expectedStatus?: Run['status']): Promise<boolean> {
    run.status = 'awaiting_credentials';
    run.credentialRequirements = { providers };
    if (expectedStatus) {
      const changed = await this.storage.compareAndSwap(COLLECTIONS.runs, run.id, 'status', expectedStatus, run, run.workflowId);
      if (!changed) return false;
    } else {
      await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
    }
    await this.emit(run.id, { type: 'credentials.required', runId: run.id, providers, at: nowIso() });
    return true;
  }

  /** Wake a mirrored parent after a child changes state. The compare-and-swap
   * prevents a late child transition from resurrecting a cancelled parent. */
  private async wakeWaitingParent(child: Run): Promise<void> {
    if (!child.parentRunId) return;
    const parent = await this.getRun(child.parentRunId);
    if (!parent?.nestedWait || parent.nestedWait.childRunId !== child.id) return;
    if (!['awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug'].includes(parent.status)) return;
    const expected = parent.status;
    const wait = parent.nestedWait;
    parent.status = 'queued';
    parent.pendingApproval = undefined;
    parent.debugPause = undefined;
    parent.credentialRequirements = undefined;
    const changed = await this.storage.compareAndSwap(COLLECTIONS.runs, parent.id, 'status', expected, parent, parent.workflowId);
    if (!changed) return;
    await this.emit(parent.id, { type: 'subflow.resumed', runId: parent.id, nodeId: wait.parentNodeId, childRunId: wait.childRunId, leafRunId: wait.leafRunId, at: nowIso() });
    const graph = parent.graph ?? normalizeGraph((await this.resolveGraph(parent.workflowId, parent.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
    this.schedule(parent.id, graph);
  }

  async resumeRun(runId: string, requestKeys?: ProviderKeys, suppressParentWake = false): Promise<Run> {
    const run = await this.getRun(runId);
    if (!run) throw new Error(`run '${runId}' not found`);
    if (run.status !== 'awaiting_credentials') {
      throw new Error(`run '${runId}' is not awaiting credentials (status: ${run.status})`);
    }
    if (run.nestedWait) {
      const child = await this.getRun(run.nestedWait.childRunId);
      if (!child) throw new Error(`subflow child run '${run.nestedWait.childRunId}' not found`);
      await this.resumeRun(child.id, requestKeys, true);
      run.status = 'queued';
      run.credentialRequirements = undefined;
      await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
      await this.emit(run.id, { type: 'subflow.resumed', runId: run.id, nodeId: run.nestedWait.parentNodeId, childRunId: run.nestedWait.childRunId, leafRunId: run.nestedWait.leafRunId, at: nowIso() });
      const parentGraph = run.graph ?? normalizeGraph((await this.resolveGraph(run.workflowId, run.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
      this.schedule(run.id, parentGraph, requestKeys);
      if (!suppressParentWake) await this.wakeWaitingParent(run);
      return run;
    }
    const graph = run.graph ?? normalizeGraph((await this.resolveGraph(run.workflowId, run.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
    const checkpoint = run.checkpoint as unknown as EngineCheckpoint;
    const providers = providersReachableFrom(graph, checkpoint.currentNodeId ? [checkpoint.currentNodeId] : []);
    const missing = await this.missingCredentials(providers, requestKeys, run.workspaceId);
    if (missing.length) {
      run.credentialRequirements = { providers: missing };
      await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
      throw new CredentialsRequiredError(missing);
    }
    run.credentialRequirements = undefined;
    run.status = 'queued';
    await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
    this.schedule(run.id, graph, requestKeys);
    if (!suppressParentWake) await this.wakeWaitingParent(run);
    return run;
  }

  private async acquireRunLease(runId: string): Promise<{ acquired: boolean; retryAfterMs?: number }> {
    const id = runId;
    const lease = (): RunLease => ({ owner: this.leaseOwner, expiresAt: new Date(Date.now() + 30_000).toISOString() });
    if (await this.storage.putIfAbsent(COLLECTIONS.runLeases, id, lease(), runId)) return { acquired: true };
    const existing = await this.storage.get<RunLease>(COLLECTIONS.runLeases, id);
    if (!existing) return { acquired: false, retryAfterMs: 50 };
    if (Date.now() < new Date(existing.expiresAt).getTime()) {
      return existing.owner === this.leaseOwner
        ? { acquired: false }
        : { acquired: false, retryAfterMs: Math.max(50, new Date(existing.expiresAt).getTime() - Date.now() + 10) };
    }
    await this.storage.delete(COLLECTIONS.runLeases, id);
    return { acquired: await this.storage.putIfAbsent(COLLECTIONS.runLeases, id, lease(), runId), retryAfterMs: 50 };
  }

  private async renewRunLease(runId: string): Promise<boolean> {
    const existing = await this.storage.get<RunLease>(COLLECTIONS.runLeases, runId);
    if (existing?.owner !== this.leaseOwner) return false;
    await this.storage.put(COLLECTIONS.runLeases, runId, {
      owner: this.leaseOwner,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    } satisfies RunLease, runId);
    return true;
  }

  private async releaseRunLease(runId: string): Promise<void> {
    const existing = await this.storage.get<RunLease>(COLLECTIONS.runLeases, runId);
    if (existing?.owner === this.leaseOwner) await this.storage.delete(COLLECTIONS.runLeases, runId);
  }

  private async resolveGraph(
    workflowId: string,
    version: number | undefined,
  ): Promise<{ graph: WorkflowGraph; version: number }> {
    const wf = await this.storage.get<Workflow>(COLLECTIONS.workflows, workflowId);
    if (!wf) throw new Error(`workflow '${workflowId}' not found`);
    let v = version ?? 0;
    if (v === -1) v = wf.latestVersion;
    if (v === 0) return { graph: wf.draft, version: 0 };
    const ver = await this.storage.get<WorkflowVersion>(
      COLLECTIONS.versions,
      `${workflowId}@${v}`,
    );
    if (!ver) throw new Error(`workflow '${workflowId}' has no published version ${v}`);
    return { graph: ver.graph, version: v };
  }

  private async completeDeploymentAdmission(run: Run): Promise<void> {
    if (!run.deploymentId || !run.deploymentRunAdmissionId || !['completed', 'failed', 'cancelled'].includes(run.status)) return;
    await this.storage.completeDeploymentRun(
      run.deploymentRunAdmissionId,
      run.deploymentId,
      run.id,
      run.status as 'completed' | 'failed' | 'cancelled',
      run.endedAt ?? nowIso(),
      {
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
        embeddingInputTokens: run.usage.embeddingInputTokens,
        estimatedCostUsd: run.usage.estimatedCostUsd,
        unpricedLlmCalls: run.usage.unpricedLlmCalls,
        unpricedEmbeddingOperations: run.usage.unpricedEmbeddingOperations,
      },
    );
  }

  async createRun(input: StartRunInput): Promise<Run> {
    const key = input.idempotencyKey?.trim();
    if (input.idempotencyKey !== undefined && !key) throw new Error('invalid idempotency key: value cannot be blank');
    if (!key) return this.createRunOnce(input);
    if (key.length > 255) throw new Error('invalid idempotency key: maximum length is 255 characters');

    const lockKey = `${input.workflowId}\u0000${key}`;
    const request = canonicalJson({
      version: input.version ?? 0,
      sessionId: input.sessionId,
      deploymentId: input.deploymentId,
      deploymentReleaseId: input.deploymentReleaseId,
      deploymentRevision: input.deploymentRevision,
      deploymentRunAdmissionId: input.deploymentRunAdmissionId,
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      parentRunId: input.parentRunId,
      parentNodeId: input.parentNodeId,
      rootRunId: input.rootRunId,
      runDepth: input.runDepth,
      workflowAncestry: input.workflowAncestry ? [...input.workflowAncestry] : undefined,
      input: input.input,
      debug: input.debug,
      graphSnapshot: input.graphSnapshot,
    });
    const existing = this.runCreationLocks.get(lockKey);
    if (existing) {
      if (existing.request !== request) {
        throw new Error('idempotency key was already used with a different run request');
      }
      return structuredClone(await existing.promise);
    }

    const creation = this.createIdempotentRun({ ...input, idempotencyKey: key }, request);
    const lock = { request, promise: creation };
    this.runCreationLocks.set(lockKey, lock);
    try {
      return structuredClone(await creation);
    } finally {
      if (this.runCreationLocks.get(lockKey) === lock) this.runCreationLocks.delete(lockKey);
    }
  }

  async replayRun(sourceRunId: string, input: { ownerId?: string; workspaceId?: string; requestKeys?: ProviderKeys; idempotencyKey?: string } = {}): Promise<Run> {
    const source = await this.getRun(sourceRunId);
    if (!source) throw new Error(`run '${sourceRunId}' not found`);
    if (!source.graph) throw new Error(`run '${sourceRunId}' has no graph snapshot and cannot be replayed faithfully`);
    return this.createRun({
      workflowId: source.workflowId,
      version: source.workflowVersion,
      input: structuredClone(source.input),
      graphSnapshot: structuredClone(source.graph),
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      requestKeys: input.requestKeys,
      idempotencyKey: input.idempotencyKey,
    });
  }

  private async createIdempotentRun(input: StartRunInput, signature: string): Promise<Run> {
    const claimId = createHash('sha256')
      .update(`${input.workflowId}\u0000${input.idempotencyKey}`)
      .digest('hex');
    const claim: RunIdempotencyClaim = { signature, runId: ids.run(), createdAt: nowIso() };
    const inserted = await this.storage.putIfAbsent(
      COLLECTIONS.idempotency,
      claimId,
      claim,
      input.workflowId,
    );
    if (!inserted) {
      const existing = await this.storage.get<RunIdempotencyClaim>(COLLECTIONS.idempotency, claimId);
      if (!existing) throw new Error('idempotency request is still being claimed; retry shortly');
      if (existing.signature !== signature) {
        throw new Error('idempotency key was already used with a different run request');
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        const run = await this.getRun(existing.runId);
        if (run) {
          const publicRun = structuredClone(run);
          delete publicRun.graph;
          return publicRun;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('idempotency request is still in progress; retry shortly');
    }
    try {
      return await this.createRunOnce(input, claim.runId, signature);
    } catch (error) {
      await this.storage.delete(COLLECTIONS.idempotency, claimId);
      throw error;
    }
  }

  private async createRunOnce(input: StartRunInput, forcedRunId?: string, idempotencySignature?: string): Promise<Run> {
    const resolved = input.graphSnapshot
      ? { graph: structuredClone(input.graphSnapshot), version: input.version ?? 0 }
      : await this.resolveGraph(input.workflowId, input.version);
    const { graph: rawGraph, version } = resolved;
    const { graph } = normalizeGraph(rawGraph, { migrateLegacyTerminal: true });
    const validation = validateGraph(graph);
    if (!validation.valid) {
      throw new Error(
        `workflow graph is invalid: ${validation.errors.map((e) => e.message).join('; ')}`,
      );
    }
    const normalizedInput = await normalizeRunInput(graph, input.input);
    const workflowOwner = await this.storage.get<Workflow>(COLLECTIONS.workflows, input.workflowId);
    const run: Run = {
      id: forcedRunId ?? ids.run(),
      workflowId: input.workflowId,
      workflowVersion: version,
      ownerId: input.ownerId ?? workflowOwner?.ownerId,
      workspaceId: input.workspaceId ?? workflowOwner?.workspaceId,
      sessionId: input.sessionId,
      deploymentId: input.deploymentId,
      deploymentReleaseId: input.deploymentReleaseId,
      deploymentRevision: input.deploymentRevision,
      deploymentRunAdmissionId: input.deploymentRunAdmissionId,
      parentRunId: input.parentRunId,
      parentNodeId: input.parentNodeId,
      rootRunId: input.rootRunId,
      runDepth: input.runDepth,
      workflowAncestry: input.workflowAncestry ? [...input.workflowAncestry] : undefined,
      idempotencyKey: input.idempotencyKey,
      idempotencySignature,
      status: 'queued',
      debug: input.debug ? { breakpointNodeIds: [...new Set(input.debug.breakpointNodeIds ?? [])], pauseBeforeFirst: input.debug.pauseBeforeFirst } : undefined,
      input: normalizedInput,
      usage: emptyRunUsage(),
      createdAt: nowIso(),
    };

    const start = graph.nodes.find((n) => n.type === 'start')!;
    const checkpoint: EngineCheckpoint = {
      boundaryVersion: 1,
      currentNodeId: start.id,
      state: initialState(graph, normalizedInput.state_variables),
      nodeOutputs: {},
      history: [...(normalizedInput.history ?? [])],
      whileCounters: {},
      lastAgentText: '',
    };
    // record the current user input into history for chat semantics
    if (normalizedInput.input_as_text !== undefined) {
      checkpoint.history.push({
        role: 'user',
        content: normalizedInput.input_as_text,
        at: nowIso(),
      });
    }
    run.checkpoint = checkpoint as unknown as JsonObject;
    run.state = structuredClone(checkpoint.state);
    run.graph = graph; // snapshot: the run executes this exact graph forever

    await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
    await this.emit(run.id, { type: 'run.created', runId: run.id, at: nowIso() });

    const missing = await this.missingCredentials(providersReachableFrom(graph, [start.id]), input.requestKeys, run.workspaceId);
    if (missing.length) await this.markCredentialsRequired(run, missing);
    else this.schedule(run.id, graph, input.requestKeys);
    const publicRun = structuredClone(run);
    delete publicRun.graph;
    return publicRun;
  }

  private schedule(runId: string, graph: WorkflowGraph, requestKeys?: ProviderKeys): void {
    if (requestKeys) this.transientProviderKeys.set(runId, structuredClone(requestKeys));
    const effectiveKeys = requestKeys ?? this.transientProviderKeys.get(runId);
    const task = () => {
      this.active += 1;
      void this.executeRun(runId, graph, effectiveKeys)
        .catch((e) => log.error(`run ${runId} crashed: ${(e as Error).stack}`))
        .finally(() => {
          this.active -= 1;
          const next = this.queue.shift();
          if (next) next();
        });
    };
    if (this.active < this.config.maxConcurrentRuns) task();
    else this.queue.push(task);
  }

  async getRun(runId: string): Promise<Run | undefined> {
    const run = await this.storage.get<Run>(COLLECTIONS.runs, runId);
    if (!run) return undefined;
    ensureDetailedUsage(run);
    return this.normalizeRunOwnership(run);
  }

  private async normalizeRunOwnership(run: Run): Promise<Run> {
    if (run.ownerId && run.workspaceId) return run;
    const workflow = await this.storage.get<Workflow>(COLLECTIONS.workflows, run.workflowId);
    return {
      ...run,
      ownerId: run.ownerId ?? workflow?.ownerId ?? DEFAULT_SUBJECT_ID,
      workspaceId: run.workspaceId ?? workflow?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    };
  }

  async listRuns(workflowId?: string, limit = 50): Promise<Run[]> {
    const rows = await this.storage.list<Run>(COLLECTIONS.runs, {
      ref: workflowId,
      order: 'desc',
      limit,
    });
    return rows.map((r) => {
      const run = r.doc;
      ensureDetailedUsage(run);
      delete (run as Partial<Run>).checkpoint; // opaque + large
      delete (run as Partial<Run>).graph;
      return run;
    });
  }

  async queryRuns(input: {
    workflowId?: string; workflowIds?: string[]; status?: string; nodeId?: string; type?: string; from?: string; to?: string;
    error?: string; model?: string; tool?: string; cursor?: string; limit?: number;
    ownerId?: string; workspaceId?: string;
  }): Promise<{ runs: Run[]; nextCursor?: string }> {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const cursor = input.cursor ? Buffer.from(input.cursor, 'base64url').toString('utf8') : undefined;
    const allowedWorkflowIds = input.workflowIds ? new Set(input.workflowIds) : undefined;
    const rows = await this.storage.list<Run>(COLLECTIONS.runs, { ref: input.workflowId, order: 'desc' });
    // The cursor encodes this key, so the page must use the same total order.
    // Storage insertion order is not sufficient: multiple runs can share an ISO
    // timestamp and persisted/imported runs need not be inserted in ID order.
    rows.sort((left, right) => {
      const created = right.doc.createdAt.localeCompare(left.doc.createdAt);
      return created || right.doc.id.localeCompare(left.doc.id);
    });
    const matches: Run[] = [];
    for (const row of rows) {
      const run = row.doc;
      if (input.workspaceId && (run.workspaceId ?? DEFAULT_WORKSPACE_ID) !== input.workspaceId) continue;
      if (input.ownerId && (run.ownerId ?? DEFAULT_SUBJECT_ID) !== input.ownerId) continue;
      if (allowedWorkflowIds && !allowedWorkflowIds.has(run.workflowId)) continue;
      const key = `${run.createdAt}\u0000${run.id}`;
      if (cursor && key >= cursor) continue;
      if (input.status && run.status !== input.status) continue;
      if (input.from && run.createdAt < input.from) continue;
      if (input.to && run.createdAt > input.to) continue;
      if (input.error && !String(run.error ?? '').toLowerCase().includes(input.error.toLowerCase())) continue;
      if (input.model && !Object.values(run.usage?.byModel ?? {}).some((bucket) => bucket.model.toLowerCase().includes(input.model!.toLowerCase()))) continue;
      if (input.nodeId || input.type || input.tool) {
        const events = await this.pastEvents(run.id);
        if (input.nodeId && !events.some((event) => 'nodeId' in event && event.nodeId === input.nodeId)) continue;
        if (input.type && !events.some((event) => event.type === input.type || event.type.startsWith(`${input.type}.`))) continue;
        if (input.tool && !events.some((event) => JSON.stringify(event).toLowerCase().includes(input.tool!.toLowerCase()) && event.type.startsWith('tool.'))) continue;
      }
      ensureDetailedUsage(run);
      delete (run as Partial<Run>).checkpoint;
      delete (run as Partial<Run>).graph;
      matches.push(run);
      if (matches.length > limit) break;
    }
    const page = matches.slice(0, limit);
    const last = page.at(-1);
    return {
      runs: page,
      nextCursor: matches.length > limit && last
        ? Buffer.from(`${last.createdAt}\u0000${last.id}`, 'utf8').toString('base64url')
        : undefined,
    };
  }

  async traceRetentionStatus(): Promise<Record<string, unknown>> {
    return (await this.storage.get<Record<string, unknown>>(COLLECTIONS.settings, 'trace_retention_status')) ?? {
      enabled: this.config.traceRetentionMaxRuns > 0 || this.config.traceRetentionMaxAgeDays > 0,
      maxRuns: this.config.traceRetentionMaxRuns,
      maxAgeDays: this.config.traceRetentionMaxAgeDays,
    };
  }

  async maybeEnforceTraceRetention(force = false, overrides: { dryRun?: boolean; maxRuns?: number; maxAgeDays?: number } = {}): Promise<Record<string, unknown>> {
    if (this.retentionPromise) return { ...(await this.traceRetentionStatus()), skipped: 'lease_held' };
    const task = this.runTraceRetention(force, overrides);
    this.retentionPromise = task;
    try { return await task; }
    finally { if (this.retentionPromise === task) this.retentionPromise = undefined; }
  }

  private async runTraceRetention(force = false, overrides: { dryRun?: boolean; maxRuns?: number; maxAgeDays?: number } = {}): Promise<Record<string, unknown>> {
    const maxRuns = overrides.maxRuns ?? this.config.traceRetentionMaxRuns;
    const maxAgeDays = overrides.maxAgeDays ?? this.config.traceRetentionMaxAgeDays;
    const enabled = maxRuns > 0 || maxAgeDays > 0;
    if (!enabled && !overrides.dryRun) return { enabled: false, skipped: 'disabled', maxRuns, maxAgeDays };
    const prior = await this.traceRetentionStatus();
    const lastFinished = Date.parse(String(prior.finishedAt ?? ''));
    if (!force && Number.isFinite(lastFinished) && Date.now() - lastFinished < this.config.traceRetentionIntervalSeconds * 1000) {
      return { ...prior, skipped: 'throttled' };
    }
    const leaseId = 'trace_retention_lease';
    const owner = this.leaseOwner;
    const lease = { owner, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    let acquired = await this.storage.putIfAbsent(COLLECTIONS.settings, leaseId, lease, 'trace-retention');
    if (!acquired) {
      const existing = await this.storage.get<{ owner: string; expiresAt: string }>(COLLECTIONS.settings, leaseId);
      if (existing && Date.parse(existing.expiresAt) <= Date.now()) {
        await this.storage.delete(COLLECTIONS.settings, leaseId);
        acquired = await this.storage.putIfAbsent(COLLECTIONS.settings, leaseId, lease, 'trace-retention');
      }
    }
    if (!acquired) return { ...prior, skipped: 'lease_held' };
    const startedAt = nowIso();
    try {
      const result = await this.enforceTraceRetention({ maxRuns, maxAgeDays, dryRun: overrides.dryRun === true });
      const status = { enabled, maxRuns, maxAgeDays, dryRun: overrides.dryRun === true, startedAt, finishedAt: nowIso(), ...result };
      if (!overrides.dryRun) await this.storage.put(COLLECTIONS.settings, 'trace_retention_status', status);
      return status;
    } catch (error) {
      const status = { enabled, maxRuns, maxAgeDays, startedAt, finishedAt: nowIso(), error: (error as Error).message };
      await this.storage.put(COLLECTIONS.settings, 'trace_retention_status', status);
      throw error;
    } finally {
      const current = await this.storage.get<{ owner: string }>(COLLECTIONS.settings, leaseId);
      if (current?.owner === owner) await this.storage.delete(COLLECTIONS.settings, leaseId);
    }
  }

  async enforceTraceRetention(options: number | { maxRuns: number; maxAgeDays?: number; dryRun?: boolean }): Promise<{ deleted: number; protected: number; candidates: number; scanned: number }> {
    const input = typeof options === 'number' ? { maxRuns: options } : options;
    const cap = input.maxRuns > 0 ? Math.min(100_000, Math.trunc(input.maxRuns)) : Number.POSITIVE_INFINITY;
    const cutoff = input.maxAgeDays && input.maxAgeDays > 0 ? Date.now() - input.maxAgeDays * 86_400_000 : Number.NEGATIVE_INFINITY;
    const evaluationRows = await this.storage.list<{ runIds?: string[] }>(COLLECTIONS.evaluationRuns);
    const pinned = new Set(evaluationRows.flatMap(({ doc }) => doc.runIds ?? []));
    const batchRows = await this.storage.list<BatchJob>(COLLECTIONS.batches);
    for (const { doc: batch } of batchRows) {
      for (const item of batch.items) if (item.runId) pinned.add(item.runId);
    }
    const threadRows = await this.storage.list<ChatThread>(COLLECTIONS.threads);
    for (const { doc: thread } of threadRows) {
      for (const message of thread.messages) if (message.runId) pinned.add(message.runId);
    }
    const rows = await this.storage.list<Run>(COLLECTIONS.runs, { order: 'desc' });
    // A retained trace is a lineage, not an isolated run. Nested subflow
    // spans point at child runs, so deleting a child while its parent is
    // pinned leaves an incomplete trace and breaks run inspection.
    const runsById = new Map(rows.map(({ doc }) => [doc.id, doc]));
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const run of rows.map(({ doc }) => doc)) {
        if (pinned.has(run.id)) {
          if (run.parentRunId && runsById.has(run.parentRunId) && !pinned.has(run.parentRunId)) {
            pinned.add(run.parentRunId);
            expanded = true;
          }
          for (const childId of run.childRunIds ?? []) {
            if (runsById.has(childId) && !pinned.has(childId)) {
              pinned.add(childId);
              expanded = true;
            }
          }
        }
      }
    }
    const active = new Set(['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug']);
    let retained = 0;
    let deleted = 0;
    let protectedCount = 0;
    let candidates = 0;
    for (const { doc: run } of rows) {
      if (active.has(run.status) || pinned.has(run.id)) { protectedCount++; continue; }
      retained++;
      const tooMany = retained > cap;
      // Corrupt or legacy records without a parseable timestamp must not
      // escape age-based cleanup forever. Treat them as old only when an age
      // policy is enabled; maxRuns-only policies still use their normal order.
      const timestamp = Date.parse(run.endedAt ?? run.createdAt);
      const tooOld = cutoff !== Number.NEGATIVE_INFINITY && (!Number.isFinite(timestamp) || timestamp < cutoff);
      if (!tooMany && !tooOld) continue;
      candidates++;
      if (!input.dryRun) {
        await this.storage.deleteWhere(COLLECTIONS.spans, run.id);
        await this.storage.delete(COLLECTIONS.runs, run.id);
        this.eventSeq.delete(run.id);
      }
      deleted++;
    }
    return { deleted: input.dryRun ? 0 : deleted, protected: protectedCount, candidates, scanned: rows.length };
  }

  private clearApprovalTimeout(runId: string): void {
    const timer = this.approvalTimers.get(runId);
    if (timer) clearTimeout(timer);
    this.approvalTimers.delete(runId);
  }

  private armApprovalTimeout(runId: string, approval: PendingApproval): void {
    this.clearApprovalTimeout(runId);
    if (!approval.expiresAt) return;
    const delay = Math.max(0, new Date(approval.expiresAt).getTime() - Date.now());
    const timer = setTimeout(() => {
      void this.expireApproval(runId, approval.id).catch((error) => {
        log.error(`failed to expire approval ${approval.id}: ${(error as Error).stack}`);
      });
    }, delay);
    timer.unref?.();
    this.approvalTimers.set(runId, timer);
  }

  private async expireApproval(runId: string, approvalId: string, resolutionLockHeld = false): Promise<void> {
    if (!resolutionLockHeld && this.resolving.has(runId)) return;
    if (!resolutionLockHeld) this.resolving.add(runId);
    try {
      const run = await this.getRun(runId);
      const approval = run?.pendingApproval;
      if (!run || !approval || approval.id !== approvalId) return;
      if (run.status !== 'awaiting_approval' && run.status !== 'awaiting_client_tool') return;
      if (!approval.expiresAt || Date.now() < new Date(approval.expiresAt).getTime()) {
        if (approval.expiresAt) this.armApprovalTimeout(runId, approval);
        return;
      }
      this.clearApprovalTimeout(runId);
      const awaitingStatus = run.status;
      run.status = 'failed';
      run.error = `approval '${approval.id}' timed out`;
      run.endedAt = nowIso();
      run.pendingApproval = undefined;
      const expired = await this.storage.compareAndSwap(COLLECTIONS.runs, runId, 'status', awaitingStatus, run, run.workflowId);
      if (!expired) return;
      await this.completeDeploymentAdmission(run);
      await this.emit(runId, {
        type: 'approval.expired',
        runId,
        approvalId: approval.id,
        at: run.endedAt,
      });
      await this.emit(runId, { type: 'run.failed', runId, error: run.error, at: run.endedAt });
      await this.wakeWaitingParent(run);
      this.eventSeq.delete(runId);
      this.transientProviderKeys.delete(runId);
    } finally {
      if (!resolutionLockHeld) this.resolving.delete(runId);
    }
  }

  async cancelRun(runId: string, suppressParentWake = false): Promise<Run | undefined> {
    const run = await this.getRun(runId);
    if (!run) return undefined;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return run;
    }
    this.aborts.get(runId)?.abort();
    await Promise.all((run.childRunIds ?? []).map(async (childRunId) => {
      const child = await this.getRun(childRunId);
      if (child && !['completed', 'failed', 'cancelled'].includes(child.status)) await this.cancelRun(childRunId, true);
    }));
    this.clearApprovalTimeout(runId);
    run.status = 'cancelled';
    run.endedAt = nowIso();
    run.pendingApproval = undefined;
    run.nestedWait = undefined;
    run.debugPause = undefined;
    run.credentialRequirements = undefined;
    await this.storage.put(COLLECTIONS.runs, runId, run, run.workflowId);
    await this.completeDeploymentAdmission(run);
    await this.emit(runId, { type: 'run.cancelled', runId, at: nowIso() });
    if (!suppressParentWake) await this.wakeWaitingParent(run);
    this.eventSeq.delete(runId);
    this.transientProviderKeys.delete(runId);
    return run;
  }

  /** In-flight approval resolutions (double-resolve guard). */
  private resolving = new Set<string>();

  /** Resolve a pending approval / client tool and resume execution. */
  async resolveApproval(
    runId: string,
    approvalId: string,
    resolution: { approved?: boolean; result?: JsonValue; reason?: string },
    requestKeys?: ProviderKeys,
    actor?: AuthPrincipal,
    suppressParentWake = false,
  ): Promise<Run> {
    if (this.resolving.has(runId)) {
      throw new Error(`run '${runId}' is not awaiting approval (a resolution is already in progress)`);
    }
    this.resolving.add(runId);
    try {
      const run = await this.getRun(runId);
      if (!run) throw new Error(`run '${runId}' not found`);
      if (run.status !== 'awaiting_approval' && run.status !== 'awaiting_client_tool') {
        throw new Error(`run '${runId}' is not awaiting approval (status: ${run.status})`);
      }
      const approval = run.pendingApproval;
      if (!approval || approval.id !== approvalId) {
        throw new Error(`approval '${approvalId}' is not pending on run '${runId}'`);
      }
      const hasResult = Object.prototype.hasOwnProperty.call(resolution, 'result');
      if (approval.kind === 'client_tool') {
        if (resolution.approved === false && hasResult) {
          throw new Error('client tool resolution cannot include both a result and a rejection');
        }
        if (resolution.approved !== false && !hasResult) {
          throw new Error('client tool result is required unless the call is explicitly rejected');
        }
      }
      const reason = resolution.approved === false ? resolution.reason?.trim() : undefined;
      const awaitingStatus = run.status;
      if (reason && reason.length > 2_000) throw new Error('approval rejection reason must be 2000 characters or fewer');
      if (run.nestedWait) {
        const wait = run.nestedWait;
        const child = await this.getRun(wait.childRunId);
        if (!child) throw new Error(`subflow child run '${wait.childRunId}' not found`);
        await this.resolveApproval(child.id, approval.nested?.leafApprovalId ?? approvalId, resolution, requestKeys, actor, true);
        this.clearApprovalTimeout(runId);
        run.pendingApproval = undefined;
        run.credentialRequirements = undefined;
        run.status = 'queued';
        if (!await this.storage.compareAndSwap(COLLECTIONS.runs, runId, 'status', awaitingStatus, run, run.workflowId)) {
          await this.cancelRun(child.id, true);
          const current = await this.getRun(runId);
          throw new Error(`run '${runId}' is not awaiting approval (status: ${current?.status ?? 'missing'})`);
        }
        await this.emit(runId, {
          type: 'approval.resolved', runId, approvalId,
          approved: approval.kind === 'client_tool' ? resolution.approved !== false : !!resolution.approved,
          ...(reason ? { reason } : {}),
          ...(actor ? { resolvedBy: { id: actor.id, subjectId: actor.subjectId, workspaceId: actor.workspaceId, role: actor.role, kind: actor.kind, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}) } satisfies ApprovalActor } : {}),
          at: nowIso(),
        });
        await this.emit(runId, { type: 'subflow.resumed', runId, nodeId: wait.parentNodeId, childRunId: wait.childRunId, leafRunId: wait.leafRunId, at: nowIso() });
        const parentGraph = run.graph ?? normalizeGraph((await this.resolveGraph(run.workflowId, run.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
        this.schedule(runId, parentGraph, requestKeys);
        if (!suppressParentWake) await this.wakeWaitingParent(run);
        return run;
      }
      if (approval.expiresAt && Date.now() >= new Date(approval.expiresAt).getTime()) {
        await this.expireApproval(runId, approval.id, true);
        throw new Error(`approval '${approvalId}' has expired`);
      }
      let graph = run.graph;
      if (!graph) {
        const resolved = await this.resolveGraph(run.workflowId, run.workflowVersion);
        graph = normalizeGraph(resolved.graph, { migrateLegacyTerminal: true }).graph;
      }
      const approvalNode = graph.nodes.find((node) => node.id === approval.nodeId);
      let continuationIds: string[];
      if (approvalNode?.type === 'agent') {
        continuationIds = [approvalNode.id];
      } else {
        const handle = approvalNode?.type === 'userApproval'
          ? (resolution.approved ? 'approved' : 'rejected')
          : null;
        continuationIds = graph.edges
          .filter((edge) => edge.source === approval.nodeId && (edge.sourceHandle ?? null) === handle)
          .map((edge) => edge.target);
      }
      const providers = providersReachableFrom(graph, continuationIds);
      const missing = await this.missingCredentials(providers, requestKeys, run.workspaceId);
      if (missing.length) {
        run.credentialRequirements = { providers: missing };
        if (!await this.storage.compareAndSwap(COLLECTIONS.runs, run.id, 'status', awaitingStatus, run, run.workflowId)) {
          const current = await this.getRun(runId);
          throw new Error(`run '${runId}' is not awaiting approval (status: ${current?.status ?? 'missing'})`);
        }
        throw new CredentialsRequiredError(missing);
      }
      this.clearApprovalTimeout(runId);

      const checkpoint = run.checkpoint as unknown as EngineCheckpoint;
      const resume: JsonObject = { ...(checkpoint.resume ?? {}) };
      if (approval.kind === 'client_tool') {
        if (resolution.approved === false) {
          resume.decision = 'rejected';
          if (reason) resume.reason = reason;
        } else {
          resume.clientResult = resolution.result as JsonObject[string];
        }
      } else {
        resume.decision = resolution.approved ? 'approved' : 'rejected';
        if (reason) resume.reason = reason;
      }
      checkpoint.resume = resume;
      run.checkpoint = checkpoint as unknown as JsonObject;
      run.pendingApproval = undefined;
      run.credentialRequirements = undefined;
      run.status = 'running';
      if (!await this.storage.compareAndSwap(COLLECTIONS.runs, runId, 'status', awaitingStatus, run, run.workflowId)) {
        const current = await this.getRun(runId);
        throw new Error(`run '${runId}' is not awaiting approval (status: ${current?.status ?? 'missing'})`);
      }
      await this.emit(runId, {
        type: 'approval.resolved',
        runId,
        approvalId,
        approved: approval.kind === 'client_tool' ? resolution.approved !== false : !!resolution.approved,
        ...(reason ? { reason } : {}),
        ...(actor ? {
          resolvedBy: {
            id: actor.id,
            subjectId: actor.subjectId,
            workspaceId: actor.workspaceId,
            role: actor.role,
            kind: actor.kind,
            ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}),
          } satisfies ApprovalActor,
        } : {}),
        at: nowIso(),
      });

      // Resume against the snapshot captured at creation (immune to draft
      // edits); fall back to re-resolving for runs from older versions.
      this.schedule(runId, graph, requestKeys);
      if (!suppressParentWake) await this.wakeWaitingParent(run);
      return run;
    } finally {
      this.resolving.delete(runId);
    }
  }

  // ------------------------------------------------------------------
  // interpreter loop
  // ------------------------------------------------------------------

  async resumeDebug(runId: string, mode: 'continue' | 'step', requestKeys?: ProviderKeys, suppressParentWake = false): Promise<Run> {
    if (this.debugResuming.has(runId)) throw new Error(`run '${runId}' is already resuming in the debugger`);
    this.debugResuming.add(runId);
    try {
    const run = await this.getRun(runId);
    if (!run) throw new Error(`run '${runId}' not found`);
    if (run.status !== 'awaiting_debug' || !run.debugPause) throw new Error(`run '${runId}' is not paused in the debugger`);
    if (run.nestedWait) {
      const wait = run.nestedWait;
      const child = await this.getRun(wait.childRunId);
      if (!child) throw new Error(`subflow child run '${wait.childRunId}' not found`);
      await this.resumeDebug(child.id, mode, requestKeys, true);
      run.debugPause = undefined;
      run.status = 'queued';
      await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
      await this.emit(run.id, { type: 'debug.resumed', runId: run.id, mode, at: nowIso() });
      await this.emit(run.id, { type: 'subflow.resumed', runId: run.id, nodeId: wait.parentNodeId, childRunId: wait.childRunId, leafRunId: wait.leafRunId, at: nowIso() });
      const parentGraph = run.graph ?? normalizeGraph((await this.resolveGraph(run.workflowId, run.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
      this.schedule(run.id, parentGraph, requestKeys);
      if (!suppressParentWake) await this.wakeWaitingParent(run);
      return run;
    }
    if (!run.debug) throw new Error(`run '${runId}' is not paused in the debugger`);
    run.debug.skipNodeIdOnce = run.debugPause.nodeId;
    run.debug.stepRemaining = mode === 'step' ? 1 : undefined;
    run.debug.pauseBeforeFirst = false;
    run.debugPause = undefined;
    run.status = 'queued';
    await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
    await this.emit(run.id, { type: 'debug.resumed', runId: run.id, mode, at: nowIso() });
    const graph = run.graph ?? normalizeGraph((await this.resolveGraph(run.workflowId, run.workflowVersion)).graph, { migrateLegacyTerminal: true }).graph;
    this.schedule(run.id, graph, requestKeys);
    if (!suppressParentWake) await this.wakeWaitingParent(run);
    return run;
    } finally {
      this.debugResuming.delete(runId);
    }
  }

  private async executeRun(
    runId: string,
    graph: WorkflowGraph,
    requestKeys?: ProviderKeys,
  ): Promise<void> {
    const lease = await this.acquireRunLease(runId);
    if (!lease.acquired) {
      if (lease.retryAfterMs !== undefined) {
        const retry = setTimeout(() => this.schedule(runId, graph, requestKeys), lease.retryAfterMs);
        retry.unref?.();
      }
      return;
    }
    const run = await this.getRun(runId);
    if (!run || (run.status !== 'queued' && run.status !== 'running')) {
      await this.releaseRunLease(runId);
      return;
    }
    ensureDetailedUsage(run);

    const { varNames } = normalizeGraph(graph);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const checkpoint = run.checkpoint as unknown as EngineCheckpoint;

    const abort = new AbortController();
    this.aborts.set(runId, abort);
    const leaseHeartbeat = setInterval(() => {
      void this.renewRunLease(runId).then((renewed) => {
        if (!renewed) abort.abort(new Error('run execution lease was lost'));
      });
    }, 10_000);
    leaseHeartbeat.unref?.();

    const storedKeys = await loadProviderKeys(this.storage, run.workspaceId);

    const persistRun = async () => {
      // Never clobber a concurrent cancellation with stale in-memory state.
      if (abort.signal.aborted) return;
      run.checkpoint = checkpoint as unknown as JsonObject;
      run.state = structuredClone(checkpoint.state);
      await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
    };

    const ctx: RunContext = {
      run,
      graph,
      varNames,
      checkpoint,
      services: {
        storage: this.storage,
        config: this.config,
        mcp: this.mcp,
        vectorStores: this.vectorStores,
        secrets: this.secrets,
        requestKeys,
        storedKeys: storedKeys ?? undefined,
        childRuns: {
          create: (input) => this.createRun(input),
          get: (childRunId) => this.getRun(childRunId),
          cancel: (childRunId) => this.cancelRun(childRunId),
          resume: (childRunId, keys) => this.resumeRun(childRunId, keys),
        },
      },
      emit: (event) => this.emit(runId, event),
      abortSignal: abort.signal,
      takeResume: () => {
        const r = checkpoint.resume;
        checkpoint.resume = undefined;
        return r;
      },
      addUsage: (usage) => {
        run.usage.inputTokens += usage.inputTokens ?? 0;
        run.usage.outputTokens += usage.outputTokens ?? 0;
        run.usage.llmCalls += usage.llmCalls ?? 0;
        run.usage.toolCalls += usage.toolCalls ?? 0;
        const llmCalls = usage.llmCalls ?? 0;
        if (!llmCalls) return;

        if (!usage.provider || !usage.model) {
          run.usage.unpricedLlmCalls += llmCalls;
          return;
        }
        const normalizedModel = usage.model.replace(/^models\//, '');
        const key = `${usage.provider}:${normalizedModel}`;
        const pricing = priceModelUsage({
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          tokenStatus: usage.tokenStatus,
          cachedInputTokens: usage.cachedInputTokens,
          cacheWriteInputTokens: usage.cacheWriteInputTokens,
          reasoningTokens: usage.reasoningTokens,
          model: normalizedModel,
          provider: usage.provider,
        });
        const existing = run.usage.byModel[key];
        if (!existing) {
          run.usage.byModel[key] = {
            provider: usage.provider,
            model: normalizedModel,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cachedInputTokens: usage.cachedInputTokens ?? 0,
            cacheWriteInputTokens: usage.cacheWriteInputTokens ?? 0,
            reasoningTokens: usage.reasoningTokens ?? 0,
            llmCalls,
            pricing,
          };
        } else {
          existing.inputTokens += usage.inputTokens ?? 0;
          existing.outputTokens += usage.outputTokens ?? 0;
          existing.cachedInputTokens += usage.cachedInputTokens ?? 0;
          existing.cacheWriteInputTokens += usage.cacheWriteInputTokens ?? 0;
          existing.reasoningTokens += usage.reasoningTokens ?? 0;
          existing.llmCalls += llmCalls;
          if (existing.pricing.status === 'priced' && pricing.status === 'priced') {
            existing.pricing.estimatedCostUsd = Number((existing.pricing.estimatedCostUsd + pricing.estimatedCostUsd).toFixed(12));
          }
        }
        if (pricing.status === 'priced') {
          run.usage.estimatedCostUsd = Number((run.usage.estimatedCostUsd + pricing.estimatedCostUsd).toFixed(12));
        } else {
          run.usage.unpricedLlmCalls += llmCalls;
        }
      },
      addEmbeddingUsage: (usage) => {
        run.usage.embeddingOperations += 1;
        run.usage.embeddingInputTokens += usage.inputTokens ?? 0;
        const normalizedModel = usage.model.replace(/^models\//, '');
        const key = `${usage.provider}:${normalizedModel}`;
        const unpriced = usage.tokenStatus === 'not_reported' || usage.pricing.status === 'unpriced';
        if (unpriced) run.usage.unpricedEmbeddingOperations += 1;
        const existing = run.usage.byEmbeddingModel[key];
        if (!existing) {
          run.usage.byEmbeddingModel[key] = {
            provider: usage.provider,
            model: normalizedModel,
            inputTokens: usage.inputTokens ?? 0,
            operations: 1,
            unreportedTokenOperations: usage.tokenStatus === 'not_reported' ? 1 : 0,
            pricing: structuredClone(usage.pricing),
          };
        } else {
          existing.inputTokens += usage.inputTokens ?? 0;
          existing.operations += 1;
          if (usage.tokenStatus === 'not_reported') existing.unreportedTokenOperations += 1;
          if (existing.pricing.status === 'priced' && usage.pricing.status === 'priced') {
            existing.pricing.estimatedCostUsd = Number(((existing.pricing.estimatedCostUsd ?? 0) + (usage.pricing.estimatedCostUsd ?? 0)).toFixed(12));
          } else if (usage.pricing.status === 'unpriced') {
            existing.pricing = structuredClone(usage.pricing);
          }
        }
        if (usage.pricing.status === 'priced') {
          run.usage.estimatedCostUsd = Number((run.usage.estimatedCostUsd + (usage.pricing.estimatedCostUsd ?? 0)).toFixed(12));
        }
      },
    };

    if (!run.startedAt) {
      run.startedAt = nowIso();
      run.status = 'running';
      await persistRun();
      await this.emit(runId, { type: 'run.started', runId, at: nowIso() });
    } else {
      run.status = 'running';
      await persistRun();
    }

    let finalOutput: JsonValue | undefined;
    let safety = 0;
    const maxSteps = 10_000;

    try {
      while (checkpoint.currentNodeId) {
        if (abort.signal.aborted) {
          // cancelRun already persisted status
          return;
        }
        if (++safety > maxSteps) {
          throw new Error(`run exceeded ${maxSteps} node executions — aborting`);
        }

        const node = byId.get(checkpoint.currentNodeId);
        if (!node) throw new Error(`node '${checkpoint.currentNodeId}' vanished from graph`);

        const isResuming = checkpoint.resume !== undefined;
        if (!isResuming && run.debug) {
          const skip = run.debug.skipNodeIdOnce === node.id;
          if (skip) run.debug.skipNodeIdOnce = undefined;
          const shouldPause = !skip && (run.debug.pauseBeforeFirst === true || run.debug.stepRemaining === 0 || run.debug.breakpointNodeIds.includes(node.id));
          if (shouldPause) {
            run.debug.pauseBeforeFirst = false;
            run.status = 'awaiting_debug';
            run.debugPause = { nodeId: node.id, ...(checkpoint.lastNodeId ? { lastNodeId: checkpoint.lastNodeId } : {}), state: structuredClone(checkpoint.state), nodeOutputs: structuredClone(checkpoint.nodeOutputs), pausedAt: nowIso() };
            await persistRun();
            await this.emit(runId, { type: 'debug.paused', runId, nodeId: node.id, state: structuredClone(checkpoint.state), nodeOutputs: structuredClone(checkpoint.nodeOutputs), at: nowIso() });
            this.aborts.delete(runId);
            await this.wakeWaitingParent(run);
            return;
          }
        }
        checkpoint.boundaryVersion = 1;
        const reattachingSubflow = node.type === 'subflow'
          && checkpoint.inFlightNode?.nodeId === node.id;
        if (!reattachingSubflow) checkpoint.inFlightNode = { nodeId: node.id, startedAt: nowIso() };
        await persistRun();
        if (!isResuming) {
          await this.emit(runId, {
            type: 'node.started',
            runId,
            nodeId: node.id,
            nodeType: node.type,
            name: node.name,
            input: summarizeTraceStructure(buildScope(ctx)) as JsonObject,
            config: summarizeTraceStructure(node.config) as JsonObject,
            at: nowIso(),
          });
        }

        const executor = NODE_EXECUTORS[node.type];
        if (!executor) throw new Error(`no executor for node type '${node.type}'`);

        let result;
        try {
          result = await executor(node, ctx);
        } catch (e) {
          if (abort.signal.aborted) return;
          const supportsPolicy = ['agent', 'fileSearch', 'mcp', 'ifElse', 'while', 'userApproval', 'transform', 'setState'].includes(node.type);
          const cfg = node.config as JsonObject;
          const policy = supportsPolicy
            ? String(cfg.onError ?? (cfg.continueOnError === true ? 'continue' : 'fail'))
            : 'fail';
          if (policy === 'fail') throw e;
          const message = (e as Error).message;
          await this.emit(runId, {
            type: 'node.failed',
            runId,
            nodeId: node.id,
            error: message,
            at: nowIso(),
          });
          result = {
            outputs: {
              output_text: '',
              error: {
                type: 'node_execution_error',
                message,
                nodeId: node.id,
                nodeType: node.type,
              },
            },
            nextHandle: policy === 'branch' ? 'error' : null,
          };
        }

        if (result.nestedWait) {
          const nested = result.nestedWait;
          checkpoint.inFlightNode = undefined;
          run.nestedWait = nested.wait;
          run.pendingApproval = nested.pendingApproval;
          run.debugPause = nested.debugPause;
          run.credentialRequirements = nested.credentialRequirements;
          run.status = nested.wait.leafStatus;
          await persistRun();
          await this.emit(runId, { type: 'subflow.paused', runId, nodeId: node.id, childRunId: nested.wait.childRunId, leafRunId: nested.wait.leafRunId, status: nested.wait.leafStatus, ...(nested.wait.leafApprovalId ? { approvalId: nested.wait.leafApprovalId } : {}), at: nowIso() });
          if (nested.pendingApproval) await this.emit(runId, { type: 'approval.requested', runId, approval: nested.pendingApproval, at: nowIso() });
          else if (nested.debugPause) await this.emit(runId, { type: 'debug.paused', runId, nodeId: node.id, state: structuredClone(nested.debugPause.state), nodeOutputs: structuredClone(nested.debugPause.nodeOutputs), at: nowIso() });
          this.aborts.delete(runId);
          await this.wakeWaitingParent(run);
          return;
        }

        if (result.credentialsRequired) {
          checkpoint.inFlightNode = undefined;
          run.status = 'awaiting_credentials';
          run.credentialRequirements = { providers: result.credentialsRequired.providers };
          await persistRun();
          await this.emit(runId, { type: 'credentials.required', runId, providers: result.credentialsRequired.providers, at: nowIso() });
          this.aborts.delete(runId);
          await this.wakeWaitingParent(run);
          return;
        }

        // ---- pause? ----
        if (result.pause) {
          const approval: PendingApproval = {
            id: ids.approval(),
            runId,
            nodeId: node.id,
            kind: result.pause.kind,
            message: result.pause.message,
            toolCall: result.pause.toolCall,
            createdAt: nowIso(),
            ...(result.pause.timeoutMs && result.pause.timeoutMs > 0
              ? { expiresAt: new Date(Date.now() + result.pause.timeoutMs).toISOString() }
              : {}),
          };
          checkpoint.resume = result.pause.resumeState ?? undefined;
          checkpoint.inFlightNode = undefined;
          const credentialProviders = providersReachableFrom(graph, [node.id]);
          run.credentialRequirements = credentialProviders.length ? { providers: credentialProviders } : undefined;
          run.pendingApproval = approval;
          run.status = result.pause.kind === 'client_tool' ? 'awaiting_client_tool' : 'awaiting_approval';
          await persistRun();
          await this.emit(runId, {
            type: 'approval.requested',
            runId,
            approval,
            at: nowIso(),
          });
          if (approval.expiresAt) this.armApprovalTimeout(runId, approval);
          this.aborts.delete(runId);
          await this.wakeWaitingParent(run);
          return;
        }

        // ---- record outputs ----
        // Any unconsumed resume payload must not leak into later nodes
        // (e.g. an 'approved' decision bypassing the next approval gate).
        checkpoint.resume = undefined;
        run.nestedWait = undefined;
        if (result.outputs) {
          const varName = varNames.get(node.id) ?? node.id;
          checkpoint.nodeOutputs[varName] = result.outputs as JsonValue;
        }
        if (result.historyAppend?.length) {
          checkpoint.history.push(...result.historyAppend);
        }
        checkpoint.inFlightNode = undefined;

        await this.emit(runId, {
          type: 'node.completed',
          runId,
          nodeId: node.id,
          output: result.outputs as JsonValue | undefined,
          at: nowIso(),
        });

        if (result.terminal || result.finalOutput !== undefined) {
          finalOutput = result.finalOutput;
          checkpoint.currentNodeId = null;
          break;
        }

        // ---- follow the edge or a dynamic Agent handoff ----
        if (result.nextNodeId !== undefined) {
          if (!graph.nodes.some((candidate) => candidate.id === result.nextNodeId && candidate.type === 'agent')) {
            throw new Error(`dynamic handoff target '${result.nextNodeId}' is not an Agent node`);
          }
          checkpoint.lastNodeId = node.id;
          checkpoint.currentNodeId = result.nextNodeId;
          if (run.debug?.stepRemaining !== undefined && run.debug.stepRemaining > 0) run.debug.stepRemaining -= 1;
          await persistRun();
          continue;
        }
        const handle = result.nextHandle ?? null;
        const edge = graph.edges.find(
          (e) => e.source === node.id && (e.sourceHandle ?? null) === handle,
        );
        checkpoint.lastNodeId = node.id;
        checkpoint.currentNodeId = edge?.target ?? null;
        if (run.debug?.stepRemaining !== undefined && run.debug.stepRemaining > 0) run.debug.stepRemaining -= 1;

        // Periodic checkpointing keeps long runs resumable after crashes.
        await persistRun();
      }

      // ---- completed ----
      if (abort.signal.aborted) return; // cancelled during the last node
      run.status = 'completed';
      run.output = finalOutput !== undefined ? finalOutput : (checkpoint.lastAgentText || null);
      run.endedAt = nowIso();
      run.pendingApproval = undefined;
      run.nestedWait = undefined;
      run.credentialRequirements = undefined;
      await persistRun();
      await this.completeDeploymentAdmission(run);
      await this.emit(runId, {
        type: 'run.completed',
        runId,
        output: run.output,
        at: nowIso(),
      });
      await this.wakeWaitingParent(run);
    } catch (e) {
      if (abort.signal.aborted) return;
      const message = (e as Error).message;
      const nodeId = checkpoint.currentNodeId ?? undefined;
      if (nodeId) {
        await this.emit(runId, {
          type: 'node.failed',
          runId,
          nodeId,
          error: message,
          at: nowIso(),
        });
      }
      run.status = 'failed';
      run.error = message;
      run.endedAt = nowIso();
      await persistRun();
      await this.completeDeploymentAdmission(run);
      await this.emit(runId, { type: 'run.failed', runId, error: message, at: nowIso() });
      await this.wakeWaitingParent(run);
      log.warn(`run ${runId} failed: ${message}`);
    } finally {
      clearInterval(leaseHeartbeat);
      await this.releaseRunLease(runId);
      this.aborts.delete(runId);
      // seq counters re-init from storage; drop settled runs to bound memory
      if (['completed', 'failed', 'cancelled'].includes(run.status)) {
        this.eventSeq.delete(runId);
        this.transientProviderKeys.delete(runId);
      }
    }
  }

  /** History accessor used by chat sessions after a run completes. */
  async runHistory(runId: string): Promise<ChatMessage[]> {
    const run = await this.getRun(runId);
    const cp = run?.checkpoint as unknown as EngineCheckpoint | undefined;
    return cp?.history ?? [];
  }
}
