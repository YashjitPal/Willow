import { useCallback, useLayoutEffect, useRef } from "react";

/** Stable callback that always runs the latest handler (React 19.1 has no `useEffectEvent`). */
export function useEvent<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
