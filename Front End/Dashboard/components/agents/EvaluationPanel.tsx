import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Focus,
  GitCompare,
  History,
  Loader2,
  Play,
  Plus,
  Save,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { useUserDataContext } from '../../context/UserDataContext';
import {
  getAgentBuilderClient,
  type EvaluationDefinition,
  type EvaluationDataset,
  type EvaluationDatasetVersion,
  type EvaluationGrader,
  type EvaluationRun,
  type EvaluationTestCase,
} from '../../lib/agentBuilder';
import {
  currentWorkflow,
  evaluationGraderCounts,
  evaluationPanelOpen,
  evaluationTraceFocusRequest,
  requestedEvaluationNodeId,
  runHistoryPanelOpen,
} from '../../lib/stores/agent-builder-store';
import { getUsageCostDisplay, getUsageDetailItems, getUsageModelBreakdown, getUsageUnpricedCallCount } from '../../lib/agentUsageDisplay';
import { getEvaluationCaseInspection } from '../../lib/evaluationResultInspection';
import { trapDialogFocus } from '../../lib/dialogFocus';

type RunSummary = { id: string; status: string; output?: unknown; createdAt?: string };
type SpanType = 'node' | 'llm' | 'tool' | 'guardrail' | 'approval' | 'state' | 'run';
type SpanField = 'output' | 'status' | 'error' | 'duration' | 'usage' | 'arguments' | 'result' | 'toolCalls';
type ScopedEvaluationGrader = EvaluationGrader & {
  nodeId?: string;
  spanType?: SpanType;
  occurrence?: number;
  field?: SpanField;
  workflowVersion?: number;
};
type ScopedGraderResult = EvaluationRun['results'][number]['results'][number] & {
  targetFound?: boolean;
  targetKey?: string;
};
type TraceFilters = { model: string; tool: string; from: string; to: string };

const emptyTraceFilters = (): TraceFilters => ({ model: '', tool: '', from: '', to: '' });
const toIsoDateTime = (value: string): string | undefined => value ? new Date(value).toISOString() : undefined;
const hasInvalidLabelJudge = (graders: ScopedEvaluationGrader[]): boolean => graders.some((grader) => {
  if (grader.type !== 'label_model_judge') return false;
  const labels = grader.labels ?? [];
  const passing = grader.passingLabels ?? [];
  return labels.length < 2 || new Set(labels).size !== labels.length || passing.length === 0 || passing.some((label) => !labels.includes(label));
});

const terminalEvaluationStatuses = new Set<EvaluationRun['status']>(['completed', 'failed', 'cancelled']);
const settledEvaluationStatuses = new Set<EvaluationRun['status']>([...terminalEvaluationStatuses, 'awaiting_credentials']);

const defaultGraders = (): ScopedEvaluationGrader[] => [
  { id: `grader_${Date.now()}`, name: 'Run completed', type: 'run_status', expected: 'completed' },
];

function updateAttachedGraderCounts(definitions: EvaluationDefinition[]): void {
  const counts: Record<string, number> = {};
  for (const definition of definitions) {
    for (const grader of definition.graders as ScopedEvaluationGrader[]) {
      if (grader.nodeId) counts[grader.nodeId] = (counts[grader.nodeId] ?? 0) + 1;
    }
  }
  evaluationGraderCounts.set(counts);
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function buildEvaluationComparison(baseline: EvaluationRun, candidate: EvaluationRun) {
  const graderStats = (run: EvaluationRun) => {
    const stats = new Map<string, { name: string; scores: number[] }>();
    for (const runResult of run.results) {
      for (const result of runResult.results) {
        const current = stats.get(result.graderId) ?? { name: result.name, scores: [] };
        current.scores.push(result.score);
        stats.set(result.graderId, current);
      }
    }
    return stats;
  };
  const baselineGraders = graderStats(baseline);
  const candidateGraders = graderStats(candidate);
  const graderIds = [...new Set([...baselineGraders.keys(), ...candidateGraders.keys()])];
  const graders = graderIds.map((graderId) => {
    const before = baselineGraders.get(graderId);
    const after = candidateGraders.get(graderId);
    const baselineScore = mean(before?.scores ?? []);
    const candidateScore = mean(after?.scores ?? []);
    return {
      graderId,
      name: after?.name ?? before?.name ?? graderId,
      baselineScore,
      candidateScore,
      delta: baselineScore !== null && candidateScore !== null ? candidateScore - baselineScore : null,
    };
  }).sort((left, right) => (left.delta ?? 0) - (right.delta ?? 0));

  const caseRunMap = (run: EvaluationRun) => new Map((run.caseRuns ?? [])
    .filter((item): item is { testCaseId: string; runId: string } => Boolean(item.runId))
    .map((item) => [item.runId, item.testCaseId]));
  const baselineCases = caseRunMap(baseline);
  const candidateCases = caseRunMap(candidate);
  const keyedResults = (run: EvaluationRun, cases: Map<string, string>) => new Map(run.results.map((result) => [cases.get(result.runId) ?? result.runId, result]));
  const baselineResults = keyedResults(baseline, baselineCases);
  const candidateResults = keyedResults(candidate, candidateCases);
  const caseNames = new Map([
    ...(baseline.datasetSnapshot?.testCases ?? []).map((item) => [item.id, item.name] as const),
    ...(candidate.datasetSnapshot?.testCases ?? []).map((item) => [item.id, item.name] as const),
  ]);
  const caseKeys = [...new Set([...baselineResults.keys(), ...candidateResults.keys()])];
  const cases = caseKeys.map((key) => {
    const before = baselineResults.get(key);
    const after = candidateResults.get(key);
    return {
      key,
      name: caseNames.get(key) ?? key,
      baselineRunId: before?.runId,
      candidateRunId: after?.runId,
      baselineScore: before?.score ?? null,
      candidateScore: after?.score ?? null,
      delta: before && after ? after.score - before.score : null,
    };
  }).sort((left, right) => (left.delta ?? 0) - (right.delta ?? 0));

  const comparableCases = cases.filter((item) => item.delta !== null);
  return {
    scoreDelta: candidate.score - baseline.score,
    datasetMatches: baseline.datasetSnapshot?.sha256 && candidate.datasetSnapshot?.sha256
      ? baseline.datasetSnapshot.sha256 === candidate.datasetSnapshot.sha256
      : null,
    graders,
    cases,
    regressions: comparableCases.filter((item) => item.delta! < -0.0001).length,
    improvements: comparableCases.filter((item) => item.delta! > 0.0001).length,
    unchanged: comparableCases.filter((item) => Math.abs(item.delta!) <= 0.0001).length,
  };
}

interface EvaluationPanelProps {
  agentNodes?: Array<{ id: string; name: string }>;
  onFocusNode?: (nodeId: string) => void;
}

export const EvaluationPanel: React.FC<EvaluationPanelProps> = ({ agentNodes = [], onFocusNode }) => {
  const open = useStore(evaluationPanelOpen);
  const workflow = useStore(currentWorkflow);
  const requestedNodeId = useStore(requestedEvaluationNodeId);
  const { apiKeys } = useUserDataContext();
  const [runs, setRuns] = React.useState<RunSummary[]>([]);
  const [selectedRunIds, setSelectedRunIds] = React.useState<string[]>([]);
  const [traceSelectionMode, setTraceSelectionMode] = React.useState<'manual' | 'filters'>('manual');
  const [traceFilters, setTraceFilters] = React.useState<TraceFilters>(emptyTraceFilters);
  const [definitions, setDefinitions] = React.useState<EvaluationDefinition[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = React.useState('');
  const [definitionName, setDefinitionName] = React.useState('Preview quality');
  const [graders, setGraders] = React.useState<ScopedEvaluationGrader[]>(defaultGraders);
  const [testCases, setTestCases] = React.useState<EvaluationTestCase[]>([]);
  const [datasets, setDatasets] = React.useState<EvaluationDataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = React.useState('');
  const [selectedDatasetVersion, setSelectedDatasetVersion] = React.useState<number | null>(null);
  const [datasetVersions, setDatasetVersions] = React.useState<EvaluationDatasetVersion[]>([]);
  const [history, setHistory] = React.useState<EvaluationRun[]>([]);
  const [comparisonRunIds, setComparisonRunIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [datasetRunning, setDatasetRunning] = React.useState(false);
  const [datasetProgress, setDatasetProgress] = React.useState({ completed: 0, total: 0 });
  const datasetCancelRequested = React.useRef(false);
  const datasetRunIds = React.useRef<string[]>([]);
  const [evaluationRunning, setEvaluationRunning] = React.useState(false);
  const activeEvaluationRunId = React.useRef<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [latestResult, setLatestResult] = React.useState<EvaluationRun | null>(null);
  const [annotationFeedback, setAnnotationFeedback] = React.useState<Record<string, string>>({});
  const [savingAnnotation, setSavingAnnotation] = React.useState<string | null>(null);
  // Dataset/version and run-history requests can finish out of order when the
  // user switches evaluations quickly. Only the latest selection may commit.
  const definitionSelectionGeneration = React.useRef(0);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const previouslyFocused = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') evaluationPanelOpen.set(false); else trapDialogFocus(event, 'evaluation-dialog-title'); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const selectDefinition = React.useCallback(async (
    definition: EvaluationDefinition | undefined,
  ) => {
    const generation = ++definitionSelectionGeneration.current;
    const isCurrent = () => generation === definitionSelectionGeneration.current;
    setSelectedDefinitionId(definition?.id ?? '');
    setDefinitionName(definition?.name ?? 'Preview quality');
    setGraders(definition ? definition.graders as ScopedEvaluationGrader[] : defaultGraders());
    setTestCases(definition?.testCases ?? []);
    setSelectedDatasetId(definition?.datasetId ?? '');
    setSelectedDatasetVersion(definition?.datasetVersion ?? null);
    setDatasetVersions([]);
    setComparisonRunIds([]);
    if (definition?.datasetId) {
      const client = getAgentBuilderClient(apiKeys);
      const versions = (await client.listEvaluationDatasetVersions(definition.datasetId)).versions;
      if (!isCurrent()) return;
      setDatasetVersions(versions);
      const pinned = versions.find((version) => version.version === definition.datasetVersion) ?? versions[0];
      if (pinned) {
        setSelectedDatasetVersion(pinned.version);
        setTestCases(pinned.testCases);
      }
    }
    setLatestResult(null);
    if (!definition) {
      setHistory([]);
      return;
    }
    try {
      const response = await getAgentBuilderClient(apiKeys).listEvaluationRuns(definition.id);
      if (!isCurrent()) return;
      setHistory(response.runs);
    } catch {
      setHistory([]);
    }
  }, [apiKeys]);

  React.useEffect(() => updateAttachedGraderCounts(definitions), [definitions]);

  React.useEffect(() => {
    if (!open || !workflow) return;
    let cancelled = false;
    setMessage(null);
    setLoading(true);
    const client = getAgentBuilderClient(apiKeys);
    Promise.all([
      client.listRuns(workflow.id, 20),
      client.listEvaluations(workflow.id),
      client.listEvaluationDatasets(workflow.id),
    ]).then(async ([runResponse, evaluationResponse, datasetResponse]) => {
      if (cancelled) return;
      const nextRuns = runResponse.runs as RunSummary[];
      setRuns(nextRuns);
      setSelectedRunIds(nextRuns[0]?.id ? [nextRuns[0].id] : []);
      setDefinitions(evaluationResponse.evaluations);
      setDatasets(datasetResponse.datasets);
      await selectDefinition(evaluationResponse.evaluations[0]);
    }).catch((error) => {
      if (!cancelled) setMessage((error as Error).message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiKeys, open, selectDefinition, workflow]);

  if (!open) return null;

  const latestUsageCost = getUsageCostDisplay(latestResult?.usage);
  const latestUsageDetails = getUsageDetailItems(latestResult?.usage);
  const latestUsageModels = getUsageModelBreakdown(latestResult?.usage);
  const latestUnpricedCalls = getUsageUnpricedCallCount(latestResult?.usage);
  const comparisonRuns = comparisonRunIds
    .map((runId) => history.find((item) => item.id === runId))
    .filter((item): item is EvaluationRun => Boolean(item));
  const comparison = comparisonRuns.length === 2
    ? buildEvaluationComparison(comparisonRuns[0], comparisonRuns[1])
    : null;

  const persistDefinition = async (): Promise<EvaluationDefinition | null> => {
    if (!workflow) return null;
    const client = getAgentBuilderClient(apiKeys);
    const input = {
      name: definitionName.trim() || 'Preview quality',
      graders,
      testCases: selectedDatasetId ? [] : testCases,
      dataset: selectedDatasetId ? { id: selectedDatasetId, ...(selectedDatasetVersion ? { version: selectedDatasetVersion } : {}) } : null,
    };
    const response = selectedDefinitionId
      ? await client.updateEvaluation(selectedDefinitionId, input)
      : await client.createEvaluation(workflow.id, input);
    const definition = response.evaluation;
    setSelectedDefinitionId(definition.id);
    setDefinitions((current) => {
      const found = current.some((item) => item.id === definition.id);
      return found
        ? current.map((item) => item.id === definition.id ? definition : item)
        : [definition, ...current];
    });
    return definition;
  };

  const selectDataset = async (datasetId: string) => {
    setSelectedDatasetId(datasetId);
    setSelectedDatasetVersion(null);
    setDatasetVersions([]);
    if (!datasetId) return;
    setLoading(true);
    setMessage(null);
    try {
      const versions = (await getAgentBuilderClient(apiKeys).listEvaluationDatasetVersions(datasetId)).versions;
      setDatasetVersions(versions);
      const latest = versions[0];
      if (latest) {
        setSelectedDatasetVersion(latest.version);
        setTestCases(latest.testCases);
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const selectDatasetVersion = (versionNumber: number) => {
    const version = datasetVersions.find((item) => item.version === versionNumber);
    if (!version) return;
    setSelectedDatasetVersion(version.version);
    setTestCases(version.testCases);
  };

  const publishDatasetVersion = async () => {
    if (!workflow || testCases.length === 0) return;
    setLoading(true);
    setMessage(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      if (!selectedDatasetId) {
        const response = await client.createEvaluationDataset(workflow.id, {
          name: `${definitionName.trim() || 'Evaluation'} dataset`,
          testCases,
        });
        setDatasets((current) => [response.dataset, ...current]);
        setSelectedDatasetId(response.dataset.id);
        setSelectedDatasetVersion(response.version.version);
        setDatasetVersions([response.version]);
        setMessage(`Dataset version ${response.version.version} published.`);
      } else {
        const response = await client.createEvaluationDatasetVersion(selectedDatasetId, testCases);
        setSelectedDatasetVersion(response.version.version);
        setDatasetVersions((current) => [response.version, ...current]);
        setDatasets((current) => current.map((dataset) => dataset.id === selectedDatasetId
          ? { ...dataset, latestVersion: response.version.version, updatedAt: response.version.createdAt }
          : dataset));
        setMessage(`Dataset version ${response.version.version} published.`);
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const updateEvaluationJob = (run: EvaluationRun) => {
    setLatestResult(run);
    setHistory((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    if (run.caseRuns) setDatasetProgress({ completed: run.completedRuns, total: run.totalRuns });
  };

  const waitForEvaluationJob = async (
    client: ReturnType<typeof getAgentBuilderClient>,
    initialRun: EvaluationRun,
  ): Promise<EvaluationRun> => {
    let run = initialRun;
    updateEvaluationJob(run);
    activeEvaluationRunId.current = run.id;
    setEvaluationRunning(!settledEvaluationStatuses.has(run.status));
    for (let attempt = 0; attempt < 1200 && !settledEvaluationStatuses.has(run.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      run = (await client.getEvaluationRun(run.id)).run;
      updateEvaluationJob(run);
    }
    if (!settledEvaluationStatuses.has(run.status)) {
      throw new Error(`Timed out waiting for evaluation job ${run.id}.`);
    }
    return run;
  };

  const saveDefinition = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await persistDefinition();
      setMessage('Evaluation saved.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const deleteDefinition = async () => {
    if (!selectedDefinitionId) return;
    setLoading(true);
    setMessage(null);
    try {
      await getAgentBuilderClient(apiKeys).deleteEvaluation(selectedDefinitionId);
      const remaining = definitions.filter((item) => item.id !== selectedDefinitionId);
      setDefinitions(remaining);
      await selectDefinition(remaining[0]);
      setMessage('Evaluation deleted.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const evaluate = async () => {
    if (!workflow) return;
    if (hasInvalidLabelJudge(graders)) {
      setMessage('Each label judge needs at least two unique labels and one passing label.');
      return;
    }
    const hasTraceFilters = Object.values(traceFilters).some((value) => value.trim());
    if (traceSelectionMode === 'manual' && selectedRunIds.length === 0) {
      setMessage('Run a preview first, then evaluate its trace.');
      return;
    }
    if (traceSelectionMode === 'filters' && !hasTraceFilters) {
      setMessage('Add at least one trace filter.');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const definition = await persistDefinition();
      if (!definition) return;
      const response = traceSelectionMode === 'manual'
        ? await client.runEvaluation(definition.id, selectedRunIds)
        : await client.runEvaluation(definition.id, { filters: {
            model: traceFilters.model.trim() || undefined,
            tool: traceFilters.tool.trim() || undefined,
            from: toIsoDateTime(traceFilters.from),
            to: toIsoDateTime(traceFilters.to),
          } });
      const result = await waitForEvaluationJob(client, response.run);
      const historyResponse = await client.listEvaluationRuns(definition.id);
      setHistory(historyResponse.runs);
      setMessage(result.status === 'completed'
        ? 'Trace evaluated.'
        : result.status === 'cancelled'
          ? 'Evaluation cancelled.'
          : result.error || 'Evaluation failed.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      activeEvaluationRunId.current = null;
      setEvaluationRunning(false);
      setLoading(false);
    }
  };

  const runDataset = async () => {
    if (!workflow || testCases.length === 0) return;
    setLoading(true);
    setDatasetRunning(true);
    setDatasetProgress({ completed: 0, total: testCases.length });
    datasetCancelRequested.current = false;
    datasetRunIds.current = [];
    setMessage(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const definition = await persistDefinition();
      if (!definition) return;
      const response = await client.runEvaluation(definition.id);
      const result = await waitForEvaluationJob(client, response.run);
      const [historyResponse, runResponse] = await Promise.all([
        client.listEvaluationRuns(definition.id),
        client.listRuns(workflow.id, 20),
      ]);
      setHistory(historyResponse.runs);
      setRuns(runResponse.runs as RunSummary[]);
      setSelectedRunIds(result.runIds);
      setMessage(result.status === 'completed'
        ? `Dataset evaluated across ${result.runIds.length} generated runs.`
        : result.status === 'cancelled'
          ? 'Dataset evaluation cancelled.'
          : result.error || 'Dataset evaluation failed.');
    } catch (error) {
      setMessage(datasetCancelRequested.current ? 'Dataset cancellation requested.' : (error as Error).message);
    } finally {
      activeEvaluationRunId.current = null;
      setEvaluationRunning(false);
      setDatasetRunning(false);
      setLoading(false);
    }
  };

  const cancelEvaluation = async () => {
    const runId = activeEvaluationRunId.current;
    if (!runId) return;
    try {
      const response = await getAgentBuilderClient(apiKeys).cancelEvaluationRun(runId);
      updateEvaluationJob(response.run);
      setMessage('Cancelling evaluation...');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const resumeEvaluation = async () => {
    if (!latestResult || latestResult.status !== 'awaiting_credentials') return;
    setLoading(true);
    setMessage(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const response = await client.resumeEvaluationRun(latestResult.id);
      const result = await waitForEvaluationJob(client, response.run);
      setMessage(result.status === 'completed'
        ? 'Evaluation resumed and completed.'
        : result.status === 'awaiting_credentials'
          ? `Credentials still required: ${result.credentialRequirements?.providers.join(', ') || 'provider key'}.`
          : result.error || `Evaluation ${result.status}.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      activeEvaluationRunId.current = null;
      setEvaluationRunning(false);
      setLoading(false);
    }
  };

  const cancelDataset = async () => {
    if (!datasetRunning) return;
    datasetCancelRequested.current = true;
    const client = getAgentBuilderClient(apiKeys);
    await Promise.all([
      activeEvaluationRunId.current ? cancelEvaluation() : Promise.resolve(),
      ...datasetRunIds.current.map(async (runId) => {
        try {
          const response = await client.getRun(runId);
          if (!['completed', 'failed', 'cancelled'].includes(response.run.status)) await client.cancelRun(runId);
        } catch {
          // The polling loop will surface any run that cannot be cancelled.
        }
      }),
    ]);
    setMessage('Cancelling dataset runs…');
  };

  const closePanel = () => {
    requestedEvaluationNodeId.set(null);
    evaluationPanelOpen.set(false);
  };

  const inspectGraderResult = (runId: string, result: ScopedGraderResult) => {
    const grader = graders.find((candidate) => candidate.id === result.graderId);
    if (grader?.nodeId) onFocusNode?.(grader.nodeId);
    evaluationTraceFocusRequest.set({
      runId,
      nodeId: grader?.nodeId,
      spanType: grader?.spanType,
      occurrence: grader?.occurrence,
      targetKey: result.targetKey,
    });
    runHistoryPanelOpen.set(true);
    closePanel();
  };

  const inspectEvaluationRun = (runId: string) => {
    evaluationTraceFocusRequest.set({ runId });
    runHistoryPanelOpen.set(true);
    closePanel();
  };

  const saveAnnotation = async (resultRunId: string, rating: 'positive' | 'negative') => {
    if (!latestResult) return;
    setSavingAnnotation(resultRunId);
    setMessage(null);
    try {
      const existing = latestResult.results.find((result) => result.runId === resultRunId)?.annotation;
      const response = await getAgentBuilderClient(apiKeys).annotateEvaluationResult(latestResult.id, resultRunId, {
        rating,
        feedback: annotationFeedback[resultRunId] ?? existing?.feedback,
      });
      updateEvaluationJob(response.run);
      setMessage('Human review saved.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSavingAnnotation(null);
    }
  };

  const toggleComparisonRun = (run: EvaluationRun) => {
    if (run.status !== 'completed') return;
    setComparisonRunIds((current) => current.includes(run.id)
      ? current.filter((runId) => runId !== run.id)
      : current.length < 2 ? [...current, run.id] : [current[1], run.id]);
  };

  const preferredNodeId = requestedNodeId && agentNodes.some((node) => node.id === requestedNodeId)
    ? requestedNodeId
    : undefined;
  const preferredNode = agentNodes.find((node) => node.id === preferredNodeId);
  const invalidLabelJudge = hasInvalidLabelJudge(graders);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="evaluation-dialog-title" className="flex max-h-[calc(100vh-48px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#303030] bg-[#1a1a1a] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#303030]">
          <div>
            <h2 id="evaluation-dialog-title" className="text-white text-[16px] font-semibold">Evaluate traces</h2>
            <p className="text-[#8a8a8a] text-[12px] mt-1">
              Save deterministic and model-judged grader sets and rerun them against workflow traces.
            </p>
          </div>
          <button
            title="Close evaluation"
            onClick={closePanel}
            className="text-[#8a8a8a] hover:text-white"
          >
            <X size={17} />
          </button>
        </div>

        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_220px] overflow-hidden">
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-[#303030] p-5">
            {preferredNode && (
              <div className="flex items-center justify-between rounded-md border border-cyan-900/60 bg-cyan-950/20 px-3 py-2 text-[11px]">
                <span className="min-w-0 truncate text-cyan-100">Attach graders to <strong>{preferredNode.name}</strong></span>
                <button type="button" onClick={() => requestedEvaluationNodeId.set(null)} className="shrink-0 text-cyan-300/70 hover:text-cyan-100">Workflow scope</button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <select
                value={selectedDefinitionId}
                onChange={(event) => {
                  const definition = definitions.find((item) => item.id === event.target.value);
                  void selectDefinition(definition);
                }}
                aria-label="Saved evaluation"
                className="min-w-0 flex-1 bg-[#252525] border border-[#303030] rounded-md px-3 h-9 text-white text-[13px] outline-none"
              >
                <option value="">New evaluation</option>
                {definitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>{definition.name}</option>
                ))}
              </select>
              <button
                title="Delete evaluation"
                aria-label="Delete evaluation"
                disabled={!selectedDefinitionId || loading}
                onClick={deleteDefinition}
                className="w-9 h-9 rounded-md border border-[#303030] text-[#8a8a8a] hover:text-red-300 disabled:opacity-40 flex items-center justify-center"
              >
                <Trash2 size={15} />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[#d4d4d4]">Dataset</span>
                <button
                  type="button"
                  onClick={() => setTestCases((current) => [...current, {
                    id: `case_${Date.now()}_${current.length}`,
                    name: `Test case ${current.length + 1}`,
                    input: { input_as_text: '' },
                    version: 0,
                  }])}
                  className="flex items-center gap-1 text-[11px] font-medium text-[#888] hover:text-white"
                >
                  <Plus size={12} /> Add case
                </button>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_92px_auto] gap-2">
                <select
                  value={selectedDatasetId}
                  onChange={(event) => void selectDataset(event.target.value)}
                  aria-label="Evaluation dataset"
                  className="h-8 min-w-0 rounded-md border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none"
                >
                  <option value="">Inline cases</option>
                  {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                </select>
                <select
                  value={selectedDatasetVersion ?? ''}
                  onChange={(event) => selectDatasetVersion(Number(event.target.value))}
                  disabled={!selectedDatasetId || datasetVersions.length === 0}
                  aria-label="Dataset version"
                  className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none disabled:opacity-40"
                >
                  <option value="">Version</option>
                  {datasetVersions.map((version) => <option key={version.version} value={version.version}>v{version.version}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => void publishDatasetVersion()}
                  disabled={loading || testCases.length === 0}
                  title={selectedDatasetId ? 'Publish these cases as a new immutable version' : 'Create a versioned dataset from these cases'}
                  className="h-8 rounded-md border border-[#3a3a3a] px-2 text-[10.5px] font-medium text-[#ccc] hover:text-white disabled:opacity-40"
                >
                  Publish
                </button>
              </div>
              {selectedDatasetVersion && (
                <div className="flex items-center justify-between text-[10px] text-[#777]">
                  <span>Evaluation pinned to dataset v{selectedDatasetVersion}</span>
                  <span className="font-mono">{datasetVersions.find((version) => version.version === selectedDatasetVersion)?.sha256.slice(0, 10)}</span>
                </div>
              )}
              <div className="flex max-h-[170px] flex-col gap-2 overflow-y-auto pr-1">
                {testCases.map((testCase, index) => {
                  const patchCase = (patch: Partial<EvaluationTestCase>) => setTestCases((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...patch } : candidate));
                  return (
                    <div key={testCase.id} className="rounded-md border border-[#303030] bg-[#202020] p-3">
                      <div className="flex items-center gap-2">
                        <input value={testCase.name} onChange={(event) => patchCase({ name: event.target.value })} aria-label={`Test case ${index + 1} name`} className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-white outline-none" />
                        <select value={testCase.version} onChange={(event) => patchCase({ version: Number(event.target.value) })} aria-label={`Test case ${index + 1} workflow version`} className="h-7 rounded border border-[#333] bg-[#252525] px-2 text-[10.5px] text-[#ccc] outline-none">
                          <option value={0}>Current draft</option>
                          {Array.from({ length: workflow?.latestVersion ?? 0 }, (_, version) => version + 1).reverse().map((version) => <option key={version} value={version}>Version {version}</option>)}
                        </select>
                        <button type="button" title="Remove test case" aria-label={`Remove test case ${index + 1}`} onClick={() => setTestCases((current) => current.filter((_, candidateIndex) => candidateIndex !== index))} className="text-[#666] hover:text-red-300"><Trash2 size={13} /></button>
                      </div>
                      <textarea
                        value={testCase.input.input_as_text ?? ''}
                        onChange={(event) => patchCase({ input: { ...testCase.input, input_as_text: event.target.value } })}
                        placeholder="User input"
                        aria-label={`Test case ${index + 1} input`}
                        rows={2}
                        className="mt-2 w-full resize-none rounded-md border border-[#333] bg-[#252525] px-2.5 py-2 text-[11.5px] text-white outline-none placeholder:text-[#666]"
                      />
                      <textarea
                        value={typeof testCase.expectedOutput === 'string' ? testCase.expectedOutput : testCase.expectedOutput === undefined ? '' : JSON.stringify(testCase.expectedOutput)}
                        onChange={(event) => patchCase({ expectedOutput: event.target.value })}
                        placeholder="Human reference answer (optional)"
                        aria-label={`Test case ${index + 1} expected output`}
                        rows={2}
                        className="mt-2 w-full resize-none rounded-md border border-[#333] bg-[#252525] px-2.5 py-2 text-[11.5px] text-white outline-none placeholder:text-[#666]"
                      />
                    </div>
                  );
                })}
                {testCases.length === 0 && <div className="rounded-md border border-dashed border-[#333] px-3 py-3 text-center text-[11.5px] text-[#666]">Add reusable inputs to generate evaluation runs.</div>}
              </div>
            </div>

            <label className="flex flex-col gap-2 text-[#d4d4d4] text-[12px] font-medium">
              Name
              <input
                value={definitionName}
                onChange={(event) => setDefinitionName(event.target.value)}
                className="w-full bg-[#252525] rounded-md px-3 h-9 text-white text-[13px] outline-none"
              />
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[#d4d4d4] text-[12px] font-medium">Graders</span>
                <button
                  type="button"
                  onClick={() => setGraders((current) => [...current, {
                    id: `grader_${Date.now()}_${current.length}`,
                    name: 'Output check',
                    type: 'contains',
                    target: 'output',
                    expected: '',
                    ...(preferredNodeId ? { nodeId: preferredNodeId, spanType: 'node' as const, field: 'output' as const, occurrence: 0 } : {}),
                  }])}
                  className="flex items-center gap-1 text-[11px] font-medium text-[#888] hover:text-white"
                >
                  <Plus size={12} /> Add grader
                </button>
              </div>
              <div className="flex max-h-[190px] flex-col gap-2 overflow-y-auto pr-1">
                {graders.map((grader, index) => {
                  const patchGrader = (patch: Partial<ScopedEvaluationGrader>) => setGraders((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...patch } : candidate));
                  return (
                    <div key={grader.id} className="rounded-md border border-[#303030] bg-[#202020] p-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={grader.name}
                          onChange={(event) => patchGrader({ name: event.target.value })}
                          aria-label={`Grader ${index + 1} name`}
                          className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-white outline-none"
                        />
                        <input type="number" min={0.1} max={100} step={0.1} value={grader.weight ?? 1} onChange={(event) => patchGrader({ weight: Math.max(0.1, Math.min(100, Number(event.target.value) || 1)) })} title="Grader weight" aria-label={`Grader ${index + 1} weight`} className="h-7 w-14 rounded border border-[#333] bg-[#252525] px-1.5 text-[10.5px] text-white outline-none" />
                        <button type="button" title="Remove grader" aria-label={`Remove grader ${index + 1}`} onClick={() => setGraders((current) => current.filter((_, candidateIndex) => candidateIndex !== index))} className="text-[#666] hover:text-red-300"><Trash2 size={13} /></button>
                      </div>
                      <div className="mt-2 flex rounded-md bg-[#181818] p-0.5">
                        <button type="button" onClick={() => patchGrader({ nodeId: undefined, spanType: undefined, occurrence: undefined, field: undefined })} className={`flex-1 rounded px-2 py-1 text-[10.5px] ${grader.nodeId ? 'text-[#777]' : 'bg-[#303030] text-white'}`}>Workflow</button>
                        <button type="button" disabled={agentNodes.length === 0} onClick={() => patchGrader({ nodeId: preferredNodeId ?? agentNodes[0]?.id, spanType: grader.spanType ?? 'node', field: grader.field ?? 'output', occurrence: grader.occurrence ?? 0 })} className={`flex-1 rounded px-2 py-1 text-[10.5px] disabled:opacity-30 ${grader.nodeId ? 'bg-[#303030] text-white' : 'text-[#777]'}`}>Agent node</button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          value={grader.type}
                          onChange={(event) => {
                            const type = event.target.value as EvaluationGrader['type'];
                            patchGrader({
                              type,
                              expected: type === 'run_status' ? 'completed' : type === 'event_count' ? 1 : '',
                              ...(type === 'label_model_judge' ? { labels: ['acceptable', 'needs_review'], passingLabels: ['acceptable'] } : {}),
                            });
                          }}
                          aria-label={`Grader ${index + 1} type`}
                          className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11.5px] text-white outline-none"
                        >
                          <option value="contains">Contains text</option>
                          <option value="equals">Equals value</option>
                          <option value="regex">Matches regex</option>
                          <option value="run_status">Run status</option>
                          <option value="event_count">Event count</option>
                          <option value="model_judge">Model judge</option>
                          <option value="label_model_judge">Label model judge</option>
                        </select>
                        {!grader.nodeId && ['contains', 'equals', 'regex'].includes(grader.type) && (
                          <select value={grader.target ?? 'output'} onChange={(event) => patchGrader({ target: event.target.value as 'output' | 'error' })} aria-label={`Grader ${index + 1} target`} className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11.5px] text-white outline-none">
                            <option value="output">Output</option>
                            <option value="error">Error</option>
                          </select>
                        )}
                        {grader.type === 'event_count' && (
                          <input value={grader.eventType ?? ''} onChange={(event) => patchGrader({ eventType: event.target.value })} placeholder="Event type (optional)" aria-label={`Grader ${index + 1} event type`} className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11.5px] text-white outline-none placeholder:text-[#666]" />
                        )}
                      </div>
                      {grader.nodeId && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <select value={grader.nodeId} onChange={(event) => patchGrader({ nodeId: event.target.value })} aria-label={`Grader ${index + 1} Agent node`} className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none">
                            {agentNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                          </select>
                          <select value={grader.spanType ?? 'node'} onChange={(event) => patchGrader({ spanType: event.target.value as SpanType })} aria-label={`Grader ${index + 1} span type`} className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none">
                            {(['node', 'llm', 'tool', 'guardrail', 'approval', 'state'] as SpanType[]).map((type) => <option key={type} value={type}>{type} span</option>)}
                          </select>
                          <select value={grader.field ?? 'output'} onChange={(event) => patchGrader({ field: event.target.value as SpanField })} aria-label={`Grader ${index + 1} span field`} className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none">
                            {(['output', 'status', 'error', 'duration', 'usage', 'arguments', 'result', 'toolCalls'] as SpanField[]).map((field) => <option key={field} value={field}>{field}</option>)}
                          </select>
                          <label className="flex h-8 items-center gap-2 rounded-md border border-[#333] bg-[#252525] px-2 text-[10px] text-[#777]">Occurrence<input type="number" min={1} max={1001} step={1} value={(grader.occurrence ?? 0) + 1} onChange={(event) => patchGrader({ occurrence: Math.max(0, Math.min(1000, Math.round(Number(event.target.value || 1)) - 1)) })} aria-label={`Grader ${index + 1} span occurrence`} className="min-w-0 flex-1 bg-transparent text-right text-[11px] text-white outline-none" /></label>
                        </div>
                      )}
                      {(grader.type === 'model_judge' || grader.type === 'label_model_judge') && (
                        <div className="mt-2 grid gap-2">
                          <div className={`grid gap-2 ${grader.type === 'model_judge' ? 'grid-cols-[1fr_100px]' : 'grid-cols-1'}`}>
                            <input value={grader.model ?? 'gemini-3-flash'} onChange={(event) => patchGrader({ model: event.target.value })} placeholder="Model ID" aria-label={`Grader ${index + 1} judge model`} className="h-8 w-full rounded-md border border-[#333] bg-[#252525] px-2 text-[11.5px] text-white outline-none placeholder:text-[#666]" />
                            {grader.type === 'model_judge' && <input type="number" min={0} max={1} step={0.05} value={grader.threshold ?? 0.5} onChange={(event) => patchGrader({ threshold: Math.max(0, Math.min(1, Number(event.target.value))) })} aria-label={`Grader ${index + 1} pass threshold`} title="Pass threshold" className="h-8 w-full rounded-md border border-[#333] bg-[#252525] px-2 text-[11.5px] text-white outline-none" />}
                          </div>
                          <textarea value={grader.rubric ?? ''} onChange={(event) => patchGrader({ rubric: event.target.value })} placeholder="Describe what a correct, useful response must satisfy" aria-label={`Grader ${index + 1} rubric`} rows={3} className="w-full resize-y rounded-md border border-[#333] bg-[#252525] px-2 py-2 text-[11.5px] text-white outline-none placeholder:text-[#666]" />
                          {grader.type === 'label_model_judge' && (
                            <div className="grid grid-cols-2 gap-2">
                              <input value={(grader.labels ?? []).join(', ')} onChange={(event) => { const labels = Array.from(new Set(event.target.value.split(',').map((label) => label.trim()).filter(Boolean))); patchGrader({ labels, passingLabels: (grader.passingLabels ?? []).filter((label) => labels.includes(label)) }); }} placeholder="Labels, comma separated" aria-label={`Grader ${index + 1} allowed labels`} className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none placeholder:text-[#666]" />
                              <select multiple value={grader.passingLabels ?? []} onChange={(event) => patchGrader({ passingLabels: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })} aria-label={`Grader ${index + 1} passing labels`} title="Passing labels" className="min-h-8 rounded-md border border-[#333] bg-[#252525] px-2 py-1 text-[11px] text-white outline-none">
                                {(grader.labels ?? []).map((label) => <option key={label} value={label}>{label}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-2">
                      {['contains', 'equals', 'regex', 'model_judge', 'label_model_judge'].includes(grader.type) && (
                        <label className="mb-2 flex items-center gap-2 text-[10.5px] text-[#999]">
                          <input
                            type="checkbox"
                            checked={grader.reference === 'test_case_expected'}
                            onChange={(event) => patchGrader({ reference: event.target.checked ? 'test_case_expected' : undefined })}
                          />
                          Compare with each test case's human reference
                        </label>
                      )}
                      {grader.type === 'run_status' ? (
                          <select value={String(grader.expected)} onChange={(event) => patchGrader({ expected: event.target.value })} aria-label={`Grader ${index + 1} expected status`} className="h-8 w-full rounded-md border border-[#333] bg-[#252525] px-2 text-[11.5px] text-white outline-none">
                            {['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug', 'completed', 'failed', 'cancelled'].map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        ) : grader.type === 'event_count' ? (
                          <input type="number" min={0} value={Number(grader.expected)} onChange={(event) => patchGrader({ expected: Number(event.target.value) })} aria-label={`Grader ${index + 1} minimum count`} className="h-8 w-full rounded-md border border-[#333] bg-[#252525] px-2 text-[11.5px] text-white outline-none" />
                        ) : grader.type !== 'model_judge' && grader.type !== 'label_model_judge' && grader.reference !== 'test_case_expected' ? (
                          <input
                            value={typeof grader.expected === 'string' ? grader.expected : JSON.stringify(grader.expected)}
                            onChange={(event) => {
                              const raw = event.target.value;
                              if (grader.type !== 'equals') patchGrader({ expected: raw });
                              else {
                                try { patchGrader({ expected: JSON.parse(raw) }); }
                                catch { patchGrader({ expected: raw }); }
                              }
                            }}
                            placeholder={grader.type === 'regex' ? '^expected pattern$' : 'Expected value'}
                            aria-label={`Grader ${index + 1} expected value`}
                            className="h-8 w-full rounded-md border border-[#333] bg-[#252525] px-2 text-[11.5px] text-white outline-none placeholder:text-[#666]"
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {graders.length === 0 && <div className="rounded-md border border-dashed border-[#333] px-3 py-4 text-center text-[11.5px] text-[#666]">Add at least one grader.</div>}
                {invalidLabelJudge && <div className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[10.5px] text-amber-200">Label judges need at least two unique labels and one selected passing label.</div>}
              </div>
            </div>

            <div className="rounded-md border border-[#303030] bg-[#202020] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[#a1a1aa] text-[11px] uppercase">Trace selection</span>
                {traceSelectionMode === 'manual' && <div className="flex items-center gap-2 text-[10.5px]">
                  <button type="button" onClick={() => setSelectedRunIds(runs.map((run) => run.id))} className="text-[#777] hover:text-white">All</button>
                  <button type="button" onClick={() => setSelectedRunIds([])} className="text-[#777] hover:text-white">None</button>
                  <span className="text-[#666]">{selectedRunIds.length}/{runs.length}</span>
                </div>}
              </div>
              <div className="mt-2 flex rounded-md bg-[#181818] p-0.5">
                <button type="button" onClick={() => setTraceSelectionMode('manual')} className={`flex-1 rounded px-2 py-1 text-[10.5px] ${traceSelectionMode === 'manual' ? 'bg-[#303030] text-white' : 'text-[#777]'}`}>Recent traces</button>
                <button type="button" onClick={() => setTraceSelectionMode('filters')} className={`flex-1 rounded px-2 py-1 text-[10.5px] ${traceSelectionMode === 'filters' ? 'bg-[#303030] text-white' : 'text-[#777]'}`}>Filter traces</button>
              </div>
              {traceSelectionMode === 'manual' ? <div className="mt-2 flex flex-col gap-1">
                {runs.slice(0, 5).map((run) => (
                  <label
                    key={run.id}
                    className={`flex items-center gap-2 px-2 h-7 rounded text-[12px] cursor-pointer ${
                      selectedRunIds.includes(run.id) ? 'bg-[#303030]' : 'hover:bg-[#292929]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedRunIds.includes(run.id)}
                      onChange={() => setSelectedRunIds((current) => current.includes(run.id) ? current.filter((id) => id !== run.id) : [...current, run.id])}
                      className="accent-white"
                    />
                    {run.status === 'completed'
                      ? <CheckCircle2 size={13} className="text-green-400" />
                      : <AlertCircle size={13} className="text-[#777]" />}
                    <span className="text-[#d4d4d4] font-mono truncate">{run.id}</span>
                    <span className="ml-auto text-[#777]">{run.status}</span>
                  </label>
                ))}
                {runs.length === 0 && <p className="text-[#666] text-[12px]">No preview runs yet.</p>}
              </div> : <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={traceFilters.model} onChange={(event) => setTraceFilters((current) => ({ ...current, model: event.target.value }))} placeholder="Model ID" aria-label="Trace model filter" className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none placeholder:text-[#666]" />
                <input value={traceFilters.tool} onChange={(event) => setTraceFilters((current) => ({ ...current, tool: event.target.value }))} placeholder="Tool name" aria-label="Trace tool filter" className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none placeholder:text-[#666]" />
                <label className="grid gap-1 text-[9.5px] text-[#777]">From<input type="datetime-local" value={traceFilters.from} max={traceFilters.to || undefined} onChange={(event) => setTraceFilters((current) => ({ ...current, from: event.target.value }))} aria-label="Trace start date" className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[10.5px] text-white outline-none" /></label>
                <label className="grid gap-1 text-[9.5px] text-[#777]">To<input type="datetime-local" value={traceFilters.to} min={traceFilters.from || undefined} onChange={(event) => setTraceFilters((current) => ({ ...current, to: event.target.value }))} aria-label="Trace end date" className="h-8 rounded-md border border-[#333] bg-[#252525] px-2 text-[10.5px] text-white outline-none" /></label>
                <button type="button" onClick={() => setTraceFilters(emptyTraceFilters())} disabled={!Object.values(traceFilters).some(Boolean)} className="col-span-2 justify-self-end text-[10.5px] text-[#777] hover:text-white disabled:opacity-30">Clear filters</button>
              </div>}
            </div>

            {message && <div className="text-[#b8b8b8] text-[12px]">{message}</div>}
            {comparison && (
              <section className="rounded-md border border-[#3a3a3a] bg-[#202020] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0"><div className="text-[9px] font-semibold uppercase text-[#666]">Baseline</div><div className="truncate font-mono text-[10.5px] text-[#bbb]">{comparisonRuns[0].id}</div></div>
                    <ArrowRight size={13} className="shrink-0 text-[#555]" />
                    <div className="min-w-0"><div className="text-[9px] font-semibold uppercase text-[#666]">Candidate</div><div className="truncate font-mono text-[10.5px] text-[#bbb]">{comparisonRuns[1].id}</div></div>
                  </div>
                  <div className={`shrink-0 text-right ${comparison.scoreDelta < -0.0001 ? 'text-red-300' : comparison.scoreDelta > 0.0001 ? 'text-green-300' : 'text-[#aaa]'}`}><div className="text-[9px] font-semibold uppercase opacity-70">Score delta</div><div className="text-[18px] font-semibold">{comparison.scoreDelta > 0 ? '+' : ''}{Math.round(comparison.scoreDelta * 100)} pts</div></div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center"><div><div className="text-[9px] uppercase text-[#666]">Regressions</div><div className="mt-0.5 text-[13px] font-semibold text-red-300">{comparison.regressions}</div></div><div><div className="text-[9px] uppercase text-[#666]">Improved</div><div className="mt-0.5 text-[13px] font-semibold text-green-300">{comparison.improvements}</div></div><div><div className="text-[9px] uppercase text-[#666]">Unchanged</div><div className="mt-0.5 text-[13px] font-semibold text-[#aaa]">{comparison.unchanged}</div></div></div>
                {comparison.datasetMatches === false && <div className="mt-2 rounded border border-amber-900/60 bg-amber-950/20 px-2.5 py-2 text-[10.5px] text-amber-200">Dataset snapshots differ. Aggregate and grader deltas remain valid, but case comparison includes only matching test-case IDs.</div>}
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[#303030] pt-3">
                  <div className="min-w-0"><div className="mb-1.5 text-[9px] font-semibold uppercase text-[#666]">Case deltas</div><div className="max-h-32 space-y-1 overflow-y-auto">{comparison.cases.slice(0, 10).map((item) => <button key={item.key} type="button" disabled={!item.candidateRunId} onClick={() => item.candidateRunId && inspectEvaluationRun(item.candidateRunId)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-black/20 disabled:cursor-default disabled:hover:bg-transparent"><span className="min-w-0 flex-1 truncate text-[10.5px] text-[#bbb]" title={item.name}>{item.name}</span><span className={`shrink-0 text-[10px] ${item.delta === null ? 'text-[#555]' : item.delta < -0.0001 ? 'text-red-300' : item.delta > 0.0001 ? 'text-green-300' : 'text-[#888]'}`}>{item.delta === null ? 'not comparable' : `${item.delta > 0 ? '+' : ''}${Math.round(item.delta * 100)} pts`}</span></button>)}{comparison.cases.length === 0 && <div className="text-[10.5px] text-[#666]">No case-level results.</div>}</div></div>
                  <div className="min-w-0"><div className="mb-1.5 text-[9px] font-semibold uppercase text-[#666]">Grader deltas</div><div className="max-h-32 space-y-1 overflow-y-auto">{comparison.graders.slice(0, 10).map((item) => <div key={item.graderId} className="flex items-center gap-2 rounded px-1.5 py-1"><span className="min-w-0 flex-1 truncate text-[10.5px] text-[#bbb]" title={item.name}>{item.name}</span><span className={`shrink-0 text-[10px] ${item.delta === null ? 'text-[#555]' : item.delta < -0.0001 ? 'text-red-300' : item.delta > 0.0001 ? 'text-green-300' : 'text-[#888]'}`}>{item.delta === null ? 'added/removed' : `${item.delta > 0 ? '+' : ''}${Math.round(item.delta * 100)} pts`}</span></div>)}{comparison.graders.length === 0 && <div className="text-[10.5px] text-[#666]">No grader results.</div>}</div></div>
                </div>
              </section>
            )}
            {latestResult && (
              <div className="rounded-md border border-[#3a3a3a] bg-[#202020] px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#d4d4d4] text-[12px]">Latest batch · {latestResult.runIds.length} traces</span>
                  {latestResult.status === 'completed' ? (
                    <span className="text-green-300 text-[18px] font-semibold">{Math.round(latestResult.score * 100)}%</span>
                  ) : (
                    <span className={`text-[11px] font-medium uppercase ${latestResult.status === 'failed' ? 'text-red-300' : latestResult.status === 'cancelled' ? 'text-amber-300' : 'text-blue-300'}`}>
                      {latestResult.status}
                    </span>
                  )}
                </div>
                {latestResult.datasetSnapshot && (
                  <div className="mt-1 flex items-center justify-between text-[10px] text-cyan-200/60">
                    <span>Dataset v{latestResult.datasetSnapshot.version} · {latestResult.datasetSnapshot.testCases.length} cases</span>
                    <span className="font-mono">{latestResult.datasetSnapshot.sha256.slice(0, 10)}</span>
                  </div>
                )}
                {latestResult.status !== 'completed' && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[10.5px] text-[#999]">
                      <span>Grading progress</span>
                      <span>{latestResult.completedRuns}/{latestResult.totalRuns}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded bg-[#333]">
                      <div className="h-full bg-blue-400 transition-[width]" style={{ width: `${latestResult.totalRuns > 0 ? Math.round((latestResult.completedRuns / latestResult.totalRuns) * 100) : 0}%` }} />
                    </div>
                  </div>
                )}
                {latestResult.error && <div className="mt-2 text-[11px] text-red-300">{latestResult.error}</div>}
                {latestResult.status === 'awaiting_credentials' && (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded border border-amber-900/60 bg-amber-950/20 px-2.5 py-2 text-[10.5px] text-amber-100">
                    <span>Requires {latestResult.credentialRequirements?.providers.join(', ') || 'provider'} credentials</span>
                    <button type="button" disabled={loading} onClick={() => void resumeEvaluation()} className="h-7 shrink-0 rounded border border-amber-700/60 px-2 font-medium hover:bg-amber-900/30 disabled:opacity-40">Resume</button>
                  </div>
                )}
                {(latestResult.usage?.modelCalls ?? 0) > 0 && (
                  <div className="mt-1 text-[10.5px] text-green-200/70">
                    Judge usage · {latestResult.usage!.modelCalls} model {latestResult.usage!.modelCalls === 1 ? 'call' : 'calls'} · {latestResult.usage!.inputTokens.toLocaleString()} input · {latestResult.usage!.outputTokens.toLocaleString()} output tokens
                  </div>
                )}
                {(latestUsageCost || latestUsageDetails.length > 0) && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-green-200/70">
                    {latestUsageCost && <span title={latestUsageCost.detail}>Estimated cost <strong className={latestUsageCost.status === 'unpriced' ? 'font-medium text-amber-200' : 'font-medium text-green-100'}>{latestUsageCost.value}</strong></span>}
                    {latestUsageDetails.map((item) => <span key={item.label}>{item.label} <strong className="font-medium text-green-100">{item.value.toLocaleString()}</strong></span>)}
                    {latestUnpricedCalls > 0 && <span className="text-amber-200">Unpriced calls <strong className="font-medium">{latestUnpricedCalls.toLocaleString()}</strong></span>}
                  </div>
                )}
                {latestUsageModels.length > 0 && (
                  <div className="mt-2 border-t border-green-900/50 pt-2">
                    <div className="flex items-center justify-between text-[10px] uppercase text-green-200/60">
                      <span>Model accounting</span>
                      {latestResult.usage?.pricingCatalogVersion && <span>{latestResult.usage.pricingCatalogVersion}</span>}
                    </div>
                    <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">
                      {latestUsageModels.map((bucket) => (
                        <div key={bucket.key} className="flex items-center gap-2 text-[10.5px] text-green-100/80">
                          <span className="min-w-0 flex-1 truncate" title={bucket.model}>{bucket.provider ? `${bucket.provider} · ` : ''}{bucket.model}</span>
                          <span className="shrink-0 text-green-200/60">{bucket.llmCalls} {bucket.llmCalls === 1 ? 'call' : 'calls'}</span>
                          <span className="shrink-0 text-green-200/60">{(bucket.inputTokens + bucket.outputTokens).toLocaleString()} tok</span>
                          <span className={`shrink-0 ${bucket.pricingStatus === 'unpriced' ? 'text-amber-200' : 'text-green-200/70'}`}>
                            {bucket.pricingStatus === 'unpriced' ? 'Unpriced' : bucket.estimatedCostUsd === undefined ? 'Cost unavailable' : `$${bucket.estimatedCostUsd.toFixed(4)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 max-h-32 space-y-2 overflow-y-auto border-t border-green-900/50 pt-2">
                  {latestResult.results.map((runResult) => {
                    const caseInspection = getEvaluationCaseInspection(latestResult, runResult.runId);
                    return (
                    <div key={runResult.runId} className="rounded bg-black/15 px-2 py-1.5">
                      <div className="flex items-center justify-between text-[10.5px]">
                        <span className="min-w-0 truncate text-green-100" title={caseInspection?.testCase.name ?? runResult.runId}>
                          {caseInspection ? caseInspection.testCase.name : <span className="font-mono">{runResult.runId}</span>}
                        </span>
                        <span className={runResult.score === 1 ? 'text-green-300' : 'text-amber-300'}>{Math.round(runResult.score * 100)}%</span>
                      </div>
                      {caseInspection && (
                        <details className="mt-1 rounded border border-[#303030] bg-black/10 px-2 py-1 text-[10px] text-[#aaa]">
                          <summary className="cursor-pointer select-none text-[#888] hover:text-[#bbb]">Inspect case input and expected output</summary>
                          <div className="mt-1.5 grid gap-1.5">
                            <div><div className="font-semibold uppercase text-[#666]">Input</div><pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[#bbb]">{caseInspection.input}</pre></div>
                            <div><div className="font-semibold uppercase text-[#666]">Expected output</div><pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[#bbb]">{caseInspection.expectedOutput ?? 'Not provided'}</pre></div>
                            <div className="truncate font-mono text-[#666]" title={runResult.runId}>Trace {runResult.runId}</div>
                          </div>
                        </details>
                      )}
                      {runResult.results.map((result) => (
                        <button key={result.graderId} type="button" onClick={() => inspectGraderResult(runResult.runId, result)} className={`mt-1 flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-[10.5px] hover:bg-black/20 ${result.passed ? 'text-green-300' : 'text-amber-200'}`}>
                          <Focus size={11} className="mt-0.5 shrink-0" />
                          <span className="min-w-0 flex-1"><strong className="font-medium">{result.name}</strong>: {result.detail}{result.targetFound === false ? ' (target missing)' : ''}</span>
                        </button>
                      ))}
                      <div className="mt-1.5 border-t border-green-900/40 pt-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="mr-auto text-[9px] font-semibold uppercase text-[#666]">Human review</span>
                          <button
                            type="button"
                            title="Mark this result helpful"
                            aria-label="Mark this result helpful"
                            disabled={savingAnnotation === runResult.runId}
                            onClick={() => void saveAnnotation(runResult.runId, 'positive')}
                            className={`rounded p-1 ${runResult.annotation?.rating === 'positive' ? 'bg-green-900/50 text-green-200' : 'text-[#777] hover:bg-white/5 hover:text-[#bbb]'}`}
                          >
                            <ThumbsUp size={12} />
                          </button>
                          <button
                            type="button"
                            title="Mark this result unhelpful"
                            aria-label="Mark this result unhelpful"
                            disabled={savingAnnotation === runResult.runId}
                            onClick={() => void saveAnnotation(runResult.runId, 'negative')}
                            className={`rounded p-1 ${runResult.annotation?.rating === 'negative' ? 'bg-red-900/40 text-red-200' : 'text-[#777] hover:bg-white/5 hover:text-[#bbb]'}`}
                          >
                            <ThumbsDown size={12} />
                          </button>
                        </div>
                        <textarea
                          value={annotationFeedback[runResult.runId] ?? runResult.annotation?.feedback ?? ''}
                          onChange={(event) => setAnnotationFeedback((current) => ({ ...current, [runResult.runId]: event.target.value }))}
                          maxLength={4000}
                          rows={2}
                          placeholder="Add reviewer feedback"
                          className="mt-1 w-full resize-y rounded border border-[#303030] bg-black/20 px-2 py-1 text-[10.5px] text-[#bbb] outline-none placeholder:text-[#555] focus:border-[#555]"
                        />
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-auto flex items-center justify-end gap-2">
              {datasetRunning || evaluationRunning ? (
                <button
                  type="button"
                  onClick={() => void (datasetRunning ? cancelDataset() : cancelEvaluation())}
                  className="flex h-9 items-center gap-2 rounded-md border border-red-900/70 bg-red-950/20 px-3 text-[13px] font-medium text-red-200 hover:bg-red-950/40"
                >
                  <Square size={13} />
                  {evaluationRunning && latestResult
                    ? `Cancel grading (${latestResult.completedRuns}/${latestResult.totalRuns})`
                    : `Cancel dataset (${datasetProgress.completed}/${datasetProgress.total})`}
                </button>
              ) : (
                <button
                  onClick={() => void runDataset()}
                  disabled={loading || testCases.length === 0 || graders.length === 0 || invalidLabelJudge || testCases.some((testCase) => !testCase.input.input_as_text?.trim())}
                  className="flex h-9 items-center gap-2 rounded-md border border-[#3a3a3a] px-3 text-[13px] font-medium text-white disabled:opacity-50"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />}
                  Run dataset
                </button>
              )}
              <button
                onClick={saveDefinition}
                disabled={loading || graders.length === 0 || invalidLabelJudge}
                className="h-9 px-3 rounded-md border border-[#3a3a3a] text-white text-[13px] font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <Save size={14} />
                Save
              </button>
              <button
                onClick={evaluate}
                disabled={loading || graders.length === 0 || invalidLabelJudge || (traceSelectionMode === 'manual' ? selectedRunIds.length === 0 : !Object.values(traceFilters).some((value) => value.trim()))}
                className="h-9 px-4 rounded-md bg-white text-black text-[13px] font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Play size={13} className="fill-current" />}
                {traceSelectionMode === 'filters' ? 'Evaluate matches' : `Evaluate ${selectedRunIds.length === 1 ? 'run' : `${selectedRunIds.length} runs`}`}
              </button>
            </div>
          </div>

          <aside className="overflow-y-auto bg-[#171717] p-4">
            <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-[#a1a1aa] text-[11px] uppercase"><History size={13} />History</div>{comparisonRunIds.length > 0 && <button type="button" onClick={() => setComparisonRunIds([])} className="text-[10px] text-[#777] hover:text-white">Clear compare</button>}</div>
            <div className="mt-1 text-[9.5px] text-[#666]">Select a baseline, then a candidate.</div>
            <div className="mt-3 flex flex-col gap-2">
              {history.slice(0, 8).map((item) => {
                const comparisonIndex = comparisonRunIds.indexOf(item.id);
                return <div key={item.id} className={`flex overflow-hidden rounded-md border bg-[#202020] ${comparisonIndex >= 0 ? 'border-cyan-800/70' : 'border-[#2d2d2d] hover:border-[#444]'}`}>
                  <button type="button" title={item.status === 'completed' ? comparisonIndex >= 0 ? 'Remove from comparison' : comparisonRunIds.length === 0 ? 'Set as baseline' : 'Set as candidate' : 'Only completed evaluations can be compared'} aria-label={item.status === 'completed' ? comparisonIndex >= 0 ? 'Remove evaluation from comparison' : 'Add evaluation to comparison' : 'Evaluation is not complete'} disabled={item.status !== 'completed'} onClick={() => toggleComparisonRun(item)} className={`flex w-8 shrink-0 items-center justify-center border-r border-[#303030] text-[10px] font-semibold disabled:opacity-30 ${comparisonIndex >= 0 ? 'bg-cyan-950/30 text-cyan-200' : 'text-[#555] hover:text-[#aaa]'}`}>{comparisonIndex === 0 ? 'B' : comparisonIndex === 1 ? 'C' : <GitCompare size={12} />}</button>
                  <button type="button" onClick={() => setLatestResult(item)} className="min-w-0 flex-1 px-3 py-2 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[#777] text-[10px]">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    {item.status === 'completed' ? (
                      <span className={item.score === 1 ? 'text-green-400 text-[12px]' : 'text-amber-300 text-[12px]'}>
                        {Math.round(item.score * 100)}%
                      </span>
                    ) : (
                      <span className={`text-[10px] font-medium uppercase ${item.status === 'failed' ? 'text-red-300' : item.status === 'cancelled' ? 'text-amber-300' : 'text-blue-300'}`}>
                        {item.status}
                      </span>
                    )}
                  </div>
                  <div className="text-[#a1a1aa] text-[11px] mt-1">
                    {item.runIds.length} {item.runIds.length === 1 ? 'trace' : 'traces'}
                  </div>
                  {item.status !== 'completed' && (
                    <div className="mt-1 text-[10.5px] text-[#777]">{item.completedRuns}/{item.totalRuns} graded</div>
                  )}
                  {item.error && <div className="mt-1 truncate text-[10.5px] text-red-300" title={item.error}>{item.error}</div>}
                  </button>
                </div>;
              })}
              {history.length === 0 && (
                <p className="text-[#666] text-[12px]">No evaluation history yet.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default EvaluationPanel;
