import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, waitForRun, type App } from './helpers.ts';
import { PRICING_CATALOG_VERSION } from '../src/services/pricing.ts';

let app: App;
let cleanup: () => Promise<void>;
let baseUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
});
after(async () => {
  await closeServer();
  await cleanup();
});

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

describe('API: health & errors', () => {
  it('GET /health', async () => {
    const { status, data } = await api('GET', '/api/v1/health');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });

  it('404 for unknown routes, 405 for wrong methods', async () => {
    assert.equal((await api('GET', '/api/v1/nope')).status, 404);
    assert.equal((await api('DELETE', '/api/v1/health')).status, 405);
  });

  it('400 for malformed JSON bodies', async () => {
    const res = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    assert.equal(res.status, 400);
  });
});

describe('API: workflow lifecycle', () => {
  let wfId: string;

  it('creates a workflow with the default canvas graph', async () => {
    const { status, data } = await api('POST', '/api/v1/workflows', { name: 'Support bot' });
    assert.equal(status, 200);
    wfId = data.workflow.id;
    assert.match(wfId, /^wf_/);
    assert.equal(data.workflow.draft.nodes.length, 3);
    assert.equal(data.validation.valid, true);
    assert.ok(Array.isArray(data.validation.safetyFindings));
  });

  it('autosaves a React Flow draft and reports validation', async () => {
    const { status, data } = await api('PUT', `/api/v1/workflows/${wfId}/draft`, {
      graph: {
        nodes: [
          { id: '1', type: 'start', data: { label: 'Start' }, position: { x: 50, y: 125 } },
          { id: '2', type: 'agent', data: { label: 'Helper', instructions: 'help', model: 'mock/echo' } },
          { id: '3', type: 'end', data: { label: 'End' } },
        ],
        edges: [
          { id: 'e1', source: '1', target: '2' },
          { id: 'e2', source: '2', target: '3' },
        ],
      },
    });
    assert.equal(status, 200);
    assert.equal(data.validation.valid, true);
    assert.equal(data.workflow.draft.nodes.length, 3);
  });

  it('treats an identical autosave as a no-op and preserves the draft revision', async () => {
    const current = await api('GET', `/api/v1/workflows/${wfId}`);
    const revision = current.data.workflow.draftRevision;
    const repeated = await api('PUT', `/api/v1/workflows/${wfId}/draft`, {
      graph: current.data.workflow.draft,
      expectedRevision: revision,
    });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.workflow.draftRevision, revision);
    assert.deepEqual(repeated.data.workflow.draft, current.data.workflow.draft);
  });

  it('lists, renames, publishes, versions', async () => {
    const list = await api('GET', '/api/v1/workflows');
    assert.ok(list.data.workflows.some((w: any) => w.id === wfId));

    const patched = await api('PATCH', `/api/v1/workflows/${wfId}`, { name: 'Support bot v2' });
    assert.equal(patched.data.workflow.name, 'Support bot v2');

    const duplicated = await api('POST', `/api/v1/workflows/${wfId}/duplicate`, {});
    assert.equal(duplicated.status, 200);
    assert.equal(duplicated.data.workflow.name, 'Support bot v2 copy');
    assert.notEqual(duplicated.data.workflow.id, wfId);
    assert.deepEqual(duplicated.data.workflow.draft, patched.data.workflow.draft);
    assert.equal(duplicated.data.workflow.latestVersion, 0);
    assert.equal((await api('DELETE', `/api/v1/workflows/${duplicated.data.workflow.id}`)).status, 200);

    const exported = await api('GET', `/api/v1/workflows/${wfId}/export-workflow`);
    assert.equal(exported.status, 200);
    assert.equal(exported.data.artifact.kind, 'willow.agent-workflow');
    assert.equal(exported.data.artifact.formatVersion, 1);
    const imported = await api('POST', '/api/v1/workflows/import', {
      artifact: exported.data.artifact,
      name: 'Imported support bot',
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.workflow.name, 'Imported support bot');
    assert.deepEqual(imported.data.workflow.draft, patched.data.workflow.draft);
    assert.equal((await api('DELETE', `/api/v1/workflows/${imported.data.workflow.id}`)).status, 200);

    const invalidImport = await api('POST', '/api/v1/workflows/import', {
      artifact: { kind: 'willow.agent-workflow', formatVersion: 99 },
    });
    assert.equal(invalidImport.status, 400);

    const pub = await api('POST', `/api/v1/workflows/${wfId}/publish`, { notes: 'first' });
    assert.equal(pub.status, 200);
    assert.equal(pub.data.version.version, 1);
    assert.ok(pub.data.version.validation.contracts.some((contract: any) => contract.nodeType === 'agent'));
    assert.ok(Array.isArray(pub.data.version.validation.safetyFindings));

    const versions = await api('GET', `/api/v1/workflows/${wfId}/versions`);
    assert.equal(versions.data.versions.length, 1);
    assert.equal(versions.data.versions[0].notes, 'first');
    assert.deepEqual(versions.data.versions[0].validation, pub.data.version.validation);

    const oversizedNotes = await api('POST', `/api/v1/workflows/${wfId}/publish`, { notes: 'x'.repeat(2001) });
    assert.equal(oversizedNotes.status, 400);
    assert.match(oversizedNotes.data.error.message, /2000/);
  });

  it('restores a published version into the draft', async () => {
    const changed = await api('PUT', `/api/v1/workflows/${wfId}/draft`, {
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: 'changed' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    assert.equal(changed.data.workflow.draft.nodes.length, 2);

    const beforeRejectedRestore = await api('GET', `/api/v1/workflows/${wfId}`);
    const malformedRestore = await api('POST', `/api/v1/workflows/${wfId}/versions/1junk/restore`, {
      expectedRevision: beforeRejectedRestore.data.workflow.draftRevision,
    });
    assert.equal(malformedRestore.status, 400);
    assert.match(malformedRestore.data.error.message, /positive integer/);
    const afterRejectedRestore = await api('GET', `/api/v1/workflows/${wfId}`);
    assert.equal(afterRejectedRestore.data.workflow.draftRevision, beforeRejectedRestore.data.workflow.draftRevision);
    assert.deepEqual(afterRejectedRestore.data.workflow.draft, beforeRejectedRestore.data.workflow.draft);

    const malformedVersionRead = await api('GET', `/api/v1/workflows/${wfId}/versions/1.5`);
    assert.equal(malformedVersionRead.status, 400);
    const malformedVersionExport = await api('GET', `/api/v1/workflows/${wfId}/export-workflow?version=-1`);
    assert.equal(malformedVersionExport.status, 400);

    const restored = await api('POST', `/api/v1/workflows/${wfId}/versions/1/restore`);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.validation.valid, true);
    assert.equal(restored.data.workflow.draft.nodes.length, 3);
    assert.equal(restored.data.workflow.latestVersion, 1);

    // Replaying the same restore is idempotent and must not advance the draft
    // revision or create an autosave conflict.
    const restoredAgain = await api('POST', `/api/v1/workflows/${wfId}/versions/1/restore`, {
      expectedRevision: restored.data.workflow.draftRevision,
    });
    assert.equal(restoredAgain.status, 200);
    assert.equal(restoredAgain.data.workflow.draftRevision, restored.data.workflow.draftRevision);
  });

  it('persists safety findings on published versions and portable exports', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'Safety metadata',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', data: { instructions: 'Use {{missing_agent.output_text}}', model: 'mock/echo' } },
          { id: 'e', type: 'end', config: { output: '$cel:unknown_result.value' } },
        ],
        edges: [
          { id: 'sa', source: 's', target: 'a' },
          { id: 'ae', source: 'a', target: 'e' },
        ],
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.validation.valid, true);
    assert.ok(created.data.validation.warnings.length >= 1);
    const workflowId = created.data.workflow.id;

    const published = await api('POST', `/api/v1/workflows/${workflowId}/publish`, { notes: 'safety snapshot' });
    assert.equal(published.status, 200);
    assert.deepEqual(
      published.data.version.validation.warnings,
      published.data.validation.warnings,
    );

    const version = await api('GET', `/api/v1/workflows/${workflowId}/versions/${published.data.version.version}`);
    assert.deepEqual(version.data.version.validation, published.data.version.validation);

    const exported = await api('GET', `/api/v1/workflows/${workflowId}/export-workflow?version=${published.data.version.version}`);
    assert.deepEqual(exported.data.artifact.workflow.validation, published.data.version.validation);
    assert.doesNotMatch(JSON.stringify(exported.data.artifact.workflow.validation), /secret|token|api[-_]?key/i);

    const imported = await api('POST', '/api/v1/workflows/import', { artifact: exported.data.artifact });
    assert.deepEqual(imported.data.validation.warnings, published.data.version.validation.warnings);
  });

  it('refuses to publish an invalid draft', async () => {
    const bad = await api('POST', '/api/v1/workflows', {
      name: 'broken',
      graph: { nodes: [{ id: 'a', type: 'agent', data: {} }], edges: [] }, // no start
    });
    const badId = bad.data.workflow.id;
    const pub = await api('POST', `/api/v1/workflows/${badId}/publish`, {});
    assert.equal(pub.status, 422);
  });

  it('exports TypeScript and Python code', async () => {
    const ts = await api('POST', `/api/v1/workflows/${wfId}/export`, { format: 'typescript' });
    assert.equal(ts.status, 200);
    assert.match(ts.data.code, /new Agent\(/);
    assert.match(ts.data.code, /runWorkflow/);
    const py = await api('POST', `/api/v1/workflows/${wfId}/export`, { format: 'python' });
    assert.match(py.data.code, /Agent\(/);
    assert.match(py.data.code, /async def run_workflow/);
    const tsSdk = await api('POST', `/api/v1/workflows/${wfId}/export`, { format: 'typescript-sdk' });
    assert.equal(tsSdk.data.bundle.language, 'typescript');
    assert.equal(tsSdk.data.bundle.entrypoint, 'src/index.ts');
    assert.equal(tsSdk.data.bundle.dependencies[0].name, '@openai/agents');
    assert.match(tsSdk.data.bundle.files['package.json'], /@openai\/agents/);
    const pySdk = await api('POST', `/api/v1/workflows/${wfId}/export`, { format: 'python-sdk' });
    assert.equal(pySdk.data.bundle.language, 'python');
    assert.equal(pySdk.data.bundle.entrypoint, 'main.py');
    assert.equal(pySdk.data.bundle.installCommand, 'python -m pip install .');
    assert.match(pySdk.data.bundle.files['pyproject.toml'], /openai-agents/);
  });

  it('exports pinned subflow dependencies and rejects non-portable imports', async () => {
    const child = await api('POST', '/api/v1/workflows', {
      name: 'Portable child',
      graph: {
        nodes: [{ id: 's', type: 'start', data: {} }, { id: 'e', type: 'end', config: { output: '{{workflow.input_as_text}}' } }],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const childId = child.data.workflow.id;
    assert.equal((await api('POST', `/api/v1/workflows/${childId}/publish`, {})).status, 200);
    const parent = await api('POST', '/api/v1/workflows', {
      name: 'Portable parent',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'call', type: 'subflow', config: { workflowId: childId, version: 1, inputMappings: [{ target: 'input_as_text', value: '{{workflow.input_as_text}}' }], outputMappings: [], onError: 'fail', maxDepth: 8 } },
          { id: 'e', type: 'end', config: { output: '{{call.output_text}}' } },
        ],
        edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
      },
    });
    const parentId = parent.data.workflow.id;
    const exported = await api('GET', `/api/v1/workflows/${parentId}/export-workflow`);
    assert.deepEqual(exported.data.artifact.dependencies.subflows, [{ nodeId: 'call', workflowId: childId, version: 1 }]);
    const tampered = structuredClone(exported.data.artifact);
    tampered.dependencies.subflows[0].version = 2;
    const tamperedImport = await api('POST', '/api/v1/workflows/import', { artifact: tampered });
    assert.equal(tamperedImport.status, 422);
    assert.equal(tamperedImport.data.error.code, 'invalid_dependencies');
    const imported = await api('POST', '/api/v1/workflows/import', { artifact: exported.data.artifact });
    assert.equal(imported.status, 200);
    await api('DELETE', `/api/v1/workflows/${imported.data.workflow.id}`);
    await api('DELETE', `/api/v1/workflows/${childId}`);
    const missing = await api('POST', '/api/v1/workflows/import', { artifact: exported.data.artifact });
    assert.equal(missing.status, 422);
    assert.equal(missing.data.error.code, 'missing_subflow_dependency');
    assert.match(missing.data.error.message, new RegExp(`${childId}@1`));
    await api('DELETE', `/api/v1/workflows/${parentId}`);
  });

  it('rejects imported subflows that are not pinned to a published version', async () => {
    const imported = await api('POST', '/api/v1/workflows/import', {
      artifact: {
        kind: 'willow.agent-workflow',
        formatVersion: 1,
        workflow: {
          name: 'Unpinned portable workflow',
          graph: {
            nodes: [
              { id: 's', type: 'start', data: {} },
              { id: 'call', type: 'subflow', config: { workflowId: '', version: 0 } },
              { id: 'e', type: 'end', config: { output: '{{call.output_text}}' } },
            ],
            edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
          },
        },
      },
    });
    assert.equal(imported.status, 422);
    assert.equal(imported.data.error.code, 'invalid_subflow_dependency');
  });

  it('excludes camel-case credential fields from portable workflow artifacts', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'Portable secret exclusion',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          {
            id: 'a',
            type: 'agent',
            config: {
              model: 'mock-echo',
              instructions: 'Keep configuration portable.',
              maxTokens: 321,
              tools: [{
                kind: 'function',
                name: 'local_tool',
                description: 'A local test tool',
                parameters: { type: 'object', properties: {} },
                execution: { mode: 'js', code: 'return args;' },
                accessToken: 'access-secret',
                clientSecret: 'client-secret',
                privateKey: 'private-secret',
              }],
            },
          },
          { id: 'e', type: 'end', config: { output: '{{a.output_text}}' } },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    });
    assert.equal(created.status, 200);

    const exported = await api('GET', `/api/v1/workflows/${created.data.workflow.id}/export-workflow`);
    assert.equal(exported.status, 200);
    const serialized = JSON.stringify(exported.data.artifact);
    assert.doesNotMatch(serialized, /access-secret|client-secret|private-secret/);
    const agent = exported.data.artifact.workflow.graph.nodes.find((node: any) => node.id === 'a');
    assert.equal(agent.config.maxTokens, 321);

    await api('DELETE', `/api/v1/workflows/${created.data.workflow.id}`);
  });

  it('runs the published version over HTTP and streams SSE events', async () => {
    const started = await api('POST', `/api/v1/workflows/${wfId}/runs`, {
      version: 1,
      input: { input_as_text: 'ping' },
    });
    assert.equal(started.status, 200);
    const runId = started.data.run.id;
    assert.match(runId, /^run_/);
    assert.equal(started.data.run.checkpoint, undefined); // opaque field hidden

    // poll until completed
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${runId}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(run.status, 'completed', run.error);

    assert.equal(run.output, 'ping');

    // SSE replay of a settled run
    const sse = await fetch(`${baseUrl}/api/v1/runs/${runId}/events`);
    assert.equal(sse.headers.get('content-type'), 'text/event-stream');
    const text = await sse.text();
    assert.match(text, /run\.completed/);
    assert.match(text, /event: llm\.delta/);
    const eventIds = [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    assert.ok(eventIds.length >= 4);
    assert.equal(new Set(eventIds).size, eventIds.length);
    assert.deepEqual(eventIds, [...eventIds].sort((a, b) => a - b));
    assert.match(text, /event: done/);

    const cursor = eventIds[Math.floor(eventIds.length / 2)];
    const resumed = await fetch(`${baseUrl}/api/v1/runs/${runId}/events?after=${cursor}`);
    const resumedText = await resumed.text();
    const resumedIds = [...resumedText.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    assert.ok(resumedIds.length > 0);
    assert.ok(resumedIds.every((id) => id > cursor));
    assert.equal(resumedIds.some((id) => id <= cursor), false);
    const malformedEventsCursor = await fetch(`${baseUrl}/api/v1/runs/${runId}/events?after=${cursor}junk`);
    assert.equal(malformedEventsCursor.status, 400);

    // trace endpoint
    const trace = await api('GET', `/api/v1/runs/${runId}/trace`);
    assert.ok(trace.data.events.length >= 4);

    const secondStarted = await api('POST', `/api/v1/workflows/${wfId}/runs`, {
      version: 1,
      input: { input_as_text: 'pong' },
    });
    let secondRun: any;
    for (let i = 0; i < 100; i++) {
      secondRun = (await api('GET', `/api/v1/runs/${secondStarted.data.run.id}`)).data.run;
      if (['completed', 'failed'].includes(secondRun.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(secondRun.status, 'completed', secondRun.error);
    const comparison = await api('GET', `/api/v1/runs/${runId}/compare?against=${secondRun.id}`);
    assert.equal(comparison.status, 200);
    assert.equal(comparison.data.comparison.leftRunId, runId);
    assert.equal(comparison.data.comparison.rightRunId, secondRun.id);
    assert.equal(comparison.data.comparison.outputChanged, true);
    assert.ok(comparison.data.comparison.spans.length > 0);
    const traceExport = await api('GET', `/api/v1/runs/${runId}/trace/export`);
    assert.equal(traceExport.status, 200);
    assert.equal(traceExport.data.export.kind, 'willow.run-trace');
    assert.equal(traceExport.data.export.formatVersion, 1);
    assert.ok(traceExport.data.export.events.length >= 4);
    assert.doesNotMatch(JSON.stringify(traceExport.data.export), /api[-_]?key|authorization|secret/i);

    // runs list
    const runs = await api('GET', `/api/v1/workflows/${wfId}/runs`);
    assert.ok(runs.data.runs.some((r: any) => r.id === runId));
  });

  it('deduplicates concurrent run creation with an idempotency key', async () => {
    const key = `run-retry-${Date.now()}`;
    const body = { input: { input_as_text: 'retry once' } };
    const [first, second] = await Promise.all([
      api('POST', `/api/v1/workflows/${wfId}/runs`, body, { 'idempotency-key': key }),
      api('POST', `/api/v1/workflows/${wfId}/runs`, body, { 'idempotency-key': key }),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.data.run.id, second.data.run.id);

    const concurrentConflictKey = `${key}-conflict`;
    const [accepted, rejected] = await Promise.all([
      api('POST', `/api/v1/workflows/${wfId}/runs`, body, { 'idempotency-key': concurrentConflictKey }),
      api(
        'POST',
        `/api/v1/workflows/${wfId}/runs`,
        { input: { input_as_text: 'concurrent mismatch' } },
        { 'idempotency-key': concurrentConflictKey },
      ),
    ]);
    assert.deepEqual([accepted.status, rejected.status].sort(), [200, 409]);

    const conflict = await api(
      'POST',
      `/api/v1/workflows/${wfId}/runs`,
      { input: { input_as_text: 'different request' } },
      { 'idempotency-key': key },
    );
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error.code, 'idempotency_conflict');

    const runs = await api('GET', `/api/v1/workflows/${wfId}/runs`);
    assert.equal(runs.data.runs.filter((run: any) => run.idempotencyKey === key).length, 1);
  });

  it('replays an idempotent run even after its workflow draft changes', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'durable retry' });
    const id = workflow.data.workflow.id;
    const key = `durable-${Date.now()}`;
    const first = await api('POST', `/api/v1/workflows/${id}/runs`, { input: { input_as_text: 'original' } }, { 'idempotency-key': key });
    assert.equal(first.status, 200);

    await api('PUT', `/api/v1/workflows/${id}/draft`, {
      graph: { nodes: [{ id: 'broken', type: 'agent', config: { model: 'mock/echo' } }], edges: [] },
    });
    const replay = await api('POST', `/api/v1/workflows/${id}/runs`, { input: { input_as_text: 'original' } }, { 'idempotency-key': key });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.run.id, first.data.run.id);
  });

  it('replays a draft run against its immutable graph snapshot and original normalized input', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'faithful draft replay',
      graph: {
        nodes: [
          { id: 'start', type: 'start', config: {
            inputVariables: [{ name: 'audience', type: 'string' }],
            stateVariables: [{ name: 'topic', type: 'string', defaultValue: 'default' }],
          } },
          { id: 'end', type: 'end', config: { output: 'ORIGINAL {{state.topic}}' } },
        ],
        edges: [{ id: 'edge', source: 'start', target: 'end' }],
      },
    });
    const workflowId = created.data.workflow.id;
    const input = {
      input_as_text: 'hello',
      variables: { audience: 'support' },
      state_variables: { topic: 'billing' },
      history: [{ role: 'user', content: 'earlier turn' }, { role: 'assistant', content: 'earlier answer' }],
      attachments: [{ name: 'pixel.png', mimeType: 'image/png', contentBase64: 'aW1hZ2U=' }],
    };
    const first = await api('POST', `/api/v1/workflows/${workflowId}/runs`, { input });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const settledFirst = await waitForRun(app, first.data.run.id);
    assert.equal(settledFirst.output, 'ORIGINAL billing');

    const workflow = await api('GET', `/api/v1/workflows/${workflowId}`);
    const changed = structuredClone(workflow.data.workflow.draft);
    const end = changed.nodes.find((node: any) => node.id === 'end');
    end.config.output = 'CHANGED {{state.topic}}';
    assert.equal((await api('PUT', `/api/v1/workflows/${workflowId}/draft`, { graph: changed })).status, 200);

    const replay = await api('POST', `/api/v1/runs/${first.data.run.id}/replay`);
    assert.equal(replay.status, 200);
    assert.notEqual(replay.data.run.id, first.data.run.id);
    assert.deepEqual(replay.data.run.input, settledFirst.input);
    const settledReplay = await waitForRun(app, replay.data.run.id);
    assert.equal(settledReplay.output, 'ORIGINAL billing');
    assert.equal(settledReplay.workflowVersion, 0);
  });

  it('approval flow over HTTP', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'approval',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'u', type: 'userApproval', config: { message: 'ok?' } },
          { id: 'y', type: 'end', config: { output: 'YES' } },
          { id: 'n', type: 'end', config: { output: 'NO' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'u' },
          { id: 'e2', source: 'u', target: 'y', sourceHandle: 'approved' },
          { id: 'e3', source: 'u', target: 'n', sourceHandle: 'rejected' },
        ],
      },
    });
    const id = created.data.workflow.id;
    const started = await api('POST', `/api/v1/workflows/${id}/runs`, { input: {} });
    const runId = started.data.run.id;

    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${runId}`)).data.run;
      if (run.status === 'awaiting_approval') break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(run.status, 'awaiting_approval');
    const approvalId = run.pendingApproval.id;
    const pausedSpans = await api('GET', `/api/v1/runs/${runId}/spans?after=0`);
    assert.equal(pausedSpans.status, 200);
    assert.ok(pausedSpans.data.cursor > 0);
    assert.ok(pausedSpans.data.spans.some((span: any) => span.type === 'approval' && span.status === 'running'));
    const unchangedSpans = await api('GET', `/api/v1/runs/${runId}/spans?after=${pausedSpans.data.cursor}`);
    assert.deepEqual(unchangedSpans.data.spans, []);

    // wrong approval id -> 409/404 family
    const bad = await api('POST', `/api/v1/runs/${runId}/approvals/appr_bogus`, { approved: true });
    assert.equal(bad.status, 409);

    const approvalHeaders = { 'idempotency-key': `approval-${runId}` };
    const ok = await api('POST', `/api/v1/runs/${runId}/approvals/${approvalId}`, {
      approved: true,
      resolvedBy: {
        id: 'spoofed-actor',
        subjectId: 'spoofed-subject',
        workspaceId: 'spoofed-workspace',
        role: 'admin',
        kind: 'api_key',
        apiKeyId: 'spoofed-key',
      },
    }, approvalHeaders);
    assert.equal(ok.status, 200);
    const approvalRetry = await api('POST', `/api/v1/runs/${runId}/approvals/${approvalId}`, { approved: true }, approvalHeaders);
    assert.equal(approvalRetry.status, 200);
    assert.equal(approvalRetry.data.run.id, runId);

    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${runId}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(run.output, 'YES');
    const resolved = (await app.engine.pastEvents(runId)).find((event: any) => event.type === 'approval.resolved') as any;
    assert.ok(resolved?.resolvedBy);
    assert.notEqual(resolved.resolvedBy.id, 'spoofed-actor');
    assert.notEqual(resolved.resolvedBy.subjectId, 'spoofed-subject');
    assert.notEqual(resolved.resolvedBy.workspaceId, 'spoofed-workspace');
    assert.notEqual(resolved.resolvedBy.apiKeyId, 'spoofed-key');
    const resumedSpans = await api('GET', `/api/v1/runs/${runId}/spans?after=${pausedSpans.data.cursor}`);
    assert.ok(resumedSpans.data.cursor > pausedSpans.data.cursor);
    assert.ok(resumedSpans.data.spans.some((span: any) => span.type === 'approval' && span.status === 'ok'));
    assert.equal((await api('GET', `/api/v1/runs/${runId}/spans?after=invalid`)).status, 400);
    assert.equal((await api('GET', `/api/v1/runs/${runId}/spans?after=12junk`)).status, 400);
  });

  it('validates and coerces declared workflow inputs', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'typed inputs',
      graph: {
        nodes: [
          {
            id: 's',
            type: 'start',
            config: {
              inputVariables: [
                { name: 'count', type: 'number' },
                { name: 'mode', type: 'string', defaultValue: 'standard' },
              ],
              stateVariables: [{ name: 'enabled', type: 'boolean', initialValue: false }],
            },
          },
          { id: 'e', type: 'end', config: { output: '$cel:workflow.count' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const id = created.data.workflow.id;

    const started = await api('POST', `/api/v1/workflows/${id}/runs`, {
      input: {
        variables: { count: '4' },
        state_variables: { enabled: 'true' },
      },
    });
    assert.equal(started.status, 200);
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${started.data.run.id}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(run.status, 'completed', run.error);
    assert.equal(run.output, 4);
    assert.equal(run.input.variables.count, 4);
    assert.equal(run.input.variables.mode, 'standard');
    assert.equal(run.state.enabled, true);

    const unknown = await api('POST', `/api/v1/workflows/${id}/runs`, {
      input: { variables: { missing: 'value' } },
    });
    assert.equal(unknown.status, 422);
    assert.match(unknown.data.error.message, /unknown workflow variable 'missing'/);

    const missing = await api('POST', `/api/v1/workflows/${id}/runs`, { input: {} });
    assert.equal(missing.status, 422);
    assert.match(missing.data.error.message, /missing required workflow variable 'count'/);
  });

  it('rejects unsafe or oversized preview attachments before creating a run', async () => {
    const unsupported = await api('POST', `/api/v1/workflows/${wfId}/runs`, {
      input: { attachments: [{ name: 'script.exe', mimeType: 'application/octet-stream', contentBase64: 'AA==' }] },
    });
    assert.equal(unsupported.status, 422);
    assert.match(unsupported.data.error.message, /unsupported MIME type/);

    const tooMany = await api('POST', `/api/v1/workflows/${wfId}/runs`, {
      input: { attachments: Array.from({ length: 9 }, (_, index) => ({ name: `${index}.txt`, mimeType: 'text/plain', contentBase64: 'YQ==' })) },
    });
    assert.equal(tooMany.status, 422);
    assert.match(tooMany.data.error.message, /cannot exceed 8/);

    const malformedBase64 = await api('POST', `/api/v1/workflows/${wfId}/runs`, {
      input: { attachments: [{ name: 'notes.txt', mimeType: 'text/plain', contentBase64: 'YQ' }] },
    });
    assert.equal(malformedBase64.status, 422);
    assert.match(malformedBase64.data.error.message, /needs base64 content/);
  });

  it('deletes a workflow', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'temp' });
    const id = created.data.workflow.id;
    assert.equal((await api('DELETE', `/api/v1/workflows/${id}`)).status, 200);
    assert.equal((await api('GET', `/api/v1/workflows/${id}`)).status, 404);
  });

  it('deletes ChatKit sessions and threads owned by a workflow', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'chat cleanup' });
    const id = created.data.workflow.id;
    assert.equal((await api('POST', `/api/v1/workflows/${id}/publish`, {})).status, 200);
    const session = await app.chat.createSession({ workflowId: id, version: 1, user: 'cleanup-test' });
    const thread = await app.chat.createThread(session.id, session.clientSecret);

    assert.equal((await api('DELETE', `/api/v1/workflows/${id}`)).status, 200);
    assert.equal(await app.storage.get('sessions', session.id), undefined);
    assert.equal(await app.storage.get('threads', thread.id), undefined);
  });
});

describe('API: workflow metadata concurrency', () => {
  it('rejects stale rename/description edits instead of overwriting a newer draft', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'Metadata conflict' });
    assert.equal(created.status, 200);
    const id = created.data.workflow.id;
    const revision = created.data.workflow.draftRevision;
    const first = await api('PATCH', `/api/v1/workflows/${id}`, {
      name: 'First tab', expectedRevision: revision,
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.workflow.draftRevision, revision + 1);
    const stale = await api('PATCH', `/api/v1/workflows/${id}`, {
      name: 'Stale tab', expectedRevision: revision,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error.code, 'draft_revision_conflict');
    assert.equal(stale.data.error.details.currentRevision, revision + 1);
    const current = await api('GET', `/api/v1/workflows/${id}`);
    assert.equal(current.data.workflow.name, 'First tab');
    await api('DELETE', `/api/v1/workflows/${id}`);
  });
});

describe('API: workflow templates and data contracts', () => {
  it('lists templates and creates a validated router template', async () => {
    const templates = await api('GET', '/api/v1/workflow-templates');
    assert.equal(templates.status, 200);
    assert.ok(templates.data.templates.some((t: any) => t.id === 'router'));
    assert.ok(templates.data.templates.some((t: any) => t.id === 'approved-mcp-action' && t.riskLevel === 'high'));
    assert.ok(templates.data.templates.every((t: any) => t.preview.nodes.length > 0 && Array.isArray(t.preview.contracts)));
    const externalAction = templates.data.templates.find((t: any) => t.id === 'approved-mcp-action');
    assert.ok(externalAction.preview.riskFactors.some((factor: any) => factor.code === 'EXTERNAL_ACTION' && factor.level === 'high' && factor.nodeId === 'action'));
    assert.deepEqual(externalAction.preview.safetyFindings, [], 'a safely configured high-risk capability should remain distinct from safety findings');
    const filtered = await api('GET', '/api/v1/workflow-templates?tag=approval&riskLevel=high');
    assert.deepEqual(filtered.data.templates.map((template: any) => template.id), ['approved-mcp-action']);

    const created = await api('POST', '/api/v1/workflows/from-template', {
      templateId: 'router',
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.validation.valid, true, JSON.stringify(created.data.validation.errors));
    assert.ok(created.data.validation.contracts.some((c: any) => c.nodeType === 'agent'));
    assert.equal(created.data.workflow.name, 'Router and specialists');
  });

  it('snapshots and diffs published node contracts', async () => {
    const graph = (includeConfidence: boolean) => ({
      nodes: [
        { id: 's', type: 'start', data: {} },
        {
          id: 'a',
          type: 'agent',
          config: {
            model: 'mock/json',
            outputFormat: 'json',
            outputSchema: {
              type: 'object',
              properties: {
                answer: { type: 'string' },
                ...(includeConfidence ? { confidence: { type: 'number' } } : {}),
              },
              required: includeConfidence ? ['answer', 'confidence'] : ['answer'],
              additionalProperties: false,
            },
          },
        },
        { id: 'e', type: 'end', config: { output: '{{agent.output_parsed}}' } },
      ],
      edges: [
        { id: 'sa', source: 's', target: 'a' },
        { id: 'ae', source: 'a', target: 'e' },
      ],
    });
    const created = await api('POST', '/api/v1/workflows', { name: 'Contract versions', graph: graph(false) });
    const workflowId = created.data.workflow.id;
    const first = await api('POST', `/api/v1/workflows/${workflowId}/publish`, {});
    await api('PUT', `/api/v1/workflows/${workflowId}/draft`, { graph: graph(true) });
    const second = await api('POST', `/api/v1/workflows/${workflowId}/publish`, {});
    assert.equal(first.data.version.version, 1);
    assert.equal(second.data.version.version, 2);

    const diff = await api('GET', `/api/v1/workflows/${workflowId}/contract-diff?from=1&to=2`);
    assert.equal(diff.status, 200);
    const agentChange = diff.data.diff.changed.find((change: any) => change.nodeId === 'a');
    assert.ok(agentChange);
    assert.ok(!agentChange.before.outputs.some((field: any) => field.name === 'output_parsed.confidence'));
    assert.ok(agentChange.after.outputs.some((field: any) => field.name === 'output_parsed.confidence' && field.required));

    const exported = await api('GET', `/api/v1/workflows/${workflowId}/export-workflow?version=2`);
    assert.deepEqual(exported.data.artifact.workflow.validation.contracts, second.data.version.validation.contracts);
    const imported = await api('POST', '/api/v1/workflows/import', { artifact: exported.data.artifact });
    assert.deepEqual(imported.data.validation.contracts, second.data.version.validation.contracts);
    const code = await api('POST', `/api/v1/workflows/${workflowId}/export`, { format: 'typescript', version: 2 });
    assert.match(code.data.code, /confidence/);
  });

  it('returns a useful not-found error for unknown templates', async () => {
    const response = await api('POST', '/api/v1/workflows/from-template', { templateId: 'missing' });
    assert.equal(response.status, 404);
    assert.match(response.data.error.message, /template 'missing'/);
  });
});

describe('API: publish concurrency and immutable provenance', () => {
  it('publishes once for a reused idempotency key and rejects stale revisions', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'Publish integrity' });
    assert.equal(created.status, 200);
    const workflowId = created.data.workflow.id;
    const initialRevision = created.data.workflow.draftRevision;
    assert.equal(initialRevision, 1);

    const request = { notes: 'immutable release', expectedRevision: initialRevision };
    const headers = { 'idempotency-key': 'publish-integrity-1' };
    const [first, replay] = await Promise.all([
      api('POST', `/api/v1/workflows/${workflowId}/publish`, request, headers),
      api('POST', `/api/v1/workflows/${workflowId}/publish`, request, headers),
    ]);
    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(first.data.version.version, 1);
    assert.deepEqual(replay.data.version, first.data.version);
    assert.equal(first.data.version.sourceDraftRevision, initialRevision);
    assert.equal(
      first.data.version.sourceDraftHash,
      createHash('sha256').update(JSON.stringify(first.data.version.graph)).digest('hex'),
    );
    assert.equal(first.data.workflow.draftRevision, initialRevision + 1);

    const stale = await api(
      'POST',
      `/api/v1/workflows/${workflowId}/publish`,
      { expectedRevision: initialRevision },
      { 'idempotency-key': 'publish-integrity-stale' },
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error.code, 'draft_revision_conflict');
    assert.equal(stale.data.error.details.expectedRevision, initialRevision);
    assert.equal(stale.data.error.details.currentRevision, initialRevision + 1);
  });
});

describe('API: trace evaluations', () => {
  it('queries, paginates, exports, and retains traces without deleting audit-pinned runs', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'trace query' });
    const workflowId = created.data.workflow.id;
    const runIds: string[] = [];
    for (const input of ['one', 'two', 'three']) {
      const started = await api('POST', `/api/v1/workflows/${workflowId}/runs`, { input: { input_as_text: input } });
      runIds.push(started.data.run.id);
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = (await api('GET', `/api/v1/runs/${started.data.run.id}`)).data.run;
        if (['completed', 'failed', 'cancelled'].includes(current.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    const firstPage = await api('GET', `/api/v1/workflows/${workflowId}/runs?status=completed&type=node&limit=1`);
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.data.runs.length, 1);
    assert.ok(firstPage.data.nextCursor);
    const secondPage = await api('GET', `/api/v1/workflows/${workflowId}/runs?status=completed&type=node&limit=1&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`);
    assert.equal(secondPage.data.runs.length, 1);
    assert.notEqual(secondPage.data.runs[0].id, firstPage.data.runs[0].id);

    for (const invalidLimit of ['0', '-1', '1.5', '1junk', '101', '']) {
      assert.equal((await api('GET', `/api/v1/workflows/${workflowId}/runs?limit=${invalidLimit}`)).status, 400);
      assert.equal((await api('GET', `/api/v1/runs?limit=${invalidLimit}`)).status, 400);
    }
    for (const invalidCursor of ['not-base64!', 'YWJj', 'AAAA']) {
      assert.equal((await api('GET', `/api/v1/workflows/${workflowId}/runs?cursor=${encodeURIComponent(invalidCursor)}`)).status, 400);
      assert.equal((await api('GET', `/api/v1/runs?cursor=${encodeURIComponent(invalidCursor)}`)).status, 400);
    }
    assert.equal((await api('GET', `/api/v1/workflows/${workflowId}/runs?status=bogus`)).status, 400);
    assert.equal((await api('GET', '/api/v1/runs?status=bogus')).status, 400);

    const exported = await api('GET', `/api/v1/runs/${runIds[0]}/trace/export`);
    assert.equal(exported.data.export.kind, 'willow.run-trace');
    assert.equal(exported.data.export.run.id, runIds[0]);
    assert.ok(exported.data.export.events.length > 0);
    assert.ok(exported.data.export.spans.length > 0);

    const definition = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'status', type: 'run_status', expected: 'completed' }],
    });
    const evaluationRun = await api('POST', `/api/v1/evaluations/${definition.data.evaluation.id}/run`, { runIds: [runIds[0]] });
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = (await api('GET', `/api/v1/evaluation-runs/${evaluationRun.data.run.id}`)).data.run;
      if (['completed', 'failed', 'cancelled'].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const retained = await api('POST', '/api/v1/traces/retention', { maxRuns: 1 });
    assert.ok(retained.data.deleted >= 1);
    assert.ok(retained.data.protected >= 1);
    assert.equal((await api('GET', `/api/v1/runs/${runIds[0]}`)).status, 200);
    const survivors = await api('GET', `/api/v1/workflows/${workflowId}/runs`);
    assert.ok(survivors.data.runs.length <= 2);
  });

  it('rejects malformed grader definitions when they are saved', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'grader validation' });
    const workflowId = created.data.workflow.id;
    const invalidRegex = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'regex', type: 'regex', expected: '[' }],
    });
    assert.equal(invalidRegex.status, 400);
    assert.match(invalidRegex.data.error.message, /regular expression/);

    const duplicateIds = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [
        { id: 'same', type: 'run_status', expected: 'completed' },
        { id: 'same', type: 'event_count', expected: -1 },
      ],
    });
    assert.equal(duplicateIds.status, 400);
    assert.match(duplicateIds.data.error.message, /duplicate id/);

    const invalidCases = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'status', type: 'run_status', expected: 'completed' }],
      testCases: [
        { id: 'same', input: { input_as_text: 'one' }, version: 0 },
        { id: 'same', input: { input_as_text: 'two' }, version: -1 },
      ],
    });
    assert.equal(invalidCases.status, 400);
    assert.match(invalidCases.data.error.message, /duplicate id/);

    const invalidJudge = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'judge', type: 'model_judge', model: 'mock/json', rubric: 'Be correct', threshold: 2 }],
    });
    assert.equal(invalidJudge.status, 400);
    assert.match(invalidJudge.data.error.message, /threshold/);

    const invalidWeight = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'weighted', type: 'contains', expected: 'x', weight: 0 }],
    });
    assert.equal(invalidWeight.status, 400);
    assert.match(invalidWeight.data.error.message, /weight/);

    const invalidTarget = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'target', type: 'contains', nodeId: 'missing_node', spanType: 'node', field: 'output', expected: 'x' }],
    });
    assert.equal(invalidTarget.status, 400);
    assert.match(invalidTarget.data.error.message, /unknown node/);

    const invalidLabels = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'labels', type: 'label_model_judge', model: 'mock/json', labels: ['good', 'good'], passingLabels: ['good'] }],
    });
    assert.equal(invalidLabels.status, 400);
    assert.match(invalidLabels.data.error.message, /unique non-empty labels/);

    const invalidPassingLabels = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'labels', type: 'label_model_judge', model: 'mock/json', labels: ['good', 'bad'], passingLabels: ['unknown'] }],
    });
    assert.equal(invalidPassingLabels.status, 400);
    assert.match(invalidPassingLabels.data.error.message, /subset of labels/);
  });

  it('accepts every documented run status for status graders', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'status grader coverage' });
    const workflowId = created.data.workflow.id;
    const statuses = ['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug', 'completed', 'failed', 'cancelled'];
    const response = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: statuses.map((expected, index) => ({ id: `status_${index}`, type: 'run_status', expected })),
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.evaluation.graders.length, statuses.length);
  });

  it('persists reusable evaluation test cases and pinned versions', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'dataset evaluation' });
    const workflowId = created.data.workflow.id;
    const definition = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      name: 'Regression dataset',
      graders: [{ id: 'status', type: 'run_status', expected: 'completed' }],
      testCases: [{
        id: 'greeting',
        name: 'Friendly greeting',
         input: {
           input_as_text: 'Say hello',
           variables: { audience: 'developer' },
           attachments: [
             { name: 'prompt.txt', mimeType: 'text/plain', contentBase64: 'SGVsbG8gZGF0YXNldA==' },
             { name: 'sample.mp3', mimeType: 'audio/mpeg', contentBase64: 'YXVkaW8=' },
             { name: 'clip.mp4', mimeType: 'video/mp4', contentBase64: 'dmlkZW8=' },
           ],
         },
        version: 0,
      }],
    });
    assert.equal(definition.status, 200);
    const persistedCase = definition.data.evaluation.testCases[0];
    assert.equal(persistedCase.id, 'greeting');
    assert.equal(persistedCase.input.input_as_text, 'Say hello');
    assert.deepEqual(persistedCase.input.attachments[0], {
      name: 'prompt.txt',
      mimeType: 'text/plain',
      contentBase64: 'SGVsbG8gZGF0YXNldA==',
      kind: 'document',
      bytes: 13,
      sha256: '02dd3e96c4612a21dd2e5b275d8dc1dc37abd74b15bdfba6402ab16308c6f23e',
    });
    assert.deepEqual(persistedCase.input.attachments[1], {
      name: 'sample.mp3',
      mimeType: 'audio/mpeg',
      contentBase64: 'YXVkaW8=',
      kind: 'audio',
      bytes: 5,
      sha256: '6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b',
    });
    assert.deepEqual(persistedCase.input.attachments[2], {
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      contentBase64: 'dmlkZW8=',
      kind: 'video',
      bytes: 5,
      sha256: '0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc',
    });

    const updated = await api('PATCH', `/api/v1/evaluations/${definition.data.evaluation.id}`, {
      testCases: [{
        id: 'published',
        name: 'Published regression',
        input: { input_as_text: 'Pinned input' },
        version: 2,
      }],
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.evaluation.testCases[0].version, 2);
    assert.equal(updated.data.evaluation.testCases[0].input.input_as_text, 'Pinned input');
  });

  it('executes saved evaluation test cases instead of grading historical runs', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'case execution' });
    const workflowId = created.data.workflow.id;
    const unrelated = await api('POST', `/api/v1/workflows/${workflowId}/runs`, {
      input: { input_as_text: 'unrelated historical run' },
    });
    assert.equal(unrelated.status, 200);

    const definition = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      name: 'Generated cases',
      graders: [{ id: 'marker', type: 'contains', expected: 'evaluation case marker' }],
      testCases: [{
        id: 'case-1',
        name: 'Generated case',
        input: { input_as_text: 'evaluation case marker' },
        version: 0,
      }],
    });
    assert.equal(definition.status, 200);
    const started = await api('POST', `/api/v1/evaluations/${definition.data.evaluation.id}/run`, {});
    assert.equal(started.status, 200);
    let evaluated = started.data.run;
    for (let attempt = 0; attempt < 200; attempt++) {
      evaluated = (await api('GET', `/api/v1/evaluation-runs/${evaluated.id}`)).data.run;
      if (['completed', 'failed', 'cancelled'].includes(evaluated.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(evaluated.status, 'completed', evaluated.error);
    assert.equal(evaluated.totalRuns, 1);
    assert.equal(evaluated.completedRuns, 1);
    assert.equal(evaluated.caseRuns.length, 1);
    assert.equal(evaluated.caseRuns[0].testCaseId, 'case-1');
    assert.equal(evaluated.runIds.length, 1);
    assert.equal(evaluated.results.length, 1);
    assert.equal(evaluated.results[0].runId, evaluated.runIds[0]);
    assert.equal(evaluated.results[0].results[0].passed, true);
    assert.notEqual(evaluated.runIds[0], unrelated.data.run.id);
  });

  it('runs deterministic graders against a workflow trace', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'evaluated',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', data: { label: 'Answer', model: 'mock/echo', instructions: 'Echo the input.' } },
          { id: 'e', type: 'end', data: { label: 'End', config: { output: '{{answer.output_text}}' } } },
        ],
        edges: [
          { id: 'sa', source: 's', target: 'a' },
          { id: 'ae', source: 'a', target: 'e' },
        ],
      },
    });
    const workflowId = created.data.workflow.id;
    const started = await api('POST', `/api/v1/workflows/${workflowId}/runs`, {
      input: { input_as_text: 'evaluation marker' },
    });
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${started.data.run.id}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(run.status, 'completed', run.error);

    const secondStarted = await api('POST', `/api/v1/workflows/${workflowId}/runs`, {
      input: { input_as_text: 'second evaluation marker' },
    });
    let secondRun: any;
    for (let i = 0; i < 100; i++) {
      secondRun = (await api('GET', `/api/v1/runs/${secondStarted.data.run.id}`)).data.run;
      if (['completed', 'failed'].includes(secondRun.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(secondRun.status, 'completed', secondRun.error);

    const definition = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      name: 'Smoke graders',
      graders: [
        { id: 'status', name: 'Completed', type: 'run_status', expected: 'completed' },
        { id: 'marker', name: 'Contains marker', type: 'contains', expected: 'evaluation marker' },
        { id: 'nodes', name: 'Has node trace', type: 'event_count', eventType: 'node.completed', expected: 1 },
        { id: 'nodeOutput', name: 'Agent output', type: 'contains', nodeId: 'a', spanType: 'node', field: 'output', occurrence: 0, expected: 'evaluation marker' },
        { id: 'judge', name: 'Model quality judge', type: 'model_judge', model: 'mock/json', rubric: 'The output should answer the user input.', threshold: 0.75 },
        { id: 'label', name: 'Outcome label', type: 'label_model_judge', model: 'mock/json', rubric: 'Classify response quality.', labels: ['acceptable', 'needs_review'], passingLabels: ['acceptable'] },
      ],
    });
    assert.equal(definition.status, 200);
    const evaluationHeaders = { 'idempotency-key': `evaluation-${definition.data.evaluation.id}` };
    const evaluated = await api('POST', `/api/v1/evaluations/${definition.data.evaluation.id}/run`, {
      runIds: [run.id, secondRun.id],
    }, evaluationHeaders);
    assert.equal(evaluated.status, 200);
    assert.ok(['queued', 'running'].includes(evaluated.data.run.status));
    assert.notEqual(evaluated.data.run.status, 'completed');
    let evaluatedRun = evaluated.data.run;
    for (let i = 0; i < 100; i++) {
      evaluatedRun = (await api('GET', `/api/v1/evaluation-runs/${evaluated.data.run.id}`)).data.run;
      if (['completed', 'failed', 'cancelled'].includes(evaluatedRun.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(evaluatedRun.status, 'completed', evaluatedRun.error);
    assert.equal(evaluatedRun.completedRuns, 2);
    assert.equal(evaluatedRun.totalRuns, 2);
    assert.equal(evaluatedRun.runIds.length, 2);
    assert.deepEqual(evaluatedRun.runIds, [run.id, secondRun.id]);
    assert.equal(evaluatedRun.results.length, 2);
    assert.equal(evaluatedRun.results[0].score, 1);
    assert.equal(evaluatedRun.results[1].score, 1);
    const judgeResult = evaluatedRun.results[0].results.find((result: any) => result.graderId === 'judge');
    assert.equal(judgeResult.passed, true);
    assert.equal(judgeResult.model, 'mock/json');
    assert.equal(judgeResult.provider, 'mock');
    assert.equal(judgeResult.usage.modelCalls, 1);
    assert.equal(judgeResult.usage.provider, 'mock');
    assert.equal(judgeResult.usage.model, 'mock/json');
    assert.equal(judgeResult.usage.pricingCatalogVersion, PRICING_CATALOG_VERSION);
    assert.equal(judgeResult.usage.estimatedCostUsd, 0);
    assert.equal(judgeResult.usage.unpricedModelCalls, 0);
    assert.equal(judgeResult.usage.byModel['mock:mock/json'].llmCalls, 1);
    const labelResult = evaluatedRun.results[0].results.find((result: any) => result.graderId === 'label');
    assert.equal(labelResult.label, 'acceptable');
    assert.equal(labelResult.passed, true);
    assert.equal(labelResult.score, 1);
    assert.equal(labelResult.usage.byModel['mock:mock/json'].llmCalls, 1);
    assert.equal(evaluatedRun.results[0].usage.modelCalls, 2);
    assert.equal(evaluatedRun.usage.modelCalls, 4);
    const scopedResult = evaluatedRun.results[0].results.find((result: any) => result.graderId === 'nodeOutput');
    assert.equal(scopedResult.targetFound, true);
    assert.match(scopedResult.targetKey, /^node:a:0$/);

    const missingTargetDefinition = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'missing', type: 'contains', nodeId: 'a', spanType: 'tool', field: 'result', expected: 'never' }],
    });
    assert.equal(missingTargetDefinition.status, 200);
    const missingTargetRun = await api('POST', `/api/v1/evaluations/${missingTargetDefinition.data.evaluation.id}/run`, { runIds: [run.id] });
    let missingResultRun = missingTargetRun.data.run;
    for (let attempt = 0; attempt < 100; attempt++) {
      missingResultRun = (await api('GET', `/api/v1/evaluation-runs/${missingResultRun.id}`)).data.run;
      if (missingResultRun.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const missingResult = missingResultRun.results[0].results[0];
    assert.equal(missingResult.targetFound, false);
    assert.match(missingResult.detail, /target span not found/);
    assert.equal(evaluatedRun.usage.pricingCatalogVersion, PRICING_CATALOG_VERSION);
    assert.equal(evaluatedRun.usage.estimatedCostUsd, 0);
    assert.equal(evaluatedRun.usage.unpricedModelCalls, 0);
    assert.equal(evaluatedRun.usage.byModel['mock:mock/json'].llmCalls, 4);
    const evaluationRetry = await api('POST', `/api/v1/evaluations/${definition.data.evaluation.id}/run`, {
      runIds: [run.id, secondRun.id],
    }, evaluationHeaders);
    assert.equal(evaluationRetry.status, 200);
    assert.equal(evaluationRetry.data.run.id, evaluated.data.run.id);
    const evaluationStatus = await api('GET', `/api/v1/evaluation-runs/${evaluated.data.run.id}`);
    assert.equal(evaluationStatus.status, 200);
    assert.equal(evaluationStatus.data.run.status, 'completed');

    const weightedDefinition = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      name: 'Weighted quality',
      graders: [
        { id: 'pass', type: 'run_status', expected: 'completed', weight: 1 },
        { id: 'fail', type: 'contains', expected: 'not present', weight: 3 },
      ],
    });
    const weighted = await api('POST', `/api/v1/evaluations/${weightedDefinition.data.evaluation.id}/run`, { runIds: [run.id] });
    assert.equal(weighted.status, 200);
    let weightedRun = weighted.data.run;
    for (let i = 0; i < 100; i++) {
      weightedRun = (await api('GET', `/api/v1/evaluation-runs/${weighted.data.run.id}`)).data.run;
      if (['completed', 'failed', 'cancelled'].includes(weightedRun.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(weightedRun.status, 'completed', weightedRun.error);
    assert.equal(weightedRun.results[0].score, 0.25);
    await api('DELETE', `/api/v1/evaluations/${weightedDefinition.data.evaluation.id}`);

    const updated = await api('PATCH', `/api/v1/evaluations/${definition.data.evaluation.id}`, {
      name: 'Updated graders',
      graders: [{ id: 'status', type: 'run_status', expected: 'completed' }],
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.evaluation.name, 'Updated graders');
    assert.equal(updated.data.evaluation.graders.length, 1);

    const history = await api('GET', `/api/v1/evaluations/${definition.data.evaluation.id}/runs`);
    assert.equal(history.status, 200);
    assert.equal(history.data.runs.length, 1);
    const pagedHistory = await api('GET', `/api/v1/evaluations/${definition.data.evaluation.id}/runs?limit=1&offset=1&status=completed`);
    assert.equal(pagedHistory.status, 200);
    assert.deepEqual(pagedHistory.data.runs, []);
    const invalidHistoryFilter = await api('GET', `/api/v1/evaluations/${definition.data.evaluation.id}/runs?status=bogus`);
    assert.equal(invalidHistoryFilter.status, 400);

    const removed = await api('DELETE', `/api/v1/evaluations/${definition.data.evaluation.id}`);
    assert.equal(removed.status, 200);
    const missing = await api('GET', `/api/v1/evaluations/${definition.data.evaluation.id}`);
    assert.equal(missing.status, 404);
  });

  it('rejects empty and foreign run selections instead of evaluating the wrong dataset', async () => {
    const first = await api('POST', '/api/v1/workflows', {
      name: 'selection owner',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: 'ok' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const second = await api('POST', '/api/v1/workflows', {
      name: 'selection foreign',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: 'foreign' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const workflowId = first.data.workflow.id;
    const foreignWorkflowId = second.data.workflow.id;
    const definition = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      graders: [{ id: 'status', type: 'run_status', expected: 'completed' }],
    });
    const empty = await api('POST', `/api/v1/evaluations/${definition.data.evaluation.id}/run`, { runIds: [] });
    assert.equal(empty.status, 422);
    assert.match(empty.data.error.message, /at least one workflow run id/);

    const foreignRun = await api('POST', `/api/v1/workflows/${foreignWorkflowId}/runs`, { input: {} });
    const foreign = await api('POST', `/api/v1/evaluations/${definition.data.evaluation.id}/run`, { runIds: [foreignRun.data.run.id] });
    assert.equal(foreign.status, 422);
    assert.match(foreign.data.error.message, /do not belong to workflow/);
  });
});

describe('API: settings & models', () => {
  it('stores and masks provider keys', async () => {
    const put = await api('PUT', '/api/v1/settings/keys', {
      gemini: ['AIzaSyFakeFakeFakeFakeFakeFakeFakeFake'],
    });
    assert.equal(put.status, 200);
    const got = await api('GET', '/api/v1/settings/keys');
    assert.equal(got.data.keys.gemini.length, 1);
    assert.doesNotMatch(got.data.keys.gemini[0], /FakeFakeFakeFake/); // masked
    // clear
    await api('PUT', '/api/v1/settings/keys', { gemini: null });
  });

  it('rejects blank provider credentials before persistence', async () => {
    const blank = await api('PUT', '/api/v1/settings/keys', { openai: ['   '] });
    assert.equal(blank.status, 400);
    const empty = await api('PUT', '/api/v1/settings/keys', { openai: [''] });
    assert.equal(empty.status, 400);
    const got = await api('GET', '/api/v1/settings/keys');
    assert.equal(got.data.keys.openai, undefined);
  });

  it('lists mock models without any key', async () => {
    const { data } = await api('GET', '/api/v1/models?provider=mock');
    const echo = data.models.find((model: any) => model.id === 'mock/echo');
    assert.ok(echo);
    assert.deepEqual(echo.inputModalities, ['text']);
  });
});

describe('API: vector stores', () => {
  let storeId: string;

  it('creates a store (local embedder fallback) and ingests a file', async () => {
    const created = await api('POST', '/api/v1/vector-stores', { name: 'kb' });
    assert.equal(created.status, 200);
    storeId = created.data.store.id;
    assert.match(storeId, /^vs_/);
    assert.equal(created.data.store.embedder, 'local'); // no keys configured

    const uploadHeaders = { 'idempotency-key': `upload-${storeId}` };
    const fileBody = {
      filename: 'facts.txt',
      content:
        'The willow tree grows near rivers and lakes. ' +
        'Photosynthesis converts sunlight into chemical energy. ' +
        'The capital of France is Paris.',
    };
    const file = await api('POST', `/api/v1/vector-stores/${storeId}/files`, fileBody, uploadHeaders);
    assert.equal(file.status, 200);
    assert.equal(file.data.file.status, 'processing');
    assert.equal(file.data.file.stage, 'queued');
    const uploadRetry = await api('POST', `/api/v1/vector-stores/${storeId}/files`, fileBody, uploadHeaders);
    assert.equal(uploadRetry.status, 200);
    assert.equal(uploadRetry.data.file.id, file.data.file.id);
    let current = file.data.file;
    for (let attempt = 0; attempt < 100 && current.status === 'processing'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const polled = await api('GET', `/api/v1/vector-stores/${storeId}/files/${current.id}`);
      assert.equal(polled.status, 200);
      current = polled.data.file;
    }
    assert.equal(current.status, 'ready');
    assert.equal(current.stage, 'completed');
    assert.ok(current.chunkCount >= 1);
    assert.equal(current.processedUnits, current.totalUnits);
  });

  it('searches the store', async () => {
    const res = await api('POST', `/api/v1/vector-stores/${storeId}/search`, {
      query: 'willow tree rivers',
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.results.length >= 1);
    assert.match(res.data.results[0].text, /willow/i);
  });

  it('file search node works inside a workflow', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'rag',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          {
            id: 'fs',
            type: 'fileSearch',
            name: 'Lookup',
            config: { vectorStoreIds: [storeId], query: '{{workflow.input_as_text}}', maxResults: 2 },
          },
          { id: 'e', type: 'end', config: { output: '{{lookup.results[0].text}}' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'fs' },
          { id: 'e2', source: 'fs', target: 'e' },
        ],
      },
    });
    const wfId = created.data.workflow.id;
    const started = await api('POST', `/api/v1/workflows/${wfId}/runs`, {
      input: { input_as_text: 'capital of France' },
    });
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${started.data.run.id}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(run.status, 'completed', run.error);
    assert.match(String(run.output), /willow|Paris|Photosynthesis/);
    const trace = await api('GET', `/api/v1/runs/${run.id}/trace`);
    const searchEvent = trace.data.events.find((event: any) => event.type === 'node.completed' && event.nodeId === 'fs');
    const firstResult = searchEvent.output.results[0];
    assert.match(firstResult.fileId, /^vsf_/);
    assert.equal(typeof firstResult.chunkIndex, 'number');
    assert.deepEqual(firstResult.citation, {
      fileId: firstResult.fileId,
      filename: firstResult.filename,
      chunkIndex: firstResult.chunkIndex,
    });
  });

  it('deletes files and stores', async () => {
    const files = await api('GET', `/api/v1/vector-stores/${storeId}/files`);
    const fileId = files.data.files[0].id;
    assert.equal((await api('DELETE', `/api/v1/vector-stores/${storeId}/files/${fileId}`)).status, 200);
    assert.equal((await api('DELETE', `/api/v1/vector-stores/${storeId}`)).status, 200);
    assert.equal((await api('GET', `/api/v1/vector-stores/${storeId}`)).status, 404);
  });
});

describe('API: MCP registry surface', () => {
  it('lists the connector catalog', async () => {
    const { data } = await api('GET', '/api/v1/mcp/connectors');
    const names = data.connectors.map((c: any) => c.name);
    for (const expected of ['Gmail', 'Google Drive', 'Zapier', 'Stripe', 'HubSpot']) {
      assert.ok(names.includes(expected), `missing connector ${expected}`);
    }
    for (const connector of data.connectors) {
      assert.ok(connector.key, `missing key for ${connector.name}`);
      assert.ok(['hosted', 'third-party'].includes(connector.tier), `invalid tier for ${connector.name}`);
      assert.ok(connector.iconUrl, `missing icon for ${connector.name}`);
      assert.match(connector.color, /^#[0-9A-F]{6}$/i, `invalid color for ${connector.name}`);
      assert.ok(Array.isArray(connector.features) && connector.features.length > 0, `missing features for ${connector.name}`);
    }
  });

  it('registers a custom server without connecting and never leaks the token', async () => {
    const created = await api('POST', '/api/v1/mcp/servers', {
      label: 'my_mcp',
      url: 'https://example.invalid/mcp',
      authType: 'Access token / API key',
      token: 'supersecret_token_value',
      connect: false,
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.server.label, 'my_mcp');
    assert.equal(created.data.server.auth.type, 'bearer');
    assert.equal(JSON.stringify(created.data).includes('supersecret_token_value'), false);

    const list = await api('GET', '/api/v1/mcp/servers');
    assert.equal(JSON.stringify(list.data).includes('supersecret_token_value'), false);

    const del = await api('DELETE', `/api/v1/mcp/servers/${created.data.server.id}`);
    assert.equal(del.status, 200);
  });

  it('keeps provider and MCP sentinels out of stored documents, exports, and traces', async () => {
    const providerSecret = 'provider-sentinel-7f3c9e';
    const mcpSecret = 'mcp-sentinel-2a8b4d';
    const httpSecret = 'http-header-sentinel-91de2f';

    assert.equal((await api('PUT', '/api/v1/settings/keys', { openai: [providerSecret] })).status, 200);
    assert.doesNotMatch(JSON.stringify((await api('GET', '/api/v1/settings/keys')).data), new RegExp(providerSecret));

    const mcp = await api('POST', '/api/v1/mcp/servers', {
      label: 'secret boundary MCP', url: 'https://example.invalid/mcp',
      authType: 'Access token / API key', token: mcpSecret, connect: false,
    });
    assert.equal(mcp.status, 200);
    assert.doesNotMatch(JSON.stringify(mcp.data), new RegExp(mcpSecret));
    assert.doesNotMatch(JSON.stringify((await api('GET', '/api/v1/mcp/servers')).data), new RegExp(mcpSecret));
    const vaultBefore = await api('GET', '/api/v1/admin/credential-vault');
    assert.equal(vaultBefore.status, 200);
    assert.equal(vaultBefore.data.vault.encryptedRecords >= 2, true);
    assert.doesNotMatch(JSON.stringify(vaultBefore.data), /secret|key_bytes|ciphertext/i);
    const rotatedVault = await api('POST', '/api/v1/admin/credential-vault/rotate');
    assert.equal(rotatedVault.status, 200);
    assert.equal(typeof rotatedVault.data.vault.activeKeyId, 'string');
    assert.ok(rotatedVault.data.vault.migrated >= 2);
    assert.doesNotMatch(JSON.stringify(rotatedVault.data), /secret|key_bytes|ciphertext/i);
    const concurrentRotations = await Promise.all([
      api('POST', '/api/v1/admin/credential-vault/rotate'),
      api('POST', '/api/v1/admin/credential-vault/rotate'),
    ]);
    assert.deepEqual(concurrentRotations.map((result) => result.status), [200, 200]);
    for (const result of concurrentRotations) assert.doesNotMatch(JSON.stringify(result.data), /secret|key_bytes|ciphertext/i);
    const currentVault = await api('GET', '/api/v1/admin/credential-vault');
    assert.ok(concurrentRotations.some((result) => result.data.vault.activeKeyId === currentVault.data.vault.activeKeyId));
    const retiredVault = await api('POST', '/api/v1/admin/credential-vault/retire-unused');
    assert.equal(retiredVault.status, 200);
    assert.equal(retiredVault.data.vault.activeKeyId, currentVault.data.vault.activeKeyId);
    assert.ok(Array.isArray(retiredVault.data.vault.retired));
    assert.doesNotMatch(JSON.stringify(retiredVault.data), /secret|key_bytes|ciphertext/i);
    assert.doesNotMatch(JSON.stringify((await api('GET', '/api/v1/settings/keys')).data), new RegExp(providerSecret));
    assert.doesNotMatch(JSON.stringify((await api('GET', '/api/v1/mcp/servers')).data), new RegExp(mcpSecret));

    const workflow = await api('POST', '/api/v1/workflows', {
      name: 'secret boundary workflow',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', name: 'Boundary agent', config: {
            instructions: 'Echo the input.', model: 'mock/echo', includeChatHistory: false,
            writeToConversationHistory: false, outputFormat: 'text', tools: [{
              kind: 'function', name: 'http_secret_tool', parameters: { type: 'object', properties: {} },
              execution: { mode: 'http', url: 'https://example.invalid/tool', headers: { authorization: `Bearer ${httpSecret}` } },
            }],
          } },
          { id: 'e', type: 'end', config: { output: '{{boundary_agent.output_text}}' } },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    });
    assert.equal(workflow.status, 200);
    const workflowId = workflow.data.workflow.id;
    const exportedWorkflow = await api('GET', `/api/v1/workflows/${workflowId}/export-workflow`);
    assert.equal(exportedWorkflow.status, 200);
    assert.doesNotMatch(JSON.stringify(exportedWorkflow.data), new RegExp(httpSecret));

    const started = await api('POST', `/api/v1/workflows/${workflowId}/runs`, { input: { input_as_text: 'boundary check' } });
    const run = await waitForRun(app, started.data.run.id, ['completed', 'failed']);
    assert.equal(run.status, 'completed');
    const trace = await api('GET', `/api/v1/runs/${run.id}/trace`);
    const traceExport = await api('GET', `/api/v1/runs/${run.id}/trace/export`);
    for (const payload of [trace.data, traceExport.data]) {
      assert.doesNotMatch(JSON.stringify(payload), new RegExp(providerSecret));
      assert.doesNotMatch(JSON.stringify(payload), new RegExp(mcpSecret));
      assert.doesNotMatch(JSON.stringify(payload), new RegExp(httpSecret));
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
    const persisted = fs.readdirSync(path.join(app.config.dataDir, 'store'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => fs.readFileSync(path.join(app.config.dataDir, 'store', name), 'utf8'))
      .join('\n');
    assert.doesNotMatch(persisted, new RegExp(providerSecret));
    assert.doesNotMatch(persisted, new RegExp(mcpSecret));
  });
});

describe('API: chat sessions', () => {
  it('keeps authenticated terminal session status observable after cancellation', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'chat status visibility' });
    const created = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflow.data.workflow.id, version: 0 } });
    assert.equal(created.status, 200);
    const sessionId = created.data.session.id;
    const secret = created.data.client_secret;
    const cancelled = await api('POST', `/api/v1/chatkit/sessions/${sessionId}/cancel`, undefined, { 'x-chatkit-client-secret': secret });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.session.status, 'cancelled');

    const status = await api('GET', `/api/v1/chatkit/sessions/${sessionId}`, undefined, { 'x-chatkit-client-secret': secret });
    assert.equal(status.status, 200);
    assert.equal(status.data.session.status, 'cancelled');
    assert.equal((await api('POST', `/api/v1/chatkit/sessions/${sessionId}/threads`, undefined, { 'x-chatkit-client-secret': secret })).status, 410);
  });

  it('hashes, migrates, and rotates ChatKit client secrets', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'credential hardening' });
    const created = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflow.data.workflow.id, version: 0 } });
    const sessionId = created.data.session.id;
    const original = created.data.client_secret;
    const stored = await app.chat.getSession(sessionId);
    assert.ok(stored?.clientSecretHash);
    assert.ok(stored?.clientSecretSalt);
    assert.equal(stored?.clientSecret, undefined);
    assert.equal(JSON.stringify(stored).includes(original), false);

    const rotated = await api('POST', `/api/v1/chatkit/sessions/${sessionId}/rotate`, undefined, { 'x-chatkit-client-secret': original });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.data.client_secret, original);
    assert.equal((await api('GET', `/api/v1/chatkit/sessions/${sessionId}`, undefined, { 'x-chatkit-client-secret': original })).status, 401);
    assert.equal((await api('GET', `/api/v1/chatkit/sessions/${sessionId}`, undefined, { 'x-chatkit-client-secret': rotated.data.client_secret })).status, 200);

    const legacySecret = 'chatkit_token_legacy_plaintext_for_migration';
    const legacy = await app.chat.getSession(sessionId);
    assert.ok(legacy);
    delete legacy.clientSecretHash;
    delete legacy.clientSecretSalt;
    delete legacy.secretVersion;
    legacy.clientSecret = legacySecret;
    await app.storage.put('sessions', sessionId, legacy, legacy.workflowId);
    assert.equal((await api('GET', `/api/v1/chatkit/sessions/${sessionId}`, undefined, { 'x-chatkit-client-secret': legacySecret })).status, 200);
    const migrated = await app.chat.getSession(sessionId);
    assert.equal(migrated?.clientSecret, undefined);
    assert.ok(migrated?.clientSecretHash && migrated.clientSecretSalt);
    assert.equal(JSON.stringify(migrated).includes(legacySecret), false);
  });

  it('resolves latest deployments once and validates pinned published versions', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'deployed chat' });
    const workflowId = created.data.workflow.id;

    const unpublished = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId } });
    assert.equal(unpublished.status, 409);
    assert.equal(unpublished.data.error.code, 'workflow_not_published');
    assert.equal((await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId, version: 99 } })).status, 404);
    assert.equal((await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId, version: -2 } })).status, 400);

    await api('POST', `/api/v1/workflows/${workflowId}/publish`, { notes: 'v1' });
    const latestAtCreation = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, user: 'latest-v1' });
    assert.equal(latestAtCreation.status, 200);
    assert.deepEqual(latestAtCreation.data.session.deployment, {
      selection: 'latest',
      source: 'published',
      requestedVersion: 'latest',
      resolvedVersion: 1,
      resolvedAt: latestAtCreation.data.session.deployment.resolvedAt,
    });

    await api('POST', `/api/v1/workflows/${workflowId}/publish`, { notes: 'v2' });
    const latestAfterPublish = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId } });
    assert.equal(latestAfterPublish.data.session.workflowVersion, 2);
    assert.equal(latestAfterPublish.data.session.deployment.resolvedVersion, 2);

    const pinnedHeaders = { 'x-chatkit-client-secret': latestAtCreation.data.client_secret };
    const thread = await api('POST', `/api/v1/chatkit/sessions/${latestAtCreation.data.session.id}/threads`, undefined, pinnedHeaders);
    const turn = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: 'still v1' }, pinnedHeaders);
    assert.equal(turn.status, 200);
    assert.equal(turn.data.run.workflowVersion, 1);

    const fetched = await api('GET', `/api/v1/chatkit/sessions/${latestAtCreation.data.session.id}`, undefined, pinnedHeaders);
    assert.equal(fetched.data.session.deployment.resolvedVersion, 1);
  });

  it('full ChatKit-style flow: session -> thread -> message -> assistant reply', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'chatbot',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { instructions: '', model: 'mock/upper', tools: [], outputFormat: 'text', includeChatHistory: true, writeToConversationHistory: true, continueOnError: false } },
        ],
        edges: [{ id: 'e1', source: 's', target: 'a' }],
      },
    });
    const wfId = created.data.workflow.id;

    const session = await api('POST', '/api/v1/chatkit/sessions', {
      workflow: { id: wfId, version: 0 },
      user: 'user_123',
    });
    assert.equal(session.status, 200);
    assert.match(session.data.client_secret, /^chatkit_token_/);
    const sessionId = session.data.session.id;
    const chatHeaders = { 'x-chatkit-client-secret': session.data.client_secret };

    assert.equal((await api('GET', `/api/v1/chatkit/sessions/${sessionId}/threads`)).status, 401);
    const thread = await api('POST', `/api/v1/chatkit/sessions/${sessionId}/threads`, undefined, chatHeaders);
    assert.equal(thread.status, 200);
    const threadId = thread.data.thread.id;

    const messageHeaders = { ...chatHeaders, 'idempotency-key': 'chat-turn-1' };
    const sent = await api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, {
      text: 'hello chat',
    }, messageHeaders);
    assert.equal(sent.status, 200);
    const runId = sent.data.run.id;
    assert.equal(sent.data.thread.messages.length, 2);
    assert.equal(sent.data.thread.messages[1].role, 'assistant');
    assert.equal(sent.data.thread.messages[1].status, 'in_progress');
    const retried = await api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, { text: 'hello chat' }, messageHeaders);
    assert.equal(retried.status, 200);
    assert.equal(retried.data.run.id, runId);
    assert.equal(retried.data.thread.messages.filter((message: any) => message.role === 'user').length, 1);
    const conflict = await api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, { text: 'changed' }, messageHeaders);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error.code, 'idempotency_conflict');

    // wait for the run + thread finalization
    for (let i = 0; i < 150; i++) {
      const run = (await api('GET', `/api/v1/runs/${runId}`, undefined, chatHeaders)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    let threadAfter: any;
    for (let i = 0; i < 100; i++) {
      threadAfter = (await api('GET', `/api/v1/chatkit/threads/${threadId}`, undefined, chatHeaders)).data.thread;
      if (threadAfter.messages.length >= 2) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(threadAfter.messages.length, 2);
    assert.equal(threadAfter.messages[0].role, 'user');
    assert.equal(threadAfter.messages[1].role, 'assistant');
    assert.equal(threadAfter.messages[1].content, 'HELLO CHAT');
    assert.equal(threadAfter.messages[1].status, 'completed');

    // cancel session -> further messages rejected
    await api('POST', `/api/v1/chatkit/sessions/${sessionId}/cancel`, undefined, chatHeaders);
    const rejected = await api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, { text: 'x' }, chatHeaders);
    assert.equal(rejected.status, 410);
  });

  it('does not use a thread whose persisted deployment pin no longer matches its session', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'chat thread binding',
      graph: { nodes: [{ id: 's', type: 'start', data: {} }], edges: [] },
    });
    const workflowId = created.data.workflow.id;
    const session = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId, version: 0 } });
    const secret = { 'x-chatkit-client-secret': session.data.client_secret };
    const made = await api('POST', `/api/v1/chatkit/sessions/${session.data.session.id}/threads`, undefined, secret);
    assert.equal(made.status, 200);
    const thread = await app.storage.get<any>('threads', made.data.thread.id);
    assert.ok(thread);
    thread.deploymentId = 'dep_foreign';
    await app.storage.put('threads', thread.id, thread, thread.sessionId);
    assert.equal((await api('GET', `/api/v1/chatkit/threads/${thread.id}`, undefined, secret)).status, 404);
    assert.equal((await api('POST', `/api/v1/chatkit/threads/${thread.id}/messages`, { text: 'blocked' }, secret)).status, 404);
  });

  it('validates, persists, and forwards ChatKit file attachments', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'chat attachments',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: '{{workflow.input_as_text}}' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const session = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: created.data.workflow.id, version: 0 }, user: 'attachment-user' });
    const headers = { 'x-chatkit-client-secret': session.data.client_secret, 'idempotency-key': 'attachment-turn' };
    const thread = await api('POST', `/api/v1/chatkit/sessions/${session.data.session.id}/threads`, undefined, headers);
    const attachment = { name: 'notes.txt', mimeType: 'text/plain', contentBase64: Buffer.from('attached context').toString('base64') };
    const sent = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: '', attachments: [attachment] }, headers);
    assert.equal(sent.status, 200);
    assert.equal(sent.data.thread.messages[0].attachments[0].name, 'notes.txt');
    assert.equal(sent.data.run.input.attachments[0].name, 'notes.txt');
    assert.equal(sent.data.run.input.attachments[0].extractedText, 'attached context');
    assert.match(sent.data.run.input.attachments[0].sha256, /^[a-f0-9]{64}$/);

    const retried = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: '', attachments: [attachment] }, headers);
    assert.equal(retried.status, 200);
    assert.equal(retried.data.run.id, sent.data.run.id);
    const changed = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, {
      text: '',
      attachments: [{ ...attachment, contentBase64: Buffer.from('different').toString('base64') }],
    }, headers);
    assert.equal(changed.status, 409);
    assert.equal(changed.data.error.code, 'idempotency_conflict');

    const invalid = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, {
      text: '',
      attachments: [{ name: 'payload.bin', mimeType: 'application/octet-stream', contentBase64: 'AA==' }],
    }, { 'x-chatkit-client-secret': session.data.client_secret });
    assert.equal(invalid.status, 400);
  });

  it('enforces thread ownership and serializes concurrent turns', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'secured chat',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'u', type: 'userApproval', config: { message: 'continue?' } },
          { id: 'e', type: 'end', config: { output: 'done' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'u' },
          { id: 'e2', source: 'u', target: 'e', sourceHandle: 'approved' },
          { id: 'e3', source: 'u', target: 'e', sourceHandle: 'rejected' },
        ],
      },
    });
    const wfId = created.data.workflow.id;
    const firstSession = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: wfId, version: 0 }, user: 'one' });
    const secondSession = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: wfId, version: 0 }, user: 'two' });
    const firstHeaders = { 'x-chatkit-client-secret': firstSession.data.client_secret };
    const secondHeaders = { 'x-chatkit-client-secret': secondSession.data.client_secret };
    const thread = await api('POST', `/api/v1/chatkit/sessions/${firstSession.data.session.id}/threads`, undefined, firstHeaders);
    const threadId = thread.data.thread.id;

    assert.equal((await api('GET', `/api/v1/chatkit/threads/${threadId}`, undefined, secondHeaders)).status, 401);
    assert.equal((await api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, { text: 'intrude' }, secondHeaders)).status, 401);

    const responses = await Promise.all([
      api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, { text: 'first' }, firstHeaders),
      api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, { text: 'second' }, firstHeaders),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const accepted = responses.find((response) => response.status === 200)!;
    const runId = accepted.data.run.id;
    assert.equal(accepted.data.thread.messages.length, 2);
    assert.equal(accepted.data.thread.messages[1].status, 'in_progress');
    for (let attempt = 0; attempt < 100; attempt++) {
      const run = (await api('GET', `/api/v1/runs/${runId}`, undefined, firstHeaders)).data.run;
      if (run.status === 'awaiting_approval') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal((await api('GET', `/api/v1/runs/${runId}`, undefined, secondHeaders)).status, 401);
    assert.equal((await api('GET', `/api/v1/runs/${runId}/trace/export`, undefined, secondHeaders)).status, 401);
    assert.equal((await api('POST', `/api/v1/runs/${runId}/cancel`, undefined, secondHeaders)).status, 401);

    const cancelHeaders = { ...firstHeaders, 'idempotency-key': `cancel-${runId}` };
    const cancelledOnce = await api('POST', `/api/v1/runs/${runId}/cancel`, undefined, cancelHeaders);
    assert.equal(cancelledOnce.status, 200);
    const cancelledAgain = await api('POST', `/api/v1/runs/${runId}/cancel`, undefined, cancelHeaders);
    assert.equal(cancelledAgain.status, 200);
    assert.equal(cancelledAgain.data.run.id, cancelledOnce.data.run.id);
    assert.equal(cancelledAgain.data.run.status, 'cancelled');

    assert.equal((await api('POST', `/api/v1/chatkit/sessions/${firstSession.data.session.id}/cancel`, undefined, firstHeaders)).status, 200);
    for (let attempt = 0; attempt < 100; attempt++) {
      const run = (await api('GET', `/api/v1/runs/${runId}`, undefined, firstHeaders)).data.run;
      if (run.status === 'cancelled') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await api('GET', `/api/v1/runs/${runId}`, undefined, firstHeaders)).data.run.status, 'cancelled');
  });
});
