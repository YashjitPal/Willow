import { createHash, randomBytes } from 'node:crypto';
import type { AgentNodeConfig, ChatDeployment, ChatSession, DeploymentRelease, GuardrailNodeConfig, Run, SubflowNodeConfig, WhileNodeConfig, Workflow, WorkflowGraph, WorkflowNode, WorkflowVersion } from '../domain/types.ts';
import { COLLECTIONS, deploymentAdmissionCostUsd, deploymentAdmissionTokens, type DeploymentRunAdmissionRecord, type Storage } from '../storage/index.ts';
import { newId, nowIso } from '../util/id.ts';
import { DEFAULT_SUBJECT_ID, DEFAULT_WORKSPACE_ID, type AuthPrincipal } from './governance.ts';
import { priceModelUsage, PRICING_CATALOG_VERSION } from './pricing.ts';
import { releaseSafetyErrors, validateGraph } from '../domain/validate.ts';
import { GUARDRAIL_CLASSIFIER_MAX_INPUT_TOKENS, GUARDRAIL_CLASSIFIER_MAX_OUTPUT_TOKENS } from '../engine/guardrails/index.ts';

export class DeploymentConflictError extends Error {}
export class DeploymentBudgetValidationError extends Error {}
export class DeploymentReleaseValidationError extends Error {}

const RUN_LIMIT_DEFAULTS = { maxConcurrentRuns: 8, maxRunsPerMinute: 60, maxRunsPerDay: 10_000 } as const;
export const DEPLOYMENT_RUN_RESERVATION_TTL_MS = 5 * 60_000;
const DEPLOYMENT_BUDGET_STATE_LIMIT = 5_000;

export interface DeploymentRunReconciliationResult {
  scanned: number;
  settled: number;
  alreadySettled: number;
  reboundLive: number;
  retainedLive: number;
  retainedFresh: number;
  releasedStale: number;
  orphanedBound: number;
}

type CreateDeploymentInput = Omit<ChatDeployment, 'id' | 'activeVersion' | 'activeReleaseId' | 'previousVersions' | 'revision' | 'mutationRevision' | 'createdAt' | 'updatedAt' | keyof typeof RUN_LIMIT_DEFAULTS>
  & { activeVersion?: number }
  & Partial<Pick<ChatDeployment, keyof typeof RUN_LIMIT_DEFAULTS>>;

function withRunLimitDefaults(deployment: ChatDeployment): ChatDeployment {
  return { ...RUN_LIMIT_DEFAULTS, ...deployment };
}

export interface DeploymentRunReservation {
  tokens: number;
  estimatedCostUsd: number;
  pricingStatus: 'priced' | 'unpriced';
  pricingCatalogVersion: string;
}

type DeploymentPricingStatus = 'priced' | 'partial' | 'unpriced';

interface DeploymentRunUsageSummary {
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

interface DeploymentBudgetUsageSummary {
  maxTokensPerDay?: number;
  maxEstimatedCostUsdPerDay?: number;
  tokensUsedToday: number;
  estimatedCostUsdUsedToday: number;
  activeReservedTokens: number;
  activeReservedEstimatedCostUsd: number;
  tokenOverageToday: number;
  estimatedCostUsdOverageToday: number;
}

function summarizeRunUsage(runs: Run[]): DeploymentRunUsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let embeddingInputTokens = 0;
  let embeddingOperations = 0;
  let llmCalls = 0;
  let estimatedCostUsd = 0;
  let unpricedLlmCalls = 0;
  let unpricedEmbeddingOperations = 0;
  const catalogVersions = new Set<string>();
  for (const run of runs) {
    const usage = run.usage;
    inputTokens += Number(usage?.inputTokens ?? 0);
    outputTokens += Number(usage?.outputTokens ?? 0);
    embeddingInputTokens += Number(usage?.embeddingInputTokens ?? 0);
    embeddingOperations += Number(usage?.embeddingOperations ?? 0);
    const calls = Number(usage?.llmCalls ?? 0);
    llmCalls += calls;
    estimatedCostUsd += Number(usage?.estimatedCostUsd ?? 0);
    const bucketUnpriced = Object.values(usage?.byModel ?? {}).reduce((sum, bucket) => sum + (bucket.pricing?.status === 'unpriced' ? Number(bucket.llmCalls ?? 0) : 0), 0);
    unpricedLlmCalls += usage?.unpricedLlmCalls ?? (bucketUnpriced || (calls > 0 && !Object.keys(usage?.byModel ?? {}).length ? calls : 0));
    unpricedEmbeddingOperations += Number(usage?.unpricedEmbeddingOperations ?? 0);
    if (usage?.pricingCatalogVersion) catalogVersions.add(usage.pricingCatalogVersion);
    for (const bucket of Object.values(usage?.byModel ?? {})) if (bucket.pricing?.catalogVersion) catalogVersions.add(bucket.pricing.catalogVersion);
  }
  const pricedOperations = llmCalls + embeddingOperations;
  const unpricedOperations = unpricedLlmCalls + unpricedEmbeddingOperations;
  const pricingStatus: DeploymentPricingStatus = pricedOperations === 0 || unpricedOperations === 0
    ? 'priced'
    : unpricedOperations >= pricedOperations ? 'unpriced' : 'partial';
  return {
    inputTokens,
    outputTokens,
    embeddingInputTokens,
    embeddingOperations,
    llmCalls,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(12)),
    unpricedLlmCalls,
    unpricedEmbeddingOperations,
    unpricedModelCalls: unpricedLlmCalls,
    pricingStatus,
    pricingCatalogVersions: [...catalogVersions].sort(),
  };
}

function deploymentKey(workflowId: string, environment: string): string {
  return createHash('sha256').update(`${workflowId}\u0000${environment}`).digest('hex').slice(0, 32);
}

export class DeploymentService {
  private storage: Storage;
  constructor(storage: Storage) { this.storage = storage; }

  private async ownedRelease(deployment: Pick<ChatDeployment, 'id' | 'workflowId'>, releaseId: string, label: string): Promise<DeploymentRelease> {
    const release = await this.storage.get<DeploymentRelease>(COLLECTIONS.deploymentReleases, releaseId);
    if (!release) throw new Error(`${label} release '${releaseId}' not found`);
    if (release.deploymentId !== deployment.id || release.workflowId !== deployment.workflowId) {
      throw new DeploymentConflictError(`${label} release '${releaseId}' does not belong to deployment '${deployment.id}'`);
    }
    return release;
  }

  private async normalizeOwnership(deployment: ChatDeployment): Promise<ChatDeployment> {
    if (deployment.ownerId && deployment.workspaceId) return deployment;
    const workflow = await this.storage.get<Workflow>(COLLECTIONS.workflows, deployment.workflowId);
    return {
      ...deployment,
      ownerId: deployment.ownerId ?? workflow?.ownerId ?? DEFAULT_SUBJECT_ID,
      workspaceId: deployment.workspaceId ?? workflow?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    };
  }

  private canAccess(deployment: ChatDeployment, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>): boolean {
    return !access || access.authority === 'platform'
      || (deployment.workspaceId === access.workspaceId && (access.role === 'admin' || deployment.ownerId === access.subjectId));
  }

  async list(workflowId?: string, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'>): Promise<ChatDeployment[]> {
    const rows = await this.storage.list<ChatDeployment>(COLLECTIONS.deployments, { ...(workflowId ? { ref: workflowId } : {}), order: 'desc' });
    const deployments = await Promise.all(rows.map(async (row) => withRunLimitDefaults(await this.normalizeOwnership(row.doc))));
    return deployments.filter((deployment) => this.canAccess(deployment, access));
  }

  async get(id: string, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'>): Promise<ChatDeployment | undefined> {
    const deployment = await this.storage.get<ChatDeployment>(COLLECTIONS.deployments, id);
    if (!deployment) return undefined;
    const normalized = withRunLimitDefaults(await this.normalizeOwnership(deployment));
    return this.canAccess(normalized, access) ? normalized : undefined;
  }

  async resolve(workflowId: string, selector: { deploymentId?: string; environment?: string }): Promise<ChatDeployment | undefined> {
    if (selector.deploymentId) {
      const deployment = await this.get(selector.deploymentId);
      return deployment?.workflowId === workflowId ? deployment : undefined;
    }
    if (!selector.environment) return undefined;
    return (await this.list(workflowId)).find((deployment) => deployment.environment === selector.environment);
  }

  private async assertPublished(workflowId: string, version: number, visited = new Set<string>()): Promise<void> {
    const key = `${workflowId}@${version}`;
    if (visited.has(key)) return;
    const published = Number.isInteger(version) && version >= 1
      ? await this.storage.get<WorkflowVersion>(COLLECTIONS.versions, key)
      : undefined;
    if (!published) {
      throw new Error(`workflow '${workflowId}' has no published version ${version}`);
    }
    // Very old storage records and atomic-storage fixtures may contain only a
    // version pointer. Executable published versions always carry a graph and
    // are revalidated here before deployment selection.
    if (published.graph) {
      const safetyErrors = releaseSafetyErrors(validateGraph(published.graph));
      if (safetyErrors.length) {
        throw new DeploymentReleaseValidationError(`workflow '${workflowId}' version ${version} is blocked by safety policy: ${safetyErrors.map((issue) => issue.message).join('; ')}`);
      }
      const nextVisited = new Set(visited).add(key);
      for (const node of published.graph.nodes) {
        if (node.type !== 'subflow') continue;
        const config = node.config as unknown as SubflowNodeConfig;
        const childWorkflowId = String(config.workflowId ?? '');
        const childVersion = Number(config.version);
        if (!childWorkflowId || !Number.isInteger(childVersion) || childVersion < 1) {
          throw new DeploymentReleaseValidationError(`workflow '${workflowId}' version ${version} has an unpinned subflow '${node.name}'`);
        }
        try {
          await this.assertPublished(childWorkflowId, childVersion, nextVisited);
        } catch (error) {
          if (error instanceof DeploymentReleaseValidationError) throw error;
          throw new DeploymentReleaseValidationError(`workflow '${workflowId}' version ${version} references unavailable subflow '${childWorkflowId}@${childVersion}'`);
        }
      }
    }
  }

  private async analyzeBudgetGraph(workflowId: string, version: number, requirePriced: boolean, ancestry = new Set<string>()): Promise<DeploymentRunReservation> {
    const key = `${workflowId}@${version}`;
    if (ancestry.has(key)) throw new DeploymentBudgetValidationError(`budget enforcement cannot statically bound recursive subflow '${key}'`);
    const published = await this.storage.get<WorkflowVersion>(COLLECTIONS.versions, key);
    if (!published) throw new DeploymentBudgetValidationError(`workflow '${workflowId}' has no pinned published version ${version}`);
    const nextAncestry = new Set(ancestry).add(key);
    const graph = published.graph;
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const starts = graph.nodes.filter((node) => node.type === 'start');
    if (starts.length !== 1) throw new DeploymentBudgetValidationError(`workflow '${key}' must have exactly one Start node for budget enforcement`);
    const nodeWeights = new Map<string, { tokens: number; cost: number }>();
    let unpriced = false;
    for (const node of graph.nodes) {
      if (node.type === 'guardrail') {
        const config = node.config as unknown as GuardrailNodeConfig;
        const classifierCalls = [config.moderation, config.jailbreak, config.hallucination].filter(Boolean).length;
        if (classifierCalls > 0) {
          const model = config.settings?.checkModel || 'gemini-3-flash';
          const inputTokens = GUARDRAIL_CLASSIFIER_MAX_INPUT_TOKENS * classifierCalls;
          const outputTokens = GUARDRAIL_CLASSIFIER_MAX_OUTPUT_TOKENS * classifierCalls;
          const nodeTokens = inputTokens + outputTokens;
          const pricing = priceModelUsage({ inputTokens, outputTokens, model });
          if (pricing.status === 'unpriced') unpriced = true;
          nodeWeights.set(node.id, { tokens: nodeTokens, cost: pricing.status === 'priced' ? pricing.estimatedCostUsd : 0 });
        }
      }
      if (node.type === 'agent') {
        const config = node.config as unknown as AgentNodeConfig;
        const maxTokens = config.modelParams?.maxTokens;
        if (!Number.isInteger(maxTokens) || Number(maxTokens) < 1) throw new DeploymentBudgetValidationError(`Agent '${node.name}' must set modelParams.maxTokens for deployment budget enforcement`);
        if (!Number.isInteger(config.maxTurns) || Number(config.maxTurns) < 1) throw new DeploymentBudgetValidationError(`Agent '${node.name}' must set maxTurns for deployment budget enforcement`);
        if (!Number.isInteger(config.maxInputTokensPerCall) || Number(config.maxInputTokensPerCall) < 1) throw new DeploymentBudgetValidationError(`Agent '${node.name}' must set maxInputTokensPerCall for deployment budget enforcement`);
        const maxTurns = Number(config.maxTurns);
        const inputTokens = Number(config.maxInputTokensPerCall) * maxTurns;
        const outputTokens = Number(maxTokens) * maxTurns;
        const nodeTokens = inputTokens + outputTokens;
        if (!Number.isSafeInteger(nodeTokens)) throw new DeploymentBudgetValidationError(`Agent '${node.name}' token bound is too large`);
        const pricing = priceModelUsage({ inputTokens, outputTokens, model: config.model });
        if (pricing.status === 'unpriced') unpriced = true;
        nodeWeights.set(node.id, { tokens: nodeTokens, cost: pricing.status === 'priced' ? pricing.estimatedCostUsd : 0 });
      }
      if (node.type === 'subflow') {
        const config = node.config as unknown as SubflowNodeConfig;
        const childWorkflowId = String(config.workflowId ?? '');
        const childVersion = Number(config.version);
        if (!childWorkflowId || !Number.isInteger(childVersion) || childVersion < 1) throw new DeploymentBudgetValidationError(`Subflow '${node.name}' must reference a pinned published version`);
        const child = await this.analyzeBudgetGraph(childWorkflowId, childVersion, requirePriced, nextAncestry);
        nodeWeights.set(node.id, { tokens: child.tokens, cost: child.estimatedCostUsd });
        if (child.pricingStatus === 'unpriced') unpriced = true;
      }
    }

    const outgoing = (nodeId: string, handle?: string | null): string[] => graph.edges
      .filter((edge) => edge.source === nodeId && (handle === undefined || (edge.sourceHandle ?? null) === handle))
      .map((edge) => edge.target);
    const whileBodies = new Map<string, Set<string>>();
    const whileBody = (whileId: string): Set<string> => {
      const cached = whileBodies.get(whileId);
      if (cached) return cached;
      const body = new Set<string>();
      const queue = outgoing(whileId, 'loop');
      while (queue.length) {
        const current = queue.shift()!;
        if (current === whileId || body.has(current)) continue;
        body.add(current);
        for (const target of outgoing(current)) queue.push(target);
      }
      whileBodies.set(whileId, body);
      return body;
    };
    interface BudgetState { current: string; last: string | null; counters: Record<string, number> }
    const stateKey = (state: BudgetState): string => `${state.current}\u0000${state.last ?? ''}\u0000${Object.entries(state.counters).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}:${count}`).join(',')}`;
    const successors = (state: BudgetState, node: WorkflowNode): BudgetState[] => {
      const next = (targets: string[], counters = state.counters): BudgetState[] => targets
        .filter((target) => byId.has(target))
        .map((target) => ({ current: target, last: node.id, counters: { ...counters } }));
      if (node.type === 'end') return [];
      if (node.type === 'while') {
        const config = node.config as unknown as WhileNodeConfig;
        const max = config.maxIterations;
        if (!Number.isInteger(max) || Number(max) < 1 || Number(max) > 10_000) throw new DeploymentBudgetValidationError(`While '${node.name}' must set maxIterations between 1 and 10000 for deployment budget enforcement`);
        const counters = { ...state.counters };
        if (counters[node.id] !== undefined && (!state.last || !whileBody(node.id).has(state.last))) delete counters[node.id];
        const current = counters[node.id] ?? 0;
        const doneCounters = { ...counters };
        delete doneCounters[node.id];
        const result = next(outgoing(node.id, 'done'), doneCounters);
        if (current < Number(max)) {
          result.push(...next(outgoing(node.id, 'loop'), { ...counters, [node.id]: current + 1 }));
        }
        return result;
      }
      const targets = outgoing(node.id);
      if (node.type === 'agent') {
        for (const handoff of (node.config as unknown as AgentNodeConfig).handoffs ?? []) targets.push(handoff.targetNodeId);
      }
      return next([...new Set(targets)]);
    };

    const memo = new Map<string, { tokens: number; cost: number }>();
    const active = new Set<string>();
    const path: string[] = [];
    let states = 0;
    const visit = (state: BudgetState): { tokens: number; cost: number } => {
      const serialized = stateKey(state);
      const known = memo.get(serialized);
      if (known) return known;
      if (active.has(serialized)) {
        const cycleStart = path.indexOf(serialized);
        const cycle = [...path.slice(Math.max(0, cycleStart)), serialized].map((item) => item.split('\u0000')[0]).map((id) => byId.get(id)?.name ?? id);
        throw new DeploymentBudgetValidationError(`budget enforcement found an unbounded control cycle: ${cycle.join(' -> ')}`);
      }
      states += 1;
      if (states > DEPLOYMENT_BUDGET_STATE_LIMIT) throw new DeploymentBudgetValidationError(`workflow '${key}' exceeds the ${DEPLOYMENT_BUDGET_STATE_LIMIT} state static-analysis limit`);
      const node = byId.get(state.current);
      if (!node) throw new DeploymentBudgetValidationError(`workflow '${key}' routes to missing node '${state.current}'`);
      active.add(serialized);
      path.push(serialized);
      let continuation = { tokens: 0, cost: 0 };
      for (const successor of successors(state, node)) {
        const candidate = visit(successor);
        continuation.tokens = Math.max(continuation.tokens, candidate.tokens);
        continuation.cost = Math.max(continuation.cost, candidate.cost);
      }
      path.pop();
      active.delete(serialized);
      const own = nodeWeights.get(node.id) ?? { tokens: 0, cost: 0 };
      const total = { tokens: own.tokens + continuation.tokens, cost: own.cost + continuation.cost };
      if (!Number.isSafeInteger(total.tokens)) throw new DeploymentBudgetValidationError('workflow token bound is too large');
      memo.set(serialized, total);
      return total;
    };
    const bound = visit({ current: starts[0].id, last: null, counters: {} });
    if (requirePriced && unpriced) throw new DeploymentBudgetValidationError('USD budget enforcement requires every reachable model to have pinned pricing');
    return { tokens: bound.tokens, estimatedCostUsd: Number(bound.cost.toFixed(12)), pricingStatus: unpriced ? 'unpriced' : 'priced', pricingCatalogVersion: PRICING_CATALOG_VERSION };
  }

  private async assertBudgetableVersion(deployment: Pick<ChatDeployment, 'workflowId' | 'maxTokensPerDay' | 'maxEstimatedCostUsdPerDay' | 'unpricedCostPolicy'>, version: number): Promise<void> {
    if (deployment.maxEstimatedCostUsdPerDay !== undefined && deployment.unpricedCostPolicy !== 'deny') {
      throw new DeploymentBudgetValidationError("maxEstimatedCostUsdPerDay requires unpricedCostPolicy: 'deny'");
    }
    if (deployment.maxTokensPerDay === undefined && deployment.maxEstimatedCostUsdPerDay === undefined) return;
    const reservation = await this.analyzeBudgetGraph(deployment.workflowId, version, deployment.maxEstimatedCostUsdPerDay !== undefined);
    if (deployment.maxTokensPerDay !== undefined && reservation.tokens > deployment.maxTokensPerDay) {
      throw new DeploymentBudgetValidationError(`per-run token reservation ${reservation.tokens} exceeds maxTokensPerDay ${deployment.maxTokensPerDay}`);
    }
    if (deployment.maxEstimatedCostUsdPerDay !== undefined && reservation.estimatedCostUsd > deployment.maxEstimatedCostUsdPerDay) {
      throw new DeploymentBudgetValidationError(`per-run cost reservation ${reservation.estimatedCostUsd} exceeds maxEstimatedCostUsdPerDay ${deployment.maxEstimatedCostUsdPerDay}`);
    }
  }

  async runReservation(id: string, version: number, options?: { attachmentKinds?: Array<'image' | 'audio' | 'video' | 'document' | 'unknown'> }): Promise<DeploymentRunReservation> {
    const deployment = await this.get(id);
    if (!deployment) throw new Error(`deployment '${id}' not found`);
    if (deployment.maxTokensPerDay === undefined && deployment.maxEstimatedCostUsdPerDay === undefined) {
      return { tokens: 0, estimatedCostUsd: 0, pricingStatus: 'priced', pricingCatalogVersion: PRICING_CATALOG_VERSION };
    }
    const unboundedMediaKinds = [...new Set((options?.attachmentKinds ?? []).filter((kind) => kind !== 'document'))];
    if (unboundedMediaKinds.length) {
      throw new DeploymentBudgetValidationError(`deployment token and cost budgets do not support ${unboundedMediaKinds.join(', ')} attachments until provider-specific modality accounting is configured; document attachments are supported because their extracted text is covered by maxInputTokensPerCall`);
    }
    return this.analyzeBudgetGraph(deployment.workflowId, version, deployment.maxEstimatedCostUsdPerDay !== undefined);
  }

  async create(input: CreateDeploymentInput, actorId = 'system'): Promise<ChatDeployment> {
    const workflow = await this.storage.get<Workflow>(COLLECTIONS.workflows, input.workflowId);
    const activeVersion = input.activeVersion ?? workflow?.latestVersion ?? 0;
    if (!Number.isInteger(activeVersion) || activeVersion < 1) {
      throw new Error(workflow
        ? `workflow '${input.workflowId}' has no published versions`
        : `workflow '${input.workflowId}' not found`);
    }
    await this.assertPublished(input.workflowId, activeVersion);
    const now = nowIso();
    // Stable IDs make the workflow/environment uniqueness key itself atomic.
    // This also lets a later creator finish a crash that occurred after the
    // initial release was persisted but before the deployment document.
    const key = deploymentKey(input.workflowId, input.environment);
    const deploymentId = `dep_${key}`;
    const release: DeploymentRelease = { id: `rel_${key}`, deploymentId, workflowId: input.workflowId, sequence: 1, workflowVersion: activeVersion, kind: 'initial', createdBy: actorId, createdAt: now };
    const deployment: ChatDeployment = {
      ...input,
      activeVersion,
      ownerId: input.ownerId ?? DEFAULT_SUBJECT_ID,
      workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
      maxConcurrentRuns: input.maxConcurrentRuns ?? RUN_LIMIT_DEFAULTS.maxConcurrentRuns,
      maxRunsPerMinute: input.maxRunsPerMinute ?? RUN_LIMIT_DEFAULTS.maxRunsPerMinute,
      maxRunsPerDay: input.maxRunsPerDay ?? RUN_LIMIT_DEFAULTS.maxRunsPerDay,
      id: deploymentId,
      activeReleaseId: release.id,
      previousVersions: [],
      revision: 1,
      mutationRevision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.assertBudgetableVersion(deployment, activeVersion);
    const created = await this.storage.createDeploymentIfVersionExists({
      workflowId: input.workflowId,
      workflowVersionId: `${input.workflowId}@${activeVersion}`,
      deploymentId: deployment.id,
      deployment,
      releaseId: release.id,
      release,
    });
    if (created.status === 'missing_workflow_version') throw new Error(`workflow '${input.workflowId}' has no published version ${activeVersion}`);
    if (created.status === 'conflict') throw new DeploymentConflictError(`environment '${input.environment}' already exists for this workflow`);
    return deployment;
  }

  async update(id: string, expectedRevision: number, patch: Partial<Pick<ChatDeployment, 'name' | 'allowedOrigins' | 'sessionRateLimitPerMinute' | 'maxActiveSessions' | 'maxConcurrentRuns' | 'maxRunsPerMinute' | 'maxRunsPerDay' | 'maxTokensPerDay' | 'maxEstimatedCostUsdPerDay' | 'unpricedCostPolicy' | 'status'>>): Promise<ChatDeployment> {
    const current = await this.get(id);
    if (!current) throw new Error(`deployment '${id}' not found`);
    if (current.revision !== expectedRevision) throw new DeploymentConflictError('deployment revision conflict');
    const next = { ...current, ...patch, revision: current.revision + 1, mutationRevision: current.mutationRevision + 1, updatedAt: nowIso() };
    await this.assertBudgetableVersion(next, next.activeVersion);
    if (next.candidateReleaseId) {
      const candidate = await this.storage.get<DeploymentRelease>(COLLECTIONS.deploymentReleases, next.candidateReleaseId);
      if (candidate) await this.assertBudgetableVersion(next, candidate.workflowVersion);
    }
    if (!await this.storage.compareAndSwap(COLLECTIONS.deployments, id, 'mutationRevision', current.mutationRevision, next, current.workflowId)) throw new DeploymentConflictError('deployment revision conflict');
    return next;
  }

  async rollout(id: string, version: number, expectedRevision: number, actorId = 'system', kind: DeploymentRelease['kind'] = 'promotion', rollbackOfReleaseId?: string): Promise<ChatDeployment> {
    let current = await this.get(id);
    if (!current) throw new Error(`deployment '${id}' not found`);
    if (current.revision !== expectedRevision) throw new DeploymentConflictError('deployment revision conflict');
    await this.assertPublished(current.workflowId, version);
    await this.assertBudgetableVersion(current, version);
    current = await this.get(id);
    if (!current) throw new Error(`deployment '${id}' not found`);
    if (current.revision !== expectedRevision) throw new DeploymentConflictError('deployment revision conflict');
    if (version === current.activeVersion && kind === 'promotion' && !current.candidateReleaseId) return current;
    const release: DeploymentRelease = { id: newId('rel'), deploymentId: id, workflowId: current.workflowId, sequence: (await this.listReleases(id)).length + 1, workflowVersion: version, previousReleaseId: current.activeReleaseId, rollbackOfReleaseId, kind, createdBy: actorId, createdAt: nowIso() };
    const next: ChatDeployment = { ...current, activeVersion: version, activeReleaseId: release.id, candidateReleaseId: undefined, candidateTrafficPercent: undefined, cohortSalt: undefined, previousVersions: [current.activeVersion, ...current.previousVersions.filter((item) => item !== version)].slice(0, 20), revision: current.revision + 1, mutationRevision: current.mutationRevision + 1, updatedAt: release.createdAt };
    if (!await this.storage.compareAndSwapWithPut(COLLECTIONS.deployments, id, 'mutationRevision', current.mutationRevision, next, COLLECTIONS.deploymentReleases, release.id, release, id)) throw new DeploymentConflictError('deployment revision conflict');
    return next;
  }

  async listReleases(id: string): Promise<DeploymentRelease[]> {
    return (await this.storage.list<DeploymentRelease>(COLLECTIONS.deploymentReleases, { ref: id, order: 'desc' })).map((row) => row.doc);
  }

  async stage(id: string, version: number, trafficPercent: number, expectedRevision: number, actorId = 'system'): Promise<ChatDeployment> {
    const current = await this.get(id);
    if (!current) throw new Error(`deployment '${id}' not found`);
    if (current.revision !== expectedRevision) throw new DeploymentConflictError('deployment revision conflict');
    if (!Number.isFinite(trafficPercent) || trafficPercent < 0 || trafficPercent > 100) throw new Error('trafficPercent must be between 0 and 100');
    await this.assertPublished(current.workflowId, version);
    await this.assertBudgetableVersion(current, version);
    const release: DeploymentRelease = { id: newId('rel'), deploymentId: id, workflowId: current.workflowId, sequence: (await this.listReleases(id)).length + 1, workflowVersion: version, previousReleaseId: current.activeReleaseId, kind: 'staged', createdBy: actorId, createdAt: nowIso() };
    const next: ChatDeployment = { ...current, candidateReleaseId: release.id, candidateTrafficPercent: trafficPercent, cohortSalt: randomBytes(16).toString('base64url'), revision: current.revision + 1, mutationRevision: current.mutationRevision + 1, updatedAt: release.createdAt };
    if (!await this.storage.compareAndSwapWithPut(COLLECTIONS.deployments, id, 'mutationRevision', current.mutationRevision, next, COLLECTIONS.deploymentReleases, release.id, release, id)) throw new DeploymentConflictError('deployment revision conflict');
    return next;
  }

  async promoteCandidate(id: string, expectedRevision: number, actorId = 'system'): Promise<ChatDeployment> {
    let current = await this.get(id);
    if (!current) throw new Error(`deployment '${id}' not found`);
    if (current.revision !== expectedRevision) throw new DeploymentConflictError('deployment revision conflict');
    if (!current.candidateReleaseId) throw new Error('deployment has no staged release');
    const candidateReleaseId = current.candidateReleaseId;
    const release = await this.ownedRelease(current, candidateReleaseId, 'staged');
    if (release.kind !== 'staged') throw new DeploymentConflictError(`candidate release '${candidateReleaseId}' is not staged`);
    // A candidate can remain staged across policy, pricing-catalog, and server
    // upgrades. Re-admit the immutable snapshot at the activation boundary so
    // an earlier staging decision cannot bypass the current release policy.
    await this.assertPublished(current.workflowId, release.workflowVersion);
    await this.assertBudgetableVersion(current, release.workflowVersion);
    current = await this.get(id);
    if (!current) throw new Error(`deployment '${id}' not found`);
    if (current.revision !== expectedRevision || current.candidateReleaseId !== candidateReleaseId) {
      throw new DeploymentConflictError('deployment revision conflict');
    }
    const promotion: DeploymentRelease = { id: newId('rel'), deploymentId: id, workflowId: current.workflowId, sequence: (await this.listReleases(id)).length + 1, workflowVersion: release.workflowVersion, previousReleaseId: current.activeReleaseId, promotedFromReleaseId: release.id, kind: 'promotion', createdBy: actorId, createdAt: nowIso() };
    const next: ChatDeployment = { ...current, activeReleaseId: promotion.id, activeVersion: release.workflowVersion, previousVersions: [current.activeVersion, ...current.previousVersions.filter((version) => version !== release.workflowVersion)].slice(0, 20), candidateReleaseId: undefined, candidateTrafficPercent: undefined, cohortSalt: undefined, revision: current.revision + 1, mutationRevision: current.mutationRevision + 1, updatedAt: promotion.createdAt };
    if (!await this.storage.compareAndSwapWithPut(COLLECTIONS.deployments, id, 'mutationRevision', current.mutationRevision, next, COLLECTIONS.deploymentReleases, promotion.id, promotion, id)) throw new DeploymentConflictError('deployment revision conflict');
    return next;
  }

  async cancelCandidate(id: string, expectedRevision: number): Promise<ChatDeployment> {
    const current = await this.get(id);
    if (!current) throw new Error(`deployment '${id}' not found`);
    if (current.revision !== expectedRevision) throw new DeploymentConflictError('deployment revision conflict');
    if (!current.candidateReleaseId) return current;
    const next: ChatDeployment = { ...current, candidateReleaseId: undefined, candidateTrafficPercent: undefined, cohortSalt: undefined, revision: current.revision + 1, mutationRevision: current.mutationRevision + 1, updatedAt: nowIso() };
    if (!await this.storage.compareAndSwap(COLLECTIONS.deployments, id, 'mutationRevision', current.mutationRevision, next, current.workflowId)) throw new DeploymentConflictError('deployment revision conflict');
    return next;
  }

  async resolveRelease(deployment: ChatDeployment, cohortKey: string): Promise<DeploymentRelease> {
    let releaseId = deployment.activeReleaseId;
    if (deployment.candidateReleaseId && deployment.cohortSalt && (deployment.candidateTrafficPercent ?? 0) > 0) {
      const bucket = createHash('sha256').update(`${deployment.cohortSalt}\0${deployment.id}\0${cohortKey}`).digest().readUInt32BE(0) % 10_000;
      if (bucket < Math.round((deployment.candidateTrafficPercent ?? 0) * 100)) releaseId = deployment.candidateReleaseId;
    }
    return this.ownedRelease(deployment, releaseId, 'deployment');
  }

  async releaseMetrics(id: string): Promise<Array<{ releaseId: string; workflowVersion: number; sessions: number; runs: number } & DeploymentRunUsageSummary>> {
    const deployment = await this.get(id);
    if (!deployment) throw new Error(`deployment '${id}' not found`);
    const releases = await this.listReleases(id);
    const sessions = (await this.storage.list<ChatSession>(COLLECTIONS.sessions, { ref: deployment.workflowId })).map((row) => row.doc).filter((session) => session.deploymentId === id);
    const runs = (await this.storage.list<Run>(COLLECTIONS.runs, { ref: deployment.workflowId })).map((row) => row.doc).filter((run) => run.deploymentId === id);
    return releases.map((release) => {
      const matchingRuns = runs.filter((run) => run.deploymentReleaseId === release.id);
      return { releaseId: release.id, workflowVersion: release.workflowVersion, sessions: sessions.filter((session) => session.deploymentReleaseId === release.id).length, runs: matchingRuns.length, ...summarizeRunUsage(matchingRuns) };
    });
  }

  async reconcileRunAdmissions(options: { now?: Date; staleAfterMs?: number } = {}): Promise<DeploymentRunReconciliationResult> {
    const now = options.now ?? new Date();
    const staleAfterMs = Math.max(60_000, options.staleAfterMs ?? DEPLOYMENT_RUN_RESERVATION_TTL_MS);
    const cutoff = now.getTime() - staleAfterMs;
    const [admissionRows, runRows] = await Promise.all([
      this.storage.list<DeploymentRunAdmissionRecord>(COLLECTIONS.deploymentRunAdmissions),
      this.storage.list<Run>(COLLECTIONS.runs),
    ]);
    const runsById = new Map(runRows.map((row) => [row.doc.id, row.doc]));
    const runsByAdmission = new Map<string, Run>();
    for (const { doc: run } of runRows) {
      if (run.deploymentRunAdmissionId && !runsByAdmission.has(run.deploymentRunAdmissionId)) runsByAdmission.set(run.deploymentRunAdmissionId, run);
    }
    const result: DeploymentRunReconciliationResult = {
      scanned: admissionRows.length,
      settled: 0,
      alreadySettled: 0,
      reboundLive: 0,
      retainedLive: 0,
      retainedFresh: 0,
      releasedStale: 0,
      orphanedBound: 0,
    };
    for (const { doc: admission } of admissionRows) {
      const candidate = admission.runId ? runsById.get(admission.runId) : runsByAdmission.get(admission.id);
      const run = candidate?.deploymentId === admission.deploymentId ? candidate : undefined;
      if (run) {
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
          const alreadySettled = admission.runId === run.id
            && admission.status === run.status
            && Boolean(admission.completedAt)
            && admission.actualTokens !== undefined
            && admission.actualEstimatedCostUsd !== undefined;
          if (alreadySettled) {
            result.alreadySettled += 1;
          } else if (await this.storage.completeDeploymentRun(admission.id, admission.deploymentId, run.id, run.status, run.endedAt ?? now.toISOString(), {
            inputTokens: run.usage.inputTokens,
            outputTokens: run.usage.outputTokens,
            embeddingInputTokens: run.usage.embeddingInputTokens ?? 0,
            estimatedCostUsd: run.usage.estimatedCostUsd,
            unpricedLlmCalls: run.usage.unpricedLlmCalls,
            unpricedEmbeddingOperations: run.usage.unpricedEmbeddingOperations ?? 0,
          })) {
            result.settled += 1;
          }
          continue;
        }
        if (!admission.runId && await this.storage.bindDeploymentRun(admission.id, admission.deploymentId, admission.signature, run.id)) result.reboundLive += 1;
        result.retainedLive += 1;
        continue;
      }
      if ((admission.status === 'completed' || admission.status === 'failed' || admission.status === 'cancelled') && admission.completedAt) {
        result.alreadySettled += 1;
        continue;
      }
      const createdAt = Date.parse(admission.createdAt);
      if (admission.runId) {
        result.orphanedBound += 1;
        if (admission.status === 'active' && Number.isFinite(createdAt) && createdAt <= cutoff) {
          if (await this.storage.completeDeploymentRun(admission.id, admission.deploymentId, admission.runId, 'failed', now.toISOString(), {
            inputTokens: 0,
            outputTokens: 0,
            embeddingInputTokens: 0,
            estimatedCostUsd: 0,
            unpricedLlmCalls: 0,
            unpricedEmbeddingOperations: 0,
          })) result.settled += 1;
        } else {
          result.retainedFresh += 1;
        }
        continue;
      }
      if (Number.isFinite(createdAt) && createdAt <= cutoff && await this.storage.releaseDeploymentRun(admission.id, admission.deploymentId, admission.signature)) {
        result.releasedStale += 1;
      } else {
        result.retainedFresh += 1;
      }
    }
    return result;
  }

  async rollback(id: string, expectedRevision: number, actorId = 'system', releaseId?: string): Promise<ChatDeployment> {
    const current = await this.get(id);
    if (!current) throw new Error(`deployment '${id}' not found`);
    const releases = await this.listReleases(id);
    const currentRelease = releases.find((release) => release.id === current.activeReleaseId);
    const target = releaseId ? releases.find((release) => release.id === releaseId) : releases.find((release) => release.id === currentRelease?.previousReleaseId);
    if (!target) throw new Error('deployment has no previous release');
    if (target.kind === 'staged') throw new DeploymentConflictError('staged releases cannot be rollback targets');
    return this.rollout(id, target.workflowVersion, expectedRevision, actorId, 'rollback', target.id);
  }

  async remove(id: string): Promise<boolean> {
    const current = await this.get(id);
    if (!current) return false;
    const usage = await this.usage(id);
    if (usage.activeSessions > 0 || usage.activeRuns > 0) throw new DeploymentConflictError('deployment has active sessions or runs and cannot be archived');
    const next = { ...current, status: 'archived' as const, revision: current.revision + 1, mutationRevision: current.mutationRevision + 1, updatedAt: nowIso() };
    if (!await this.storage.compareAndSwap(COLLECTIONS.deployments, id, 'mutationRevision', current.mutationRevision, next, current.workflowId)) throw new DeploymentConflictError('deployment revision conflict');
    return true;
  }

  async usage(id: string): Promise<{ activeSessions: number; sessionsLastMinute: number; totalSessions: number; activeRuns: number; runsLastMinute: number; runsToday: number; totalRuns: number } & DeploymentRunUsageSummary & DeploymentBudgetUsageSummary> {
    const deployment = await this.get(id);
    if (!deployment) throw new Error(`deployment '${id}' not found`);
    const sessions = (await this.storage.list<ChatSession>(COLLECTIONS.sessions, { ref: deployment.workflowId })).map((row) => row.doc).filter((session) => session.deploymentId === id);
    const admissions = (await this.storage.list<DeploymentRunAdmissionRecord>(COLLECTIONS.deploymentRunAdmissions, { ref: id })).map((row) => row.doc);
    const runs = (await this.storage.list<Run>(COLLECTIONS.runs, { ref: deployment.workflowId })).map((row) => row.doc).filter((run) => run.deploymentId === id);
    const now = Date.now();
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const todayAdmissions = admissions.filter((admission) => new Date(admission.createdAt).getTime() >= dayStart.getTime());
    const activeAdmissions = todayAdmissions.filter((admission) => admission.status === 'reserved' || admission.status === 'active');
    return {
      activeSessions: sessions.filter((session) => session.status === 'active' && new Date(session.expiresAt).getTime() > now).length,
      sessionsLastMinute: sessions.filter((session) => now - new Date(session.createdAt).getTime() < 60_000).length,
      totalSessions: sessions.length,
      activeRuns: admissions.filter((admission) => admission.status === 'reserved' || admission.status === 'active').length,
      runsLastMinute: admissions.filter((admission) => now - new Date(admission.createdAt).getTime() < 60_000).length,
      runsToday: todayAdmissions.length,
      totalRuns: admissions.length,
      ...(deployment.maxTokensPerDay !== undefined ? { maxTokensPerDay: deployment.maxTokensPerDay } : {}),
      ...(deployment.maxEstimatedCostUsdPerDay !== undefined ? { maxEstimatedCostUsdPerDay: deployment.maxEstimatedCostUsdPerDay } : {}),
      tokensUsedToday: todayAdmissions.reduce((sum, admission) => sum + deploymentAdmissionTokens(admission), 0),
      estimatedCostUsdUsedToday: Number(todayAdmissions.reduce((sum, admission) => sum + deploymentAdmissionCostUsd(admission), 0).toFixed(12)),
      activeReservedTokens: activeAdmissions.reduce((sum, admission) => sum + (admission.reservedTokens ?? 0), 0),
      activeReservedEstimatedCostUsd: Number(activeAdmissions.reduce((sum, admission) => sum + (admission.reservedEstimatedCostUsd ?? 0), 0).toFixed(12)),
      tokenOverageToday: todayAdmissions.reduce((sum, admission) => sum + (admission.tokenOverage ?? 0), 0),
      estimatedCostUsdOverageToday: Number(todayAdmissions.reduce((sum, admission) => sum + (admission.estimatedCostUsdOverage ?? 0), 0).toFixed(12)),
      ...summarizeRunUsage(runs),
    };
  }
}
