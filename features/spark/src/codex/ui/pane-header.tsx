import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";

/** Receives the header a page publishes into its hosting pane (the `HMt` signal); `null` renders it in place. */
export const PaneHeaderSlotContext = createContext<((header: ReactNode) => void) | null>(null);

/** `K9r1`: publishes `children` as the pane header, or renders them in place when no pane provides a slot. */
export function PaneHeader({ children }: { children: ReactNode }) {
  const publish = useContext(PaneHeaderSlotContext);
  useLayoutEffect(() => {
    publish?.(children);
  }, [publish, children]);
  useLayoutEffect(() => {
    if (publish == null) return;
    return () => publish(null);
  }, [publish]);
  return publish == null ? <>{children}</> : null;
}
