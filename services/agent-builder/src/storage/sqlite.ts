import { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../util/id.ts';
import { applyVectorStoreMutation, deploymentAdmissionCostUsd, deploymentAdmissionTokens, settleDeploymentAdmission, type DeploymentCreation, type DeploymentCreationResult, type DeploymentRunAdmission, type DeploymentRunAdmissionRecord, type DeploymentRunAdmissionResult, type DeploymentRunSettlement, type DeploymentSessionAdmission, type DeploymentSessionAdmissionResult, type ListOptions, type Storage, type StoredDoc, type VectorStoreMutation, type WorkflowDeletionResult, type WorkflowDependencyRef, type WorkflowPublishResult } from './index.ts';

const IMMUTABLE_COLLECTIONS = new Set(['governance_audit', 'deployment_releases', 'evaluation_dataset_versions']);
const assertMutable = (collection: string) => { if (IMMUTABLE_COLLECTIONS.has(collection)) throw new Error(`${collection} records are append-only`); };

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
 * SQLite driver on the built-in node:sqlite. Synchronous under the hood
 * (fine for a local single-user service) but exposed via the async Storage
 * interface so drivers are interchangeable.
 */
export class SqliteStorage implements Storage {
  private db: DatabaseSync;
  private seq = 0;
  private closed = false;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        ref TEXT,
        created_at TEXT NOT NULL,
        seq INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_docs_ref ON docs (collection, ref);
      CREATE INDEX IF NOT EXISTS idx_docs_seq ON docs (collection, seq);
    `);
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM docs').get() as
      | { m: number }
      | undefined;
    this.seq = Number(row?.m ?? 0);
  }

  async put(collection: string, id: string, doc: unknown, ref?: string): Promise<void> {
    assertMutable(collection);
    const existing = this.db
      .prepare('SELECT created_at, seq, ref FROM docs WHERE collection = ? AND id = ?')
      .get(collection, id) as { created_at: string; seq: number; ref: string | null } | undefined;

    if (existing) {
      this.db
        .prepare('UPDATE docs SET json = ?, ref = ? WHERE collection = ? AND id = ?')
        .run(JSON.stringify(doc), ref ?? existing.ref, collection, id);
    } else {
      this.seq += 1;
      this.db
        .prepare(
          'INSERT INTO docs (collection, id, ref, created_at, seq, json) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(collection, id, ref ?? null, nowIso(), this.seq, JSON.stringify(doc));
    }
  }

  async putIfAbsent(collection: string, id: string, doc: unknown, ref?: string): Promise<boolean> {
    const row = this.db.prepare(`
      INSERT INTO docs (collection, id, ref, created_at, seq, json)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM docs), ?)
      ON CONFLICT(collection, id) DO NOTHING
      RETURNING 1 AS inserted
    `).get(collection, id, ref ?? null, nowIso(), JSON.stringify(doc)) as { inserted: number } | undefined;
    return row !== undefined;
  }

  async compareAndSwap(collection: string, id: string, field: string, expected: unknown, doc: unknown, ref?: string): Promise<boolean> {
    assertMutable(collection);
    if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error('invalid compare-and-swap field');
    const result = this.db.prepare(`UPDATE docs SET json = ?, ref = COALESCE(?, ref) WHERE collection = ? AND id = ? AND json_extract(json, '$.${field}') = ?`)
      .run(JSON.stringify(doc), ref ?? null, collection, id, expected as never);
    return Number(result.changes) === 1;
  }

  async compareAndDelete(collection: string, id: string, field: string, expected: unknown): Promise<boolean> {
    assertMutable(collection);
    if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error('invalid compare-and-delete field');
    const result = this.db.prepare(`DELETE FROM docs WHERE collection = ? AND id = ? AND json_extract(json, '$.${field}') = ?`)
      .run(collection, id, expected as never);
    return Number(result.changes) === 1;
  }

  async compareAndSwapWithPut(collection: string, id: string, field: string, expected: unknown, doc: unknown, putCollection: string, putId: string, putDoc: unknown, putRef?: string): Promise<boolean> {
    assertMutable(collection);
    if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error('invalid compare-and-swap field');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const changed = this.db.prepare(`UPDATE docs SET json = ? WHERE collection = ? AND id = ? AND json_extract(json, '$.${field}') = ?`)
        .run(JSON.stringify(doc), collection, id, expected as never);
      if (Number(changed.changes) !== 1) { this.db.exec('ROLLBACK'); return false; }
      this.db.prepare(`INSERT INTO docs (collection,id,ref,created_at,seq,json) VALUES (?,?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM docs),?)`)
        .run(putCollection, putId, putRef ?? null, nowIso(), JSON.stringify(putDoc));
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    }
  }

  async createDeploymentIfVersionExists(input: DeploymentCreation): Promise<DeploymentCreationResult> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const workflow = this.db.prepare(`SELECT 1 AS found FROM docs WHERE collection = 'workflows' AND id = ?`).get(input.workflowId);
      const versionRow = this.db.prepare(`SELECT ref,json FROM docs WHERE collection = 'versions' AND id = ?`).get(input.workflowVersionId) as { ref: string | null; json: string } | undefined;
      const version = versionRow ? JSON.parse(versionRow.json) as Record<string, unknown> : undefined;
      if (!workflow || !versionRow || (versionRow.ref !== input.workflowId && version?.workflowId !== input.workflowId)) {
        this.db.exec('ROLLBACK');
        return { status: 'missing_workflow_version' };
      }
      const conflict = this.db.prepare(`SELECT 1 AS found FROM docs WHERE (collection = 'deployments' AND id = ?) OR (collection = 'deployment_releases' AND id = ?) LIMIT 1`).get(input.deploymentId, input.releaseId);
      if (conflict) {
        this.db.exec('ROLLBACK');
        return { status: 'conflict' };
      }
      const insert = this.db.prepare(`INSERT INTO docs (collection,id,ref,created_at,seq,json) VALUES (?,?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM docs),?)`);
      insert.run('deployment_releases', input.releaseId, input.deploymentId, nowIso(), JSON.stringify(input.release));
      insert.run('deployments', input.deploymentId, input.workflowId, nowIso(), JSON.stringify(input.deployment));
      this.db.exec('COMMIT');
      return { status: 'created' };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
  }

  async publishWorkflowVersion(input: { workflowId: string; expectedDraftRevision: number; workflow: unknown; versionId: string; version: unknown; dependencies: WorkflowDependencyRef[] }): Promise<WorkflowPublishResult> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT json FROM docs WHERE collection = 'workflows' AND id = ?`).get(input.workflowId) as { json: string } | undefined;
      if (!row || (JSON.parse(row.json) as Record<string, unknown>).draftRevision !== input.expectedDraftRevision) { this.db.exec('ROLLBACK'); return { status: 'revision_conflict' }; }
      for (const dependency of input.dependencies) {
        const found = this.db.prepare(`SELECT 1 AS found FROM docs WHERE collection = 'versions' AND id = ?`).get(`${dependency.workflowId}@${dependency.version}`);
        if (!found) { this.db.exec('ROLLBACK'); return { status: 'missing_dependency', dependency }; }
      }
      this.db.prepare(`INSERT INTO docs (collection,id,ref,created_at,seq,json) VALUES ('versions',?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM docs),?)`).run(input.versionId, input.workflowId, nowIso(), JSON.stringify(input.version));
      this.db.prepare(`UPDATE docs SET json = ? WHERE collection = 'workflows' AND id = ?`).run(JSON.stringify(input.workflow), input.workflowId);
      this.db.exec('COMMIT');
      return { status: 'published' };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
  }

  async deleteWorkflowIfUnreferenced(workflowId: string): Promise<WorkflowDeletionResult> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const workflow = this.db.prepare(`SELECT 1 AS found FROM docs WHERE collection = 'workflows' AND id = ?`).get(workflowId);
      if (!workflow) { this.db.exec('ROLLBACK'); return { status: 'not_found' }; }
      const versionRows = this.db.prepare(`SELECT ref,json FROM docs WHERE collection = 'versions'`).all() as Array<{ ref: string | null; json: string }>;
      const publishedReferrers = versionRows.flatMap((row) => {
        const version = JSON.parse(row.json) as Record<string, unknown>;
        const parentWorkflowId = String(version.workflowId ?? row.ref ?? '');
        if (!parentWorkflowId || parentWorkflowId === workflowId) return [];
        const parentVersion = Number(version.version ?? 0);
        return workflowDependencies(version).filter((dependency) => dependency.workflowId === workflowId).map((dependency) => ({ ...dependency, parentWorkflowId, parentVersion }));
      });
      const deploymentRows = this.db.prepare(`SELECT id,json FROM docs WHERE collection = 'deployments'`).all() as Array<{ id: string; json: string }>;
      const deploymentIds = deploymentRows.filter((row) => { const deployment = JSON.parse(row.json) as Record<string, unknown>; return deployment.workflowId === workflowId && deployment.status !== 'archived'; }).map((row) => row.id);
      if (publishedReferrers.length || deploymentIds.length) { this.db.exec('ROLLBACK'); return { status: 'blocked', blockers: { publishedReferrers, deploymentIds } }; }
      this.db.prepare(`DELETE FROM docs WHERE collection = 'workflows' AND id = ?`).run(workflowId);
      this.db.prepare(`DELETE FROM docs WHERE collection = 'versions' AND (ref = ? OR json_extract(json,'$.workflowId') = ?)`).run(workflowId, workflowId);
      this.db.prepare(`DELETE FROM docs WHERE collection = 'evaluation_runs' AND ref IN (SELECT id FROM docs WHERE collection = 'evaluations' AND (ref = ? OR json_extract(json,'$.workflowId') = ?))`).run(workflowId, workflowId);
      this.db.prepare(`DELETE FROM docs WHERE collection = 'evaluation_dataset_versions' AND ref IN (SELECT id FROM docs WHERE collection = 'evaluation_datasets' AND (ref = ? OR json_extract(json,'$.workflowId') = ?))`).run(workflowId, workflowId);
      this.db.prepare(`DELETE FROM docs WHERE collection = 'evaluations' AND (ref = ? OR json_extract(json,'$.workflowId') = ?)`).run(workflowId, workflowId);
      this.db.prepare(`DELETE FROM docs WHERE collection = 'evaluation_datasets' AND (ref = ? OR json_extract(json,'$.workflowId') = ?)`).run(workflowId, workflowId);
      this.db.exec('COMMIT');
      return { status: 'deleted' };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
  }

  async mutateVectorStore(input: VectorStoreMutation): Promise<boolean> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT json FROM docs WHERE collection = 'vector_stores' AND id = ?`).get(input.storeId) as { json: string } | undefined;
      if (!row) { this.db.exec('ROLLBACK'); return false; }
      const next = applyVectorStoreMutation(JSON.parse(row.json) as Record<string, unknown>, input);
      this.db.prepare(`UPDATE docs SET json = ? WHERE collection = 'vector_stores' AND id = ?`).run(JSON.stringify(next), input.storeId);
      this.db.exec('COMMIT');
      return true;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
  }

  async admitDeploymentSession(input: DeploymentSessionAdmission): Promise<DeploymentSessionAdmissionResult> {
    this.db.exec('BEGIN IMMEDIATE');
    const reject = (result: DeploymentSessionAdmissionResult) => { this.db.exec('ROLLBACK'); return result; };
    try {
      const row = this.db.prepare(`SELECT json FROM docs WHERE collection = 'deployments' AND id = ?`).get(input.deploymentId) as { json: string } | undefined;
      if (!row) return reject({ status: 'rejected', reason: 'not_found' });
      const deployment = JSON.parse(row.json) as Record<string, unknown>;
      if (deployment.workflowId !== input.workflowId) return reject({ status: 'rejected', reason: 'not_found' });
      if (deployment.mutationRevision !== input.expectedMutationRevision) return reject({ status: 'revision_conflict' });
      if (deployment.status !== 'active') return reject({ status: 'rejected', reason: 'inactive' });
      const origins = Array.isArray(deployment.allowedOrigins) ? deployment.allowedOrigins : [];
      if (origins.length && (!input.origin || !origins.includes(input.origin))) return reject({ status: 'rejected', reason: 'origin_denied' });
      if (deployment.activeReleaseId !== input.expectedReleaseId && deployment.candidateReleaseId !== input.expectedReleaseId) return reject({ status: 'rejected', reason: 'release_conflict' });
      if (this.db.prepare(`SELECT 1 AS found FROM docs WHERE collection = 'sessions' AND id = ?`).get(input.sessionId)) return reject({ status: 'id_collision' });
      const active = this.db.prepare(`SELECT COUNT(*) AS n FROM docs WHERE collection = 'sessions' AND json_extract(json,'$.deploymentId') = ? AND json_extract(json,'$.status') = 'active' AND json_extract(json,'$.expiresAt') > ?`).get(input.deploymentId, input.now) as { n: number };
      if (Number(active.n) >= Number(deployment.maxActiveSessions)) return reject({ status: 'rejected', reason: 'active_limit' });
      const recent = this.db.prepare(`SELECT COUNT(*) AS n FROM docs WHERE collection = 'sessions' AND json_extract(json,'$.deploymentId') = ? AND json_extract(json,'$.createdAt') > ?`).get(input.deploymentId, input.rateWindowStart) as { n: number };
      if (Number(recent.n) >= Number(deployment.sessionRateLimitPerMinute)) return reject({ status: 'rejected', reason: 'rate_limit' });
      this.db.prepare(`INSERT INTO docs (collection,id,ref,created_at,seq,json) VALUES ('sessions',?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM docs),?)`).run(input.sessionId, input.workflowId, nowIso(), JSON.stringify(input.session));
      this.db.exec('COMMIT');
      return { status: 'inserted' };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    }
  }

  async admitDeploymentRun(input: DeploymentRunAdmission): Promise<DeploymentRunAdmissionResult> {
    this.db.exec('BEGIN IMMEDIATE');
    const reject = (result: DeploymentRunAdmissionResult) => { this.db.exec('ROLLBACK'); return result; };
    try {
      const row = this.db.prepare(`SELECT json FROM docs WHERE collection = 'deployments' AND id = ?`).get(input.deploymentId) as { json: string } | undefined;
      if (!row) return reject({ status: 'rejected', reason: 'not_found' });
      const deployment = JSON.parse(row.json) as Record<string, unknown>;
      if (deployment.workflowId !== input.workflowId) return reject({ status: 'rejected', reason: 'not_found' });
      if (deployment.status !== 'active') return reject({ status: 'rejected', reason: 'inactive' });
      const existingRow = this.db.prepare(`SELECT json FROM docs WHERE collection = 'deployment_run_admissions' AND id = ?`).get(input.admissionId) as { json: string } | undefined;
      if (existingRow) {
        const existing = JSON.parse(existingRow.json) as DeploymentRunAdmissionRecord;
        if (existing.deploymentId !== input.deploymentId || existing.signature !== input.signature) return reject({ status: 'idempotency_conflict' });
        this.db.exec('COMMIT');
        return { status: 'existing', admission: existing };
      }
      const active = this.db.prepare(`SELECT COUNT(*) AS n FROM docs WHERE collection = 'deployment_run_admissions' AND json_extract(json,'$.deploymentId') = ? AND json_extract(json,'$.status') IN ('reserved','active')`).get(input.deploymentId) as { n: number };
      if (Number(active.n) >= Number(deployment.maxConcurrentRuns ?? Number.MAX_SAFE_INTEGER)) return reject({ status: 'rejected', reason: 'concurrent_limit' });
      const recent = this.db.prepare(`SELECT COUNT(*) AS n FROM docs WHERE collection = 'deployment_run_admissions' AND json_extract(json,'$.deploymentId') = ? AND json_extract(json,'$.createdAt') > ?`).get(input.deploymentId, input.rateWindowStart) as { n: number };
      if (Number(recent.n) >= Number(deployment.maxRunsPerMinute ?? Number.MAX_SAFE_INTEGER)) return reject({ status: 'rejected', reason: 'rate_limit' });
      const today = this.db.prepare(`SELECT COUNT(*) AS n FROM docs WHERE collection = 'deployment_run_admissions' AND json_extract(json,'$.deploymentId') = ? AND json_extract(json,'$.createdAt') >= ?`).get(input.deploymentId, input.dayWindowStart) as { n: number };
      if (Number(today.n) >= Number(deployment.maxRunsPerDay ?? Number.MAX_SAFE_INTEGER)) return reject({ status: 'rejected', reason: 'daily_limit' });
      const todayRows = this.db.prepare(`SELECT json FROM docs WHERE collection = 'deployment_run_admissions' AND json_extract(json,'$.deploymentId') = ? AND json_extract(json,'$.createdAt') >= ?`).all(input.deploymentId, input.dayWindowStart) as Array<{ json: string }>;
      const todayAdmissions = todayRows.map((item) => JSON.parse(item.json) as DeploymentRunAdmissionRecord);
      const committedTokens = todayAdmissions.reduce((sum, record) => sum + deploymentAdmissionTokens(record), 0);
      if (deployment.maxTokensPerDay !== undefined && committedTokens + input.reservedTokens > Number(deployment.maxTokensPerDay)) return reject({ status: 'rejected', reason: 'token_limit' });
      const committedCost = todayAdmissions.reduce((sum, record) => sum + deploymentAdmissionCostUsd(record), 0);
      if (deployment.maxEstimatedCostUsdPerDay !== undefined && todayAdmissions.some((record) => (record.actualUnpricedLlmCalls ?? 0) > 0 || (record.actualUnpricedEmbeddingOperations ?? 0) > 0)) return reject({ status: 'rejected', reason: 'unpriced_cost' });
      if (deployment.maxEstimatedCostUsdPerDay !== undefined && committedCost + input.reservedEstimatedCostUsd > Number(deployment.maxEstimatedCostUsdPerDay) + Number.EPSILON) return reject({ status: 'rejected', reason: 'cost_limit' });
      const admission: DeploymentRunAdmissionRecord = { id: input.admissionId, deploymentId: input.deploymentId, workflowId: input.workflowId, deploymentReleaseId: input.deploymentReleaseId, signature: input.signature, status: 'reserved', createdAt: input.now, reservedTokens: input.reservedTokens, reservedEstimatedCostUsd: input.reservedEstimatedCostUsd };
      this.db.prepare(`INSERT INTO docs (collection,id,ref,created_at,seq,json) VALUES ('deployment_run_admissions',?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM docs),?)`).run(input.admissionId, input.deploymentId, input.now, JSON.stringify(admission));
      this.db.exec('COMMIT');
      return { status: 'inserted', admission };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    }
  }

  async bindDeploymentRun(admissionId: string, deploymentId: string, signature: string, runId: string): Promise<boolean> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT json FROM docs WHERE collection = 'deployment_run_admissions' AND id = ?`).get(admissionId) as { json: string } | undefined;
      if (!row) { this.db.exec('ROLLBACK'); return false; }
      const admission = JSON.parse(row.json) as DeploymentRunAdmissionRecord;
      if (admission.deploymentId !== deploymentId || admission.signature !== signature || (admission.runId && admission.runId !== runId)) { this.db.exec('ROLLBACK'); return false; }
      if (!(admission.runId === runId && admission.status !== 'reserved')) {
        admission.runId = runId;
        if (admission.status === 'reserved') admission.status = 'active';
        this.db.prepare(`UPDATE docs SET json = ? WHERE collection = 'deployment_run_admissions' AND id = ?`).run(JSON.stringify(admission), admissionId);
      }
      this.db.exec('COMMIT');
      return true;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
  }

  async completeDeploymentRun(admissionId: string, deploymentId: string, runId: string, status: 'completed' | 'failed' | 'cancelled', completedAt: string, settlement?: DeploymentRunSettlement): Promise<boolean> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT json FROM docs WHERE collection = 'deployment_run_admissions' AND id = ?`).get(admissionId) as { json: string } | undefined;
      if (!row) { this.db.exec('ROLLBACK'); return false; }
      const admission = JSON.parse(row.json) as DeploymentRunAdmissionRecord;
      if (admission.deploymentId !== deploymentId || (admission.runId && admission.runId !== runId)) { this.db.exec('ROLLBACK'); return false; }
      if (!(admission.runId === runId && admission.status === status && admission.completedAt && (!settlement || admission.actualTokens !== undefined))) {
        admission.runId = runId;
        admission.status = status;
        admission.completedAt = completedAt;
        settleDeploymentAdmission(admission, settlement);
        this.db.prepare(`UPDATE docs SET json = ? WHERE collection = 'deployment_run_admissions' AND id = ?`).run(JSON.stringify(admission), admissionId);
      }
      this.db.exec('COMMIT');
      return true;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
  }

  async releaseDeploymentRun(admissionId: string, deploymentId: string, signature: string): Promise<boolean> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT json FROM docs WHERE collection = 'deployment_run_admissions' AND id = ?`).get(admissionId) as { json: string } | undefined;
      if (!row) { this.db.exec('ROLLBACK'); return false; }
      const admission = JSON.parse(row.json) as DeploymentRunAdmissionRecord;
      if (admission.deploymentId !== deploymentId || admission.signature !== signature || admission.status !== 'reserved' || admission.runId) { this.db.exec('ROLLBACK'); return false; }
      this.db.prepare(`DELETE FROM docs WHERE collection = 'deployment_run_admissions' AND id = ?`).run(admissionId);
      this.db.exec('COMMIT');
      return true;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const row = this.db
      .prepare('SELECT json FROM docs WHERE collection = ? AND id = ?')
      .get(collection, id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    assertMutable(collection);
    const res = this.db
      .prepare('DELETE FROM docs WHERE collection = ? AND id = ?')
      .run(collection, id);
    return Number(res.changes) > 0;
  }

  async deleteWhere(collection: string, ref: string): Promise<number> {
    assertMutable(collection);
    const res = this.db
      .prepare('DELETE FROM docs WHERE collection = ? AND ref = ?')
      .run(collection, ref);
    return Number(res.changes);
  }

  async list<T>(collection: string, opts: ListOptions = {}): Promise<StoredDoc<T>[]> {
    const order = opts.order === 'desc' ? 'DESC' : 'ASC';
    const limit = opts.limit ?? -1;
    const offset = opts.offset ?? 0;
    let rows: Array<{ id: string; ref: string | null; created_at: string; json: string }>;
    if (opts.ref !== undefined) {
      rows = this.db
        .prepare(
          `SELECT id, ref, created_at, json FROM docs WHERE collection = ? AND ref = ? ORDER BY seq ${order} LIMIT ? OFFSET ?`,
        )
        .all(collection, opts.ref, limit, offset) as typeof rows;
    } else {
      rows = this.db
        .prepare(
          `SELECT id, ref, created_at, json FROM docs WHERE collection = ? ORDER BY seq ${order} LIMIT ? OFFSET ?`,
        )
        .all(collection, limit, offset) as typeof rows;
    }
    return rows.map((r) => ({
      id: r.id,
      ref: r.ref ?? undefined,
      createdAt: r.created_at,
      doc: JSON.parse(r.json) as T,
    }));
  }

  async count(collection: string, ref?: string): Promise<number> {
    if (ref !== undefined) {
      const row = this.db
        .prepare('SELECT COUNT(*) AS c FROM docs WHERE collection = ? AND ref = ?')
        .get(collection, ref) as { c: number };
      return Number(row.c);
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM docs WHERE collection = ?')
      .get(collection) as { c: number };
    return Number(row.c);
  }

  /**
   * Idempotent: hosts can race two teardown paths at the same handle (a Vite
   * dev restart fires both the httpServer 'close' event and closeBundle), and
   * DatabaseSync.close() throws ERR_INVALID_STATE on an already-closed handle.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
