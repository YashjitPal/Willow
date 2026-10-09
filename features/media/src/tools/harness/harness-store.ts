/**
 * The turn in flight, for the live transcript.
 *
 * The harness reports every token and every step change; publishing each one
 * into React state would re-render the whole workbench sidebar per token. So the
 * live turn lives in a store that only the timeline subscribes to, and updates
 * are coalesced to one per animation frame.
 *
 * One per Code screen (`session/code-session.ts`), so a turn running in a hidden
 * project never streams into the timeline of the screen on show.
 */

import { atom, computed, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { TurnPhase, TurnStep } from './protocol';

export interface LiveTurn {
  steps: TurnStep[];
  phase: TurnPhase | null;
  thoughts: string;
}

export interface HarnessStore {
  liveTurn: WritableAtom<LiveTurn | null>;
  /** The thoughts alone, so the thinking row re-renders only when they change, not per token. */
  liveThoughts: ReadableAtom<string>;
  /** Publishes the latest state, at most once per frame. */
  publish(state: LiveTurn): void;
  /** Clears the live turn, dropping anything still waiting for a frame. */
  clear(): void;
}

/* A hidden screen's transcript is not being read: a few updates a second keep it current. */
const HIDDEN_PUBLISH_MS = 250;

/** `isOnShow` is the screen's: while it is hidden, updates come at most every `HIDDEN_PUBLISH_MS`. */
export function createHarnessStore(isOnShow: () => boolean = () => true): HarnessStore {
  const liveTurn = atom<LiveTurn | null>(null);
  let pending: LiveTurn | null = null;
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (pending) liveTurn.set(pending);
    pending = null;
  };

  return {
    liveTurn,
    liveThoughts: computed(liveTurn, (turn) => turn?.thoughts ?? ''),
    publish(state) {
      pending = state;
      if (scheduled) return;
      scheduled = true;
      if (!isOnShow()) setTimeout(flush, HIDDEN_PUBLISH_MS);
      else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
      else flush();
    },
    clear() {
      pending = null;
      liveTurn.set(null);
    },
  };
}
