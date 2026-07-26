import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { nowIso } from '../util/id.ts';
import { applyVectorStoreMutation, deploymentAdmissionCostUsd, deploymentAdmissionTokens, settleDeploymentAdmission, type DeploymentCreation, type DeploymentCreationResult, type DeploymentRunAdmission, type DeploymentRunAdmissionRecord, type DeploymentRunAdmissionResult, type DeploymentRunSettlement, type DeploymentSessionAdmission, type DeploymentSessionAdmissionResult, type ListOptions, type Storage, type StoredDoc, type VectorStoreMutation, type WorkflowDeletionResult, type WorkflowDependencyRef, type WorkflowPublishResult } from './index.ts';

const IMMUTABLE_COLLECTIONS = new Set(['governance_audit', 'deployment_releases', 'evaluation_dataset_versions']);
const assertMutable = (collection: string) => { if (IMMUTABLE_COLLECTIONS.has(collection)) throw new Error(`${collection} records are append-only`); };

interface Row {
  id: string;
  ref?: string;
  createdAt: string;
  seq: number;
  doc: unknown;
}

function workflowDependencies(version: Record<string, unknown>): WorkflowDependencyRef[] {
  if (Array.isArray(version.dependencies)) return version.dependencies.filter((value): value is WorkflowDependencyRef => Boolean(value && typeof value === 'object' && typeof (value as WorkflowDependencyRef).workflowId === 'string' && Number.isInteger((value as WorkflowDependencyRef).version)));
  const graph = version.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
  return (graph?.nodes ?? []).flatMap((node) => {
    if (node.type !== 'subflow') return [];
    const config = (node.config ?? node.data ?? {}) as Record<string, unknown>;
    return typeof config.workflowId === 'string' && Number.isInteger(config.version)
      ? [{ nodeId: String(node.id ?? ''), workflowId: config.workflowId, version: Number(config.version) }]
      : [];
  });
}

/**
 * Portable JSON-file driver: one file per collection under <dataDir>/store/.
 * Whole collection kept in memory; writes are atomic (tmp file + rename) and
 * debounced per collection.
 */
export class JsonFileStorage implements Storage {
  private dir: string;
  private collections = new Map<string, Map<string, Row>>();
  private dirty = new Set<string>();
  private seq = 0;
  private flushTimer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'store');
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const name = f.slice(0, -'.json'.length);
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Row[];
        const map = new Map<string, Row>();
        for (const r of rows) {
          map.set(r.id, r);
          if (r.seq > this.seq) this.seq = r.seq;
        }
        this.collections.set(name, map);
      } catch {
        // Corrupt file: keep a backup, start fresh for that collection.
        try {
          fs.copyFileSync(path.join(this.dir, f), path.join(this.dir, `${f}.corrupt`));
        } catch {
          /* ignore */
        }
        this.collections.set(name, new Map());
      }
    }
    // Durability backstop: flush pending writes on process exit.
    this.exitFlush = () => this.flushSync();
    process.once('exit', this.exitFlush);
  }

  private exitFlush: () => void;

  private col(name: string): Map<string, Row> {
    let m = this.collections.get(name);
    if (!m) {
      m = new Map();
      this.collections.set(name, m);
    }
    return m;
  }

  private claimPath(collection: string, id: string): string {
    const lockDir = path.join(this.dir, '.claims');
    fs.mkdirSync(lockDir, { recursive: true });
    return path.join(lockDir, createHash('sha256').update(`${collection}\u0000${id}`).digest('hex'));
  }

  private collectionLockPath(collection: string): string {
    const dir = path.join(this.dir, '.locks');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, createHash('sha256').update(collection).digest('hex'));
  }

  private async acquireCollectionLock(collection: string): Promise<() => void> {
    const lockPath = this.collectionLockPath(collection);
    for (let attempt = 0; attempt < 2500; attempt++) {
      try {
        const handle = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        fs.fsyncSync(handle);
        return () => { try { fs.closeSync(handle); } finally { try { fs.unlinkSync(lockPath); } catch { /* released */ } } };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number; createdAt?: number };
          let alive = true;
          if (owner.pid) { try { process.kill(owner.pid, 0); } catch { alive = false; } }
          if (!alive || Date.now() - Number(owner.createdAt ?? 0) > 30_000) { try { fs.unlinkSync(lockPath); } catch { /* another waiter won */ } }
        } catch { try { fs.unlinkSync(lockPath); } catch { /* retry */ } }
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    }
    throw new Error(`timed out acquiring storage lock for ${collection}`);
  }

  private loadCollection(collection: string): Map<string, Row> {
    const file = path.join(this.dir, `${collection}.json`);
    let rows: Row[] = [];
    try { rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Row[]; } catch { rows = []; }
    const map = new Map(rows.map((row) => [row.id, row]));
    this.collections.set(collection, map);
    return map;
  }

  private durableReplace(file: string, contents: string): void {
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    let handle: number | undefined;
    try {
      handle = fs.openSync(tmp, 'wx');
      fs.writeFileSync(handle, contents, 'utf8');
      // Do not acknowledge a mutation while its replacement file only lives in
      // the OS page cache. This is especially important for run checkpoints.
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      handle = undefined;
      fs.renameSync(tmp, file);

      // Persist the directory entry containing the rename. Some platforms
      // (notably Windows) do not allow directories to be opened for fsync, so
      // retain the strongest guarantee the host exposes.
      try {
        const directory = fs.openSync(path.dirname(file), 'r');
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EISDIR' && code !== 'EINVAL' && code !== 'EPERM' && code !== 'EACCES') throw error;
      }
    } catch (error) {
      if (handle !== undefined) try { fs.closeSync(handle); } catch { /* best effort */ }
      try { fs.unlinkSync(tmp); } catch { /* rename may already have completed */ }
      throw error;
    }
  }

  private commitCollection(collection: string, map: Map<string, Row>): void {
    const file = path.join(this.dir, `${collection}.json`);
    this.durableReplace(file, JSON.stringify([...map.values()]));
    this.collections.set(collection, map);
  }

  private scheduleFlush(collection: string): void {
    this.dirty.add(collection);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushSync();
    }, 100);
    // Don't hold the process open just for pending flushes.
    this.flushTimer.unref?.();
  }

  private flushSync(): void {
    const failed = new Set<string>();
    for (const name of this.dirty) {
      const rows = [...this.col(name).values()];
      const file = path.join(this.dir, `${name}.json`);
      try {
        this.durableReplace(file, JSON.stringify(rows));
        this.dirty.delete(name);
      } catch {
        // Keep the dirty marker: a transient filesystem failure must not
        // silently discard the only record of an acknowledged mutation.
        failed.add(name);
      }
    }
    if (failed.size && !this.closed) {
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = undefined;
          this.flushSync();
        }, 100);
        this.flushTimer.unref?.();
      }
    }
  }

  async put(collection: string, id: string, doc: unknown, ref?: string): Promise<void> {
    assertMutable(collection);
    const release = await this.acquireCollectionLock(collection);
    try {
    const m = this.loadCollection(collection);
    const existing = m.get(id);
    // Clone: callers keep mutating their objects (e.g. the run executor);
    // the store must hold the committed snapshot, not a live reference.
    const snapshot = structuredClone(doc);
    if (existing) {
      existing.doc = snapshot;
      if (ref !== undefined) existing.ref = ref;
    } else {
      this.seq += 1;
      m.set(id, { id, ref, createdAt: nowIso(), seq: this.seq, doc: snapshot });
    }
    this.commitCollection(collection, m);
    } finally { release(); }
  }

  async putIfAbsent(collection: string, id: string, doc: unknown, ref?: string): Promise<boolean> {
    const release = await this.acquireCollectionLock(collection);
    try {
      const map = this.loadCollection(collection);
      if (map.has(id)) return false;
      this.seq += 1;
      const row: Row = {
        id,
        ref,
        createdAt: nowIso(),
        seq: this.seq,
        doc: structuredClone(doc),
      };
      map.set(id, row);
      this.commitCollection(collection, map);
      return true;
    } finally {
      release();
    }
  }

  async compareAndSwap(collection: string, id: string, field: string, expected: unknown, doc: unknown, ref?: string): Promise<boolean> {
    assertMutable(collection);
    const release = await this.acquireCollectionLock(collection);
    try {
      const map = this.loadCollection(collection);
      const row = map.get(id);
      if (!row || (row.doc as Record<string, unknown>)?.[field] !== expected) {
        this.collections.set(collection, map);
        return false;
      }
      row.doc = structuredClone(doc);
      if (ref !== undefined) row.ref = ref;
      map.set(id, row);
      this.commitCollection(collection, map);
      return true;
    } finally {
      release();
    }
  }

  async compareAndDelete(collection: string, id: string, field: string, expected: unknown): Promise<boolean> {
    assertMutable(collection);
    const release = await this.acquireCollectionLock(collection);
    try {
      const map = this.loadCollection(collection);
      const row = map.get(id);
      if (!row || (row.doc as Record<string, unknown>)?.[field] !== expected) {
        this.collections.set(collection, map);
        return false;
      }
      map.delete(id);
      this.commitCollection(collection, map);
      return true;
    } finally {
      release();
    }
  }

  async compareAndSwapWithPut(collection: string, id: string, field: string, expected: unknown, doc: unknown, putCollection: string, putId: string, putDoc: unknown, putRef?: string): Promise<boolean> {
    assertMutable(collection);
    const names = [...new Set([collection, putCollection])].sort();
    const releases: Array<() => void> = [];
    try {
      for (const name of names) releases.push(await this.acquireCollectionLock(name));
      const primary = this.loadCollection(collection);
      const row = primary.get(id);
      if (!row || (row.doc as Record<string, unknown>)?.[field] !== expected) return false;
      const secondary = collection === putCollection ? primary : this.loadCollection(putCollection);
      if (secondary.has(putId)) throw new Error(`document '${putId}' already exists in ${putCollection}`);
      row.doc = structuredClone(doc);
      primary.set(id, row);
      this.seq += 1;
      secondary.set(putId, { id: putId, ref: putRef, createdAt: nowIso(), seq: this.seq, doc: structuredClone(putDoc) });
      // Commit the secondary first: readers may observe an unreferenced version,
      // but never a workflow pointing at a missing immutable version.
      if (secondary !== primary) this.commitCollection(putCollection, secondary);
      this.commitCollection(collection, primary);
      return true;
    } finally { for (const release of releases.reverse()) release(); }
  }

  async createDeploymentIfVersionExists(input: DeploymentCreation): Promise<DeploymentCreationResult> {
    const names = ['deployment_releases', 'deployments', 'versions', 'workflows'].sort();
    const releases: Array<() => void> = [];
    try {
      for (const name of names) releases.push(await this.acquireCollectionLock(name));
      const workflows = this.loadCollection('workflows');
      const versions = this.loadCollection('versions');
      const deployments = this.loadCollection('deployments');
      const deploymentReleases = this.loadCollection('deployment_releases');
      const version = versions.get(input.workflowVersionId);
      if (!workflows.has(input.workflowId) || !version || (version.ref !== input.workflowId && (version.doc as Record<string, unknown>).workflowId !== input.workflowId)) {
        return { status: 'missing_workflow_version' };
      }
      if (deployments.has(input.deploymentId) || deploymentReleases.has(input.releaseId)) return { status: 'conflict' };
      this.seq = Math.max(this.seq, ...[...deployments.values(), ...deploymentReleases.values()].map((row) => row.seq), 0) + 1;
      deploymentReleases.set(input.releaseId, { id: input.releaseId, ref: input.deploymentId, createdAt: nowIso(), seq: this.seq, doc: structuredClone(input.release) });
      this.seq += 1;
      deployments.set(input.deploymentId, { id: input.deploymentId, ref: input.workflowId, createdAt: nowIso(), seq: this.seq, doc: structuredClone(input.deployment) });
      this.commitCollection('deployment_releases', deploymentReleases);
      this.commitCollection('deployments', deployments);
      return { status: 'created' };
    } finally { for (const release of releases.reverse()) release(); }
  }

  async publishWorkflowVersion(input: { workflowId: string; expectedDraftRevision: number; workflow: unknown; versionId: string; version: unknown; dependencies: WorkflowDependencyRef[] }): Promise<WorkflowPublishResult> {
    const names = ['versions', 'workflows'];
    const releases: Array<() => void> = [];
    try {
      for (const name of names) releases.push(await this.acquireCollectionLock(name));
      const workflows = this.loadCollection('workflows');
      const versions = this.loadCollection('versions');
      const workflow = workflows.get(input.workflowId);
      if (!workflow || (workflow.doc as Record<string, unknown>).draftRevision !== input.expectedDraftRevision) return { status: 'revision_conflict' };
      for (const dependency of input.dependencies) {
        if (!versions.has(`${dependency.workflowId}@${dependency.version}`)) return { status: 'missing_dependency', dependency };
      }
      const existingVersion = versions.get(input.versionId);
      if (existingVersion) {
        // A process can stop after the immutable version file is renamed but
        // before the workflow pointer is committed. Retrying the same publish
        // should finish that durable half-commit, not strand the draft forever.
        const sameVersion = existingVersion.ref === input.workflowId
          && JSON.stringify(existingVersion.doc) === JSON.stringify(input.version);
        if (!sameVersion) throw new Error(`document '${input.versionId}' already exists in versions`);
      } else {
        this.seq = Math.max(this.seq, ...[...workflows.values(), ...versions.values()].map((row) => row.seq), 0) + 1;
        versions.set(input.versionId, { id: input.versionId, ref: input.workflowId, createdAt: nowIso(), seq: this.seq, doc: structuredClone(input.version) });
      }
      workflow.doc = structuredClone(input.workflow);
      workflows.set(input.workflowId, workflow);
      if (!existingVersion) this.commitCollection('versions', versions);
      this.commitCollection('workflows', workflows);
      return { status: 'published' };
    } finally { for (const release of releases.reverse()) release(); }
  }

  async deleteWorkflowIfUnreferenced(workflowId: string): Promise<WorkflowDeletionResult> {
    const names = [
      'deployments', 'evaluation_dataset_versions', 'evaluation_datasets',
      'evaluation_runs', 'evaluations', 'versions', 'workflows',
    ].sort();
    const releases: Array<() => void> = [];
    try {
      for (const name of names) releases.push(await this.acquireCollectionLock(name));
      const workflows = this.loadCollection('workflows');
      if (!workflows.has(workflowId)) return { status: 'not_found' };
      const versions = this.loadCollection('versions');
      const deployments = this.loadCollection('deployments');
      const evaluations = this.loadCollection('evaluations');
      const evaluationRuns = this.loadCollection('evaluation_runs');
      const datasets = this.loadCollection('evaluation_datasets');
      const datasetVersions = this.loadCollection('evaluation_dataset_versions');
      const publishedReferrers = [...versions.values()].flatMap((row) => {
        const version = row.doc as Record<string, unknown>;
        const parentWorkflowId = String(version.workflowId ?? row.ref ?? '');
        if (!parentWorkflowId || parentWorkflowId === workflowId) return [];
        const parentVersion = Number(version.version ?? 0);
        return workflowDependencies(version).filter((dependency) => dependency.workflowId === workflowId).map((dependency) => ({ ...dependency, parentWorkflowId, parentVersion }));
      });
      const deploymentIds = [...deployments.values()].filter((row) => {
        const deployment = row.doc as Record<string, unknown>;
        return deployment.workflowId === workflowId && deployment.status !== 'archived';
      }).map((row) => row.id);
      if (publishedReferrers.length || deploymentIds.length) return { status: 'blocked', blockers: { publishedReferrers, deploymentIds } };
      workflows.delete(workflowId);
      for (const [id, row] of versions) if (row.ref === workflowId || (row.doc as Record<string, unknown>).workflowId === workflowId) versions.delete(id);
      const evaluationIds = new Set([...evaluations].filter(([, row]) => row.ref === workflowId || (row.doc as Record<string, unknown>).workflowId === workflowId).map(([id]) => id));
      const datasetIds = new Set([...datasets].filter(([, row]) => row.ref === workflowId || (row.doc as Record<string, unknown>).workflowId === workflowId).map(([id]) => id));
      for (const id of evaluationIds) evaluations.delete(id);
      for (const [id, row] of evaluationRuns) if (evaluationIds.has(String(row.ref ?? (row.doc as Record<string, unknown>).evaluationId ?? ''))) evaluationRuns.delete(id);
      for (const id of datasetIds) datasets.delete(id);
      for (const [id, row] of datasetVersions) if (datasetIds.has(String(row.ref ?? (row.doc as Record<string, unknown>).datasetId ?? ''))) datasetVersions.delete(id);
      try { fs.unlinkSync(this.claimPath('workflows', workflowId)); } catch { /* no atomic claim */ }
      this.commitCollection('workflows', workflows);
      this.commitCollection('versions', versions);
      this.commitCollection('evaluations', evaluations);
      this.commitCollection('evaluation_runs', evaluationRuns);
      this.commitCollection('evaluation_datasets', datasets);
      this.commitCollection('evaluation_dataset_versions', datasetVersions);
      return { status: 'deleted' };
    } finally { for (const release of releases.reverse()) release(); }
  }

  async mutateVectorStore(input: VectorStoreMutation): Promise<boolean> {
    const release = await this.acquireCollectionLock('vector_stores');
    try {
      const stores = this.loadCollection('vector_stores');
      const row = stores.get(input.storeId);
      if (!row) return false;
      row.doc = applyVectorStoreMutation(row.doc as Record<string, unknown>, input);
      stores.set(input.storeId, row);
      this.commitCollection('vector_stores', stores);
      return true;
    } finally { release(); }
  }

  async admitDeploymentSession(input: DeploymentSessionAdmission): Promise<DeploymentSessionAdmissionResult> {
    const names = ['deployments', 'sessions'].sort();
    const releases: Array<() => void> = [];
    try {
      for (const name of names) releases.push(await this.acquireCollectionLock(name));
      const deployments = this.loadCollection('deployments');
      const sessions = this.loadCollection('sessions');
      const deployment = deployments.get(input.deploymentId)?.doc as Record<string, unknown> | undefined;
      if (!deployment || deployment.workflowId !== input.workflowId) return { status: 'rejected', reason: 'not_found' };
      if (deployment.mutationRevision !== input.expectedMutationRevision) return { status: 'revision_conflict' };
      if (deployment.status !== 'active') return { status: 'rejected', reason: 'inactive' };
      const origins = Array.isArray(deployment.allowedOrigins) ? deployment.allowedOrigins : [];
      if (origins.length && (!input.origin || !origins.includes(input.origin))) return { status: 'rejected', reason: 'origin_denied' };
      if (deployment.activeReleaseId !== input.expectedReleaseId && deployment.candidateReleaseId !== input.expectedReleaseId) return { status: 'rejected', reason: 'release_conflict' };
      if (sessions.has(input.sessionId)) return { status: 'id_collision' };
      const deploymentSessions = [...sessions.values()].map((row) => row.doc as Record<string, unknown>).filter((session) => session.deploymentId === input.deploymentId);
      const active = deploymentSessions.filter((session) => session.status === 'active' && String(session.expiresAt) > input.now).length;
      if (active >= Number(deployment.maxActiveSessions)) return { status: 'rejected', reason: 'active_limit' };
      const recent = deploymentSessions.filter((session) => String(session.createdAt) > input.rateWindowStart).length;
      if (recent >= Number(deployment.sessionRateLimitPerMinute)) return { status: 'rejected', reason: 'rate_limit' };
      this.seq = Math.max(this.seq, ...[...deployments.values(), ...sessions.values()].map((row) => row.seq), 0) + 1;
      sessions.set(input.sessionId, { id: input.sessionId, ref: input.workflowId, createdAt: nowIso(), seq: this.seq, doc: structuredClone(input.session) });
      this.commitCollection('sessions', sessions);
      return { status: 'inserted' };
    } finally { for (const release of releases.reverse()) release(); }
  }

  async admitDeploymentRun(input: DeploymentRunAdmission): Promise<DeploymentRunAdmissionResult> {
    const names = ['deployment_run_admissions', 'deployments'].sort();
    const releases: Array<() => void> = [];
    try {
      for (const name of names) releases.push(await this.acquireCollectionLock(name));
      const deployments = this.loadCollection('deployments');
      const admissions = this.loadCollection('deployment_run_admissions');
      const deployment = deployments.get(input.deploymentId)?.doc as Record<string, unknown> | undefined;
      if (!deployment || deployment.workflowId !== input.workflowId) return { status: 'rejected', reason: 'not_found' };
      if (deployment.status !== 'active') return { status: 'rejected', reason: 'inactive' };
      const existing = admissions.get(input.admissionId)?.doc as DeploymentRunAdmissionRecord | undefined;
      if (existing) {
        if (existing.deploymentId !== input.deploymentId || existing.signature !== input.signature) return { status: 'idempotency_conflict' };
        return { status: 'existing', admission: structuredClone(existing) };
      }
      const records = [...admissions.values()].map((row) => row.doc as DeploymentRunAdmissionRecord).filter((record) => record.deploymentId === input.deploymentId);
      const active = records.filter((record) => record.status === 'reserved' || record.status === 'active').length;
      const maxConcurrent = Number(deployment.maxConcurrentRuns ?? Number.MAX_SAFE_INTEGER);
      if (active >= maxConcurrent) return { status: 'rejected', reason: 'concurrent_limit' };
      const recent = records.filter((record) => record.createdAt > input.rateWindowStart).length;
      const maxPerMinute = Number(deployment.maxRunsPerMinute ?? Number.MAX_SAFE_INTEGER);
      if (recent >= maxPerMinute) return { status: 'rejected', reason: 'rate_limit' };
      const today = records.filter((record) => record.createdAt >= input.dayWindowStart).length;
      const maxPerDay = Number(deployment.maxRunsPerDay ?? Number.MAX_SAFE_INTEGER);
      if (today >= maxPerDay) return { status: 'rejected', reason: 'daily_limit' };
      const todayRecords = records.filter((record) => record.createdAt >= input.dayWindowStart);
      const maxTokensPerDay = deployment.maxTokensPerDay === undefined ? undefined : Number(deployment.maxTokensPerDay);
      const committedTokens = todayRecords.reduce((sum, record) => sum + deploymentAdmissionTokens(record), 0);
      if (maxTokensPerDay !== undefined && committedTokens + input.reservedTokens > maxTokensPerDay) return { status: 'rejected', reason: 'token_limit' };
      const maxCostPerDay = deployment.maxEstimatedCostUsdPerDay === undefined ? undefined : Number(deployment.maxEstimatedCostUsdPerDay);
      if (maxCostPerDay !== undefined && todayRecords.some((record) => (record.actualUnpricedLlmCalls ?? 0) > 0 || (record.actualUnpricedEmbeddingOperations ?? 0) > 0)) return { status: 'rejected', reason: 'unpriced_cost' };
      const committedCost = todayRecords.reduce((sum, record) => sum + deploymentAdmissionCostUsd(record), 0);
      if (maxCostPerDay !== undefined && committedCost + input.reservedEstimatedCostUsd > maxCostPerDay + Number.EPSILON) return { status: 'rejected', reason: 'cost_limit' };
      const admission: DeploymentRunAdmissionRecord = {
        id: input.admissionId,
        deploymentId: input.deploymentId,
        workflowId: input.workflowId,
        deploymentReleaseId: input.deploymentReleaseId,
        signature: input.signature,
        status: 'reserved',
        createdAt: input.now,
        reservedTokens: input.reservedTokens,
        reservedEstimatedCostUsd: input.reservedEstimatedCostUsd,
      };
      this.seq = Math.max(this.seq, ...[...deployments.values(), ...admissions.values()].map((row) => row.seq), 0) + 1;
      admissions.set(input.admissionId, { id: input.admissionId, ref: input.deploymentId, createdAt: input.now, seq: this.seq, doc: structuredClone(admission) });
      this.commitCollection('deployment_run_admissions', admissions);
      return { status: 'inserted', admission };
    } finally { for (const release of releases.reverse()) release(); }
  }

  async bindDeploymentRun(admissionId: string, deploymentId: string, signature: string, runId: string): Promise<boolean> {
    const release = await this.acquireCollectionLock('deployment_run_admissions');
    try {
      const admissions = this.loadCollection('deployment_run_admissions');
      const row = admissions.get(admissionId);
      const admission = row?.doc as DeploymentRunAdmissionRecord | undefined;
      if (!row || !admission || admission.deploymentId !== deploymentId || admission.signature !== signature || (admission.runId && admission.runId !== runId)) return false;
      if (admission.runId === runId && admission.status !== 'reserved') return true;
      admission.runId = runId;
      if (admission.status === 'reserved') admission.status = 'active';
      row.doc = structuredClone(admission);
      admissions.set(admissionId, row);
      this.commitCollection('deployment_run_admissions', admissions);
      return true;
    } finally { release(); }
  }

  async completeDeploymentRun(admissionId: string, deploymentId: string, runId: string, status: 'completed' | 'failed' | 'cancelled', completedAt: string, settlement?: DeploymentRunSettlement): Promise<boolean> {
    const release = await this.acquireCollectionLock('deployment_run_admissions');
    try {
      const admissions = this.loadCollection('deployment_run_admissions');
      const row = admissions.get(admissionId);
      const admission = row?.doc as DeploymentRunAdmissionRecord | undefined;
      if (!row || !admission || admission.deploymentId !== deploymentId || (admission.runId && admission.runId !== runId)) return false;
      if (admission.runId === runId && admission.status === status && admission.completedAt && (!settlement || admission.actualTokens !== undefined)) return true;
      admission.runId = runId;
      admission.status = status;
      admission.completedAt = completedAt;
      settleDeploymentAdmission(admission, settlement);
      row.doc = structuredClone(admission);
      admissions.set(admissionId, row);
      this.commitCollection('deployment_run_admissions', admissions);
      return true;
    } finally { release(); }
  }

  async releaseDeploymentRun(admissionId: string, deploymentId: string, signature: string): Promise<boolean> {
    const release = await this.acquireCollectionLock('deployment_run_admissions');
    try {
      const admissions = this.loadCollection('deployment_run_admissions');
      const admission = admissions.get(admissionId)?.doc as DeploymentRunAdmissionRecord | undefined;
      if (!admission || admission.deploymentId !== deploymentId || admission.signature !== signature || admission.status !== 'reserved' || admission.runId) return false;
      admissions.delete(admissionId);
      this.commitCollection('deployment_run_admissions', admissions);
      return true;
    } finally { release(); }
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(this.dir, `${collection}.json`), 'utf8')) as Row[];
      const committed = rows.find((row) => row.id === id);
      if (committed) {
        this.col(collection).set(id, committed);
        return structuredClone(committed.doc) as T;
      }
    } catch { /* use pending local state */ }
    const row = this.col(collection).get(id);
    if (row) return structuredClone(row.doc) as T;
    try {
      const claimed = JSON.parse(fs.readFileSync(this.claimPath(collection, id), 'utf8')) as Row;
      this.col(collection).set(id, claimed);
      return structuredClone(claimed.doc) as T;
    } catch {
      return undefined;
    }
  }

  async delete(collection: string, id: string): Promise<boolean> {
    assertMutable(collection);
    const release = await this.acquireCollectionLock(collection);
    try {
    const map = this.loadCollection(collection);
    const ok = map.delete(id);
    try { fs.unlinkSync(this.claimPath(collection, id)); } catch { /* no atomic claim */ }
    if (ok) this.commitCollection(collection, map);
    return ok;
    } finally { release(); }
  }

  async deleteWhere(collection: string, ref: string): Promise<number> {
    assertMutable(collection);
    const release = await this.acquireCollectionLock(collection);
    try {
    const m = this.loadCollection(collection);
    let n = 0;
    for (const [id, row] of m) {
      if (row.ref === ref) {
        m.delete(id);
        n++;
      }
    }
    if (n > 0) this.commitCollection(collection, m);
    return n;
    } finally { release(); }
  }

  async list<T>(collection: string, opts: ListOptions = {}): Promise<StoredDoc<T>[]> {
    let rows = [...this.loadCollection(collection).values()];
    if (opts.ref !== undefined) rows = rows.filter((r) => r.ref === opts.ref);
    rows.sort((a, b) => (opts.order === 'desc' ? b.seq - a.seq : a.seq - b.seq));
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map((r) => ({
      id: r.id,
      ref: r.ref,
      createdAt: r.createdAt,
      doc: structuredClone(r.doc) as T,
    }));
  }

  async count(collection: string, ref?: string): Promise<number> {
    const rows = this.loadCollection(collection);
    if (ref === undefined) return rows.size;
    let n = 0;
    for (const row of rows.values()) if (row.ref === ref) n++;
    return n;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    process.removeListener('exit', this.exitFlush);
    this.flushSync();
  }
}
