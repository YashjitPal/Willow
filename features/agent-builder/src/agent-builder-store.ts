/**
 * Agent Builder integration store.
 *
 * Shared state between the AgentBuilder canvas and the Workbench chrome
 * (top bar Preview/Code/Evaluate buttons, sidebar workflow list). The canvas
 * owns the backend connection via useAgentBuilderBackend; the chrome only
 * reads status and fires action triggers.
 */

import { atom, map } from 'nanostores';
import type { NestedRunWait, NodeDataContract, PendingApproval, RunEvent, RunInput, RunStatus, SafetyFinding, SdkCodeBundle } from '@agentbuilder';
import type { ValidationIssue } from '@agentbuilder';

export type BackendStatus = 'unknown' | 'checking' | 'up' | 'down';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface CurrentWorkflow {
  id: string;
  name: string;
  description: string;
  latestVersion: number;
  draftRevision: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  errorIssues: ValidationIssue[];
  warningIssues: ValidationIssue[];
  safetyFindings: SafetyFinding[];
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
  nestedWait: NestedRunWait | null;
  debugPause: { nodeId: string; lastNodeId?: string; state: Record<string, unknown>; nodeOutputs: Record<string, unknown>; pausedAt: string } | null;
  credentialRequirements: { providers: Array<'gemini' | 'openai' | 'anthropic'> } | null;
  output: unknown;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number; llmCalls: number; toolCalls: number };
  state: Record<string, unknown>;
  startedAt: string | null;
  endedAt: string | null;
  attachments: NonNullable<RunInput['attachments']>;
}

export const backendStatus = atom<BackendStatus>('unknown');
export const saveStatus = atom<SaveStatus>('idle');
export const currentWorkflow = atom<CurrentWorkflow | null>(null);
/** Active canvas save guard used before app-level navigation unmounts the builder. */
export const agentBuilderDraftFlush = atom<(() => Promise<boolean>) | null>(null);
export interface AutosaveConflict {
  workflowId: string;
  expectedRevision: number;
  currentRevision: number;
  message: string;
}
export const autosaveConflict = atom<AutosaveConflict | null>(null);
/** Incremented whenever the canvas is replaced with a newer remote draft. */
export const remoteDraftReloadEpoch = atom<number>(0);

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
  nestedWait: null,
  debugPause: null,
  credentialRequirements: null,
  output: null,
  error: null,
  usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0, toolCalls: 0 },
  state: {},
  startedAt: null,
  endedAt: null,
  attachments: [],
});

/** Run panel visibility. */
export const runPanelOpen = atom<boolean>(false);
export const runHistoryPanelOpen = atom<boolean>(false);
/** Run ID to inspect when history is opened from another trace surface. */
export const requestedRunHistoryRunId = atom<string | null>(null);

/** Run-only debugger breakpoints, kept outside workflow graph persistence. */
export const debugBreakpoints = atom<Record<string, string[]>>({});

export function toggleDebugBreakpoint(workflowId: string, nodeId: string): void {
  const current = debugBreakpoints.get();
  const workflowBreakpoints = new Set(current[workflowId] ?? []);
  if (workflowBreakpoints.has(nodeId)) workflowBreakpoints.delete(nodeId);
  else workflowBreakpoints.add(nodeId);
  debugBreakpoints.set({ ...current, [workflowId]: [...workflowBreakpoints].sort() });
}

/** Code export modal. */
export type CodeExportFormat = 'typescript' | 'python' | 'typescript-sdk' | 'python-sdk' | 'json';
export const codeModal = map<{
  open: boolean;
  loading: boolean;
  format: CodeExportFormat;
  code: string;
  bundle: SdkCodeBundle | null;
  error: string | null;
}>({ open: false, loading: false, format: 'typescript', code: '', bundle: null, error: null });

/**
 * Action triggers — the top bar increments these; the canvas hook watches
 * them and performs the action (it owns the graph + backend client).
 */
export const previewTrigger = atom<number>(0);
export const codeTrigger = atom<number>(0);
export const publishTrigger = atom<number>(0);
export const evaluationPanelOpen = atom<boolean>(false);
/** Node-scoped grader counts derived from evaluation definitions, never persisted into workflow nodes. */
export const evaluationGraderCounts = atom<Record<string, number>>({});
/** Optional Agent node that should be preselected when opening Evaluate from its config panel. */
export const requestedEvaluationNodeId = atom<string | null>(null);
export interface EvaluationTraceFocusRequest {
  runId: string;
  nodeId?: string;
  spanType?: 'node' | 'llm' | 'tool' | 'guardrail' | 'approval' | 'state' | 'run';
  occurrence?: number;
  targetKey?: string;
}
/** Evaluation result drilldown request consumed by Run History. */
export const evaluationTraceFocusRequest = atom<EvaluationTraceFocusRequest | null>(null);
export const versionPanelOpen = atom<boolean>(false);
export const publishDialogOpen = atom<boolean>(false);

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
    nestedWait: null,
    debugPause: null,
    credentialRequirements: null,
    output: null,
    error: null,
    usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0, toolCalls: 0 },
    state: {},
    startedAt: null,
    endedAt: null,
    attachments: [],
  });
}
