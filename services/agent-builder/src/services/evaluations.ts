/**
 * Local trace-evaluation service.
 *
 * Agent Builder exposes an Evaluate surface for running graders against
 * traces. This implementation keeps graders deterministic and local so the
 * workflow can be evaluated without another model or external service.
 */

import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue, ModelUsageBucket, ProviderKeys, Run, RunEvent, RunInput, TraceSpan, Workflow, WorkflowGraph } from '../domain/types.ts';
import { chatWithModel, resolveKey } from '../providers/index.ts';
import { providerForModel, type LLMUsage } from '../providers/types.ts';
import { extractJson } from '../engine/jsonSchema.ts';
import { PRICING_CATALOG_VERSION, priceModelUsage } from './pricing.ts';
import { buildTraceSpans } from '../engine/trace.ts';
import type { RunEngine } from '../engine/executor.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { DEFAULT_SUBJECT_ID, DEFAULT_WORKSPACE_ID, type AuthPrincipal } from './governance.ts';
import { loadProviderKeys } from './providerCredentials.ts';

export type EvaluationAccess = Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>;

export type GraderType = 'contains' | 'equals' | 'regex' | 'run_status' | 'event_count' | 'model_judge' | 'label_model_judge';
type EvaluationCredentialProvider = 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm';

export interface EvaluationGrader {
  id: string;
  name: string;
  type: GraderType;
  /** `output` (default) or `error` for text graders. */
  target?: 'output' | 'error';
  /** Optional node/span selector for scoped graders. Occurrence is zero-based. */
  nodeId?: string;
  spanType?: TraceSpan['type'];
  occurrence?: number;
  field?: 'output' | 'status' | 'error' | 'duration' | 'usage' | 'arguments' | 'result' | 'toolCalls';
  workflowVersion?: number;
  /** Expected text/number. For event_count, this is the minimum count. */
  expected?: JsonValue;
  /** Resolve the expected value from the current dataset row's human reference. */
  reference?: 'test_case_expected';
  /** Event type to count for event_count graders. */
  eventType?: string;
  /** Model and rubric for model_judge graders. */
  model?: string;
  rubric?: string;
  /** Allowed categorical labels and the subset considered passing. */
  labels?: string[];
  passingLabels?: string[];
  /** Numeric score required to pass a model judge. Default 0.5. */
  threshold?: number;
  /** Relative contribution to the aggregate score. Default 1. */
  weight?: number;
}

export interface EvaluationDefinition {
  id: string;
  workflowId: string;
  ownerId?: string;
  workspaceId?: string;
  name: string;
  graders: EvaluationGrader[];
  testCases: EvaluationTestCase[];
  /** Optional immutable reusable dataset pin. Inline testCases remain supported. */
  datasetId?: string;
  datasetVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationTestCase {
  id: string;
  name: string;
  input: RunInput;
  /** Pinned workflow version; 0 executes the current draft. */
  version: number;
  /** Human-authored ground truth used by reference-backed graders. */
  expectedOutput?: JsonValue;
}

/** Workflow-scoped dataset identity. Versions carry the immutable cases. */
export interface EvaluationDataset {
  id: string;
  workflowId: string;
  ownerId?: string;
  workspaceId?: string;
  name: string;
  description?: string;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Append-only dataset content snapshot. */
export interface EvaluationDatasetVersion {
  id: string;
  datasetId: string;
  workflowId: string;
  ownerId?: string;
  workspaceId?: string;
  version: number;
  testCases: EvaluationTestCase[];
  sha256: string;
  createdAt: string;
}

export interface GraderResult {
  graderId: string;
  name: string;
  passed: boolean;
  score: number;
  detail: string;
  /** Structured categorical grade, when produced by a label grader. */
  label?: string;
  targetFound?: boolean;
  targetKey?: string;
  model?: string;
  provider?: LLMUsage['provider'];
  usage?: EvaluationUsage;
}

export interface EvaluationUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
  modelCalls: number;
  estimatedCostUsd: number;
  unpricedLlmCalls: number;
  unpricedModelCalls: number;
  pricingCatalogVersion: string;
  byModel: Record<string, ModelUsageBucket>;
  provider?: LLMUsage['provider'];
  model?: string;
}

export interface EvaluationRunResult {
  runId: string;
  status: Run['status'];
  score: number;
  results: GraderResult[];
  usage: EvaluationUsage;
  /** Human review captured after automated grading. */
  annotation?: EvaluationResultAnnotation;
}

export interface EvaluationResultAnnotation {
  rating: 'positive' | 'negative';
  feedback?: string;
  reviewerId: string;
  updatedAt: string;
}

/** Trace filters supported by Agent Builder's "add a run" evaluation flow. */
export interface EvaluationRunSelection {
  model?: string;
  tool?: string;
  from?: string;
  to?: string;
}

export interface EvaluationRun {
  id: string;
  evaluationId: string;
  workflowId: string;
  ownerId?: string;
  workspaceId?: string;
  /** Immutable definition used by this job, including graders and test cases. */
  definitionSnapshot?: EvaluationDefinition;
  /** Reusable dataset content captured when this job was enqueued. */
  datasetSnapshot?: EvaluationDatasetVersion;
  /** Draft graph captured when the job was enqueued for version-0 test cases. */
  draftSnapshot?: { graph: WorkflowGraph; sha256: string };
  status: 'queued' | 'running' | 'awaiting_credentials' | 'completed' | 'failed' | 'cancelled';
  /** Provider names only; credential material is never persisted. */
  credentialRequirements?: { providers: EvaluationCredentialProvider[] };
  runIds: string[];
  /** Filters used to resolve runIds. Resolved ids remain the replay source of truth. */
  selection?: EvaluationRunSelection;
  /** Durable mapping for generated evaluation test-case runs. */
  caseRuns?: Array<{ testCaseId: string; runId?: string }>;
  totalRuns: number;
  completedRuns: number;
  score: number;
  results: EvaluationRunResult[];
  usage: EvaluationUsage;
  /** Monotonic concurrency token for human result annotations. */
  annotationRevision?: number;
  createdAt: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  error?: string;
}

export class EvaluationAnnotationStateError extends Error {}

interface PersistedEvent {
  seq: number;
  event: RunEvent;
}

export class EvaluationSelectionError extends Error {
  readonly code = 'invalid_evaluation_run_selection';
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationSelectionError';
  }
}

export class EvaluationCredentialsRequiredError extends Error {
  readonly providers: EvaluationCredentialProvider[];
  constructor(providers: EvaluationCredentialProvider[]) {
    const unique = [...new Set(providers)];
    super(`evaluation requires credentials for provider(s): ${unique.join(', ')}`);
    this.name = 'EvaluationCredentialsRequiredError';
    this.providers = unique;
  }
}

function emptyUsage(): EvaluationUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningTokens: 0,
    modelCalls: 0,
    estimatedCostUsd: 0,
    unpricedLlmCalls: 0,
    unpricedModelCalls: 0,
    pricingCatalogVersion: PRICING_CATALOG_VERSION,
    byModel: {},
  };
}

function mergeUsage(total: EvaluationUsage, part?: EvaluationUsage): EvaluationUsage {
  if (!part) return total;
  total.inputTokens += part.inputTokens ?? 0;
  total.outputTokens += part.outputTokens ?? 0;
  total.cachedInputTokens += part.cachedInputTokens ?? 0;
  total.cacheWriteInputTokens += part.cacheWriteInputTokens ?? 0;
  total.reasoningTokens += part.reasoningTokens ?? 0;
  total.modelCalls += part.modelCalls ?? 0;
  total.estimatedCostUsd = Number((total.estimatedCostUsd + (part.estimatedCostUsd ?? 0)).toFixed(12));
  total.unpricedLlmCalls += part.unpricedLlmCalls ?? 0;
  total.unpricedModelCalls += part.unpricedModelCalls ?? part.unpricedLlmCalls ?? 0;
  if (!total.provider && part.provider) total.provider = part.provider;
  if (!total.model && part.model) total.model = part.model;
  for (const [key, bucket] of Object.entries(part.byModel ?? {})) {
    const existing = total.byModel[key];
    if (!existing) {
      total.byModel[key] = structuredClone(bucket);
      continue;
    }
    existing.inputTokens += bucket.inputTokens;
    existing.outputTokens += bucket.outputTokens;
    existing.cachedInputTokens += bucket.cachedInputTokens;
    existing.cacheWriteInputTokens += bucket.cacheWriteInputTokens;
    existing.reasoningTokens += bucket.reasoningTokens;
    existing.llmCalls += bucket.llmCalls;
    if (existing.pricing.status === 'priced' && bucket.pricing.status === 'priced') {
      existing.pricing.estimatedCostUsd = Number((existing.pricing.estimatedCostUsd + bucket.pricing.estimatedCostUsd).toFixed(12));
    }
  }
  return total;
}

export function usageFromModelResponse(usage: LLMUsage, requestedModel: string): EvaluationUsage {
  const model = (usage.model || requestedModel).replace(/^models\//, '');
  const provider = usage.provider ?? providerForModel(model);
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const cacheWriteInputTokens = usage.cacheWriteInputTokens ?? 0;
  const reasoningTokens = usage.reasoningTokens ?? 0;
  const pricing = priceModelUsage({
    inputTokens,
    outputTokens,
    tokenStatus: usage.tokenStatus,
    cachedInputTokens,
    cacheWriteInputTokens,
    reasoningTokens,
    model,
    provider,
  });
  const result = emptyUsage();
  result.provider = provider;
  result.model = model;
  result.inputTokens = inputTokens;
  result.outputTokens = outputTokens;
  result.cachedInputTokens = cachedInputTokens;
  result.cacheWriteInputTokens = cacheWriteInputTokens;
  result.reasoningTokens = reasoningTokens;
  result.modelCalls = 1;
  result.unpricedLlmCalls = pricing.status === 'unpriced' ? 1 : 0;
  result.unpricedModelCalls = result.unpricedLlmCalls;
  result.estimatedCostUsd = pricing.status === 'priced' ? pricing.estimatedCostUsd : 0;
  result.byModel[`${provider}:${model}`] = {
    provider,
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    reasoningTokens,
    llmCalls: 1,
    pricing,
  };
  return result;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '';
}

function expectedNumber(value: JsonValue): number {
  return typeof value === 'number' ? value : Number(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function datasetVersionId(datasetId: string, version: number): string {
  return `${datasetId}@${version}`;
}

function missingModelJudgeCredentials(
  definition: EvaluationDefinition,
  requestKeys: ProviderKeys | undefined,
  storedKeys: ProviderKeys | undefined,
): EvaluationCredentialProvider[] {
  const missing: EvaluationCredentialProvider[] = [];
  for (const grader of definition.graders) {
    if (grader.type !== 'model_judge' && grader.type !== 'label_model_judge') continue;
    const provider = providerForModel(grader.model || 'gemini-3-flash');
    if (provider === 'mock') continue;
    try {
      resolveKey(provider, requestKeys, storedKeys);
    } catch {
      missing.push(provider);
    }
  }
  return [...new Set(missing)];
}

export class EvaluationService {
  private readonly storage: Storage;
  private readonly engine: RunEngine;
  private readonly activeJobs = new Set<string>();
  private readonly cancelControllers = new Map<string, AbortController>();
  private readonly jobPromises = new Map<string, Promise<void>>();

  constructor(storage: Storage, engine: RunEngine) {
    this.storage = storage;
    this.engine = engine;
  }

  private async workflowOwnership(workflowId: string): Promise<{ ownerId: string; workspaceId: string }> {
    const workflow = await this.storage.get<Workflow>(COLLECTIONS.workflows, workflowId);
    return {
      ownerId: workflow?.ownerId ?? DEFAULT_SUBJECT_ID,
      workspaceId: workflow?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    };
  }

  private async normalizeOwnership<T extends { workflowId: string; ownerId?: string; workspaceId?: string }>(record: T): Promise<T> {
    if (record.ownerId && record.workspaceId) return record;
    const ownership = await this.workflowOwnership(record.workflowId);
    record.ownerId ??= ownership.ownerId;
    record.workspaceId ??= ownership.workspaceId;
    return record;
  }

  private canAccess(record: { ownerId?: string; workspaceId?: string }, access?: EvaluationAccess): boolean {
    return !access || access.authority === 'platform'
      || (record.workspaceId === access.workspaceId && (access.role === 'admin' || record.ownerId === access.subjectId));
  }

  private async ownedWorkflow(workflowId: string, access?: EvaluationAccess): Promise<{ ownerId: string; workspaceId: string } | undefined> {
    const ownership = await this.workflowOwnership(workflowId);
    return this.canAccess(ownership, access) ? ownership : undefined;
  }

  async listDatasets(workflowId: string, access?: EvaluationAccess): Promise<EvaluationDataset[]> {
    const rows = await this.storage.list<EvaluationDataset>(COLLECTIONS.evaluationDatasets, { ref: workflowId, order: 'desc' });
    const datasets = await Promise.all(rows.map((row) => this.normalizeOwnership(row.doc)));
    return datasets.filter((dataset) => this.canAccess(dataset, access));
  }

  async getDataset(id: string, access?: EvaluationAccess): Promise<EvaluationDataset | undefined> {
    const dataset = await this.storage.get<EvaluationDataset>(COLLECTIONS.evaluationDatasets, id);
    if (!dataset) return undefined;
    const normalized = await this.normalizeOwnership(dataset);
    return this.canAccess(normalized, access) ? normalized : undefined;
  }

  async listDatasetVersions(datasetId: string, access?: EvaluationAccess): Promise<EvaluationDatasetVersion[]> {
    if (!await this.getDataset(datasetId, access)) return [];
    const rows = await this.storage.list<EvaluationDatasetVersion>(COLLECTIONS.evaluationDatasetVersions, { ref: datasetId, order: 'desc' });
    const versions = await Promise.all(rows.map((row) => this.normalizeOwnership(row.doc)));
    return versions.filter((version) => this.canAccess(version, access));
  }

  async getDatasetVersion(datasetId: string, version?: number, access?: EvaluationAccess): Promise<EvaluationDatasetVersion | undefined> {
    const dataset = await this.getDataset(datasetId, access);
    if (!dataset) return undefined;
    const selected = version ?? dataset.latestVersion;
    if (!Number.isInteger(selected) || selected < 1) return undefined;
    const snapshot = await this.storage.get<EvaluationDatasetVersion>(COLLECTIONS.evaluationDatasetVersions, datasetVersionId(datasetId, selected));
    if (!snapshot) return undefined;
    const normalized = await this.normalizeOwnership(snapshot);
    return this.canAccess(normalized, access) ? normalized : undefined;
  }

  async createDataset(input: {
    workflowId: string;
    name: string;
    description?: string;
    testCases: EvaluationTestCase[];
  }, access?: EvaluationAccess): Promise<{ dataset: EvaluationDataset; version: EvaluationDatasetVersion }> {
    if (input.testCases.length === 0) throw new Error('an evaluation dataset needs at least one test case');
    const ownership = await this.ownedWorkflow(input.workflowId, access);
    if (!ownership) throw new Error(`workflow '${input.workflowId}' not found`);
    const now = nowIso();
    const dataset: EvaluationDataset = {
      id: ids.evaluationDataset(),
      workflowId: input.workflowId,
      ...ownership,
      name: input.name.trim() || 'Untitled dataset',
      description: input.description?.trim() || undefined,
      latestVersion: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (!await this.storage.putIfAbsent(COLLECTIONS.evaluationDatasets, dataset.id, dataset, dataset.workflowId)) {
      throw new Error('evaluation dataset id collision; retry');
    }
    try {
      const version = await this.createDatasetVersion(dataset.id, input.testCases);
      return { dataset: (await this.getDataset(dataset.id))!, version };
    } catch (error) {
      await this.storage.delete(COLLECTIONS.evaluationDatasets, dataset.id).catch(() => false);
      throw error;
    }
  }

  async createDatasetVersion(datasetId: string, testCases: EvaluationTestCase[], access?: EvaluationAccess): Promise<EvaluationDatasetVersion> {
    if (testCases.length === 0) throw new Error('an evaluation dataset version needs at least one test case');
    for (let attempt = 0; attempt < 12; attempt++) {
      const dataset = await this.getDataset(datasetId, access);
      if (!dataset) throw new Error(`evaluation dataset '${datasetId}' not found`);
      const versionNumber = dataset.latestVersion + 1;
      const cases = structuredClone(testCases);
      const createdAt = nowIso();
      const version: EvaluationDatasetVersion = {
        id: datasetVersionId(dataset.id, versionNumber),
        datasetId: dataset.id,
        workflowId: dataset.workflowId,
        ownerId: dataset.ownerId,
        workspaceId: dataset.workspaceId,
        version: versionNumber,
        testCases: cases,
        sha256: createHash('sha256').update(stableJson(cases)).digest('hex'),
        createdAt,
      };
      const next: EvaluationDataset = {
        ...dataset,
        latestVersion: versionNumber,
        updatedAt: createdAt,
      };
      if (await this.storage.compareAndSwapWithPut(
        COLLECTIONS.evaluationDatasets,
        dataset.id,
        'latestVersion',
        dataset.latestVersion,
        next,
        COLLECTIONS.evaluationDatasetVersions,
        version.id,
        version,
        dataset.id,
      )) return version;
    }
    throw new Error('evaluation dataset changed repeatedly while creating a version; retry');
  }

  private async pinDataset(
    workflowId: string,
    reference: { id: string; version?: number },
    access?: EvaluationAccess,
  ): Promise<{ datasetId: string; datasetVersion: number }> {
    const dataset = await this.getDataset(reference.id, access);
    if (!dataset || dataset.workflowId !== workflowId) throw new Error(`evaluation dataset '${reference.id}' not found for workflow '${workflowId}'`);
    const versionNumber = reference.version ?? dataset.latestVersion;
    const version = await this.getDatasetVersion(dataset.id, versionNumber, access);
    if (!version) throw new Error(`evaluation dataset '${dataset.id}' has no version ${versionNumber}`);
    return { datasetId: dataset.id, datasetVersion: version.version };
  }

  async list(workflowId: string, access?: EvaluationAccess): Promise<EvaluationDefinition[]> {
    const rows = await this.storage.list<EvaluationDefinition>(COLLECTIONS.evaluations, { ref: workflowId });
    const definitions = await Promise.all(rows.map((row) => this.normalizeOwnership(row.doc)));
    return definitions.filter((definition) => this.canAccess(definition, access));
  }

  async get(id: string, access?: EvaluationAccess): Promise<EvaluationDefinition | undefined> {
    const definition = await this.storage.get<EvaluationDefinition>(COLLECTIONS.evaluations, id);
    if (!definition) return undefined;
    const normalized = await this.normalizeOwnership(definition);
    return this.canAccess(normalized, access) ? normalized : undefined;
  }

  async create(input: {
    workflowId: string;
    name: string;
    graders: EvaluationGrader[];
    testCases?: EvaluationTestCase[];
    dataset?: { id: string; version?: number };
  }, access?: EvaluationAccess): Promise<EvaluationDefinition> {
    const now = nowIso();
    const ownership = await this.ownedWorkflow(input.workflowId, access);
    if (!ownership) throw new Error(`workflow '${input.workflowId}' not found`);
    const dataset = input.dataset ? await this.pinDataset(input.workflowId, input.dataset, access) : undefined;
    const definition: EvaluationDefinition = {
      id: ids.evaluation(),
      workflowId: input.workflowId,
      ...ownership,
      name: input.name.trim() || 'Untitled evaluation',
      graders: structuredClone(input.graders),
      testCases: structuredClone(input.testCases ?? []),
      ...dataset,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.put(COLLECTIONS.evaluations, definition.id, definition, input.workflowId);
    return definition;
  }

  async update(
    id: string,
    patch: { name?: string; graders?: EvaluationGrader[]; testCases?: EvaluationTestCase[]; dataset?: { id: string; version?: number } | null },
    access?: EvaluationAccess,
  ): Promise<EvaluationDefinition | undefined> {
    const definition = await this.get(id, access);
    if (!definition) return undefined;
    if (patch.name !== undefined) {
      definition.name = patch.name.trim() || definition.name;
    }
    if (patch.graders !== undefined) {
      definition.graders = structuredClone(patch.graders);
    }
    if (patch.testCases !== undefined) {
      definition.testCases = structuredClone(patch.testCases);
    } else if (!definition.testCases) {
      definition.testCases = [];
    }
    if (patch.dataset === null) {
      delete definition.datasetId;
      delete definition.datasetVersion;
    } else if (patch.dataset) {
      const dataset = await this.pinDataset(definition.workflowId, patch.dataset, access);
      definition.datasetId = dataset.datasetId;
      definition.datasetVersion = dataset.datasetVersion;
    }
    definition.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.evaluations, definition.id, definition, definition.workflowId);
    return definition;
  }

  async remove(id: string, access?: EvaluationAccess): Promise<boolean> {
    const definition = await this.get(id, access);
    if (!definition) return false;
    const jobs = await this.storage.list<EvaluationRun>(COLLECTIONS.evaluationRuns, { ref: id });
    await Promise.all(jobs.map(async (row) => {
      if (row.doc.status === 'queued' || row.doc.status === 'running') await this.cancelRun(row.doc.id);
    }));
    await Promise.all(jobs.map((row) => this.jobPromises.get(row.doc.id)).filter((job): job is Promise<void> => !!job));
    await this.storage.deleteWhere(COLLECTIONS.evaluationRuns, id);
    return this.storage.delete(COLLECTIONS.evaluations, id);
  }

  async evaluate(id: string, requestedRunIds?: string[], requestKeys?: ProviderKeys, access?: EvaluationAccess, selection?: EvaluationRunSelection): Promise<EvaluationRun> {
    const definition = await this.get(id, access);
    if (!definition) throw new Error(`evaluation '${id}' not found`);

    const definitionSnapshot = structuredClone(definition);
    let datasetSnapshot: EvaluationDatasetVersion | undefined;
    if (definition.datasetId) {
      datasetSnapshot = await this.getDatasetVersion(definition.datasetId, definition.datasetVersion);
      if (!datasetSnapshot || datasetSnapshot.workflowId !== definition.workflowId) {
        throw new Error(`evaluation dataset '${definition.datasetId}' version ${definition.datasetVersion ?? '(latest)'} is unavailable`);
      }
      definitionSnapshot.datasetVersion = datasetSnapshot.version;
      definitionSnapshot.testCases = structuredClone(datasetSnapshot.testCases);
    }
    const testCases = definitionSnapshot.testCases ?? [];
    const hasSelection = selection && Object.values(selection).some(Boolean);
    const usesTestCases = requestedRunIds === undefined && !hasSelection && testCases.length > 0;
    if (requestedRunIds !== undefined && hasSelection) {
      throw new EvaluationSelectionError('runIds cannot be combined with model, tool, or date filters');
    }
    const runs = usesTestCases ? [] : await this.selectRuns(definitionSnapshot, requestedRunIds, selection);
    if (!usesTestCases && runs.length === 0) throw new EvaluationSelectionError('no workflow runs matched the evaluation filters');
    let draftSnapshot: EvaluationRun['draftSnapshot'];
    if (usesTestCases && testCases.some((testCase) => testCase.version === 0)) {
      const workflow = await this.storage.get<Workflow>(COLLECTIONS.workflows, definition.workflowId);
      if (!workflow) throw new Error(`workflow '${definition.workflowId}' not found`);
      const graph = structuredClone(workflow.draft);
      draftSnapshot = {
        graph,
        sha256: createHash('sha256').update(JSON.stringify(graph)).digest('hex'),
      };
    }
    const now = nowIso();
    const evaluationRun: EvaluationRun = {
      id: ids.evaluationRun(),
      evaluationId: id,
      workflowId: definition.workflowId,
      ownerId: definition.ownerId,
      workspaceId: definition.workspaceId,
      definitionSnapshot,
      datasetSnapshot: datasetSnapshot ? structuredClone(datasetSnapshot) : undefined,
      draftSnapshot,
      status: 'queued',
      runIds: runs.map((run) => run.id),
      selection: hasSelection ? structuredClone(selection) : undefined,
      caseRuns: usesTestCases ? testCases.map((testCase) => ({ testCaseId: testCase.id })) : undefined,
      totalRuns: usesTestCases ? testCases.length : runs.length,
      completedRuns: 0,
      score: 0,
      results: [],
      usage: emptyUsage(),
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.put(COLLECTIONS.evaluationRuns, evaluationRun.id, evaluationRun, id);
    // Keep the HTTP creation boundary non-blocking. The worker transitions the
    // durable record to `running` after the queued snapshot has been returned.
    setTimeout(() => this.launchJob(evaluationRun, definitionSnapshot, runs, requestKeys), 0);
    return structuredClone(evaluationRun);
  }

  async getRun(id: string, access?: EvaluationAccess): Promise<EvaluationRun | undefined> {
    const run = await this.storage.get<EvaluationRun>(COLLECTIONS.evaluationRuns, id);
    if (!run) return undefined;
    const normalized = await this.normalizeOwnership(run);
    return this.canAccess(normalized, access) ? normalized : undefined;
  }

  async annotateResult(
    id: string,
    resultRunId: string,
    input: { rating: EvaluationResultAnnotation['rating']; feedback?: string },
    access?: EvaluationAccess,
  ): Promise<EvaluationRun | undefined> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const run = await this.getRun(id, access);
      if (!run) return undefined;
      if (run.status !== 'completed') {
        throw new EvaluationAnnotationStateError(`evaluation run '${id}' must be completed before its results can be annotated`);
      }
      const result = run.results.find((candidate) => candidate.runId === resultRunId);
      if (!result) throw new Error(`evaluation result for run '${resultRunId}' not found`);
      const feedback = input.feedback?.trim();
      result.annotation = {
        rating: input.rating,
        ...(feedback ? { feedback } : {}),
        reviewerId: access?.subjectId ?? DEFAULT_SUBJECT_ID,
        updatedAt: nowIso(),
      };
      const expectedRevision = run.annotationRevision;
      run.annotationRevision = (expectedRevision ?? 0) + 1;
      run.updatedAt = result.annotation.updatedAt;
      if (await this.storage.compareAndSwap(
        COLLECTIONS.evaluationRuns,
        run.id,
        'annotationRevision',
        expectedRevision,
        run,
        run.evaluationId,
      )) return structuredClone(run);
    }
    throw new Error(`evaluation run '${id}' annotations changed repeatedly; retry`);
  }

  async cancelRun(id: string, access?: EvaluationAccess): Promise<EvaluationRun | undefined> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const run = await this.getRun(id, access);
      if (!run) return undefined;
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return run;
      const expectedStatus = run.status;
      this.cancelControllers.get(id)?.abort(new Error('evaluation cancelled'));
      run.status = 'cancelled';
      run.updatedAt = nowIso();
      run.completedAt = run.updatedAt;
      if (await this.storage.compareAndSwap(
        COLLECTIONS.evaluationRuns,
        id,
        'status',
        expectedStatus,
        run,
        run.evaluationId,
      )) return run;
    }
    throw new Error(`evaluation run '${id}' changed repeatedly while cancelling; retry`);
  }

  async resumeRun(id: string, requestKeys?: ProviderKeys, access?: EvaluationAccess): Promise<EvaluationRun | undefined> {
    const settlingJob = this.jobPromises.get(id);
    if (settlingJob) {
      await settlingJob;
      if (this.jobPromises.get(id) === settlingJob) this.jobPromises.delete(id);
    }
    const run = await this.getRun(id, access);
    if (!run) return undefined;
    if (run.status !== 'awaiting_credentials') {
      throw new Error(`evaluation run '${id}' is not awaiting credentials (status: ${run.status})`);
    }
    const rawDefinition = run.definitionSnapshot ?? await this.get(run.evaluationId);
    if (!rawDefinition) throw new Error(`evaluation '${run.evaluationId}' no longer exists`);
    const definition = await this.normalizeOwnership(rawDefinition);
    const storedKeys = await loadProviderKeys(this.storage, run.workspaceId);
    const required = run.credentialRequirements?.providers ?? [];
    const missing = required.filter((provider) => {
      try { resolveKey(provider, requestKeys, storedKeys); return false; }
      catch { return true; }
    });
    if (missing.length) throw new EvaluationCredentialsRequiredError(missing);
    const runs = run.caseRuns ? [] : await this.selectRuns(definition, run.runIds);
    run.status = 'queued';
    run.credentialRequirements = undefined;
    run.error = undefined;
    run.completedAt = undefined;
    run.updatedAt = nowIso();
    if (!await this.storage.compareAndSwap(
      COLLECTIONS.evaluationRuns,
      run.id,
      'status',
      'awaiting_credentials',
      run,
      run.evaluationId,
    )) {
      const current = await this.getRun(id, access);
      if (!current) return undefined;
      throw new Error(`evaluation run '${id}' changed while resuming (status: ${current.status})`);
    }
    this.launchJob(run, definition, runs, requestKeys);
    return structuredClone(run);
  }

  /** Resume jobs that were persisted before a process restart. */
  async recoverPendingRuns(): Promise<number> {
    const rows = await this.storage.list<EvaluationRun>(COLLECTIONS.evaluationRuns);
    let recovered = 0;
    for (const row of rows) {
      row.doc = await this.normalizeOwnership(row.doc);
      if (row.doc.status !== 'running' && row.doc.status !== 'queued') continue;
      const rawDefinition = row.doc.definitionSnapshot ?? await this.get(row.doc.evaluationId);
      const definition = rawDefinition ? await this.normalizeOwnership(rawDefinition) : undefined;
      if (this.activeJobs.has(row.doc.id)) continue;
      if (!definition) {
        row.doc.status = 'failed';
        row.doc.error = `evaluation '${row.doc.evaluationId}' no longer exists`;
        row.doc.updatedAt = nowIso();
        row.doc.completedAt = row.doc.updatedAt;
        await this.storage.put(COLLECTIONS.evaluationRuns, row.doc.id, row.doc, row.doc.evaluationId);
        continue;
      }
      try {
        const runs = row.doc.caseRuns
          ? []
          : await this.selectRuns(definition, row.doc.runIds);
        this.launchJob(row.doc, definition, runs, undefined);
        recovered++;
      } catch (error) {
        row.doc.status = 'failed';
        row.doc.error = (error as Error).message;
        row.doc.updatedAt = nowIso();
        row.doc.completedAt = row.doc.updatedAt;
        await this.storage.put(COLLECTIONS.evaluationRuns, row.doc.id, row.doc, row.doc.evaluationId);
      }
    }
    return recovered;
  }

  private async selectRuns(definition: EvaluationDefinition, requestedRunIds?: string[], selection?: EvaluationRunSelection): Promise<Run[]> {
    const rows = (await this.storage.list<Run>(COLLECTIONS.runs, { ref: definition.workflowId, order: 'desc' })).filter((row) => (
      (row.doc.ownerId ?? DEFAULT_SUBJECT_ID) === definition.ownerId
      && (row.doc.workspaceId ?? DEFAULT_WORKSPACE_ID) === definition.workspaceId
    ));
    const available = new Map(rows.map((row) => [row.doc.id, row.doc]));
    if (requestedRunIds !== undefined) {
      const uniqueIds = [...new Set(requestedRunIds)];
      if (uniqueIds.length === 0) throw new EvaluationSelectionError('an evaluation run must include at least one workflow run id');
      const missing = uniqueIds.filter((runId) => !available.has(runId));
      if (missing.length) throw new EvaluationSelectionError(`run(s) ${missing.join(', ')} do not belong to workflow '${definition.workflowId}'`);
      return uniqueIds.map((runId) => available.get(runId)!);
    }
    const model = selection?.model?.trim().toLowerCase();
    const tool = selection?.tool?.trim().toLowerCase();
    const selected: Run[] = [];
    for (const row of rows) {
      const run = row.doc;
      if (selection?.from && run.createdAt < selection.from) continue;
      if (selection?.to && run.createdAt > selection.to) continue;
      if (model && !Object.values(run.usage?.byModel ?? {}).some((bucket) => bucket.model.toLowerCase().includes(model))) continue;
      if (tool) {
        const eventRows = await this.storage.list<PersistedEvent>(COLLECTIONS.spans, { ref: run.id });
        if (!eventRows.some(({ doc }) => doc.event.type.startsWith('tool.') && JSON.stringify(doc.event).toLowerCase().includes(tool))) continue;
      }
      selected.push(run);
    }
    return selected;
  }

  private async processJob(
    evaluationRun: EvaluationRun,
    definition: EvaluationDefinition,
    runs: Run[],
    requestKeys?: ProviderKeys,
  ): Promise<void> {
    if (this.activeJobs.has(evaluationRun.id)) return;
    const persistedBeforeStart = await this.getRun(evaluationRun.id);
    if (!persistedBeforeStart || persistedBeforeStart.status === 'cancelled') return;
    definition = await this.normalizeOwnership(evaluationRun.definitionSnapshot ?? definition);
    this.activeJobs.add(evaluationRun.id);
    const controller = new AbortController();
    this.cancelControllers.set(evaluationRun.id, controller);
    try {
      evaluationRun.status = 'running';
      evaluationRun.credentialRequirements = undefined;
      evaluationRun.error = undefined;
      evaluationRun.startedAt ??= nowIso();
      evaluationRun.updatedAt = nowIso();
      const started = await this.storage.compareAndSwap(
        COLLECTIONS.evaluationRuns,
        evaluationRun.id,
        'status',
        persistedBeforeStart.status,
        evaluationRun,
        evaluationRun.evaluationId,
      );
      if (!started) {
        const current = await this.getRun(evaluationRun.id);
        if (!current || current.status === 'cancelled') return;
        throw new Error(`evaluation run '${evaluationRun.id}' changed while starting (status: ${current.status})`);
      }
      let selectedRuns = runs;
      if (evaluationRun.caseRuns) {
        selectedRuns = await this.materializeCaseRuns(evaluationRun, definition, requestKeys, controller.signal);
      }
      evaluationRun.runIds = selectedRuns.map((run) => run.id);
      evaluationRun.totalRuns = selectedRuns.length;
      evaluationRun.updatedAt = nowIso();
      if (!await this.storage.compareAndSwap(
        COLLECTIONS.evaluationRuns,
        evaluationRun.id,
        'status',
        'running',
        evaluationRun,
        evaluationRun.evaluationId,
      )) {
        const current = await this.getRun(evaluationRun.id);
        if (current?.status === 'cancelled') {
          evaluationRun.status = 'cancelled';
          return;
        }
        throw new Error(`evaluation run '${evaluationRun.id}' changed while materializing cases`);
      }
      const existing = new Map(evaluationRun.results.map((result) => [result.runId, result]));
      const testCaseByRunId = new Map<string, EvaluationTestCase>();
      const testCasesById = new Map((definition.testCases ?? []).map((testCase) => [testCase.id, testCase]));
      for (const caseRun of evaluationRun.caseRuns ?? []) {
        const testCase = testCasesById.get(caseRun.testCaseId);
        if (caseRun.runId && testCase) testCaseByRunId.set(caseRun.runId, testCase);
      }
      const pending = selectedRuns.filter((run) => !existing.has(run.id));
      const maxConcurrent = Math.min(4, Math.max(1, pending.length));
      let cursor = 0;
      let persistChain = Promise.resolve();
      const persist = async () => {
        persistChain = persistChain.then(async () => {
          evaluationRun.results = selectedRuns.map((run) => existing.get(run.id)).filter((result): result is EvaluationRunResult => !!result);
          evaluationRun.completedRuns = evaluationRun.results.length;
          evaluationRun.usage = evaluationRun.results.reduce<EvaluationUsage>(
            (total, result) => mergeUsage(total, result.usage),
            emptyUsage(),
          );
          evaluationRun.score = evaluationRun.results.length
            ? evaluationRun.results.reduce((sum, result) => sum + result.score, 0) / evaluationRun.results.length
            : 0;
          evaluationRun.updatedAt = nowIso();
          const saved = await this.storage.compareAndSwap(
            COLLECTIONS.evaluationRuns,
            evaluationRun.id,
            'status',
            'running',
            evaluationRun,
            evaluationRun.evaluationId,
          );
          if (!saved) {
            const current = await this.getRun(evaluationRun.id);
            if (current?.status === 'cancelled') {
              evaluationRun.status = 'cancelled';
              controller.abort(new Error('evaluation cancelled'));
              return;
            }
            throw new Error(`evaluation run '${evaluationRun.id}' changed while saving progress`);
          }
        });
        await persistChain;
      };
      const worker = async () => {
        for (;;) {
          if (controller.signal.aborted || evaluationRun.status === 'cancelled') return;
          const index = cursor++;
          if (index >= pending.length) return;
          const run = pending[index];
          const result = await this.evaluateOne(definition, run, testCaseByRunId.get(run.id), requestKeys, controller.signal);
          existing.set(run.id, result);
          await persist();
        }
      };
      await Promise.all(Array.from({ length: maxConcurrent }, () => worker()));
      const persisted = await this.getRun(evaluationRun.id);
      if (controller.signal.aborted || persisted?.status === 'cancelled') {
        evaluationRun.status = 'cancelled';
        evaluationRun.completedAt = persisted?.completedAt ?? nowIso();
      } else {
        evaluationRun.status = 'completed';
      }
      evaluationRun.completedAt = nowIso();
      await persist();
    } catch (error) {
      const persisted = await this.getRun(evaluationRun.id);
      if (controller.signal.aborted || persisted?.status === 'cancelled') {
        evaluationRun.status = 'cancelled';
      } else if (error instanceof EvaluationCredentialsRequiredError) {
        evaluationRun.status = 'awaiting_credentials';
        evaluationRun.credentialRequirements = { providers: error.providers };
        evaluationRun.error = undefined;
        evaluationRun.completedAt = undefined;
      } else {
        evaluationRun.status = 'failed';
        evaluationRun.error = (error as Error).message;
        evaluationRun.completedAt = nowIso();
      }
      evaluationRun.updatedAt = nowIso();
      await this.storage.put(COLLECTIONS.evaluationRuns, evaluationRun.id, evaluationRun, evaluationRun.evaluationId);
    } finally {
      this.cancelControllers.delete(evaluationRun.id);
      this.activeJobs.delete(evaluationRun.id);
      void this.engine.maybeEnforceTraceRetention().catch(() => { /* status is persisted by the engine */ });
    }
  }

  private async materializeCaseRuns(
    evaluationRun: EvaluationRun,
    definition: EvaluationDefinition,
    requestKeys: ProviderKeys | undefined,
    signal: AbortSignal,
  ): Promise<Run[]> {
    const casesById = new Map((definition.testCases ?? []).map((testCase) => [testCase.id, testCase]));
    const runs: Run[] = [];
    for (const caseRun of evaluationRun.caseRuns ?? []) {
      const testCase = casesById.get(caseRun.testCaseId);
      if (!testCase) throw new Error(`evaluation test case '${caseRun.testCaseId}' no longer exists`);
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('evaluation cancelled');

      let run = caseRun.runId ? await this.engine.getRun(caseRun.runId) : undefined;
      if (!run) {
        const missing = await this.missingCaseCredentials(evaluationRun, definition, testCase, requestKeys);
        if (missing.length) throw new EvaluationCredentialsRequiredError(missing);
        run = await this.engine.createRun({
          workflowId: definition.workflowId,
          version: testCase.version,
          input: structuredClone(testCase.input),
          requestKeys,
          idempotencyKey: `evaluation:${evaluationRun.id}:${testCase.id}`,
          graphSnapshot: testCase.version === 0 ? evaluationRun.draftSnapshot?.graph : undefined,
        });
        caseRun.runId = run.id;
        evaluationRun.runIds = (evaluationRun.caseRuns ?? []).flatMap((item) => item.runId ? [item.runId] : []);
        evaluationRun.updatedAt = nowIso();
        if (!await this.storage.compareAndSwap(
          COLLECTIONS.evaluationRuns,
          evaluationRun.id,
          'status',
          'running',
          evaluationRun,
          evaluationRun.evaluationId,
        )) {
          const current = await this.getRun(evaluationRun.id);
          if (current?.status === 'cancelled') {
            await this.engine.cancelRun(run.id);
            throw new Error('evaluation cancelled');
          }
          throw new Error(`evaluation run '${evaluationRun.id}' changed while saving a generated case`);
        }
      }
      if (run.status === 'awaiting_credentials') {
        try {
          run = await this.engine.resumeRun(run.id, requestKeys);
        } catch (error) {
          const current = await this.engine.getRun(run.id);
          const providers = current?.credentialRequirements?.providers ?? run.credentialRequirements?.providers ?? [];
          if (providers.length) throw new EvaluationCredentialsRequiredError(providers);
          throw error;
        }
      }
      runs.push(run);
    }
    return Promise.all(runs.map((run) => this.waitForCaseRun(run.id, signal)));
  }

  private async missingCaseCredentials(
    evaluationRun: EvaluationRun,
    definition: EvaluationDefinition,
    testCase: EvaluationTestCase,
    requestKeys: ProviderKeys | undefined,
  ): Promise<EvaluationCredentialProvider[]> {
    let graph: WorkflowGraph | undefined;
    if (testCase.version === 0) {
      graph = evaluationRun.draftSnapshot?.graph;
    } else {
      const version = await this.storage.get<{ graph: WorkflowGraph }>(COLLECTIONS.versions, `${definition.workflowId}@${testCase.version}`);
      graph = version?.graph;
    }
    if (!graph) return [];
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const queue = graph.nodes.filter((node) => node.type === 'start').map((node) => node.id);
    const seen = new Set<string>();
    const providers = new Set<EvaluationCredentialProvider>();
    while (queue.length) {
      const nodeId = queue.shift()!;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      const node = byId.get(nodeId);
      if (!node) continue;
      if (node.type === 'agent') {
        const provider = providerForModel(String(node.config.model ?? ''));
        if (provider !== 'mock') providers.add(provider);
      }
      if (node.type === 'guardrail' && (node.config.moderation === true || node.config.jailbreak === true || node.config.hallucination === true)) {
        const settings = node.config.settings as JsonObject | undefined;
        const provider = providerForModel(String(settings?.checkModel ?? 'gemini-3-flash'));
        if (provider !== 'mock') providers.add(provider);
      }
      for (const edge of graph.edges) if (edge.source === nodeId) queue.push(edge.target);
    }
    const storedKeys = await loadProviderKeys(this.storage, evaluationRun.workspaceId ?? definition.workspaceId);
    return [...providers].filter((provider) => {
      try { resolveKey(provider, requestKeys, storedKeys); return false; }
      catch { return true; }
    });
  }

  private async waitForCaseRun(runId: string, signal: AbortSignal): Promise<Run> {
    for (;;) {
      if (signal.aborted) {
        await this.engine.cancelRun(runId);
        throw signal.reason instanceof Error ? signal.reason : new Error('evaluation cancelled');
      }
      const run = await this.engine.getRun(runId);
      if (!run) throw new Error(`evaluation child run '${runId}' disappeared`);
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return run;
      if (run.status === 'awaiting_credentials') {
        throw new EvaluationCredentialsRequiredError(run.credentialRequirements?.providers ?? []);
      }
      if (run.status === 'awaiting_approval' || run.status === 'awaiting_client_tool') {
        throw new Error(`evaluation child run '${runId}' requires interactive input (status: ${run.status})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private launchJob(
    evaluationRun: EvaluationRun,
    definition: EvaluationDefinition,
    runs: Run[],
    requestKeys?: ProviderKeys,
  ): void {
    if (this.jobPromises.has(evaluationRun.id)) return;
    const promise = this.processJob(evaluationRun, definition, runs, requestKeys);
    this.jobPromises.set(evaluationRun.id, promise);
    void promise.finally(() => {
      if (this.jobPromises.get(evaluationRun.id) === promise) this.jobPromises.delete(evaluationRun.id);
    });
  }

  private async evaluateOne(
    definition: EvaluationDefinition,
    run: Run,
    testCase: EvaluationTestCase | undefined,
    requestKeys: ProviderKeys | undefined,
    signal: AbortSignal,
  ): Promise<EvaluationRunResult> {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('evaluation cancelled');
    const eventRows = await this.storage.list<PersistedEvent>(COLLECTIONS.spans, { ref: run.id });
    const events = eventRows.sort((a, b) => a.doc.seq - b.doc.seq).map((row) => row.doc.event);
    const spans = buildTraceSpans(run, events);
    const storedKeys = await loadProviderKeys(this.storage, definition.workspaceId);
    const missingCredentials = missingModelJudgeCredentials(definition, requestKeys, storedKeys);
    if (missingCredentials.length) throw new EvaluationCredentialsRequiredError(missingCredentials);
    const graderResults = await Promise.all(definition.graders.map((grader) => this.grade(grader, run, events, spans, testCase, requestKeys, storedKeys, signal)));
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('evaluation cancelled');
    const totalWeight = definition.graders.reduce((sum, grader) => sum + (grader.weight ?? 1), 0);
    const score = graderResults.length && totalWeight > 0
      ? graderResults.reduce((sum, result, index) => sum + result.score * (definition.graders[index].weight ?? 1), 0) / totalWeight
      : 1;
    const usage = graderResults.reduce<EvaluationUsage>(
      (total, result) => mergeUsage(total, result.usage),
      emptyUsage(),
    );
    return { runId: run.id, status: run.status, score, results: graderResults, usage };
  }

  async listRuns(id: string, access?: EvaluationAccess, options?: { limit?: number; offset?: number; status?: EvaluationRun['status'] }): Promise<EvaluationRun[]> {
    if (!await this.get(id, access)) return [];
    const rows = await this.storage.list<EvaluationRun>(COLLECTIONS.evaluationRuns, { ref: id, order: 'desc' });
    const runs = await Promise.all(rows.map((row) => this.normalizeOwnership(row.doc)));
    const visible = runs.filter((run) => this.canAccess(run, access));
    const filtered = options?.status ? visible.filter((run) => run.status === options.status) : visible;
    const offset = Math.max(0, options?.offset ?? 0);
    return filtered.slice(offset, options?.limit === undefined ? undefined : offset + options.limit);
  }

  private async grade(grader: EvaluationGrader, run: Run, events: RunEvent[], spans: TraceSpan[], testCase?: EvaluationTestCase, requestKeys?: ProviderKeys, storedKeys?: ProviderKeys, signal?: AbortSignal): Promise<GraderResult> {
    if (grader.workflowVersion !== undefined && grader.workflowVersion !== run.workflowVersion) {
      return {
        graderId: grader.id,
        name: grader.name,
        passed: false,
        score: 0,
        detail: `target run uses workflow version ${run.workflowVersion}, expected pinned version ${grader.workflowVersion}`,
        targetFound: false,
        targetKey: `${grader.spanType ?? 'node'}:${grader.nodeId ?? '*'}:${grader.occurrence ?? 0}`,
      };
    }
    const selected = this.selectSpan(grader, spans);
    if (grader.nodeId || grader.spanType || grader.field) {
      if (!selected) {
        return {
          graderId: grader.id,
          name: grader.name,
          passed: false,
          score: 0,
          detail: `target span not found (nodeId=${grader.nodeId ?? '*'}, type=${grader.spanType ?? '*'}, occurrence=${grader.occurrence ?? 0})`,
          targetFound: false,
          targetKey: `${grader.spanType ?? '*'}:${grader.nodeId ?? '*'}:${grader.occurrence ?? 0}`,
        };
      }
    }
    const actual = selected ? this.spanField(selected, grader.field ?? 'output') : (grader.target === 'error' ? run.error ?? '' : run.output);
    if (grader.reference === 'test_case_expected' && (!testCase || testCase.expectedOutput === undefined)) {
      return {
        graderId: grader.id,
        name: grader.name,
        passed: false,
        score: 0,
        detail: testCase ? `test case '${testCase.name}' has no expected output` : 'grader requires a dataset test-case reference',
      };
    }
    const expected = grader.reference === 'test_case_expected' ? testCase!.expectedOutput! : grader.expected ?? '';
    let passed = false;
    let detail = '';

    try {
      switch (grader.type) {
        case 'contains': {
          const needle = asText(expected);
          passed = asText(actual).toLowerCase().includes(needle.toLowerCase());
          detail = passed ? `value contains "${needle}"` : `value did not contain "${needle}"`;
          break;
        }
        case 'equals': {
          passed = JSON.stringify(actual) === JSON.stringify(expected);
          detail = passed ? 'value matched' : `expected ${asText(expected)}, got ${asText(actual)}`;
          break;
        }
        case 'regex': {
          const expression = String(expected);
          passed = new RegExp(expression, 'i').test(asText(actual));
          detail = passed ? `matched /${expression}/i` : `did not match /${expression}/i`;
          break;
        }
        case 'run_status': {
          const status = selected ? selected.status : run.status;
          passed = status === String(expected);
          detail = `status is ${status}`;
          break;
        }
        case 'event_count': {
          const count = events.filter((event) => !grader.eventType || event.type === grader.eventType).length;
          const minimum = expectedNumber(expected);
          passed = Number.isFinite(minimum) && count >= minimum;
          detail = `${count} matching events (required ${minimum})`;
          break;
        }
        case 'model_judge': {
          const rubric = grader.rubric?.trim() || asText(expected) || 'Judge whether the output is correct and useful.';
          const response = await chatWithModel({
            model: grader.model || 'gemini-3-flash',
            messages: [
              { role: 'system', content: 'You are an evaluation grader. Apply the rubric strictly. Return only the requested JSON verdict.' },
              { role: 'user', content: JSON.stringify({ rubric, reference: grader.reference === 'test_case_expected' ? expected : undefined, input: run.input, output: selected ? this.spanField(selected, grader.field ?? 'output') : run.output ?? null, error: run.error ?? null, status: selected?.status ?? run.status, eventTypes: events.map((event) => event.type) }) },
            ],
            jsonSchema: {
              name: 'grader_verdict',
              schema: {
                type: 'object',
                properties: {
                  score: { type: 'number', minimum: 0, maximum: 1 },
                  passed: { type: 'boolean' },
                  reason: { type: 'string' },
                },
                required: ['score', 'passed', 'reason'],
                additionalProperties: false,
              },
            },
            abortSignal: signal,
          }, requestKeys, storedKeys);
          const verdict = extractJson(response.text) as JsonObject;
          const score = Math.max(0, Math.min(1, Number(verdict.score) || 0));
          passed = score >= (grader.threshold ?? 0.5);
          detail = typeof verdict.reason === 'string' ? verdict.reason : `model score ${score}`;
          return {
            graderId: grader.id,
            name: grader.name,
            passed,
            score,
            detail,
            ...(selected ? { targetFound: true, targetKey: `${selected.type}:${selected.nodeId ?? '*'}:${grader.occurrence ?? 0}` } : {}),
            model: (response.usage.model || grader.model || 'gemini-3-flash').replace(/^models\//, ''),
            provider: response.usage.provider ?? providerForModel(grader.model || 'gemini-3-flash'),
            usage: usageFromModelResponse(response.usage, grader.model || 'gemini-3-flash'),
          };
        }
        case 'label_model_judge': {
          const labels = grader.labels ?? [];
          const rubric = grader.rubric?.trim() || 'Classify the trace according to the allowed labels.';
          const response = await chatWithModel({
            model: grader.model || 'gemini-3-flash',
            messages: [
              { role: 'system', content: 'You are an evaluation grader. Apply the rubric strictly and choose exactly one allowed label. Return only the requested JSON verdict.' },
              { role: 'user', content: JSON.stringify({ rubric, reference: grader.reference === 'test_case_expected' ? expected : undefined, allowedLabels: labels, input: run.input, output: selected ? this.spanField(selected, grader.field ?? 'output') : run.output ?? null, error: run.error ?? null, status: selected?.status ?? run.status, eventTypes: events.map((event) => event.type) }) },
            ],
            jsonSchema: {
              name: 'grader_label_verdict',
              schema: {
                type: 'object',
                properties: {
                  label: { type: 'string', enum: labels },
                  reason: { type: 'string' },
                },
                required: ['label', 'reason'],
                additionalProperties: false,
              },
            },
            abortSignal: signal,
          }, requestKeys, storedKeys);
          const verdict = extractJson(response.text) as JsonObject;
          const label = typeof verdict.label === 'string' ? verdict.label : '';
          if (!labels.includes(label)) throw new Error(`model returned label '${label}' outside the allowed label set`);
          passed = (grader.passingLabels ?? []).includes(label);
          detail = typeof verdict.reason === 'string' ? verdict.reason : `classified as ${label}`;
          return {
            graderId: grader.id,
            name: grader.name,
            passed,
            score: passed ? 1 : 0,
            label,
            detail,
            ...(selected ? { targetFound: true, targetKey: `${selected.type}:${selected.nodeId ?? '*'}:${grader.occurrence ?? 0}` } : {}),
            model: (response.usage.model || grader.model || 'gemini-3-flash').replace(/^models\//, ''),
            provider: response.usage.provider ?? providerForModel(grader.model || 'gemini-3-flash'),
            usage: usageFromModelResponse(response.usage, grader.model || 'gemini-3-flash'),
          };
        }
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('evaluation cancelled');
      detail = (error as Error).message;
      passed = false;
    }

    return {
      graderId: grader.id,
      name: grader.name,
      passed,
      score: passed ? 1 : 0,
      detail,
      ...(selected ? { targetFound: true, targetKey: `${selected.type}:${selected.nodeId ?? '*'}:${grader.occurrence ?? 0}` } : {}),
    };
  }

  private selectSpan(grader: EvaluationGrader, spans: TraceSpan[]): TraceSpan | undefined {
    if (!grader.nodeId && !grader.spanType && !grader.field) return undefined;
    const wantedType = grader.spanType ?? (grader.nodeId ? 'node' : undefined);
    const matches = spans.filter((span) => (!grader.nodeId || span.nodeId === grader.nodeId) && (!wantedType || span.type === wantedType));
    return matches[grader.occurrence ?? 0];
  }

  private spanField(span: TraceSpan, field: NonNullable<EvaluationGrader['field']>): JsonValue | undefined {
    if (field === 'status') return span.status;
    if (field === 'duration') {
      if (!span.endedAt) return undefined;
      return Math.max(0, Date.parse(span.endedAt) - Date.parse(span.startedAt));
    }
    if (field === 'output') return span.data?.output;
    if (field === 'error') return span.data?.error;
    if (field === 'usage') return span.data?.usage;
    if (field === 'arguments') return span.data?.arguments;
    if (field === 'result') return span.data?.result;
    return span.data?.toolCalls;
  }
}
