import React from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { useUserDataContext } from '../../context/UserDataContext';
import { getAgentBuilderClient, type BatchJob, type Run, type RunInput, type WorkflowVersion } from '../../lib/agentBuilder';
import { requestedRunHistoryRunId, runHistoryPanelOpen } from '../../lib/stores/agent-builder-store';

interface Props {
  open: boolean;
  workflowId: string;
  workflowName: string;
  latestVersion: number;
  onClose: () => void;
}

type InputMode = 'lines' | 'json';
type Action = 'submit' | 'cancel' | 'resume' | 'refresh' | 'export-json' | 'export-csv' | null;

const TERMINAL_BATCH_STATUSES = new Set(['completed', 'cancelled', 'failed']);
const ACTIVE_BATCH_STATUSES = new Set([
  'queued',
  'running',
  'awaiting_credentials',
  'awaiting_approval',
  'awaiting_client_tool',
  'awaiting_debug',
  'cancelling',
]);

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parseBatchInputs(mode: InputMode, text: string): RunInput[] {
  if (mode === 'lines') {
    const values = text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (values.length === 0) throw new Error('Add at least one non-empty input line.');
    if (values.length > 100) throw new Error('A batch can contain at most 100 inputs.');
    return values.map((input_as_text) => ({ input_as_text }));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('JSON mode requires an array of strings or run input objects.');
  if (parsed.length < 1 || parsed.length > 100) throw new Error('A batch must contain between 1 and 100 inputs.');
  return parsed.map((value, index) => {
    if (typeof value === 'string') return { input_as_text: value };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Item ${index + 1} must be a string or JSON object.`);
    }
    return value as RunInput;
  });
}

function statusTone(status: string): string {
  if (status === 'completed') return 'border-green-900/70 bg-green-950/30 text-green-300';
  if (status === 'failed') return 'border-red-900/70 bg-red-950/30 text-red-300';
  if (status === 'cancelled' || status === 'cancelling') return 'border-[#444] bg-[#252525] text-[#aaa]';
  if (status.startsWith('awaiting_')) return 'border-amber-800/70 bg-amber-950/25 text-amber-200';
  return 'border-cyan-900/70 bg-cyan-950/20 text-cyan-200';
}

function statusIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 size={13} className="text-green-400" />;
  if (status === 'failed') return <CircleAlert size={13} className="text-red-400" />;
  if (status === 'cancelled' || status === 'cancelling') return <Square size={12} className="text-[#777]" />;
  if (status.startsWith('awaiting_')) return <PauseCircle size={13} className="text-amber-300" />;
  return <Loader2 size={13} className="animate-spin text-cyan-300" />;
}

export const BatchRunPanel: React.FC<Props> = ({ open, workflowId, workflowName, latestVersion, onClose }) => {
  const { apiKeys } = useUserDataContext();
  const [versions, setVersions] = React.useState<WorkflowVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = React.useState(latestVersion);
  const [inputMode, setInputMode] = React.useState<InputMode>('lines');
  const [inputText, setInputText] = React.useState('Hello\nSummarize the main risks in this workflow');
  const [concurrency, setConcurrency] = React.useState(4);
  const [batch, setBatch] = React.useState<BatchJob | null>(null);
  const [recentBatches, setRecentBatches] = React.useState<BatchJob[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [action, setAction] = React.useState<Action>(null);
  const [exportProgress, setExportProgress] = React.useState<{ completed: number; total: number; failures: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const storageKey = `willow.agent-builder.last-batch.${workflowId}`;
  const historyRequestRef = React.useRef(0);
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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('[aria-labelledby="batch-runs-dialog-title"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  const loadRecentBatches = React.useCallback(async () => {
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    try {
      const response = await getAgentBuilderClient(apiKeys).listBatches({ workflowId, limit: 10, offset: 0 });
      if (requestId === historyRequestRef.current) setRecentBatches(response.data);
    } catch (reason) {
      if (requestId === historyRequestRef.current) setError((reason as Error).message);
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  }, [apiKeys, workflowId]);

  const refreshBatch = React.useCallback(async (batchId: string, showBusy = false) => {
    if (showBusy) setAction('refresh');
    try {
      const { batch: next } = await getAgentBuilderClient(apiKeys).getBatch(batchId);
      setBatch(next);
      setError(null);
      return next;
    } catch (reason) {
      setError((reason as Error).message);
      return null;
    } finally {
      if (showBusy) setAction(null);
    }
  }, [apiKeys]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    historyRequestRef.current += 1;
    setLoading(true);
    setError(null);
    setVersions([]);
    setRecentBatches([]);
    setBatch(null);
    const client = getAgentBuilderClient(apiKeys);
    const rememberedBatchId = (() => {
      try { return localStorage.getItem(storageKey); } catch { return null; }
    })();
    Promise.all([
      client.listVersions(workflowId),
      rememberedBatchId ? client.getBatch(rememberedBatchId).catch(() => null) : Promise.resolve(null),
      client.listBatches({ workflowId, limit: 10, offset: 0 }),
    ]).then(([versionResponse, batchResponse, historyResponse]) => {
      if (cancelled) return;
      setVersions(versionResponse.versions);
      const preferred = versionResponse.versions.some((version) => version.version === latestVersion)
        ? latestVersion
        : versionResponse.versions[0]?.version ?? 0;
      setSelectedVersion(preferred);
      setRecentBatches(historyResponse.data);
      // A remembered id can outlive a workflow switch; never show another
      // workflow's batch in this panel.
      const rememberedBatch = batchResponse?.batch?.workflowId === workflowId
        ? batchResponse.batch
        : null;
      setBatch(rememberedBatch);
      if (rememberedBatchId && !rememberedBatch) {
        try { localStorage.removeItem(storageKey); } catch { /* storage is optional */ }
      }
    }).catch((reason) => {
      if (!cancelled) setError((reason as Error).message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      historyRequestRef.current += 1;
    };
  }, [apiKeys, latestVersion, open, storageKey, workflowId]);

  React.useEffect(() => {
    if (!open || !batch?.id || !ACTIVE_BATCH_STATUSES.has(batch.status)) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const { batch: next } = await getAgentBuilderClient(apiKeys).getBatch(batch.id);
        if (!cancelled) setBatch(next);
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiKeys, batch?.id, batch?.status, open]);

  if (!open) return null;

  const submit = async () => {
    setAction('submit');
    setError(null);
    try {
      const inputs = parseBatchInputs(inputMode, inputText);
      if (!selectedVersion) throw new Error('Publish the workflow before starting a batch.');
      const { batch: submitted } = await getAgentBuilderClient(apiKeys).submitBatch(
        workflowId,
        inputs,
        selectedVersion,
        concurrency,
      );
      setBatch(submitted);
      void loadRecentBatches();
      try { localStorage.setItem(storageKey, submitted.id); } catch { /* storage is optional */ }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setAction(null);
    }
  };

  const cancel = async () => {
    if (!batch) return;
    setAction('cancel');
    setError(null);
    try {
      const { batch: next } = await getAgentBuilderClient(apiKeys).cancelBatch(batch.id);
      setBatch(next);
      void loadRecentBatches();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setAction(null);
    }
  };

  const resume = async () => {
    if (!batch) return;
    setAction('resume');
    setError(null);
    try {
      const { batch: next } = await getAgentBuilderClient(apiKeys).resumeBatch(batch.id);
      setBatch(next);
      void loadRecentBatches();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setAction(null);
    }
  };

  const inspectRun = (runId: string) => {
    requestedRunHistoryRunId.set(runId);
    runHistoryPanelOpen.set(true);
  };

  const exportBatch = async (format: 'json' | 'csv') => {
    if (!batch || !TERMINAL_BATCH_STATUSES.has(batch.status)) return;
    setAction(format === 'json' ? 'export-json' : 'export-csv');
    setExportProgress({ completed: 0, total: batch.items.length, failures: 0 });
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const items = await mapWithConcurrency(batch.items, 5, async (item) => {
        let run: Run | undefined;
        let fetchError: string | undefined;
        if (item.runId) {
          try {
            run = (await client.getRun(item.runId)).run;
          } catch (reason) {
            fetchError = (reason as Error).message;
          }
        }
        setExportProgress((current) => current ? {
          ...current,
          completed: current.completed + 1,
          failures: current.failures + (fetchError ? 1 : 0),
        } : current);
        return {
          index: item.index,
          batchStatus: item.status,
          runId: item.runId,
          batchError: item.error,
          credentialRequirements: item.credentialRequirements,
          batchStartedAt: item.startedAt,
          batchEndedAt: item.endedAt,
          fetchError,
          run: run ? {
            id: run.id,
            status: run.status,
            workflowId: run.workflowId,
            workflowVersion: run.workflowVersion,
            input: run.input,
            output: run.output,
            state: run.state,
            error: run.error,
            usage: run.usage,
            createdAt: run.createdAt,
            startedAt: run.startedAt,
            endedAt: run.endedAt,
          } : undefined,
        };
      });
      const failures = items.filter((item) => item.fetchError).length;
      if (format === 'json') {
        downloadText(
          `willow-batch-${batch.id}.json`,
          JSON.stringify({
            kind: 'willow.batch-results',
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            batch: {
              id: batch.id,
              workflowId: batch.workflowId,
              workflowVersion: batch.workflowVersion,
              concurrency: batch.concurrency,
              status: batch.status,
              total: batch.total,
              completed: batch.completed,
              failed: batch.failed,
              cancelled: batch.cancelled,
              error: batch.error,
              createdAt: batch.createdAt,
              updatedAt: batch.updatedAt,
              completedAt: batch.completedAt,
            },
            items,
          }, null, 2),
          'application/json',
        );
      } else {
        const headers = [
          'item_index', 'batch_id', 'workflow_id', 'workflow_version', 'batch_status', 'run_id', 'run_status',
          'input_json', 'output_json', 'state_json', 'error', 'usage_json', 'started_at', 'ended_at', 'fetch_error',
        ];
        const rows = items.map((item) => [
          item.index + 1,
          batch.id,
          batch.workflowId,
          batch.workflowVersion,
          item.batchStatus,
          item.runId,
          item.run?.status,
          item.run?.input,
          item.run?.output,
          item.run?.state,
          item.run?.error ?? item.batchError,
          item.run?.usage,
          item.run?.startedAt ?? item.batchStartedAt,
          item.run?.endedAt ?? item.batchEndedAt,
          item.fetchError,
        ].map(csvCell).join(','));
        downloadText(`willow-batch-${batch.id}.csv`, [headers.map(csvCell).join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
      }
      if (failures > 0) setError(`Export completed with ${failures} run fetch failure${failures === 1 ? '' : 's'}; affected items include fetchError.`);
    } catch (reason) {
      setError(`Batch export failed: ${(reason as Error).message}`);
    } finally {
      setAction(null);
      setExportProgress(null);
    }
  };

  const resetForm = () => {
    setBatch(null);
    setError(null);
    try { localStorage.removeItem(storageKey); } catch { /* storage is optional */ }
  };

  const terminalItems = batch ? batch.completed + batch.failed + batch.cancelled : 0;
  const progress = batch?.total ? Math.round((terminalItems / batch.total) * 100) : 0;
  const requiredProviders = [...new Set(batch?.items.flatMap((item) => item.credentialRequirements?.providers ?? []) ?? [])];

  return createPortal(
    <div className="fixed inset-0 z-[99999998] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="batch-runs-dialog-title" className="flex h-[min(820px,calc(100vh-48px))] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[#303030] bg-[#1a1a1a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#303030] px-5 py-4">
          <div>
            <h2 id="batch-runs-dialog-title" className="text-[16px] font-semibold text-white">Batch runs</h2>
            <p className="mt-1 text-[12px] text-[#888]">Run a published version against up to 100 durable inputs.</p>
          </div>
          <button type="button" title="Close batch runs" aria-label="Close batch runs" onClick={onClose} className="text-[#888] hover:text-white"><X size={17} /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-b border-[#303030] bg-[#171717] p-4 md:border-b-0 md:border-r">
            <div className="text-[10px] font-semibold uppercase text-[#777]">Workflow</div>
            <div className="mt-1 truncate text-[13px] text-white" title={workflowName}>{workflowName}</div>
            <label className="mt-4 block text-[10px] text-[#777]">Recent batches
              <div className="mt-1.5 flex gap-2">
                <select
                  value={batch?.id ?? ''}
                  disabled={historyLoading || recentBatches.length === 0}
                  onChange={(event) => {
                    const selected = recentBatches.find((candidate) => candidate.id === event.target.value);
                    if (!selected) return;
                    setBatch(selected);
                    setError(null);
                    try { localStorage.setItem(storageKey, selected.id); } catch { /* storage is optional */ }
                    void refreshBatch(selected.id);
                  }}
                  className="h-9 min-w-0 flex-1 rounded-md border border-[#333] bg-[#222] px-2.5 text-[10.5px] text-white outline-none disabled:opacity-50"
                >
                  {recentBatches.length === 0 && <option value="">No recent batches</option>}
                  {recentBatches.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.status.replaceAll('_', ' ')} | v{candidate.workflowVersion} | {new Date(candidate.createdAt).toLocaleString()}</option>)}
                </select>
                <button type="button" disabled={historyLoading} title="Reload recent batches" aria-label="Reload recent batches" onClick={() => void loadRecentBatches()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#333] text-[#888] hover:text-white disabled:opacity-40"><RefreshCw size={12} className={historyLoading ? 'animate-spin' : ''} /></button>
              </div>
            </label>
            <div className="mt-4 grid grid-cols-[1fr_110px] gap-3">
              <label className="text-[10px] text-[#777]">Published version
                <select value={selectedVersion} disabled={Boolean(batch) || versions.length === 0} onChange={(event) => setSelectedVersion(Number(event.target.value))} className="mt-1.5 h-9 w-full rounded-md border border-[#333] bg-[#222] px-2.5 text-[11.5px] text-white outline-none disabled:opacity-50">
                  {versions.map((version) => <option key={version.version} value={version.version}>Version {version.version}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-[#777]">Concurrency
                <input type="number" min={1} max={10} value={concurrency} disabled={Boolean(batch)} onChange={(event) => setConcurrency(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} className="mt-1.5 h-9 w-full rounded-md border border-[#333] bg-[#222] px-2.5 text-[11.5px] text-white outline-none disabled:opacity-50" />
              </label>
            </div>

            <div className="mt-4 flex rounded-md border border-[#333] p-0.5">
              {(['lines', 'json'] as InputMode[]).map((mode) => <button key={mode} type="button" disabled={Boolean(batch)} onClick={() => setInputMode(mode)} className={`h-8 flex-1 rounded text-[11px] disabled:opacity-50 ${inputMode === mode ? 'bg-[#333] text-white' : 'text-[#888] hover:text-white'}`}>{mode === 'lines' ? 'One per line' : 'JSON array'}</button>)}
            </div>
            <textarea
              value={inputText}
              disabled={Boolean(batch)}
              onChange={(event) => setInputText(event.target.value)}
              spellCheck={false}
              placeholder={inputMode === 'lines' ? 'First prompt\nSecond prompt' : '["First prompt", {"input_as_text":"Second prompt","variables":{}}]'}
              className="mt-2 h-72 w-full resize-none rounded-md border border-[#333] bg-[#111] p-3 font-mono text-[11px] leading-relaxed text-[#ddd] outline-none placeholder:text-[#555] disabled:opacity-60"
            />
            <div className="mt-1.5 text-[10px] leading-relaxed text-[#666]">JSON objects support the full run input contract, including variables, state variables, history, and attachments.</div>

            {!batch ? (
              <button type="button" disabled={action !== null || versions.length === 0} onClick={() => void submit()} className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-white text-[11.5px] font-medium text-black hover:bg-[#e5e5e5] disabled:opacity-40">{action === 'submit' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} className="fill-current" />} Start batch</button>
            ) : TERMINAL_BATCH_STATUSES.has(batch.status) ? (
              <button type="button" onClick={resetForm} className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-[#3a3a3a] text-[11.5px] text-[#ccc] hover:text-white"><RotateCcw size={13} /> New batch</button>
            ) : null}
            {versions.length === 0 && !loading && <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-2.5 text-[10.5px] text-amber-200">Publish the workflow to create a batchable version.</div>}
            {error && <div className="mt-3 whitespace-pre-wrap rounded-md border border-red-900/60 bg-red-950/20 p-2.5 text-[10.5px] text-red-300">{error}</div>}
          </aside>

          <main className="min-w-0 overflow-y-auto p-5">
            {loading && !batch && <div className="flex h-full items-center justify-center text-[#777]"><Loader2 size={18} className="animate-spin" /></div>}
            {!loading && !batch && <div className="flex h-full flex-col items-center justify-center text-center"><FileText size={22} className="text-[#555]" /><div className="mt-3 text-[13px] text-[#aaa]">Configure inputs and start a durable batch.</div><div className="mt-1 max-w-sm text-[11px] leading-relaxed text-[#666]">The latest batch is restored when this panel is reopened.</div></div>}
            {batch && <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><span className="font-mono text-[12px] text-white">{batch.id}</span><span className={`rounded border px-2 py-0.5 text-[9px] font-semibold uppercase ${statusTone(batch.status)}`}>{batch.status.replaceAll('_', ' ')}</span></div>
                  <div className="mt-1 text-[10.5px] text-[#777]">Version {batch.workflowVersion} | concurrency {batch.concurrency} | created {new Date(batch.createdAt).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={action !== null} title="Refresh batch" aria-label="Refresh batch" onClick={() => void refreshBatch(batch.id, true)} className="flex h-8 w-8 items-center justify-center rounded-md border border-[#3a3a3a] text-[#888] hover:text-white disabled:opacity-40"><RefreshCw size={12} className={action === 'refresh' ? 'animate-spin' : ''} /></button>
                  {TERMINAL_BATCH_STATUSES.has(batch.status) && <>
                    <button type="button" disabled={action !== null} onClick={() => void exportBatch('json')} className="flex h-8 items-center gap-1.5 rounded-md border border-[#3a3a3a] px-2.5 text-[10.5px] text-[#bbb] hover:text-white disabled:opacity-40">{action === 'export-json' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} JSON</button>
                    <button type="button" disabled={action !== null} onClick={() => void exportBatch('csv')} className="flex h-8 items-center gap-1.5 rounded-md border border-[#3a3a3a] px-2.5 text-[10.5px] text-[#bbb] hover:text-white disabled:opacity-40">{action === 'export-csv' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} CSV</button>
                  </>}
                  {batch.status === 'awaiting_credentials' && <button type="button" disabled={action !== null} onClick={() => void resume()} className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[10.5px] font-medium text-black disabled:opacity-40">{action === 'resume' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />} Resume</button>}
                  {ACTIVE_BATCH_STATUSES.has(batch.status) && batch.status !== 'cancelling' && <button type="button" disabled={action !== null} onClick={() => void cancel()} className="flex h-8 items-center gap-1.5 rounded-md border border-red-900/70 px-3 text-[10.5px] text-red-300 hover:bg-red-950/30 disabled:opacity-40">{action === 'cancel' ? <Loader2 size={12} className="animate-spin" /> : <Square size={11} />} Cancel</button>}
                </div>
              </div>

              {exportProgress && <section className="rounded-md border border-cyan-900/60 bg-cyan-950/20 p-3 text-[10.5px] text-cyan-100"><div className="flex items-center justify-between"><span>Collecting run results</span><span>{exportProgress.completed}/{exportProgress.total}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded bg-cyan-950"><div className="h-full rounded bg-cyan-300/80 transition-[width]" style={{ width: `${exportProgress.total ? (exportProgress.completed / exportProgress.total) * 100 : 0}%` }} /></div>{exportProgress.failures > 0 && <div className="mt-1.5 text-amber-200">{exportProgress.failures} run fetch failure{exportProgress.failures === 1 ? '' : 's'} will be preserved in the export.</div>}</section>}

              <section className="rounded-md border border-[#303030] bg-[#202020] p-3">
                <div className="flex items-center justify-between text-[10.5px] text-[#888]"><span>{terminalItems}/{batch.total} terminal</span><span>{progress}%</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded bg-[#303030]"><div className="h-full rounded bg-cyan-400/80 transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[['Completed', batch.completed, 'text-green-300'], ['Failed', batch.failed, 'text-red-300'], ['Cancelled', batch.cancelled, 'text-[#aaa]'], ['Remaining', Math.max(0, batch.total - terminalItems), 'text-cyan-200']].map(([label, value, tone]) => <div key={String(label)}><div className="text-[9px] uppercase text-[#666]">{label}</div><div className={`mt-0.5 text-[14px] font-semibold ${tone}`}>{value}</div></div>)}
                </div>
              </section>

              {batch.status === 'awaiting_credentials' && <section className="rounded-md border border-amber-900/60 bg-amber-950/20 p-3 text-[11px] text-amber-200"><div className="font-medium">Provider credentials required</div><div className="mt-1 text-amber-200/70">Configure {requiredProviders.join(', ') || 'the required provider'} credentials, then resume the batch.</div></section>}
              {batch.error && <section className="rounded-md border border-red-900/60 bg-red-950/20 p-3 text-[11px] text-red-300">{batch.error}</section>}

              <section className="overflow-hidden rounded-md border border-[#303030] bg-[#181818]">
                <div className="flex items-center justify-between border-b border-[#303030] px-3 py-2 text-[10px] font-semibold uppercase text-[#777]"><span>Items</span><span>{batch.total}</span></div>
                <div className="max-h-[500px] divide-y divide-[#252525] overflow-y-auto">
                  {batch.items.map((item) => <div key={item.index} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-8 shrink-0 text-right font-mono text-[10px] text-[#666]">#{item.index + 1}</div>
                    {statusIcon(item.status)}
                    <div className="min-w-0 flex-1"><div className="text-[10.5px] text-[#ccc]">{item.status.replaceAll('_', ' ')}</div>{item.error && <div className="mt-0.5 truncate text-[9.5px] text-red-300" title={item.error}>{item.error}</div>}{item.credentialRequirements?.providers.length ? <div className="mt-0.5 text-[9.5px] text-amber-300">Needs {item.credentialRequirements.providers.join(', ')}</div> : null}</div>
                    {item.runId ? <button type="button" onClick={() => inspectRun(item.runId!)} className="flex h-7 max-w-52 items-center gap-1 rounded border border-[#3a3a3a] px-2 text-[10px] text-[#aaa] hover:text-white"><span className="truncate font-mono">{item.runId}</span><ChevronRight size={10} className="shrink-0" /></button> : <span className="text-[9.5px] text-[#555]">Not started</span>}
                  </div>)}
                </div>
              </section>
            </div>}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BatchRunPanel;
