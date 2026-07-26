import assert from 'node:assert/strict';
import { it } from 'node:test';
import WebSocket from 'ws';
import { AgentBuilderClient } from '../client/index.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { listen, makeApp } from './helpers.ts';

async function poll<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`${label} did not settle within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

it('runs the complete published agent lifecycle through public API surfaces', async () => {
  const { app, cleanup } = await makeApp();
  const { baseUrl } = await listen(app);
  const client = new AgentBuilderClient({ baseUrl });
  let socket: WebSocket | undefined;
  try {
    const graph = {
      nodes: [
        { id: 'start', type: 'start', data: {} },
        {
          id: 'agent', type: 'agent', name: 'Agent', config: {
            instructions: 'Use the client lookup tool and return its result.',
            model: 'mock/tool:client_lookup',
            tools: [{
              kind: 'function', name: 'client_lookup', description: 'Look up a customer',
              parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
              execution: { mode: 'client' },
            }],
            outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: true, continueOnError: false,
          },
        },
        { id: 'end', type: 'end', config: { output: '{{agent.output_text}}' } },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-end', source: 'agent', target: 'end' },
      ],
    };
    const created = await client.createWorkflow({ name: 'End-to-end lifecycle', graph });
    const workflowId = created.workflow.id;
    const secret = await client.createWorkflowSecret(workflowId, { name: 'CRM_TOKEN', value: 'e2e-secret-value', description: 'Write-only scenario secret' });
    assert.equal('value' in secret.secret, false);
    const published = await client.publishWorkflow(workflowId, 'End-to-end test release', created.workflow.draftRevision);
    assert.equal(published.version.version, 1);

    const deployment = (await client.createDeployment({ workflowId, name: 'E2E production', environment: 'production', activeVersion: 1 })).deployment;
    const sessionGrant = await client.createChatSession({ workflowId, deploymentId: deployment.id, user: 'e2e-user' });
    const clientSecret = sessionGrant.client_secret;
    const thread = (await client.createThread(sessionGrant.session.id, clientSecret)).thread;
    const sent = await client.sendChatMessage(thread.id, '{"id":"customer_42"}', clientSecret, 'e2e-chat-turn');
    const paused = await poll(
      async () => (await client.getRun(sent.run.id, clientSecret)).run,
      (run) => run.status === 'awaiting_client_tool' || run.status === 'failed',
      'deployed client-tool run',
    );
    assert.equal(paused.status, 'awaiting_client_tool', paused.error);
    assert.equal(paused.pendingApproval?.kind, 'client_tool');

    const realtimeGrant = (await client.createRealtimeSession(paused.id, { clientSecret })).session;
    const messages: any[] = [];
    socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}${realtimeGrant.websocket.url}`, realtimeGrant.websocket.protocols);
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve);
      socket!.once('error', reject);
    });
    socket.send(JSON.stringify({
      type: 'approval.resolve', requestId: 'resolve-client-tool', approvalId: paused.pendingApproval!.id,
      result: { customer: 'Ada', plan: 'enterprise' },
    }));
    await poll(async () => messages, (items) => items.some((message) => message.type === 'command.completed' && message.requestId === 'resolve-client-tool'), 'realtime approval command');
    const completedRun = await poll(
      async () => (await client.getRun(paused.id, clientSecret)).run,
      (run) => run.status === 'completed' || run.status === 'failed',
      'realtime-resumed run',
    );
    assert.equal(completedRun.status, 'completed', completedRun.error);
    assert.match(String(completedRun.output), /Ada/);

    const evaluation = (await client.createEvaluation(workflowId, {
      name: 'E2E completed-run check',
      graders: [{ id: 'status', name: 'Run completed', type: 'run_status', expected: 'completed' }],
    })).evaluation;
    const evaluationJob = (await client.runEvaluation(evaluation.id, [completedRun.id], 'e2e-evaluation')).run;
    const evaluated = await poll(
      async () => (await client.getEvaluationRun(evaluationJob.id)).run,
      (run) => ['completed', 'failed', 'cancelled'].includes(run.status),
      'evaluation job',
    );
    assert.equal(evaluated.status, 'completed');
    assert.equal(evaluated.score, 1);
    assert.equal(evaluated.results[0]?.results[0]?.passed, true);

    const currentWorkflow = (await client.getWorkflow(workflowId)).workflow;
    const batchGraph = {
      nodes: [
        { id: 'start', type: 'start', data: {} },
        { id: 'agent', type: 'agent', name: 'Agent', config: { instructions: 'Echo the batch input.', model: 'mock/echo', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
        { id: 'end', type: 'end', config: { output: '{{agent.output_text}}' } },
      ],
      edges: [{ id: 'start-agent', source: 'start', target: 'agent' }, { id: 'agent-end', source: 'agent', target: 'end' }],
    };
    const savedBatchDraft = await client.saveDraft(workflowId, batchGraph, currentWorkflow.draftRevision);
    const batchVersion = await client.publishWorkflow(workflowId, 'Batch-compatible revision', savedBatchDraft.workflow.draftRevision);
    const batch = (await client.submitBatch(workflowId, [{ input_as_text: 'batch-ready' }], batchVersion.version.version, 1)).batch;
    const finishedBatch = await poll(
      async () => (await client.getBatch(batch.id)).batch,
      (job) => ['completed', 'failed', 'cancelled'].includes(job.status),
      'batch job',
    );
    assert.equal(finishedBatch.status, 'completed');
    assert.equal(finishedBatch.items[0]?.status, 'completed');

    await client.createWorkflowReviewThread(workflowId, { body: 'Verified in the end-to-end scenario.', anchor: { type: 'node', nodeId: 'agent' }, displayName: 'E2E' });
    await client.updateWorkflowPresence(workflowId, { clientId: 'e2e-tab', cursor: { x: 10, y: 20 }, selectedNodeIds: ['agent'], ttlSeconds: 60 });
    assert.equal((await client.listWorkflowReviewThreads(workflowId)).threads.length, 1);
    assert.equal((await client.listWorkflowPresence(workflowId)).presence.length, 1);

    socket.close();
    socket = undefined;
    await client.cancelChatSession(sessionGrant.session.id, clientSecret);
    await client.deleteEvaluation(evaluation.id);
    await client.deleteDeployment(deployment.id);
    assert.equal((await client.deleteWorkflow(workflowId)).ok, true);
    assert.equal((await app.storage.list(COLLECTIONS.workflowReviewThreads, { ref: workflowId })).length, 0);
    assert.equal((await app.storage.list(COLLECTIONS.workflowPresence, { ref: workflowId })).length, 0);
    assert.equal((await app.storage.list(COLLECTIONS.secretVariables)).some((row) => (row.doc as any).workflowId === workflowId), false);
  } finally {
    socket?.terminate();
    await cleanup();
  }
});
