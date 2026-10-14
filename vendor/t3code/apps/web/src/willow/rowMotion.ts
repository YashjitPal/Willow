/**
 * How timeline rows come and go, after the ChatGPT app (Codex's webview, willow/activity.css):
 * a row that arrives while a turn runs fades in as the app's streamed markdown does, and opening
 * or closing "Worked for" grows and shrinks the turn's work. Kept out of React state so a row's
 * flag re-renders that row alone.
 */
import { createContext, use, useSyncExternalStore } from "react";

/** `closing` marks a fold whose rows are leaving: its chevron turns at the click, as in Codex. */
export type RowMotion = "arrive" | "fold-enter" | "fold-exit" | "closing";

/** Codex's --transition-duration-basic: how long a closing fold's rows take to leave. */
export const FOLD_EXIT_MS = 150;
/**
 * A row clears its own entrance when the animation ends, whenever the list gets round to
 * painting it. One that never paints, scrolled out of the list's window, drops it after this.
 */
export const ROW_MOTION_STALE_MS = 2000;

export interface RowMotionStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly get: (rowId: string) => RowMotion | undefined;
  readonly set: (rowIds: Iterable<string>, motion: RowMotion | undefined) => void;
}

export function createRowMotionStore(): RowMotionStore {
  const motions = new Map<string, RowMotion>();
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (rowId) => motions.get(rowId),
    set: (rowIds, motion) => {
      for (const rowId of rowIds) {
        if (motion === undefined) motions.delete(rowId);
        else motions.set(rowId, motion);
      }
      for (const listener of listeners) listener();
    },
  };
}

export const RowMotionCtx = createContext<RowMotionStore | null>(null);

const subscribeNowhere = () => () => {};
const noMotion = () => undefined;

export function useRowMotion(rowId: string): RowMotion | undefined {
  const store = use(RowMotionCtx);
  return useSyncExternalStore(
    store?.subscribe ?? subscribeNowhere,
    store ? () => store.get(rowId) : noMotion,
    noMotion,
  );
}

/**
 * The rows that arrived since `known`, which it then holds too. Rows above every known one are
 * history loading in, and a row seen before is not arriving, however often it remounts.
 */
export function takeArrivedRowIds(
  rowIds: ReadonlyArray<string>,
  known: Set<string>,
): ReadonlyArray<string> {
  const arrived: string[] = [];
  let afterKnown = false;
  for (const rowId of rowIds) {
    if (known.has(rowId)) {
      afterKnown = true;
      continue;
    }
    known.add(rowId);
    if (afterKnown) arrived.push(rowId);
  }
  return arrived;
}
