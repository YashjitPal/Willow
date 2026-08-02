import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Run, RunEvent } from '../src/domain/types.ts';
import { buildTraceSpanIndex, buildTraceSpans } from '../src/engine/trace.ts';
import { sanitizeTraceValue, summarizeTraceStructure } from '../src/engine/traceData.ts';

describe('trace data sanitization', () => {
  it('redacts credential-shaped keys at any depth', () => {
    const result = sanitizeTraceValue({
      headers: { Authorization: 'Bearer private', 'x-api-key': 'private-key', 'x-custom-auth': 'private-custom' },
      harmless: 'visible',
      password: 'private-password',
      accessToken: 'private-access-token',
      clientSecret: 'private-client-secret',
      privateKey: 'private-key-material',
      nested: { refreshToken: 'private-refresh-token', database_secret: 'private-database-secret' },
      maxTokens: 2048,
      inputTokens: 17,
    }) as any;
    assert.equal(result.headers.Authorization, '[REDACTED]');
    assert.equal(result.headers['x-api-key'], '[REDACTED]');
    assert.equal(result.password, '[REDACTED]');
    assert.equal(result.accessToken, '[REDACTED]');
    assert.equal(result.clientSecret, '[REDACTED]');
    assert.equal(result.privateKey, '[REDACTED]');
    assert.equal(result.nested.refreshToken, '[REDACTED]');
    assert.equal(result.nested.database_secret, '[REDACTED]');
    assert.equal(result.headers['x-custom-auth'], '[REDACTED]');
    assert.equal(result.harmless, 'visible');
    assert.equal(result.maxTokens, 2048);
    assert.equal(result.inputTokens, 17);
  });

  it('bounds large strings, arrays, objects, and nesting', () => {
    const result = sanitizeTraceValue({ text: 'x'.repeat(5000), list: Array.from({ length: 70 }, (_, index) => index) }) as any;
    assert.match(result.text, /TRUNCATED/);
    assert.equal(result.list.length, 51);
    let nested: any = 'bottom';
    for (let index = 0; index < 12; index += 1) nested = { nested };
    assert.match(JSON.stringify(sanitizeTraceValue(nested)), /max depth/);
  });

  it('redacts hidden reasoning without removing usage counters', () => {
    const result = sanitizeTraceValue({ reasoning: 'private chain', thinking: 'private thought', reasoningTokens: 42 }) as any;
    assert.equal(result.reasoning, '[REDACTED: hidden reasoning]');
    assert.equal(result.thinking, '[REDACTED: hidden reasoning]');
    assert.equal(result.reasoningTokens, 42);
  });

  it('redacts encoded attachment payloads while retaining safe metadata', () => {
    const result = sanitizeTraceValue({
      attachments: [{
        name: 'notes.txt',
        mimeType: 'text/plain',
        contentBase64: 'c2Vuc2l0aXZlLXNlY3JldA==',
        dataBase64: 'c2Vuc2l0aXZlLWRhdGE=',
        bytes: 17,
      }],
    }) as any;
    assert.equal(result.attachments[0].contentBase64, '[REDACTED]');
    assert.equal(result.attachments[0].dataBase64, '[REDACTED]');
    assert.equal(result.attachments[0].name, 'notes.txt');
    assert.equal(result.attachments[0].mimeType, 'text/plain');
    assert.equal(result.attachments[0].bytes, 17);
    assert.doesNotMatch(JSON.stringify(result), /c2Vuc2l0aXZl/);
  });

  it('describes sensitive node data without retaining values', () => {
    const sentinel = 'private-prompt-and-tool-argument';
    const result = summarizeTraceStructure({
      prompt: sentinel,
      arguments: { query: sentinel },
      apiKey: sentinel,
      accessToken: sentinel,
      clientSecret: sentinel,
      enabled: true,
      retries: 2,
      items: [{ document: sentinel }, { document: sentinel }],
    }) as any;

    assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel));
    assert.deepEqual(result.fields.prompt, { type: 'string', length: sentinel.length });
    assert.deepEqual(result.fields.apiKey, { type: 'string', redacted: true });
    assert.deepEqual(result.fields.accessToken, { type: 'string', redacted: true });
    assert.deepEqual(result.fields.clientSecret, { type: 'string', redacted: true });
    assert.deepEqual(result.fields.enabled, { type: 'boolean' });
    assert.deepEqual(result.fields.retries, { type: 'number' });
    assert.equal(result.fields.items.length, 2);
    assert.equal(result.fields.items.sampleStructure.fields.document.length, sentinel.length);
  });

  it('indexes repeated node occurrences deterministically', () => {
    const run = { id: 'run_loop', workflowId: 'wf_loop', workflowVersion: 0, status: 'completed', input: {}, usage: { byModel: {} }, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as Run;
    const events = [
      { type: 'node.started', runId: run.id, nodeId: 'loop_body', nodeType: 'transform', name: 'Body', at: '2026-01-01T00:00:00.100Z' },
      { type: 'node.completed', runId: run.id, nodeId: 'loop_body', output: 1, at: '2026-01-01T00:00:00.200Z' },
      { type: 'node.started', runId: run.id, nodeId: 'loop_body', nodeType: 'transform', name: 'Body', at: '2026-01-01T00:00:00.300Z' },
      { type: 'node.completed', runId: run.id, nodeId: 'loop_body', output: 2, at: '2026-01-01T00:00:00.400Z' },
    ] as RunEvent[];
    const spans = buildTraceSpans(run, events);
    const index = buildTraceSpanIndex(spans);
    assert.equal(index.nodeOccurrence('loop_body', 1)?.data?.output, 1);
    assert.equal(index.nodeOccurrence('loop_body', 2)?.data?.output, 2);
    assert.deepEqual(spans.filter((span) => span.type === 'node').map((span) => span.occurrence), [1, 2]);
  });

  it('annotates open spans closed by restart recovery', () => {
    const run = {
      id: 'run_restart_trace',
      workflowId: 'wf_restart_trace',
      workflowVersion: 1,
      status: 'failed',
      error: 'restart interruption: node agent outcome uncertain',
      input: { input_as_text: 'in flight' },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        llmCalls: 1,
        toolCalls: 1,
        estimatedCostUsd: 0,
        unpricedLlmCalls: 0,
        pricingCatalogVersion: 'test',
        byModel: {},
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.100Z',
      endedAt: '2026-01-01T00:00:01.000Z',
    } as unknown as Run;
    const events = [
      { type: 'run.started', runId: run.id, at: run.startedAt! },
      { type: 'node.started', runId: run.id, nodeId: 'agent', nodeType: 'agent', name: 'Agent', at: '2026-01-01T00:00:00.200Z' },
      { type: 'llm.started', runId: run.id, nodeId: 'agent', model: 'mock/slow', at: '2026-01-01T00:00:00.300Z' },
      { type: 'tool.started', runId: run.id, nodeId: 'agent', tool: 'lookup', callId: 'call_restart', attempt: 1, maxAttempts: 1, at: '2026-01-01T00:00:00.400Z' },
    ] as RunEvent[];

    const spans = buildTraceSpans(run, events);
    for (const type of ['node', 'llm', 'tool'] as const) {
      const span = spans.find((candidate) => candidate.type === type);
      assert.ok(span, `${type} span should exist`);
      assert.equal(span.status, 'error');
      assert.equal(span.endedAt, run.endedAt);
      assert.equal(span.data?.error, run.error);
    }
  });
});
