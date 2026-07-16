/**
 * Agent Builder integration store.
 *
 * Shared state between the AgentBuilder canvas and the Staging chrome
 * (top bar Preview/Code/Evaluate buttons, sidebar workflow list). The canvas
 * owns the backend connection via useAgentBuilderBackend; the chrome only
 * reads status and fires action triggers.
 */

import { atom, map } from 'nanostores';
import type { NodeDataContract, PendingApproval, RunEvent, RunStatus } from '@agentbuilder';

export type BackendStatus = 'unknown' | 'checking' | 'up' | 'down';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface CurrentWorkflow {
  id: string;
  name: string;
  latestVersion: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  contracts: NodeDataContract[];
}

export interface RunState {
  runId: string | null;
  status: RunStatus | 'idle';
  /** node id -> streamed text (llm deltas) */
  streamingByNode: Record<string, string>;
  /** node id -> latest status label for the trace list */
  nodeStatuses: Array<{ nodeId: string; name: string; status: 'running' | 'ok' | 'error'; detail?: string }>;
  events: RunEvent[];
  pendingApproval: PendingApproval | null;
  output: unknown;
  error: string | null;
}

export const backendStatus = atom<BackendStatus>('unknown');
export const saveStatus = atom<SaveStatus>('idle');
export const currentWorkflow = atom<CurrentWorkflow | null>(null);

/** Workflows list for the sidebar Library card. */
export const workflowList = atom<
  Array<{ id: string; name: string; nodeCount: number; latestVersion: number; updatedAt: string }>
>([]);

/** A specific workflow the user picked from the Library (canvas loads it). */
export const requestedWorkflowId = atom<string | null>(null);

export const runState = map<RunState>({
  runId: null,
  status: 'idle',
  streamingByNode: {},
  nodeStatuses: [],
  events: [],
  pendingApproval: null,
  output: null,
  error: null,
});

/** Run panel visibility. */
export const runPanelOpen = atom<boolean>(false);

/** Code export modal. */
export const codeModal = map<{ open: boolean; loading: boolean; format: 'typescript' | 'python'; code: string; error: string | null }>(
  { open: false, loading: false, format: 'typescript', code: '', error: null },
);

/**
 * Action triggers — the top bar increments these; the canvas hook watches
 * them and performs the action (it owns the graph + backend client).
 */
export const previewTrigger = atom<number>(0);
export const codeTrigger = atom<number>(0);
export const publishTrigger = atom<number>(0);
export const evaluationPanelOpen = atom<boolean>(false);
export const versionPanelOpen = atom<boolean>(false);

export function firePreview(): void {
  previewTrigger.set(previewTrigger.get() + 1);
}
export function fireCode(): void {
  codeTrigger.set(codeTrigger.get() + 1);
}
export function firePublish(): void {
  publishTrigger.set(publishTrigger.get() + 1);
}

export function resetRunState(): void {
  runState.set({
    runId: null,
    status: 'idle',
    streamingByNode: {},
    nodeStatuses: [],
    events: [],
    pendingApproval: null,
    output: null,
    error: null,
  });
}
