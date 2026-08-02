import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvaluationRun } from './agent-builder';
import { getEvaluationCaseInspection } from './evaluation-inspection';

const evaluationRun = {
  id: 'eval_run_1',
  evaluationId: 'eval_1',
  workflowId: 'workflow_1',
  status: 'completed',
  runIds: ['run_1'],
  caseRuns: [{ testCaseId: 'case_1', runId: 'run_1' }],
  totalRuns: 1,
  completedRuns: 1,
  score: 1,
  results: [],
  datasetSnapshot: {
    id: 'dataset_version_1',
    datasetId: 'dataset_1',
    workflowId: 'workflow_1',
    version: 3,
    sha256: 'abc',
    createdAt: '2026-01-01T00:00:00.000Z',
    testCases: [{
      id: 'case_1',
      name: 'Refund request',
      version: 1,
      input: { input_as_text: 'Please refund order 42' },
      expectedOutput: { outcome: 'approved' },
    }],
  },
  createdAt: '2026-01-01T00:00:00.000Z',
} satisfies EvaluationRun;

test('resolves immutable dataset context for a graded run', () => {
  const inspection = getEvaluationCaseInspection(evaluationRun, 'run_1');
  assert.equal(inspection?.testCase.name, 'Refund request');
  assert.match(inspection?.input ?? '', /Please refund order 42/);
  assert.equal(inspection?.expectedOutput, '{\n  "outcome": "approved"\n}');
});

test('does not guess context for an unmapped trace', () => {
  assert.equal(getEvaluationCaseInspection(evaluationRun, 'run_missing'), null);
});
