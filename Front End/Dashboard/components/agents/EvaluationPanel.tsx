import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  Play,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useUserDataContext } from '../../context/UserDataContext';
import {
  getAgentBuilderClient,
  type EvaluationDefinition,
  type EvaluationGrader,
  type EvaluationRun,
} from '../../lib/agentBuilder';
import { currentWorkflow, evaluationPanelOpen } from '../../lib/stores/agent-builder-store';

type RunSummary = { id: string; status: string; output?: unknown; createdAt?: string };

function gradersFor(expected: string): EvaluationGrader[] {
  return [
    { id: 'status', name: 'Run completed', type: 'run_status', expected: 'completed' },
    ...(expected.trim()
      ? [{
          id: 'output',
          name: 'Output contains expected text',
          type: 'contains' as const,
          expected: expected.trim(),
        }]
      : []),
  ];
}

function expectedFrom(definition: EvaluationDefinition): string {
  const grader = definition.graders.find((candidate) => candidate.type === 'contains');
  return typeof grader?.expected === 'string' ? grader.expected : '';
}

export const EvaluationPanel: React.FC = () => {
  const open = useStore(evaluationPanelOpen);
  const workflow = useStore(currentWorkflow);
  const { apiKeys } = useUserDataContext();
  const [runs, setRuns] = React.useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState('');
  const [definitions, setDefinitions] = React.useState<EvaluationDefinition[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = React.useState('');
  const [definitionName, setDefinitionName] = React.useState('Preview quality');
  const [expected, setExpected] = React.useState('');
  const [history, setHistory] = React.useState<EvaluationRun[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [score, setScore] = React.useState<number | null>(null);

  const selectDefinition = React.useCallback(async (
    definition: EvaluationDefinition | undefined,
  ) => {
    setSelectedDefinitionId(definition?.id ?? '');
    setDefinitionName(definition?.name ?? 'Preview quality');
    setExpected(definition ? expectedFrom(definition) : '');
    setScore(null);
    if (!definition) {
      setHistory([]);
      return;
    }
    try {
      const response = await getAgentBuilderClient(apiKeys).listEvaluationRuns(definition.id);
      setHistory(response.runs);
    } catch {
      setHistory([]);
    }
  }, [apiKeys]);

  React.useEffect(() => {
    if (!open || !workflow) return;
    let cancelled = false;
    setMessage(null);
    setScore(null);
    setLoading(true);
    const client = getAgentBuilderClient(apiKeys);
    Promise.all([
      client.listRuns(workflow.id, 20),
      client.listEvaluations(workflow.id),
    ]).then(async ([runResponse, evaluationResponse]) => {
      if (cancelled) return;
      const nextRuns = runResponse.runs as RunSummary[];
      setRuns(nextRuns);
      setSelectedRunId(nextRuns[0]?.id ?? '');
      setDefinitions(evaluationResponse.evaluations);
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

  const persistDefinition = async (): Promise<EvaluationDefinition | null> => {
    if (!workflow) return null;
    const client = getAgentBuilderClient(apiKeys);
    const input = {
      name: definitionName.trim() || 'Preview quality',
      graders: gradersFor(expected),
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
    if (!selectedRunId) {
      setMessage('Run a preview first, then evaluate its trace.');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const definition = await persistDefinition();
      if (!definition) return;
      const response = await client.runEvaluation(definition.id, [selectedRunId]);
      setScore(response.run.score);
      const historyResponse = await client.listEvaluationRuns(definition.id);
      setHistory(historyResponse.runs);
      setMessage('Trace evaluated.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm p-6">
      <div className="w-full max-w-2xl bg-[#1a1a1a] border border-[#303030] rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#303030]">
          <div>
            <h2 className="text-white text-[16px] font-semibold">Evaluate traces</h2>
            <p className="text-[#8a8a8a] text-[12px] mt-1">
              Save deterministic grader sets and rerun them against workflow traces.
            </p>
          </div>
          <button
            title="Close evaluation"
            onClick={() => evaluationPanelOpen.set(false)}
            className="text-[#8a8a8a] hover:text-white"
          >
            <X size={17} />
          </button>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_220px] min-h-[430px]">
          <div className="p-5 flex flex-col gap-4 border-r border-[#303030]">
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

            <label className="flex flex-col gap-2 text-[#d4d4d4] text-[12px] font-medium">
              Name
              <input
                value={definitionName}
                onChange={(event) => setDefinitionName(event.target.value)}
                className="w-full bg-[#252525] rounded-md px-3 h-9 text-white text-[13px] outline-none"
              />
            </label>

            <label className="flex flex-col gap-2 text-[#d4d4d4] text-[12px] font-medium">
              Expected output contains
              <input
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
                placeholder="Optional text check"
                className="w-full bg-[#252525] rounded-md px-3 h-9 text-white text-[13px] outline-none placeholder:text-[#666]"
              />
            </label>

            <div className="rounded-md border border-[#303030] bg-[#202020] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[#a1a1aa] text-[11px] uppercase">Preview runs</span>
                <span className="text-[#666] text-[11px]">{runs.length}</span>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {runs.slice(0, 5).map((run) => (
                  <label
                    key={run.id}
                    className={`flex items-center gap-2 px-2 h-7 rounded text-[12px] cursor-pointer ${
                      selectedRunId === run.id ? 'bg-[#303030]' : 'hover:bg-[#292929]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="evaluation-run"
                      checked={selectedRunId === run.id}
                      onChange={() => setSelectedRunId(run.id)}
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
              </div>
            </div>

            {message && <div className="text-[#b8b8b8] text-[12px]">{message}</div>}
            {score !== null && (
              <div className="flex items-center justify-between rounded-md border border-[#31583f] bg-[#142319] px-3 py-2">
                <span className="text-green-200 text-[12px]">Latest score</span>
                <span className="text-green-300 text-[18px] font-semibold">
                  {Math.round(score * 100)}%
                </span>
              </div>
            )}

            <div className="mt-auto flex items-center justify-end gap-2">
              <button
                onClick={saveDefinition}
                disabled={loading}
                className="h-9 px-3 rounded-md border border-[#3a3a3a] text-white text-[13px] font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <Save size={14} />
                Save
              </button>
              <button
                onClick={evaluate}
                disabled={loading || !selectedRunId}
                className="h-9 px-4 rounded-md bg-white text-black text-[13px] font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Play size={13} className="fill-current" />}
                Evaluate run
              </button>
            </div>
          </div>

          <aside className="p-4 bg-[#171717]">
            <div className="flex items-center gap-2 text-[#a1a1aa] text-[11px] uppercase">
              <History size={13} />
              History
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {history.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-md border border-[#2d2d2d] bg-[#202020] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[#777] text-[10px]">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    <span className={item.score === 1 ? 'text-green-400 text-[12px]' : 'text-amber-300 text-[12px]'}>
                      {Math.round(item.score * 100)}%
                    </span>
                  </div>
                  <div className="text-[#a1a1aa] text-[11px] mt-1">
                    {item.runIds.length} {item.runIds.length === 1 ? 'trace' : 'traces'}
                  </div>
                </div>
              ))}
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
