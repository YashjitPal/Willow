/**
 * Agent Builder backend client — integration shim for Willow Studio.
 *
 * The Agent Builder is a separate mini-app: its backend lives in
 * `services/agent-builder` (run it with `npm run agent-builder:start`; it
 * listens on http://127.0.0.1:8787). This module wires the typed SDK to this app's
 * user data (API keys from UserDataContext are forwarded per request via
 * the `x-provider-keys` header — the backend never needs its own LLM keys).
 *
 * Usage inside a component:
 *
 *   import { getAgentBuilderClient } from './agent-builder';
 *   const ab = getAgentBuilderClient(apiKeys);
 *   const { workflow } = await ab.createWorkflow({ name: 'My workflow' });
 *   await ab.saveDraft(workflow.id, { nodes, edges });   // raw React Flow JSON
 *   const { run } = await ab.startRun(workflow.id, { input_as_text: 'hi' });
 *   ab.streamRunEvents(run.id, (e) => { ... });
 */

import {
  AgentBuilderClient,
  type ProviderKeys,
  type PortableTraceExport,
  type Run,
  type RunStatus,
  type TraceSpan,
} from '@agentbuilder';

export * from '@agentbuilder';

/**
 * Base URL for the Agent Builder API.
 *
 * Default is '' (same origin) — the backend runs as Vite dev middleware under
 * /api/v1, so no second port or CORS is involved. Set VITE_AGENT_BUILDER_URL
 * (e.g. http://127.0.0.1:8787) to target a standalone backend instead.
 */
const BASE_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_AGENT_BUILDER_URL) ||
  '';

interface StudioApiKeys {
  gemini: string[];
  openai: string[];
  anthropic: string[];
  moonshot?: string[];
  spacexai?: string[];
  zhipuai?: string[];
  kimi?: string[];
  grok?: string[];
  glm?: string[];
}

let cached: AgentBuilderClient | null = null;
let cachedKeysRef: (() => ProviderKeys | undefined) | null = null;
let latestKeys: StudioApiKeys | undefined;
const API_TOKEN_SESSION_KEY = 'willow:agentBuilderApiToken';

function readSessionApiToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage.getItem(API_TOKEN_SESSION_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

let latestApiToken = readSessionApiToken();

function agentBuilderProviderKeys(keys?: StudioApiKeys): ProviderKeys | undefined {
  if (!keys) return undefined;
  return {
    gemini: keys.gemini,
    openai: keys.openai,
    anthropic: keys.anthropic,
    kimi: keys.kimi ?? keys.moonshot,
    grok: keys.grok ?? keys.spacexai,
    glm: keys.glm ?? keys.zhipuai,
  } as ProviderKeys;
}

/**
 * Returns a singleton client. Pass the current `apiKeys` from
 * `useUserDataContext()` whenever you have them — the latest value is always
 * used for subsequent requests.
 */
export function getAgentBuilderClient(apiKeys?: StudioApiKeys): AgentBuilderClient {
  if (apiKeys) latestKeys = apiKeys;
  if (!cached) {
    cachedKeysRef = () => agentBuilderProviderKeys(latestKeys);
    cached = new AgentBuilderClient({
      baseUrl: BASE_URL,
      apiToken: latestApiToken,
      providerKeys: () => cachedKeysRef?.() ?? undefined,
    });
  }
  return cached;
}

/** Use a managed Agent Builder API key for this browser session. */
export function setAgentBuilderApiToken(token?: string): void {
  latestApiToken = token?.trim() || undefined;
  cached?.setApiToken(latestApiToken);
  if (typeof window === 'undefined') return;
  try {
    if (latestApiToken) window.sessionStorage.setItem(API_TOKEN_SESSION_KEY, latestApiToken);
    else window.sessionStorage.removeItem(API_TOKEN_SESSION_KEY);
  } catch {
    // A memory-only token still works when session storage is unavailable.
  }
}

/** Quick reachability probe (e.g. to show "backend offline" UI). */
export async function isAgentBuilderBackendUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface RunQueryFilters {
  status?: RunStatus;
  nodeId?: string;
  type?: string;
  from?: string;
  to?: string;
  error?: string;
  model?: string;
  tool?: string;
  cursor?: string;
  limit?: number;
}

export type RunTraceExport = PortableTraceExport;

async function studioRequest<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  // Keep these lightweight helpers equivalent to AgentBuilderClient requests.
  // They are used by observability panels but still need the configured
  // session token and per-request provider credentials when auth is enabled.
  if (latestApiToken) headers.authorization = `Bearer ${latestApiToken}`;
  const keys = latestKeys;
  if (keys) {
    const providerKeys = Object.fromEntries(
      Object.entries(agentBuilderProviderKeys(keys) ?? {}).filter(([, values]) => Array.isArray(values) && values.length > 0),
    );
    if (Object.keys(providerKeys).length > 0) headers['x-provider-keys'] = JSON.stringify(providerKeys);
  }
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Agent Builder returned a non-JSON response (${response.status}).`);
  }
  if (!response.ok) {
    const apiError = (body as { error?: { message?: string } } | null)?.error;
    throw new Error(apiError?.message ?? `Agent Builder request failed (${response.status}).`);
  }
  return body as T;
}

/** Query durable runs using the backend's cursor-based observability contract. */
export async function queryAgentBuilderRuns(
  workflowId: string,
  filters: RunQueryFilters = {},
): Promise<{ runs: Run[]; nextCursor?: string }> {
  const query = new URLSearchParams({ workflowId });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return studioRequest(`/api/v1/runs?${query.toString()}`);
}

/** Fetch the canonical portable trace artifact rather than rebuilding it in the browser. */
export async function exportAgentBuilderRunTrace(runId: string): Promise<RunTraceExport> {
  const response = await studioRequest<{ export: RunTraceExport }>(
    `/api/v1/runs/${encodeURIComponent(runId)}/trace/export`,
  );
  return response.export;
}

/** Fetch a full span snapshot at cursor 0, then only changed/new spans after that cursor. */
export async function getAgentBuilderTraceSpans(
  runId: string,
  after = 0,
): Promise<{ spans: TraceSpan[]; cursor: number }> {
  return studioRequest(
    `/api/v1/runs/${encodeURIComponent(runId)}/spans?after=${Math.max(0, Math.trunc(after))}`,
  );
}
