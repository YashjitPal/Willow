import type { EvaluationRun, EvaluationTestCase } from './agent-builder';

export interface EvaluationCaseInspection {
  testCase: EvaluationTestCase;
  input: string;
  expectedOutput?: string;
}

function displayJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getEvaluationCaseInspection(run: EvaluationRun, runId: string): EvaluationCaseInspection | null {
  const testCaseId = run.caseRuns?.find((item) => item.runId === runId)?.testCaseId;
  if (!testCaseId) return null;
  const testCase = run.datasetSnapshot?.testCases.find((item) => item.id === testCaseId);
  if (!testCase) return null;
  return {
    testCase,
    input: displayJson(testCase.input),
    ...(testCase.expectedOutput === undefined ? {} : { expectedOutput: displayJson(testCase.expectedOutput) }),
  };
}
