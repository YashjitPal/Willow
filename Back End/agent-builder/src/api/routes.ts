/**
 * REST API — all routes under /api/v1.
 */

import type { JsonObject, JsonValue, ProviderKeys, RunAttachment, Workflow } from '../domain/types.ts';
import { normalizeGraph } from '../domain/normalize.ts';
import { createHash } from 'node:crypto';
import { exportPython, exportPythonSdkPackage, exportTypeScript, exportTypeScriptSdkPackage } from '../codegen/index.ts';
import { MCP_CONNECTOR_CATALOG, findConnector } from '../mcp/connectors.ts';
import { sanitizeMcpError, type McpManager } from '../mcp/manager.ts';
import { getProvider, resolveKey } from '../providers/index.ts';
import type { VectorStoreService } from '../rag/vectorStore.ts';
import type { RunEngine } from '../engine/executor.ts';
import type { BatchService } from '../services/batches.ts';
import type { ChatService } from '../services/chat.ts';
import { EvaluationAnnotationStateError, EvaluationCredentialsRequiredError, EvaluationSelectionError, type EvaluationGrader, type EvaluationService, type EvaluationTestCase, type GraderType } from '../services/evaluations.ts';
import { DraftRevisionConflictError, WorkflowInUseError, type WorkflowAccess, type WorkflowService } from '../services/workflows.ts';
import { analyzeTemplateRisk, WORKFLOW_TEMPLATES } from '../services/templates.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { HANDLED, HttpError, openSse, Router, type RequestCtx } from '../http/router.ts';
import { type GovernanceRole, type GovernanceService } from '../services/governance.ts';
import { DeploymentBudgetValidationError, DeploymentConflictError, DeploymentReleaseValidationError, type DeploymentService } from '../services/deployments.ts';
import { loadProviderKeys, updateProviderKeys } from '../services/providerCredentials.ts';
import type { RealtimeService } from '../services/realtime.ts';
import { CollaborationConflictError, CollaborationValidationError, type CollaborationService } from '../services/collaboration.ts';
import { createOpenApiDocument } from './openapi.ts';
import type { SecretService } from '../services/secrets.ts';

export interface ApiServices {
  storage: Storage;
  workflows: WorkflowService;
  collaboration: CollaborationService;
  engine: RunEngine;
  chat: ChatService;
  evaluations: EvaluationService;
  mcp: McpManager;
  vectorStores: VectorStoreService;
  governance: GovernanceService;
  deployments: DeploymentService;
  batches: BatchService;
  realtime: RealtimeService;
  secrets: SecretService;
}

function requireBody(ctx: RequestCtx): JsonObject {
  if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) {
    throw new HttpError(400, 'a JSON object body is required');
  }
  return ctx.body as JsonObject;
}

/** Strip internal-only fields (engine checkpoint + graph snapshot) from a run. */
function publicRunView(run: import('../domain/types.ts').Run) {
  const { checkpoint: _cp, graph: _g, idempotencySignature: _sig, deploymentRunAdmissionId: _admission, ...rest } = run;
  return rest;
}

function publicBatchView(batch: import('../domain/types.ts').BatchJob) {
  return {
    ...batch,
    items: batch.items.map(({ input: _input, ...item }) => item),
  };
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new HttpError(400, `'${name}' must be a non-empty string`);
  return v;
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// Run cursors are opaque, but they must still be structurally valid. Reject
// malformed cursors at the HTTP boundary instead of silently decoding garbage
// and returning an empty page (or leaking a 500 from the engine).
function validateRunCursor(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpError(400, "'cursor' must be a valid run cursor");
  let decoded: string;
  try { decoded = Buffer.from(value, 'base64url').toString('utf8'); }
  catch { throw new HttpError(400, "'cursor' must be a valid run cursor"); }
  const separator = decoded.indexOf('\u0000');
  if (separator <= 0 || separator === decoded.length - 1 || decoded.indexOf('\u0000', separator + 1) !== -1) {
    throw new HttpError(400, "'cursor' must be a valid run cursor");
  }
  return value;
}

const RUN_STATUSES = new Set(['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug', 'completed', 'failed', 'cancelled']);
function validateRunStatus(value: string | undefined): string | undefined {
  if (value !== undefined && !RUN_STATUSES.has(value)) throw new HttpError(400, "'status' is invalid");
  return value;
}

function boundedPositiveInteger(value: unknown, name: string, maximum: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new HttpError(400, `${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function boundedPositiveIntegerQuery(value: string | null, name: string, maximum: number, fallback: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, `${name} must be an integer between 1 and ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new HttpError(400, `${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function nonNegativeIntegerQuery(value: string | null, name: string, fallback = 0): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, `${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new HttpError(400, `${name} must be a non-negative integer`);
  return parsed;
}

function rejectUnsupportedDeploymentBudgetFields(body: JsonObject): void {
  const supported = new Set(['maxTokensPerDay', 'maxEstimatedCostUsdPerDay', 'unpricedCostPolicy']);
  const field = Object.keys(body).find((key) => /token|spend|cost|budget/i.test(key) && !supported.has(key));
  if (field) throw new HttpError(400, `unsupported deployment budget field '${field}'`, 'unsupported_deployment_budget');
}

function boundedPositiveNumber(value: unknown, name: string, maximum: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new HttpError(400, `${name} must be a number greater than 0 and at most ${maximum}`);
  }
  return value;
}

function chatSecret(ctx: RequestCtx): string | undefined {
  return optStr(ctx.headers['x-chatkit-client-secret']);
}
function chatOrigin(ctx: RequestCtx): string | undefined { return optStr(ctx.headers.origin); }

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const EXPORT_SECRET_KEY = /(?:^|[_-])(authorization|api[_-]?key|token|secret|password|cookie|private[_-]?key)(?:$|[_-])/i;
const EXPORT_SECRET_COMPACT_KEYS = new Set([
  'authorization',
  'apikey',
  'xapikey',
  'token',
  'accesstoken',
  'authtoken',
  'bearertoken',
  'refreshtoken',
  'secret',
  'clientsecret',
  'password',
  'cookie',
  'privatekey',
]);

function isExportSecretKey(key: string): boolean {
  if (EXPORT_SECRET_KEY.test(key)) return true;
  return EXPORT_SECRET_COMPACT_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
}

/** Remove credential-bearing fields from portable workflow artifacts. */
function sanitizeWorkflowExportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeWorkflowExportValue);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isExportSecretKey(key)) continue;
    result[key] = sanitizeWorkflowExportValue(child);
  }
  return result;
}

function portableSubflowDependencies(graphValue: unknown): Array<{ nodeId: string; workflowId: string; version: number }> {
  const graph = normalizeGraph(graphValue, { migrateLegacyTerminal: true }).graph;
  return graph.nodes.filter((node) => node.type === 'subflow').map((node) => ({
    nodeId: node.id,
    workflowId: String(node.config.workflowId ?? ''),
    version: Number(node.config.version),
  }));
}

interface ApiIdempotencyClaim {
  signature: string;
  status: 'pending' | 'completed';
  response?: unknown;
  createdAt: string;
}

function parseEvaluationGraders(body: JsonObject): EvaluationGrader[] {
  const rawGraders = Array.isArray(body.graders) ? body.graders : [];
  if (rawGraders.length === 0) {
    throw new HttpError(400, 'an evaluation needs at least one grader');
  }
  const allowed = new Set<GraderType>(['contains', 'equals', 'regex', 'run_status', 'event_count', 'model_judge', 'label_model_judge']);
  const ids = new Set<string>();
  return rawGraders.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, `grader ${index + 1} must be an object`);
    }
    const grader = value as JsonObject;
    const type = optStr(grader.type) as GraderType | undefined;
    if (!type || !allowed.has(type)) {
      throw new HttpError(400, `grader ${index + 1} has an unknown type`);
    }
    const reference = optStr(grader.reference);
    if (reference && reference !== 'test_case_expected') throw new HttpError(400, `grader ${index + 1} has an invalid reference source`);
    if (!('expected' in grader) && !reference && type !== 'model_judge' && type !== 'label_model_judge') throw new HttpError(400, `grader ${index + 1} needs expected or a dataset reference`);
    const id = optStr(grader.id) ?? `grader_${index + 1}`;
    if (ids.has(id)) throw new HttpError(400, `grader ${index + 1} has duplicate id '${id}'`);
    ids.add(id);
    const expected = (grader.expected ?? '') as JsonValue;
    if (type === 'regex') {
      try { new RegExp(String(expected)); }
      catch { throw new HttpError(400, `grader ${index + 1} has an invalid regular expression`); }
    }
    if (type === 'event_count' && (!Number.isFinite(Number(expected)) || Number(expected) < 0)) {
      throw new HttpError(400, `grader ${index + 1} event count must be a non-negative number`);
    }
    // Keep this list aligned with the RunStatus contract. Paused runs are valid
    // trace-evaluation targets too (for example, a workflow can be intentionally
    // evaluated while waiting for credentials or a debugger step).
    if (type === 'run_status' && !['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug', 'completed', 'failed', 'cancelled'].includes(String(expected))) {
      throw new HttpError(400, `grader ${index + 1} has an invalid run status`);
    }
    const threshold = grader.threshold === undefined ? undefined : Number(grader.threshold);
    if (type === 'model_judge' && threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
      throw new HttpError(400, `grader ${index + 1} model judge threshold must be between 0 and 1`);
    }
    const labels = Array.isArray(grader.labels) ? grader.labels.map((label) => typeof label === 'string' ? label.trim() : '') : [];
    const passingLabels = Array.isArray(grader.passingLabels) ? grader.passingLabels.map((label) => typeof label === 'string' ? label.trim() : '') : [];
    if (type === 'label_model_judge') {
      if (labels.length < 2 || labels.length > 20 || labels.some((label) => !label) || new Set(labels).size !== labels.length) {
        throw new HttpError(400, `grader ${index + 1} label judge needs 2 to 20 unique non-empty labels`);
      }
      if (passingLabels.length === 0 || new Set(passingLabels).size !== passingLabels.length || passingLabels.some((label) => !labels.includes(label))) {
        throw new HttpError(400, `grader ${index + 1} passingLabels must be a non-empty unique subset of labels`);
      }
    }
    const weight = grader.weight === undefined ? undefined : Number(grader.weight);
    if (weight !== undefined && (!Number.isFinite(weight) || weight <= 0 || weight > 100)) {
      throw new HttpError(400, `grader ${index + 1} weight must be greater than 0 and at most 100`);
    }
    const nodeId = optStr(grader.nodeId);
    const spanType = optStr(grader.spanType) as EvaluationGrader['spanType'] | undefined;
    const allowedSpanTypes = new Set(['run', 'node', 'llm', 'tool', 'guardrail', 'approval', 'state']);
    if (spanType && !allowedSpanTypes.has(spanType)) throw new HttpError(400, `grader ${index + 1} has an invalid span type`);
    const field = optStr(grader.field) as EvaluationGrader['field'] | undefined;
    const allowedFields = new Set(['output', 'status', 'error', 'duration', 'usage', 'arguments', 'result', 'toolCalls']);
    if (field && !allowedFields.has(field)) throw new HttpError(400, `grader ${index + 1} has an invalid span field`);
    const occurrence = grader.occurrence === undefined ? undefined : Number(grader.occurrence);
    if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 0 || occurrence > 1000)) throw new HttpError(400, `grader ${index + 1} occurrence must be a non-negative integer`);
    const workflowVersion = grader.workflowVersion === undefined ? undefined : Number(grader.workflowVersion);
    if (workflowVersion !== undefined && (!Number.isInteger(workflowVersion) || workflowVersion < 0)) throw new HttpError(400, `grader ${index + 1} workflowVersion must be a non-negative integer`);
    if ((nodeId || spanType || field) && !field) throw new HttpError(400, `grader ${index + 1} scoped graders need a field`);
    return {
      id,
      name: optStr(grader.name) ?? `Grader ${index + 1}`,
      type,
      target: optStr(grader.target) === 'error' ? 'error' : 'output',
      nodeId,
      spanType,
      occurrence,
      field,
      workflowVersion,
      expected,
      reference: reference as EvaluationGrader['reference'],
      eventType: optStr(grader.eventType),
      model: optStr(grader.model),
      rubric: optStr(grader.rubric),
      labels: type === 'label_model_judge' ? labels : undefined,
      passingLabels: type === 'label_model_judge' ? passingLabels : undefined,
      threshold,
      weight,
    };
  });
}

function parseEvaluationTestCases(body: JsonObject, maxCases = 100): EvaluationTestCase[] {
  const raw = body.testCases ?? body.test_cases;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'evaluation testCases must be an array');
  if (raw.length > maxCases) throw new HttpError(400, `an evaluation dataset supports at most ${maxCases} test cases`);
  const ids = new Set<string>();
  return raw.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, `test case ${index + 1} must be an object`);
    }
    const item = value as JsonObject;
    const id = optStr(item.id) ?? `case_${index + 1}`;
    if (ids.has(id)) throw new HttpError(400, `test case ${index + 1} has duplicate id '${id}'`);
    ids.add(id);
    const input = item.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new HttpError(400, `test case ${index + 1} needs an input object`);
    }
    const version = item.version === undefined ? 0 : Number(item.version);
    if (!Number.isInteger(version) || version < 0) {
      throw new HttpError(400, `test case ${index + 1} version must be a non-negative integer`);
    }
    return {
      id,
      name: optStr(item.name) ?? `Test case ${index + 1}`,
      input: normalizeEvaluationInput(input as JsonObject, index),
      version,
      ...('expectedOutput' in item || 'expected_output' in item
        ? { expectedOutput: (item.expectedOutput ?? item.expected_output ?? null) as JsonValue }
        : {}),
    };
  });
}

function parseEvaluationDatasetReference(body: JsonObject): { present: boolean; value: { id: string; version?: number } | null } {
  const hasReference = Object.prototype.hasOwnProperty.call(body, 'dataset')
    || Object.prototype.hasOwnProperty.call(body, 'datasetId')
    || Object.prototype.hasOwnProperty.call(body, 'dataset_id')
    || Object.prototype.hasOwnProperty.call(body, 'datasetVersion')
    || Object.prototype.hasOwnProperty.call(body, 'dataset_version');
  if (!hasReference) return { present: false, value: null };
  const rawDataset = body.dataset;
  if (rawDataset === null || body.datasetId === null || body.dataset_id === null) return { present: true, value: null };
  const dataset = rawDataset && typeof rawDataset === 'object' && !Array.isArray(rawDataset) ? rawDataset as JsonObject : undefined;
  const id = optStr(dataset?.id ?? body.datasetId ?? body.dataset_id)?.trim();
  if (!id) throw new HttpError(400, 'dataset.id is required');
  const rawVersion = dataset?.version ?? body.datasetVersion ?? body.dataset_version;
  if (rawVersion === undefined) return { present: true, value: { id } };
  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version < 1) throw new HttpError(400, 'dataset.version must be a positive integer');
  return { present: true, value: { id, version } };
}

async function validateEvaluationTargets(workflows: WorkflowService, workflowId: string, graders: EvaluationGrader[], access: WorkflowAccess): Promise<void> {
  for (const grader of graders) {
    if (!grader.nodeId) continue;
    const workflow = await workflows.get(workflowId, access);
    const graph = grader.workflowVersion && grader.workflowVersion > 0
      ? (await workflows.getVersion(workflowId, grader.workflowVersion, access))?.graph
      : workflow?.draft;
    if (!graph) throw new HttpError(400, `grader '${grader.id}' targets missing workflow version ${grader.workflowVersion}`);
    if (!graph.nodes.some((node) => node.id === grader.nodeId)) throw new HttpError(400, `grader '${grader.id}' targets unknown node '${grader.nodeId}'`);
  }
}

const EVALUATION_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EVALUATION_AUDIO_MIME_TYPES = new Set(['audio/aac', 'audio/flac', 'audio/mp3', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-wav']);
const EVALUATION_VIDEO_MIME_TYPES = new Set(['video/3gpp', 'video/avi', 'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/x-flv', 'video/x-ms-wmv', 'video/x-msvideo']);
const EVALUATION_DOCUMENT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function normalizeEvaluationInput(input: JsonObject, caseIndex: number): EvaluationTestCase['input'] {
  const normalized = structuredClone(input) as JsonObject;
  const rawAttachments = normalized.attachments;
  if (rawAttachments === undefined) return normalized as EvaluationTestCase['input'];
  if (!Array.isArray(rawAttachments)) throw new HttpError(400, `test case ${caseIndex + 1} attachments must be an array`);
  if (rawAttachments.length > 8) throw new HttpError(400, `test case ${caseIndex + 1} cannot include more than 8 attachments`);
  let totalBytes = 0;
  normalized.attachments = rawAttachments.map((raw, attachmentIndex) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, `test case ${caseIndex + 1} attachment ${attachmentIndex + 1} must be an object`);
    const value = raw as JsonObject;
    const name = optStr(value.name)?.trim() ?? '';
    const mimeType = (optStr(value.mimeType) ?? '').toLowerCase().split(';')[0].trim();
    const contentBase64 = optStr(value.contentBase64) ?? '';
    if (!name || name.length > 255 || /[\\/\0]/.test(name)) throw new HttpError(400, `test case ${caseIndex + 1} attachment ${attachmentIndex + 1} has an invalid name`);
    if (!EVALUATION_IMAGE_MIME_TYPES.has(mimeType) && !EVALUATION_AUDIO_MIME_TYPES.has(mimeType) && !EVALUATION_VIDEO_MIME_TYPES.has(mimeType) && !EVALUATION_DOCUMENT_MIME_TYPES.has(mimeType)) throw new HttpError(400, `test case ${caseIndex + 1} attachment '${name}' has unsupported MIME type '${mimeType}'`);
    if (!isCanonicalBase64(contentBase64)) throw new HttpError(400, `test case ${caseIndex + 1} attachment '${name}' needs base64 content`);
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.length > 5 * 1024 * 1024) throw new HttpError(400, `test case ${caseIndex + 1} attachment '${name}' exceeds 5 MB`);
    totalBytes += bytes.length;
    if (totalBytes > 20 * 1024 * 1024) throw new HttpError(400, `test case ${caseIndex + 1} attachments exceed 20 MB total`);
    return {
      name,
      mimeType,
      contentBase64: bytes.toString('base64'),
      kind: EVALUATION_IMAGE_MIME_TYPES.has(mimeType)
        ? 'image'
        : EVALUATION_AUDIO_MIME_TYPES.has(mimeType)
          ? 'audio'
          : EVALUATION_VIDEO_MIME_TYPES.has(mimeType)
            ? 'video'
            : 'document',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }) as never;
  return normalized as EvaluationTestCase['input'];
}

function normalizeChatAttachments(rawAttachments: unknown): RunAttachment[] {
  if (rawAttachments === undefined) return [];
  if (!Array.isArray(rawAttachments)) throw new HttpError(400, 'attachments must be an array');
  if (rawAttachments.length > 8) throw new HttpError(400, 'a chat message cannot include more than 8 attachments');
  let totalBytes = 0;
  return rawAttachments.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, `attachment ${index + 1} must be an object`);
    const value = raw as JsonObject;
    const name = optStr(value.name)?.trim() ?? '';
    const mimeType = (optStr(value.mimeType ?? value.mime_type) ?? '').toLowerCase().split(';')[0].trim();
    const contentBase64 = optStr(value.contentBase64 ?? value.content_base64) ?? '';
    if (!name || name.length > 255 || /[\\/\0]/.test(name)) throw new HttpError(400, `attachment ${index + 1} has an invalid name`);
    if (!EVALUATION_IMAGE_MIME_TYPES.has(mimeType) && !EVALUATION_AUDIO_MIME_TYPES.has(mimeType) && !EVALUATION_VIDEO_MIME_TYPES.has(mimeType) && !EVALUATION_DOCUMENT_MIME_TYPES.has(mimeType)) throw new HttpError(400, `attachment '${name}' has unsupported MIME type '${mimeType}'`);
    if (!isCanonicalBase64(contentBase64)) throw new HttpError(400, `attachment '${name}' needs base64 content`);
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.length > 5 * 1024 * 1024) throw new HttpError(400, `attachment '${name}' exceeds 5 MB`);
    totalBytes += bytes.length;
    if (totalBytes > 20 * 1024 * 1024) throw new HttpError(400, 'chat message attachments exceed 20 MB total');
    return {
      name,
      mimeType,
      contentBase64: bytes.toString('base64'),
      kind: EVALUATION_IMAGE_MIME_TYPES.has(mimeType)
        ? 'image'
        : EVALUATION_AUDIO_MIME_TYPES.has(mimeType)
          ? 'audio'
          : EVALUATION_VIDEO_MIME_TYPES.has(mimeType)
            ? 'video'
            : 'document',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    } satisfies RunAttachment;
  });
}

/** Per-request provider keys: x-provider-keys header (JSON) or body.provider_keys. */
function parseRequestKeys(ctx: RequestCtx): ProviderKeys | undefined {
  const header = ctx.headers['x-provider-keys'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ProviderKeys;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      throw new HttpError(400, 'x-provider-keys header must be valid JSON');
    }
  }
  const body = ctx.body as JsonObject | undefined;
  const fromBody = body?.provider_keys ?? body?.providerKeys;
  if (fromBody && typeof fromBody === 'object' && !Array.isArray(fromBody)) {
    return fromBody as ProviderKeys;
  }
  return undefined;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function registerRoutes(router: Router, services: ApiServices): void {
  const { storage, workflows, collaboration, engine, chat, evaluations, mcp, vectorStores, governance, deployments, batches, realtime, secrets } = services;

  const requirePlatformAuthority = (ctx: RequestCtx): void => {
    if (ctx.principal.authority !== 'platform') {
      throw new HttpError(403, 'platform administrator authority is required', 'forbidden');
    }
  };

  const secretError = (error: unknown): never => {
    const message = (error as Error).message;
    if (message.includes('revision conflict') || message.includes('already exists')) throw new HttpError(409, message, 'secret_conflict');
    throw new HttpError(400, message, 'invalid_secret');
  };
  const deleteSecretRevision = (ctx: RequestCtx): number => {
    const raw = ctx.query.get('expectedRevision') ?? optStr(ctx.headers['if-match'])?.replace(/^W\//, '').replace(/^"|"$/g, '');
    const revision = Number(raw);
    if (!Number.isInteger(revision) || revision < 1) throw new HttpError(400, 'expectedRevision must be a positive integer');
    return revision;
  };

  router.get('/api/v1/admin/api-keys', async (ctx) => ({ keys: await governance.listKeys(ctx.principal) }));
  router.post('/api/v1/admin/api-keys', async (ctx) => {
    const body = requireBody(ctx);
    const name = str(body.name, 'name').trim();
    const role = str(body.role, 'role') as GovernanceRole;
    if (!['viewer', 'editor', 'publisher', 'admin'].includes(role)) throw new HttpError(400, 'role must be viewer, editor, publisher, or admin');
    const scopes = body.scopes === undefined ? undefined : Array.isArray(body.scopes) && body.scopes.every((scope) => typeof scope === 'string') ? body.scopes as string[] : (() => { throw new HttpError(400, 'scopes must be an array of strings'); })();
    try {
      const created = await governance.createKey({ name, role, scopes, expiresAt: optStr(body.expiresAt), subjectId: optStr(body.subjectId ?? body.subject_id), workspaceId: optStr(body.workspaceId ?? body.workspace_id) }, ctx.principal);
      const { salt: _salt, secretHash: _hash, ...key } = created.key;
      return { key, token: created.token };
    } catch (error) { throw new HttpError(400, (error as Error).message, 'invalid_api_key'); }
  });
  router.delete('/api/v1/admin/api-keys/:id', async (ctx) => {
    if (!await governance.revokeKey(ctx.params.id, ctx.principal)) throw new HttpError(404, 'API key not found or already revoked', 'not_found');
    return { revoked: true };
  });
  router.get('/api/v1/admin/audit', async (ctx) => ({ events: await governance.listAudit(ctx.principal, Number(ctx.query.get('limit') ?? 100), Number(ctx.query.get('offset') ?? 0)) }));

  router.get('/api/v1/admin/credential-vault', async (ctx) => {
    requirePlatformAuthority(ctx);
    if (!storage.credentialVaultStatus) throw new HttpError(501, 'credential vault status is unavailable');
    return { vault: await storage.credentialVaultStatus() };
  });
  router.post('/api/v1/admin/credential-vault/rotate', async (ctx) => {
    requirePlatformAuthority(ctx);
    if (!storage.rotateCredentialVault) throw new HttpError(501, 'credential vault rotation is unavailable');
    try { return { vault: await storage.rotateCredentialVault() }; }
    catch (error) { throw new HttpError(409, (error as Error).message, 'credential_vault_rotation_failed'); }
  });
  router.post('/api/v1/admin/credential-vault/retire-unused', async (ctx) => {
    requirePlatformAuthority(ctx);
    if (!storage.retireCredentialVaultKeys) throw new HttpError(501, 'credential vault key retirement is unavailable');
    try { return { vault: await storage.retireCredentialVaultKeys() }; }
    catch (error) { throw new HttpError(409, (error as Error).message, 'credential_vault_retirement_failed'); }
  });
  const publicChatSession = (session: import('../domain/types.ts').ChatSession) => {
    const { clientSecret: _plain, clientSecretHash: _hash, clientSecretSalt: _salt, ...publicSession } = session;
    return publicSession;
  };
  const publicDeployment = (deployment: import('../domain/types.ts').ChatDeployment) => { const { cohortSalt: _salt, mutationRevision: _mutation, ...safe } = deployment; return safe; };
  const expectedRevision = (ctx: RequestCtx, body: JsonObject): number | undefined => {
    const bodyValue = body.expectedRevision ?? body.expected_revision;
    const match = optStr(ctx.headers['if-match'])?.replace(/^W\//, '').replace(/^"|"$/g, '');
    const raw = bodyValue ?? (match !== undefined ? Number(match) : undefined);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new HttpError(400, 'expectedRevision must be a non-negative integer');
    return value;
  };
  const positiveVersion = (raw: string | null | undefined, field = 'version'): number => {
    if (raw === null || raw === undefined || !/^[1-9]\d*$/.test(raw)) {
      throw new HttpError(400, `${field} must be a positive integer`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new HttpError(400, `${field} must be a positive integer`);
    return value;
  };
  const revisionConflict = (error: DraftRevisionConflictError) => new HttpError(409, error.message, error.code, {
    expectedRevision: error.expectedRevision,
    currentRevision: error.current.draftRevision,
    current: { id: error.current.id, updatedAt: error.current.updatedAt, draftRevision: error.current.draftRevision, latestVersion: error.current.latestVersion, nodeCount: error.current.draft.nodes.length, edgeCount: error.current.draft.edges.length },
  });
  const collaborationError = (error: unknown): HttpError | undefined => {
    if (error instanceof CollaborationConflictError) return new HttpError(409, error.message, 'review_revision_conflict', {
      expectedRevision: error.expectedRevision,
      currentRevision: error.current.revision,
      current: error.current,
    });
    if (error instanceof CollaborationValidationError) return new HttpError(400, error.message, 'invalid_collaboration_request');
    return undefined;
  };
  const reviewExpectedRevision = (ctx: RequestCtx, body: JsonObject): number => {
    const revision = expectedRevision(ctx, body);
    if (revision === undefined || revision < 1) throw new HttpError(400, 'expectedRevision must be a positive integer');
    return revision;
  };
  const deploymentUnavailable = (message: string): boolean => (
    message.includes("deployment '") &&
    (message.includes(' is paused') || message.includes(' is archived') || message.includes(' is missing') || message.includes(' is unavailable'))
  );
  const chatAccessError = (error: unknown): HttpError | undefined => {
    const message = (error as Error).message;
    if (deploymentUnavailable(message)) return new HttpError(409, message, 'deployment_unavailable');
    if (message.includes('origin')) return new HttpError(403, message, 'origin_not_allowed');
    if (message.includes('secret')) return new HttpError(401, message, 'unauthorized');
    if (message.includes('expired') || message.includes('cancelled')) return new HttpError(410, message, 'session_inactive');
    return undefined;
  };
  const authorizeChatRun = async (ctx: RequestCtx, run: import('../domain/types.ts').Run): Promise<void> => {
    if (!run.sessionId) return;
    try {
      const session = await chat.authenticateSessionOwner(run.sessionId, chatSecret(ctx), chatOrigin(ctx));
      if (session) return;
    } catch (error) {
      const mapped = chatAccessError(error);
      if (mapped) throw mapped;
    }
    {
      throw new HttpError(401, 'invalid chat session secret', 'unauthorized');
    }
  };
  const authorizeRunOwnership = async (ctx: RequestCtx, run: import('../domain/types.ts').Run): Promise<void> => {
    if (ctx.principal.authority === 'platform') return;
    if (run.ownerId || run.workspaceId) {
      if (run.workspaceId === ctx.principal.workspaceId
        && (ctx.principal.role === 'admin' || run.ownerId === ctx.principal.subjectId)) return;
      throw new HttpError(404, `run '${run.id}' not found`);
    }
    if (!await workflows.get(run.workflowId, ctx.principal)) throw new HttpError(404, `run '${run.id}' not found`);
  };
  const authorizedDeployment = async (ctx: RequestCtx) => {
    const deployment = await deployments.get(ctx.params.id, ctx.principal);
    if (!deployment) throw new HttpError(404, 'deployment not found');
    return deployment;
  };
  const idempotent = async <T>(
    ctx: RequestCtx,
    scope: string,
    request: unknown,
    action: () => Promise<T>,
  ): Promise<T> => {
    const key = optStr(ctx.headers['idempotency-key'])?.trim();
    if (!key) return action();
    if (key.length > 255) throw new HttpError(400, 'idempotency key exceeds 255 characters', 'invalid_idempotency_key');
    const signature = createHash('sha256').update(stableJson(request)).digest('hex');
    const claimId = createHash('sha256').update(`${scope}\u0000${key}`).digest('hex');
    const claim: ApiIdempotencyClaim = {
      signature,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const inserted = await storage.putIfAbsent(COLLECTIONS.idempotency, claimId, claim, scope);
    if (!inserted) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const existing = await storage.get<ApiIdempotencyClaim>(COLLECTIONS.idempotency, claimId);
        if (existing) {
          if (existing.signature !== signature) {
            throw new HttpError(409, 'idempotency key was already used with a different request', 'idempotency_conflict');
          }
          if (existing.status === 'completed') return structuredClone(existing.response) as T;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new HttpError(409, 'idempotency request is still in progress; retry shortly', 'idempotency_in_progress');
    }
    try {
      const response = await action();
      claim.status = 'completed';
      claim.response = structuredClone(response);
      await storage.put(COLLECTIONS.idempotency, claimId, claim, scope);
      return response;
    } catch (error) {
      await storage.delete(COLLECTIONS.idempotency, claimId);
      throw error;
    }
  };

  // ------------------------------------------------------------------
  // health
  // ------------------------------------------------------------------
  router.get('/api/v1/health', () => ({
    ok: true,
    service: 'willow-agent-builder',
    version: '0.1.0',
    time: new Date().toISOString(),
  }));
  router.get('/api/v1/openapi.json', () => createOpenApiDocument(router.describeRoutes()));

  // ------------------------------------------------------------------
  // settings / provider keys
  // ------------------------------------------------------------------
  router.get('/api/v1/settings/keys', async (ctx) => {
    const keys = (await loadProviderKeys(storage, ctx.principal.workspaceId)) ?? {};
    const masked: JsonObject = {};
    for (const [provider, list] of Object.entries(keys)) {
      masked[provider] = (list ?? []).map(maskKey);
    }
    return { keys: masked };
  });

  router.put('/api/v1/settings/keys', async (ctx) => {
    const body = requireBody(ctx);
    const allowed = ['gemini', 'openai', 'anthropic', 'grok', 'kimi', 'glm', 'brave', 'tavily'];
    for (const [provider, value] of Object.entries(body)) {
      if (!allowed.includes(provider)) continue;
      if (value === null) continue;
      if (!Array.isArray(value) || value.some((k) => typeof k !== 'string' || k.trim().length === 0)) {
        throw new HttpError(400, `'${provider}' must be an array of strings (or null to clear)`);
      }
    }
    const next = await updateProviderKeys(storage, ctx.principal.workspaceId, (current) => {
      const updated: Record<string, string[]> = { ...current } as Record<string, string[]>;
      for (const [provider, value] of Object.entries(body)) {
        if (!allowed.includes(provider)) continue;
        if (value === null) delete updated[provider];
        else updated[provider] = value as string[];
      }
      return updated;
    });
    return { ok: true, providers: Object.fromEntries(Object.entries(next).map(([p, l]) => [p, l.length])) };
  });

  // ------------------------------------------------------------------
  // models
  // ------------------------------------------------------------------
  router.get('/api/v1/models', async (ctx) => {
    const providerParam = ctx.query.get('provider');
    const requestKeys = parseRequestKeys(ctx);
    const storedKeys = (await loadProviderKeys(storage, ctx.principal.workspaceId)) ?? {};
    const wanted = providerParam
      ? [providerParam]
      : ['gemini', 'openai', 'anthropic', 'grok', 'kimi', 'glm', 'mock'];

    const models: Array<JsonObject> = [];
    const errors: JsonObject = {};
    await Promise.all(
      wanted.map(async (p) => {
        try {
          const provider = getProvider(p);
          const key = resolveKey(p as 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'mock', requestKeys, storedKeys);
          const list = await provider.listModels(key);
          for (const m of list) {
            models.push({ id: m.id, provider: p, displayName: m.displayName, description: m.description ?? '', inputModalities: m.inputModalities, ...(m.contextWindowTokens !== undefined ? { contextWindowTokens: m.contextWindowTokens } : {}), ...(m.maxOutputTokens !== undefined ? { maxOutputTokens: m.maxOutputTokens } : {}), limitsSource: m.limitsSource, ...(m.limitsCatalogVersion ? { limitsCatalogVersion: m.limitsCatalogVersion } : {}) });
          }
        } catch (e) {
          errors[p] = (e as Error).message;
        }
      }),
    );
    const providerOrder = new Map(['gemini', 'openai', 'anthropic', 'grok', 'kimi', 'glm', 'mock'].map((provider, index) => [provider, index]));
    models.sort((a, b) =>
      (providerOrder.get(String(a.provider)) ?? Number.MAX_SAFE_INTEGER) - (providerOrder.get(String(b.provider)) ?? Number.MAX_SAFE_INTEGER)
      || String(a.displayName).localeCompare(String(b.displayName))
      || String(a.id).localeCompare(String(b.id)));
    return { models, errors };
  });

  // ------------------------------------------------------------------
  // workflows
  // ------------------------------------------------------------------
  router.get('/api/v1/workflows', async (ctx) => {
    const list = await workflows.list(ctx.principal);
    return {
      workflows: list.map((w) => ({
        id: w.id,
        ownerId: w.ownerId,
        workspaceId: w.workspaceId,
        name: w.name,
        description: w.description ?? '',
        draftRevision: w.draftRevision,
        latestVersion: w.latestVersion,
        nodeCount: w.draft.nodes.length,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
    };
  });

  router.get('/api/v1/workflow-templates', (ctx) => {
    const category = ctx.query.get('category')?.toLowerCase();
    const tag = ctx.query.get('tag')?.toLowerCase();
    const risk = ctx.query.get('riskLevel')?.toLowerCase();
    const templates = WORKFLOW_TEMPLATES.filter((template) =>
      (!category || template.categories.some((value) => value.toLowerCase() === category)) &&
      (!tag || template.tags.some((value) => value.toLowerCase() === tag)) &&
      (!risk || template.riskLevel === risk),
    ).map(({ graph, ...template }) => {
      const validation = workflows.validate(graph);
      return {
        ...template,
        preview: {
          nodes: graph.nodes.slice(0, 24).map((node) => ({
            id: String(node.id), type: String(node.type),
            name: String((node.data as JsonObject | undefined)?.label ?? node.name ?? node.id),
          })),
          edges: graph.edges.slice(0, 32).map((edge) => ({ source: String(edge.source), target: String(edge.target), ...(edge.sourceHandle ? { sourceHandle: String(edge.sourceHandle) } : {}) })),
          contracts: validation.contracts ?? [],
          safetyFindings: validation.safetyFindings ?? [],
          riskFactors: analyzeTemplateRisk(graph),
        },
      };
    });
    return { templates };
  });

  router.post('/api/v1/workflows/from-template', async (ctx) => {
    const body = requireBody(ctx);
    const templateId = str(body.templateId ?? body.template_id, 'templateId');
    const result = await workflows.createFromTemplate({
      templateId,
      name: optStr(body.name),
      description: optStr(body.description),
    }, ctx.principal);
    if (!result) throw new HttpError(404, `workflow template '${templateId}' not found`);
    return result;
  });

  router.post('/api/v1/workflows', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    let result;
    try { result = await workflows.create({
      name: optStr(body.name),
      description: optStr(body.description),
      graph: body.graph,
    }, ctx.principal); } catch (error) {
      if ((error as Error).message.includes('embedded HTTP credentials')) throw new HttpError(422, (error as Error).message, 'embedded_http_credentials');
      throw error;
    }
    const { workflow, validation } = result;
    return { workflow, validation };
  });

  router.post('/api/v1/workflows/import', async (ctx) => {
    const body = requireBody(ctx);
    const artifact = body.artifact;
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new HttpError(400, 'a portable workflow artifact is required');
    }
    const portable = artifact as JsonObject;
    if (portable.kind !== 'willow.agent-workflow' || portable.formatVersion !== 1) {
      throw new HttpError(400, 'unsupported workflow artifact format');
    }
    const payload = portable.workflow;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new HttpError(400, 'workflow artifact payload is missing');
    }
    const workflowPayload = payload as JsonObject;
    if (!workflowPayload.graph) throw new HttpError(400, 'workflow artifact graph is missing');
    const graphDependencies = portableSubflowDependencies(workflowPayload.graph);
    // Newer artifacts carry an explicit dependency manifest. Verify it against
    // the graph so pinned workflow/version provenance cannot be silently
    // changed or dropped in transit. Older v1 artifacts may omit the field.
    if (portable.dependencies !== undefined) {
      const declared = portable.dependencies;
      if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
        throw new HttpError(400, 'workflow artifact dependencies must be an object', 'invalid_dependencies');
      }
      const rawSubflows = (declared as JsonObject).subflows;
      if (!Array.isArray(rawSubflows)) {
        throw new HttpError(400, 'workflow artifact dependencies.subflows must be an array', 'invalid_dependencies');
      }
      const normalizedDeclared = rawSubflows.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const item = value as JsonObject;
        const nodeId = optStr(item.nodeId);
        const workflowId = optStr(item.workflowId);
        const version = Number(item.version);
        return nodeId && workflowId && Number.isInteger(version) && version > 0
          ? { nodeId, workflowId, version }
          : null;
      });
      if (normalizedDeclared.some((item) => item === null)
        || JSON.stringify(normalizedDeclared) !== JSON.stringify(graphDependencies)) {
        throw new HttpError(422, 'workflow artifact dependency manifest does not match its graph', 'invalid_dependencies');
      }
    }
    const missingDependencies: Array<{ nodeId: string; workflowId: string; version: number }> = [];
    for (const dependency of graphDependencies) {
      // Portable artifacts must pin every nested workflow to a published version.
      // Allowing an unpinned subflow here creates an import that cannot be run
      // deterministically and bypasses the dependency check below.
      if (!dependency.workflowId.trim() || !Number.isInteger(dependency.version) || dependency.version < 1) {
        throw new HttpError(422, `portable workflow has an invalid pinned subflow dependency (node ${dependency.nodeId})`, 'invalid_subflow_dependency');
      }
      const version = await workflows.getVersion(dependency.workflowId, dependency.version, ctx.principal);
      if (!version) missingDependencies.push(dependency);
    }
    if (missingDependencies.length) {
      const detail = missingDependencies
        .map((dependency) => `${dependency.workflowId}@${dependency.version} (node ${dependency.nodeId})`)
        .join(', ');
      throw new HttpError(422, `portable workflow is missing pinned subflow dependencies: ${detail}`, 'missing_subflow_dependency');
    }
    return workflows.create({
      name: optStr(body.name) ?? optStr(workflowPayload.name) ?? 'Imported workflow',
      description: optStr(workflowPayload.description),
      graph: workflowPayload.graph,
      migrateLegacyGraph: true,
    }, ctx.principal);
  });

  router.get('/api/v1/workflows/:id', async (ctx) => {
    const wf = await workflows.get(ctx.params.id, ctx.principal);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { workflow: wf };
  });

  router.get('/api/v1/workflows/:id/secrets', async (ctx) => {
    const workflow = await workflows.get(ctx.params.id, ctx.principal);
    if (!workflow) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { secrets: await secrets.list('workflow', workflow.id, ctx.principal) };
  });
  router.post('/api/v1/workflows/:id/secrets', async (ctx) => {
    const workflow = await workflows.get(ctx.params.id, ctx.principal);
    if (!workflow) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const body = requireBody(ctx);
    try { return { secret: await secrets.create({ scope: 'workflow', scopeId: workflow.id, workflowId: workflow.id, ownerId: workflow.ownerId, workspaceId: workflow.workspaceId, name: str(body.name, 'name'), value: str(body.value, 'value'), description: optStr(body.description) }) }; }
    catch (error) { return secretError(error); }
  });
  router.patch('/api/v1/workflows/:id/secrets/:secretId', async (ctx) => {
    const workflow = await workflows.get(ctx.params.id, ctx.principal);
    if (!workflow) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const body = requireBody(ctx);
    try {
      const secret = await secrets.update('workflow', workflow.id, ctx.params.secretId, Number(body.expectedRevision), { name: optStr(body.name), value: optStr(body.value), description: body.description === null ? null : optStr(body.description) }, ctx.principal);
      if (!secret) throw new HttpError(404, 'secret not found');
      return { secret };
    } catch (error) { if (error instanceof HttpError) throw error; return secretError(error); }
  });
  router.delete('/api/v1/workflows/:id/secrets/:secretId', async (ctx) => {
    const workflow = await workflows.get(ctx.params.id, ctx.principal);
    if (!workflow) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    try {
      if (!await secrets.remove('workflow', workflow.id, ctx.params.secretId, deleteSecretRevision(ctx), ctx.principal)) throw new HttpError(404, 'secret not found');
      return { ok: true };
    } catch (error) { if (error instanceof HttpError) throw error; return secretError(error); }
  });

  router.get('/api/v1/workflows/:id/comments', async (ctx) => {
    const threads = await collaboration.listThreads(ctx.params.id, ctx.principal, ctx.query.get('includeResolved') !== 'false');
    if (!threads) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { threads };
  });

  router.post('/api/v1/workflows/:id/comments', async (ctx) => {
    const body = requireBody(ctx);
    try {
      const thread = await collaboration.createThread(ctx.params.id, {
        body: body.body,
        anchor: body.anchor,
        displayName: optStr(body.displayName ?? body.display_name),
      }, ctx.principal);
      if (!thread) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
      return { thread };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const mapped = collaborationError(error);
      if (mapped) throw mapped;
      throw error;
    }
  });

  router.post('/api/v1/workflows/:id/comments/:threadId/replies', async (ctx) => {
    const body = requireBody(ctx);
    try {
      const thread = await collaboration.reply(ctx.params.id, ctx.params.threadId, {
        body: body.body,
        expectedRevision: reviewExpectedRevision(ctx, body),
        displayName: optStr(body.displayName ?? body.display_name),
      }, ctx.principal);
      if (!thread) throw new HttpError(404, `review thread '${ctx.params.threadId}' not found`);
      return { thread };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const mapped = collaborationError(error);
      if (mapped) throw mapped;
      throw error;
    }
  });

  router.patch('/api/v1/workflows/:id/comments/:threadId', async (ctx) => {
    const body = requireBody(ctx);
    const status = optStr(body.status);
    if (status !== 'open' && status !== 'resolved') throw new HttpError(400, "status must be 'open' or 'resolved'");
    try {
      const thread = await collaboration.setStatus(ctx.params.id, ctx.params.threadId, status, reviewExpectedRevision(ctx, body), ctx.principal);
      if (!thread) throw new HttpError(404, `review thread '${ctx.params.threadId}' not found`);
      return { thread };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const mapped = collaborationError(error);
      if (mapped) throw mapped;
      throw error;
    }
  });

  router.delete('/api/v1/workflows/:id/comments/:threadId', async (ctx) => {
    try {
      const expectedRevision = positiveVersion(ctx.query.get('expectedRevision') ?? ctx.query.get('expected_revision'), 'expectedRevision');
      if (!await collaboration.removeThread(ctx.params.id, ctx.params.threadId, expectedRevision, ctx.principal)) throw new HttpError(404, `review thread '${ctx.params.threadId}' not found`);
      return { ok: true };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const mapped = collaborationError(error);
      if (mapped) throw mapped;
      throw error;
    }
  });

  router.get('/api/v1/workflows/:id/presence', async (ctx) => {
    const presence = await collaboration.listPresence(ctx.params.id, ctx.principal);
    if (!presence) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { presence };
  });

  router.put('/api/v1/workflows/:id/presence', async (ctx) => {
    const body = requireBody(ctx);
    try {
      const presence = await collaboration.heartbeat(ctx.params.id, {
        clientId: body.clientId ?? body.client_id,
        displayName: optStr(body.displayName ?? body.display_name),
        color: body.color,
        cursor: body.cursor,
        selectedNodeIds: body.selectedNodeIds ?? body.selected_node_ids,
        activeNodeId: body.activeNodeId ?? body.active_node_id,
        ttlSeconds: body.ttlSeconds ?? body.ttl_seconds,
      }, ctx.principal);
      if (!presence) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
      return { presence };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const mapped = collaborationError(error);
      if (mapped) throw mapped;
      throw error;
    }
  });

  router.delete('/api/v1/workflows/:id/presence', async (ctx) => {
    const clientId = ctx.query.get('clientId')?.trim() ?? '';
    if (!clientId) throw new HttpError(400, 'clientId query parameter is required');
    const removed = await collaboration.leave(ctx.params.id, clientId, ctx.principal);
    if (removed === undefined) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { ok: removed };
  });

  router.get('/api/v1/workflows/:id/collaboration/events', async (ctx) => {
    if (!await workflows.get(ctx.params.id, ctx.principal)) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const stream = openSse(ctx);
    const pending: import('../domain/types.ts').WorkflowCollaborationEvent[] = [];
    let snapshotSent = false;
    const unsubscribe = collaboration.subscribe(ctx.params.id, (event) => {
      if (snapshotSent) stream.send(event.type, event, event.seq);
      else pending.push(event);
    });
    stream.onClose(unsubscribe);
    const [threads, presence] = await Promise.all([
      collaboration.listThreads(ctx.params.id, ctx.principal, true),
      collaboration.listPresence(ctx.params.id, ctx.principal),
    ]);
    stream.send('collaboration.snapshot', { workflowId: ctx.params.id, threads: threads ?? [], presence: presence ?? [] }, 0);
    snapshotSent = true;
    for (const event of pending) stream.send(event.type, event, event.seq);
    return HANDLED;
  });

  router.patch('/api/v1/workflows/:id', async (ctx) => {
    const body = requireBody(ctx);
    let wf;
    try {
      wf = await workflows.update(ctx.params.id, {
        name: optStr(body.name),
        description: optStr(body.description),
      }, expectedRevision(ctx, body), ctx.principal);
    } catch (error) {
      if (error instanceof DraftRevisionConflictError) throw revisionConflict(error);
      throw error;
    }
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { workflow: wf };
  });

  router.delete('/api/v1/workflows/:id', async (ctx) => {
    try {
      const ok = await workflows.remove(ctx.params.id, ctx.principal);
      if (!ok) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
      return { ok: true };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof WorkflowInUseError) throw new HttpError(409, error.message, error.code, error.blockers);
      throw error;
    }
  });

  router.put('/api/v1/workflows/:id/draft', async (ctx) => {
    const body = requireBody(ctx);
    const graph = body.graph ?? body;
    let result;
    try { result = await workflows.saveDraft(ctx.params.id, graph, expectedRevision(ctx, body), ctx.principal); }
    catch (error) {
      if (error instanceof DraftRevisionConflictError) throw revisionConflict(error);
      if ((error as Error).message.includes('embedded HTTP credentials')) throw new HttpError(422, (error as Error).message, 'embedded_http_credentials');
      throw error;
    }
    if (!result) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return result;
  });

  router.post('/api/v1/workflows/:id/validate', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    if (body.graph !== undefined) {
      return { validation: workflows.validate(body.graph) };
    }
    const wf = await workflows.get(ctx.params.id, ctx.principal);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { validation: workflows.validate(wf.draft) };
  });

  router.post('/api/v1/workflows/:id/publish', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const notes = optStr(body.notes);
    if (notes && notes.length > 2000) {
      throw new HttpError(400, 'publish notes must be 2000 characters or fewer');
    }
    try {
      const revision = expectedRevision(ctx, body);
      const result = await idempotent(
        ctx,
        `workflow-publish:${ctx.params.id}`,
        { notes: notes ?? null, expectedRevision: revision ?? null },
        async () => workflows.publish(ctx.params.id, notes, revision, ctx.principal),
      );
      if (!result) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
      return result;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof DraftRevisionConflictError) throw revisionConflict(e);
      const err = e as Error & { validation?: unknown };
      if (err.validation) {
        throw new HttpError(422, err.message, 'invalid_workflow');
      }
      throw e;
    }
  });

  router.get('/api/v1/workflows/:id/versions', async (ctx) => {
    const wf = await workflows.get(ctx.params.id, ctx.principal);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { versions: await workflows.listVersions(ctx.params.id, ctx.principal) };
  });

  router.get('/api/v1/workflows/:id/versions/:version', async (ctx) => {
    const v = positiveVersion(ctx.params.version);
    const ver = await workflows.getVersion(ctx.params.id, v, ctx.principal);
    if (!ver) throw new HttpError(404, `version ${ctx.params.version} not found`);
    return { version: ver };
  });

  router.get('/api/v1/workflows/:id/contract-diff', async (ctx) => {
    const fromVersion = Number.parseInt(ctx.query.get('from') ?? '', 10);
    const toVersion = Number.parseInt(ctx.query.get('to') ?? '', 10);
    if (!Number.isInteger(fromVersion) || fromVersion < 1 || !Number.isInteger(toVersion) || toVersion < 1) {
      throw new HttpError(400, 'contract diff requires positive integer from and to versions');
    }
    const diff = await workflows.contractDiff(ctx.params.id, fromVersion, toVersion, ctx.principal);
    if (!diff) throw new HttpError(404, `workflow version ${fromVersion} or ${toVersion} not found`);
    return { diff };
  });

  router.get('/api/v1/workflows/:id/export-workflow', async (ctx) => {
    const workflow = await workflows.get(ctx.params.id, ctx.principal);
    if (!workflow) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const versionQuery = ctx.query.get('version');
    const requestedVersion = versionQuery === null ? 0 : positiveVersion(versionQuery);
    const graph = requestedVersion > 0
      ? (await workflows.getVersion(ctx.params.id, requestedVersion, ctx.principal))?.graph
      : workflow.draft;
    if (!graph) throw new HttpError(404, `version ${requestedVersion} not found`);
    const versionMetadata = requestedVersion > 0
      ? await workflows.getVersion(ctx.params.id, requestedVersion, ctx.principal)
      : undefined;
    const validation = versionMetadata?.validation ?? workflows.validate(graph);
    return {
      artifact: {
        kind: 'willow.agent-workflow',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        dependencies: { subflows: portableSubflowDependencies(graph) },
        workflow: {
          name: workflow.name,
          description: workflow.description,
          graph: sanitizeWorkflowExportValue(graph),
          validation: {
            valid: validation.valid,
            errors: validation.errors.map(({ nodeId, edgeId, message }) => ({ nodeId, edgeId, message })),
            warnings: validation.warnings.map(({ nodeId, edgeId, message }) => ({ nodeId, edgeId, message })),
            contracts: (validation.contracts ?? []).map((contract) => ({
              nodeId: contract.nodeId,
              nodeName: contract.nodeName,
              nodeType: contract.nodeType,
              inputs: contract.inputs.map(({ name, type, required, description }) => ({ name, type, required, description })),
              outputs: contract.outputs.map(({ name, type, required, description }) => ({ name, type, required, description })),
            })),
            safetyFindings: (validation.safetyFindings ?? []).map((finding) => ({ ...finding })),
          },
        },
      },
    };
  });

  router.post('/api/v1/workflows/:id/versions/:version/restore', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const version = positiveVersion(ctx.params.version);
    let restored;
    try { restored = await workflows.restoreVersion(ctx.params.id, version, expectedRevision(ctx, body), ctx.principal); }
    catch (error) { if (error instanceof DraftRevisionConflictError) throw revisionConflict(error); throw error; }
    if (!restored) {
      throw new HttpError(404, `workflow '${ctx.params.id}' or version ${version} not found`);
    }
    return restored;
  });

  router.post('/api/v1/workflows/:id/export', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const format = (optStr(body.format) ?? 'typescript').toLowerCase();
    const wf = await workflows.get(ctx.params.id, ctx.principal);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    let graph = wf.draft;
    if (typeof body.version === 'number' && body.version > 0) {
      const ver = await workflows.getVersion(ctx.params.id, body.version, ctx.principal);
      if (!ver) throw new HttpError(404, `version ${body.version} not found`);
      graph = ver.graph;
    }
    if (format === 'python' || format === 'py') {
      return { format: 'python', code: exportPython(wf.name, graph) };
    }
    if (format === 'typescript' || format === 'ts') {
      return { format: 'typescript', code: exportTypeScript(wf.name, graph) };
    }
    if (format === 'typescript-sdk' || format === 'ts-sdk') {
      return { format: 'typescript-sdk', bundle: exportTypeScriptSdkPackage(wf.name, graph) };
    }
    if (format === 'python-sdk' || format === 'py-sdk') {
      return { format: 'python-sdk', bundle: exportPythonSdkPackage(wf.name, graph) };
    }
    throw new HttpError(400, `unknown export format '${format}' (typescript | python | typescript-sdk | python-sdk)`);
  });

  // ------------------------------------------------------------------
  // runs
  // ------------------------------------------------------------------
  router.post('/api/v1/workflows/:id/runs', async (ctx) => {
    if (!await workflows.get(ctx.params.id, ctx.principal)) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const body = (ctx.body ?? {}) as JsonObject;
    const requestKeys = parseRequestKeys(ctx);
    const inputRaw = (body.input ?? {}) as JsonObject;
    const input = typeof inputRaw === 'string' ? { input_as_text: inputRaw } : inputRaw;
    const debugBody = body.debug && typeof body.debug === 'object' && !Array.isArray(body.debug) ? body.debug as JsonObject : undefined;
    const breakpointNodeIds = debugBody?.breakpointNodeIds ?? debugBody?.breakpoint_node_ids;
    if (breakpointNodeIds !== undefined && (!Array.isArray(breakpointNodeIds) || !breakpointNodeIds.every((value) => typeof value === 'string'))) throw new HttpError(400, 'debug.breakpointNodeIds must be an array of strings');
    try {
      const run = await engine.createRun({
        workflowId: ctx.params.id,
        version: typeof body.version === 'number' ? body.version : 0,
        ownerId: ctx.principal.subjectId,
        workspaceId: ctx.principal.workspaceId,
        requestKeys,
        idempotencyKey: optStr(ctx.headers['idempotency-key']),
        debug: debugBody ? { breakpointNodeIds: breakpointNodeIds as string[] | undefined, pauseBeforeFirst: debugBody.pauseBeforeFirst === true || debugBody.pause_before_first === true } : undefined,
        input: {
          input_as_text: optStr(input.input_as_text) ?? optStr(body.input_as_text) ?? '',
          variables: (input.variables ?? undefined) as JsonObject | undefined,
          state_variables: (input.state_variables ?? undefined) as JsonObject | undefined,
          history: (input.history ?? undefined) as never,
          attachments: (input.attachments ?? body.attachments ?? undefined) as never,
        },
      });
      const publicRun = publicRunView(run);
      return { run: publicRun };
    } catch (e) {
      if ((e as Error).message.includes('idempotency key was already used')) {
        throw new HttpError(409, (e as Error).message, 'idempotency_conflict');
      }
      if ((e as Error).message.includes('idempotency request is still')) {
        throw new HttpError(409, (e as Error).message, 'idempotency_in_progress');
      }
      if ((e as Error).message.includes('not found')) throw new HttpError(404, (e as Error).message);
      if ((e as Error).message.includes('invalid')) throw new HttpError(422, (e as Error).message);
      throw e;
    }
  });

  router.get('/api/v1/workflows/:id/runs', async (ctx) => {
    if (!await workflows.get(ctx.params.id, ctx.principal)) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const limit = boundedPositiveIntegerQuery(ctx.query.get('limit'), 'limit', 100, 50);
    const hasFilters = ['status', 'nodeId', 'type', 'from', 'to', 'error', 'model', 'tool', 'cursor'].some((key) => ctx.query.has(key));
    if (!hasFilters) return engine.queryRuns({ workflowId: ctx.params.id, limit,
      // Workspace admins may inspect every owner in their workspace, but must
      // never see legacy/forged records attached to another workspace.
      ...(ctx.principal.authority !== 'platform' ? { workspaceId: ctx.principal.workspaceId } : {}),
      ...(ctx.principal.authority !== 'platform' && ctx.principal.role !== 'admin' ? { ownerId: ctx.principal.subjectId } : {}),
    });
    return engine.queryRuns({
      workflowId: ctx.params.id, limit,
      status: validateRunStatus(optStr(ctx.query.get('status'))), nodeId: optStr(ctx.query.get('nodeId')),
      type: optStr(ctx.query.get('type')), from: optStr(ctx.query.get('from')), to: optStr(ctx.query.get('to')),
      error: optStr(ctx.query.get('error')), model: optStr(ctx.query.get('model')), tool: optStr(ctx.query.get('tool')),
      cursor: validateRunCursor(ctx.query.get('cursor')),
      ...(ctx.principal.authority !== 'platform' ? { workspaceId: ctx.principal.workspaceId } : {}),
      ...(ctx.principal.authority !== 'platform' && ctx.principal.role !== 'admin' ? { ownerId: ctx.principal.subjectId } : {}),
    });
  });

  router.post('/api/v1/workflows/:id/batches', async (ctx) => {
    const body = requireBody(ctx);
    const rawInputs = body.inputs ?? body.items;
    if (!Array.isArray(rawInputs)) throw new HttpError(400, "'inputs' must be an array");
    const inputs = rawInputs.map((value, index) => {
      if (typeof value === 'string') return { input_as_text: value };
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `inputs[${index}] must be a JSON object or string`);
      return value as import('../domain/types.ts').RunInput;
    });
    const version = boundedPositiveInteger(body.version, 'version', Number.MAX_SAFE_INTEGER);
    const concurrency = body.concurrency === undefined ? undefined : boundedPositiveInteger(body.concurrency, 'concurrency', 10);
    if (!await workflows.get(ctx.params.id, ctx.principal)) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    if (!await workflows.getVersion(ctx.params.id, version, ctx.principal)) throw new HttpError(404, `version ${version} not found`);
    const request = { workflowId: ctx.params.id, version, inputs, concurrency };
    try {
      const result = await idempotent(ctx, `batch:${ctx.params.id}`, request, async () => ({
        batch: publicBatchView(await batches.submit({ workflowId: ctx.params.id, version, inputs, concurrency, requestKeys: parseRequestKeys(ctx) })),
      }));
      return result;
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('not found')) throw new HttpError(404, message);
      if (message.includes('must be') || message.includes('between')) throw new HttpError(400, message);
      throw error;
    }
  });

  router.get('/api/v1/batches', async (ctx) => {
    const workflowId = optStr(ctx.query.get('workflowId'));
    const workflowIds = workflowId
      ? (await workflows.get(workflowId, ctx.principal) ? [workflowId] : (() => { throw new HttpError(404, `workflow '${workflowId}' not found`); })())
      : (ctx.principal.authority === 'platform' ? undefined : (await workflows.list(ctx.principal)).map((workflow) => workflow.id));
    const status = optStr(ctx.query.get('status')) as import('../domain/types.ts').BatchStatus | undefined;
    const validStatuses = new Set(['queued', 'running', 'awaiting_credentials', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_debug', 'cancelling', 'completed', 'cancelled', 'failed']);
    if (status && !validStatuses.has(status)) throw new HttpError(400, "'status' is invalid");
    const limit = boundedPositiveIntegerQuery(ctx.query.get('limit'), 'limit', 100, 50);
    const rawOffset = ctx.query.get('offset');
    if (rawOffset !== null && !/^\d+$/.test(rawOffset)) throw new HttpError(400, "'offset' must be a non-negative integer");
    const offset = rawOffset === null ? 0 : Number(rawOffset);
    if (offset > Number.MAX_SAFE_INTEGER) throw new HttpError(400, "'offset' must be a non-negative integer");
    const listedBatches = await batches.list({ workflowIds, status, limit: limit + 1, offset });
    return { data: listedBatches.slice(0, limit).map(publicBatchView), has_more: listedBatches.length > limit };
  });

  router.get('/api/v1/batches/:id', async (ctx) => {
    const batch = await batches.get(ctx.params.id);
    if (!batch || !await workflows.get(batch.workflowId, ctx.principal)) throw new HttpError(404, `batch '${ctx.params.id}' not found`);
    return { batch: publicBatchView(batch) };
  });

  router.post('/api/v1/batches/:id/cancel', async (ctx) => {
    const existing = await batches.get(ctx.params.id);
    if (!existing || !await workflows.get(existing.workflowId, ctx.principal)) throw new HttpError(404, `batch '${ctx.params.id}' not found`);
    const batch = await batches.cancel(ctx.params.id);
    if (!batch) throw new HttpError(404, `batch '${ctx.params.id}' not found`);
    return { batch: publicBatchView(batch) };
  });

  router.post('/api/v1/batches/:id/resume', async (ctx) => {
    try {
      const existing = await batches.get(ctx.params.id);
      if (!existing || !await workflows.get(existing.workflowId, ctx.principal)) throw new HttpError(404, `batch '${ctx.params.id}' not found`);
      return { batch: publicBatchView(await batches.resume(ctx.params.id, parseRequestKeys(ctx))) };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = (error as Error).message;
      if (message.includes('not found')) throw new HttpError(404, message);
      if (message.includes('not awaiting credentials') || message.includes('credentials required')) throw new HttpError(409, message, 'batch_not_resumable');
      throw error;
    }
  });

  router.get('/api/v1/runs', async (ctx) => {
    const workflowId = optStr(ctx.query.get('workflowId'));
    if (workflowId && !await workflows.get(workflowId, ctx.principal)) throw new HttpError(404, `workflow '${workflowId}' not found`);
    const visibleWorkflowIds = !workflowId && ctx.principal.authority !== 'platform'
      ? (await workflows.list(ctx.principal)).map((workflow) => workflow.id)
      : undefined;
    return engine.queryRuns({
      workflowId, workflowIds: visibleWorkflowIds, status: validateRunStatus(optStr(ctx.query.get('status'))),
      nodeId: optStr(ctx.query.get('nodeId')), type: optStr(ctx.query.get('type')),
      from: optStr(ctx.query.get('from')), to: optStr(ctx.query.get('to')), error: optStr(ctx.query.get('error')),
      model: optStr(ctx.query.get('model')), tool: optStr(ctx.query.get('tool')), cursor: validateRunCursor(ctx.query.get('cursor')),
      limit: boundedPositiveIntegerQuery(ctx.query.get('limit'), 'limit', 100, 50),
      ...(ctx.principal.authority !== 'platform' ? { workspaceId: ctx.principal.workspaceId } : {}),
      ...(ctx.principal.authority !== 'platform' && ctx.principal.role !== 'admin' ? { ownerId: ctx.principal.subjectId } : {}),
    });
  });

  router.post('/api/v1/traces/retention', async (ctx) => {
    const body = requireBody(ctx);
    const maxRuns = body.maxRuns === undefined ? undefined : Number(body.maxRuns);
    const maxAgeDays = body.maxAgeDays === undefined ? undefined : Number(body.maxAgeDays);
    if (maxRuns !== undefined && (!Number.isInteger(maxRuns) || maxRuns < 0 || maxRuns > 100_000)) throw new HttpError(400, 'maxRuns must be an integer between 0 and 100000');
    if (maxAgeDays !== undefined && (!Number.isFinite(maxAgeDays) || maxAgeDays < 0 || maxAgeDays > 36500)) throw new HttpError(400, 'maxAgeDays must be between 0 and 36500');
    return engine.maybeEnforceTraceRetention(body.force !== false, { dryRun: body.dryRun === true, maxRuns, maxAgeDays });
  });

  router.get('/api/v1/traces/retention', async () => engine.traceRetentionStatus());

  // ------------------------------------------------------------------
  // trace evaluation
  // ------------------------------------------------------------------
  router.get('/api/v1/workflows/:id/datasets', async (ctx) => {
    const workflow = await workflows.get(ctx.params.id, ctx.principal);
    if (!workflow) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { datasets: await evaluations.listDatasets(ctx.params.id, ctx.principal) };
  });

  router.post('/api/v1/workflows/:id/datasets', async (ctx) => {
    const workflow = await workflows.get(ctx.params.id, ctx.principal);
    if (!workflow) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const body = requireBody(ctx);
    const testCases = parseEvaluationTestCases(body, 1000);
    if (testCases.length === 0) throw new HttpError(400, 'an evaluation dataset needs at least one test case');
    return evaluations.createDataset({
      workflowId: ctx.params.id,
      name: optStr(body.name) ?? 'Untitled dataset',
      description: optStr(body.description),
      testCases,
    }, ctx.principal);
  });

  router.get('/api/v1/datasets/:id', async (ctx) => {
    const dataset = await evaluations.getDataset(ctx.params.id, ctx.principal);
    if (!dataset) throw new HttpError(404, `evaluation dataset '${ctx.params.id}' not found`);
    return { dataset };
  });

  router.get('/api/v1/datasets/:id/versions', async (ctx) => {
    const dataset = await evaluations.getDataset(ctx.params.id, ctx.principal);
    if (!dataset) throw new HttpError(404, `evaluation dataset '${ctx.params.id}' not found`);
    return { versions: await evaluations.listDatasetVersions(ctx.params.id, ctx.principal) };
  });

  router.post('/api/v1/datasets/:id/versions', async (ctx) => {
    if (!await evaluations.getDataset(ctx.params.id, ctx.principal)) throw new HttpError(404, `evaluation dataset '${ctx.params.id}' not found`);
    const body = requireBody(ctx);
    const testCases = parseEvaluationTestCases(body, 1000);
    if (testCases.length === 0) throw new HttpError(400, 'an evaluation dataset version needs at least one test case');
    return { version: await evaluations.createDatasetVersion(ctx.params.id, testCases, ctx.principal) };
  });

  router.get('/api/v1/datasets/:id/versions/:version', async (ctx) => {
    const versionNumber = Number(ctx.params.version);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new HttpError(400, 'dataset version must be a positive integer');
    const version = await evaluations.getDatasetVersion(ctx.params.id, versionNumber, ctx.principal);
    if (!version) throw new HttpError(404, `evaluation dataset '${ctx.params.id}' has no version ${versionNumber}`);
    return { version };
  });

  router.get('/api/v1/workflows/:id/evaluations', async (ctx) => {
    const wf = await workflows.get(ctx.params.id, ctx.principal);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { evaluations: await evaluations.list(ctx.params.id, ctx.principal) };
  });

  router.post('/api/v1/workflows/:id/evaluations', async (ctx) => {
    const wf = await workflows.get(ctx.params.id, ctx.principal);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const body = requireBody(ctx);
    const graders = parseEvaluationGraders(body);
    await validateEvaluationTargets(workflows, ctx.params.id, graders, ctx.principal);
    const dataset = parseEvaluationDatasetReference(body);
    try {
      return { evaluation: await evaluations.create({
        workflowId: ctx.params.id,
        name: optStr(body.name) ?? 'Untitled evaluation',
        graders,
        testCases: parseEvaluationTestCases(body),
        dataset: dataset.value ?? undefined,
      }, ctx.principal) };
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('evaluation dataset')) throw new HttpError(404, message, 'dataset_not_found');
      throw error;
    }
  });

  router.get('/api/v1/runs/:id', async (ctx) => {
    const run = await engine.getRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, run);
    await authorizeChatRun(ctx, run);
    const publicRun = publicRunView(run);
    return { run: publicRun };
  });

  router.post('/api/v1/runs/:id/replay', async (ctx) => {
    const source = await engine.getRun(ctx.params.id);
    if (!source) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, source);
    await authorizeChatRun(ctx, source);
    try {
      const run = await engine.replayRun(ctx.params.id, {
        ownerId: ctx.principal.subjectId,
        workspaceId: ctx.principal.workspaceId,
        requestKeys: parseRequestKeys(ctx),
        idempotencyKey: optStr(ctx.headers['idempotency-key']),
      });
      return { run: publicRunView(run) };
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('idempotency key was already used')) throw new HttpError(409, message, 'idempotency_conflict');
      if (message.includes('idempotency request is still')) throw new HttpError(409, message, 'idempotency_in_progress');
      if (message.includes('cannot be replayed faithfully')) throw new HttpError(409, message, 'replay_unavailable');
      throw error;
    }
  });

  router.get('/api/v1/evaluations/:id', async (ctx) => {
    const evaluation = await evaluations.get(ctx.params.id, ctx.principal);
    if (!evaluation) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    return { evaluation };
  });

  router.patch('/api/v1/evaluations/:id', async (ctx) => {
    const evaluation = await evaluations.get(ctx.params.id, ctx.principal);
    if (!evaluation) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    const body = requireBody(ctx);
    const parsedGraders = body.graders === undefined ? undefined : parseEvaluationGraders(body);
    if (parsedGraders) await validateEvaluationTargets(workflows, evaluation.workflowId, parsedGraders, ctx.principal);
    const dataset = parseEvaluationDatasetReference(body);
    let updated;
    try {
      updated = await evaluations.update(ctx.params.id, {
        name: optStr(body.name),
        graders: parsedGraders,
        testCases: body.testCases === undefined && body.test_cases === undefined
          ? undefined
          : parseEvaluationTestCases(body),
        ...(dataset.present ? { dataset: dataset.value } : {}),
      }, ctx.principal);
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('evaluation dataset')) throw new HttpError(404, message, 'dataset_not_found');
      throw error;
    }
    return { evaluation: updated };
  });

  router.delete('/api/v1/evaluations/:id', async (ctx) => {
    const ok = await evaluations.remove(ctx.params.id, ctx.principal);
    if (!ok) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    return { ok: true };
  });

  router.post('/api/v1/workflows/:id/duplicate', async (ctx) => {
    const source = await workflows.get(ctx.params.id, ctx.principal);
    if (!source) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const body = (ctx.body ?? {}) as JsonObject;
    return workflows.create({
      name: optStr(body.name) ?? `${source.name} copy`,
      description: source.description,
      graph: source.draft,
    }, ctx.principal);
  });

  router.get('/api/v1/evaluations/:id/runs', async (ctx) => {
    const evaluation = await evaluations.get(ctx.params.id, ctx.principal);
    if (!evaluation) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    const status = optStr(ctx.query.get('status'));
    const validStatuses = ['queued', 'running', 'awaiting_credentials', 'completed', 'failed', 'cancelled'] as const;
    if (status && !(validStatuses as readonly string[]).includes(status)) throw new HttpError(400, "'status' is not a valid evaluation run status");
    const limit = boundedPositiveIntegerQuery(ctx.query.get('limit'), 'limit', 1000, 100);
    const offset = nonNegativeIntegerQuery(ctx.query.get('offset'), 'offset');
    return { runs: await evaluations.listRuns(ctx.params.id, ctx.principal, { limit, offset, status: status as typeof validStatuses[number] | undefined }) };
  });

  router.get('/api/v1/evaluation-runs/:id', async (ctx) => {
    const run = await evaluations.getRun(ctx.params.id, ctx.principal);
    if (!run) throw new HttpError(404, `evaluation run '${ctx.params.id}' not found`);
    return { run };
  });

  router.patch('/api/v1/evaluation-runs/:id/results/:runId/annotation', async (ctx) => {
    const body = requireBody(ctx);
    const rating = optStr(body.rating);
    if (rating !== 'positive' && rating !== 'negative') {
      throw new HttpError(400, "annotation rating must be 'positive' or 'negative'");
    }
    const feedback = optStr(body.feedback);
    if (feedback && feedback.length > 4000) throw new HttpError(400, 'annotation feedback must be at most 4000 characters');
    try {
      const run = await evaluations.annotateResult(ctx.params.id, ctx.params.runId, { rating, feedback }, ctx.principal);
      if (!run) throw new HttpError(404, `evaluation run '${ctx.params.id}' not found`);
      return { run };
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('evaluation result for run')) throw new HttpError(404, message);
      if (error instanceof EvaluationAnnotationStateError) throw new HttpError(409, message, 'evaluation_not_completed');
      throw error;
    }
  });

  router.post('/api/v1/evaluation-runs/:id/cancel', async (ctx) => {
    const run = await evaluations.cancelRun(ctx.params.id, ctx.principal);
    if (!run) throw new HttpError(404, `evaluation run '${ctx.params.id}' not found`);
    return { run };
  });

  router.post('/api/v1/evaluation-runs/:id/resume', async (ctx) => {
    try {
      const run = await evaluations.resumeRun(ctx.params.id, parseRequestKeys(ctx), ctx.principal);
      if (!run) throw new HttpError(404, `evaluation run '${ctx.params.id}' not found`);
      return { run };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof EvaluationCredentialsRequiredError) {
        throw new HttpError(428, error.message, 'credentials_required', { providers: error.providers });
      }
      const message = (error as Error).message;
      if (message.includes('not awaiting credentials')) throw new HttpError(409, message, 'evaluation_not_awaiting_credentials');
      throw error;
    }
  });

  router.post('/api/v1/evaluations/:id/run', async (ctx) => {
    const evaluation = await evaluations.get(ctx.params.id, ctx.principal);
    if (!evaluation) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    const body = (ctx.body ?? {}) as JsonObject;
    const requestedRunIds = body.runIds ?? body.run_ids;
    const runIds = Array.isArray(requestedRunIds)
      ? (requestedRunIds as unknown[]).filter((value): value is string => typeof value === 'string')
      : undefined;
    const filtersBody = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
      ? body.filters as JsonObject
      : body;
    const selection = {
      model: optStr(filtersBody.model),
      tool: optStr(filtersBody.tool),
      from: optStr(filtersBody.from),
      to: optStr(filtersBody.to),
    };
    for (const [name, value] of [['from', selection.from], ['to', selection.to]] as const) {
      if (value && !Number.isFinite(Date.parse(value))) throw new HttpError(400, `${name} must be an ISO-8601 date-time`);
    }
    if (selection.from && selection.to && Date.parse(selection.from) > Date.parse(selection.to)) {
      throw new HttpError(400, 'from must be before or equal to to');
    }
    try {
      return await idempotent(ctx, `evaluation-run:${ctx.params.id}`, { runIds: runIds ?? null, selection }, async () => ({
        run: await evaluations.evaluate(ctx.params.id, runIds, parseRequestKeys(ctx), ctx.principal, selection),
      }));
    } catch (error) {
      if (error instanceof EvaluationSelectionError) {
        throw new HttpError(422, error.message, error.code);
      }
      throw error;
    }
  });

  router.get('/api/v1/runs/:id/trace', async (ctx) => {
    const run = await engine.getRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, run);
    await authorizeChatRun(ctx, run);
    return { events: await engine.pastEvents(ctx.params.id) };
  });

  router.get('/api/v1/runs/:id/trace/export', async (ctx) => {
    const run = await engine.getRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, run);
    await authorizeChatRun(ctx, run);
    const artifact = await engine.portableTraceExport(ctx.params.id);
    if (!artifact) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    return { export: artifact };
  });

  router.get('/api/v1/runs/:id/spans', async (ctx) => {
    const run = await engine.getRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, run);
    await authorizeChatRun(ctx, run);
    const afterRaw = ctx.query.get('after');
    if (afterRaw !== null) {
      // Do not let parseInt accept prefixes such as "12junk". Trace cursors
      // are wire-level sequence numbers and malformed values must fail closed.
      if (!/^\d+$/.test(afterRaw)) throw new HttpError(400, 'span cursor after must be a non-negative integer');
      const after = Number(afterRaw);
      if (!Number.isSafeInteger(after)) throw new HttpError(400, 'span cursor after must be a non-negative integer');
      const page = await engine.incrementalTraceSpans(ctx.params.id, after);
      if (!page) throw new HttpError(404, `run '${ctx.params.id}' not found`);
      return page;
    }
    const spans = await engine.traceSpans(ctx.params.id);
    if (!spans) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    return { spans };
  });

  router.get('/api/v1/runs/:id/compare', async (ctx) => {
    const otherRunId = optStr(ctx.query.get('against') ?? ctx.query.get('other'));
    if (!otherRunId) throw new HttpError(400, 'trace comparison requires an against run id');
    const run = await engine.getRun(ctx.params.id);
    const other = await engine.getRun(otherRunId);
    if (!run || !other) throw new HttpError(404, 'one or both runs were not found');
    await authorizeRunOwnership(ctx, run);
    await authorizeRunOwnership(ctx, other);
    await authorizeChatRun(ctx, run);
    await authorizeChatRun(ctx, other);
    const comparison = await engine.compareRuns(ctx.params.id, otherRunId);
    if (!comparison) throw new HttpError(404, 'one or both runs were not found');
    return { comparison };
  });

  router.get('/api/v1/runs/:id/events', async (ctx) => {
    const run = await engine.getRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, run);
    await authorizeChatRun(ctx, run);
    const rawAfter = ctx.query.get('after');
    if (rawAfter !== null && (!/^\d+$/.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter)))) {
      throw new HttpError(400, 'event cursor after must be a non-negative integer');
    }
    const rawHeader = optStr(ctx.headers['last-event-id']);
    const headerCursor = rawHeader && /^\d+$/.test(rawHeader) && Number.isSafeInteger(Number(rawHeader)) ? Number(rawHeader) : undefined;
    const after = rawAfter === null ? (headerCursor ?? 0) : Number(rawAfter);
    const sse = openSse(ctx);

    // subscribe FIRST so no events are missed between replay and live
    const buffered: Array<{ event: import('../domain/types.ts').RunEvent; seq: number }> = [];
    let replaying = true;
    let terminalSent = false;
    const terminalStatus = (event: import('../domain/types.ts').RunEvent): string | undefined =>
      event.type === 'run.completed' ? 'completed' : event.type === 'run.failed' ? 'failed' : event.type === 'run.cancelled' ? 'cancelled' : undefined;
    const sendTerminal = (status: string) => {
      if (terminalSent || sse.closed) return;
      terminalSent = true;
      sse.send('done', { status });
      sse.close();
    };
    const deliver = (event: import('../domain/types.ts').RunEvent, seq: number) => {
      if (seq <= after || sse.closed) return;
      sse.send(event.type, event, seq);
      const status = terminalStatus(event);
      if (status) sendTerminal(status);
    };
    const unsubscribe = engine.subscribe(ctx.params.id, (event, seq) => {
      if (seq <= after) return;
      if (replaying) buffered.push({ event, seq });
      else deliver(event, seq);
    });
    sse.onClose(unsubscribe);

    let replayedThrough = after;
    if (ctx.query.get('replay') !== 'false') {
      const past = await engine.pastEventRecords(ctx.params.id, after);
      for (const record of past) {
        deliver(record.event, record.seq);
        replayedThrough = Math.max(replayedThrough, record.seq);
        if (sse.closed) break;
      }
    }
    replaying = false;
    buffered.sort((a, b) => a.seq - b.seq);
    for (const { event, seq } of buffered) {
      if (seq > replayedThrough) {
        deliver(event, seq);
        if (sse.closed) break;
      }
    }

    // Close automatically when the run is already settled and not streaming.
    const current = await engine.getRun(ctx.params.id);
    if (!terminalSent &&
      current &&
      (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled')
    ) {
      sendTerminal(current.status);
    }
    return HANDLED;
  });

  router.post('/api/v1/realtime/sessions', async (ctx) => {
    const body = requireBody(ctx);
    const runId = str(body.runId ?? body.run_id, 'runId');
    const run = await engine.getRun(runId);
    if (!run) throw new HttpError(404, `run '${runId}' not found`);
    await authorizeRunOwnership(ctx, run);
    await authorizeChatRun(ctx, run);
    const afterRaw = body.after ?? body.cursor ?? 0;
    const after = Number(afterRaw);
    if (!Number.isInteger(after) || after < 0) throw new HttpError(400, 'after must be a non-negative integer');
    try {
      return { session: realtime.createSession(runId, ctx.principal, {
        after,
        replay: body.replay !== false,
        canControl: governance.allows(ctx.principal, 'run:control'),
        origin: run.sessionId ? chatOrigin(ctx) : undefined,
      }) };
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('capacity')) throw new HttpError(503, message, 'realtime_capacity_exhausted');
      if (message.includes('too many pending')) throw new HttpError(429, message, 'realtime_session_limit');
      throw error;
    }
  });

  router.post('/api/v1/runs/:id/cancel', async (ctx) => {
    const existing = await engine.getRun(ctx.params.id);
    if (!existing) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, existing);
    await authorizeChatRun(ctx, existing);
    return await idempotent(ctx, `run:${ctx.params.id}:cancel`, {}, async () => {
      const run = await engine.cancelRun(ctx.params.id);
      if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
      return { run: publicRunView(run) };
    });
  });

  router.post('/api/v1/runs/:id/approvals/:approvalId', async (ctx) => {
    const body = requireBody(ctx);
    const requestKeys = parseRequestKeys(ctx);
    try {
      const existing = await engine.getRun(ctx.params.id);
      if (!existing) throw new HttpError(404, `run '${ctx.params.id}' not found`);
      await authorizeRunOwnership(ctx, existing);
      await authorizeChatRun(ctx, existing);
      return await idempotent(
        ctx,
        `approval:${ctx.params.id}:${ctx.params.approvalId}`,
        {
          ...(typeof body.approved === 'boolean' ? { approved: body.approved } : {}),
          ...(Object.prototype.hasOwnProperty.call(body, 'result') ? { result: body.result } : {}),
          ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
        },
        async () => {
          const run = await engine.resolveApproval(
            ctx.params.id,
            ctx.params.approvalId,
            {
              ...(typeof body.approved === 'boolean' ? { approved: body.approved } : {}),
              ...(Object.prototype.hasOwnProperty.call(body, 'result') ? { result: body.result as JsonValue } : {}),
              ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
            },
            requestKeys,
            ctx.principal,
          );
          await batches.reconcileRun(run.id, requestKeys);
          return { run: publicRunView(run) };
        },
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      if (msg.includes('not awaiting') || msg.includes('not pending')) throw new HttpError(409, msg);
      throw e;
    }
  });

  // ------------------------------------------------------------------
  // MCP
  // ------------------------------------------------------------------
  router.get('/api/v1/mcp/connectors', () => ({ connectors: MCP_CONNECTOR_CATALOG }));

  router.get('/api/v1/mcp/servers', async (ctx) => {
    const servers = await mcp.list(ctx.principal);
    // never echo auth secrets back
    return {
      servers: servers.map((s) => ({
        ...s,
        auth: { type: s.auth.type },
      })),
    };
  });

  router.post('/api/v1/mcp/servers', async (ctx) => {
    const body = requireBody(ctx);
    const connectorKey = optStr(body.connector);
    const connector = connectorKey ? findConnector(connectorKey) : undefined;

    let auth: import('../domain/types.ts').McpServerRegistration['auth'] = { type: 'none' };
    const authBody = body.auth as JsonObject | undefined;
    const authType = optStr(authBody?.type)?.toLowerCase() ?? optStr(body.authType)?.toLowerCase();
    const token = optStr(authBody?.token) ?? optStr(body.token);
    if (authType === 'bearer' || authType === 'token' || authType === 'access token / api key') {
      if (!token) throw new HttpError(400, 'bearer auth requires a token');
      auth = { type: 'bearer', token };
    } else if (authType === 'basic' || authType === 'basic auth') {
      auth = {
        type: 'basic',
        username: str(authBody?.username ?? body.username, 'auth.username'),
        password: str(authBody?.password ?? body.password, 'auth.password'),
      };
    } else if (authType === 'headers') {
      const headers = (authBody?.headers ?? {}) as Record<string, string>;
      auth = { type: 'headers', headers };
    }

    const server = await mcp.register({
      label: optStr(body.label) ?? (connector ? `${connector.key}_mcp` : 'mcp_server'),
      description: optStr(body.description),
      origin: connector ? connector.tier : 'custom',
      connector: connector?.key,
      url: optStr(body.url) ?? connector?.url,
      command: optStr(body.command),
      args: Array.isArray(body.args) ? (body.args as string[]) : undefined,
      transport: optStr(body.transport) as never,
      auth,
    }, ctx.principal);

    // optionally connect immediately
    if (body.connect !== false) {
      try {
        const connected = await mcp.connect(server.id, ctx.principal);
        return { server: { ...connected, auth: { type: connected.auth.type } } };
      } catch (e) {
        return {
          server: { ...(await mcp.get(server.id, ctx.principal))!, auth: { type: server.auth.type } },
          warning: `registered but connection failed: ${sanitizeMcpError(e)}`,
        };
      }
    }
    return { server: { ...server, auth: { type: server.auth.type } } };
  });

  router.patch('/api/v1/mcp/servers/:id', async (ctx) => {
    const body = requireBody(ctx);
    const server = await mcp.update(ctx.params.id, body as never, ctx.principal);
    if (!server) throw new HttpError(404, `MCP server '${ctx.params.id}' not found`);
    return { server: { ...server, auth: { type: server.auth.type } } };
  });

  router.delete('/api/v1/mcp/servers/:id', async (ctx) => {
    const ok = await mcp.remove(ctx.params.id, ctx.principal);
    if (!ok) throw new HttpError(404, `MCP server '${ctx.params.id}' not found`);
    return { ok: true };
  });

  router.post('/api/v1/mcp/servers/:id/connect', async (ctx) => {
    try {
      const server = await mcp.connect(ctx.params.id, ctx.principal);
      return { server: { ...server, auth: { type: server.auth.type } } };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw new HttpError(502, `connection failed: ${msg}`, 'mcp_connect_failed');
    }
  });

  router.get('/api/v1/mcp/servers/:id/tools', async (ctx) => {
    try {
      const tools = await mcp.listTools(ctx.params.id, ctx.query.get('refresh') === 'true', ctx.principal);
      return { tools };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw new HttpError(502, msg, 'mcp_error');
    }
  });

  router.post('/api/v1/mcp/servers/:id/tools/:tool/call', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const args = (body.arguments ?? {}) as JsonObject;
    try {
      const result = await mcp.callTool(ctx.params.id, ctx.params.tool, args, { access: ctx.principal });
      return { result };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw new HttpError(502, msg, 'mcp_error');
    }
  });

  // ------------------------------------------------------------------
  // vector stores
  // ------------------------------------------------------------------
  router.get('/api/v1/vector-stores', async (ctx) => ({ stores: await vectorStores.listStores(ctx.principal) }));

  router.post('/api/v1/vector-stores', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const keys = parseRequestKeys(ctx) ?? await loadProviderKeys(storage, ctx.principal.workspaceId);
    const store = await vectorStores.createStore(optStr(body.name) ?? 'Untitled store', keys, ctx.principal);
    return { store };
  });

  router.get('/api/v1/vector-stores/:id', async (ctx) => {
    const store = await vectorStores.getStore(ctx.params.id, ctx.principal);
    if (!store) throw new HttpError(404, `vector store '${ctx.params.id}' not found`);
    return { store, files: await vectorStores.listFiles(ctx.params.id, ctx.principal) };
  });

  router.delete('/api/v1/vector-stores/:id', async (ctx) => {
    const ok = await vectorStores.deleteStore(ctx.params.id, ctx.principal);
    if (!ok) throw new HttpError(404, `vector store '${ctx.params.id}' not found`);
    return { ok: true };
  });

  router.get('/api/v1/vector-stores/:id/files', async (ctx) => {
    if (!await vectorStores.getStore(ctx.params.id, ctx.principal)) throw new HttpError(404, `vector store '${ctx.params.id}' not found`);
    return { files: await vectorStores.listFiles(ctx.params.id, ctx.principal) };
  });

  router.get('/api/v1/vector-stores/:id/files/:fileId', async (ctx) => {
    if (!await vectorStores.getStore(ctx.params.id, ctx.principal)) throw new HttpError(404, 'file not found in this store');
    const file = await vectorStores.getFile(ctx.params.id, ctx.params.fileId);
    if (!file) throw new HttpError(404, 'file not found in this store');
    return { file };
  });

  router.post('/api/v1/runs/:id/debug/:mode', async (ctx) => {
    if (ctx.params.mode !== 'continue' && ctx.params.mode !== 'step') throw new HttpError(404, 'unknown debug command');
    const existing = await engine.getRun(ctx.params.id);
    if (!existing) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, existing);
    await authorizeChatRun(ctx, existing);
    try {
      const requestKeys = parseRequestKeys(ctx);
      const run = await engine.resumeDebug(ctx.params.id, ctx.params.mode, requestKeys);
      await batches.reconcileRun(run.id, requestKeys);
      return { run: publicRunView(run) };
    }
    catch (error) { throw new HttpError(409, (error as Error).message, 'debug_not_paused'); }
  });

  router.post('/api/v1/runs/:id/resume', async (ctx) => {
    const existing = await engine.getRun(ctx.params.id);
    if (!existing) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    await authorizeRunOwnership(ctx, existing);
    await authorizeChatRun(ctx, existing);
    try {
      return { run: publicRunView(await engine.resumeRun(ctx.params.id, parseRequestKeys(ctx))) };
    } catch (error) {
      const message = (error as Error).message;
      if ((error as Error).name === 'CredentialsRequiredError') {
        throw new HttpError(428, message, 'credentials_required');
      }
      if (message.includes('not awaiting credentials')) throw new HttpError(409, message);
      throw error;
    }
  });

  router.post('/api/v1/vector-stores/:id/files', async (ctx) => {
    const body = requireBody(ctx);
    const filename = optStr(body.filename) ?? 'untitled.txt';
    let content: string | Buffer | undefined = optStr(body.content);
    const mimeType = optStr(body.mimeType) ?? optStr(body.mime_type);
    const b64 = optStr(body.contentBase64) ?? optStr(body.content_base64);
    if (!content && b64) {
      const normalized = b64.replace(/\s/g, '');
      if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
        throw new HttpError(400, 'contentBase64 is not valid base64');
      }
      content = Buffer.from(normalized, 'base64');
    }
    if (!content) throw new HttpError(400, `provide 'content' (text) or 'contentBase64'`);
    const keys = parseRequestKeys(ctx) ?? await loadProviderKeys(storage, ctx.principal.workspaceId);
    try {
      return await idempotent(
        ctx,
        `vector-upload:${ctx.params.id}`,
        {
          filename,
          mimeType: mimeType ?? null,
          contentHash: createHash('sha256').update(content).digest('hex'),
        },
        async () => ({
          file: await vectorStores.enqueueFile(ctx.params.id, filename, content, keys, mimeType, ctx.principal),
        }),
      );
    } catch (e) {
      const msg = (e as Error).message;
      if ((e as Error).name === 'CredentialsRequiredError') throw new HttpError(428, msg, 'credentials_required');
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw new HttpError(422, msg);
    }
  });

  router.post('/api/v1/vector-stores/:id/files/:fileId/cancel', async (ctx) => {
    const file = await vectorStores.cancelIngestion(ctx.params.id, ctx.params.fileId, ctx.principal);
    if (!file) throw new HttpError(404, 'file not found in this store');
    return { file };
  });

  router.delete('/api/v1/vector-stores/:id/files/:fileId', async (ctx) => {
    const ok = await vectorStores.deleteFile(ctx.params.id, ctx.params.fileId, ctx.principal);
    if (!ok) throw new HttpError(404, 'file not found in this store');
    return { ok: true };
  });

  router.post('/api/v1/vector-stores/:id/search', async (ctx) => {
    const body = requireBody(ctx);
    if (!await vectorStores.getStore(ctx.params.id, ctx.principal)) throw new HttpError(404, `vector store '${ctx.params.id}' not found`);
    const query = str(body.query, 'query');
    const keys = parseRequestKeys(ctx) ?? await loadProviderKeys(storage, ctx.principal.workspaceId);
    const results = await vectorStores.search([ctx.params.id], query, keys, {
      maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
      scoreThreshold: typeof body.scoreThreshold === 'number' ? body.scoreThreshold : undefined,
    }, ctx.principal);
    return { results };
  });

  // ------------------------------------------------------------------
  // durable ChatKit deployments
  // ------------------------------------------------------------------
  router.get('/api/v1/deployments', async (ctx) => ({ deployments: (await deployments.list(ctx.query.get('workflowId') ?? undefined, ctx.principal)).map(publicDeployment) }));
  router.post('/api/v1/deployments', async (ctx) => {
    const body = requireBody(ctx);
    rejectUnsupportedDeploymentBudgetFields(body);
    const workflowId = str(body.workflowId, 'workflowId');
    if (!await workflows.get(workflowId, ctx.principal)) throw new HttpError(404, `workflow '${workflowId}' not found`);
    if (body.activeVersion !== undefined && (!Number.isInteger(Number(body.activeVersion)) || Number(body.activeVersion) < 1)) {
      throw new HttpError(400, 'activeVersion must be a positive integer');
    }
    const environment = str(body.environment, 'environment').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(environment)) throw new HttpError(400, 'environment must start with a letter and contain only letters, numbers, _ or -');
    const allowedOrigins = body.allowedOrigins === undefined ? [] : Array.isArray(body.allowedOrigins) && body.allowedOrigins.every((value) => typeof value === 'string') ? body.allowedOrigins as string[] : (() => { throw new HttpError(400, 'allowedOrigins must be an array of strings'); })();
    const sessionRateLimitPerMinute = boundedPositiveInteger(body.sessionRateLimitPerMinute, 'sessionRateLimitPerMinute', 10_000, 60);
    const maxActiveSessions = boundedPositiveInteger(body.maxActiveSessions, 'maxActiveSessions', 100_000, 1000);
    const maxConcurrentRuns = boundedPositiveInteger(body.maxConcurrentRuns, 'maxConcurrentRuns', 10_000, 8);
    const maxRunsPerMinute = boundedPositiveInteger(body.maxRunsPerMinute, 'maxRunsPerMinute', 100_000, 60);
    const maxRunsPerDay = boundedPositiveInteger(body.maxRunsPerDay, 'maxRunsPerDay', 10_000_000, 10_000);
    const maxTokensPerDay = body.maxTokensPerDay === undefined ? undefined : boundedPositiveInteger(body.maxTokensPerDay, 'maxTokensPerDay', Number.MAX_SAFE_INTEGER);
    const maxEstimatedCostUsdPerDay = body.maxEstimatedCostUsdPerDay === undefined ? undefined : boundedPositiveNumber(body.maxEstimatedCostUsdPerDay, 'maxEstimatedCostUsdPerDay', 1_000_000);
    const unpricedCostPolicy = body.unpricedCostPolicy === undefined ? undefined : body.unpricedCostPolicy === 'deny' ? 'deny' as const : (() => { throw new HttpError(400, "unpricedCostPolicy must be 'deny'"); })();
    for (const origin of allowedOrigins) { try { if (new URL(origin).origin !== origin) throw new Error(); } catch { throw new HttpError(400, `invalid allowed origin '${origin}'`); } }
    const createInput = {
      workflowId,
      ownerId: ctx.principal.subjectId,
      workspaceId: ctx.principal.workspaceId,
      name: optStr(body.name)?.trim() || environment,
      environment,
      ...(body.activeVersion === undefined ? {} : { activeVersion: Number(body.activeVersion) }),
      allowedOrigins: [...new Set(allowedOrigins)],
      sessionRateLimitPerMinute,
      maxActiveSessions,
      maxConcurrentRuns,
      maxRunsPerMinute,
      maxRunsPerDay,
      ...(maxTokensPerDay !== undefined ? { maxTokensPerDay } : {}),
      ...(maxEstimatedCostUsdPerDay !== undefined ? { maxEstimatedCostUsdPerDay } : {}),
      ...(unpricedCostPolicy !== undefined ? { unpricedCostPolicy } : {}),
      status: body.status === 'paused' ? 'paused' as const : 'active' as const,
    };
    try {
      return await idempotent(
        ctx,
        `deployment-create:${workflowId}:${ctx.principal.workspaceId}:${ctx.principal.subjectId}`,
        createInput,
        async () => ({ deployment: publicDeployment(await deployments.create(createInput, ctx.principal.id)) }),
      );
    } catch (error) {
      if (error instanceof DeploymentConflictError) throw new HttpError(409, error.message, 'deployment_conflict');
      if (error instanceof DeploymentBudgetValidationError) throw new HttpError(400, error.message, 'invalid_deployment_budget');
      if (error instanceof DeploymentReleaseValidationError) throw new HttpError(409, error.message, 'deployment_release_blocked');
      if ((error as Error).message.includes('has no published versions')) throw new HttpError(409, (error as Error).message, 'workflow_not_published');
      if ((error as Error).message.includes('no published version')) throw new HttpError(404, (error as Error).message);
      throw error;
    }
  });
  router.get('/api/v1/deployments/:id', async (ctx) => {
    const deployment = await authorizedDeployment(ctx);
    return { deployment: publicDeployment(deployment) };
  });
  router.get('/api/v1/deployments/:id/secrets', async (ctx) => {
    const deployment = await authorizedDeployment(ctx);
    return { secrets: await secrets.list('deployment', deployment.id, ctx.principal) };
  });
  router.post('/api/v1/deployments/:id/secrets', async (ctx) => {
    const deployment = await authorizedDeployment(ctx);
    const body = requireBody(ctx);
    try { return { secret: await secrets.create({ scope: 'deployment', scopeId: deployment.id, workflowId: deployment.workflowId, environment: deployment.environment, ownerId: deployment.ownerId, workspaceId: deployment.workspaceId, name: str(body.name, 'name'), value: str(body.value, 'value'), description: optStr(body.description) }, async () => {
      const current = await deployments.get(deployment.id);
      if (!current || current.status === 'archived') throw new Error('archived deployments cannot accept secrets');
    }) }; }
    catch (error) { return secretError(error); }
  });
  router.patch('/api/v1/deployments/:id/secrets/:secretId', async (ctx) => {
    const deployment = await authorizedDeployment(ctx);
    const body = requireBody(ctx);
    try {
      const secret = await secrets.update('deployment', deployment.id, ctx.params.secretId, Number(body.expectedRevision), { name: optStr(body.name), value: optStr(body.value), description: body.description === null ? null : optStr(body.description) }, ctx.principal);
      if (!secret) throw new HttpError(404, 'secret not found');
      return { secret };
    } catch (error) { if (error instanceof HttpError) throw error; return secretError(error); }
  });
  router.delete('/api/v1/deployments/:id/secrets/:secretId', async (ctx) => {
    const deployment = await authorizedDeployment(ctx);
    try {
      if (!await secrets.remove('deployment', deployment.id, ctx.params.secretId, deleteSecretRevision(ctx), ctx.principal)) throw new HttpError(404, 'secret not found');
      return { ok: true };
    } catch (error) { if (error instanceof HttpError) throw error; return secretError(error); }
  });
  router.get('/api/v1/deployments/:id/usage', async (ctx) => {
    await authorizedDeployment(ctx);
    try { return { usage: await deployments.usage(ctx.params.id) }; }
    catch { throw new HttpError(404, 'deployment not found'); }
  });
  router.get('/api/v1/deployments/:id/releases', async (ctx) => {
    await authorizedDeployment(ctx);
    return { releases: await deployments.listReleases(ctx.params.id) };
  });
  router.get('/api/v1/deployments/:id/release-metrics', async (ctx) => {
    await authorizedDeployment(ctx);
    try { return { metrics: await deployments.releaseMetrics(ctx.params.id) }; }
    catch { throw new HttpError(404, 'deployment not found'); }
  });
  router.patch('/api/v1/deployments/:id', async (ctx) => {
    await authorizedDeployment(ctx);
    const body = requireBody(ctx);
    rejectUnsupportedDeploymentBudgetFields(body);
    if (!Number.isInteger(Number(body.expectedRevision)) || Number(body.expectedRevision) < 1) throw new HttpError(400, 'expectedRevision must be a positive integer');
    if (body.allowedOrigins !== undefined) {
      if (!Array.isArray(body.allowedOrigins) || !body.allowedOrigins.every((value) => typeof value === 'string')) throw new HttpError(400, 'allowedOrigins must be an array of strings');
      for (const origin of body.allowedOrigins as string[]) { try { if (new URL(origin).origin !== origin) throw new Error(); } catch { throw new HttpError(400, `invalid allowed origin '${origin}'`); } }
    }
    const sessionRateLimitPerMinute = body.sessionRateLimitPerMinute === undefined
      ? undefined
      : boundedPositiveInteger(body.sessionRateLimitPerMinute, 'sessionRateLimitPerMinute', 10_000);
    const maxActiveSessions = body.maxActiveSessions === undefined
      ? undefined
      : boundedPositiveInteger(body.maxActiveSessions, 'maxActiveSessions', 100_000);
    const maxConcurrentRuns = body.maxConcurrentRuns === undefined
      ? undefined
      : boundedPositiveInteger(body.maxConcurrentRuns, 'maxConcurrentRuns', 10_000);
    const maxRunsPerMinute = body.maxRunsPerMinute === undefined
      ? undefined
      : boundedPositiveInteger(body.maxRunsPerMinute, 'maxRunsPerMinute', 100_000);
    const maxRunsPerDay = body.maxRunsPerDay === undefined
      ? undefined
      : boundedPositiveInteger(body.maxRunsPerDay, 'maxRunsPerDay', 10_000_000);
    const maxTokensPerDay = body.maxTokensPerDay === undefined ? undefined : body.maxTokensPerDay === null ? null : boundedPositiveInteger(body.maxTokensPerDay, 'maxTokensPerDay', Number.MAX_SAFE_INTEGER);
    const maxEstimatedCostUsdPerDay = body.maxEstimatedCostUsdPerDay === undefined ? undefined : body.maxEstimatedCostUsdPerDay === null ? null : boundedPositiveNumber(body.maxEstimatedCostUsdPerDay, 'maxEstimatedCostUsdPerDay', 1_000_000);
    const unpricedCostPolicy = body.unpricedCostPolicy === undefined ? undefined : body.unpricedCostPolicy === null ? null : body.unpricedCostPolicy === 'deny' ? 'deny' as const : (() => { throw new HttpError(400, "unpricedCostPolicy must be 'deny' or null"); })();
    try {
      return { deployment: publicDeployment(await deployments.update(ctx.params.id, Number(body.expectedRevision), {
        ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}),
        ...(Array.isArray(body.allowedOrigins) ? { allowedOrigins: [...new Set(body.allowedOrigins.filter((value): value is string => typeof value === 'string'))] } : {}),
        ...(sessionRateLimitPerMinute !== undefined ? { sessionRateLimitPerMinute } : {}),
        ...(maxActiveSessions !== undefined ? { maxActiveSessions } : {}),
        ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
        ...(maxRunsPerMinute !== undefined ? { maxRunsPerMinute } : {}),
        ...(maxRunsPerDay !== undefined ? { maxRunsPerDay } : {}),
        ...(maxTokensPerDay !== undefined ? { maxTokensPerDay: maxTokensPerDay ?? undefined } : {}),
        ...(maxEstimatedCostUsdPerDay !== undefined ? { maxEstimatedCostUsdPerDay: maxEstimatedCostUsdPerDay ?? undefined } : {}),
        ...(unpricedCostPolicy !== undefined ? { unpricedCostPolicy: unpricedCostPolicy ?? undefined } : {}),
        ...(body.status === 'active' || body.status === 'paused' ? { status: body.status } : {}),
      })) };
    } catch (error) { if (error instanceof DeploymentConflictError) throw new HttpError(409, error.message, 'deployment_conflict'); if (error instanceof DeploymentBudgetValidationError) throw new HttpError(400, error.message, 'invalid_deployment_budget'); throw error; }
  });
  router.post('/api/v1/deployments/:id/rollout', async (ctx) => {
    await authorizedDeployment(ctx);
    const body = requireBody(ctx);
    if (!Number.isInteger(Number(body.version)) || Number(body.version) < 1) throw new HttpError(400, 'version must be a positive integer');
    if (!Number.isInteger(Number(body.expectedRevision)) || Number(body.expectedRevision) < 1) throw new HttpError(400, 'expectedRevision must be a positive integer');
    try { return await idempotent(ctx, `deployment:${ctx.params.id}:rollout`, body, async () => ({ deployment: publicDeployment(await deployments.rollout(ctx.params.id, Number(body.version), Number(body.expectedRevision), ctx.principal.id)) })); }
    catch (error) { if (error instanceof DeploymentConflictError) throw new HttpError(409, error.message, 'deployment_conflict'); if (error instanceof DeploymentBudgetValidationError) throw new HttpError(400, error.message, 'invalid_deployment_budget'); if (error instanceof DeploymentReleaseValidationError) throw new HttpError(409, error.message, 'deployment_release_blocked'); if ((error as Error).message.includes('no published version')) throw new HttpError(404, (error as Error).message); throw error; }
  });
  router.post('/api/v1/deployments/:id/stage', async (ctx) => {
    await authorizedDeployment(ctx);
    const body = requireBody(ctx);
    if (!Number.isInteger(Number(body.version)) || Number(body.version) < 1) throw new HttpError(400, 'version must be a positive integer');
    if (!Number.isFinite(Number(body.trafficPercent)) || Number(body.trafficPercent) < 0 || Number(body.trafficPercent) > 100) throw new HttpError(400, 'trafficPercent must be between 0 and 100');
    if (!Number.isInteger(Number(body.expectedRevision)) || Number(body.expectedRevision) < 1) throw new HttpError(400, 'expectedRevision must be a positive integer');
    try { return await idempotent(ctx, `deployment:${ctx.params.id}:stage`, body, async () => ({ deployment: publicDeployment(await deployments.stage(ctx.params.id, Number(body.version), Number(body.trafficPercent), Number(body.expectedRevision), ctx.principal.id)) })); }
    catch (error) { if (error instanceof DeploymentConflictError) throw new HttpError(409, error.message, 'deployment_conflict'); if (error instanceof DeploymentBudgetValidationError) throw new HttpError(400, error.message, 'invalid_deployment_budget'); if (error instanceof DeploymentReleaseValidationError) throw new HttpError(409, error.message, 'deployment_release_blocked'); if ((error as Error).message.includes('trafficPercent')) throw new HttpError(400, (error as Error).message); throw error; }
  });
  router.post('/api/v1/deployments/:id/promote', async (ctx) => {
    await authorizedDeployment(ctx);
    const body = requireBody(ctx);
    if (!Number.isInteger(Number(body.expectedRevision)) || Number(body.expectedRevision) < 1) throw new HttpError(400, 'expectedRevision must be a positive integer');
    try { return await idempotent(ctx, `deployment:${ctx.params.id}:promote`, body, async () => ({ deployment: publicDeployment(await deployments.promoteCandidate(ctx.params.id, Number(body.expectedRevision), ctx.principal.id)) })); }
    catch (error) {
      if (error instanceof DeploymentConflictError) throw new HttpError(409, error.message, 'deployment_conflict');
      if (error instanceof DeploymentBudgetValidationError) throw new HttpError(400, error.message, 'invalid_deployment_budget');
      if (error instanceof DeploymentReleaseValidationError) throw new HttpError(409, error.message, 'deployment_release_blocked');
      throw new HttpError(409, (error as Error).message, 'no_staged_release');
    }
  });
  router.post('/api/v1/deployments/:id/cancel-stage', async (ctx) => {
    await authorizedDeployment(ctx);
    const body = requireBody(ctx);
    if (!Number.isInteger(Number(body.expectedRevision)) || Number(body.expectedRevision) < 1) throw new HttpError(400, 'expectedRevision must be a positive integer');
    try { return await idempotent(ctx, `deployment:${ctx.params.id}:cancel-stage`, body, async () => ({ deployment: publicDeployment(await deployments.cancelCandidate(ctx.params.id, Number(body.expectedRevision))) })); }
    catch (error) { if (error instanceof DeploymentConflictError) throw new HttpError(409, error.message, 'deployment_conflict'); if (error instanceof DeploymentBudgetValidationError) throw new HttpError(400, error.message, 'invalid_deployment_budget'); throw error; }
  });
  router.post('/api/v1/deployments/:id/rollback', async (ctx) => {
    const body = requireBody(ctx);
    if (!Number.isInteger(Number(body.expectedRevision)) || Number(body.expectedRevision) < 1) throw new HttpError(400, 'expectedRevision must be a positive integer');
    const current = await authorizedDeployment(ctx);
    try {
      if (body.version !== undefined) {
        const target = (await deployments.listReleases(ctx.params.id)).find((release) => release.kind !== 'staged' && release.workflowVersion === Number(body.version));
        if (!target) throw new HttpError(404, 'deployment release not found');
        return await idempotent(ctx, `deployment:${ctx.params.id}:rollback`, body, async () => ({ deployment: publicDeployment(await deployments.rollout(ctx.params.id, target.workflowVersion, Number(body.expectedRevision), ctx.principal.id, 'rollback', target.id)) }));
      }
      return await idempotent(ctx, `deployment:${ctx.params.id}:rollback`, body, async () => ({ deployment: publicDeployment(await deployments.rollback(ctx.params.id, Number(body.expectedRevision), ctx.principal.id, optStr(body.releaseId))) }));
    }
    catch (error) { if (error instanceof DeploymentConflictError) throw new HttpError(409, error.message, 'deployment_conflict'); if (error instanceof DeploymentBudgetValidationError) throw new HttpError(400, error.message, 'invalid_deployment_budget'); if (error instanceof DeploymentReleaseValidationError) throw new HttpError(409, error.message, 'deployment_release_blocked'); throw error; }
  });
  router.delete('/api/v1/deployments/:id', async (ctx) => {
    await authorizedDeployment(ctx);
    try {
      if (!await deployments.remove(ctx.params.id)) throw new HttpError(404, 'deployment not found');
      await secrets.removeScope('deployment', ctx.params.id);
    }
    catch (error) { if (error instanceof DeploymentConflictError) throw new HttpError(409, error.message, 'deployment_conflict'); throw error; }
    return { deleted: true };
  });

  // ------------------------------------------------------------------
  // chat sessions (ChatKit-style)
  // ------------------------------------------------------------------
  router.post('/api/v1/chatkit/sessions', async (ctx) => {
    const body = requireBody(ctx);
    const wf = (body.workflow ?? {}) as JsonObject;
    const workflowId = str(wf.id ?? body.workflowId, 'workflow.id');
    try {
      const session = await chat.createSession({
        workflowId,
        version: typeof wf.version === 'number' ? wf.version : undefined,
        user: optStr(body.user) ?? 'anonymous',
        stateVariables: (wf.state_variables ?? wf.stateVariables ?? undefined) as JsonObject | undefined,
        expiresAfterSeconds:
          typeof body.expires_after === 'number' ? body.expires_after : undefined,
        deploymentId: optStr(body.deployment_id ?? body.deploymentId),
        environment: optStr(body.environment),
        origin: optStr(ctx.headers.origin),
        cohortKey: optStr(body.cohort_key ?? body.cohortKey ?? ctx.headers['x-deployment-cohort-key'] ?? ctx.headers['x-chatkit-cohort-key']),
      });
      return {
        session: {
          id: session.id,
          workflowId: session.workflowId,
          workflowVersion: session.workflowVersion,
          deploymentId: session.deploymentId,
          deploymentReleaseId: session.deploymentReleaseId,
          deploymentRevision: session.deploymentRevision,
          deployment: session.deployment,
          user: session.user,
          status: session.status,
          expiresAt: session.expiresAt,
        },
        client_secret: session.clientSecret,
        expires_at: session.expiresAt,
      };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found') || msg.includes('has no published version ')) throw new HttpError(404, msg);
      if (msg.includes('has no published versions')) throw new HttpError(409, msg, 'workflow_not_published');
      if (msg.includes('workflow version must')) throw new HttpError(400, msg);
      if (msg.includes('origin') && msg.includes('not allowed')) throw new HttpError(403, msg, 'origin_not_allowed');
      if (msg.includes('session limit') || msg.includes('rate limit')) throw new HttpError(429, msg, 'deployment_limit_exceeded');
      if (msg.includes('paused') || msg.includes('archived')) throw new HttpError(409, msg, 'deployment_unavailable');
      if (msg === 'deployment not found') throw new HttpError(404, msg);
      throw e;
    }
  });

  router.get('/api/v1/chatkit/sessions/:id', async (ctx) => {
    // Status/observability reads must remain available after cancellation or
    // expiry. Authenticate the owner first, then return the terminal state;
    // using requireActiveSession here turned a valid session into a misleading
    // 404 as soon as it stopped accepting turns.
    const session = await chat.getSession(ctx.params.id);
    if (!session) throw new HttpError(404, `session '${ctx.params.id}' not found`);
    let authenticated;
    try { authenticated = await chat.authenticateSessionOwner(session.id, chatSecret(ctx), chatOrigin(ctx)); }
    catch (error) { throw chatAccessError(error) ?? error; }
    if (!authenticated) throw new HttpError(404, `session '${ctx.params.id}' not found`);
    return { session: publicChatSession(authenticated) };
  });

  router.post('/api/v1/chatkit/sessions/:id/cancel', async (ctx) => {
    try {
      const session = await chat.cancelSession(ctx.params.id, chatSecret(ctx), chatOrigin(ctx));
      if (!session) throw new HttpError(404, `session '${ctx.params.id}' not found`);
      return { session: publicChatSession(session) };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof DraftRevisionConflictError) throw revisionConflict(e);
      const mapped = chatAccessError(e);
      if (mapped) throw mapped;
      throw e;
    }
  });

  router.post('/api/v1/chatkit/sessions/:id/threads', async (ctx) => {
    try {
      return { thread: await chat.createThread(ctx.params.id, chatSecret(ctx), chatOrigin(ctx)) };
    } catch (e) {
      const msg = (e as Error).message;
      const mapped = chatAccessError(e);
      if (mapped) throw mapped;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw e;
    }
  });

  router.get('/api/v1/chatkit/sessions/:id/threads', async (ctx) => {
    try {
      return { threads: await chat.listThreads(ctx.params.id, chatSecret(ctx), chatOrigin(ctx)) };
    } catch (e) {
      const msg = (e as Error).message;
      const mapped = chatAccessError(e);
      if (mapped) throw mapped;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw e;
    }
  });

  router.post('/api/v1/chatkit/sessions/:id/rotate', async (ctx) => {
    try {
      const rotated = await chat.rotateSessionSecret(ctx.params.id, chatSecret(ctx), chatOrigin(ctx));
      if (!rotated) throw new HttpError(404, `session '${ctx.params.id}' not found`);
      return { session: publicChatSession(rotated.session), client_secret: rotated.clientSecret, expires_at: rotated.session.expiresAt };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const mapped = chatAccessError(error);
      if (mapped) throw mapped;
      throw error;
    }
  });

  router.get('/api/v1/chatkit/threads/:threadId', async (ctx) => {
    let thread;
    try {
      thread = await chat.getThreadAuthorized(ctx.params.threadId, chatSecret(ctx), chatOrigin(ctx));
    } catch (e) {
      const mapped = chatAccessError(e);
      if (mapped) throw mapped;
      throw e;
    }
    if (!thread) throw new HttpError(404, `thread '${ctx.params.threadId}' not found`);
    return { thread };
  });

  router.post('/api/v1/chatkit/threads/:threadId/messages', async (ctx) => {
    const body = requireBody(ctx);
    const attachments = normalizeChatAttachments(body.attachments);
    const text = optStr(body.text ?? body.message) ?? '';
    if (!text.trim() && attachments.length === 0) throw new HttpError(400, "'text' must be non-empty when no attachments are provided");
    const requestKeys = parseRequestKeys(ctx);
    try {
      const { thread, run } = await chat.sendMessage(
        ctx.params.threadId,
        text,
        requestKeys,
        chatSecret(ctx),
        optStr(ctx.headers['idempotency-key']),
        chatOrigin(ctx),
        attachments,
      );
      const publicRun = publicRunView(run);
      return { thread, run: publicRun };
    } catch (e) {
      const msg = (e as Error).message;
      const mapped = chatAccessError(e);
      if (mapped) throw mapped;
      if (e instanceof DeploymentBudgetValidationError) throw new HttpError(422, msg, 'invalid_deployment_budget');
      if (msg.includes('not found')) throw new HttpError(404, msg);
      if (msg.includes('idempotency key was already used')) throw new HttpError(409, msg, 'idempotency_conflict');
      if (msg.includes('idempotency request is still')) throw new HttpError(409, msg, 'idempotency_in_progress');
      if (msg.includes('deployment') && msg.includes('run') && msg.includes('limit exceeded')) throw new HttpError(429, msg, 'deployment_limit_exceeded');
      if (msg.includes('still in progress')) throw new HttpError(409, msg, 'turn_in_progress');
      if (msg.includes('invalid')) throw new HttpError(422, msg);
      throw e;
    }
  });
}

export type { Workflow };
