import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useHarnessProvidersSync, useWillowScope } from "./harness";

const PLACES_KEY = "willow-agents:places";

const readPlaces = (): Map<string, string> => {
  try {
    return new Map(Object.entries(JSON.parse(sessionStorage.getItem(PLACES_KEY) ?? "{}") as Record<string, string>));
  } catch {
    return new Map();
  }
};

/**
 * One page serves every agent tab, so each tab keeps its own place: switching to a tab returns to
 * where it was left, or to a new thread the first time.
 */
export function WillowScopeRoutes() {
  useHarnessProvidersSync();
  const scope = useWillowScope();
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const places = useRef(readPlaces());
  const lastHref = useRef(href);
  const previousScope = useRef(scope);

  useEffect(() => {
    lastHref.current = href;
  }, [href]);

  useEffect(() => {
    const previous = previousScope.current;
    if (previous === scope) return;
    previousScope.current = scope;
    if (previous) places.current.set(previous, lastHref.current);
    try {
      sessionStorage.setItem(PLACES_KEY, JSON.stringify(Object.fromEntries(places.current)));
    } catch {
      // The places only last for the session anyway.
    }
    if (scope) router.history.replace(places.current.get(scope) ?? "/");
  }, [router, scope]);

  return null;
}
