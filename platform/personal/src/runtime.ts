/**
 * The app-facing wiring.
 *
 * Every other file in this package is deliberately free of the app: no directory
 * handles, no React, no key store, no globals. That makes them testable and it
 * makes the layering enforceable, but something has to actually connect them, and
 * this is that file. It is the only one that knows about all four halves at once
 * (profile, builder, connectors, retrieval), and the only one the app imports for
 * behaviour rather than for types.
 *
 * Everything here is idempotent or guarded. It is called from React effects that
 * run twice in development, from a store subscription that fires on every change,
 * and from a Settings button the user can press repeatedly.
 */

import { runRebuild, type ChatSource, type RebuildOutcome } from './builder/rebuild';
import { createExtractRunner, resolveExtractModel } from './builder/llm';
import {
  createBuildGate,
  shouldRebuild,
  whenIdle,
  type ScheduleDecision,
} from './builder/schedule';
import { collectConnectorSignals } from './connectors/signals';
import { commitBuildResult, profileStore } from './profile/profile-store';
import { invalidatePersonalIndex, retrievePersonalData } from './retrieval/personal-context';
import { createPersonalActions } from './tools/actions';
import { executePersonalTool, type ToolCallResult } from './tools/executor';

export interface PersonalRuntimeDeps {
  chats: ChatSource;
  /** The user's API keys, for the extractor. Read fresh each build, because a
   *  user can add a key after the app has booted. */
  getApiKeys: () => unknown;
}

let deps: PersonalRuntimeDeps | null = null;
let cancelIdle: (() => void) | null = null;
const gate = createBuildGate();

/**
 * Hand the runtime its app-level dependencies.
 *
 * Called once from the provider that owns the workspace folder. Until it runs,
 * every function here no-ops rather than throwing — there is a window at boot
 * where the folder is not yet chosen, and the correct behaviour in that window is
 * to do nothing at all.
 */
export const attachPersonalRuntime = (next: PersonalRuntimeDeps): void => {
  deps = next;
  // Chats changed underneath the search index, whether or not a build runs.
  invalidatePersonalIndex();
};

export const detachPersonalRuntime = (): void => {
  deps = null;
  cancelIdle?.();
  cancelIdle = null;
};

/** Connector signals, but only if a build is allowed to use them. */
const connectorCandidates = (signal?: AbortSignal) => () =>
  collectConnectorSignals({ signal });

/**
 * Run a build now. Single-flighted; returns the running build if one is going.
 *
 * No schedule check here — this is what "Refresh now" calls, and a user pressing
 * it has decided the timing themselves. The enabled check and the model check
 * still apply, because neither of those is a timing question: `runRebuild`
 * refuses when Memory is off, and there is nothing to run without a key.
 */
export const buildProfileNow = async (
  options: { signal?: AbortSignal } = {},
): Promise<RebuildOutcome> => {
  if (!deps) return { status: 'nothing-to-do', chatsRead: 0, batches: 0 };

  const model = resolveExtractModel(deps.getApiKeys());
  if (!model) return { status: 'nothing-to-do', chatsRead: 0, batches: 0 };

  let outcome: RebuildOutcome = { status: 'nothing-to-do', chatsRead: 0, batches: 0 };
  const source = deps;

  await gate.run(async () => {
    outcome = await runRebuild({
      chats: source.chats,
      extract: createExtractRunner(model),
      connectors: connectorCandidates(options.signal),
      getState: () => profileStore.get(),
      commit: commitBuildResult,
      signal: options.signal,
    });
  });

  // A build rewrote nothing on disk that the index reads, but chats were read and
  // the count may have moved since the index was built.
  if (outcome.status === 'built') invalidatePersonalIndex();
  return outcome;
};

/**
 * Decide whether an automatic build is due, without running one.
 *
 * Exported so Settings can explain itself — "next build when 8 more chats have
 * changed" is a better answer than a button that does nothing when pressed.
 */
export const buildDecision = async (now = Date.now()): Promise<ScheduleDecision> => {
  if (!deps) return { run: false, reason: 'nothing-pending' };
  const state = profileStore.get();
  const available = await deps.chats.list();
  const pending = available.filter((chat) => {
    const seen = state.digested[chat.chatId];
    return seen === undefined || chat.updatedAt > seen;
  }).length;

  return shouldRebuild({
    enabled: state.enabled,
    lastBuiltAt: state.lastBuiltAt,
    pendingChats: pending,
    hasModel: Boolean(resolveExtractModel(deps.getApiKeys())),
    now,
  });
};

/**
 * Arm the idle build for this session.
 *
 * One build per launch at most, and only when the app has been open and quiet
 * long enough that the user is plainly not waiting on it. Returns a cancel
 * function for the caller's effect cleanup.
 */
export const schedulePersonalBuild = (): (() => void) => {
  cancelIdle?.();
  cancelIdle = whenIdle(() => {
    void (async () => {
      const decision = await buildDecision();
      if (!decision.run) return;
      await buildProfileNow();
    })();
  });
  return () => {
    cancelIdle?.();
    cancelIdle = null;
  };
};

/**
 * Execute a personal tool call from the chat pipeline.
 *
 * Returns `null` for calls that are not ours, so the caller can pass them to
 * whatever else it runs tools for.
 */
export const runPersonalTool = async (
  name: string,
  args: unknown,
): Promise<ToolCallResult | null> => {
  if (!deps) return null;
  return executePersonalTool(name, args, {
    chats: deps.chats,
    actions: createPersonalActions(),
  });
};

/** Direct retrieval, for callers that want the text without a tool round-trip. */
export const searchPersonalData = async (query: string): Promise<string> => {
  if (!deps) return 'No personal data is available.';
  const result = await retrievePersonalData(query, { chats: deps.chats });
  return result.text;
};

export const isBuildRunning = (): boolean => gate.isRunning();
