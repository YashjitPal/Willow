/**
 * When a build runs.
 *
 * A local app has no server and no process when it is closed, so there is no
 * nightly cron to hang this on. The trigger is therefore "the app is open and
 * has nothing better to do", which in practice means three things:
 *
 * 1. **Idle after launch.** A delay after the app settles, so a build never
 *    competes with first paint, the sidebar, or the user's first message.
 * 2. **A change threshold.** Enough chats have moved since the last build to be
 *    worth a model call. One new conversation rarely changes a profile; ten
 *    usually do.
 * 3. **A cooldown.** However many chats change, no more than one build per
 *    window — a long working session should not trigger a build every hour.
 *
 * Plus a manual button in Settings, which bypasses 1 and 3 but not the enabled
 * check. When someone presses "Refresh now" they have decided the timing.
 *
 * The scheduler owns the *decision*, not the work: it never imports the builder.
 * That keeps a model client out of the boot path, and it is why this file can be
 * tested by calling it with a fake clock.
 */

/** After the app settles. Long enough that a user who opened Willow to ask one
 *  question is answered and gone before anything starts. */
export const IDLE_DELAY_MS = 90_000;

/** Chats changed since the last build before an automatic one is worth running. */
export const CHANGE_THRESHOLD = 8;

/** No automatic build within this of the last one. */
export const COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** A first build runs on a much lower bar — there is nothing to compare against
 *  and an empty Personal Intelligence page is the thing being fixed. */
export const FIRST_BUILD_THRESHOLD = 3;

export interface ScheduleInput {
  enabled: boolean;
  /** ISO instant of the last completed build, or undefined if never. */
  lastBuiltAt?: string;
  /** How many chats have changed or appeared since the last build. */
  pendingChats: number;
  /** Whether the user has a usable extractor key. */
  hasModel: boolean;
  now: number;
}

export type ScheduleDecision =
  | { run: false; reason: 'disabled' | 'no-model' | 'nothing-pending' | 'below-threshold' | 'cooling-down' }
  | { run: true; reason: 'first-build' | 'threshold' };

/**
 * Should an automatic build run right now.
 *
 * Split from the timer so the answer is a pure function of state. The caller
 * re-asks after the idle delay rather than deciding up front, because the user
 * may have turned Memory off, deleted the profile, or started a long
 * conversation in the meantime.
 */
export const shouldRebuild = ({
  enabled,
  lastBuiltAt,
  pendingChats,
  hasModel,
  now,
}: ScheduleInput): ScheduleDecision => {
  if (!enabled) return { run: false, reason: 'disabled' };
  if (!hasModel) return { run: false, reason: 'no-model' };
  if (pendingChats <= 0) return { run: false, reason: 'nothing-pending' };

  if (!lastBuiltAt) {
    return pendingChats >= FIRST_BUILD_THRESHOLD
      ? { run: true, reason: 'first-build' }
      : { run: false, reason: 'below-threshold' };
  }

  const last = Date.parse(lastBuiltAt);
  // An unparseable timestamp is treated as "long ago" rather than "never": the
  // profile exists, so this is a damaged record, not a first run.
  if (Number.isFinite(last) && now - last < COOLDOWN_MS) {
    return { run: false, reason: 'cooling-down' };
  }
  return pendingChats >= CHANGE_THRESHOLD
    ? { run: true, reason: 'threshold' }
    : { run: false, reason: 'below-threshold' };
};

/**
 * Wait for the app to be idle, then call back.
 *
 * `requestIdleCallback` where it exists, a timer where it does not — Safari
 * still lacks it. The idle callback is bounded by its own timeout so a
 * permanently busy tab does not postpone the build forever, and the whole thing
 * is cancellable because the user can close the window at any point.
 */
export const whenIdle = (callback: () => void, delayMs = IDLE_DELAY_MS): (() => void) => {
  let cancelled = false;
  let idleHandle: number | null = null;

  const timer = setTimeout(() => {
    if (cancelled) return;
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof idle === 'function') {
      idleHandle = idle(() => {
        if (!cancelled) callback();
      }, { timeout: 30_000 });
      return;
    }
    callback();
  }, delayMs);

  return () => {
    cancelled = true;
    clearTimeout(timer);
    const cancelIdle = (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
    if (idleHandle !== null && typeof cancelIdle === 'function') cancelIdle(idleHandle);
  };
};

/**
 * One build at a time, ever.
 *
 * The idle timer, the manual button and a second window can all ask at once, and
 * two concurrent builds would both read the same undigested chats, both call the
 * model on them, and race to commit — burning double the tokens to produce the
 * same result twice. A caller that arrives during a run gets the running promise
 * instead of starting another.
 */
export const createBuildGate = (): {
  run: (task: () => Promise<void>) => Promise<void>;
  isRunning: () => boolean;
} => {
  let inFlight: Promise<void> | null = null;
  return {
    isRunning: () => inFlight !== null,
    run: (task) => {
      if (inFlight) return inFlight;
      inFlight = task().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
};
