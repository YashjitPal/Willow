import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowVersion } from '../src/domain/types.ts';
import { normalizeGraph } from '../src/domain/normalize.ts';
import { validateGraph } from '../src/domain/validate.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { makeApp, waitForRun } from './helpers.ts';

describe('release safety enforcement', () => {
  it('blocks privileged nodes when any route bypasses an active guardrail', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const created = await app.workflows.create({
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'route', type: 'ifElse', config: { branches: [{ id: 'guarded', condition: 'true' }] } },
            { id: 'g', type: 'guardrail', config: { pii: true, moderation: false, jailbreak: false, hallucination: false, onTripwire: 'branch' } },
            { id: 'm', type: 'mcp', config: { serverId: 'ops', tool: 'lookup', arguments: {}, requireApproval: 'always' } },
            { id: 'rejected', type: 'end', config: { output: 'blocked' } },
            { id: 'e', type: 'end', config: { output: '{{mcp.output_text}}' } },
          ],
          edges: [
            { id: 'sr', source: 's', target: 'route' },
            { id: 'rg', source: 'route', target: 'g', sourceHandle: 'guarded' },
            { id: 'rm', source: 'route', target: 'm', sourceHandle: 'else' },
            { id: 'gm', source: 'g', target: 'm', sourceHandle: 'pass' },
            { id: 'gr', source: 'g', target: 'rejected', sourceHandle: 'fail' },
            { id: 'me', source: 'm', target: 'e' },
          ],
        },
      });

      assert.ok(created.validation.safetyFindings.some((finding) => finding.code === 'SAFETY_PRIVILEGED_PATH_UNGUARDED' && finding.nodeId === 'm'));
      await assert.rejects(() => app.workflows.publish(created.workflow.id), /does not pass an active guardrail/i);
    } finally {
      await cleanup();
    }
  });

  it('allows a privileged node when every route passes a stopping guardrail', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const created = await app.workflows.create({
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'g', type: 'guardrail', config: { pii: true, moderation: false, jailbreak: false, hallucination: false, onTripwire: 'stop' } },
            { id: 'm', type: 'mcp', config: { serverId: 'ops', tool: 'lookup', arguments: {}, requireApproval: 'always' } },
            { id: 'e', type: 'end', config: { output: '{{mcp.output_text}}' } },
          ],
          edges: [
            { id: 'sg', source: 's', target: 'g' },
            { id: 'gm', source: 'g', target: 'm', sourceHandle: 'pass' },
            { id: 'gf', source: 'g', target: 'e', sourceHandle: 'fail' },
            { id: 'me', source: 'm', target: 'e' },
          ],
        },
      });

      assert.equal(created.validation.safetyFindings.some((finding) => finding.code === 'SAFETY_PRIVILEGED_PATH_UNGUARDED'), false);
      const published = await app.workflows.publish(created.workflow.id);
      assert.ok(published);
      assert.equal(published.version.version, 1);
    } finally {
      await cleanup();
    }
  });

  it('keeps unsafe drafts editable but blocks publishing approval-disabled MCP', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const created = await app.workflows.create({
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'm', type: 'mcp', config: { serverId: 'ops', tool: 'lookup', arguments: {}, requireApproval: 'never' } },
            { id: 'e', type: 'end', config: { output: '{{mcp.output_text}}' } },
          ],
          edges: [{ id: 'sm', source: 's', target: 'm' }, { id: 'me', source: 'm', target: 'e' }],
        },
      });

      assert.equal(created.validation.valid, true);
      assert.ok(created.validation.safetyFindings.some((finding) => finding.code === 'SAFETY_MCP_APPROVAL_DISABLED'));
      await assert.rejects(
        () => app.workflows.publish(created.workflow.id),
        /cannot publish an invalid workflow:.*without human approval/i,
      );
    } finally {
      await cleanup();
    }
  });

  it('detects state and prior freeform node output in developer instructions', () => {
    const graph = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', config: { stateVariables: [{ name: 'user_text', type: 'string', default: '' }] } },
        { id: 'a1', type: 'agent', name: 'Collector', config: { model: 'mock/echo', instructions: '', outputFormat: 'text' } },
        { id: 'a2', type: 'agent', name: 'Privileged', config: { model: 'mock/echo', instructions: 'State: {{state.user_text}} Prior: {{collector.output_text}}', outputFormat: 'text' } },
        { id: 'e', type: 'end', config: { output: '{{privileged.output_text}}' } },
      ],
      edges: [{ id: 'sa', source: 's', target: 'a1' }, { id: 'aa', source: 'a1', target: 'a2' }, { id: 'ae', source: 'a2', target: 'e' }],
    }).graph;

    const validation = validateGraph(graph);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
    assert.ok(validation.safetyFindings.some((finding) => finding.code === 'SAFETY_UNTRUSTED_INSTRUCTIONS' && finding.nodeId === 'a2'));
  });

  it('keeps freeform-to-MCP drafts editable but blocks publishing them', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const created = await app.workflows.create({
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'a', type: 'agent', name: 'Draft arguments', config: { model: 'mock/echo', instructions: '', outputFormat: 'text' } },
            { id: 'g', type: 'guardrail', config: { pii: true, moderation: false, jailbreak: false, hallucination: false, onTripwire: 'stop' } },
            { id: 'm', type: 'mcp', name: 'Send message', config: { serverId: 'messages', tool: 'send', arguments: { body: '{{draft_arguments.output_text}}' }, requireApproval: 'always' } },
            { id: 'e', type: 'end', config: { output: '{{send_message.output_text}}' } },
          ],
          edges: [
            { id: 'sa', source: 's', target: 'a' },
            { id: 'ag', source: 'a', target: 'g' },
            { id: 'gm', source: 'g', target: 'm', sourceHandle: 'pass' },
            { id: 'ge', source: 'g', target: 'e', sourceHandle: 'fail' },
            { id: 'me', source: 'm', target: 'e' },
          ],
        },
      });

      assert.equal(created.validation.valid, true, JSON.stringify(created.validation.errors));
      assert.ok(created.validation.safetyFindings.some((finding) =>
        finding.code === 'SAFETY_FREEFORM_OUTPUT_TO_MCP' && finding.nodeId === 'm' && finding.relatedNodeId === 'a'));
      await assert.rejects(
        () => app.workflows.publish(created.workflow.id),
        /cannot publish an invalid workflow:.*freeform output.*directly supplies MCP arguments/i,
      );
    } finally {
      await cleanup();
    }
  });

  it('keeps raw-input-to-MCP drafts editable but blocks publishing them', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const created = await app.workflows.create({
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'g', type: 'guardrail', config: { pii: true, moderation: false, jailbreak: true, hallucination: false, onTripwire: 'stop' } },
            { id: 'm', type: 'mcp', name: 'Search records', config: { serverId: 'records', tool: 'search', arguments: { query: '{{workflow.input_as_text}}' }, requireApproval: 'always' } },
            { id: 'e', type: 'end', config: { output: '{{search_records.output_text}}' } },
          ],
          edges: [
            { id: 'sg', source: 's', target: 'g' },
            { id: 'gm', source: 'g', target: 'm', sourceHandle: 'pass' },
            { id: 'ge', source: 'g', target: 'e', sourceHandle: 'fail' },
            { id: 'me', source: 'm', target: 'e' },
          ],
        },
      });

      assert.equal(created.validation.valid, true, JSON.stringify(created.validation.errors));
      assert.ok(created.validation.safetyFindings.some((finding) =>
        finding.code === 'SAFETY_UNTRUSTED_INPUT_TO_MCP' && finding.nodeId === 'm'));
      await assert.rejects(
        () => app.workflows.publish(created.workflow.id),
        /cannot publish an invalid workflow:.*raw workflow input directly supplies MCP arguments/i,
      );
    } finally {
      await cleanup();
    }
  });

  it('allows validated structured fields to supply approved MCP arguments', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const created = await app.workflows.create({
        graph: {
          nodes: [
            { id: 's', type: 'start', config: { inputVariables: [{ name: 'customer_id', type: 'string' }] } },
            { id: 'g', type: 'guardrail', config: { pii: true, moderation: false, jailbreak: true, hallucination: false, onTripwire: 'stop' } },
            { id: 'm', type: 'mcp', name: 'Lookup record', config: { serverId: 'records', tool: 'lookup', arguments: { customerId: '{{workflow.customer_id}}' }, requireApproval: 'always' } },
            { id: 'e', type: 'end', config: { output: '{{lookup_record.output_text}}' } },
          ],
          edges: [
            { id: 'sg', source: 's', target: 'g' },
            { id: 'gm', source: 'g', target: 'm', sourceHandle: 'pass' },
            { id: 'ge', source: 'g', target: 'e', sourceHandle: 'fail' },
            { id: 'me', source: 'm', target: 'e' },
          ],
        },
      });

      assert.equal(created.validation.valid, true, JSON.stringify(created.validation.errors));
      assert.equal(created.validation.safetyFindings.some((finding) => finding.code === 'SAFETY_UNTRUSTED_INPUT_TO_MCP'), false);
      const published = await app.workflows.publish(created.workflow.id);
      assert.ok(published);
      assert.equal(published.version.version, 1);
    } finally {
      await cleanup();
    }
  });

  it('forces approval when a legacy published graph disabled it', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const created = await app.workflows.create({
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'm', type: 'mcp', name: 'Legacy call', config: { serverId: 'legacy', tool: 'read', arguments: { value: 'x' }, requireApproval: 'never' } },
            { id: 'e', type: 'end', config: { output: '{{legacy_call.output_text}}' } },
          ],
          edges: [{ id: 'sm', source: 's', target: 'm' }, { id: 'me', source: 'm', target: 'e' }],
        },
      });
      const version: WorkflowVersion = {
        workflowId: created.workflow.id,
        version: 1,
        graph: structuredClone(created.workflow.draft),
        publishedAt: new Date().toISOString(),
      };
      await app.storage.put(COLLECTIONS.versions, `${created.workflow.id}@1`, version, created.workflow.id);

      const run = await app.engine.createRun({ workflowId: created.workflow.id, version: 1, input: {} });
      const paused = await waitForRun(app, run.id, ['awaiting_approval', 'failed']);
      assert.equal(paused.status, 'awaiting_approval', paused.error);
      assert.equal(paused.pendingApproval?.kind, 'mcp_tool');

      await assert.rejects(
        () => app.deployments.create({
          workflowId: created.workflow.id,
          name: 'Legacy unsafe deployment',
          environment: 'legacy',
          activeVersion: 1,
          allowedOrigins: [],
          sessionRateLimitPerMinute: 60,
          maxActiveSessions: 100,
          status: 'active',
        }),
        /blocked by safety policy/i,
      );
    } finally {
      await cleanup();
    }
  });

  it('revalidates a staged snapshot before promotion', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const created = await app.workflows.create({
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'e', type: 'end', config: { output: 'safe' } },
          ],
          edges: [{ id: 'se', source: 's', target: 'e' }],
        },
      });
      await app.workflows.publish(created.workflow.id);
      await app.workflows.saveDraft(created.workflow.id, {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'e', type: 'end', config: { output: 'candidate' } },
          ],
          edges: [{ id: 'se', source: 's', target: 'e' }],
      });
      await app.workflows.publish(created.workflow.id);
      let deployment = await app.deployments.create({
        workflowId: created.workflow.id,
        name: 'Promotion admission',
        environment: 'promotion-admission',
        activeVersion: 1,
        allowedOrigins: [],
        sessionRateLimitPerMinute: 60,
        maxActiveSessions: 100,
        status: 'active',
      });
      deployment = await app.deployments.stage(deployment.id, 2, 100, deployment.revision);

      const staged = await app.storage.get<WorkflowVersion>(COLLECTIONS.versions, `${created.workflow.id}@2`);
      assert.ok(staged);
      await app.storage.put(COLLECTIONS.versions, `${created.workflow.id}@2`, {
        ...staged,
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'm', type: 'mcp', name: 'Unsafe candidate', config: { serverId: 'legacy', tool: 'write', arguments: {}, requireApproval: 'never' } },
            { id: 'e', type: 'end', config: { output: 'done' } },
          ],
          edges: [{ id: 'sm', source: 's', target: 'm' }, { id: 'me', source: 'm', target: 'e' }],
        },
      }, created.workflow.id);

      await assert.rejects(
        () => app.deployments.promoteCandidate(deployment.id, deployment.revision),
        /blocked by safety policy/i,
      );
      const unchanged = await app.deployments.get(deployment.id);
      assert.equal(unchanged?.activeVersion, 1);
      assert.equal(unchanged?.candidateReleaseId, deployment.candidateReleaseId);
      assert.equal((await app.deployments.listReleases(deployment.id)).filter((release) => release.kind === 'promotion').length, 0);
    } finally {
      await cleanup();
    }
  });

  it('revalidates pinned subflows at deployment admission', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const child = await app.workflows.create({ graph: {
        nodes: [
          { id: 's', type: 'start', config: {} },
          { id: 'e', type: 'end', config: { output: 'safe' } },
        ], edges: [{ id: 'se', source: 's', target: 'e' }],
      } });
      await app.workflows.publish(child.workflow.id);
      const childVersion = await app.storage.get<WorkflowVersion>(COLLECTIONS.versions, `${child.workflow.id}@1`);
      assert.ok(childVersion);
      await app.storage.put(COLLECTIONS.versions, `${child.workflow.id}@1`, {
        ...childVersion,
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'm', type: 'mcp', name: 'Unsafe nested call', config: { serverId: 'legacy', tool: 'write', arguments: {}, requireApproval: 'never' } },
            { id: 'e', type: 'end', config: { output: 'done' } },
          ],
          edges: [{ id: 'sm', source: 's', target: 'm' }, { id: 'me', source: 'm', target: 'e' }],
        },
      }, child.workflow.id);
      const parent = await app.workflows.create({ graph: {
        nodes: [
          { id: 's', type: 'start', config: {} },
          { id: 'call', type: 'subflow', config: { workflowId: child.workflow.id, version: 1, inputMappings: [], outputMappings: [], onError: 'fail', maxDepth: 8 } },
          { id: 'e', type: 'end', config: { output: '{{call.output_text}}' } },
        ], edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
      } });
      await app.workflows.publish(parent.workflow.id);
      await assert.rejects(() => app.deployments.create({ workflowId: parent.workflow.id, name: 'Nested safety', environment: 'nested-safety', activeVersion: 1, allowedOrigins: [], sessionRateLimitPerMinute: 60, maxActiveSessions: 100, status: 'active' }), /blocked by safety policy/i);
    } finally { await cleanup(); }
  });
});
