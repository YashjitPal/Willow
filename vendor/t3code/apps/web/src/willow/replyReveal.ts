import { useEffect, useSyncExternalStore } from "react";

/*
 * Which replies are still arriving on screen, their paced reveal or its last word fades not done,
 * so their buttons wait for them as Willow's do (features/chat ChatView `actionsReady`, which
 * waits on StreamingMarkdown's `onRevealComplete`).
 */
const revealing = new Set<string>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = () => {
  for (const listener of listeners) listener();
};

/** Counts the reply `id` as arriving while `active`, until it stops or leaves the screen. */
export function useMarkReplyRevealing(id: string | undefined, active: boolean) {
  useEffect(() => {
    if (id === undefined || !active) return;
    revealing.add(id);
    notify();
    return () => {
      revealing.delete(id);
      notify();
    };
  }, [id, active]);
}

export function useReplyRevealing(id: string): boolean {
  return useSyncExternalStore(subscribe, () => revealing.has(id));
}
