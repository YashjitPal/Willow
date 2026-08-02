import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateGraph } from '../src/domain/validate.ts';
import { makeApp, waitForRun } from './helpers.ts';

describe('dynamic agent handoffs', () => {
  it('routes a model-selected transfer to the target agent and emits a trace event', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const { workflow } = await app.workflows.create({
        name: 'Handoff workflow',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            {
              id: 'a', type: 'agent', name: 'Router', config: {
                instructions: '<<MOCK [{"tool":"transfer_billing","args":{"reason":"billing request"}}] MOCK>>',
                model: 'mock/script', tools: [], outputFormat: 'text', includeChatHistory: false,
                writeToConversationHistory: false, handoffs: [{ targetNodeId: 'b', toolName: 'transfer_billing', description: 'Route billing questions.' }],
              },
            },
            { id: 'b', type: 'agent', name: 'Billing', config: { instructions: 'Answer billing questions.', model: 'mock/echo', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false } },
            { id: 'e', type: 'end', name: 'End', config: { output: 'billing complete' } },
          ],
          edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'be', source: 'b', target: 'e' }],
        },
      });
      const run = await app.engine.createRun({ workflowId: workflow.id, input: { input_as_text: 'please help with billing' } });
      const completed = await waitForRun(app, run.id, ['completed', 'failed']);
      assert.equal(completed.status, 'completed', completed.error);
      const events = await app.engine.pastEvents(run.id);
      const handoff = events.find((event) => event.type === 'agent.handoff');
      assert.ok(handoff);
      assert.equal(handoff?.targetNodeId, 'b');
      assert.deepEqual(events.filter((event) => event.type === 'node.started').map((event) => event.nodeId), ['s', 'a', 'b', 'e']);
      assert.equal(completed.output, 'billing complete');
    } finally {
      await cleanup();
    }
  });

  it('preflights credentials for dynamic handoff targets and keeps the run resumable', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const { workflow } = await app.workflows.create({
        name: 'Handoff credentials',
        graph: {
          nodes: [
            { id: 's', type: 'start', name: 'Start', config: {} },
            {
              id: 'router', type: 'agent', name: 'Router', config: {
                instructions: 'route', model: 'mock/echo', tools: [], outputFormat: 'text',
                handoffs: [{ targetNodeId: 'target', toolName: 'transfer_target' }],
              },
            },
            { id: 'target', type: 'agent', name: 'Target', config: { instructions: 'target', model: 'gpt-5', tools: [], outputFormat: 'text' } },
            { id: 'e', type: 'end', name: 'End', config: { output: 'done' } },
          ],
          edges: [{ id: 'sr', source: 's', target: 'router' }, { id: 'te', source: 'target', target: 'e' }],
        },
      });
      const run = await app.engine.createRun({ workflowId: workflow.id, input: { input_as_text: 'route' } });
      assert.equal(run.status, 'awaiting_credentials');
      assert.deepEqual(run.credentialRequirements, { providers: ['openai'] });
      await assert.rejects(
        () => app.engine.resumeRun(run.id),
        /credentials required to continue run for provider\(s\): openai/,
      );
      const stillPaused = await app.engine.getRun(run.id);
      assert.equal(stillPaused?.status, 'awaiting_credentials');
      assert.deepEqual(stillPaused?.credentialRequirements, { providers: ['openai'] });
    } finally {
      await cleanup();
    }
  });

  it('rejects invalid, self, and non-agent handoff targets', () => {
    const base = {
      nodes: [
        { id: 's', type: 'start', name: 'Start', config: {} },
        { id: 'a', type: 'agent', name: 'Agent', config: { model: 'mock/echo', handoffs: [{ targetNodeId: 'missing' }] } },
        { id: 'e', type: 'end', name: 'End', config: {} },
      ],
      edges: [{ id: 'se', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
    } as any;
    assert.ok(validateGraph(base).errors.some((error) => error.message.includes('must reference an Agent node')));
    base.nodes[1].config.handoffs = [{ targetNodeId: 'a' }];
    assert.ok(validateGraph(base).errors.some((error) => error.message.includes('cannot hand off to itself')));
    base.nodes[1].config.handoffs = [{ targetNodeId: 'e' }];
    assert.ok(validateGraph(base).errors.some((error) => error.message.includes('must reference an Agent node')));
  });
});
