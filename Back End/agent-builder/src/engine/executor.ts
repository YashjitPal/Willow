/**
 * Run engine: creates runs, executes the graph interpreter loop, persists
 * trace events, streams them to subscribers, and handles pause/resume
 * (user approvals, MCP tool approvals, client tools) plus cancellation.
 */

import type { AppConfig } from '../config.ts';
import { normalizeGraph } from '../domain/normalize.ts';
import type {
  AgentNodeConfig,
  ChatMessage,
  JsonObject,
  JsonValue,
  PendingApproval,
  Run,
  RunEvent,
  RunInput,
  Workflow,
  WorkflowGraph,
  WorkflowVersion,
  ProviderKeys,
} from '../domain/types.ts';
import { validateGraph } from '../domain/validate.ts';
import type { McpManager } from '../mcp/manager.ts';
import type { VectorStoreService } from '../rag/vectorStore.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { createLogger } from '../util/log.ts';
import type { EngineCheckpoint, RunContext } from './context.ts';
import { initialState, NODE_EXECUTORS } from './nodes/index.ts';

const log = createLogger('engine');

export interface StartRunInput {
  workflowId: string;
  /** 0 = draft, -1 = latest published, n = specific version. */
  version?: number;
  input: RunInput;
  sessionId?: string;
  requestKeys?: ProviderKeys;
}

type Subscriber = (event: RunEvent) => void;

interface PersistedEvent {
  seq: number;
  event: RunEvent;
}

export class RunEngine {
  private subscribers = new Map<string, Set<Subscriber>>();
  private aborts = new Map<string, AbortController>();
  private eventSeq = new Map<string, number>();
  private active = 0;
  private queue: Array<() => void> = [];

  private storage: Storage;
  private config: AppConfig;
  private mcp: McpManager;
  private vectorStores: VectorStoreService;

  constructor(
    storage: Storage,
    config: AppConfig,
    mcp: McpManager,
    vectorStores: VectorStoreService,
  ) {
    this.storage = storage;
    this.config = config;
    this.mcp = mcp;
    this.vectorStores = vectorStores;
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
    const rows = await this.storage.list<PersistedEvent>(COLLECTIONS.spans, { ref: runId });
    return rows
      .map((r) => r.doc)
      .sort((a, b) => a.seq - b.seq)
      .map((d) => d.event);
  }

  private async emit(runId: string, event: RunEvent): Promise<void> {
    // llm.delta events are streamed but not persisted (too chatty for traces);
    // seq only advances for persisted events so it always equals the stored
    // count (collision-safe across restarts).
    if (event.type !== 'llm.delta') {
      if (!this.eventSeq.has(runId)) {
        const existing = await this.storage.count(COLLECTIONS.spans, runId);
        this.eventSeq.set(runId, existing);
      }
      const seq = (this.eventSeq.get(runId) ?? 0) + 1;
      this.eventSeq.set(runId, seq);
      await this.storage.put(
        COLLECTIONS.spans,
        `${runId}_e${String(seq).padStart(6, '0')}`,
        { seq, event },
        runId,
      );
    }
    const subs = this.subscribers.get(runId);
    if (subs) {
      for (const fn of subs) {
        try {
          fn(event);
        } catch { /* subscriber errors must not break the run */ }
      }
    }
  }

  // ------------------------------------------------------------------
  // run lifecycle
  // ------------------------------------------------------------------

  /**
   * Startup sweep: any run left 'queued'/'running' by a previous process is
   * marked failed (its checkpoint survives for post-mortem). Paused runs
   * (awaiting_approval / awaiting_client_tool) are durable and stay resumable.
   */
  async recoverInterruptedRuns(): Promise<number> {
    const rows = await this.storage.list<Run>(COLLECTIONS.runs);
    let n = 0;
    for (const { doc: run } of rows) {
      if (run.status === 'queued' || run.status === 'running') {
        run.status = 'failed';
        run.error = 'interrupted by server restart';
        run.endedAt = nowIso();
        await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
        await this.emit(run.id, {
          type: 'run.failed',
          runId: run.id,
          error: run.error,
          at: nowIso(),
        });
        n++;
      }
    }
    if (n) log.warn(`marked ${n} interrupted run(s) as failed after restart`);
    return n;
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

  async createRun(input: StartRunInput): Promise<Run> {
    const { graph: rawGraph, version } = await this.resolveGraph(input.workflowId, input.version);
    const { graph } = normalizeGraph(rawGraph);
    const validation = validateGraph(graph);
    if (!validation.valid) {
      throw new Error(
        `workflow graph is invalid: ${validation.errors.map((e) => e.message).join('; ')}`,
      );
    }

    const run: Run = {
      id: ids.run(),
      workflowId: input.workflowId,
      workflowVersion: version,
      sessionId: input.sessionId,
      status: 'queued',
      input: input.input ?? {},
      usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0, toolCalls: 0 },
      createdAt: nowIso(),
    };

    const start = graph.nodes.find((n) => n.type === 'start')!;
    const checkpoint: EngineCheckpoint = {
      currentNodeId: start.id,
      state: initialState(graph, input.input?.state_variables),
      nodeOutputs: {},
      history: [...(input.input?.history ?? [])],
      whileCounters: {},
      lastAgentText: '',
    };
    // record the current user input into history for chat semantics
    if (input.input?.input_as_text) {
      checkpoint.history.push({
        role: 'user',
        content: input.input.input_as_text,
        at: nowIso(),
      });
    }
    run.checkpoint = checkpoint as unknown as JsonObject;
    run.state = structuredClone(checkpoint.state);
    run.graph = graph; // snapshot: the run executes this exact graph forever

    await this.storage.put(COLLECTIONS.runs, run.id, run, run.workflowId);
    await this.emit(run.id, { type: 'run.created', runId: run.id, at: nowIso() });

    this.schedule(run.id, graph, input.requestKeys);
    const publicRun = structuredClone(run);
    delete publicRun.graph;
    return publicRun;
  }

  private schedule(runId: string, graph: WorkflowGraph, requestKeys?: ProviderKeys): void {
    const task = () => {
      this.active += 1;
      void this.executeRun(runId, graph, requestKeys)
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
    return this.storage.get<Run>(COLLECTIONS.runs, runId);
  }

  async listRuns(workflowId?: string, limit = 50): Promise<Run[]> {
    const rows = await this.storage.list<Run>(COLLECTIONS.runs, {
      ref: workflowId,
      order: 'desc',
      limit,
    });
    return rows.map((r) => {
      const run = r.doc;
      delete (run as Partial<Run>).checkpoint; // opaque + large
      delete (run as Partial<Run>).graph;
      return run;
    });
  }

  async cancelRun(runId: string): Promise<Run | undefined> {
    const run = await this.getRun(runId);
    if (!run) return undefined;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return run;
    }
    this.aborts.get(runId)?.abort();
    run.status = 'cancelled';
    run.endedAt = nowIso();
    run.pendingApproval = undefined;
    await this.storage.put(COLLECTIONS.runs, runId, run, run.workflowId);
    await this.emit(runId, { type: 'run.cancelled', runId, at: nowIso() });
    this.eventSeq.delete(runId);
    return run;
  }

  /** In-flight approval resolutions (double-resolve guard). */
  private resolving = new Set<string>();

  /** Resolve a pending approval / client tool and resume execution. */
  async resolveApproval(
    runId: string,
    approvalId: string,
    resolution: { approved?: boolean; result?: JsonValue },
    requestKeys?: ProviderKeys,
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

      const checkpoint = run.checkpoint as unknown as EngineCheckpoint;
      const resume: JsonObject = { ...(checkpoint.resume ?? {}) };
      if (approval.kind === 'client_tool') {
        resume.clientResult = (resolution.result ?? null) as JsonObject[string];
      } else {
        resume.decision = resolution.approved ? 'approved' : 'rejected';
      }
      checkpoint.resume = resume;
      run.checkpoint = checkpoint as unknown as JsonObject;
      run.pendingApproval = undefined;
      run.status = 'running';
      await this.storage.put(COLLECTIONS.runs, runId, run, run.workflowId);
      await this.emit(runId, {
        type: 'approval.resolved',
        runId,
        approvalId,
        approved: approval.kind === 'client_tool' ? true : !!resolution.approved,
        at: nowIso(),
      });

      // Resume against the snapshot captured at creation (immune to draft
      // edits); fall back to re-resolving for runs from older versions.
      let graph = run.graph;
      if (!graph) {
        const resolved = await this.resolveGraph(run.workflowId, run.workflowVersion);
        graph = normalizeGraph(resolved.graph).graph;
      }
      this.schedule(runId, graph, requestKeys);
      return run;
    } finally {
      this.resolving.delete(runId);
    }
  }

  // ------------------------------------------------------------------
  // interpreter loop
  // ------------------------------------------------------------------

  private async executeRun(
    runId: string,
    graph: WorkflowGraph,
    requestKeys?: ProviderKeys,
  ): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) return;
    if (run.status !== 'queued' && run.status !== 'running') return;

    const { varNames } = normalizeGraph(graph);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const checkpoint = run.checkpoint as unknown as EngineCheckpoint;

    const abort = new AbortController();
    this.aborts.set(runId, abort);

    const storedKeys = await this.storage.get<ProviderKeys>(COLLECTIONS.settings, 'provider_keys');

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
        requestKeys,
        storedKeys: storedKeys ?? undefined,
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
        if (!isResuming) {
          await this.emit(runId, {
            type: 'node.started',
            runId,
            nodeId: node.id,
            nodeType: node.type,
            name: node.name,
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
          // agent-level continue-on-error
          if (node.type === 'agent') {
            const cfg = node.config as unknown as AgentNodeConfig;
            if (cfg.continueOnError) {
              await this.emit(runId, {
                type: 'node.failed',
                runId,
                nodeId: node.id,
                error: (e as Error).message,
                at: nowIso(),
              });
              result = {
                outputs: { output_text: '', error: (e as Error).message },
                nextHandle: null,
              };
            } else {
              throw e;
            }
          } else {
            throw e;
          }
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
          };
          checkpoint.resume = result.pause.resumeState ?? undefined;
          run.pendingApproval = approval;
          run.status = result.pause.kind === 'client_tool' ? 'awaiting_client_tool' : 'awaiting_approval';
          await persistRun();
          await this.emit(runId, {
            type: 'approval.requested',
            runId,
            approval,
            at: nowIso(),
          });
          this.aborts.delete(runId);
          return;
        }

        // ---- record outputs ----
        // Any unconsumed resume payload must not leak into later nodes
        // (e.g. an 'approved' decision bypassing the next approval gate).
        checkpoint.resume = undefined;
        if (result.outputs) {
          const varName = varNames.get(node.id) ?? node.id;
          checkpoint.nodeOutputs[varName] = result.outputs as JsonValue;
        }
        if (result.historyAppend?.length) {
          checkpoint.history.push(...result.historyAppend);
        }

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

        // ---- follow the edge ----
        const handle = result.nextHandle ?? null;
        const edge = graph.edges.find(
          (e) => e.source === node.id && (e.sourceHandle ?? null) === handle,
        );
        checkpoint.lastNodeId = node.id;
        checkpoint.currentNodeId = edge?.target ?? null;

        // Periodic checkpointing keeps long runs resumable after crashes.
        await persistRun();
      }

      // ---- completed ----
      if (abort.signal.aborted) return; // cancelled during the last node
      run.status = 'completed';
      run.output = finalOutput !== undefined ? finalOutput : (checkpoint.lastAgentText || null);
      run.endedAt = nowIso();
      run.pendingApproval = undefined;
      await persistRun();
      await this.emit(runId, {
        type: 'run.completed',
        runId,
        output: run.output,
        at: nowIso(),
      });
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
      await this.emit(runId, { type: 'run.failed', runId, error: message, at: nowIso() });
      log.warn(`run ${runId} failed: ${message}`);
    } finally {
      this.aborts.delete(runId);
      // seq counters re-init from storage; drop settled runs to bound memory
      if (['completed', 'failed', 'cancelled'].includes(run.status)) {
        this.eventSeq.delete(runId);
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
