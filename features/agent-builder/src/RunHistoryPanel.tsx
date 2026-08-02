import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Filter,
  GitCompare,
  History,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import {
  exportAgentBuilderRunTrace,
  getAgentBuilderClient,
  queryAgentBuilderRuns,
  type Run,
  type RunEvent,
  type RunStatus,
  type TraceRetentionResult,
  type TraceSpan,
} from './agent-builder';
import {
  currentWorkflow,
  evaluationTraceFocusRequest,
  requestedRunHistoryRunId,
  runHistoryPanelOpen,
  type EvaluationTraceFocusRequest,
} from './agent-builder-store';
import type { AgentBuilderBackend } from './use-agent-builder-backend';
import { getUsageCostDisplay, getUsageDetailItems } from './usage-display';
import { trapDialogFocus } from '@willow/core/dialog-focus';

type TraceData = { run: Run; events: RunEvent[]; spans: TraceSpan[] };
type FilterState = {
  status: '' | RunStatus;
  type: string;
  nodeId: string;
  model: string;
  tool: string;
  error: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: FilterState = {
  status: '',
  type: '',
  nodeId: '',
  model: '',
  tool: '',
  error: '',
  from: '',
  to: '',
};

const PAGE_SIZE = 25;

function durationMs(span: TraceSpan): number | null {
  return span.endedAt ? Math.max(0, new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime()) : null;
}

function formatDuration(value: number | null): string {
  if (value === null) return 'running';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)}s`;
}

function statusDot(status: TraceSpan['status']): string {
  if (status === 'ok') return 'bg-green-400';
  if (status === 'error') return 'bg-red-400';
  if (status === 'cancelled') return 'bg-[#777]';
  return 'bg-blue-400';
}

function spanDepth(span: TraceSpan, spans: TraceSpan[]): number {
  let depth = 0;
  let parentId = span.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId) && depth < 6) {
    visited.add(parentId);
    depth += 1;
    parentId = spans.find((candidate) => candidate.id === parentId)?.parentId;
  }
  return depth;
}

function JsonSection({ label, value, tone = 'default' }: { label: string; value: unknown; tone?: 'default' | 'error' }) {
  if (value === undefined) return null;
  return (
    <section>
      <div className={`mb-1 text-[9px] font-semibold uppercase ${tone === 'error' ? 'text-red-300' : 'text-[#777]'}`}>{label}</div>
      <pre className={`max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-[#111] p-2 text-[10px] leading-relaxed ${tone === 'error' ? 'text-red-200' : 'text-[#bbb]'}`}>
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function SpanDetails({ span, onOpenRun }: { span: TraceSpan | null; onOpenRun: (runId: string) => void }) {
  if (!span) return <div className="flex h-full items-center justify-center px-5 text-center text-[11px] text-[#666]">Select a span to inspect its inputs, outputs, usage, and errors.</div>;
  const data = (span.data ?? {}) as Record<string, unknown>;
  const known = new Set(['input', 'output', 'request', 'arguments', 'result', 'usage', 'error', 'config']);
  const additional = Object.fromEntries(Object.entries(data).filter(([key]) => !known.has(key)));
  const childRunId = typeof data.childRunId === 'string' ? data.childRunId : null;
  return (
    <div className="space-y-3 p-3">
      <div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusDot(span.status)}`} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white">{span.name}</span>
          <span className="text-[9px] font-semibold uppercase text-[#777]">{span.type}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[9.5px] text-[#777]">
          <span>Status</span><span className="text-right text-[#bbb]">{span.status}</span>
          <span>Duration</span><span className="text-right text-[#bbb]">{formatDuration(durationMs(span))}</span>
          <span>Started</span><span className="text-right text-[#bbb]">{new Date(span.startedAt).toLocaleTimeString()}</span>
          {span.nodeId && <><span>Node</span><span className="truncate text-right font-mono text-[#bbb]" title={span.nodeId}>{span.nodeId}</span></>}
        </div>
      </div>
      <JsonSection label="Error" value={data.error} tone="error" />
      <JsonSection label="Input" value={data.input} />
      <JsonSection label="Request" value={data.request} />
      <JsonSection label="Arguments" value={data.arguments} />
      <JsonSection label="Output" value={data.output} />
      <JsonSection label="Result" value={data.result} />
      <JsonSection label="Usage" value={data.usage} />
      <JsonSection label="Configuration" value={data.config} />
      {Object.keys(additional).length > 0 && <JsonSection label="Details" value={additional} />}
      {childRunId && <button type="button" onClick={() => onOpenRun(childRunId)} className="flex w-full items-center justify-between rounded-md border border-[#3a3a3a] bg-[#222] px-2.5 py-2 text-left text-[10.5px] text-[#ccc] hover:border-[#555] hover:text-white"><span className="min-w-0 truncate">Open child run <span className="font-mono text-[#888]">{childRunId}</span></span><ChevronRight size={12} className="shrink-0" /></button>}
    </div>
  );
}

function TraceInspector({ spans, selectedSpanId, onSelect, onOpenRun }: { spans: TraceSpan[]; selectedSpanId: string | null; onSelect: (spanId: string) => void; onOpenRun: (runId: string) => void }) {
  const selectedSpan = spans.find((span) => span.id === selectedSpanId) ?? null;
  const rootStart = spans.length > 0 ? Math.min(...spans.map((span) => new Date(span.startedAt).getTime())) : 0;
  const rootEnd = spans.length > 0
    ? Math.max(...spans.map((span) => span.endedAt ? new Date(span.endedAt).getTime() : Date.now()))
    : rootStart;
  const total = Math.max(1, rootEnd - rootStart);
  return (
    <section className="overflow-hidden rounded-md border border-[#303030] bg-[#181818]">
      <div className="border-b border-[#303030] px-3 py-2 text-[10px] font-semibold uppercase text-[#777]">Span timeline | {spans.length} spans</div>
      <div className="grid min-h-[250px] grid-cols-[minmax(0,1fr)_280px]">
        <div className="max-h-[420px] divide-y divide-[#252525] overflow-y-auto border-r border-[#303030]">
          {spans.map((span) => {
            const depth = spanDepth(span, spans);
            const started = new Date(span.startedAt).getTime();
            const ended = span.endedAt ? new Date(span.endedAt).getTime() : rootEnd;
            const left = Math.max(0, Math.min(100, ((started - rootStart) / total) * 100));
            const width = Math.max(1.5, Math.min(100 - left, ((ended - started) / total) * 100));
            const selected = span.id === selectedSpanId;
            return (
              <button
                type="button"
                key={span.id}
                onClick={() => onSelect(span.id)}
                className={`block w-full px-3 py-2 text-left ${selected ? 'bg-[#292929]' : 'hover:bg-[#202020]'}`}
              >
                <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 12}px` }}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(span.status)}`} />
                  <span className="w-12 shrink-0 text-[8px] font-semibold uppercase text-[#666]">{span.type}</span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-[#ddd]">{span.name}</span>
                  <span className="shrink-0 text-[9px] text-[#666]">{formatDuration(durationMs(span))}</span>
                </div>
                <div className="relative mt-1.5 ml-5 h-1 overflow-hidden rounded bg-[#252525]">
                  <span className={`absolute top-0 h-full rounded ${span.status === 'error' ? 'bg-red-400/70' : span.type === 'llm' ? 'bg-cyan-400/70' : span.type === 'tool' ? 'bg-amber-400/70' : 'bg-[#8f8f8f]'}`} style={{ left: `${left}%`, width: `${width}%` }} />
                </div>
              </button>
            );
          })}
          {spans.length === 0 && <div className="px-3 py-5 text-[11px] text-[#666]">No spans were recorded.</div>}
        </div>
        <div className="max-h-[420px] overflow-y-auto"><SpanDetails span={selectedSpan} onOpenRun={onOpenRun} /></div>
      </div>
    </section>
  );
}

function indexedSpans(spans: TraceSpan[]): Array<{ key: string; span: TraceSpan }> {
  const counts = new Map<string, number>();
  return spans.map((span) => {
    if (span.occurrence !== undefined) {
      return { key: `${span.type}:${span.nodeId ?? ''}:#${span.occurrence}`, span };
    }
    const base = `${span.type}:${span.nodeId ?? ''}:${span.name}`;
    const occurrence = (counts.get(base) ?? 0) + 1;
    counts.set(base, occurrence);
    return { key: `${base}:${occurrence}`, span };
  });
}

function TraceComparison({ left, right, onClose }: { left: TraceData; right: TraceData; onClose: () => void }) {
  const leftByKey = new Map(indexedSpans(left.spans).map((entry) => [entry.key, entry.span]));
  const rightByKey = new Map(indexedSpans(right.spans).map((entry) => [entry.key, entry.span]));
  const keys = [...leftByKey.keys(), ...[...rightByKey.keys()].filter((key) => !leftByKey.has(key))];
  const summary = (run: Run) => [
    `${run.usage.inputTokens.toLocaleString()} input`,
    `${run.usage.outputTokens.toLocaleString()} output`,
    `${run.usage.llmCalls} model`,
    `${run.usage.toolCalls} tool`,
  ].join(' | ');
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><div className="text-[13px] font-semibold text-white">Trace comparison</div><div className="mt-0.5 text-[10px] text-[#777]">Spans are aligned by node and stable execution occurrence.</div></div>
        <button type="button" onClick={onClose} className="flex items-center gap-1.5 rounded-md border border-[#3a3a3a] px-2.5 py-1.5 text-[10.5px] text-[#bbb] hover:text-white"><ArrowLeft size={12} /> Single trace</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[left.run, right.run].map((run) => (
          <div key={run.id} className="rounded-md border border-[#303030] bg-[#202020] p-3">
            <div className="truncate font-mono text-[11px] text-white">{run.id}</div>
            <div className="mt-1 text-[10px] text-[#777]">{run.status} | {summary(run)}</div>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-md border border-[#303030] bg-[#181818]">
        <div className="grid grid-cols-[minmax(150px,1.2fr)_1fr_1fr_70px] border-b border-[#303030] bg-[#202020] px-3 py-2 text-[9px] font-semibold uppercase text-[#777]">
          <span>Span</span><span>{left.run.id.slice(-8)}</span><span>{right.run.id.slice(-8)}</span><span className="text-right">Delta</span>
        </div>
        <div className="max-h-[560px] divide-y divide-[#252525] overflow-y-auto">
          {keys.map((key) => {
            const a = leftByKey.get(key);
            const b = rightByKey.get(key);
            const aDuration = a ? durationMs(a) : null;
            const bDuration = b ? durationMs(b) : null;
            const delta = aDuration !== null && bDuration !== null ? bDuration - aDuration : null;
            const representative = a ?? b!;
            return (
              <div key={key} className="grid grid-cols-[minmax(150px,1.2fr)_1fr_1fr_70px] items-center gap-2 px-3 py-2 text-[10px]">
                <div className="min-w-0"><div className="truncate text-[#ddd]">{a && b && a.name !== b.name ? `${a.name} -> ${b.name}` : representative.name}</div><div className="mt-0.5 text-[8px] uppercase text-[#666]">{representative.type}</div></div>
                {[a, b].map((span, index) => <div key={index} className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${span ? statusDot(span.status) : 'bg-[#444]'}`} /><span className="text-[#aaa]">{span ? formatDuration(durationMs(span)) : 'missing'}</span></div>)}
                <span className={`text-right ${delta === null ? 'text-[#555]' : delta > 0 ? 'text-red-300' : delta < 0 ? 'text-green-300' : 'text-[#888]'}`}>{delta === null ? '-' : `${delta > 0 ? '+' : ''}${formatDuration(Math.abs(delta))}`}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export const RunHistoryPanel: React.FC<{ backend: AgentBuilderBackend }> = ({ backend }) => {
  const open = useStore(runHistoryPanelOpen);
  const workflow = useStore(currentWorkflow);
  const focusRequest = useStore(evaluationTraceFocusRequest);
  const requestedRunId = useStore(requestedRunHistoryRunId);
  const { apiKeys } = useUserDataContext();
  const [runs, setRuns] = React.useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = React.useState<Run | null>(null);
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [spans, setSpans] = React.useState<TraceSpan[]>([]);
  const [selectedSpanId, setSelectedSpanId] = React.useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [resumingRunId, setResumingRunId] = React.useState<string | null>(null);
  const [exportingRunId, setExportingRunId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draftFilters, setDraftFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const [cursorStack, setCursorStack] = React.useState<Array<string | undefined>>([undefined]);
  const [nextCursor, setNextCursor] = React.useState<string | undefined>();
  const [compareRuns, setCompareRuns] = React.useState<Run[]>([]);
  const [compareData, setCompareData] = React.useState<[TraceData, TraceData] | null>(null);
  const [comparing, setComparing] = React.useState(false);
  const [retentionOpen, setRetentionOpen] = React.useState(false);
  const [retentionBusy, setRetentionBusy] = React.useState(false);
  const [retentionStatus, setRetentionStatus] = React.useState<TraceRetentionResult | null>(null);
  const [retentionError, setRetentionError] = React.useState<string | null>(null);
  const [retentionForm, setRetentionForm] = React.useState({ enabled: false, maxRuns: 1000, maxAgeDays: 30, dryRun: true });
  const [lineageBackStack, setLineageBackStack] = React.useState<Run[]>([]);
  const inspectRequestRef = React.useRef(0);
  const pageRequestRef = React.useRef(0);
  const compareRequestRef = React.useRef(0);
  const selectedRunRef = React.useRef<Run | null>(null);
  selectedRunRef.current = selectedRun;
  const cursor = cursorStack[cursorStack.length - 1];
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
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') runHistoryPanelOpen.set(false); else trapDialogFocus(event, 'run-history-dialog-title'); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const inspect = React.useCallback(async (run: Run, focus?: EvaluationTraceFocusRequest) => {
    const requestId = ++inspectRequestRef.current;
    setSelectedRun(run);
    setExpandedEvent(null);
    setSelectedSpanId(null);
    setCompareData(null);
    setLoading(true);
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const [traceResponse, spanResponse] = await Promise.all([client.getTrace(run.id), client.getTraceSpans(run.id)]);
      if (requestId !== inspectRequestRef.current) return;
      setEvents(traceResponse.events);
      setSpans(spanResponse.spans);
      const matchingSpans = focus
        ? spanResponse.spans.filter((span) => (!focus.nodeId || span.nodeId === focus.nodeId) && (!focus.spanType || span.type === focus.spanType))
        : [];
      const targetSpan = matchingSpans[focus?.occurrence ?? 0]
        ?? spanResponse.spans.find((span) => span.type !== 'run')
        ?? spanResponse.spans[0];
      setSelectedSpanId(targetSpan?.id ?? null);
    } catch (reason) {
      if (requestId !== inspectRequestRef.current) return;
      setEvents([]);
      setSpans([]);
      setError((reason as Error).message);
    } finally {
      if (requestId === inspectRequestRef.current) setLoading(false);
    }
  }, [apiKeys]);

  const openRunById = React.useCallback(async (
    runId: string,
    options: { pushHistory?: boolean; focus?: EvaluationTraceFocusRequest } = {},
  ) => {
    if (!runId) return;
    pageRequestRef.current += 1;
    setLoading(true);
    setError(null);
    try {
      const { run } = await getAgentBuilderClient(apiKeys).getRun(runId);
      const activeRun = selectedRunRef.current;
      if (options.pushHistory !== false && activeRun && activeRun.id !== run.id) {
        setLineageBackStack((current) => [...current, activeRun].slice(-20));
      }
      await inspect(run, options.focus);
    } catch (reason) {
      setError((reason as Error).message);
      setLoading(false);
    }
  }, [apiKeys, inspect]);

  const navigateLineageBack = React.useCallback(() => {
    const previous = lineageBackStack.at(-1);
    if (!previous) return;
    setLineageBackStack((current) => current.slice(0, -1));
    void openRunById(previous.id, { pushHistory: false });
  }, [lineageBackStack, openRunById]);

  const loadPage = React.useCallback(async () => {
    if (!workflow) return;
    const requestId = ++pageRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await queryAgentBuilderRuns(workflow.id, {
        status: filters.status || undefined,
        type: filters.type.trim() || undefined,
        nodeId: filters.nodeId.trim() || undefined,
        model: filters.model.trim() || undefined,
        tool: filters.tool.trim() || undefined,
        error: filters.error.trim() || undefined,
        from: filters.from ? new Date(filters.from).toISOString() : undefined,
        to: filters.to ? new Date(filters.to).toISOString() : undefined,
        cursor,
        limit: PAGE_SIZE,
      });
      if (requestId !== pageRequestRef.current) return;
      setRuns(response.runs);
      setNextCursor(response.nextCursor);
      if (response.runs[0]) await inspect(response.runs[0]);
      else {
        setSelectedRun(null);
        setEvents([]);
        setSpans([]);
      }
    } catch (reason) {
      if (requestId === pageRequestRef.current) setError((reason as Error).message);
    } finally {
      if (requestId === pageRequestRef.current) setLoading(false);
    }
  }, [cursor, filters, inspect, workflow]);

  const loadRetention = React.useCallback(async () => {
    setRetentionBusy(true);
    setRetentionError(null);
    try {
      const status = await getAgentBuilderClient(apiKeys).getTraceRetentionStatus();
      setRetentionStatus(status);
      setRetentionForm((current) => ({
        ...current,
        enabled: status.enabled,
        maxRuns: status.maxRuns,
        maxAgeDays: status.maxAgeDays,
      }));
    } catch (reason) {
      setRetentionError((reason as Error).message);
    } finally {
      setRetentionBusy(false);
    }
  }, [apiKeys]);

  const applyRetention = async () => {
    setRetentionBusy(true);
    setRetentionError(null);
    try {
      const status = await getAgentBuilderClient(apiKeys).enforceTraceRetention(retentionForm);
      setRetentionStatus(status);
      if (!retentionForm.dryRun && (status.deleted ?? 0) > 0) await loadPage();
    } catch (reason) {
      setRetentionError((reason as Error).message);
    } finally {
      setRetentionBusy(false);
    }
  };

  React.useEffect(() => {
    if (!open || !workflow) return;
    void loadPage();
  }, [loadPage, open, workflow]);

  React.useEffect(() => {
    if (!open) return;
    void loadRetention();
  }, [loadRetention, open]);

  React.useEffect(() => {
    if (!open || !focusRequest) return;
    setLineageBackStack([]);
    void openRunById(focusRequest.runId, { pushHistory: false, focus: focusRequest }).finally(() => {
      if (evaluationTraceFocusRequest.get()?.runId === focusRequest.runId) evaluationTraceFocusRequest.set(null);
    });
  }, [focusRequest, open, openRunById]);

  React.useEffect(() => {
    if (!open || !requestedRunId) return;
    setLineageBackStack([]);
    void openRunById(requestedRunId, { pushHistory: false }).finally(() => {
      if (requestedRunHistoryRunId.get() === requestedRunId) requestedRunHistoryRunId.set(null);
    });
  }, [open, openRunById, requestedRunId]);

  React.useEffect(() => {
    compareRequestRef.current += 1;
    setCursorStack([undefined]);
    setNextCursor(undefined);
    setCompareRuns([]);
    setCompareData(null);
    setLineageBackStack([]);
  }, [workflow?.id]);

  if (!open) return null;

  const duration = selectedRun?.startedAt && selectedRun.endedAt
    ? Math.max(0, new Date(selectedRun.endedAt).getTime() - new Date(selectedRun.startedAt).getTime())
    : null;
  const output = selectedRun?.output === undefined ? '' : typeof selectedRun.output === 'string' ? selectedRun.output : JSON.stringify(selectedRun.output, null, 2);
  const usageCost = getUsageCostDisplay(selectedRun?.usage);
  const usageDetails = getUsageDetailItems(selectedRun?.usage);
  const inputForDisplay = selectedRun ? {
    ...selectedRun.input,
    ...(selectedRun.input.attachments ? { attachments: selectedRun.input.attachments.map(({ contentBase64: _contentBase64, ...metadata }) => metadata) } : {}),
  } : null;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const applyFilters = () => {
    setFilters(draftFilters);
    setCursorStack([undefined]);
  };

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setCursorStack([undefined]);
  };

  const toggleCompareRun = (run: Run) => {
    compareRequestRef.current += 1;
    setCompareData(null);
    setCompareRuns((current) => current.some((candidate) => candidate.id === run.id)
      ? current.filter((candidate) => candidate.id !== run.id)
      : current.length < 2 ? [...current, run] : [current[1], run]);
  };

  const openComparison = async () => {
    if (compareRuns.length !== 2) return;
    const requestId = ++compareRequestRef.current;
    const selectedIds = compareRuns.map((run) => run.id);
    setComparing(true);
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const data = await Promise.all(compareRuns.map(async (run): Promise<TraceData> => {
        const [trace, spanResponse] = await Promise.all([client.getTrace(run.id), client.getTraceSpans(run.id)]);
        return { run, events: trace.events, spans: spanResponse.spans };
      }));
      if (requestId !== compareRequestRef.current) return;
      const currentIds = compareRuns.map((run) => run.id);
      if (currentIds.some((id, index) => id !== selectedIds[index])) return;
      setCompareData(data as [TraceData, TraceData]);
    } catch (reason) {
      if (requestId !== compareRequestRef.current) return;
      setError((reason as Error).message);
    } finally {
      if (requestId === compareRequestRef.current) setComparing(false);
    }
  };

  const exportTrace = async (run: Run) => {
    setExportingRunId(run.id);
    setError(null);
    try {
      const artifact = await exportAgentBuilderRunTrace(run.id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `willow-trace-${run.id}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setExportingRunId(null);
    }
  };

  const resumeCredentials = async (run: Run) => {
    setResumingRunId(run.id);
    setError(null);
    try {
      await backend.resumeRun(run.id);
      const response = await getAgentBuilderClient(apiKeys).getRun(run.id);
      setSelectedRun(response.run);
      setRuns((current) => current.map((candidate) => candidate.id === run.id ? response.run : candidate));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setResumingRunId(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999999] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="run-history-dialog-title" className="flex h-[min(860px,calc(100vh-48px))] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-[#303030] bg-[#1a1a1a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#303030] px-5 py-4">
          <div><h2 id="run-history-dialog-title" className="text-[16px] font-semibold text-white">Run history</h2><p className="mt-1 text-[12px] text-[#888]">Filter, compare, replay, and export durable workflow traces.</p></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setRetentionOpen((value) => !value)} className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[10.5px] ${retentionOpen ? 'border-[#666] bg-[#2b2b2b] text-white' : 'border-[#3a3a3a] text-[#bbb] hover:text-white'}`}><Settings2 size={12} /> Retention</button>
            <button type="button" disabled={compareRuns.length !== 2 || comparing} onClick={() => void openComparison()} className="flex h-8 items-center gap-1.5 rounded-md border border-[#3a3a3a] px-2.5 text-[10.5px] text-[#bbb] hover:text-white disabled:opacity-40">
              {comparing ? <Loader2 size={12} className="animate-spin" /> : <GitCompare size={12} />} Compare {compareRuns.length}/2
            </button>
            <button type="button" title="Close run history" aria-label="Close run history" onClick={() => runHistoryPanelOpen.set(false)} className="text-[#888] hover:text-white"><X size={17} /></button>
          </div>
        </div>
        {retentionOpen && (
          <div className="border-b border-[#303030] bg-[#161616] px-5 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex h-8 items-center gap-2 text-[10.5px] text-[#aaa]"><input type="checkbox" checked={retentionForm.enabled} onChange={(event) => setRetentionForm((current) => ({ ...current, enabled: event.target.checked }))} className="h-3.5 w-3.5 accent-white" /> Enabled</label>
              <label className="text-[9px] uppercase text-[#666]">Max runs<input type="number" min={0} max={100000} step={1} disabled={!retentionForm.enabled} value={retentionForm.maxRuns} onChange={(event) => setRetentionForm((current) => ({ ...current, maxRuns: Math.max(0, Math.min(100000, Number(event.target.value) || 0)) }))} className="mt-1 block h-8 w-28 rounded-md border border-[#333] bg-[#222] px-2 text-[10.5px] text-white outline-none disabled:opacity-40" /></label>
              <label className="text-[9px] uppercase text-[#666]">Max age, days<input type="number" min={0} max={36500} step={1} disabled={!retentionForm.enabled} value={retentionForm.maxAgeDays} onChange={(event) => setRetentionForm((current) => ({ ...current, maxAgeDays: Math.max(0, Math.min(36500, Number(event.target.value) || 0)) }))} className="mt-1 block h-8 w-28 rounded-md border border-[#333] bg-[#222] px-2 text-[10.5px] text-white outline-none disabled:opacity-40" /></label>
              <label className="flex h-8 items-center gap-2 text-[10.5px] text-[#aaa]"><input type="checkbox" checked={retentionForm.dryRun} onChange={(event) => setRetentionForm((current) => ({ ...current, dryRun: event.target.checked }))} className="h-3.5 w-3.5 accent-white" /> Dry run</label>
              <button type="button" disabled={retentionBusy} onClick={() => void applyRetention()} className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[10.5px] font-medium text-black disabled:opacity-40">{retentionBusy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}{retentionForm.dryRun ? 'Preview cleanup' : 'Apply cleanup'}</button>
              <button type="button" title="Refresh retention status" aria-label="Refresh retention status" disabled={retentionBusy} onClick={() => void loadRetention()} className="flex h-8 w-8 items-center justify-center rounded-md border border-[#3a3a3a] text-[#888] hover:text-white disabled:opacity-40"><RefreshCw size={12} className={retentionBusy ? 'animate-spin' : ''} /></button>
              {retentionStatus && (
                <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#777]">
                  <span>Scanned <strong className="font-medium text-[#ccc]">{retentionStatus.scanned ?? '-'}</strong></span>
                  <span>Candidates <strong className="font-medium text-[#ccc]">{retentionStatus.candidates ?? '-'}</strong></span>
                  <span>Deleted <strong className="font-medium text-[#ccc]">{retentionStatus.deleted ?? '-'}</strong></span>
                  <span>Protected <strong className="font-medium text-[#ccc]">{retentionStatus.protected ?? '-'}</strong></span>
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9.5px] text-[#666]">
              <span>Limits apply globally. Active runs and evaluation-linked traces are protected.</span>
              {retentionStatus?.finishedAt && <span>Last cleanup {new Date(retentionStatus.finishedAt).toLocaleString()}</span>}
              {retentionStatus?.skipped && <span className="text-amber-300">Skipped: {retentionStatus.skipped.replace('_', ' ')}</span>}
              {(retentionError || retentionStatus?.error) && <span className="text-red-300">{retentionError ?? retentionStatus?.error}</span>}
            </div>
          </div>
        )}
        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-[#303030] bg-[#171717]">
            <div className="space-y-2 border-b border-[#303030] p-3">
              <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[#777]"><Filter size={11} /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span><button type="button" onClick={clearFilters} className="text-[10px] text-[#777] hover:text-white">Clear</button></div>
              <div className="grid grid-cols-2 gap-2">
                <select value={draftFilters.status} onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value as FilterState['status'] }))} className="h-8 rounded-md border border-[#333] bg-[#222] px-2 text-[10.5px] text-[#bbb] outline-none">
                  <option value="">Any status</option>{(['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug', 'completed', 'failed', 'cancelled'] as RunStatus[]).map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <select value={draftFilters.type} onChange={(event) => setDraftFilters((current) => ({ ...current, type: event.target.value }))} className="h-8 rounded-md border border-[#333] bg-[#222] px-2 text-[10.5px] text-[#bbb] outline-none">
                  <option value="">Any event</option>{['run', 'node', 'llm', 'tool', 'guardrail', 'state', 'approval', 'credentials', 'debug', 'subflow'].map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              {([['nodeId', 'Node ID'], ['model', 'Model'], ['tool', 'Tool'], ['error', 'Error contains']] as const).map(([key, placeholder]) => <input key={key} value={draftFilters[key]} onChange={(event) => setDraftFilters((current) => ({ ...current, [key]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }} placeholder={placeholder} className="h-8 w-full rounded-md border border-[#333] bg-[#222] px-2.5 text-[10.5px] text-white outline-none placeholder:text-[#666]" />)}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[9px] text-[#666]">From<input type="datetime-local" value={draftFilters.from} onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))} className="mt-1 h-8 w-full rounded-md border border-[#333] bg-[#222] px-1.5 text-[9px] text-[#aaa] outline-none" /></label>
                <label className="text-[9px] text-[#666]">To<input type="datetime-local" value={draftFilters.to} onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))} className="mt-1 h-8 w-full rounded-md border border-[#333] bg-[#222] px-1.5 text-[9px] text-[#aaa] outline-none" /></label>
              </div>
              <button type="button" onClick={applyFilters} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-white text-[10.5px] font-medium text-black hover:bg-[#e5e5e5]"><Check size={12} /> Apply filters</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {runs.map((run) => {
                const compared = compareRuns.some((candidate) => candidate.id === run.id);
                return (
                  <div key={run.id} className={`mb-2 flex rounded-md border ${selectedRun?.id === run.id && !compareData ? 'border-[#555] bg-[#292929]' : 'border-[#2d2d2d] bg-[#202020] hover:border-[#444]'}`}>
                    <button type="button" title={compared ? 'Remove from comparison' : 'Add to comparison'} aria-label={compared ? 'Remove from comparison' : 'Add to comparison'} onClick={() => toggleCompareRun(run)} className={`flex w-8 shrink-0 items-center justify-center border-r border-[#303030] ${compared ? 'text-cyan-300' : 'text-[#555] hover:text-[#aaa]'}`}><GitCompare size={12} /></button>
                    <button type="button" onClick={() => { setLineageBackStack([]); void inspect(run); }} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                      <div className="flex items-center gap-2">{run.status === 'completed' ? <CheckCircle2 size={13} className="text-green-400" /> : <AlertCircle size={13} className={run.status === 'failed' ? 'text-red-400' : 'text-amber-300'} />}<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white">{run.id}</span><span className="text-[9px] text-[#777]">{run.status}</span></div>
                      <div className="mt-1.5 flex items-center justify-between text-[9px] text-[#666]"><span>{new Date(run.createdAt).toLocaleString()}</span><span>v{run.workflowVersion || 'draft'}{run.input.attachments?.length ? ` | ${run.input.attachments.length} files` : ''}</span></div>
                    </button>
                  </div>
                );
              })}
              {!loading && runs.length === 0 && <div className="flex h-40 flex-col items-center justify-center text-[12px] text-[#666]"><History size={18} className="mb-2" />No matching runs.</div>}
            </div>
            <div className="flex items-center justify-between border-t border-[#303030] px-3 py-2">
              <button type="button" disabled={cursorStack.length === 1 || loading} onClick={() => setCursorStack((current) => current.slice(0, -1))} className="flex h-7 items-center gap-1 rounded px-2 text-[10px] text-[#888] hover:bg-[#252525] hover:text-white disabled:opacity-30"><ChevronLeft size={12} /> Previous</button>
              <span className="text-[9px] text-[#666]">Page {cursorStack.length}</span>
              <button type="button" disabled={!nextCursor || loading} onClick={() => nextCursor && setCursorStack((current) => [...current, nextCursor])} className="flex h-7 items-center gap-1 rounded px-2 text-[10px] text-[#888] hover:bg-[#252525] hover:text-white disabled:opacity-30">Next <ChevronRight size={12} /></button>
            </div>
          </aside>
          <main className="min-w-0 overflow-y-auto p-5">
            {loading && !selectedRun && <div className="flex h-full items-center justify-center text-[#777]"><Loader2 size={18} className="animate-spin" /></div>}
            {compareData ? <TraceComparison left={compareData[0]} right={compareData[1]} onClose={() => setCompareData(null)} /> : selectedRun && (
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div><div className="font-mono text-[13px] text-white">{selectedRun.id}</div><div className="mt-1 text-[11px] text-[#777]">{selectedRun.status} | {selectedRun.workflowVersion === 0 ? 'draft' : `version ${selectedRun.workflowVersion}`} | workflow {selectedRun.workflowId}{selectedRun.runDepth ? ` | depth ${selectedRun.runDepth}` : ''}</div></div>
                  <div className="flex items-center gap-2">
                    <button type="button" title="Refresh trace" aria-label="Refresh trace" disabled={loading} onClick={() => void inspect(selectedRun)} className="flex h-8 w-8 items-center justify-center rounded-md border border-[#3a3a3a] text-[#888] hover:text-white disabled:opacity-40"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
                    <button type="button" disabled={exportingRunId !== null} onClick={() => void exportTrace(selectedRun)} className="flex h-8 items-center gap-1.5 rounded-md border border-[#3a3a3a] px-2.5 text-[10.5px] text-[#bbb] hover:text-white disabled:opacity-40">{exportingRunId === selectedRun.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Export JSON</button>
                  </div>
                </div>
                {(lineageBackStack.length > 0 || selectedRun.parentRunId || (selectedRun.rootRunId && selectedRun.rootRunId !== selectedRun.id) || (selectedRun.childRunIds?.length ?? 0) > 0) && <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#303030] bg-[#202020] px-3 py-2 text-[10px] text-[#888]">
                  <span className="mr-1 font-semibold uppercase text-[#666]">Lineage</span>
                  {lineageBackStack.length > 0 && <button type="button" onClick={navigateLineageBack} className="flex h-7 items-center gap-1 rounded border border-[#3a3a3a] px-2 text-[#bbb] hover:text-white"><ArrowLeft size={11} /> Back</button>}
                  {selectedRun.parentRunId && <button type="button" onClick={() => void openRunById(selectedRun.parentRunId!)} className="flex h-7 max-w-56 items-center gap-1 rounded border border-[#3a3a3a] px-2 text-[#bbb] hover:text-white"><span className="shrink-0">Parent</span><span className="truncate font-mono text-[#777]">{selectedRun.parentRunId}</span></button>}
                  {selectedRun.rootRunId && selectedRun.rootRunId !== selectedRun.id && selectedRun.rootRunId !== selectedRun.parentRunId && <button type="button" onClick={() => void openRunById(selectedRun.rootRunId!)} className="flex h-7 max-w-56 items-center gap-1 rounded border border-[#3a3a3a] px-2 text-[#bbb] hover:text-white"><span className="shrink-0">Root</span><span className="truncate font-mono text-[#777]">{selectedRun.rootRunId}</span></button>}
                  {(selectedRun.childRunIds ?? []).map((childRunId, index) => <button type="button" key={childRunId} onClick={() => void openRunById(childRunId)} className="flex h-7 max-w-56 items-center gap-1 rounded border border-[#3a3a3a] px-2 text-[#bbb] hover:text-white"><span className="shrink-0">Child {index + 1}</span><span className="truncate font-mono text-[#777]">{childRunId}</span><ChevronRight size={10} className="shrink-0" /></button>)}
                </div>}
                <div className="grid grid-cols-5 gap-3 rounded-md border border-[#303030] bg-[#202020] p-3 text-center">
                  {[['Input', selectedRun.usage.inputTokens], ['Output', selectedRun.usage.outputTokens], ['Models', selectedRun.usage.llmCalls], ['Tools', selectedRun.usage.toolCalls], ['Time', duration === null ? '-' : formatDuration(duration)]].map(([label, value]) => <div key={String(label)}><div className="text-[9px] uppercase text-[#666]">{label}</div><div className="mt-0.5 text-[11px] text-[#ddd]">{value}</div></div>)}
                </div>
                {(usageCost || usageDetails.length > 0) && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-[#303030] bg-[#202020] px-3 py-2 text-[10.5px] text-[#888]">{usageCost && <span title={usageCost.detail}>Estimated cost <strong className={usageCost.status === 'unpriced' ? 'font-medium text-amber-300' : 'font-medium text-[#ddd]'}>{usageCost.value}</strong></span>}{usageDetails.map((item) => <span key={item.label}>{item.label} <strong className="font-medium text-[#bbb]">{item.value.toLocaleString()}</strong></span>)}</div>}
                {selectedRun.status === 'awaiting_credentials' && <section className="rounded-md border border-[#5a4320] bg-[#2b2115] p-3"><div className="text-[12px] font-medium text-[#f0d49a]">Credentials required to resume</div><div className="mt-1 text-[11px] text-[#d4b978]">Required: {(selectedRun.credentialRequirements?.providers ?? []).join(', ') || 'configured provider'}</div><button type="button" disabled={resumingRunId !== null} onClick={() => void resumeCredentials(selectedRun)} className="mt-2 flex h-8 items-center gap-1.5 rounded-md bg-white px-2.5 text-[11px] font-medium text-black hover:bg-[#e5e5e5] disabled:opacity-50">{resumingRunId === selectedRun.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />} Retry with configured credentials</button></section>}
                <div className="flex items-center justify-between gap-3 rounded-md border border-[#303030] bg-[#202020] px-3 py-2.5"><div className="text-[11px] text-[#888]">Replay the original input on the exact graph snapshot used by this run.</div><button type="button" onClick={() => void backend.replayRun(selectedRun.id)} className="flex shrink-0 items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-[11px] font-medium text-black hover:bg-[#e5e5e5]"><Play size={12} fill="currentColor" /> Replay run</button></div>
                <div className="grid grid-cols-2 gap-3">
                  <section className="min-w-0 rounded-md border border-[#303030] bg-[#202020] p-3"><div className="mb-2 text-[10px] font-semibold uppercase text-[#777]">Input</div><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words text-[10.5px] text-[#ccc]">{JSON.stringify(inputForDisplay, null, 2)}</pre></section>
                  <section className={`min-w-0 rounded-md border p-3 ${selectedRun.error ? 'border-red-900/60 bg-red-950/20' : 'border-[#303030] bg-[#202020]'}`}><div className="mb-2 text-[10px] font-semibold uppercase text-[#777]">{selectedRun.error ? 'Error' : 'Output'}</div><pre className={`max-h-52 overflow-auto whitespace-pre-wrap break-words text-[10.5px] ${selectedRun.error ? 'text-red-300' : 'text-[#ccc]'}`}>{(selectedRun.error ?? output) || 'No final output.'}</pre></section>
                </div>
                <TraceInspector spans={spans} selectedSpanId={selectedSpanId} onSelect={setSelectedSpanId} onOpenRun={(runId) => void openRunById(runId)} />
                <section className="overflow-hidden rounded-md border border-[#303030] bg-[#181818]"><div className="border-b border-[#303030] px-3 py-2 text-[10px] font-semibold uppercase text-[#777]">Raw trace | {events.length} events</div><div className="max-h-[300px] divide-y divide-[#252525] overflow-y-auto">{events.filter((event) => event.type !== 'llm.delta').map((event, index) => { const key = `${event.type}-${event.at}-${index}`; const expanded = expandedEvent === key; const payload = Object.fromEntries(Object.entries(event).filter(([field]) => !['type', 'at', 'runId'].includes(field))); return <button type="button" key={key} onClick={() => setExpandedEvent(expanded ? null : key)} className="block w-full px-3 py-2 text-left hover:bg-[#202020]"><div className="flex items-center justify-between"><span className="font-mono text-[11px] text-[#ddd]">{event.type}</span><span className="flex items-center gap-1 text-[10px] text-[#666]">{new Date(event.at).toLocaleTimeString()}{expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</span></div>{expanded && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[#111] p-2 text-[10px] text-[#aaa]">{JSON.stringify(payload, null, 2)}</pre>}</button>; })}</div></section>
              </div>
            )}
            {error && <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/20 p-3 text-[12px] text-red-300">{error}</div>}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default RunHistoryPanel;
