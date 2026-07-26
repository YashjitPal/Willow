import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Run, TraceSpan } from '../src/domain/types.ts';
import { compareTraceRuns, portableTraceExport } from '../src/engine/traceCompare.ts';

function run(id: string): Run {
  return {
    id,
    workflowId: 'wf_1',
    workflowVersion: 1,
    status: 'completed',
    input: {},
    output: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      llmCalls: 0,
      toolCalls: 0,
      estimatedCostUsd: 0,
      unpricedLlmCalls: 0,
      embeddingInputTokens: 0,
      embeddingOperations: 0,
      unpricedEmbeddingOperations: 0,
      pricingCatalogVersion: 'test',
      byModel: {},
      byEmbeddingModel: {},
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function span(runId: string, id: string, name: string, occurrence?: number): TraceSpan {
  return {
    id,
    runId,
    type: 'llm',
    nodeId: 'agent_1',
    name,
    ...(occurrence !== undefined ? { occurrence } : {}),
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:00.100Z',
    status: 'ok',
  };
}

describe('trace comparison', () => {
  it('bounds exported run errors through trace sanitization', () => {
    const artifact = portableTraceExport({ ...run('exported'), error: 'x'.repeat(5000) }, [], []);
    assert.equal(artifact.run.error?.length, 4029);
    assert.match(artifact.run.error ?? '', /TRUNCATED: 1000 characters/);
  });

  it('matches the same node occurrence when its display name changes', () => {
    const comparison = compareTraceRuns(
      run('left'),
      run('right'),
      [span('left', 'span_left', 'gpt-4.1', 1)],
      [span('right', 'span_right', 'gpt-5', 1)],
    );

    assert.equal(comparison.spans.length, 1);
    assert.equal(comparison.spans[0]?.left?.id, 'span_left');
    assert.equal(comparison.spans[0]?.right?.id, 'span_right');
    assert.equal(comparison.spans[0]?.nameChanged, true);
  });

  it('retains name-based occurrence matching for legacy traces', () => {
    const comparison = compareTraceRuns(
      run('left'),
      run('right'),
      [span('left', 'span_left', 'gpt-4.1')],
      [span('right', 'span_right', 'gpt-4.1')],
    );

    assert.equal(comparison.spans.length, 1);
    assert.equal(comparison.spans[0]?.nameChanged, false);
  });
});
