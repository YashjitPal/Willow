import type { BatchItem, BatchJob, BatchStatus, ProviderKeys, Run, RunInput } from '../domain/types.ts';
import type { RunEngine } from '../engine/executor.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';

const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled']);
const PAUSED_RUNS = new Set(['awaiting_credentials', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_debug']);
const RECOVERABLE_BATCHES = new Set<BatchStatus>([
  'queued', 'running', 'cancelling', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_debug',
]);

export class BatchService {
  private readonly active = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly storage: Storage;
  private readonly engine: RunEngine;

  constructor(storage: Storage, engine: RunEngine) {
    this.storage = storage;
    this.engine = engine;
  }

  async get(id: string): Promise<BatchJob | undefined> {
    const batch = await this.storage.get<BatchJob>(COLLECTIONS.batches, id);
    return batch ? structuredClone(batch) : undefined;
  }

  async list(opts?: { workflowIds?: string[]; status?: BatchStatus; limit?: number; offset?: number }): Promise<BatchJob[]> {
    const rows = await this.storage.list<BatchJob>(COLLECTIONS.batches, { order: 'desc' });
    const allowed = opts?.workflowIds ? new Set(opts.workflowIds) : undefined;
    return rows
      .map((row) => row.doc)
      .filter((batch) => (!allowed || allowed.has(batch.workflowId)) && (!opts?.status || batch.status === opts.status))
      .slice(opts?.offset ?? 0, (opts?.offset ?? 0) + (opts?.limit ?? 50))
      .map((batch) => structuredClone(batch));
  }

  async submit(input: {
    workflowId: string;
    version: number;
    inputs: RunInput[];
    concurrency?: number;
    requestKeys?: ProviderKeys;
  }): Promise<BatchJob> {
    if (!Number.isInteger(input.version) || input.version < 1) throw new Error('batch version must be a positive published version');
    if (!Array.isArray(input.inputs) || input.inputs.length < 1 || input.inputs.length > 100) throw new Error('batch inputs must contain between 1 and 100 items');
    const concurrency = input.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error('batch concurrency must be between 1 and 10');
    const now = nowIso();
    const items: BatchItem[] = input.inputs.map((value, index) => ({ index, input: structuredClone(value), status: 'pending' }));
    const batch: BatchJob = {
      id: ids.batch(), workflowId: input.workflowId, workflowVersion: input.version, concurrency,
      status: 'queued', total: items.length, completed: 0, failed: 0, cancelled: 0,
      items, createdAt: now, updatedAt: now,
    };
    if (!await this.storage.putIfAbsent(COLLECTIONS.batches, batch.id, batch, batch.workflowId)) throw new Error('batch id collision; retry');
    this.launch(batch.id, input.requestKeys);
    return structuredClone(batch);
  }

  async cancel(id: string): Promise<BatchJob | undefined> {
    const batch = await this.get(id);
    if (!batch) return undefined;
    if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'cancelled') return batch;
    batch.cancelRequested = true;
    batch.status = 'cancelling';
    batch.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.batches, id, batch, batch.workflowId);
    this.controllers.get(id)?.abort(new Error('batch cancelled'));
    await Promise.all(batch.items.filter((item) => item.runId && !TERMINAL_RUNS.has(item.status)).map(async (item) => {
      await this.engine.cancelRun(item.runId!);
    }));
    this.launch(id);
    return this.get(id);
  }

  async resume(id: string, requestKeys?: ProviderKeys): Promise<BatchJob> {
    const batch = await this.get(id);
    if (!batch) throw new Error(`batch '${id}' not found`);
    if (batch.status !== 'awaiting_credentials') throw new Error(`batch '${id}' is not awaiting credentials (status: ${batch.status})`);
    for (const item of batch.items) {
      if (!item.runId || item.status !== 'awaiting_credentials') continue;
      const run = await this.engine.resumeRun(item.runId, requestKeys);
      item.status = run.status as BatchItem['status'];
      item.credentialRequirements = undefined;
    }
    batch.status = 'queued';
    batch.updatedAt = nowIso();
    if (!await this.storage.compareAndSwap(COLLECTIONS.batches, id, 'status', 'awaiting_credentials', batch, batch.workflowId)) {
      const current = await this.get(id);
      // A cancellation may win while provider credentials are being applied to
      // child runs. Do not let the stale resume snapshot revive the batch.
      if (current?.cancelRequested || current?.status === 'cancelling' || current?.status === 'cancelled') {
        await Promise.all(batch.items
          .filter((item) => item.runId && !TERMINAL_RUNS.has(item.status))
          .map((item) => this.engine.cancelRun(item.runId!)));
      }
      throw new Error(`batch '${id}' is not awaiting credentials (status: ${current?.status ?? 'missing'})`);
    }
    this.launch(id, requestKeys);
    return batch;
  }

  /** Resume queued/running jobs after a process restart. Request keys are never persisted. */
  async recoverPending(): Promise<number> {
    const rows = await this.storage.list<BatchJob>(COLLECTIONS.batches);
    let recovered = 0;
    for (const row of rows) {
      // Interactive controls may resolve a child immediately before shutdown, after the
      // batch worker has already persisted its paused state. Reconcile those batches on
      // startup; credential pauses remain explicit because request keys are memory-only.
      if (!RECOVERABLE_BATCHES.has(row.doc.status)) continue;
      if (this.active.has(row.doc.id)) continue;
      this.launch(row.doc.id);
      recovered++;
    }
    return recovered;
  }

  /** Wake paused batches after an interactive child run is resolved. */
  async reconcileRun(runId: string, requestKeys?: ProviderKeys): Promise<number> {
    const rows = await this.storage.list<BatchJob>(COLLECTIONS.batches);
    let resumed = 0;
    for (const row of rows) {
      const batch = row.doc;
      if (!RECOVERABLE_BATCHES.has(batch.status) || this.active.has(batch.id)) continue;
      if (!batch.items.some((item) => item.runId === runId && PAUSED_RUNS.has(item.status))) continue;
      this.launch(batch.id, requestKeys);
      resumed++;
    }
    return resumed;
  }

  private launch(id: string, requestKeys?: ProviderKeys): void {
    if (this.active.has(id)) return;
    this.active.add(id);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    void this.process(id, requestKeys, controller.signal).finally(() => {
      this.active.delete(id);
      this.controllers.delete(id);
    });
  }

  private async process(id: string, requestKeys: ProviderKeys | undefined, signal: AbortSignal): Promise<void> {
    let batch = await this.get(id);
    if (!batch) return;
    try {
      if (batch.cancelRequested || batch.status === 'cancelling') {
        await this.cancelQueued(batch);
        return;
      }
      batch.status = 'running';
      await this.persist(batch);
      let cursor = 0;
      let pauseStatus: BatchStatus | undefined;
      const worker = async (): Promise<void> => {
        for (;;) {
          if (signal.aborted || pauseStatus) return;
          const index = cursor++;
          if (index >= batch!.items.length) return;
          const item = batch!.items[index];
          if (TERMINAL_RUNS.has(item.status)) continue;
          let run = item.runId ? await this.engine.getRun(item.runId) : undefined;
          if (!run) {
            item.startedAt = nowIso();
            run = await this.engine.createRun({
              workflowId: batch!.workflowId,
              version: batch!.workflowVersion,
              input: structuredClone(item.input),
              requestKeys,
              idempotencyKey: `batch:${batch!.id}:${item.index}`,
            });
            item.runId = run.id;
          }
          item.status = run.status as BatchItem['status'];
          item.credentialRequirements = run.credentialRequirements;
          await this.persist(batch!);
          if (PAUSED_RUNS.has(run.status)) {
            pauseStatus = run.status as BatchStatus;
            return;
          }
          run = await this.waitForRun(run.id, signal);
          item.status = run.status as BatchItem['status'];
          item.error = run.error;
          item.credentialRequirements = run.credentialRequirements;
          if (TERMINAL_RUNS.has(run.status)) item.endedAt = run.endedAt ?? nowIso();
          await this.persist(batch!);
          if (PAUSED_RUNS.has(run.status)) {
            pauseStatus = run.status as BatchStatus;
            return;
          }
        }
      };
      await Promise.all(Array.from({ length: batch.concurrency }, () => worker()));
      batch = (await this.get(id)) ?? batch;
      if (signal.aborted || batch.cancelRequested || batch.status === 'cancelling') {
        await this.cancelQueued(batch);
        return;
      }
      if (pauseStatus) {
        batch.status = pauseStatus;
        await this.persist(batch);
        return;
      }
      batch.status = 'completed';
      batch.completedAt = nowIso();
      await this.persist(batch);
    } catch (error) {
      batch = (await this.get(id)) ?? batch;
      if (signal.aborted || batch.cancelRequested || batch.status === 'cancelling') {
        await this.cancelQueued(batch);
        return;
      }
      batch.status = 'failed';
      batch.error = (error as Error).message;
      batch.completedAt = nowIso();
      await this.persist(batch);
    }
  }

  private async waitForRun(id: string, signal: AbortSignal): Promise<Run> {
    for (;;) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('batch cancelled');
      const run = await this.engine.getRun(id);
      if (!run) throw new Error(`batch child run '${id}' disappeared`);
      if (TERMINAL_RUNS.has(run.status) || PAUSED_RUNS.has(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async cancelQueued(batch: BatchJob): Promise<void> {
    for (const item of batch.items) {
      if (!TERMINAL_RUNS.has(item.status)) {
        if (item.runId) {
          const run = await this.engine.cancelRun(item.runId);
          item.status = (run?.status ?? 'cancelled') as BatchItem['status'];
        } else item.status = 'cancelled';
        item.endedAt = nowIso();
      }
    }
    batch.status = 'cancelled';
    batch.completedAt = nowIso();
    batch.cancelRequested = true;
    await this.persist(batch);
  }

  private async persist(batch: BatchJob): Promise<void> {
    batch.completed = batch.items.filter((item) => item.status === 'completed').length;
    batch.failed = batch.items.filter((item) => item.status === 'failed').length;
    batch.cancelled = batch.items.filter((item) => item.status === 'cancelled').length;
    batch.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.batches, batch.id, batch, batch.workflowId);
  }
}
