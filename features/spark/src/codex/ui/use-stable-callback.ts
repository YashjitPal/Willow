import { useCallback, useInsertionEffect, useRef } from "react";

/** Identity-stable callback that always runs the latest `callback` (`lE` in the bundles). */
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useInsertionEffect(() => {
    latest.current = callback;
  }, [callback]);
  return useCallback((...args: Args) => latest.current(...args), []);
}
