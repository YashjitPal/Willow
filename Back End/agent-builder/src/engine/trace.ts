import type { JsonObject, Run, RunEvent, TraceSpan } from '../domain/types.ts';

function spanStatus(runStatus: Run['status']): TraceSpan['status'] {
  if (runStatus === 'completed') return 'ok';
  if (runStatus === 'failed') return 'error';
  if (runStatus === 'cancelled') return 'cancelled';
  return 'running';
}

/** Materialize an Agent Builder-style span tree from durable run events. */
export function buildTraceSpans(run: Run, events: RunEvent[]): TraceSpan[] {
  let sequence = 0;
  const nextId = (kind: string) => `${run.id}:${kind}:${++sequence}`;
  const spans: TraceSpan[] = [];
  const occurrences = new Map<string, number>();
  const occurrence = (type: TraceSpan['type'], nodeId?: string) => {
    const key = `${type}:${nodeId ?? ''}`;
    const value = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, value);
    return value;
  };
  const runSpan: TraceSpan = {
    id: nextId('run'),
    runId: run.id,
    type: 'run',
    name: 'Workflow run',
    startedAt: run.startedAt ?? run.createdAt,
    endedAt: run.endedAt,
    status: spanStatus(run.status),
    data: { workflowVersion: run.workflowVersion, ...(run.deploymentId ? { deploymentId: run.deploymentId } : {}), ...(run.deploymentReleaseId ? { deploymentReleaseId: run.deploymentReleaseId } : {}), ...(run.deploymentRevision !== undefined ? { deploymentRevision: run.deploymentRevision } : {}), usage: run.usage as unknown as JsonObject[string] },
  };
  spans.push(runSpan);

  const activeNodes = new Map<string, TraceSpan>();
  const activeLlm = new Map<string, TraceSpan[]>();
  const activeTools = new Map<string, TraceSpan[]>();
  const activeApprovals = new Map<string, TraceSpan>();
  const activeSubflows = new Map<string, TraceSpan>();
  const toolKey = (nodeId: string, tool: string, callId?: string) =>
    `${nodeId}:${callId ? `call:${callId}` : `tool:${tool}`}`;

  const closeChildren = (nodeId: string, at: string, status: TraceSpan['status'], error?: string) => {
    for (const span of [...(activeLlm.get(nodeId) ?? []), ...[...activeTools.entries()].filter(([key]) => key.startsWith(`${nodeId}:`)).flatMap(([, value]) => value)]) {
      if (!span.endedAt) {
        span.endedAt = at;
        span.status = status;
        if (error) span.data = { ...(span.data ?? {}), error };
      }
    }
  };

  for (const event of events) {
    switch (event.type) {
      case 'node.started': {
        const span: TraceSpan = { id: nextId('node'), runId: run.id, parentId: runSpan.id, type: 'node', name: event.name, nodeId: event.nodeId, occurrence: occurrence('node', event.nodeId), startedAt: event.at, status: 'running', data: { nodeType: event.nodeType, ...(event.input ? { input: event.input as unknown as JsonObject[string] } : {}), ...(event.config ? { config: event.config as unknown as JsonObject[string] } : {}) } };
        spans.push(span);
        activeNodes.set(event.nodeId, span);
        break;
      }
      case 'node.completed': {
        const span = activeNodes.get(event.nodeId);
        if (span) { span.endedAt = event.at; span.status = 'ok'; span.data = { ...(span.data ?? {}), ...(event.output !== undefined ? { output: event.output } : {}) }; activeNodes.delete(event.nodeId); }
        closeChildren(event.nodeId, event.at, 'ok');
        break;
      }
      case 'node.failed': {
        const span = activeNodes.get(event.nodeId);
        if (span) { span.endedAt = event.at; span.status = 'error'; span.data = { ...(span.data ?? {}), error: event.error }; activeNodes.delete(event.nodeId); }
        closeChildren(event.nodeId, event.at, 'error', event.error);
        break;
      }
      case 'llm.started': {
        const span: TraceSpan = { id: nextId('llm'), runId: run.id, parentId: activeNodes.get(event.nodeId)?.id ?? runSpan.id, type: 'llm', name: event.model, nodeId: event.nodeId, occurrence: occurrence('llm', event.nodeId), startedAt: event.at, status: 'running', data: { model: event.model, ...(event.request ? { request: event.request as unknown as JsonObject[string] } : {}) } };
        spans.push(span);
        activeLlm.set(event.nodeId, [...(activeLlm.get(event.nodeId) ?? []), span]);
        break;
      }
      case 'llm.completed': {
        const span = [...(activeLlm.get(event.nodeId) ?? [])].reverse().find((candidate) => !candidate.endedAt);
        if (span) { span.endedAt = event.at; span.status = 'ok'; span.data = { ...(span.data ?? {}), ...(event.output !== undefined ? { output: event.output } : {}), ...(event.toolCalls?.length ? { toolCalls: event.toolCalls as unknown as JsonObject[string] } : {}), ...(event.finishReason ? { finishReason: event.finishReason } : {}), ...(event.usage ? { usage: event.usage as unknown as JsonObject[string] } : {}) }; }
        break;
      }
      case 'tool.started': {
        const key = toolKey(event.nodeId, event.tool, event.callId);
        const spanData: JsonObject = {
          ...(event.callId ? { callId: event.callId } : {}),
          ...(event.args ? { arguments: event.args as unknown as JsonObject[string] } : {}),
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.maxAttempts !== undefined ? { maxAttempts: event.maxAttempts } : {}),
        };
        const span: TraceSpan = { id: nextId('tool'), runId: run.id, parentId: activeNodes.get(event.nodeId)?.id ?? runSpan.id, type: 'tool', name: event.tool, nodeId: event.nodeId, occurrence: occurrence('tool', event.nodeId), startedAt: event.at, status: 'running', data: spanData };
        spans.push(span);
        activeTools.set(key, [...(activeTools.get(key) ?? []), span]);
        break;
      }
      case 'tool.retrying': {
        const key = toolKey(event.nodeId, event.tool, event.callId);
        const span = [...(activeTools.get(key) ?? [])].reverse().find((candidate) => !candidate.endedAt);
        if (span) {
          // A retry closes the attempt that just failed. The next
          // tool.started event creates a separate span for the retry.
          span.endedAt = event.at;
          span.status = 'error';
          span.data = {
            ...(span.data ?? {}),
            error: event.error,
            retry: {
              nextAttempt: event.attempt + 1,
              delayMs: event.delayMs,
            } as unknown as JsonObject[string],
          };
        }
        break;
      }
      case 'tool.completed': {
        const key = toolKey(event.nodeId, event.tool, event.callId);
        const span = [...(activeTools.get(key) ?? [])].reverse().find((candidate) => !candidate.endedAt);
        if (span) {
          span.endedAt = event.at;
          span.status = 'ok';
          span.data = {
            ...(span.data ?? {}),
            ...(event.result !== undefined ? { result: event.result } : {}),
            ...(event.attempts !== undefined ? { attempts: event.attempts } : {}),
          };
        }
        break;
      }
      case 'tool.failed': {
        const key = toolKey(event.nodeId, event.tool, event.callId);
        const span = [...(activeTools.get(key) ?? [])].reverse().find((candidate) => !candidate.endedAt);
        if (span) {
          span.endedAt = event.at;
          span.status = 'error';
          span.data = {
            ...(span.data ?? {}),
            error: event.error,
            ...(event.attempts !== undefined ? { attempts: event.attempts } : {}),
          };
        }
        break;
      }
      case 'guardrail.result': {
        spans.push({ id: nextId('guardrail'), runId: run.id, parentId: activeNodes.get(event.nodeId)?.id ?? runSpan.id, type: 'guardrail', name: 'Guardrail checks', nodeId: event.nodeId, occurrence: occurrence('guardrail', event.nodeId), startedAt: event.at, endedAt: event.at, status: 'ok', data: { passed: event.passed, results: event.results as unknown as JsonObject[string] } });
        break;
      }
      case 'state.updated': {
        spans.push({
          id: nextId('state'),
          runId: run.id,
          parentId: activeNodes.get(event.nodeId)?.id ?? runSpan.id,
          type: 'state',
          name: 'State updated',
          nodeId: event.nodeId,
          occurrence: occurrence('state', event.nodeId),
          startedAt: event.at,
          endedAt: event.at,
          status: 'ok',
          data: { state: event.state as unknown as JsonObject[string] },
        });
        break;
      }
      case 'approval.requested': {
        const span: TraceSpan = { id: nextId('approval'), runId: run.id, parentId: activeNodes.get(event.approval.nodeId)?.id ?? runSpan.id, type: 'approval', name: event.approval.message, nodeId: event.approval.nodeId, occurrence: occurrence('approval', event.approval.nodeId), startedAt: event.at, status: 'running', data: { kind: event.approval.kind, ...(event.approval.toolCall ? { toolCall: event.approval.toolCall as unknown as JsonObject[string] } : {}) } };
        spans.push(span);
        activeApprovals.set(event.approval.id, span);
        break;
      }
      case 'approval.resolved': {
        const span = activeApprovals.get(event.approvalId);
        if (span) { span.endedAt = event.at; span.status = event.approved ? 'ok' : 'cancelled'; span.data = { ...(span.data ?? {}), approved: event.approved, ...(event.reason ? { reason: event.reason } : {}), ...(event.resolvedBy ? { resolvedBy: event.resolvedBy as unknown as JsonObject[string] } : {}) }; activeApprovals.delete(event.approvalId); }
        break;
      }
      case 'approval.expired': {
        const span = activeApprovals.get(event.approvalId);
        if (span) { span.endedAt = event.at; span.status = 'error'; span.data = { ...(span.data ?? {}), error: 'Approval timed out', expired: true }; activeApprovals.delete(event.approvalId); }
        break;
      }
      case 'subflow.started': {
        const span: TraceSpan = {
          id: nextId('subflow'), runId: run.id, parentId: activeNodes.get(event.nodeId)?.id ?? runSpan.id,
          type: 'subflow', name: `Subflow ${event.workflowId}@${event.workflowVersion}`, nodeId: event.nodeId,
          occurrence: occurrence('subflow', event.nodeId), startedAt: event.at, status: 'running',
          data: { childRunId: event.childRunId, workflowId: event.workflowId, workflowVersion: event.workflowVersion },
        };
        spans.push(span);
        activeSubflows.set(event.childRunId, span);
        break;
      }
      case 'subflow.completed': {
        const span = activeSubflows.get(event.childRunId);
        if (span) {
          span.endedAt = event.at;
          span.status = event.status === 'completed' ? 'ok' : event.status === 'cancelled' ? 'cancelled' : 'error';
          span.data = { ...(span.data ?? {}), childStatus: event.status, ...(event.output !== undefined ? { output: event.output } : {}) };
          activeSubflows.delete(event.childRunId);
        }
        break;
      }
      case 'subflow.paused': {
        const span = activeSubflows.get(event.childRunId);
        if (span) span.data = { ...(span.data ?? {}), paused: true, leafRunId: event.leafRunId, childStatus: event.status, ...(event.approvalId ? { approvalId: event.approvalId } : {}) };
        break;
      }
      case 'subflow.resumed': {
        const span = activeSubflows.get(event.childRunId);
        if (span) span.data = { ...(span.data ?? {}), paused: false, leafRunId: event.leafRunId };
        break;
      }
    }
  }

  if (run.endedAt) {
    for (const span of spans) {
      if (span.status === 'running') {
        span.endedAt = run.endedAt;
        span.status = spanStatus(run.status);
        // Recovery can terminate a process while a node, model call, or tool
        // is still in flight. Preserve the run-level reason on each forced
        // closure so post-restart traces are actionable rather than merely
        // showing an unexplained error status.
        if (span.status === 'error' && run.error) {
          span.data = { ...(span.data ?? {}), error: span.data?.error ?? run.error };
        }
      }
    }
  }
  return spans;
}

export function buildTraceSpanIndex(spans: TraceSpan[]) {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const byNode = new Map<string, TraceSpan[]>();
  for (const span of spans) {
    if (!span.nodeId) continue;
    const group = byNode.get(span.nodeId) ?? [];
    group.push(span);
    byNode.set(span.nodeId, group);
  }
  return {
    byId,
    byNode,
    nodeOccurrence(nodeId: string, occurrenceNumber: number, type: TraceSpan['type'] = 'node') {
      return (byNode.get(nodeId) ?? []).find((span) => span.type === type && span.occurrence === occurrenceNumber);
    },
  };
}
