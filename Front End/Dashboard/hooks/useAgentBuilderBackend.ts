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
import {
  getAgentBuilderClient,
  isAgentBuilderBackendUp,
  type JsonObject,
  type RunInput,
  type RunEvent,
  type Run,
  type SdkCodeBundle,
  type AgentBuilderApiError,
} from '../lib/agentBuilder';
import {
  agentBuilderDraftFlush,
  autosaveConflict,
  debugBreakpoints,
  backendStatus,
  codeModal,
  codeTrigger,
  currentWorkflow,
  previewTrigger,
  publishTrigger,
  remoteDraftReloadEpoch,
  requestedWorkflowId,
  resetRunState,
  runHistoryPanelOpen,
  runPanelOpen,
  runState,
  saveStatus,
  workflowList,
} from '../lib/stores/agent-builder-store';

const EDGE_STYLE = { stroke: '#404040', strokeWidth: 2.5 };

/** Keep the inspector anchored when a remote refresh still contains the selected nodes. */
function preserveExistingNodeSelection(nextNodes: Node[], currentNodes: Node[]): Node[] {
  const selectedIds = new Set(currentNodes.filter((node) => node.selected).map((node) => node.id));
  if (selectedIds.size === 0) return nextNodes;
  return nextNodes.map((node) => selectedIds.has(node.id) ? { ...node, selected: true } : node);
}

/** Sentinel for requestedWorkflowId meaning "create a brand new workflow". */
export const NEW_WORKFLOW = '__new__';

/** The canvas' default starter graph (Start -> Agent -> End). */
function defaultStarterGraph(): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: [
      { id: '1', type: 'start', position: { x: 50, y: 125 }, data: { label: 'Start' } } as Node,
      {
        id: '2',
        type: 'agent',
        position: { x: 300, y: 125 },
        data: {
          label: 'Agent',
          instructions: 'Answer the user clearly and concisely.',
          model: 'mock/echo',
          outputFormat: 'text',
          includeChatHistory: false,
          writeToConversationHistory: false,
          continueOnError: false,
          tools: [],
        },
      } as Node,
      {
        id: '3',
        type: 'end',
        position: { x: 550, y: 125 },
        data: { label: 'End', config: {} },
      } as Node,
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2', type: 'custom', style: EDGE_STYLE } as Edge,
      { id: 'e2-3', source: '2', target: '3', type: 'custom', style: EDGE_STYLE } as Edge,
    ],
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
  run: (inputText: string, variables?: JsonObject, stateVariables?: JsonObject, attachments?: NonNullable<RunInput['attachments']>) => Promise<void>;
  replayRun: (runId: string) => Promise<void>;
  updateMetadata: (name: string, description: string) => Promise<void>;
  publish: (notes?: string) => Promise<void>;
  exportCode: (format: 'typescript' | 'python' | 'typescript-sdk' | 'python-sdk') => Promise<void>;
  exportWorkflowJson: () => Promise<void>;
  importWorkflowJson: (text: string) => Promise<void>;
  resolveApproval: (approvalId: string, approved: boolean, reason?: string) => Promise<void>;
  submitClientToolResult: (approvalId: string, result: import('../lib/agentBuilder').JsonValue) => Promise<void>;
  resumeRun: (runId?: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  continueDebug: () => Promise<void>;
  stepDebug: () => Promise<void>;
  refreshWorkflows: () => Promise<void>;
  flushDraft: () => Promise<boolean>;
  reloadRemoteDraft: () => Promise<void>;
  overwriteRemoteDraft: () => Promise<void>;
  duplicateLocalDraft: () => Promise<void>;
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
  const draftConflict = useStore(autosaveConflict);
  const backendState = useStore(backendStatus);

  const clientRef = useRef(getAgentBuilderClient(apiKeys));
  // keep keys fresh for the singleton client
  useEffect(() => {
    clientRef.current = getAgentBuilderClient(apiKeys);
  }, [apiKeys]);

  const lastSavedSig = useRef<string>('');
  const draftRevisionRef = useRef(0);
  const autosavePausedRef = useRef(false);
  const draftSaveInFlightRef = useRef(0);
  const draftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);
  const remotePollSequenceRef = useRef(0);
  const streamStopRef = useRef<null | (() => void)>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  useEffect(() => {
    if (draftConflict) autosavePausedRef.current = true;
  }, [draftConflict]);

  const refreshWorkflows = useCallback(async () => {
    try {
      const { workflows } = await clientRef.current.listWorkflows();
      workflowList.set(workflows.map((w) => ({
        id: w.id, name: w.name, nodeCount: w.nodeCount, latestVersion: w.latestVersion, updatedAt: w.updatedAt,
      })));
    } catch { /* backend down — handled by status */ }
  }, []);

  const applyValidation = useCallback((v: { valid: boolean; errors: import('@agentbuilder').ValidationIssue[]; warnings: import('@agentbuilder').ValidationIssue[]; contracts?: import('@agentbuilder').NodeDataContract[]; safetyFindings?: import('@agentbuilder').SafetyFinding[] }, id: string, name: string, latestVersion: number, description = '', draftRevision = draftRevisionRef.current) => {
    currentWorkflow.set({
      id, name, description, latestVersion, draftRevision,
      valid: v?.valid ?? true,
      errors: (v?.errors ?? []).map((e) => e.message),
      warnings: (v?.warnings ?? []).map((w) => w.message),
      errorIssues: v?.errors ?? [],
      warningIssues: v?.warnings ?? [],
      safetyFindings: v?.safetyFindings ?? [],
      contracts: v?.contracts ?? [],
    });
  }, []);

  const pauseForRevisionConflict = useCallback(async (workflowId: string, expectedRevision: number, error: Error) => {
    autosavePausedRef.current = true;
    let currentRevision = expectedRevision;
    try {
      const { workflow } = await clientRef.current.getWorkflow(workflowId);
      currentRevision = workflow.draftRevision;
    } catch { /* retain the expected revision when the remote cannot be reloaded */ }
    autosaveConflict.set({
      workflowId,
      expectedRevision,
      currentRevision,
      message: error.message,
    });
    saveStatus.set('conflict');
  }, []);

  const isRevisionConflict = useCallback(
    (error: unknown): error is AgentBuilderApiError => (
      typeof error === 'object' && error !== null &&
      (error as AgentBuilderApiError).status === 409 &&
      (error as AgentBuilderApiError).code === 'draft_revision_conflict'
    ),
    [],
  );

  const saveDraftWithTracking = useCallback(async (
    workflowId: string,
    payload: ReturnType<typeof reactFlowToGraphPayload>,
    expectedRevision: number,
  ) => {
    draftSaveInFlightRef.current += 1;
    try {
      return await clientRef.current.saveDraft(workflowId, payload, expectedRevision);
    } finally {
      draftSaveInFlightRef.current = Math.max(0, draftSaveInFlightRef.current - 1);
    }
  }, []);

  const withDraftWriteLock = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = draftWriteQueueRef.current.then(operation, operation);
    draftWriteQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const saveCurrentDraftUnlocked = useCallback(async (): Promise<boolean> => {
    if (!readyRef.current) return true;
    if (autosavePausedRef.current) return false;

    while (true) {
      const workflow = currentWorkflow.get();
      if (!workflow) return true;

      const signature = graphSignature(nodesRef.current, edgesRef.current);
      if (signature === lastSavedSig.current) return true;

      saveStatus.set('saving');
      const expectedRevision = draftRevisionRef.current;
      const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
      try {
        const { workflow: savedWorkflow, validation } = await saveDraftWithTracking(
          workflow.id,
          payload,
          expectedRevision,
        );
        draftRevisionRef.current = savedWorkflow.draftRevision;
        lastSavedSig.current = signature;
        applyValidation(
          validation,
          savedWorkflow.id,
          savedWorkflow.name,
          savedWorkflow.latestVersion,
          savedWorkflow.description ?? workflow.description,
          savedWorkflow.draftRevision,
        );

        if (graphSignature(nodesRef.current, edgesRef.current) === lastSavedSig.current) {
          saveStatus.set('saved');
          setTimeout(() => saveStatus.get() === 'saved' && saveStatus.set('idle'), 1500);
          return true;
        }
      } catch (error) {
        if (isRevisionConflict(error)) {
          await pauseForRevisionConflict(workflow.id, expectedRevision, error);
        } else {
          saveStatus.set('error');
        }
        return false;
      }
    }
  }, [applyValidation, isRevisionConflict, pauseForRevisionConflict, saveDraftWithTracking]);

  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    return withDraftWriteLock(saveCurrentDraftUnlocked);
  }, [saveCurrentDraftUnlocked, withDraftWriteLock]);

  useEffect(() => {
    agentBuilderDraftFlush.set(flushDraft);
    return () => {
      if (agentBuilderDraftFlush.get() === flushDraft) agentBuilderDraftFlush.set(null);
    };
  }, [flushDraft]);

  // ---- init: health + ensure/load a workflow ----
  useEffect(() => {
    // Clearing a consumed request should not reload the workflow we just opened.
    if (requested === null && readyRef.current && currentWorkflow.get()) return;

    let cancelled = false;
    const clearRequestedWorkflow = () => {
      if (requested !== null && requestedWorkflowId.get() === requested) {
        requestedWorkflowId.set(null);
      }
    };

    // A workflow switch invalidates the active preview: keep the old stream
    // from publishing node events into the newly loaded graph.
    streamStopRef.current?.();
    streamStopRef.current = null;
    resetRunState();
    runPanelOpen.set(false);
    (async () => {
      backendStatus.set('checking');
      const up = await isAgentBuilderBackendUp();
      if (cancelled) return;
      backendStatus.set(up ? 'up' : 'down');
      if (!up) return;

      const client = clientRef.current;
      try {
        const switched = await withDraftWriteLock(async () => {
          if (cancelled) return false;

          // Explicit "new workflow" request: save the old canvas, create the
          // starter, then drain edits made while creation was in flight.
          if (requested === NEW_WORKFLOW) {
            if (readyRef.current && currentWorkflow.get() && !(await saveCurrentDraftUnlocked())) return false;
            if (cancelled) return false;

            const starter = defaultStarterGraph();
            const { workflow, validation } = await client.createWorkflow({
              name: 'Untitled workflow',
              graph: reactFlowToGraphPayload(starter.nodes, starter.edges),
            });
            const discardUnopenedWorkflow = async () => {
              try { await client.deleteWorkflow(workflow.id); } catch { /* best-effort cleanup */ }
            };
            if (cancelled) {
              await discardUnopenedWorkflow();
              return false;
            }
            if (readyRef.current && currentWorkflow.get() && !(await saveCurrentDraftUnlocked())) {
              await discardUnopenedWorkflow();
              return false;
            }
            if (cancelled) {
              await discardUnopenedWorkflow();
              return false;
            }

            readyRef.current = false;
            setNodes(starter.nodes);
            setEdges(starter.edges);
            draftRevisionRef.current = workflow.draftRevision;
            autosavePausedRef.current = false;
            autosaveConflict.set(null);
            lastSavedSig.current = graphSignature(starter.nodes, starter.edges);
            applyValidation(validation, workflow.id, workflow.name, workflow.latestVersion, workflow.description ?? '', workflow.draftRevision);
            readyRef.current = true;
            clearRequestedWorkflow();
            return true;
          }

          // Load the requested workflow, or the one already open on remount.
          // If the old canvas changes during either request, save it and fetch
          // the target again before replacing the shared revision state.
          const targetId = requested || currentWorkflow.get()?.id || null;
          if (targetId) {
            while (true) {
              if (readyRef.current && currentWorkflow.get() && !(await saveCurrentDraftUnlocked())) return false;
              if (cancelled) return false;

              const { workflow } = await client.getWorkflow(targetId);
              if (cancelled) return false;
              const rf = canonicalToReactFlow(workflow.draft as unknown as CanonicalGraph);
              const val = await client.validateGraph(workflow.id);
              if (cancelled) return false;

              if (
                readyRef.current &&
                currentWorkflow.get() &&
                graphSignature(nodesRef.current, edgesRef.current) !== lastSavedSig.current
              ) continue;

              readyRef.current = false;
              setNodes(rf.nodes);
              setEdges(rf.edges);
              draftRevisionRef.current = workflow.draftRevision;
              autosavePausedRef.current = false;
              autosaveConflict.set(null);
              lastSavedSig.current = graphSignature(rf.nodes, rf.edges);
              applyValidation(val.validation, workflow.id, workflow.name, workflow.latestVersion, workflow.description ?? '', workflow.draftRevision);
              readyRef.current = true;
              clearRequestedWorkflow();
              return true;
            }
          }

          // Fresh session: create from the current canvas, then persist any
          // edits made while the creation request was pending.
          const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
          const initialSignature = graphSignature(nodesRef.current, edgesRef.current);
          const { workflow, validation } = await client.createWorkflow({
            name: 'Untitled workflow',
            graph: payload,
          });
          if (cancelled) {
            try { await client.deleteWorkflow(workflow.id); } catch { /* best-effort cleanup */ }
            return false;
          }

          draftRevisionRef.current = workflow.draftRevision;
          autosavePausedRef.current = false;
          autosaveConflict.set(null);
          lastSavedSig.current = initialSignature;
          applyValidation(validation, workflow.id, workflow.name, workflow.latestVersion, workflow.description ?? '', workflow.draftRevision);
          readyRef.current = true;
          return saveCurrentDraftUnlocked();
        });
        if (!switched) {
          if (!cancelled) clearRequestedWorkflow();
          return;
        }
        await refreshWorkflows();
      } catch {
        if (!cancelled) backendStatus.set('down');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  // ---- debounced autosave ----
  useEffect(() => {
    if (!readyRef.current || autosavePausedRef.current) return;
    const w = currentWorkflow.get();
    if (!w) return;
    const sig = graphSignature(nodes, edges);
    if (sig === lastSavedSig.current) return;

    saveStatus.set('saving');
    const handle = setTimeout(() => {
      if (autosaveTimerRef.current === handle) autosaveTimerRef.current = null;
      void flushDraft();
    }, 700);
    autosaveTimerRef.current = handle;
    return () => {
      clearTimeout(handle);
      if (autosaveTimerRef.current === handle) autosaveTimerRef.current = null;
    };
  }, [edges, flushDraft, nodes]);

  // ---- remote draft collaboration polling ----
  useEffect(() => {
    if (backendState !== 'up' || !wf?.id) return;

    const workflowId = wf.id;
    let cancelled = false;
    let requestInFlight = false;

    const pollRemoteDraft = async () => {
      if (
        cancelled ||
        requestInFlight ||
        !readyRef.current ||
        document.visibilityState === 'hidden' ||
        requestedWorkflowId.get() !== null ||
        currentWorkflow.get()?.id !== workflowId
      ) return;

      requestInFlight = true;
      const sequence = ++remotePollSequenceRef.current;
      try {
        const { workflow: remote } = await clientRef.current.getWorkflow(workflowId);
        if (
          cancelled ||
          sequence !== remotePollSequenceRef.current ||
          requestedWorkflowId.get() !== null ||
          currentWorkflow.get()?.id !== workflowId ||
          remote.draftRevision <= draftRevisionRef.current
        ) return;

        const localClean = graphSignature(nodesRef.current, edgesRef.current) === lastSavedSig.current;
        if (!localClean || draftSaveInFlightRef.current > 0 || autosaveConflict.get() !== null) {
          autosavePausedRef.current = true;
          autosaveConflict.set({
            workflowId,
            expectedRevision: draftRevisionRef.current,
            currentRevision: remote.draftRevision,
            message: 'Remote draft changed while you had unsaved local edits.',
          });
          saveStatus.set('conflict');
          return;
        }

        const rf = canonicalToReactFlow(remote.draft as unknown as CanonicalGraph);
        const refreshedNodes = preserveExistingNodeSelection(rf.nodes, nodesRef.current);
        readyRef.current = false;
        setNodes(refreshedNodes);
        setEdges(rf.edges);
        draftRevisionRef.current = remote.draftRevision;
        lastSavedSig.current = graphSignature(refreshedNodes, rf.edges);
        autosavePausedRef.current = false;
        autosaveConflict.set(null);
        remoteDraftReloadEpoch.set(remoteDraftReloadEpoch.get() + 1);
        saveStatus.set('saved');
        readyRef.current = true;
        const activeWorkflow = currentWorkflow.get();
        if (activeWorkflow?.id === workflowId) {
          currentWorkflow.set({
            ...activeWorkflow,
            name: remote.name,
            description: remote.description ?? '',
            latestVersion: remote.latestVersion,
            draftRevision: remote.draftRevision,
          });
        }
        setTimeout(() => saveStatus.get() === 'saved' && saveStatus.set('idle'), 1500);

        try {
          const { validation } = await clientRef.current.validateGraph(workflowId);
          if (
            !cancelled &&
            sequence === remotePollSequenceRef.current &&
            currentWorkflow.get()?.id === workflowId &&
            draftRevisionRef.current === remote.draftRevision
          ) {
            applyValidation(
              validation,
              remote.id,
              remote.name,
              remote.latestVersion,
              remote.description ?? '',
              remote.draftRevision,
            );
          }
        } catch { /* the remote graph remains usable if validation refresh fails */ }
      } catch { /* a transient polling failure must not mark the backend unavailable */ }
      finally {
        requestInFlight = false;
      }
    };

    const interval = window.setInterval(() => void pollRemoteDraft(), 8000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void pollRemoteDraft();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void pollRemoteDraft();

    return () => {
      cancelled = true;
      remotePollSequenceRef.current += 1;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [applyValidation, backendState, setEdges, setNodes, wf?.id]);

  const reloadRemoteDraft = useCallback(async () => {
    await withDraftWriteLock(async () => {
      const conflict = autosaveConflict.get();
      const activeWorkflow = currentWorkflow.get();
      if (
        !conflict ||
        activeWorkflow?.id !== conflict.workflowId ||
        requestedWorkflowId.get() !== null
      ) return;

      const { workflow } = await clientRef.current.getWorkflow(conflict.workflowId);
      const rf = canonicalToReactFlow(workflow.draft as unknown as CanonicalGraph);
      const refreshedNodes = preserveExistingNodeSelection(rf.nodes, nodesRef.current);
      // Resolve all fallible remote work before replacing the local canvas. A
      // transient validation failure must leave the preserved local draft intact.
      const { validation } = await clientRef.current.validateGraph(workflow.id);
      if (
        currentWorkflow.get()?.id !== conflict.workflowId ||
        autosaveConflict.get()?.workflowId !== conflict.workflowId ||
        requestedWorkflowId.get() !== null
      ) return;

      readyRef.current = false;
      setNodes(refreshedNodes);
      setEdges(rf.edges);
      lastSavedSig.current = graphSignature(refreshedNodes, rf.edges);
      draftRevisionRef.current = workflow.draftRevision;
      applyValidation(validation, workflow.id, workflow.name, workflow.latestVersion, workflow.description ?? '', workflow.draftRevision);
      autosavePausedRef.current = false;
      autosaveConflict.set(null);
      remoteDraftReloadEpoch.set(remoteDraftReloadEpoch.get() + 1);
      saveStatus.set('saved');
      readyRef.current = true;
      setTimeout(() => saveStatus.get() === 'saved' && saveStatus.set('idle'), 1500);
    });
  }, [applyValidation, setEdges, setNodes, withDraftWriteLock]);

  const overwriteRemoteDraft = useCallback(async () => {
    await withDraftWriteLock(async () => {
      const conflict = autosaveConflict.get();
      const w = currentWorkflow.get();
      if (!conflict || !w || conflict.workflowId !== w.id || requestedWorkflowId.get() !== null) return;
      const { workflow: remote } = await clientRef.current.getWorkflow(conflict.workflowId);
      if (
        currentWorkflow.get()?.id !== w.id ||
        autosaveConflict.get()?.workflowId !== w.id ||
        requestedWorkflowId.get() !== null
      ) return;
      const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
      const signature = graphSignature(nodesRef.current, edgesRef.current);
      try {
        const { workflow, validation } = await saveDraftWithTracking(w.id, payload, remote.draftRevision);
        draftRevisionRef.current = workflow.draftRevision;
        lastSavedSig.current = signature;
        applyValidation(validation, workflow.id, workflow.name, workflow.latestVersion, workflow.description ?? w.description, workflow.draftRevision);
        autosavePausedRef.current = false;
        autosaveConflict.set(null);
        if (!(await saveCurrentDraftUnlocked())) return;
        saveStatus.set('saved');
        setTimeout(() => saveStatus.get() === 'saved' && saveStatus.set('idle'), 1500);
      } catch (error) {
        if (isRevisionConflict(error)) await pauseForRevisionConflict(w.id, remote.draftRevision, error);
        else throw error;
      }
    });
  }, [applyValidation, isRevisionConflict, pauseForRevisionConflict, saveCurrentDraftUnlocked, saveDraftWithTracking, withDraftWriteLock]);

  const duplicateLocalDraft = useCallback(async () => {
    const w = currentWorkflow.get();
    if (!w) return;
    let duplicated = false;
    await withDraftWriteLock(async () => {
      if (currentWorkflow.get()?.id !== w.id || requestedWorkflowId.get() !== null) return;
      const payload = reactFlowToGraphPayload(nodesRef.current, edgesRef.current);
      const signature = graphSignature(nodesRef.current, edgesRef.current);
      const { workflow, validation } = await clientRef.current.createWorkflow({
        name: `${w.name} (local copy)`,
        description: w.description,
        graph: payload,
      });
      if (currentWorkflow.get()?.id !== w.id || requestedWorkflowId.get() !== null) return;

      draftRevisionRef.current = workflow.draftRevision;
      lastSavedSig.current = signature;
      applyValidation(validation, workflow.id, workflow.name, workflow.latestVersion, workflow.description ?? w.description, workflow.draftRevision);
      autosavePausedRef.current = false;
      autosaveConflict.set(null);
      if (!(await saveCurrentDraftUnlocked())) return;
      saveStatus.set('saved');
      duplicated = true;
    });
    if (!duplicated) return;
    await refreshWorkflows();
    setTimeout(() => saveStatus.get() === 'saved' && saveStatus.set('idle'), 1500);
  }, [applyValidation, refreshWorkflows, saveCurrentDraftUnlocked, withDraftWriteLock]);

  // ---- run with SSE streaming ----
  const executeRun = useCallback(async (input: RunInput, version = 0, replaySourceRunId?: string) => {
    const w = currentWorkflow.get();
    if (!w) return;
    streamStopRef.current?.();
    resetRunState();
    runPanelOpen.set(true);
    runState.setKey('status', 'queued');
    runState.setKey('attachments', input.attachments ?? []);

    // Published replays use their immutable graph. Draft runs first flush the
    // canvas so execution sees the latest authoring state.
    if (version === 0 && !replaySourceRunId) {
      const saved = await flushDraft();
      if (!saved) {
        runState.setKey('status', 'failed');
        runState.setKey('error', 'Preview stopped because the current draft could not be saved.');
        return;
      }
    }

    let runId: string;
    try {
      const { run: r } = replaySourceRunId
        ? await clientRef.current.replayRun(replaySourceRunId)
        : await clientRef.current.startRun(
            w.id,
            input,
            version,
            version === 0
              ? {
                  breakpointNodeIds: (debugBreakpoints.get()[w.id] ?? [])
                    .filter((nodeId) => nodesRef.current.some((node) => node.id === nodeId)),
                }
              : undefined,
          );
      runId = r.id;
      runState.setKey('runId', runId);
      runState.setKey('attachments', r.input.attachments ?? input.attachments ?? []);
    } catch (e) {
      runState.setKey('status', 'failed');
      runState.setKey('error', (e as Error).message);
      return;
    }

    const nameOf = (nodeId: string) =>
      (nodesRef.current.find((n) => n.id === nodeId)?.data?.label as string) || nodeId;

    const hydratePauseState = (settled: Run) => {
      runState.setKey('status', settled.status);
      runState.setKey('pendingApproval', settled.pendingApproval ?? null);
      runState.setKey('nestedWait', settled.nestedWait ?? null);
      runState.setKey('debugPause', settled.debugPause ?? null);
      runState.setKey('credentialRequirements', settled.credentialRequirements ?? null);
    };

    const hydratePausedRun = () => {
      void clientRef.current.getRun(runId).then(({ run: settled }) => {
        const current = runState.get();
        if (current.runId === runId && ['awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug'].includes(current.status)) {
          hydratePauseState(settled);
        }
      }).catch(() => { /* The streamed pause event remains authoritative. */ });
    };

    const hydrateTerminalRun = () => {
      void clientRef.current.getRun(runId).then(({ run: settled }) => {
        runState.setKey('usage', settled.usage);
        runState.setKey('state', settled.state ?? {});
        runState.setKey('startedAt', settled.startedAt ?? runState.get().startedAt);
        runState.setKey('endedAt', settled.endedAt ?? runState.get().endedAt);
      }).catch(() => { /* terminal event remains authoritative */ });
    };

    const handleRunEvent = (ev: RunEvent) => {
      const st = runState.get();
      runState.setKey('events', [...st.events, ev]);
      switch (ev.type) {
        case 'run.started':
          runState.setKey('status', 'running');
          runState.setKey('startedAt', ev.at);
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
        case 'llm.completed': {
          const usage = ev.usage ?? {};
          runState.setKey('usage', {
            ...st.usage,
            inputTokens: st.usage.inputTokens + (typeof usage.inputTokens === 'number' ? usage.inputTokens : 0),
            outputTokens: st.usage.outputTokens + (typeof usage.outputTokens === 'number' ? usage.outputTokens : 0),
            llmCalls: st.usage.llmCalls + 1,
          });
          break;
        }
        case 'tool.started': {
          runState.setKey('usage', { ...st.usage, toolCalls: st.usage.toolCalls + 1 });
          runState.setKey('nodeStatuses', st.nodeStatuses.map((node) =>
            node.nodeId === ev.nodeId ? { ...node, detail: `Calling ${ev.tool}` } : node));
          break;
        }
        case 'tool.completed': {
          runState.setKey('nodeStatuses', st.nodeStatuses.map((node) =>
            node.nodeId === ev.nodeId ? { ...node, detail: `${ev.tool} completed` } : node));
          break;
        }
        case 'tool.failed': {
          runState.setKey('nodeStatuses', st.nodeStatuses.map((node) =>
            node.nodeId === ev.nodeId ? { ...node, detail: `${ev.tool} failed: ${ev.error}` } : node));
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
        case 'state.updated':
          runState.setKey('state', ev.state);
          break;
        case 'approval.requested':
          runState.setKey('status', ev.approval.kind === 'client_tool' ? 'awaiting_client_tool' : 'awaiting_approval');
          runState.setKey('pendingApproval', ev.approval);
          hydratePausedRun();
          break;
        case 'credentials.required':
          runState.setKey('status', 'awaiting_credentials');
          runState.setKey('credentialRequirements', { providers: ev.providers.filter((provider): provider is 'gemini' | 'openai' | 'anthropic' => ['gemini', 'openai', 'anthropic'].includes(provider)) });
          hydratePausedRun();
          break;
        case 'debug.paused':
          runState.setKey('status', 'awaiting_debug');
          runState.setKey('debugPause', {
            nodeId: ev.nodeId,
            state: ev.state,
            nodeOutputs: ev.nodeOutputs,
            pausedAt: ev.at,
          });
          hydratePausedRun();
          break;
        case 'debug.resumed':
          runState.setKey('status', 'running');
          runState.setKey('debugPause', null);
          runState.setKey('nestedWait', null);
          break;
        case 'approval.resolved':
          runState.setKey('pendingApproval', null);
          runState.setKey('nestedWait', null);
          break;
        case 'approval.expired':
          runState.setKey('pendingApproval', null);
          runState.setKey('nestedWait', null);
          break;
        case 'run.completed':
          runState.setKey('status', 'completed');
          runState.setKey('output', ev.output ?? null);
          runState.setKey('pendingApproval', null);
          runState.setKey('nestedWait', null);
          runState.setKey('credentialRequirements', null);
          runState.setKey('endedAt', ev.at);
          hydrateTerminalRun();
          break;
        case 'run.failed':
          runState.setKey('status', 'failed');
          runState.setKey('error', (ev.error as string) ?? 'run failed');
          runState.setKey('pendingApproval', null);
          runState.setKey('nestedWait', null);
          runState.setKey('credentialRequirements', null);
          runState.setKey('endedAt', ev.at);
          hydrateTerminalRun();
          break;
        case 'run.cancelled':
          runState.setKey('status', 'cancelled');
          runState.setKey('pendingApproval', null);
          runState.setKey('nestedWait', null);
          runState.setKey('credentialRequirements', null);
          runState.setKey('endedAt', ev.at);
          hydrateTerminalRun();
          break;
      }
    };

    let lastEventId = 0;
    let fallbackStop: (() => void) | undefined;
    const realtimeStop = clientRef.current.streamRunEventsRealtime(runId, handleRunEvent, {
      onEventId: (eventId) => { lastEventId = Math.max(lastEventId, eventId); },
      onError: () => {
        if (fallbackStop) return;
        fallbackStop = clientRef.current.streamRunEvents(runId, handleRunEvent, {
          replay: true,
          afterEventId: lastEventId,
          onEventId: (eventId) => { lastEventId = Math.max(lastEventId, eventId); },
          onError: () => {
            if (runState.get().status === 'running' || runState.get().status === 'queued') {
              runState.setKey('error', 'lost connection to run stream');
            }
          },
        });
      },
    });
    streamStopRef.current = () => {
      realtimeStop();
      fallbackStop?.();
    };
  }, [flushDraft]);

  const run = useCallback(async (inputText: string, variables?: JsonObject, stateVariables?: JsonObject, attachments?: NonNullable<RunInput['attachments']>) => {
    await executeRun({ input_as_text: inputText, variables, state_variables: stateVariables, attachments }, 0);
  }, [executeRun]);

  const replayRun = useCallback(async (runId: string) => {
    runHistoryPanelOpen.set(false);
    await executeRun({}, 0, runId);
  }, [executeRun]);

  const updateMetadata = useCallback(async (name: string, description: string) => {
    const w = currentWorkflow.get();
    const trimmedName = name.trim();
    if (!w || !trimmedName) return;
    let updated = false;
    await withDraftWriteLock(async () => {
      if (currentWorkflow.get()?.id !== w.id) return;
      if (!(await saveCurrentDraftUnlocked())) throw new Error('The current draft could not be saved.');
      if (currentWorkflow.get()?.id !== w.id) return;

      const expectedRevision = draftRevisionRef.current;
      const workflow = await (async () => {
        try {
          const response = await clientRef.current.updateWorkflow(w.id, {
            name: trimmedName,
            description: description.trim(),
          }, expectedRevision);
          return response.workflow;
        } catch (error) {
          if (isRevisionConflict(error)) {
            await pauseForRevisionConflict(w.id, expectedRevision, error);
          }
          throw error;
        }
      })();

      const latestWorkflow = currentWorkflow.get();
      if (latestWorkflow?.id !== w.id) return;
      draftRevisionRef.current = workflow.draftRevision;
      currentWorkflow.set({
        ...latestWorkflow,
        name: workflow.name,
        description: workflow.description ?? '',
        draftRevision: workflow.draftRevision,
      });
      updated = true;
    });
    if (updated) await refreshWorkflows();
  }, [isRevisionConflict, pauseForRevisionConflict, refreshWorkflows, saveCurrentDraftUnlocked, withDraftWriteLock]);

  const resolveApproval = useCallback(async (approvalId: string, approved: boolean, reason?: string) => {
    const runId = runState.get().runId;
    if (!runId) return;
    try {
      const { run } = await clientRef.current.resolveApproval(runId, approvalId, approved, undefined, undefined, reason);
      runState.setKey('pendingApproval', null);
      runState.setKey('nestedWait', run.nestedWait ?? null);
      runState.setKey('credentialRequirements', null);
      runState.setKey('status', 'running');
    } catch (e) {
      try {
        const { run } = await clientRef.current.getRun(runId);
        if (run.credentialRequirements) {
          if (run.status === 'awaiting_credentials') runState.setKey('status', 'awaiting_credentials');
          runState.setKey('credentialRequirements', run.credentialRequirements ?? null);
        }
      } catch {
        // Keep the original approval error visible when the run cannot be reloaded.
      }
      runState.setKey('error', (e as Error).message);
    }
  }, []);

  const submitClientToolResult = useCallback(async (approvalId: string, result: import('../lib/agentBuilder').JsonValue) => {
    const runId = runState.get().runId;
    if (!runId) return;
    try {
      const { run } = await clientRef.current.submitClientToolResult(runId, approvalId, result);
      runState.setKey('pendingApproval', null);
      runState.setKey('nestedWait', run.nestedWait ?? null);
      runState.setKey('credentialRequirements', null);
      runState.setKey('status', 'running');
    } catch (e) {
      try {
        const { run } = await clientRef.current.getRun(runId);
        if (run.credentialRequirements) {
          if (run.status === 'awaiting_credentials') runState.setKey('status', 'awaiting_credentials');
          runState.setKey('credentialRequirements', run.credentialRequirements ?? null);
        }
      } catch {
        // Keep the original client-tool error visible when the run cannot be reloaded.
      }
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

  const continueDebug = useCallback(async () => {
    const runId = runState.get().runId;
    if (!runId) return;
    const { run } = await clientRef.current.continueDebugRun(runId);
    runState.setKey('nestedWait', run.nestedWait ?? null);
  }, []);

  const stepDebug = useCallback(async () => {
    const runId = runState.get().runId;
    if (!runId) return;
    const { run } = await clientRef.current.stepDebugRun(runId);
    runState.setKey('nestedWait', run.nestedWait ?? null);
  }, []);

  const resumeRun = useCallback(async (requestedRunId?: string) => {
    const runId = requestedRunId ?? runState.get().runId;
    if (!runId) return;
    try {
      const { run } = await clientRef.current.resumeRun(runId);
      if (runId === runState.get().runId) {
        runState.setKey('status', run.status);
        runState.setKey('nestedWait', run.nestedWait ?? null);
        runState.setKey('credentialRequirements', run.credentialRequirements ?? null);
        runState.setKey('error', null);
      }
    } catch (e) {
      if (runId === runState.get().runId) {
        runState.setKey('status', 'awaiting_credentials');
        runState.setKey('error', (e as Error).message);
      }
    }
  }, []);

  const publish = useCallback(async (notes?: string) => {
    const w = currentWorkflow.get();
    if (!w) return;
    let publishExpectedRevision = draftRevisionRef.current;
    try {
      await withDraftWriteLock(async () => {
        if (currentWorkflow.get()?.id !== w.id) {
          throw new Error('The active workflow changed before it could be published.');
        }
        if (!(await saveCurrentDraftUnlocked())) throw new Error('The current draft could not be saved.');
        if (currentWorkflow.get()?.id !== w.id) {
          throw new Error('The active workflow changed before it could be published.');
        }
        publishExpectedRevision = draftRevisionRef.current;
        const res = await (async () => {
          try {
            return await clientRef.current.publishWorkflow(w.id, notes, publishExpectedRevision);
          } catch (error) {
            if (isRevisionConflict(error)) {
              await pauseForRevisionConflict(w.id, publishExpectedRevision, error);
            }
            throw error;
          }
        })();
        draftRevisionRef.current = res.workflow.draftRevision;
        const latestWorkflow = currentWorkflow.get();
        currentWorkflow.set({
          ...(latestWorkflow?.id === w.id ? latestWorkflow : w),
          latestVersion: res.version.version,
          draftRevision: res.workflow.draftRevision,
          valid: res.validation.valid,
          errors: res.validation.errors.map((issue) => issue.message),
          warnings: res.validation.warnings.map((issue) => issue.message),
          errorIssues: res.validation.errors,
          warningIssues: res.validation.warnings,
          safetyFindings: res.validation.safetyFindings ?? [],
          contracts: res.validation.contracts,
        });
      });
      await refreshWorkflows();
    } catch (e) {
      if (!isRevisionConflict(e)) {
        const latestWorkflow = currentWorkflow.get();
        if (latestWorkflow?.id === w.id) {
          currentWorkflow.set({
            ...latestWorkflow,
            valid: false,
            errors: [(e as Error).message],
            errorIssues: [{ message: (e as Error).message }],
          });
        }
      }
      throw e;
    }
  }, [isRevisionConflict, pauseForRevisionConflict, refreshWorkflows, saveCurrentDraftUnlocked, withDraftWriteLock]);

  const exportCode = useCallback(async (format: 'typescript' | 'python' | 'typescript-sdk' | 'python-sdk') => {
    const w = currentWorkflow.get();
    if (!w) return;
    codeModal.set({ open: true, loading: true, format, code: '', bundle: null, error: null });
    try {
      if (!(await flushDraft())) throw new Error('The current draft could not be saved.');
      if (format.endsWith('-sdk')) {
        const { bundle } = await clientRef.current.exportCode(w.id, format as 'typescript-sdk' | 'python-sdk');
        codeModal.set({
          open: true,
          loading: false,
          format,
          code: bundle.files[bundle.entrypoint] ?? '',
          bundle: bundle as SdkCodeBundle,
          error: null,
        });
      } else {
        const { code } = await clientRef.current.exportCode(w.id, format as 'typescript' | 'python');
        codeModal.set({ open: true, loading: false, format, code, bundle: null, error: null });
      }
    } catch (e) {
      if (isRevisionConflict(e)) await pauseForRevisionConflict(w.id, draftRevisionRef.current, e);
      codeModal.set({ open: true, loading: false, format, code: '', bundle: null, error: (e as Error).message });
    }
  }, [flushDraft, isRevisionConflict, pauseForRevisionConflict]);

  const exportWorkflowJson = useCallback(async () => {
    const w = currentWorkflow.get();
    if (!w) return;
    codeModal.set({ open: true, loading: true, format: 'json', code: '', bundle: null, error: null });
    try {
      if (!(await flushDraft())) throw new Error('The current draft could not be saved.');
      const { artifact } = await clientRef.current.exportWorkflow(w.id);
      codeModal.set({ open: true, loading: false, format: 'json', code: JSON.stringify(artifact, null, 2), bundle: null, error: null });
    } catch (e) {
      if (isRevisionConflict(e)) await pauseForRevisionConflict(w.id, draftRevisionRef.current, e);
      codeModal.set({ open: true, loading: false, format: 'json', code: '', bundle: null, error: (e as Error).message });
    }
  }, [flushDraft, isRevisionConflict, pauseForRevisionConflict]);

  const importWorkflowJson = useCallback(async (text: string) => {
    codeModal.set({ open: true, loading: true, format: 'json', code: '', bundle: null, error: null });
    try {
      const artifact = JSON.parse(text) as import('../lib/agentBuilder').PortableWorkflow;
      const { workflow } = await clientRef.current.importWorkflow(artifact);
      codeModal.setKey('open', false);
      requestedWorkflowId.set(workflow.id);
      await refreshWorkflows();
    } catch (e) {
      codeModal.set({ open: true, loading: false, format: 'json', code: '', bundle: null, error: (e as Error).message });
    }
  }, [refreshWorkflows]);

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
    if (publishN !== firstPublish.current) void publish().catch(() => undefined);
    firstPublish.current = publishN;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishN]);

  // cleanup stream on unmount
  useEffect(() => () => streamStopRef.current?.(), []);

  return {
    ready: !!wf && readyRef.current && requested === null,
    run,
    replayRun,
    updateMetadata,
    publish,
    exportCode,
    exportWorkflowJson,
    importWorkflowJson,
    resolveApproval,
    submitClientToolResult,
    resumeRun,
    cancelRun,
    continueDebug,
    stepDebug,
    refreshWorkflows,
    flushDraft,
    reloadRemoteDraft,
    overwriteRemoteDraft,
    duplicateLocalDraft,
  };
}
