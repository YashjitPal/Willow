/**
 * Workflow service: CRUD, autosaved drafts, publish/versions.
 */

import { normalizeGraph } from '../domain/normalize.ts';
import type { JsonObject, Workflow, WorkflowGraph, WorkflowVersion } from '../domain/types.ts';
import { validateGraph, type ValidationResult } from '../domain/validate.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { getWorkflowTemplate } from './templates.ts';

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
    ],
    edges: [{ id: 'e1-2', source: '1', target: '2' }],
  });
  return graph;
}

export class WorkflowService {
  private storage: Storage;
  constructor(storage: Storage) {
    this.storage = storage;
  }

  async create(input: { name?: string; description?: string; graph?: unknown }): Promise<{
    workflow: Workflow;
    validation: ValidationResult;
  }> {
    let graph: WorkflowGraph;
    if (input.graph !== undefined) {
      graph = normalizeGraph(input.graph).graph;
    } else {
      graph = defaultDraft();
    }
    const validation = validateGraph(graph);
    const wf: Workflow = {
      id: ids.workflow(),
      name: input.name?.trim() || 'Untitled workflow',
      description: input.description,
      draft: graph,
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
  }): Promise<{ workflow: Workflow; validation: ValidationResult } | undefined> {
    const template = getWorkflowTemplate(input.templateId);
    if (!template) return undefined;
    return this.create({
      name: input.name?.trim() || template.name,
      description: input.description ?? template.description,
      graph: structuredClone(template.graph),
    });
  }

  async get(id: string): Promise<Workflow | undefined> {
    return this.storage.get<Workflow>(COLLECTIONS.workflows, id);
  }

  async list(): Promise<Workflow[]> {
    const rows = await this.storage.list<Workflow>(COLLECTIONS.workflows, { order: 'desc' });
    return rows.map((r) => r.doc);
  }

  async update(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<Workflow | undefined> {
    const wf = await this.get(id);
    if (!wf) return undefined;
    if (patch.name !== undefined) wf.name = patch.name.trim() || wf.name;
    if (patch.description !== undefined) wf.description = patch.description;
    wf.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.workflows, id, wf);
    return wf;
  }

  /** Autosave the draft graph. Accepts raw React Flow JSON or canonical graphs. */
  async saveDraft(
    id: string,
    graph: unknown,
  ): Promise<{ workflow: Workflow; validation: ValidationResult } | undefined> {
    const wf = await this.get(id);
    if (!wf) return undefined;
    const normalized = normalizeGraph(graph).graph;
    const validation = validateGraph(normalized);
    wf.draft = normalized;
    wf.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.workflows, id, wf);
    return { workflow: wf, validation };
  }

  async publish(
    id: string,
    notes?: string,
  ): Promise<{ workflow: Workflow; version: WorkflowVersion; validation: ValidationResult } | undefined> {
    const wf = await this.get(id);
    if (!wf) return undefined;
    const validation = validateGraph(wf.draft);
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
    };
    await this.storage.put(COLLECTIONS.versions, `${id}@${version.version}`, version, id);
    wf.latestVersion = version.version;
    wf.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.workflows, id, wf);
    return { workflow: wf, version, validation };
  }

  async listVersions(id: string): Promise<WorkflowVersion[]> {
    const rows = await this.storage.list<WorkflowVersion>(COLLECTIONS.versions, { ref: id });
    return rows.map((r) => r.doc).sort((a, b) => b.version - a.version);
  }

  async getVersion(id: string, version: number): Promise<WorkflowVersion | undefined> {
    return this.storage.get<WorkflowVersion>(COLLECTIONS.versions, `${id}@${version}`);
  }

  async restoreVersion(
    id: string,
    version: number,
  ): Promise<{ workflow: Workflow; validation: ValidationResult } | undefined> {
    const [workflow, published] = await Promise.all([
      this.get(id),
      this.getVersion(id, version),
    ]);
    if (!workflow || !published) return undefined;
    workflow.draft = structuredClone(published.graph);
    workflow.updatedAt = nowIso();
    const validation = validateGraph(workflow.draft);
    await this.storage.put(COLLECTIONS.workflows, id, workflow);
    return { workflow, validation };
  }

  async remove(id: string): Promise<boolean> {
    const ok = await this.storage.delete(COLLECTIONS.workflows, id);
    if (ok) {
      await this.storage.deleteWhere(COLLECTIONS.versions, id);
      // runs + their events are kept for audit; delete if desired:
      const runs = await this.storage.list<JsonObject>(COLLECTIONS.runs, { ref: id });
      for (const r of runs) {
        await this.storage.deleteWhere(COLLECTIONS.spans, r.id);
        await this.storage.delete(COLLECTIONS.runs, r.id);
      }
    }
    return ok;
  }

  validate(graph: unknown): ValidationResult {
    return validateGraph(normalizeGraph(graph).graph);
  }
}
