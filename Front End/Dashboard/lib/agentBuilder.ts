/**
 * Agent Builder backend client — integration shim for the Dashboard.
 *
 * The Agent Builder is a separate mini-app: its backend lives in
 * `Back End/agent-builder` (run it with `npm start` there; it listens on
 * http://127.0.0.1:8787). This module wires the typed SDK to this app's
 * user data (API keys from UserDataContext are forwarded per request via
 * the `x-provider-keys` header — the backend never needs its own LLM keys).
 *
 * Usage inside a component:
 *
 *   import { getAgentBuilderClient } from '../lib/agentBuilder';
 *   const ab = getAgentBuilderClient(apiKeys);
 *   const { workflow } = await ab.createWorkflow({ name: 'My workflow' });
 *   await ab.saveDraft(workflow.id, { nodes, edges });   // raw React Flow JSON
 *   const { run } = await ab.startRun(workflow.id, { input_as_text: 'hi' });
 *   ab.streamRunEvents(run.id, (e) => { ... });
 */

import {
  AgentBuilderClient,
  type ProviderKeys,
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

interface DashboardApiKeys {
  gemini: string[];
  openai: string[];
  anthropic: string[];
}

let cached: AgentBuilderClient | null = null;
let cachedKeysRef: (() => ProviderKeys | undefined) | null = null;
let latestKeys: DashboardApiKeys | undefined;

/**
 * Returns a singleton client. Pass the current `apiKeys` from
 * `useUserDataContext()` whenever you have them — the latest value is always
 * used for subsequent requests.
 */
export function getAgentBuilderClient(apiKeys?: DashboardApiKeys): AgentBuilderClient {
  if (apiKeys) latestKeys = apiKeys;
  if (!cached) {
    cachedKeysRef = () => latestKeys;
    cached = new AgentBuilderClient({
      baseUrl: BASE_URL,
      providerKeys: () => cachedKeysRef?.() ?? undefined,
    });
  }
  return cached;
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
