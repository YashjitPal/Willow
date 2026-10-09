import { useAtomValue } from "@effect/atom-react";
import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { resolveHarnessModelSelection } from "~/providerInstances";
import { useServerConfigs } from "~/state/entities";
import { primaryServerProvidersAtom } from "~/state/server";

/** The agents Willow's rail has a tab for, by T3's provider driver kind, under the names the rail shows. */
const HARNESS_LABELS: Readonly<Record<string, string>> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok Build",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  pi: "Pi",
};

export const harnessLabel = (driver: string): string => HARNESS_LABELS[driver] ?? driver;

export const isWillowEmbedded = (): boolean =>
  typeof window !== "undefined" && window.__WILLOW_AGENTS__ !== undefined;

const subscribeToScope = (onChange: () => void): (() => void) => {
  const unsubscribe = window.__WILLOW_AGENTS__?.onScope(onChange);
  return () => {
    unsubscribe?.();
  };
};

/** The agent of the Willow tab this page is showing in, or null outside Willow (a phone, a browser). */
export function useWillowScope(): string | null {
  return useSyncExternalStore(
    subscribeToScope,
    () => window.__WILLOW_AGENTS__?.scope() ?? null,
    () => null,
  );
}

let knownProviders: ReadonlyArray<ServerProvider> = [];
let providersByEnvironment: ReadonlyMap<string, ReadonlyArray<ServerProvider>> = new Map();

/** Keeps the providers the model defaults below are resolved against current. Mounted once, at the root. */
export function useHarnessProvidersSync(): void {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const configs = useServerConfigs();
  useEffect(() => {
    knownProviders = providers;
  }, [providers]);
  useEffect(() => {
    providersByEnvironment = new Map(
      [...configs].map(([environmentId, config]) => [environmentId, config.providers]),
    );
  }, [configs]);
}

/**
 * A new thread's model in an agent tab: on the tab's agent, whatever default or carried-over
 * model it would have had, among the providers of the computer it will run on.
 */
export const withHarnessModel = (
  selection: ModelSelection | null,
  environmentId?: string,
): ModelSelection | null =>
  resolveHarnessModelSelection(
    (environmentId ? providersByEnvironment.get(environmentId) : undefined) ?? knownProviders,
    selection,
  ) ?? selection;

/**
 * The threads an agent tab lists: those on one of its agent's provider instances, on whichever
 * computer they run. A default instance's id is its driver's, which also covers threads of
 * computers whose providers this page has not been told about. Outside Willow, every thread.
 */
export function useHarnessThreads<
  T extends { readonly environmentId: string; readonly providerInstanceId: string },
>(threads: ReadonlyArray<T>): ReadonlyArray<T> {
  const scope = useWillowScope();
  const configs = useServerConfigs();
  return useMemo(() => {
    if (!scope) return threads;
    const instances = new Set<string>();
    for (const [environmentId, config] of configs) {
      for (const provider of config.providers) {
        if (provider.driver === scope) instances.add(`${environmentId}\u0000${provider.instanceId}`);
      }
    }
    return threads.filter(
      (thread) =>
        thread.providerInstanceId === scope ||
        instances.has(`${thread.environmentId}\u0000${thread.providerInstanceId}`),
    );
  }, [configs, scope, threads]);
}
