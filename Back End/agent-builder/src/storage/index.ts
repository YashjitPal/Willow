/**
 * Persistence: a small document store with two drivers:
 *  - SQLite via the built-in `node:sqlite` (Node >= 22.5 behind flag, >= 23.4 stable)
 *  - JSON files (atomic writes) as a portable fallback
 *
 * Documents are JSON blobs keyed by (collection, id) with an optional `ref`
 * column for parent lookups (spans by run, runs by workflow, chunks by store).
 */

export interface ListOptions {
  ref?: string;
  limit?: number;
  offset?: number;
  /** 'asc' (default) or 'desc' by createdAt insertion ordering. */
  order?: 'asc' | 'desc';
}

export interface StoredDoc<T = unknown> {
  id: string;
  ref?: string;
  createdAt: string;
  doc: T;
}

export interface DeploymentSessionAdmission {
  deploymentId: string;
  workflowId: string;
  expectedMutationRevision: number;
  expectedReleaseId: string;
  origin?: string;
  now: string;
  rateWindowStart: string;
  sessionId: string;
  session: unknown;
}

export type DeploymentSessionAdmissionResult =
  | { status: 'inserted' }
  | { status: 'revision_conflict' }
  | { status: 'id_collision' }
  | { status: 'rejected'; reason: 'not_found' | 'inactive' | 'origin_denied' | 'active_limit' | 'rate_limit' | 'release_conflict' };

export type DeploymentRunAdmissionStatus = 'reserved' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface DeploymentRunAdmissionRecord {
  id: string;
  deploymentId: string;
  workflowId: string;
  deploymentReleaseId?: string;
  signature: string;
  status: DeploymentRunAdmissionStatus;
  createdAt: string;
  reservedTokens: number;
  reservedEstimatedCostUsd: number;
  actualTokens?: number;
  actualEstimatedCostUsd?: number;
  actualUnpricedLlmCalls?: number;
  actualUnpricedEmbeddingOperations?: number;
  tokenOverage?: number;
  estimatedCostUsdOverage?: number;
  runId?: string;
  completedAt?: string;
}

export interface DeploymentRunAdmission {
  deploymentId: string;
  workflowId: string;
  deploymentReleaseId?: string;
  admissionId: string;
  signature: string;
  now: string;
  rateWindowStart: string;
  dayWindowStart: string;
  reservedTokens: number;
  reservedEstimatedCostUsd: number;
}

export interface DeploymentRunSettlement {
  inputTokens: number;
  outputTokens: number;
  embeddingInputTokens?: number;
  estimatedCostUsd: number;
  unpricedLlmCalls: number;
  unpricedEmbeddingOperations?: number;
}

export function deploymentAdmissionTokens(record: DeploymentRunAdmissionRecord): number {
  return record.actualTokens ?? record.reservedTokens ?? 0;
}

export function deploymentAdmissionCostUsd(record: DeploymentRunAdmissionRecord): number {
  return record.actualEstimatedCostUsd ?? record.reservedEstimatedCostUsd ?? 0;
}

export function settleDeploymentAdmission(record: DeploymentRunAdmissionRecord, settlement?: DeploymentRunSettlement): void {
  if (!settlement) return;
  const actualTokens = Math.max(0, Number(settlement.inputTokens ?? 0)) + Math.max(0, Number(settlement.outputTokens ?? 0)) + Math.max(0, Number(settlement.embeddingInputTokens ?? 0));
  const actualCost = Math.max(0, Number(settlement.estimatedCostUsd ?? 0));
  record.actualTokens = actualTokens;
  record.actualEstimatedCostUsd = Number(actualCost.toFixed(12));
  record.actualUnpricedLlmCalls = Math.max(0, Number(settlement.unpricedLlmCalls ?? 0));
  record.actualUnpricedEmbeddingOperations = Math.max(0, Number(settlement.unpricedEmbeddingOperations ?? 0));
  record.tokenOverage = Math.max(0, actualTokens - (record.reservedTokens ?? 0));
  record.estimatedCostUsdOverage = Number(Math.max(0, actualCost - (record.reservedEstimatedCostUsd ?? 0)).toFixed(12));
}

export type DeploymentRunAdmissionResult =
  | { status: 'inserted'; admission: DeploymentRunAdmissionRecord }
  | { status: 'existing'; admission: DeploymentRunAdmissionRecord }
  | { status: 'idempotency_conflict' }
  | { status: 'rejected'; reason: 'not_found' | 'inactive' | 'concurrent_limit' | 'rate_limit' | 'daily_limit' | 'token_limit' | 'cost_limit' | 'unpriced_cost' };

export interface DeploymentCreation {
  workflowId: string;
  workflowVersionId: string;
  deploymentId: string;
  deployment: unknown;
  releaseId: string;
  release: unknown;
}

export type DeploymentCreationResult =
  | { status: 'created' }
  | { status: 'missing_workflow_version' }
  | { status: 'conflict' };

export interface WorkflowDependencyRef {
  nodeId: string;
  workflowId: string;
  version: number;
}

export interface WorkflowPublishedReferrer extends WorkflowDependencyRef {
  parentWorkflowId: string;
  parentVersion: number;
}

export interface WorkflowDeletionBlockers {
  publishedReferrers: WorkflowPublishedReferrer[];
  deploymentIds: string[];
  batchIds?: string[];
  runIds?: string[];
}

export type WorkflowDeletionResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'blocked'; blockers: WorkflowDeletionBlockers };

export type WorkflowPublishResult =
  | { status: 'published' }
  | { status: 'revision_conflict' }
  | { status: 'missing_dependency'; dependency: WorkflowDependencyRef };

export interface VectorStoreMutation {
  storeId: string;
  updatedAt: string;
  patch?: { fileCount?: number; chunkCount?: number; embedder?: string };
  usage?: {
    operation: 'ingestion' | 'search';
    operations: number;
    requestCount: number;
    reportedInputTokens: number;
    unreportedTokenOperations: number;
    unpricedOperations: number;
    estimatedCostUsd: number;
  };
}

export function applyVectorStoreMutation(document: Record<string, unknown>, input: VectorStoreMutation): Record<string, unknown> {
  const next = structuredClone(document);
  if (input.patch) Object.assign(next, input.patch);
  if (input.usage) {
    const usage = (next.embeddingUsage ?? {}) as Record<string, unknown>;
    const current = (usage[input.usage.operation] ?? {}) as Record<string, unknown>;
    usage[input.usage.operation] = {
      operations: Number(current.operations ?? 0) + input.usage.operations,
      requestCount: Number(current.requestCount ?? 0) + input.usage.requestCount,
      reportedInputTokens: Number(current.reportedInputTokens ?? 0) + input.usage.reportedInputTokens,
      unreportedTokenOperations: Number(current.unreportedTokenOperations ?? 0) + input.usage.unreportedTokenOperations,
      unpricedOperations: Number(current.unpricedOperations ?? 0) + input.usage.unpricedOperations,
      estimatedCostUsd: Number((Number(current.estimatedCostUsd ?? 0) + input.usage.estimatedCostUsd).toFixed(12)),
    };
    next.embeddingUsage = usage;
  }
  next.updatedAt = input.updatedAt;
  return next;
}

export interface Storage {
  put(collection: string, id: string, doc: unknown, ref?: string): Promise<void>;
  /** Atomically insert a document only when the key does not already exist. */
  putIfAbsent(collection: string, id: string, doc: unknown, ref?: string): Promise<boolean>;
  compareAndSwap(collection: string, id: string, field: string, expected: unknown, doc: unknown, ref?: string): Promise<boolean>;
  /** Atomically delete a document only when one field still has the expected value. */
  compareAndDelete(collection: string, id: string, field: string, expected: unknown): Promise<boolean>;
  compareAndSwapWithPut(
    collection: string, id: string, field: string, expected: unknown, doc: unknown,
    putCollection: string, putId: string, putDoc: unknown, putRef?: string,
  ): Promise<boolean>;
  createDeploymentIfVersionExists(input: DeploymentCreation): Promise<DeploymentCreationResult>;
  admitDeploymentSession(input: DeploymentSessionAdmission): Promise<DeploymentSessionAdmissionResult>;
  admitDeploymentRun(input: DeploymentRunAdmission): Promise<DeploymentRunAdmissionResult>;
  bindDeploymentRun(admissionId: string, deploymentId: string, signature: string, runId: string): Promise<boolean>;
  completeDeploymentRun(admissionId: string, deploymentId: string, runId: string, status: Extract<DeploymentRunAdmissionStatus, 'completed' | 'failed' | 'cancelled'>, completedAt: string, settlement?: DeploymentRunSettlement): Promise<boolean>;
  releaseDeploymentRun(admissionId: string, deploymentId: string, signature: string): Promise<boolean>;
  publishWorkflowVersion(input: { workflowId: string; expectedDraftRevision: number; workflow: unknown; versionId: string; version: unknown; dependencies: WorkflowDependencyRef[] }): Promise<WorkflowPublishResult>;
  deleteWorkflowIfUnreferenced(workflowId: string): Promise<WorkflowDeletionResult>;
  mutateVectorStore(input: VectorStoreMutation): Promise<boolean>;
  get<T = unknown>(collection: string, id: string): Promise<T | undefined>;
  delete(collection: string, id: string): Promise<boolean>;
  deleteWhere(collection: string, ref: string): Promise<number>;
  list<T = unknown>(collection: string, opts?: ListOptions): Promise<StoredDoc<T>[]>;
  count(collection: string, ref?: string): Promise<number>;
  credentialVaultStatus?(): Promise<{ mode: 'local' | 'environment'; activeKeyId: string; keyCount: number; encryptedRecords: number; rotation?: { targetKeyId: string; migrated: number; total: number } }>;
  rotateCredentialVault?(): Promise<{ activeKeyId: string; keyCount: number; migrated: number }>;
  retireCredentialVaultKeys?(): Promise<{ activeKeyId: string; keyCount: number; retired: string[] }>;
  close(): Promise<void>;
}

export const COLLECTIONS = {
  workflows: 'workflows',
  versions: 'versions',
  runs: 'runs',
  spans: 'spans',
  mcpServers: 'mcp_servers',
  vectorStores: 'vector_stores',
  vectorFiles: 'vector_files',
  vectorChunks: 'vector_chunks',
  sessions: 'sessions',
  threads: 'threads',
  evaluations: 'evaluations',
  evaluationRuns: 'evaluation_runs',
  batches: 'batches',
  evaluationDatasets: 'evaluation_datasets',
  evaluationDatasetVersions: 'evaluation_dataset_versions',
  settings: 'settings',
  idempotency: 'idempotency',
  runLeases: 'run_leases',
  apiKeys: 'api_keys',
  governanceAudit: 'governance_audit',
  deployments: 'deployments',
  deploymentReleases: 'deployment_releases',
  deploymentRunAdmissions: 'deployment_run_admissions',
  workflowReviewThreads: 'workflow_review_threads',
  workflowPresence: 'workflow_presence',
  secretVariables: 'secret_variables',
} as const;

import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '../util/log.ts';

const log = createLogger('storage');

export async function createStorage(dataDir: string): Promise<Storage> {
  fs.mkdirSync(dataDir, { recursive: true });
  const { VaultStorage } = await import('./vault.ts');
  const driver = (process.env.AGENT_BUILDER_STORAGE || 'auto').toLowerCase();

  if (driver === 'json') {
    const { JsonFileStorage } = await import('./jsonfile.ts');
    log.info(`using JSON file storage at ${dataDir}`);
    return new VaultStorage(new JsonFileStorage(dataDir), dataDir);
  }

  if (driver === 'sqlite' || driver === 'auto') {
    try {
      const { SqliteStorage } = await import('./sqlite.ts');
      const s = new SqliteStorage(path.join(dataDir, 'agent-builder.db'));
      log.info(`using SQLite storage at ${path.join(dataDir, 'agent-builder.db')}`);
      return new VaultStorage(s, dataDir);
    } catch (err) {
      if (driver === 'sqlite') throw err;
      log.warn(
        `node:sqlite unavailable (${(err as Error).message}); falling back to JSON file storage`,
      );
    }
  }

  const { JsonFileStorage } = await import('./jsonfile.ts');
  log.info(`using JSON file storage at ${dataDir}`);
  return new VaultStorage(new JsonFileStorage(dataDir), dataDir);
}
