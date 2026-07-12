/**
 * useAgentBuilderBackend — connects the AgentBuilder canvas to the
 * Agent Builder backend (Back End/agent-builder).
 *
 * Responsibilities:
 *  - health check + backend status
 *  - ensure a workflow exists (create new, or load one requested from the
 *    sidebar), mapping the backend's canonical graph <-> React Flow nodes/edges
 *  - debounced autosave of the canvas as the draft
 *  - preview runs with live SSE streaming into the run store
 *  - publish + code export, approvals resolution
 *
 * The canvas passes its nodes/edges + setters; the Staging chrome drives
 * actions through the shared nanostores (previewTrigger/codeTrigger/...).
 */

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import type { Edge, Node } from '@xyflow/react';
import { useUserDataContext } from '../context/UserDataContext';
import { getAgentBuilderClient, isAgentBuilderBackendUp, type RunEvent } from '../lib/agentBuilder';
import {
  backendStatus,
  codeModal,
  codeTrigger,
  currentWorkflow,
  previewTrigger,
  publishTrigger,
  requestedWorkflowId,
  resetRunState,
  runPanelOpen,
  runState,
  saveStatus,
  workflowList,
} from '../lib/stores/agent-builder-store';

const EDGE_STYLE = { stroke: '#404040', strokeWidth: 2.5 };

/** Sentinel for requestedWorkflowId meaning "create a brand new workflow". */
export const NEW_WORKFLOW = '__new__';

/** The canvas' default starter graph (Start -> Agent), in React Flow shape. */
function defaultStarterGraph(): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: [
      { id: '1', type: 'start', position: { x: 50, y: 125 }, data: { label: 'Start' } } as Node,
      { id: '2', type: 'agent', position: { x: 300, y: 125 }, data: { label: 'Agent' } } as Node,
    ],
    edges: [{ id: 'e1-2', source: '1', target: '2', type: 'custom', style: EDGE_STYLE } as Edge],
  };
}

// ---------------------------------------------------------------------------
// canonical graph  <->  React Flow graph
// ---------------------------------------------------------------------------

interface CanonicalNode {
  id: string;
  type: string;
  name: string;
  position?: { x: number; y: number };
  config: Record<string, unknown>;
}
interface CanonicalGraph {
  nodes: CanonicalNode[];
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
}

/** Map a backend canonical graph into React Flow nodes/edges for the canvas. */
function canonicalToReactFlow(graph: CanonicalGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n, i) => {
    const config = (n.config ?? {}) as Record<string, unknown>;
    let data: Record<string, unknown>;
    if (n.type === 'agent') {
      // agent panel reads flat data fields
      data = { label: n.name, ...config };
    } else if (n.type === 'guardrail') {
      data = { label: n.name, config };
    } else {
      // start + all logic/data/tool nodes keep the full config under data.config
      data = { label: n.name, config };
    }
    return {
      id: n.id,
      type: n.type,
      position: n.position ?? { x: 80 + i * 240, y: 120 },
      data,
    } as Node;
  });

  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    type: 'custom',
    style: EDGE_STYLE,
  }));

  return { nodes, edges };
}

/** Strip transient React Flow fields; the backend normalizer does the rest. */
function reactFlowToGraphPayload(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes
      .filter((n) => n.type !== 'placeholder')
      .map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data ?? {},
      })),
    edges: edges
      .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
        ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
      })),
  };
}

function graphSignature(nodes: Node[], edges: Edge[]): string {
  return JSON.stringify(reactFlowToGraphPayload(nodes, edges));
}

// ---------------------------------------------------------------------------

export interface AgentBuilderBackend {
  ready: boolean;
  run: (inputText: string) => Promise<void>;
  publish: () => Promise<void>;
  exportCode: (format: 'typescript' | 'python') => Promise<void>;
  resolveApproval: (approvalId: string, approved: boolean) => Promise<void>;
  cancelRun: () => Promise<void>;
  refreshWorkflows: () => Promise<void>;
}

export function useAgentBuilderBackend(
  nodes: Node[],
  edges: Edge[],
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>,
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
): AgentBuilderBackend {
  const { apiKeys } = useUserDataContext();
  const wf = useStore(currentWorkflow);
  const requested = useStore(requestedWorkflowId);
  const previewN = useStore(previewTrigger);
  const codeN = useStore(codeTrigger);
  const publishN = useStore(publishTrigger);

  const clientRef = useRef(getAgentBuilderClient(apiKeys));
  // keep keys fresh for the singleton client
  useEffect(() => {
    clientRef.current = getAgentBuilderClient(apiKeys);
  }, [apiKeys]);

  const lastSavedSig = useRef<string>('');
  const readyRef = useRef(false);
  const streamStopRef = useRef<null | (() => void)>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const refreshWorkflows = useCallback(async () => {
    try {
      const { workflows } = await clientRef.current.listWorkflows();
      workflowList.set(workflows.map((w) => ({
        id: w.id, name: w.name, nodeCount: w.nodeCount, latestVersion: w.latestVersion, updatedAt: w.updatedAt,
      })));
    } catch { /* backend down — handled by status */ }
  }, []);

  const applyValidation = useCallback((v: { valid: boolean; errors: { message: string }[]; warnings: { message: string }[] }, id: string, name: string, latestVersion: number) => {
    currentWorkflow.set({
      id, name, latestVersion,
      valid: v?.valid ?? true,
      errors: (v?.errors ?? []).map((e) => e.message),
      warnings: (v?.warnings ?? []).map((w) => w.message),
    });
  }, []);

  // ---- init: health + ensure/load a workflow ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      backendStatus.set('checking');
      const up = await isAgentBuilderBackendUp();
      if (cancelled) return;
      backendStatus.set(up ? 'up' : 'down');
      if (!up) return;

      const client = clientRef.current;
      try {
        // Explicit "new workflow" request: reset the canvas and create one.
        if (requested === NEW_WORKFLOW) {
          const starter = defaultStarterGraph();
          readyRef.current = false;
          setNodes(starter.nodes);
          setEdges(starter.edges);
          const { workflow, validation } = await client.createWorkflow({
            name: 'Untitled workflow',
            graph: reactFlowToGraphPayload(starter.nodes, starter.edges),
          });
          if (cancelled) return;
          lastSavedSig.current = graphSignature(starter.nodes, starter.edges);
          applyValidation(validation, workflow.id, workflow.name, workflow.latestVersion);
          requestedWorkflowId.set(null);
          readyRef.current = true;
          await refreshWorkflows();
          return;
        }

        // Load the requested workflow, or the one already open (remount), or
        // create a fresh one seeded with the current canvas.
        const targetId = requested || currentWorkflow.get()?.id || null;
        if (targetId) {
          const { workflow } = await client.getWorkflow(targetId);
          if (cancelled) return;
          const rf = canonicalToReactFlow(workflow.draft as unknown as CanonicalGraph);
          readyRef.current = false;
          setNodes(rf.nodes);
          setEdges(rf.edges);
          lastSavedSig.current = graphSignature(rf.nodes, rf.edges);
          const val = await client.validateGraph(workflow.id);
          applyValidation(val.validation, workflow.id, workflow.name, workflow.latestVersion);
          if (requested) requestedWorkflowId.set(null);
          readyRef.current = true;
        } else {
          // fresh session: create a workflow seeded with the current canvas
          const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
          const { workflow, validation } = await client.createWorkflow({
            name: 'Untitled workflow',
            graph: payload,
          });
          if (cancelled) return;
          lastSavedSig.current = graphSignature(nodesRef.current, edgesRef.current);
          applyValidation(validation, workflow.id, workflow.name, workflow.latestVersion);
          readyRef.current = true;
        }
        await refreshWorkflows();
      } catch {
        backendStatus.set('down');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  // ---- debounced autosave ----
  useEffect(() => {
    if (!readyRef.current) return;
    const w = currentWorkflow.get();
    if (!w) return;
    const sig = graphSignature(nodes, edges);
    if (sig === lastSavedSig.current) return;

    saveStatus.set('saving');
    const handle = setTimeout(async () => {
      try {
        const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
        const { workflow, validation } = await clientRef.current.saveDraft(w.id, payload);
        lastSavedSig.current = graphSignature(nodesRef.current, edgesRef.current);
        applyValidation(validation, workflow.id, workflow.name, workflow.latestVersion);
        saveStatus.set('saved');
        setTimeout(() => saveStatus.get() === 'saved' && saveStatus.set('idle'), 1500);
      } catch {
        saveStatus.set('error');
      }
    }, 700);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // ---- run with SSE streaming ----
  const run = useCallback(async (inputText: string) => {
    const w = currentWorkflow.get();
    if (!w) return;
    streamStopRef.current?.();
    resetRunState();
    runPanelOpen.set(true);
    runState.setKey('status', 'queued');

    // flush any pending draft edits first so the run sees the latest graph
    try {
      const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
      await clientRef.current.saveDraft(w.id, payload);
      lastSavedSig.current = graphSignature(nodesRef.current, edgesRef.current);
    } catch { /* proceed with last saved */ }

    let runId: string;
    try {
      const { run: r } = await clientRef.current.startRun(w.id, { input_as_text: inputText }, 0);
      runId = r.id;
      runState.setKey('runId', runId);
    } catch (e) {
      runState.setKey('status', 'failed');
      runState.setKey('error', (e as Error).message);
      return;
    }

    const nameOf = (nodeId: string) =>
      (nodesRef.current.find((n) => n.id === nodeId)?.data?.label as string) || nodeId;

    streamStopRef.current = clientRef.current.streamRunEvents(runId, (ev: RunEvent) => {
      const st = runState.get();
      switch (ev.type) {
        case 'run.started':
          runState.setKey('status', 'running');
          break;
        case 'node.started': {
          const nodeId = ev.nodeId as string;
          runState.setKey('nodeStatuses', [
            ...st.nodeStatuses.filter((n) => n.nodeId !== nodeId),
            { nodeId, name: nameOf(nodeId), status: 'running' as const },
          ]);
          break;
        }
        case 'llm.delta': {
          const nodeId = ev.nodeId as string;
          const cur = st.streamingByNode[nodeId] ?? '';
          runState.setKey('streamingByNode', { ...st.streamingByNode, [nodeId]: cur + (ev.delta as string) });
          break;
        }
        case 'node.completed': {
          const nodeId = ev.nodeId as string;
          runState.setKey('nodeStatuses', st.nodeStatuses.map((n) =>
            n.nodeId === nodeId ? { ...n, status: 'ok' as const } : n));
          break;
        }
        case 'node.failed': {
          const nodeId = ev.nodeId as string;
          runState.setKey('nodeStatuses', st.nodeStatuses.map((n) =>
            n.nodeId === nodeId ? { ...n, status: 'error' as const, detail: ev.error as string } : n));
          break;
        }
        case 'guardrail.result': {
          const nodeId = ev.nodeId as string;
          runState.setKey('nodeStatuses', st.nodeStatuses.map((n) =>
            n.nodeId === nodeId ? { ...n, detail: (ev.passed ? 'passed' : 'blocked') } : n));
          break;
        }
        case 'approval.requested':
          runState.setKey('status', 'awaiting_approval');
          runState.setKey('pendingApproval', ev.approval as never);
          break;
        case 'approval.resolved':
          runState.setKey('pendingApproval', null);
          break;
        case 'run.completed':
          runState.setKey('status', 'completed');
          runState.setKey('output', ev.output ?? null);
          break;
        case 'run.failed':
          runState.setKey('status', 'failed');
          runState.setKey('error', (ev.error as string) ?? 'run failed');
          break;
        case 'run.cancelled':
          runState.setKey('status', 'cancelled');
          break;
      }
    }, {
      onError: () => {
        if (runState.get().status === 'running' || runState.get().status === 'queued') {
          runState.setKey('error', 'lost connection to run stream');
        }
      },
    });
  }, []);

  const resolveApproval = useCallback(async (approvalId: string, approved: boolean) => {
    const runId = runState.get().runId;
    if (!runId) return;
    try {
      await clientRef.current.resolveApproval(runId, approvalId, approved);
      runState.setKey('pendingApproval', null);
      runState.setKey('status', 'running');
    } catch (e) {
      runState.setKey('error', (e as Error).message);
    }
  }, []);

  const cancelRun = useCallback(async () => {
    const runId = runState.get().runId;
    if (!runId) return;
    try {
      await clientRef.current.cancelRun(runId);
    } catch { /* ignore */ }
  }, []);

  const publish = useCallback(async () => {
    const w = currentWorkflow.get();
    if (!w) return;
    try {
      const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
      await clientRef.current.saveDraft(w.id, payload);
      const res = await clientRef.current.publishWorkflow(w.id);
      currentWorkflow.set({ ...w, latestVersion: res.version.version, valid: true, errors: [] });
      await refreshWorkflows();
    } catch (e) {
      currentWorkflow.set({ ...w, valid: false, errors: [(e as Error).message] });
    }
  }, [refreshWorkflows]);

  const exportCode = useCallback(async (format: 'typescript' | 'python') => {
    const w = currentWorkflow.get();
    if (!w) return;
    codeModal.set({ open: true, loading: true, format, code: '', error: null });
    try {
      const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
      await clientRef.current.saveDraft(w.id, payload);
      const { code } = await clientRef.current.exportCode(w.id, format);
      codeModal.set({ open: true, loading: false, format, code, error: null });
    } catch (e) {
      codeModal.set({ open: true, loading: false, format, code: '', error: (e as Error).message });
    }
  }, []);

  // ---- action triggers from the top bar ----
  const firstPreview = useRef(previewN);
  const firstCode = useRef(codeN);
  const firstPublish = useRef(publishN);
  useEffect(() => {
    if (previewN !== firstPreview.current) void run('Preview run');
    firstPreview.current = previewN;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewN]);
  useEffect(() => {
    if (codeN !== firstCode.current) void exportCode('typescript');
    firstCode.current = codeN;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeN]);
  useEffect(() => {
    if (publishN !== firstPublish.current) void publish();
    firstPublish.current = publishN;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishN]);

  // cleanup stream on unmount
  useEffect(() => () => streamStopRef.current?.(), []);

  return {
    ready: !!wf,
    run,
    publish,
    exportCode,
    resolveApproval,
    cancelRun,
    refreshWorkflows,
  };
}
