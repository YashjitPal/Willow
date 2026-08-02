import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COLLECTIONS } from '../src/storage/index.ts';
import { makeApp, waitForRun } from './helpers.ts';

describe('reusable pinned subflows', () => {
  it('mirrors and resolves a deeply nested approval through the root run', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const child = await app.workflows.create({
        name: 'Approval child',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'approve', type: 'userApproval', name: 'Approve', config: { message: 'Approve nested work?' } },
            { id: 'yes', type: 'end', name: 'Approved', config: { output: 'approved' } },
            { id: 'no', type: 'end', name: 'Rejected', config: { output: 'rejected' } },
          ],
          edges: [
            { id: 'sa', source: 's', target: 'approve' },
            { id: 'ay', source: 'approve', target: 'yes', sourceHandle: 'approved' },
            { id: 'an', source: 'approve', target: 'no', sourceHandle: 'rejected' },
          ],
        },
      });
      const published = await app.workflows.publish(child.workflow.id);
      const parent = await app.workflows.create({
        name: 'Approval parent',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId: child.workflow.id, version: published!.version.version } },
            { id: 'e', type: 'end', name: 'End', config: { output: '{{call_child.output_text}}' } },
          ],
          edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
        },
      });
      const parentPublished = await app.workflows.publish(parent.workflow.id);
      const root = await app.workflows.create({
        name: 'Approval root',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'call', type: 'subflow', name: 'Call parent', config: { workflowId: parent.workflow.id, version: parentPublished!.version.version } },
            { id: 'e', type: 'end', name: 'End', config: { output: '{{call_parent.output_text}}' } },
          ],
          edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
        },
      });

      const started = await app.engine.createRun({ workflowId: root.workflow.id, input: {} });
      const paused = await waitForRun(app, started.id, ['awaiting_approval', 'failed']);
      assert.equal(paused.status, 'awaiting_approval', paused.error);
      assert.equal(paused.pendingApproval?.runId, started.id);
      assert.equal(paused.pendingApproval?.nodeId, 'call');
      assert.equal(paused.nestedWait?.childRunId, paused.pendingApproval?.nested?.childRunId);
      assert.equal(paused.nestedWait?.leafRunId, paused.pendingApproval?.nested?.leafRunId);
      assert.notEqual(paused.nestedWait?.childRunId, paused.nestedWait?.leafRunId);

      await app.engine.resolveApproval(started.id, paused.pendingApproval!.id, { approved: true });
      const completed = await waitForRun(app, started.id, ['completed', 'failed']);
      assert.equal(completed.status, 'completed', completed.error);
      assert.equal(completed.output, 'approved');
      const leaf = await app.engine.getRun(paused.nestedWait!.leafRunId);
      assert.equal(leaf?.status, 'completed');
      const events = await app.engine.pastEvents(started.id);
      assert.ok(events.some((event) => event.type === 'subflow.paused'));
      assert.ok(events.some((event) => event.type === 'subflow.resumed'));
    } finally {
      await cleanup();
    }
  });

  it('reconciles a paused parent after restart without duplicating or resurrecting children', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const child = await app.workflows.create({
        name: 'Recoverable approval child',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'approve', type: 'userApproval', name: 'Approve', config: { message: 'Continue after restart?' } },
            { id: 'e', type: 'end', name: 'End', config: { output: 'recovered' } },
          ],
          edges: [
            { id: 'sa', source: 's', target: 'approve' },
            { id: 'ae', source: 'approve', target: 'e', sourceHandle: 'approved' },
            { id: 'ar', source: 'approve', target: 'e', sourceHandle: 'rejected' },
          ],
        },
      });
      const published = await app.workflows.publish(child.workflow.id);
      const parent = await app.workflows.create({ name: 'Recoverable parent', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId: child.workflow.id, version: published!.version.version } },
          { id: 'e', type: 'end', name: 'End', config: { output: '{{call_child.output_text}}' } },
        ],
        edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
      } });

      const first = await app.engine.createRun({ workflowId: parent.workflow.id, input: {} });
      const paused = await waitForRun(app, first.id, ['awaiting_approval', 'failed']);
      assert.equal(paused.status, 'awaiting_approval', paused.error);
      const childRunId = paused.nestedWait!.childRunId;
      const childRun = await app.engine.getRun(childRunId);
      assert.equal(childRun?.status, 'awaiting_approval');

      // Simulate the leaf resolving while the parent process is unavailable:
      // its persisted lineage returns before startup reconciliation runs.
      const parentRunId = childRun!.parentRunId;
      childRun!.parentRunId = undefined;
      await app.storage.put(COLLECTIONS.runs, childRunId, childRun!, child.workflow.id);
      await app.engine.resolveApproval(childRunId, childRun!.pendingApproval!.id, { approved: true });
      const settledChild = await waitForRun(app, childRunId, ['completed', 'failed']);
      settledChild.parentRunId = parentRunId;
      await app.storage.put(COLLECTIONS.runs, childRunId, settledChild, child.workflow.id);
      assert.equal((await app.engine.getRun(first.id))?.status, 'awaiting_approval');
      await Promise.all([app.engine.recoverInterruptedRuns(), app.engine.recoverInterruptedRuns()]);
      const recovered = await waitForRun(app, first.id, ['completed', 'failed']);
      assert.equal(recovered.status, 'completed', recovered.error);
      assert.equal(recovered.output, 'recovered');
      let childRuns = (await app.storage.list<any>(COLLECTIONS.runs, { ref: child.workflow.id })).map((row) => row.doc);
      assert.deepEqual(childRuns.map((run) => run.id), [childRunId]);

      const second = await app.engine.createRun({ workflowId: parent.workflow.id, input: {} });
      const secondPaused = await waitForRun(app, second.id, ['awaiting_approval', 'failed']);
      assert.equal(secondPaused.status, 'awaiting_approval', secondPaused.error);
      const cancelledChildId = secondPaused.nestedWait!.childRunId;
      await app.engine.cancelRun(second.id);
      await Promise.all([app.engine.recoverInterruptedRuns(), app.engine.recoverInterruptedRuns()]);
      assert.equal((await app.engine.getRun(second.id))?.status, 'cancelled');
      assert.equal((await app.engine.getRun(cancelledChildId))?.status, 'cancelled');
      childRuns = (await app.storage.list<any>(COLLECTIONS.runs, { ref: child.workflow.id })).map((row) => row.doc);
      assert.deepEqual(new Set(childRuns.map((run) => run.id)), new Set([childRunId, cancelledChildId]));
    } finally {
      await cleanup();
    }
  });

  it('executes a pinned child workflow with mapped input, lineage, and nested trace span', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const child = await app.workflows.create({
        name: 'Child workflow',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'a', type: 'agent', name: 'Child agent', config: { instructions: '', model: 'mock/echo', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false } },
            { id: 'e', type: 'end', name: 'End', config: { output: '{{child_agent.output_text}}' } },
          ],
          edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
        },
      });
      const published = await app.workflows.publish(child.workflow.id);
      assert.ok(published);
      const parent = await app.workflows.create({
        name: 'Parent workflow',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'call', type: 'subflow', name: 'Call child', config: {
              workflowId: child.workflow.id,
              version: published!.version.version,
              inputMappings: [{ target: 'input_as_text', value: '{{workflow.input_as_text}}' }],
              outputMappings: [{ name: 'answer', type: 'string', expression: '{{child.output_text}}' }],
            } },
            { id: 'e', type: 'end', name: 'End', config: { output: '{{call_child.answer}}' } },
          ],
          edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
        },
      });
      const run = await app.engine.createRun({ workflowId: parent.workflow.id, input: { input_as_text: 'hello child' } });
      const completed = await waitForRun(app, run.id, ['completed', 'failed']);
      assert.equal(completed.status, 'completed', completed.error);
      assert.equal(completed.output, 'hello child');
      const childRuns = (await app.storage.list<any>(COLLECTIONS.runs, { ref: child.workflow.id })).map((row) => row.doc);
      assert.equal(childRuns.length, 1);
      assert.equal(childRuns[0].parentRunId, run.id);
      assert.equal(childRuns[0].parentNodeId, 'call');
      assert.deepEqual(childRuns[0].workflowAncestry, [parent.workflow.id, child.workflow.id]);
      assert.equal(childRuns[0].runDepth, 1);
      const events = await app.engine.pastEvents(run.id);
      assert.ok(events.some((event) => event.type === 'subflow.started'));
      assert.ok(events.some((event) => event.type === 'subflow.completed'));
      const spans = await app.engine.traceSpans(run.id);
      assert.ok(spans?.some((span) => span.type === 'subflow' && span.data?.childRunId === childRuns[0].id));
    } finally {
      await cleanup();
    }
  });

  it('coerces mapped subflow outputs to their declared contract type', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const child = await app.workflows.create({ name: 'Typed child', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'e', type: 'end', name: 'End', config: { output: 'ignored' } },
        ], edges: [{ id: 'se', source: 's', target: 'e' }],
      } });
      const published = await app.workflows.publish(child.workflow.id);
      const parent = await app.workflows.create({ name: 'Typed parent', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'call', type: 'subflow', name: 'Call child', config: {
            workflowId: child.workflow.id, version: published!.version.version,
            outputMappings: [{ name: 'answer', type: 'number', expression: '42' }],
          } },
          { id: 'e', type: 'end', name: 'End', config: { output: '{{call_child.answer}}' } },
        ], edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
      } });
      const run = await app.engine.createRun({ workflowId: parent.workflow.id, input: {} });
      const completed = await waitForRun(app, run.id, ['completed', 'failed']);
      assert.equal(completed.status, 'completed', completed.error);
      assert.equal(completed.output, 42);
      assert.equal(typeof completed.output, 'number');
    } finally {
      await cleanup();
    }
  });

  it('submits a nested client-tool result through the parent approval API', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const child = await app.workflows.create({
        name: 'Client tool child',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'a', type: 'agent', name: 'Agent', config: {
              instructions: 'use the client tool', model: 'mock/tool:client_lookup', outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false,
              tools: [{ kind: 'function', name: 'client_lookup', description: 'lookup', parameters: { type: 'object', properties: {} }, execution: { mode: 'client' } }],
            } },
            { id: 'e', type: 'end', name: 'End', config: { output: '{{agent.output_text}}' } },
          ],
          edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
        },
      });
      const published = await app.workflows.publish(child.workflow.id);
      const parent = await app.workflows.create({ name: 'Client tool parent', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId: child.workflow.id, version: published!.version.version } },
          { id: 'e', type: 'end', name: 'End', config: { output: '{{call_child.output_text}}' } },
        ],
        edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
      } });
      const started = await app.engine.createRun({ workflowId: parent.workflow.id, input: {} });
      const paused = await waitForRun(app, started.id, ['awaiting_client_tool', 'failed']);
      assert.equal(paused.status, 'awaiting_client_tool', paused.error);
      assert.equal(paused.pendingApproval?.kind, 'client_tool');
      await app.engine.resolveApproval(started.id, paused.pendingApproval!.id, { result: { customer: 'Ada' } });
      const completed = await waitForRun(app, started.id, ['completed', 'failed']);
      assert.equal(completed.status, 'completed', completed.error);
      assert.match(String(completed.output), /Ada/);
    } finally {
      await cleanup();
    }
  });

  it('continues a child debugger pause through the parent run', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const child = await app.workflows.create({ name: 'Debug child', graph: {
        nodes: [{ id: 's', type: 'start', name: 'Start', config: {} }, { id: 'e', type: 'end', name: 'End', config: { output: 'debug done' } }],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      } });
      const published = await app.workflows.publish(child.workflow.id);
      const parent = await app.workflows.create({ name: 'Debug parent', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId: child.workflow.id, version: published!.version.version, debug: { pauseBeforeFirst: true } } },
          { id: 'e', type: 'end', name: 'End', config: { output: '{{call_child.output_text}}' } },
        ],
        edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
      } });
      const started = await app.engine.createRun({ workflowId: parent.workflow.id, input: {} });
      const paused = await waitForRun(app, started.id, ['awaiting_debug', 'failed']);
      assert.equal(paused.status, 'awaiting_debug', paused.error);
      assert.equal(paused.debugPause?.nodeId, 'call');
      assert.equal(paused.nestedWait?.leafStatus, 'awaiting_debug');
      await app.engine.resumeDebug(started.id, 'continue');
      const completed = await waitForRun(app, started.id, ['completed', 'failed']);
      assert.equal(completed.status, 'completed', completed.error);
      assert.equal(completed.output, 'debug done');
    } finally {
      await cleanup();
    }
  });

  it('resumes nested credential requirements through the parent run', async () => {
    const { app, cleanup } = await makeApp();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    try {
      const child = await app.workflows.create({ name: 'Credential child', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'a', type: 'agent', name: 'Remote', config: { instructions: '', model: 'gpt-4.1-mini', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false } },
          { id: 'e', type: 'end', name: 'End', config: { output: '{{remote.output_text}}' } },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      } });
      const published = await app.workflows.publish(child.workflow.id);
      const parent = await app.workflows.create({ name: 'Credential parent', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId: child.workflow.id, version: published!.version.version } },
          { id: 'e', type: 'end', name: 'End', config: { output: '{{call_child.output_text}}' } },
        ],
        edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
      } });
      const started = await app.engine.createRun({ workflowId: parent.workflow.id, input: {} });
      const paused = await waitForRun(app, started.id, ['awaiting_credentials', 'failed']);
      assert.equal(paused.status, 'awaiting_credentials', paused.error);
      assert.equal(paused.nestedWait?.leafStatus, 'awaiting_credentials');
      assert.deepEqual(paused.credentialRequirements?.providers, ['openai']);
      globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(JSON.stringify({
        id: 'resp_nested', status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'credential restored' }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      await app.engine.resumeRun(started.id, { openai: ['ephemeral-test-key'] });
      const completed = await waitForRun(app, started.id, ['completed', 'failed']);
      assert.equal(completed.status, 'completed', completed.error);
      assert.ok(fetchCalls > 0);
      assert.doesNotMatch(JSON.stringify(completed), /ephemeral-test-key/);
    } finally {
      globalThis.fetch = originalFetch;
      await cleanup();
    }
  });

  it('keeps resume-only provider keys across an asynchronous subflow return without persisting them', async () => {
    const { app, cleanup } = await makeApp();
    const originalFetch = globalThis.fetch;
    try {
      const child = await app.workflows.create({ name: 'Key handoff child', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'e', type: 'end', name: 'End', config: { output: 'child done' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      } });
      const published = await app.workflows.publish(child.workflow.id);
      const parent = await app.workflows.create({ name: 'Key handoff parent', graph: {
        nodes: [
          { id: 's', type: 'start', name: 'Start', config: {} },
          { id: 'approve', type: 'userApproval', name: 'Approve', config: { message: 'Continue?' } },
          { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId: child.workflow.id, version: published!.version.version } },
          { id: 'a', type: 'agent', name: 'Remote', config: { instructions: 'Finish.', model: 'gpt-4.1-mini', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false } },
          { id: 'e', type: 'end', name: 'End', config: { output: '{{remote.output_text}}' } },
          { id: 'rejected', type: 'end', name: 'Rejected', config: { output: 'rejected' } },
        ],
        edges: [
          { id: 'sa', source: 's', target: 'approve' },
          { id: 'ac', source: 'approve', target: 'call', sourceHandle: 'approved' },
          { id: 'ar', source: 'approve', target: 'rejected', sourceHandle: 'rejected' },
          { id: 'ca', source: 'call', target: 'a' },
          { id: 'ae', source: 'a', target: 'e' },
        ],
      } });
      const key = 'resume-only-provider-key';
      let providerCalls = 0;
      const started = await app.engine.createRun({ workflowId: parent.workflow.id, input: {}, requestKeys: { openai: [key] } });
      const paused = await waitForRun(app, started.id, ['awaiting_approval', 'failed']);
      assert.equal(paused.status, 'awaiting_approval', paused.error);
      globalThis.fetch = async (_input, init) => {
        providerCalls++;
        assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`);
        return new Response(JSON.stringify({
          id: 'resp_parent_after_child', status: 'completed',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'finished after child' }] }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      await app.engine.resolveApproval(started.id, paused.pendingApproval!.id, { approved: true }, { openai: [key] });
      const completed = await waitForRun(app, started.id, ['completed', 'failed']);
      assert.equal(completed.status, 'completed', completed.error);
      assert.equal(providerCalls, 1);
      assert.doesNotMatch(JSON.stringify(await app.storage.list(COLLECTIONS.runs)), new RegExp(key));
      assert.doesNotMatch(JSON.stringify(await app.engine.pastEvents(started.id)), new RegExp(key));
    } finally {
      globalThis.fetch = originalFetch;
      await cleanup();
    }
  });

  it('cancels an active child when the parent run is cancelled', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const child = await app.workflows.create({
        name: 'Slow child',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'a', type: 'agent', name: 'Slow agent', config: { instructions: '', model: 'mock/delay:1000', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false } },
            { id: 'e', type: 'end', name: 'End', config: { output: 'done' } },
          ],
          edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
        },
      });
      const published = await app.workflows.publish(child.workflow.id);
      const parent = await app.workflows.create({
        name: 'Cancelling parent',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId: child.workflow.id, version: published!.version.version } },
            { id: 'e', type: 'end', name: 'End', config: { output: 'done' } },
          ],
          edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
        },
      });
      const run = await app.engine.createRun({ workflowId: parent.workflow.id, input: {} });
      let childRunId: string | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        childRunId = (await app.storage.list<any>(COLLECTIONS.runs, { ref: child.workflow.id })).map((row) => row.doc)[0]?.id;
        if (childRunId) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(childRunId);
      await app.engine.cancelRun(run.id);
      const childRun = await waitForRun(app, childRunId!, ['cancelled', 'completed', 'failed']);
      assert.equal(childRun.status, 'cancelled');
      assert.equal((await app.engine.getRun(run.id))?.status, 'cancelled');
    } finally {
      await cleanup();
    }
  });
});
