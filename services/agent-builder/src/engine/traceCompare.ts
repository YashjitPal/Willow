import type { JsonObject, JsonValue, Run, RunEvent, TraceSpan } from '../domain/types.ts';
import { sanitizeTraceValue } from './traceData.ts';

export interface TraceSpanComparison {
  key: string;
  left?: { id: string; type: TraceSpan['type']; name: string; nodeId?: string; status: TraceSpan['status']; durationMs?: number; data?: JsonObject };
  right?: { id: string; type: TraceSpan['type']; name: string; nodeId?: string; status: TraceSpan['status']; durationMs?: number; data?: JsonObject };
  statusChanged: boolean;
  nameChanged: boolean;
  durationDeltaMs?: number;
  outputChanged: boolean;
  usageChanged: boolean;
}

export interface TraceComparison {
  leftRunId: string;
  rightRunId: string;
  statusChanged: boolean;
  outputChanged: boolean;
  errorChanged: boolean;
  usageDelta: Record<string, number>;
  spans: TraceSpanComparison[];
}

export interface PortableTraceExport {
  kind: 'willow.run-trace';
  formatVersion: 1;
  exportedAt: string;
  run: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    deploymentId?: string;
    deploymentReleaseId?: string;
    deploymentRevision?: number;
    status: Run['status'];
    input: JsonObject;
    output?: JsonValue;
    error?: string;
    usage: Run['usage'];
  };
  events: RunEvent[];
  spans: TraceSpan[];
}

function durationMs(span: TraceSpan): number | undefined {
  if (!span.endedAt) return undefined;
  const value = Date.parse(span.endedAt) - Date.parse(span.startedAt);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function spanView(span: TraceSpan) {
  return {
    id: span.id,
    type: span.type,
    name: span.name,
    ...(span.nodeId ? { nodeId: span.nodeId } : {}),
    status: span.status,
    ...(durationMs(span) !== undefined ? { durationMs: durationMs(span) } : {}),
    ...(span.data ? { data: sanitizeTraceValue(span.data) as JsonObject } : {}),
  };
}

function dataChanged(left?: JsonObject, right?: JsonObject, key?: string): boolean {
  if (!key) return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
  return JSON.stringify(left?.[key] ?? null) !== JSON.stringify(right?.[key] ?? null);
}

export function compareTraceRuns(left: Run, right: Run, leftSpans: TraceSpan[], rightSpans: TraceSpan[]): TraceComparison {
  const spanGroups = new Map<string, { left?: TraceSpan; right?: TraceSpan }>();
  const counts = new Map<string, number>();
  const add = (side: 'left' | 'right', span: TraceSpan) => {
    // Current traces carry an occurrence that is stable across display-name changes
    // (for example, switching the model used by the same Agent node). Keep the
    // name-based counter only as a compatibility fallback for older traces.
    if (span.occurrence !== undefined) {
      const key = `${span.type}:${span.nodeId ?? ''}:#${span.occurrence}`;
      const group = spanGroups.get(key) ?? {};
      group[side] = span;
      spanGroups.set(key, group);
      return;
    }
    const base = `${span.type}:${span.nodeId ?? ''}:${span.name}`;
    const countKey = `${side}:${base}`;
    const occurrence = counts.get(countKey) ?? 0;
    counts.set(countKey, occurrence + 1);
    const key = `${base}:${occurrence}`;
    const group = spanGroups.get(key) ?? {};
    group[side] = span;
    spanGroups.set(key, group);
  };
  leftSpans.forEach((span) => add('left', span));
  rightSpans.forEach((span) => add('right', span));
  const spans = [...spanGroups.entries()].map(([key, group]) => {
    const leftView = group.left ? spanView(group.left) : undefined;
    const rightView = group.right ? spanView(group.right) : undefined;
    const leftDuration = leftView?.durationMs;
    const rightDuration = rightView?.durationMs;
    return {
      key,
      ...(leftView ? { left: leftView } : {}),
      ...(rightView ? { right: rightView } : {}),
      statusChanged: (leftView?.status ?? null) !== (rightView?.status ?? null),
      nameChanged: (leftView?.name ?? null) !== (rightView?.name ?? null),
      ...(leftDuration !== undefined && rightDuration !== undefined ? { durationDeltaMs: rightDuration - leftDuration } : {}),
      outputChanged: dataChanged(leftView?.data, rightView?.data, 'output'),
      usageChanged: dataChanged(leftView?.data, rightView?.data, 'usage'),
    };
  });
  const usageKeys = ['inputTokens', 'outputTokens', 'embeddingInputTokens', 'llmCalls', 'toolCalls', 'embeddingOperations', 'estimatedCostUsd', 'unpricedLlmCalls', 'unpricedEmbeddingOperations'];
  const usageDelta = Object.fromEntries(usageKeys.map((key) => [key, Number((Number((right.usage as any)[key] ?? 0) - Number((left.usage as any)[key] ?? 0)).toFixed(12))]));
  return {
    leftRunId: left.id,
    rightRunId: right.id,
    statusChanged: left.status !== right.status,
    outputChanged: JSON.stringify(sanitizeTraceValue(left.output)) !== JSON.stringify(sanitizeTraceValue(right.output)),
    errorChanged: left.error !== right.error,
    usageDelta,
    spans,
  };
}

export function portableTraceExport(run: Run, events: RunEvent[], spans: TraceSpan[]): PortableTraceExport {
  return {
    kind: 'willow.run-trace',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    run: {
      id: run.id,
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      ...(run.deploymentId ? { deploymentId: run.deploymentId } : {}),
      ...(run.deploymentReleaseId ? { deploymentReleaseId: run.deploymentReleaseId } : {}),
      ...(run.deploymentRevision !== undefined ? { deploymentRevision: run.deploymentRevision } : {}),
      status: run.status,
      input: sanitizeTraceValue(run.input) as JsonObject,
      ...(run.output !== undefined ? { output: sanitizeTraceValue(run.output) } : {}),
      // Keep exported failures bounded and apply the same trace sanitization
      // used for inputs, outputs, events, and spans. Provider errors can echo
      // request material and may otherwise bypass the export redaction path.
      ...(run.error ? { error: sanitizeTraceValue(run.error) as string } : {}),
      usage: sanitizeTraceValue(run.usage) as unknown as Run['usage'],
    },
    events: sanitizeTraceValue(events) as unknown as RunEvent[],
    spans: sanitizeTraceValue(spans) as unknown as TraceSpan[],
  };
}
