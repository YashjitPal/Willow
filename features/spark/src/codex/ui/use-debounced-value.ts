import { useEffect, useState } from "react";

/** `a2t` (app-initial `usePL`): `value` once it has stayed unchanged for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
