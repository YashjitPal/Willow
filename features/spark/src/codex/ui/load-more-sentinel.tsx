import { useEffect, useEffectEvent, useRef } from "react";
import { Spinner } from "./spinner";

export interface LoadMoreSentinelProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadNextPage: () => void;
  rootMargin?: string;
}

/** Spinner row that requests the next page once scrolled into view (`SJ` / `Emo` in app-initial). */
export function LoadMoreSentinel({ hasNextPage, isFetchingNextPage, onLoadNextPage, rootMargin }: LoadMoreSentinelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const loadNextPage = useEffectEvent(() => {
    if (hasNextPage && !isFetchingNextPage) onLoadNextPage();
  });
  useEffect(() => {
    const element = ref.current;
    if (element == null || !hasNextPage || isFetchingNextPage) return;
    if (typeof IntersectionObserver === "undefined") {
      loadNextPage();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          loadNextPage();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, rootMargin]);
  if (!hasNextPage && !isFetchingNextPage) return null;
  return (
    <div ref={ref} className="flex w-full justify-center py-3">
      <Spinner className="icon-xs text-secondary" />
    </div>
  );
}
