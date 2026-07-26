import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentBuilderClient } from '../client/index.ts';
import { listen, makeApp } from './helpers.ts';

function openApiPath(pattern: string): string {
  return pattern.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

describe('OpenAPI contract discovery', () => {
  it('serves every live router operation through the typed SDK', async () => {
    const { app, cleanup } = await makeApp();
    const server = await listen(app);
    try {
      const client = new AgentBuilderClient({ baseUrl: server.baseUrl });
      const document = await client.getOpenApiDocument();
      assert.equal(document.openapi, '3.1.0');
      assert.equal(document.info.title, 'Willow Agent Builder API');

      const described = app.router.describeRoutes();
      const liveOperations = new Set(described.map((route) => `${route.method} ${openApiPath(route.pattern)}`));
      const documentedOperations = new Set<string>();
      const operationIds = new Set<string>();
      for (const [path, pathItem] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(pathItem)) {
          documentedOperations.add(`${method.toUpperCase()} ${path}`);
          assert.ok(operation.operationId);
          assert.equal(operationIds.has(operation.operationId), false, `duplicate operationId ${operation.operationId}`);
          operationIds.add(operation.operationId);
          assert.ok(operation.responses['200']);
        }
      }
      assert.deepEqual(documentedOperations, liveOperations);
      assert.equal(document.paths['/api/v1/openapi.json'].get.operationId, 'getOpenapiJson');
    } finally {
      await server.close();
      await cleanup();
    }
  });

  it('documents path parameters, JSON bodies, security headers, and SSE responses', async () => {
    const { app, cleanup } = await makeApp();
    const server = await listen(app);
    try {
      const document = await new AgentBuilderClient({ baseUrl: server.baseUrl }).getOpenApiDocument();
      const run = document.paths['/api/v1/workflows/{id}/runs'].post;
      assert.ok(run.requestBody);
      assert.ok(run.parameters?.some((parameter) => parameter.name === 'id' && parameter.in === 'path' && parameter.required === true));
      assert.ok(run.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/ProviderKeys'));
      assert.ok(run.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'));
      const workflowList = document.paths['/api/v1/workflows'].get;
      assert.equal(workflowList.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/ProviderKeys'), false);
      assert.equal(workflowList.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/ChatKitClientSecret'), false);
      const createDeployment = document.paths['/api/v1/deployments'].post;
      assert.equal(createDeployment.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), true);
      for (const operation of [
        document.paths['/api/v1/runs/{id}/cancel'].post,
        document.paths['/api/v1/deployments/{id}/rollout'].post,
        document.paths['/api/v1/deployments/{id}/stage'].post,
        document.paths['/api/v1/deployments/{id}/promote'].post,
        document.paths['/api/v1/deployments/{id}/cancel-stage'].post,
        document.paths['/api/v1/deployments/{id}/rollback'].post,
      ]) {
        assert.equal(operation.parameters?.some((parameter: any) => parameter.$ref === '#/components/parameters/IdempotencyKey'), true);
      }
      const events = document.paths['/api/v1/runs/{id}/events'].get;
      const success = events.responses['200'] as any;
      assert.ok(success.content['text/event-stream']);
      assert.deepEqual((document.components.securitySchemes as any).bearerAuth, { type: 'http', scheme: 'bearer' });
      const realtime = document['x-willow-websockets']?.['/api/v1/realtime'] as any;
      assert.equal(realtime.sessionGrantOperationId, 'postRealtimeSessions');
      assert.deepEqual(realtime.subprotocols, ['willow.realtime.v1', 'willow.session.{sessionId}.{secret}']);
    } finally {
      await server.close();
      await cleanup();
    }
  });

  it('publishes concrete contracts for evaluations, traces, embedding usage, and deployment budgets', async () => {
    const { app, cleanup } = await makeApp();
    const server = await listen(app);
    try {
      const document = await new AgentBuilderClient({ baseUrl: server.baseUrl }).getOpenApiDocument();
      const contract = document as any;
      const schemas = contract.components.schemas;

      assert.equal(contract.paths['/api/v1/evaluations/{id}/run'].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/EvaluationRunRequest');
      assert.equal(contract.paths['/api/v1/evaluation-runs/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/EvaluationRunEnvelope');
      assert.ok(schemas.EvaluationRunSelection.properties.model);
      assert.equal(schemas.EvaluationRunSelection.properties.from.format, 'date-time');
      assert.deepEqual(schemas.EvaluationRun.properties.status.enum, ['queued', 'running', 'awaiting_credentials', 'completed', 'failed', 'cancelled']);
      assert.ok(schemas.EvaluationGrader.properties.type.enum.includes('label_model_judge'));
      assert.equal(schemas.EvaluationGrader.properties.labels.minItems, 2);
      assert.equal(schemas.EvaluationGrader.properties.passingLabels.minItems, 1);
      assert.equal(contract.paths['/api/v1/evaluations/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/EvaluationDefinitionEnvelope');

      const spans = contract.paths['/api/v1/runs/{id}/spans'].get;
      assert.ok(spans.parameters.some((parameter: any) => parameter.name === 'after' && parameter.schema.minimum === 0));
      assert.equal(spans.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/TraceSpansResponse');
      const compare = contract.paths['/api/v1/runs/{id}/compare'].get;
      assert.ok(compare.parameters.some((parameter: any) => parameter.name === 'against' && parameter.required === true));
      assert.ok(schemas.TraceSpan.properties.type.enum.includes('subflow'));

      for (const operation of [contract.paths['/api/v1/runs'].get, contract.paths['/api/v1/workflows/{id}/runs'].get]) {
        const limit = operation.parameters.find((parameter: any) => parameter.name === 'limit');
        assert.deepEqual(limit.schema, { type: 'integer', minimum: 1, maximum: 100, default: 50 });
      }

      const globalRunFilters = contract.paths['/api/v1/runs'].get.parameters;
      for (const name of ['workflowId', 'status', 'nodeId', 'type', 'from', 'to', 'error', 'model', 'tool', 'cursor']) {
        assert.ok(globalRunFilters.some((parameter: any) => parameter.name === name), `missing run query parameter ${name}`);
      }
      assert.equal(globalRunFilters.find((parameter: any) => parameter.name === 'from').schema.format, 'date-time');
      assert.equal(globalRunFilters.find((parameter: any) => parameter.name === 'to').schema.format, 'date-time');
      assert.equal(contract.paths['/api/v1/workflows/{id}/runs'].get.parameters.some((parameter: any) => parameter.name === 'workflowId'), false);

      assert.ok(schemas.RunUsage.required.includes('embeddingInputTokens'));
      assert.ok(schemas.RunUsage.required.includes('byEmbeddingModel'));
      assert.ok(schemas.DeploymentUsage.required.includes('unpricedEmbeddingOperations'));
      assert.equal(contract.paths['/api/v1/deployments/{id}/usage'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/DeploymentUsageEnvelope');

      const create = contract.paths['/api/v1/deployments'].post;
      assert.equal(create.requestBody.content['application/json'].schema.$ref, '#/components/schemas/DeploymentCreateRequest');
      assert.equal(schemas.DeploymentCreateRequest.properties.maxTokensPerDay.minimum, 1);
      assert.equal(schemas.DeploymentCreateRequest.properties.unpricedCostPolicy.const, 'deny');
      assert.equal(schemas.DeploymentUpdateRequest.properties.maxTokensPerDay.anyOf[1].type, 'null');
      assert.equal(contract.paths['/api/v1/deployments/{id}/rollout'].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/DeploymentRolloutRequest');
      assert.equal(schemas.DeploymentRolloutRequest.properties.version.minimum, 1);
      assert.equal(schemas.DeploymentStageRequest.properties.trafficPercent.maximum, 100);
      assert.equal(contract.paths['/api/v1/deployments/{id}/rollback'].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/DeploymentRollbackRequest');

      const approval = contract.paths['/api/v1/runs/{id}/approvals/{approvalId}'].post;
      assert.equal(approval.requestBody.content['application/json'].schema.$ref, '#/components/schemas/ApprovalResolutionRequest');
      assert.equal(approval.requestBody.required, true);
      assert.equal(schemas.ApprovalResolutionRequest.oneOf[1].required[0], 'result');
      assert.equal(schemas.ApprovalResolutionRequest.oneOf[0].properties.approved.type, 'boolean');

      const reviewDelete = contract.paths['/api/v1/workflows/{id}/comments/{threadId}'].delete;
      const expectedRevision = reviewDelete.parameters.find((parameter: any) => parameter.name === 'expectedRevision');
      assert.equal(expectedRevision.required, true);
      assert.equal(expectedRevision.schema.minimum, 1);
    } finally {
      await server.close();
      await cleanup();
    }
  });

  it('documents scoped secrets as write-only revisioned resources', async () => {
    const { app, cleanup } = await makeApp();
    const server = await listen(app);
    try {
      const contract = await new AgentBuilderClient({ baseUrl: server.baseUrl }).getOpenApiDocument() as any;
      const schemas = contract.components.schemas;
      assert.equal(schemas.SecretCreateRequest.properties.value.writeOnly, true);
      assert.equal(schemas.SecretUpdateRequest.properties.value.writeOnly, true);
      assert.equal('value' in schemas.ScopedSecret.properties, false);
      assert.equal(schemas.ScopedSecret.properties.maskedValue.const, '[REDACTED]');
      assert.equal(schemas.ScopedSecret.additionalProperties, false);

      for (const base of ['/api/v1/workflows/{id}/secrets', '/api/v1/deployments/{id}/secrets']) {
        assert.equal(contract.paths[base].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/SecretsEnvelope');
        assert.equal(contract.paths[base].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/SecretCreateRequest');
        assert.equal(contract.paths[`${base}/{secretId}`].patch.requestBody.content['application/json'].schema.$ref, '#/components/schemas/SecretUpdateRequest');
        const revision = contract.paths[`${base}/{secretId}`].delete.parameters.find((parameter: any) => parameter.name === 'expectedRevision');
        assert.equal(revision.required, true);
        assert.equal(revision.schema.minimum, 1);
      }
    } finally {
      await server.close();
      await cleanup();
    }
  });
});
