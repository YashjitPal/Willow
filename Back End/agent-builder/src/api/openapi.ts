import type { JsonObject } from '../domain/types.ts';
import type { RouteDescription } from '../http/router.ts';

const STREAMING_ROUTES = new Set([
  'GET /api/v1/runs/:id/events',
  'GET /api/v1/workflows/:id/collaboration/events',
]);
const IDEMPOTENT_ROUTES = new Set([
  'POST /api/v1/workflows/:id/publish',
  'POST /api/v1/workflows/:id/runs',
  'POST /api/v1/runs/:id/replay',
  'POST /api/v1/workflows/:id/batches',
  'POST /api/v1/evaluations/:id/run',
  'POST /api/v1/runs/:id/approvals/:approvalId',
  'POST /api/v1/vector-stores/:id/files',
  'POST /api/v1/chatkit/threads/:threadId/messages',
  'POST /api/v1/deployments',
  'POST /api/v1/runs/:id/cancel',
  'POST /api/v1/deployments/:id/rollout',
  'POST /api/v1/deployments/:id/stage',
  'POST /api/v1/deployments/:id/promote',
  'POST /api/v1/deployments/:id/cancel-stage',
  'POST /api/v1/deployments/:id/rollback',
]);
const PROVIDER_KEY_ROUTES = new Set([
  'GET /api/v1/models',
  'POST /api/v1/workflows/:id/runs',
  'POST /api/v1/runs/:id/replay',
  'POST /api/v1/workflows/:id/batches',
  'POST /api/v1/batches/:id/resume',
  'POST /api/v1/evaluation-runs/:id/resume',
  'POST /api/v1/evaluations/:id/run',
  'POST /api/v1/runs/:id/approvals/:approvalId',
  'POST /api/v1/runs/:id/debug/:mode',
  'POST /api/v1/runs/:id/resume',
  'POST /api/v1/vector-stores',
  'POST /api/v1/vector-stores/:id/files',
  'POST /api/v1/vector-stores/:id/search',
  'POST /api/v1/chatkit/threads/:threadId/messages',
]);
const CHAT_SECRET_ROUTES = new Set([
  'GET /api/v1/runs/:id',
  'GET /api/v1/runs/:id/trace',
  'GET /api/v1/runs/:id/trace/export',
  'GET /api/v1/runs/:id/spans',
  'GET /api/v1/runs/:id/compare',
  'GET /api/v1/runs/:id/events',
  'POST /api/v1/realtime/sessions',
  'POST /api/v1/runs/:id/cancel',
  'POST /api/v1/runs/:id/replay',
  'POST /api/v1/runs/:id/approvals/:approvalId',
  'POST /api/v1/runs/:id/debug/:mode',
  'POST /api/v1/runs/:id/resume',
  'GET /api/v1/chatkit/sessions/:id',
  'POST /api/v1/chatkit/sessions/:id/cancel',
  'POST /api/v1/chatkit/sessions/:id/threads',
  'GET /api/v1/chatkit/sessions/:id/threads',
  'POST /api/v1/chatkit/sessions/:id/rotate',
  'GET /api/v1/chatkit/threads/:threadId',
  'POST /api/v1/chatkit/threads/:threadId/messages',
]);

function openApiPath(pattern: string): string {
  return pattern.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function operationId(method: string, pattern: string): string {
  const words = pattern
    .replace(/^\/api\/v1\/?/, '')
    .split('/')
    .filter(Boolean)
    .flatMap((segment) => segment.startsWith(':') ? ['by', segment.slice(1)] : segment.split(/[^A-Za-z0-9]+/))
    .filter(Boolean);
  return method.toLowerCase() + words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
}

function tagFor(pattern: string): string {
  return pattern.replace(/^\/api\/v1\/?/, '').split('/')[0] || 'system';
}

function pathParameters(pattern: string): JsonObject[] {
  return [...pattern.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string', minLength: 1 },
  }));
}

function headerParameters(method: string, pattern: string): JsonObject[] {
  const route = `${method} ${pattern}`;
  const refs: JsonObject[] = [];
  if (PROVIDER_KEY_ROUTES.has(route)) refs.push({ $ref: '#/components/parameters/ProviderKeys' });
  if (IDEMPOTENT_ROUTES.has(route)) refs.push({ $ref: '#/components/parameters/IdempotencyKey' });
  if (CHAT_SECRET_ROUTES.has(route)) refs.push({ $ref: '#/components/parameters/ChatKitClientSecret' });
  return refs;
}

const REQUEST_SCHEMAS: Record<string, string> = {
  'POST /api/v1/runs/:id/approvals/:approvalId': 'ApprovalResolutionRequest',
  'POST /api/v1/evaluations/:id/run': 'EvaluationRunRequest',
  'POST /api/v1/deployments': 'DeploymentCreateRequest',
  'PATCH /api/v1/deployments/:id': 'DeploymentUpdateRequest',
  'POST /api/v1/deployments/:id/rollout': 'DeploymentRolloutRequest',
  'POST /api/v1/deployments/:id/stage': 'DeploymentStageRequest',
  'POST /api/v1/deployments/:id/promote': 'ExpectedRevisionRequest',
  'POST /api/v1/deployments/:id/cancel-stage': 'ExpectedRevisionRequest',
  'POST /api/v1/deployments/:id/rollback': 'DeploymentRollbackRequest',
  'POST /api/v1/workflows/:id/secrets': 'SecretCreateRequest',
  'PATCH /api/v1/workflows/:id/secrets/:secretId': 'SecretUpdateRequest',
  'POST /api/v1/deployments/:id/secrets': 'SecretCreateRequest',
  'PATCH /api/v1/deployments/:id/secrets/:secretId': 'SecretUpdateRequest',
};

const RESPONSE_SCHEMAS: Record<string, string> = {
  'GET /api/v1/runs/:id': 'RunEnvelope',
  'POST /api/v1/runs/:id/replay': 'RunEnvelope',
  'POST /api/v1/runs/:id/cancel': 'RunEnvelope',
  'POST /api/v1/runs/:id/approvals/:approvalId': 'RunEnvelope',
  'GET /api/v1/runs/:id/trace': 'TraceEventsEnvelope',
  'GET /api/v1/runs/:id/spans': 'TraceSpansResponse',
  'GET /api/v1/runs/:id/compare': 'TraceComparisonEnvelope',
  'POST /api/v1/evaluations/:id/run': 'EvaluationRunEnvelope',
  'GET /api/v1/evaluation-runs/:id': 'EvaluationRunEnvelope',
  'GET /api/v1/evaluations/:id': 'EvaluationDefinitionEnvelope',
  'POST /api/v1/workflows/:id/evaluations': 'EvaluationDefinitionEnvelope',
  'PATCH /api/v1/evaluations/:id': 'EvaluationDefinitionEnvelope',
  'GET /api/v1/deployments/:id': 'DeploymentEnvelope',
  'POST /api/v1/deployments': 'DeploymentEnvelope',
  'PATCH /api/v1/deployments/:id': 'DeploymentEnvelope',
  'POST /api/v1/deployments/:id/rollout': 'DeploymentEnvelope',
  'POST /api/v1/deployments/:id/stage': 'DeploymentEnvelope',
  'POST /api/v1/deployments/:id/promote': 'DeploymentEnvelope',
  'POST /api/v1/deployments/:id/cancel-stage': 'DeploymentEnvelope',
  'POST /api/v1/deployments/:id/rollback': 'DeploymentEnvelope',
  'GET /api/v1/deployments/:id/usage': 'DeploymentUsageEnvelope',
  'GET /api/v1/workflows/:id/secrets': 'SecretsEnvelope',
  'POST /api/v1/workflows/:id/secrets': 'SecretEnvelope',
  'PATCH /api/v1/workflows/:id/secrets/:secretId': 'SecretEnvelope',
  'GET /api/v1/deployments/:id/secrets': 'SecretsEnvelope',
  'POST /api/v1/deployments/:id/secrets': 'SecretEnvelope',
  'PATCH /api/v1/deployments/:id/secrets/:secretId': 'SecretEnvelope',
};

function queryParameters(method: string, pattern: string): JsonObject[] {
  const route = `${method} ${pattern}`;
  if (route === 'GET /api/v1/runs' || route === 'GET /api/v1/workflows/:id/runs') {
    const parameters: JsonObject[] = [
      { name: 'workflowId', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
      { name: 'status', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
      { name: 'nodeId', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
      { name: 'type', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
      { name: 'from', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
      { name: 'to', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
      { name: 'error', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
      { name: 'model', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
      { name: 'tool', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
    ];
    // The collection endpoint accepts workflowId; the scoped endpoint already
    // receives it as a path parameter but uses the same filter shape otherwise.
    return route === 'GET /api/v1/workflows/:id/runs'
      ? parameters.filter((parameter) => parameter.name !== 'workflowId')
      : parameters;
  }
  if (route === 'GET /api/v1/runs/:id/spans') return [{ name: 'after', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } }];
  if (route === 'GET /api/v1/runs/:id/compare') return [{ name: 'against', in: 'query', required: true, schema: { type: 'string', minLength: 1 } }];
  if (route === 'DELETE /api/v1/workflows/:id/secrets/:secretId' || route === 'DELETE /api/v1/deployments/:id/secrets/:secretId') {
    return [{ name: 'expectedRevision', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }];
  }
  if (route === 'DELETE /api/v1/workflows/:id/comments/:threadId') {
    return [{ name: 'expectedRevision', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }];
  }
  return [];
}

function ref(name: string): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}

export function createOpenApiDocument(routes: RouteDescription[]): JsonObject {
  const paths: JsonObject = {};
  const tags = new Set<string>();
  for (const route of routes) {
    const path = openApiPath(route.pattern);
    const method = route.method.toLowerCase();
    const tag = tagFor(route.pattern);
    const streaming = STREAMING_ROUTES.has(`${route.method} ${route.pattern}`);
    tags.add(tag);
    const operation: JsonObject = {
      operationId: operationId(route.method, route.pattern),
      tags: [tag],
      summary: `${route.method} ${route.pattern}`,
      parameters: [...pathParameters(route.pattern), ...queryParameters(route.method, route.pattern), ...headerParameters(route.method, route.pattern)],
      responses: {
        '200': {
          description: streaming ? 'Server-sent event stream' : 'Successful response',
          content: streaming
            ? { 'text/event-stream': { schema: { type: 'string' } } }
            : { 'application/json': { schema: ref(RESPONSE_SCHEMAS[`${route.method} ${route.pattern}`] ?? 'JsonValue') } },
        },
        default: {
          description: 'Error response',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        },
      },
      'x-willow-route-pattern': route.pattern,
    };
    if (!['get', 'delete'].includes(method)) {
      operation.requestBody = {
        required: REQUEST_SCHEMAS[`${route.method} ${route.pattern}`] !== undefined,
        content: { 'application/json': { schema: ref(REQUEST_SCHEMAS[`${route.method} ${route.pattern}`] ?? 'JsonObject') } },
      };
    }
    const pathItem = (paths[path] ?? {}) as JsonObject;
    pathItem[method] = operation;
    paths[path] = pathItem;
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Willow Agent Builder API',
      version: '0.1.0',
      description: 'Generated from the live Agent Builder router. Every registered REST operation is represented.',
    },
    servers: [{ url: '/' }],
    tags: [...tags].sort().map((name) => ({ name })),
    security: [{ bearerAuth: [] }],
    'x-willow-websockets': {
      '/api/v1/realtime': {
        summary: 'Durable run event stream and control channel',
        sessionGrantOperationId: 'postRealtimeSessions',
        subprotocols: ['willow.realtime.v1', 'willow.session.{sessionId}.{secret}'],
        clientMessages: ['ping', 'run.cancel', 'approval.resolve'],
        serverMessages: ['session.created', 'run.snapshot', 'run.event', 'pong', 'session.completed', 'command.completed', 'command.error', 'error'],
      },
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      parameters: {
        ProviderKeys: {
          name: 'x-provider-keys',
          in: 'header',
          required: false,
          description: 'Per-request provider credentials encoded as a JSON object.',
          schema: { type: 'string' },
        },
        IdempotencyKey: {
          name: 'idempotency-key',
          in: 'header',
          required: false,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
        ChatKitClientSecret: {
          name: 'x-chatkit-client-secret',
          in: 'header',
          required: false,
          schema: { type: 'string', minLength: 1 },
        },
      },
      schemas: {
        JsonValue: {},
        JsonObject: { type: 'object', additionalProperties: true },
        RunUsage: {
          type: 'object',
          required: ['inputTokens', 'outputTokens', 'llmCalls', 'toolCalls', 'estimatedCostUsd', 'unpricedLlmCalls', 'embeddingInputTokens', 'embeddingOperations', 'unpricedEmbeddingOperations', 'pricingCatalogVersion', 'byModel', 'byEmbeddingModel'],
          properties: {
            inputTokens: { type: 'integer', minimum: 0 }, outputTokens: { type: 'integer', minimum: 0 },
            llmCalls: { type: 'integer', minimum: 0 }, toolCalls: { type: 'integer', minimum: 0 },
            estimatedCostUsd: { type: 'number', minimum: 0 }, unpricedLlmCalls: { type: 'integer', minimum: 0 },
            embeddingInputTokens: { type: 'integer', minimum: 0 }, embeddingOperations: { type: 'integer', minimum: 0 },
            unpricedEmbeddingOperations: { type: 'integer', minimum: 0 }, pricingCatalogVersion: { type: 'string' },
            byModel: { type: 'object', additionalProperties: true }, byEmbeddingModel: { type: 'object', additionalProperties: true },
          },
          additionalProperties: false,
        },
        Run: {
          type: 'object', required: ['id', 'workflowId', 'workflowVersion', 'status', 'input'],
          properties: { id: { type: 'string' }, workflowId: { type: 'string' }, workflowVersion: { type: 'integer', minimum: 0 }, status: { enum: ['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug', 'completed', 'failed', 'cancelled'] }, input: ref('JsonObject'), output: ref('JsonValue'), error: { type: 'string' }, usage: ref('RunUsage'), createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } },
          additionalProperties: true,
        },
        RunEnvelope: { type: 'object', required: ['run'], properties: { run: ref('Run') }, additionalProperties: false },
        ApprovalResolutionRequest: {
          description: 'Resolve a human approval with approved, or a client-tool pause with exactly one of result or an explicit rejection.',
          oneOf: [
            { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' }, reason: { type: 'string' } }, additionalProperties: false },
            { type: 'object', required: ['result'], properties: { result: ref('JsonValue') }, additionalProperties: false },
          ],
        },
        TraceEvent: { type: 'object', required: ['type'], properties: { type: { type: 'string' }, runId: { type: 'string' }, nodeId: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' }, data: ref('JsonObject') }, additionalProperties: true },
        TraceSpan: { type: 'object', required: ['id', 'runId', 'type', 'name', 'startedAt', 'status'], properties: { id: { type: 'string' }, runId: { type: 'string' }, parentId: { type: 'string' }, type: { enum: ['node', 'llm', 'tool', 'guardrail', 'approval', 'state', 'subflow', 'run'] }, name: { type: 'string' }, nodeId: { type: 'string' }, occurrence: { type: 'integer', minimum: 1 }, startedAt: { type: 'string', format: 'date-time' }, endedAt: { type: 'string', format: 'date-time' }, status: { enum: ['running', 'ok', 'error', 'cancelled'] }, data: ref('JsonObject') }, additionalProperties: false },
        TraceEventsEnvelope: { type: 'object', required: ['events'], properties: { events: { type: 'array', items: ref('TraceEvent') } }, additionalProperties: false },
        TraceSpansResponse: { type: 'object', required: ['spans'], properties: { spans: { type: 'array', items: ref('TraceSpan') }, cursor: { type: 'integer', minimum: 0 } }, additionalProperties: false },
        TraceComparisonEnvelope: { type: 'object', required: ['comparison'], properties: { comparison: { type: 'object', additionalProperties: true } }, additionalProperties: false },
        EvaluationRunSelection: { type: 'object', properties: { model: { type: 'string', minLength: 1 }, tool: { type: 'string', minLength: 1 }, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } }, additionalProperties: false },
        EvaluationGrader: { type: 'object', required: ['id', 'name', 'type'], properties: { id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, type: { enum: ['contains', 'equals', 'regex', 'run_status', 'event_count', 'model_judge', 'label_model_judge'] }, target: { enum: ['output', 'error'] }, nodeId: { type: 'string' }, spanType: { enum: ['run', 'node', 'llm', 'tool', 'guardrail', 'approval', 'state', 'subflow'] }, occurrence: { type: 'integer', minimum: 0 }, field: { enum: ['output', 'status', 'error', 'duration', 'usage', 'arguments', 'result', 'toolCalls'] }, expected: ref('JsonValue'), reference: { enum: ['test_case_expected'] }, eventType: { type: 'string' }, model: { type: 'string' }, rubric: { type: 'string' }, labels: { type: 'array', minItems: 2, uniqueItems: true, items: { type: 'string', minLength: 1 } }, passingLabels: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } }, threshold: { type: 'number', minimum: 0, maximum: 1 }, weight: { type: 'number', exclusiveMinimum: 0 } }, additionalProperties: false },
        EvaluationDefinition: { type: 'object', required: ['id', 'workflowId', 'name', 'graders', 'testCases', 'createdAt', 'updatedAt'], properties: { id: { type: 'string' }, workflowId: { type: 'string' }, name: { type: 'string' }, graders: { type: 'array', minItems: 1, items: ref('EvaluationGrader') }, testCases: { type: 'array', items: { type: 'object', additionalProperties: true } }, datasetId: { type: 'string' }, datasetVersion: { type: 'integer', minimum: 1 }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } }, additionalProperties: true },
        EvaluationDefinitionEnvelope: { type: 'object', required: ['evaluation'], properties: { evaluation: ref('EvaluationDefinition') }, additionalProperties: false },
        EvaluationRunRequest: { type: 'object', properties: { runIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true }, filters: ref('EvaluationRunSelection') }, additionalProperties: false },
        EvaluationUsage: { type: 'object', required: ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningTokens', 'modelCalls', 'estimatedCostUsd', 'unpricedLlmCalls', 'unpricedModelCalls', 'pricingCatalogVersion', 'byModel'], properties: { inputTokens: { type: 'integer', minimum: 0 }, outputTokens: { type: 'integer', minimum: 0 }, cachedInputTokens: { type: 'integer', minimum: 0 }, cacheWriteInputTokens: { type: 'integer', minimum: 0 }, reasoningTokens: { type: 'integer', minimum: 0 }, modelCalls: { type: 'integer', minimum: 0 }, estimatedCostUsd: { type: 'number', minimum: 0 }, unpricedLlmCalls: { type: 'integer', minimum: 0 }, unpricedModelCalls: { type: 'integer', minimum: 0 }, pricingCatalogVersion: { type: 'string' }, byModel: { type: 'object', additionalProperties: true } }, additionalProperties: true },
        EvaluationRun: { type: 'object', required: ['id', 'evaluationId', 'workflowId', 'status', 'runIds', 'totalRuns', 'completedRuns', 'score', 'results', 'usage', 'createdAt'], properties: { id: { type: 'string' }, evaluationId: { type: 'string' }, workflowId: { type: 'string' }, status: { enum: ['queued', 'running', 'awaiting_credentials', 'completed', 'failed', 'cancelled'] }, runIds: { type: 'array', items: { type: 'string' } }, selection: ref('EvaluationRunSelection'), totalRuns: { type: 'integer', minimum: 0 }, completedRuns: { type: 'integer', minimum: 0 }, score: { type: 'number', minimum: 0, maximum: 1 }, results: { type: 'array', items: { type: 'object', additionalProperties: true } }, usage: ref('EvaluationUsage'), createdAt: { type: 'string', format: 'date-time' } }, additionalProperties: true },
        EvaluationRunEnvelope: { type: 'object', required: ['run'], properties: { run: ref('EvaluationRun') }, additionalProperties: false },
        DeploymentBudgetProperties: { type: 'object', properties: { maxTokensPerDay: { type: 'integer', minimum: 1 }, maxEstimatedCostUsdPerDay: { type: 'number', exclusiveMinimum: 0 }, unpricedCostPolicy: { const: 'deny' } } },
        DeploymentCreateRequest: { type: 'object', required: ['workflowId', 'environment'], properties: { workflowId: { type: 'string', minLength: 1 }, name: { type: 'string' }, environment: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,31}$' }, activeVersion: { type: 'integer', minimum: 1, description: 'Published workflow version to pin. Defaults to the latest published version.' }, allowedOrigins: { type: 'array', items: { type: 'string', format: 'uri' }, uniqueItems: true }, maxTokensPerDay: { type: 'integer', minimum: 1 }, maxEstimatedCostUsdPerDay: { type: 'number', exclusiveMinimum: 0 }, unpricedCostPolicy: { const: 'deny' } }, additionalProperties: true },
        DeploymentUpdateRequest: { type: 'object', required: ['expectedRevision'], properties: { expectedRevision: { type: 'integer', minimum: 1 }, maxTokensPerDay: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] }, maxEstimatedCostUsdPerDay: { anyOf: [{ type: 'number', exclusiveMinimum: 0 }, { type: 'null' }] }, unpricedCostPolicy: { anyOf: [{ const: 'deny' }, { type: 'null' }] } }, additionalProperties: true },
        ExpectedRevisionRequest: { type: 'object', required: ['expectedRevision'], properties: { expectedRevision: { type: 'integer', minimum: 1 } }, additionalProperties: false },
        DeploymentRolloutRequest: { type: 'object', required: ['version', 'expectedRevision'], properties: { version: { type: 'integer', minimum: 1 }, expectedRevision: { type: 'integer', minimum: 1 } }, additionalProperties: false },
        DeploymentStageRequest: { type: 'object', required: ['version', 'trafficPercent', 'expectedRevision'], properties: { version: { type: 'integer', minimum: 1 }, trafficPercent: { type: 'number', minimum: 0, maximum: 100 }, expectedRevision: { type: 'integer', minimum: 1 } }, additionalProperties: false },
        DeploymentRollbackRequest: {
          type: 'object', required: ['expectedRevision'],
          properties: { expectedRevision: { type: 'integer', minimum: 1 }, version: { type: 'integer', minimum: 1 }, releaseId: { type: 'string', minLength: 1 } },
          not: { required: ['version', 'releaseId'] }, additionalProperties: false,
        },
        Deployment: { type: 'object', required: ['id', 'workflowId', 'environment', 'activeVersion', 'status'], properties: { id: { type: 'string' }, workflowId: { type: 'string' }, environment: { type: 'string' }, activeVersion: { type: 'integer', minimum: 1 }, maxTokensPerDay: { type: 'integer', minimum: 1 }, maxEstimatedCostUsdPerDay: { type: 'number', exclusiveMinimum: 0 }, unpricedCostPolicy: { const: 'deny' }, status: { enum: ['active', 'paused', 'archived'] } }, additionalProperties: true },
        DeploymentEnvelope: { type: 'object', required: ['deployment'], properties: { deployment: ref('Deployment') }, additionalProperties: false },
        DeploymentUsage: { type: 'object', required: ['inputTokens', 'outputTokens', 'embeddingInputTokens', 'estimatedCostUsd', 'unpricedLlmCalls', 'unpricedEmbeddingOperations', 'tokensUsedToday', 'estimatedCostUsdUsedToday'], properties: { inputTokens: { type: 'integer', minimum: 0 }, outputTokens: { type: 'integer', minimum: 0 }, embeddingInputTokens: { type: 'integer', minimum: 0 }, estimatedCostUsd: { type: 'number', minimum: 0 }, unpricedLlmCalls: { type: 'integer', minimum: 0 }, unpricedEmbeddingOperations: { type: 'integer', minimum: 0 }, maxTokensPerDay: { type: 'integer', minimum: 1 }, maxEstimatedCostUsdPerDay: { type: 'number', exclusiveMinimum: 0 }, tokensUsedToday: { type: 'integer', minimum: 0 }, estimatedCostUsdUsedToday: { type: 'number', minimum: 0 }, activeReservedTokens: { type: 'integer', minimum: 0 }, activeReservedEstimatedCostUsd: { type: 'number', minimum: 0 } }, additionalProperties: true },
        DeploymentUsageEnvelope: { type: 'object', required: ['usage'], properties: { usage: ref('DeploymentUsage') }, additionalProperties: false },
        ScopedSecret: {
          type: 'object',
          description: 'Write-only secret metadata. The stored value is never returned by the API.',
          required: ['id', 'name', 'kind', 'scope', 'scopeId', 'workflowId', 'revision', 'createdAt', 'updatedAt', 'hasValue', 'maskedValue'],
          properties: {
            id: { type: 'string' }, name: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,127}$' },
            description: { type: 'string' }, kind: { const: 'secret' }, scope: { enum: ['workflow', 'deployment'] },
            scopeId: { type: 'string' }, workflowId: { type: 'string' }, environment: { type: 'string' },
            revision: { type: 'integer', minimum: 1 }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
            hasValue: { const: true }, maskedValue: { const: '[REDACTED]' },
          },
          additionalProperties: false,
        },
        SecretCreateRequest: {
          type: 'object', required: ['name', 'value'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 128 }, value: { type: 'string', minLength: 1, maxLength: 65536, writeOnly: true }, description: { type: 'string' } },
          additionalProperties: false,
        },
        SecretUpdateRequest: {
          type: 'object', required: ['expectedRevision'],
          properties: { expectedRevision: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1, maxLength: 128 }, value: { type: 'string', minLength: 1, maxLength: 65536, writeOnly: true }, description: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
          additionalProperties: false,
        },
        SecretEnvelope: { type: 'object', required: ['secret'], properties: { secret: ref('ScopedSecret') }, additionalProperties: false },
        SecretsEnvelope: { type: 'object', required: ['secrets'], properties: { secrets: { type: 'array', items: ref('ScopedSecret') } }, additionalProperties: false },
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
    },
  };
}
