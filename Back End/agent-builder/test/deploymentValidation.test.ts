import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DeploymentConflictError, DeploymentService } from '../src/services/deployments.ts';
import { COLLECTIONS, type Storage } from '../src/storage/index.ts';
import { listen, makeApp, waitForRun, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl: string;

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

async function publishedWorkflow(name: string): Promise<string> {
  const created = await api('POST', '/api/v1/workflows', { name });
  assert.equal(created.status, 200);
  const workflowId = created.data.workflow.id as string;
  assert.equal((await api('POST', `/api/v1/workflows/${workflowId}/publish`, {})).status, 200);
  return workflowId;
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
});

after(async () => {
  await closeServer();
  await cleanup();
});

describe('deployment validation and optimistic concurrency', () => {
  it('rejects rollout requests without a positive version', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'Rollout version validation' });
    const workflowId = workflow.data.workflow.id;
    assert.equal((await api('POST', `/api/v1/workflows/${workflowId}/publish`, {})).status, 200);
    const created = await api('POST', '/api/v1/deployments', { workflowId, environment: 'validation', activeVersion: 1 });
    assert.equal(created.status, 200);
    const id = created.data.deployment.id;
    const revision = created.data.deployment.revision;
    for (const version of [undefined, 0, -1, null, 'not-a-version', Infinity]) {
      const response = await api('POST', `/api/v1/deployments/${id}/rollout`, { version, expectedRevision: revision });
      assert.equal(response.status, 400, JSON.stringify(version));
    }
  });

  it('validates bounded pinned graphs and fail-closed USD budgets', async () => {
    const bounded = await api('POST', '/api/v1/workflows', {
      name: 'Bounded deployment budget',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { instructions: 'Echo.', model: 'mock/echo', modelParams: { maxTokens: 10 }, maxTurns: 1, maxInputTokensPerCall: 20, tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    });
    const workflowId = bounded.data.workflow.id as string;
    assert.equal((await api('POST', `/api/v1/workflows/${workflowId}/publish`, {})).status, 200);

    const missingPolicy = await api('POST', '/api/v1/deployments', { workflowId, environment: 'missing-policy', activeVersion: 1, maxEstimatedCostUsdPerDay: 1 });
    assert.equal(missingPolicy.status, 400);
    assert.equal(missingPolicy.data.error.code, 'invalid_deployment_budget');

    const valid = await api('POST', '/api/v1/deployments', { workflowId, environment: 'bounded', activeVersion: 1, maxTokensPerDay: 100, maxEstimatedCostUsdPerDay: 1, unpricedCostPolicy: 'deny' });
    assert.equal(valid.status, 200);
    assert.equal(valid.data.deployment.maxTokensPerDay, 100);
    assert.equal(valid.data.deployment.maxEstimatedCostUsdPerDay, 1);
    assert.equal(valid.data.deployment.unpricedCostPolicy, 'deny');
    const usage = await api('GET', `/api/v1/deployments/${valid.data.deployment.id}/usage`);
    assert.deepEqual({
      tokensUsedToday: usage.data.usage.tokensUsedToday,
      estimatedCostUsdUsedToday: usage.data.usage.estimatedCostUsdUsedToday,
      activeReservedTokens: usage.data.usage.activeReservedTokens,
      tokenOverageToday: usage.data.usage.tokenOverageToday,
    }, { tokensUsedToday: 0, estimatedCostUsdUsedToday: 0, activeReservedTokens: 0, tokenOverageToday: 0 });

    const unbounded = await api('POST', '/api/v1/workflows', {
      name: 'Unbounded deployment budget',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { instructions: 'Echo.', model: 'mock/echo', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    });
    const unboundedId = unbounded.data.workflow.id as string;
    assert.equal((await api('POST', `/api/v1/workflows/${unboundedId}/publish`, {})).status, 200);
    const rejected = await api('POST', '/api/v1/deployments', { workflowId: unboundedId, environment: 'unbounded', activeVersion: 1, maxTokensPerDay: 100 });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.data.error.code, 'invalid_deployment_budget');
    assert.match(rejected.data.error.message, /modelParams\.maxTokens/);

    const unpriced = await api('POST', '/api/v1/workflows', {
      name: 'Unpriced deployment budget',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { instructions: 'Echo.', model: 'mock/delay:0', modelParams: { maxTokens: 10 }, maxTurns: 1, maxInputTokensPerCall: 20, tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    });
    const unpricedId = unpriced.data.workflow.id as string;
    assert.equal((await api('POST', `/api/v1/workflows/${unpricedId}/publish`, {})).status, 200);
    const denied = await api('POST', '/api/v1/deployments', { workflowId: unpricedId, environment: 'unpriced', activeVersion: 1, maxEstimatedCostUsdPerDay: 1, unpricedCostPolicy: 'deny' });
    assert.equal(denied.status, 400);
    assert.equal(denied.data.error.code, 'invalid_deployment_budget');
    assert.match(denied.data.error.message, /pinned pricing/);
  });

  it('reserves bounded LLM guardrail classifiers and rejects unpriced USD accounting', async () => {
    const guarded = await api('POST', '/api/v1/workflows', {
      name: 'Bounded guardrail classifiers',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'g', type: 'guardrail', config: { pii: false, moderation: true, jailbreak: true, hallucination: false, continueOnError: false, settings: { checkModel: 'mock/json' } } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [{ id: 'sg', source: 's', target: 'g' }, { id: 'ge-pass', source: 'g', sourceHandle: 'pass', target: 'e' }, { id: 'ge-fail', source: 'g', sourceHandle: 'fail', target: 'e' }],
      },
    });
    const workflowId = guarded.data.workflow.id as string;
    assert.equal((await api('POST', `/api/v1/workflows/${workflowId}/publish`, {})).status, 200);

    const deployment = await api('POST', '/api/v1/deployments', {
      workflowId,
      environment: 'bounded-guardrail',
      activeVersion: 1,
      maxTokensPerDay: 300_000,
      maxEstimatedCostUsdPerDay: 1,
      unpricedCostPolicy: 'deny',
    });
    assert.equal(deployment.status, 200, JSON.stringify(deployment.data));
    const reservation = await app.deployments.runReservation(deployment.data.deployment.id, 1);
    assert.equal(reservation.tokens, 263_144);
    assert.equal(reservation.estimatedCostUsd, 0);
    assert.equal(reservation.pricingStatus, 'priced');

    const unpriced = await api('POST', '/api/v1/workflows', {
      name: 'Unpriced guardrail classifier',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'g', type: 'guardrail', config: { pii: false, moderation: false, jailbreak: true, hallucination: false, continueOnError: false, settings: { checkModel: 'gemini-3-flash' } } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [{ id: 'sg', source: 's', target: 'g' }, { id: 'ge-pass', source: 'g', sourceHandle: 'pass', target: 'e' }, { id: 'ge-fail', source: 'g', sourceHandle: 'fail', target: 'e' }],
      },
    });
    const unpricedId = unpriced.data.workflow.id as string;
    assert.equal((await api('POST', `/api/v1/workflows/${unpricedId}/publish`, {})).status, 200);
    const denied = await api('POST', '/api/v1/deployments', {
      workflowId: unpricedId,
      environment: 'unpriced-guardrail',
      activeVersion: 1,
      maxEstimatedCostUsdPerDay: 1,
      unpricedCostPolicy: 'deny',
    });
    assert.equal(denied.status, 400);
    assert.equal(denied.data.error.code, 'invalid_deployment_budget');
    assert.match(denied.data.error.message, /pinned pricing/);
  });

  it('computes exact bounded handoff paths and rejects repeatable handoff states', async () => {
    const agent = (id: string, handoffs: Array<{ targetNodeId: string }> = [], input = 500, output = 10) => ({
      id, type: 'agent', name: id.toUpperCase(),
      config: { instructions: 'Echo.', model: 'mock/echo', modelParams: { maxTokens: output }, maxTurns: 1, maxInputTokensPerCall: input, handoffs, tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false },
    });
    const bounded = await api('POST', '/api/v1/workflows', {
      name: 'Bounded handoff budget',
      graph: {
        nodes: [{ id: 's', type: 'start', data: {} }, agent('a', [{ targetNodeId: 'b' }]), agent('b', [], 507, 20), { id: 'e', type: 'end', data: {} }],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }, { id: 'be', source: 'b', target: 'e' }],
      },
    });
    assert.equal((await api('POST', `/api/v1/workflows/${bounded.data.workflow.id}/publish`, {})).status, 200);
    const deployment = await api('POST', '/api/v1/deployments', { workflowId: bounded.data.workflow.id, environment: 'handoff-bounded', activeVersion: 1, maxTokensPerDay: 2000 });
    assert.equal(deployment.status, 200, JSON.stringify(deployment.data));
    const reservation = await app.deployments.runReservation(deployment.data.deployment.id, 1);
    assert.equal(reservation.tokens, 1037);
    await assert.rejects(
      app.deployments.runReservation(deployment.data.deployment.id, 1, { attachmentKinds: ['image'] }),
      /do not support image attachments until provider-specific modality accounting is configured/,
    );
    const session = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: bounded.data.workflow.id }, deployment_id: deployment.data.deployment.id });
    const auth = { 'x-chatkit-client-secret': session.data.client_secret };
    const thread = await api('POST', `/api/v1/chatkit/sessions/${session.data.session.id}/threads`, undefined, auth);
    const sent = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: 'bounded settlement' }, auth);
    const completed = await waitForRun(app, sent.data.run.id);
    assert.equal(completed.status, 'completed');
    const usage = (await api('GET', `/api/v1/deployments/${deployment.data.deployment.id}/usage`)).data.usage;
    assert.ok(usage.tokensUsedToday <= reservation.tokens);
    assert.equal(usage.tokenOverageToday, 0);
    const documentThread = await api('POST', `/api/v1/chatkit/sessions/${session.data.session.id}/threads`, undefined, auth);
    const documentAccepted = await api('POST', `/api/v1/chatkit/threads/${documentThread.data.thread.id}/messages`, {
      text: '',
      attachments: [{ name: 'notes.txt', mimeType: 'text/plain', contentBase64: Buffer.from('bounded document text').toString('base64') }],
    }, auth);
    assert.equal(documentAccepted.status, 200, JSON.stringify(documentAccepted.data));
    assert.equal((await waitForRun(app, documentAccepted.data.run.id)).status, 'completed');

    const mediaThread = await api('POST', `/api/v1/chatkit/sessions/${session.data.session.id}/threads`, undefined, auth);
    const mediaRejected = await api('POST', `/api/v1/chatkit/threads/${mediaThread.data.thread.id}/messages`, {
      text: '',
      attachments: [{ name: 'pixel.png', mimeType: 'image/png', contentBase64: Buffer.from('image').toString('base64') }],
    }, auth);
    assert.equal(mediaRejected.status, 422);
    assert.equal(mediaRejected.data.error.code, 'invalid_deployment_budget');
    assert.match(mediaRejected.data.error.message, /provider-specific modality accounting/);

    const cyclic = await api('POST', '/api/v1/workflows', {
      name: 'Cyclic handoff budget',
      graph: {
        nodes: [{ id: 's', type: 'start', data: {} }, agent('a', [{ targetNodeId: 'b' }]), agent('b', [{ targetNodeId: 'a' }]), { id: 'e', type: 'end', data: {} }],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }, { id: 'be', source: 'b', target: 'e' }],
      },
    });
    const rejected = await api('POST', `/api/v1/workflows/${cyclic.data.workflow.id}/publish`, {});
    assert.equal(rejected.status, 422);
    assert.match(rejected.data.error.message, /cycle/i);
  });

  it('enforces the declared input bound before a provider call', async () => {
    const workflow = await api('POST', '/api/v1/workflows', {
      name: 'Runtime input bound',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { instructions: 'Echo.', model: 'mock/echo', modelParams: { maxTokens: 10 }, maxTurns: 1, maxInputTokensPerCall: 1, tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    });
    const started = await api('POST', `/api/v1/workflows/${workflow.data.workflow.id}/runs`, { version: 0, input: { input_as_text: 'must not reach the provider' } });
    assert.equal(started.status, 200);
    const run = await waitForRun(app, started.data.run.id);
    assert.equal(run.status, 'failed');
    assert.match(run.error ?? '', /input bound exceeded/);
    assert.equal(run.usage.llmCalls, 0);
    assert.equal(run.usage.inputTokens, 0);
    assert.equal(run.usage.outputTokens, 0);
  });

  it('rejects coerced, non-finite, and out-of-range deployment limits on create and update', async () => {
    const workflowId = await publishedWorkflow('Deployment limit validation');
    const invalidCreates = [
      { environment: 'stringlimit', sessionRateLimitPerMinute: '5' },
      { environment: 'booleanlimit', maxActiveSessions: true },
      { environment: 'nulllimit', maxActiveSessions: null },
      { environment: 'ratetoohigh', sessionRateLimitPerMinute: 10_001 },
      { environment: 'activetoohigh', maxActiveSessions: 100_001 },
    ];
    for (const invalid of invalidCreates) {
      const response = await api('POST', '/api/v1/deployments', { workflowId, activeVersion: 1, ...invalid });
      assert.equal(response.status, 400, JSON.stringify(invalid));
    }

    const created = await api('POST', '/api/v1/deployments', {
      workflowId,
      environment: 'validlimits',
      activeVersion: 1,
      sessionRateLimitPerMinute: 50,
      maxActiveSessions: 500,
    });
    assert.equal(created.status, 200);
    const deployment = created.data.deployment;

    for (const invalidPatch of [
      { sessionRateLimitPerMinute: '25' },
      { maxActiveSessions: false },
      { sessionRateLimitPerMinute: 10_001 },
      { maxActiveSessions: 100_001 },
    ]) {
      const response = await api('PATCH', `/api/v1/deployments/${deployment.id}`, {
        expectedRevision: deployment.revision,
        ...invalidPatch,
      });
      assert.equal(response.status, 400, JSON.stringify(invalidPatch));
    }

    const persisted = await api('GET', `/api/v1/deployments/${deployment.id}`);
    assert.equal(persisted.data.deployment.revision, deployment.revision);
    assert.equal(persisted.data.deployment.sessionRateLimitPerMinute, 50);
    assert.equal(persisted.data.deployment.maxActiveSessions, 500);
  });

  it('rejects a same-version rollout when its revision becomes stale during validation', async () => {
    const workflowId = await publishedWorkflow('Same-version rollout race');
    const deployment = await app.deployments.create({
      workflowId,
      name: 'Race',
      environment: 'race',
      activeVersion: 1,
      allowedOrigins: [],
      sessionRateLimitPerMinute: 60,
      maxActiveSessions: 1000,
      status: 'active',
    });

    let enteredVersionLookup!: () => void;
    let resumeVersionLookup!: () => void;
    const versionLookupStarted = new Promise<void>((resolve) => { enteredVersionLookup = resolve; });
    const versionLookupMayFinish = new Promise<void>((resolve) => { resumeVersionLookup = resolve; });
    let shouldBlockVersionLookup = true;
    const delayedStorage = new Proxy(app.storage, {
      get(target, property) {
        if (property === 'get') {
          return async (collection: string, id: string) => {
            if (collection === COLLECTIONS.versions && shouldBlockVersionLookup) {
              shouldBlockVersionLookup = false;
              enteredVersionLookup();
              await versionLookupMayFinish;
            }
            return target.get(collection, id);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Storage;
    const racingService = new DeploymentService(delayedStorage);

    const rollout = racingService.rollout(deployment.id, deployment.activeVersion, deployment.revision);
    await versionLookupStarted;
    const updated = await app.deployments.update(deployment.id, deployment.revision, { name: 'Changed concurrently' });
    resumeVersionLookup();

    await assert.rejects(rollout, (error: unknown) => error instanceof DeploymentConflictError);
    assert.equal(updated.revision, deployment.revision + 1);
    assert.equal((await app.deployments.listReleases(deployment.id)).length, 1);
  });
});
