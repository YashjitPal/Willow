import type { Ref, RefCallback } from "react";

/** Merges refs into one callback ref (`ET` in the bundles); cleanups returned by callback refs are honored. */
export function composeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    if (node == null) {
      for (const ref of refs) {
        if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      }
      return;
    }
    const cleanups: (() => void)[] = [];
    for (const ref of refs) {
      if (typeof ref === "function") {
        const cleanup = ref(node);
        cleanups.push(typeof cleanup === "function" ? cleanup : () => ref(null));
      } else if (ref) {
        ref.current = node;
        cleanups.push(() => {
          ref.current = null;
        });
      }
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  };
}
