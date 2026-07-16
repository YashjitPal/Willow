/**
 * Local trace-evaluation service.
 *
 * Agent Builder exposes an Evaluate surface for running graders against
 * traces. This implementation keeps graders deterministic and local so the
 * workflow can be evaluated without another model or external service.
 */

import type { JsonValue, Run, RunEvent } from '../domain/types.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';

export type GraderType = 'contains' | 'equals' | 'regex' | 'run_status' | 'event_count';

export interface EvaluationGrader {
  id: string;
  name: string;
  type: GraderType;
  /** `output` (default) or `error` for text graders. */
  target?: 'output' | 'error';
  /** Expected text/number. For event_count, this is the minimum count. */
  expected: JsonValue;
  /** Event type to count for event_count graders. */
  eventType?: string;
}

export interface EvaluationDefinition {
  id: string;
  workflowId: string;
  name: string;
  graders: EvaluationGrader[];
  createdAt: string;
  updatedAt: string;
}

export interface GraderResult {
  graderId: string;
  name: string;
  passed: boolean;
  score: number;
  detail: string;
}

export interface EvaluationRunResult {
  runId: string;
  status: Run['status'];
  score: number;
  results: GraderResult[];
}

export interface EvaluationRun {
  id: string;
  evaluationId: string;
  workflowId: string;
  runIds: string[];
  score: number;
  results: EvaluationRunResult[];
  createdAt: string;
}

interface PersistedEvent {
  seq: number;
  event: RunEvent;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '';
}

function expectedNumber(value: JsonValue): number {
  return typeof value === 'number' ? value : Number(value);
}

export class EvaluationService {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async list(workflowId: string): Promise<EvaluationDefinition[]> {
    const rows = await this.storage.list<EvaluationDefinition>(COLLECTIONS.evaluations, { ref: workflowId });
    return rows.map((row) => row.doc);
  }

  async get(id: string): Promise<EvaluationDefinition | undefined> {
    return this.storage.get<EvaluationDefinition>(COLLECTIONS.evaluations, id);
  }

  async create(input: {
    workflowId: string;
    name: string;
    graders: EvaluationGrader[];
  }): Promise<EvaluationDefinition> {
    const now = nowIso();
    const definition: EvaluationDefinition = {
      id: ids.evaluation(),
      workflowId: input.workflowId,
      name: input.name.trim() || 'Untitled evaluation',
      graders: structuredClone(input.graders),
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.put(COLLECTIONS.evaluations, definition.id, definition, input.workflowId);
    return definition;
  }

  async update(
    id: string,
    patch: { name?: string; graders?: EvaluationGrader[] },
  ): Promise<EvaluationDefinition | undefined> {
    const definition = await this.get(id);
    if (!definition) return undefined;
    if (patch.name !== undefined) {
      definition.name = patch.name.trim() || definition.name;
    }
    if (patch.graders !== undefined) {
      definition.graders = structuredClone(patch.graders);
    }
    definition.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.evaluations, definition.id, definition, definition.workflowId);
    return definition;
  }

  async remove(id: string): Promise<boolean> {
    const definition = await this.get(id);
    if (!definition) return false;
    await this.storage.deleteWhere(COLLECTIONS.evaluationRuns, id);
    return this.storage.delete(COLLECTIONS.evaluations, id);
  }

  async evaluate(id: string, requestedRunIds?: string[]): Promise<EvaluationRun> {
    const definition = await this.get(id);
    if (!definition) throw new Error(`evaluation '${id}' not found`);

    const rows = await this.storage.list<Run>(COLLECTIONS.runs, { ref: definition.workflowId, order: 'desc' });
    const wanted = requestedRunIds?.length ? new Set(requestedRunIds) : undefined;
    const runs = rows.map((row) => row.doc).filter((run) => !wanted || wanted.has(run.id));
    const results: EvaluationRunResult[] = [];

    for (const run of runs) {
      const eventRows = await this.storage.list<PersistedEvent>(COLLECTIONS.spans, { ref: run.id });
      const events = eventRows.sort((a, b) => a.doc.seq - b.doc.seq).map((row) => row.doc.event);
      const graderResults = definition.graders.map((grader) => this.grade(grader, run, events));
      const score = graderResults.length
        ? graderResults.reduce((sum, result) => sum + result.score, 0) / graderResults.length
        : 1;
      results.push({ runId: run.id, status: run.status, score, results: graderResults });
    }

    const score = results.length
      ? results.reduce((sum, result) => sum + result.score, 0) / results.length
      : 0;
    const evaluationRun: EvaluationRun = {
      id: ids.evaluationRun(),
      evaluationId: id,
      workflowId: definition.workflowId,
      runIds: results.map((result) => result.runId),
      score,
      results,
      createdAt: nowIso(),
    };
    await this.storage.put(COLLECTIONS.evaluationRuns, evaluationRun.id, evaluationRun, id);
    return evaluationRun;
  }

  async listRuns(id: string): Promise<EvaluationRun[]> {
    const rows = await this.storage.list<EvaluationRun>(COLLECTIONS.evaluationRuns, { ref: id, order: 'desc' });
    return rows.map((row) => row.doc);
  }

  private grade(grader: EvaluationGrader, run: Run, events: RunEvent[]): GraderResult {
    const actual = grader.target === 'error' ? run.error ?? '' : run.output;
    const expected = grader.expected;
    let passed = false;
    let detail = '';

    try {
      switch (grader.type) {
        case 'contains': {
          const needle = asText(expected);
          passed = asText(actual).toLowerCase().includes(needle.toLowerCase());
          detail = passed ? `output contains "${needle}"` : `output did not contain "${needle}"`;
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
          passed = run.status === String(expected);
          detail = `run status is ${run.status}`;
          break;
        }
        case 'event_count': {
          const count = events.filter((event) => !grader.eventType || event.type === grader.eventType).length;
          const minimum = expectedNumber(expected);
          passed = Number.isFinite(minimum) && count >= minimum;
          detail = `${count} matching events (required ${minimum})`;
          break;
        }
      }
    } catch (error) {
      detail = (error as Error).message;
      passed = false;
    }

    return {
      graderId: grader.id,
      name: grader.name,
      passed,
      score: passed ? 1 : 0,
      detail,
    };
  }
}
