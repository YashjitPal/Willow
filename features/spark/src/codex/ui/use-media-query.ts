import { useCallback, useSyncExternalStore } from "react";

const matches = (query: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

/** `qT`: whether a CSS media query currently matches, updated on change. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => matches(query),
    () => false,
  );
}
