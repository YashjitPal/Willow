/**
 * Workflow service: CRUD, autosaved drafts, publish/versions.
 */

import { normalizeGraph } from '../domain/normalize.ts';
import { createHash } from 'node:crypto';
import type { BatchJob, JsonObject, Run, SubflowNodeConfig, Workflow, WorkflowContractDiff, WorkflowContractSnapshot, WorkflowDependency, WorkflowGraph, WorkflowSafetySnapshot, WorkflowVersion } from '../domain/types.ts';
import { releaseSafetyErrors, stripEmbeddedHttpCredentials, validateGraph, type ValidationResult } from '../domain/validate.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { DEFAULT_SUBJECT_ID, DEFAULT_WORKSPACE_ID, type AuthPrincipal } from './governance.ts';
import { getWorkflowTemplate } from './templates.ts';

export type WorkflowAccess = Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role' | 'authority'>;

export class DraftRevisionConflictError extends Error {
  code = 'draft_revision_conflict';
  expectedRevision: number;
  current: Workflow;
  constructor(expectedRevision: number, current: Workflow) {
    super(`draft revision conflict: expected ${expectedRevision}, current ${current.draftRevision ?? 0}`);
    this.expectedRevision = expectedRevision;
    this.current = current;
  }
}

export class WorkflowInUseError extends Error {
  code = 'workflow_in_use';
  blockers: import('../storage/index.ts').WorkflowDeletionBlockers;
  constructor(id: string, blockers: import('../storage/index.ts').WorkflowDeletionBlockers) {
    super(`workflow '${id}' is referenced by published workflows or active deployments`);
    this.blockers = blockers;
  }
}

function subflowDependencies(graph: WorkflowGraph): WorkflowDependency[] {
  return graph.nodes.flatMap((node) => {
    if (node.type !== 'subflow') return [];
    const config = node.config as unknown as SubflowNodeConfig;
    return [{ nodeId: node.id, workflowId: config.workflowId, version: config.version }];
  });
}

/** Default draft: Start -> Agent, matching the canvas' initial state. */
function defaultDraft(): WorkflowGraph {
  const { graph } = normalizeGraph({
    nodes: [
      { id: '1', type: 'start', position: { x: 50, y: 125 }, data: { label: 'Start' } },
      {
        id: '2',
        type: 'agent',
        position: { x: 300, y: 125 },
        data: {
          label: 'Agent',
          instructions: 'Answer the user clearly and concisely.',
          model: 'mock/echo',
          outputFormat: 'text',
          includeChatHistory: false,
          writeToConversationHistory: false,
          continueOnError: false,
          tools: [],
        },
      },
      { id: '3', type: 'end', position: { x: 550, y: 125 }, data: { label: 'End' } },
    ],
    edges: [{ id: 'e1-2', source: '1', target: '2' }, { id: 'e2-3', source: '2', target: '3' }],
  });
  return graph;
}

function draftHash(graph: WorkflowGraph): string {
  return createHash('sha256').update(JSON.stringify(graph)).digest('hex');
}

export class WorkflowService {
  private storage: Storage;
  constructor(storage: Storage) {
    this.storage = storage;
  }

  private normalizeOwnership(workflow: Workflow): Workflow {
    workflow.ownerId ??= DEFAULT_SUBJECT_ID;
    workflow.workspaceId ??= DEFAULT_WORKSPACE_ID;
    if (workflow.draftRevision === undefined) workflow.draftRevision = 0;
    return workflow;
  }

  private canAccess(workflow: Workflow, access?: WorkflowAccess): boolean {
    if (!access || access.authority === 'platform') return true;
    const normalized = this.normalizeOwnership(workflow);
    if (normalized.workspaceId !== access.workspaceId) return false;
    return access.role === 'admin' || normalized.ownerId === access.subjectId;
  }

  private safetySnapshot(validation: ValidationResult): WorkflowSafetySnapshot {
    return {
      valid: validation.valid,
      errors: validation.errors.map(({ nodeId, edgeId, message }) => ({ nodeId, edgeId, message })),
      warnings: validation.warnings.map(({ nodeId, edgeId, message }) => ({ nodeId, edgeId, message })),
      contracts: validation.contracts.map((contract) => ({
        nodeId: contract.nodeId,
        nodeName: contract.nodeName,
        nodeType: contract.nodeType,
        inputs: contract.inputs.map(({ name, type, required, description }) => ({ name, type, required, description })),
        outputs: contract.outputs.map(({ name, type, required, description }) => ({ name, type, required, description })),
      })),
      safetyFindings: validation.safetyFindings.map((finding) => ({ ...finding })),
    };
  }

  async create(input: { name?: string; description?: string; graph?: unknown; migrateLegacyGraph?: boolean }, access?: WorkflowAccess): Promise<{
    workflow: Workflow;
    validation: ValidationResult;
  }> {
    let graph: WorkflowGraph;
    if (input.graph !== undefined) {
      graph = stripEmbeddedHttpCredentials(normalizeGraph(input.graph, { migrateLegacyTerminal: input.migrateLegacyGraph }).graph);
    } else {
      graph = defaultDraft();
    }
    const validation = validateGraph(graph);
    const wf: Workflow = {
      id: ids.workflow(),
      ownerId: access?.subjectId ?? DEFAULT_SUBJECT_ID,
      workspaceId: access?.workspaceId ?? DEFAULT_WORKSPACE_ID,
      name: input.name?.trim() || 'Untitled workflow',
      description: input.description,
      draft: graph,
      draftRevision: 1,
      latestVersion: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.storage.put(COLLECTIONS.workflows, wf.id, wf);
    return { workflow: wf, validation };
  }

  async createFromTemplate(input: {
    templateId: string;
    name?: string;
    description?: string;
  }, access?: WorkflowAccess): Promise<{ workflow: Workflow; validation: ValidationResult } | undefined> {
    const template = getWorkflowTemplate(input.templateId);
    if (!template) return undefined;
    return this.create({
      name: input.name?.trim() || template.name,
      description: input.description ?? template.description,
      graph: structuredClone(template.graph),
    }, access);
  }

  async get(id: string, access?: WorkflowAccess): Promise<Workflow | undefined> {
    const workflow = await this.storage.get<Workflow>(COLLECTIONS.workflows, id);
    if (!workflow) return undefined;
    const normalized = this.normalizeOwnership(workflow);
    return this.canAccess(normalized, access) ? normalized : undefined;
  }

  async list(access?: WorkflowAccess): Promise<Workflow[]> {
    const rows = await this.storage.list<Workflow>(COLLECTIONS.workflows, { order: 'desc' });
    return rows.map((row) => this.normalizeOwnership(row.doc)).filter((workflow) => this.canAccess(workflow, access));
  }

  async update(
    id: string,
    patch: { name?: string; description?: string },
    expectedRevision?: number,
    access?: WorkflowAccess,
  ): Promise<Workflow | undefined> {
    const wf = await this.get(id, access);
    if (!wf) return undefined;
    const expected = expectedRevision ?? wf.draftRevision;
    if (expected !== wf.draftRevision) throw new DraftRevisionConflictError(expected, wf);
    if (patch.name !== undefined) wf.name = patch.name.trim() || wf.name;
    if (patch.description !== undefined) wf.description = patch.description;
    wf.draftRevision += 1;
    wf.updatedAt = nowIso();
    if (!await this.storage.compareAndSwap(COLLECTIONS.workflows, id, 'draftRevision', expected, wf)) {
      const current = await this.get(id, access);
      if (!current) return undefined;
      throw new DraftRevisionConflictError(expected, current);
    }
    return wf;
  }

  /** Autosave the draft graph. Accepts raw React Flow JSON or canonical graphs. */
  async saveDraft(
    id: string,
    graph: unknown,
    expectedRevision?: number,
    access?: WorkflowAccess,
  ): Promise<{ workflow: Workflow; validation: ValidationResult } | undefined> {
    const wf = await this.get(id, access);
    if (!wf) return undefined;
    const normalized = stripEmbeddedHttpCredentials(normalizeGraph(graph).graph);
    const validation = validateGraph(normalized);
    const expected = expectedRevision ?? wf.draftRevision;
    if (expected !== wf.draftRevision) throw new DraftRevisionConflictError(expected, wf);
    // Autosave is frequently retried by the canvas. Treat an identical
    // canonical graph as a no-op so harmless retries do not advance the
    // optimistic-concurrency revision or create phantom draft changes.
    if (draftHash(normalized) === draftHash(wf.draft)) return { workflow: wf, validation };
    wf.draft = normalized;
    wf.draftRevision += 1;
    wf.updatedAt = nowIso();
    if (!await this.storage.compareAndSwap(COLLECTIONS.workflows, id, 'draftRevision', expected, wf)) {
      const current = await this.get(id, access);
      if (!current) return undefined;
      throw new DraftRevisionConflictError(expected, current);
    }
    return { workflow: wf, validation };
  }

  async publish(
    id: string,
    notes?: string,
    expectedRevision?: number,
    access?: WorkflowAccess,
  ): Promise<{ workflow: Workflow; version: WorkflowVersion; validation: ValidationResult } | undefined> {
    const wf = await this.get(id, access);
    if (!wf) return undefined;
    const expected = expectedRevision ?? wf.draftRevision;
    if (expected !== wf.draftRevision) throw new DraftRevisionConflictError(expected, wf);
    const structuralValidation = validateGraph(wf.draft);
    const safetyErrors = releaseSafetyErrors(structuralValidation);
    const dependencies = subflowDependencies(wf.draft);
    const dependencyErrors = (await Promise.all(dependencies.map(async (dependency) => {
      if (dependency.workflowId === id) return { nodeId: dependency.nodeId, message: `Subflow cannot reference another version of its own workflow '${id}'` };
      const [childWorkflow, childVersion] = await Promise.all([
        this.get(dependency.workflowId),
        this.storage.get(COLLECTIONS.versions, `${dependency.workflowId}@${dependency.version}`),
      ]);
      if (!childWorkflow || !childVersion) return { nodeId: dependency.nodeId, message: `Subflow references missing published workflow version '${dependency.workflowId}@${dependency.version}'` };
      if (childWorkflow.ownerId !== wf.ownerId || childWorkflow.workspaceId !== wf.workspaceId) {
        return { nodeId: dependency.nodeId, message: `Subflow references workflow '${dependency.workflowId}' owned by another subject or workspace` };
      }
      return undefined;
    }))).filter((issue): issue is { nodeId: string; message: string } => Boolean(issue));
    const validation: ValidationResult = {
      ...structuralValidation,
      valid: structuralValidation.valid && dependencyErrors.length === 0 && safetyErrors.length === 0,
      errors: [...structuralValidation.errors, ...dependencyErrors, ...safetyErrors],
    };
    if (!validation.valid) {
      const err = new Error(
        `cannot publish an invalid workflow: ${validation.errors.map((e) => e.message).join('; ')}`,
      ) as Error & { validation?: ValidationResult };
      err.validation = validation;
      throw err;
    }
    const version: WorkflowVersion = {
      workflowId: id,
      version: wf.latestVersion + 1,
      graph: structuredClone(wf.draft),
      publishedAt: nowIso(),
      notes,
      sourceDraftRevision: expected,
      sourceDraftHash: draftHash(wf.draft),
      validation: this.safetySnapshot(validation),
      dependencies: structuredClone(dependencies),
    };
    wf.latestVersion = version.version;
    wf.draftRevision += 1;
    wf.updatedAt = nowIso();
    const published = await this.storage.publishWorkflowVersion({
      workflowId: id,
      expectedDraftRevision: expected,
      workflow: wf,
      versionId: `${id}@${version.version}`,
      version,
      dependencies,
    });
    if (published.status === 'missing_dependency') {
      const missingValidation: ValidationResult = {
        ...validation,
        valid: false,
        errors: [...validation.errors, { nodeId: published.dependency.nodeId, message: `Subflow references missing published workflow version '${published.dependency.workflowId}@${published.dependency.version}'` }],
      };
      const error = new Error(`cannot publish an invalid workflow: ${missingValidation.errors.map((issue) => issue.message).join('; ')}`) as Error & { validation?: ValidationResult };
      error.validation = missingValidation;
      throw error;
    }
    if (published.status === 'revision_conflict') {
      const current = await this.get(id, access);
      if (!current) return undefined;
      throw new DraftRevisionConflictError(expected, current);
    }
    return { workflow: wf, version, validation };
  }

  async listVersions(id: string, access?: WorkflowAccess): Promise<WorkflowVersion[]> {
    if (!await this.get(id, access)) return [];
    const rows = await this.storage.list<WorkflowVersion>(COLLECTIONS.versions, { ref: id });
    return rows.map((r) => r.doc).sort((a, b) => b.version - a.version);
  }

  async getVersion(id: string, version: number, access?: WorkflowAccess): Promise<WorkflowVersion | undefined> {
    if (!await this.get(id, access)) return undefined;
    return this.storage.get<WorkflowVersion>(COLLECTIONS.versions, `${id}@${version}`);
  }

  async contractDiff(id: string, fromVersion: number, toVersion: number, access?: WorkflowAccess): Promise<WorkflowContractDiff | undefined> {
    const [beforeVersion, afterVersion] = await Promise.all([
      this.getVersion(id, fromVersion, access),
      this.getVersion(id, toVersion, access),
    ]);
    if (!beforeVersion || !afterVersion) return undefined;
    const contractsFor = (version: WorkflowVersion): WorkflowContractSnapshot[] => (
      version.validation?.contracts ?? this.safetySnapshot(validateGraph(version.graph)).contracts ?? []
    );
    const before = new Map(contractsFor(beforeVersion).map((contract) => [contract.nodeId, contract]));
    const after = new Map(contractsFor(afterVersion).map((contract) => [contract.nodeId, contract]));
    const added = [...after.entries()].filter(([nodeId]) => !before.has(nodeId)).map(([, contract]) => structuredClone(contract));
    const removed = [...before.entries()].filter(([nodeId]) => !after.has(nodeId)).map(([, contract]) => structuredClone(contract));
    const changed = [...after.entries()].flatMap(([nodeId, contract]) => {
      const prior = before.get(nodeId);
      if (!prior || JSON.stringify(prior) === JSON.stringify(contract)) return [];
      return [{ nodeId, before: structuredClone(prior), after: structuredClone(contract) }];
    });
    return { fromVersion, toVersion, added, removed, changed };
  }

  async restoreVersion(
    id: string,
    version: number,
    expectedRevision?: number,
    access?: WorkflowAccess,
  ): Promise<{ workflow: Workflow; validation: ValidationResult } | undefined> {
    const [workflow, published] = await Promise.all([
      this.get(id, access),
      this.getVersion(id, version, access),
    ]);
    if (!workflow || !published) return undefined;
    const expected = expectedRevision ?? workflow.draftRevision;
    // Check the caller's revision before preparing the replacement graph. This
    // keeps conflict responses tied to the untouched current draft.
    if (expected !== workflow.draftRevision) throw new DraftRevisionConflictError(expected, workflow);
    const restoredGraph = normalizeGraph(structuredClone(published.graph), {
      migrateLegacyTerminal: true,
    }).graph;
    // Restoring the version already present in the draft is idempotent. In
    // particular, retries must not manufacture a new draft revision.
    if (draftHash(restoredGraph) === draftHash(workflow.draft)) {
      return { workflow, validation: validateGraph(workflow.draft) };
    }
    workflow.draft = restoredGraph;
    workflow.draftRevision += 1;
    workflow.updatedAt = nowIso();
    const validation = validateGraph(workflow.draft);
    if (!await this.storage.compareAndSwap(COLLECTIONS.workflows, id, 'draftRevision', expected, workflow)) {
      const current = await this.get(id, access);
      if (!current) return undefined;
      throw new DraftRevisionConflictError(expected, current);
    }
    return { workflow, validation };
  }

  async remove(id: string, access?: WorkflowAccess): Promise<boolean> {
    if (!await this.get(id, access)) return false;
    const runRows = await this.storage.list<Run>(COLLECTIONS.runs, { ref: id });
    const activeRunIds = runRows
      .filter(({ doc }) => !['completed', 'failed', 'cancelled'].includes(doc.status))
      .map(({ doc }) => doc.id);
    const batchRows = await this.storage.list<BatchJob>(COLLECTIONS.batches, { ref: id });
    const activeBatchIds = batchRows
      .filter(({ doc }) => !['completed', 'failed', 'cancelled'].includes(doc.status))
      .map(({ doc }) => doc.id);
    if (activeRunIds.length || activeBatchIds.length) {
      throw new WorkflowInUseError(id, {
        publishedReferrers: [],
        deploymentIds: [],
        batchIds: activeBatchIds,
        runIds: activeRunIds,
      });
    }
    const deletion = await this.storage.deleteWorkflowIfUnreferenced(id);
    if (deletion.status === 'blocked') throw new WorkflowInUseError(id, deletion.blockers);
    const ok = deletion.status === 'deleted';
    if (ok) {
      // runs + their events are kept for audit; delete if desired:
      for (const r of runRows) {
        await this.storage.deleteWhere(COLLECTIONS.spans, r.id);
        await this.storage.delete(COLLECTIONS.runs, r.id);
      }
      for (const row of batchRows) await this.storage.delete(COLLECTIONS.batches, row.doc.id);
      const sessions = await this.storage.list<JsonObject>(COLLECTIONS.sessions, { ref: id });
      for (const session of sessions) {
        await this.storage.deleteWhere(COLLECTIONS.threads, session.id);
        await this.storage.delete(COLLECTIONS.sessions, session.id);
      }
      await this.storage.deleteWhere(COLLECTIONS.workflowReviewThreads, id);
      await this.storage.deleteWhere(COLLECTIONS.workflowPresence, id);
      const secretRows = await this.storage.list<{ workflowId?: string }>(COLLECTIONS.secretVariables);
      for (const row of secretRows) {
        if (row.doc.workflowId === id) await this.storage.delete(COLLECTIONS.secretVariables, row.id);
      }
    }
    return ok;
  }

  validate(graph: unknown): ValidationResult {
    return validateGraph(normalizeGraph(graph).graph);
  }
}
