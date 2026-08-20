import { useEffect, useMemo, useState, type RefObject } from 'react';

interface WindowedTask {
  id: string;
}

interface UseSparkTaskWindowOptions<T extends WindowedTask> {
  items: readonly T[];
  scrollRef?: RefObject<HTMLElement | null>;
  /** Rows that must remain mounted while a menu/dialog/detail is using them. */
  forcedIds?: readonly string[];
  /** Approximate row height used only to choose the first render budget. */
  estimatedRowHeight?: number;
  chunkSize?: number;
}

/**
 * Render-budget window for Spark lists.
 *
 * This mirrors Chat Recents' bounded rendering: the index remains complete, but
 * only an initial viewport-sized slice is mounted. More rows are mounted as the
 * list approaches its end. It deliberately does not pretend to lazy-load task
 * bodies; that is a separate persistence boundary.
 */
export const useSparkTaskWindow = <T extends WindowedTask>({
  items,
  scrollRef,
  forcedIds = [],
  estimatedRowHeight = 72,
  chunkSize = 12,
}: UseSparkTaskWindowOptions<T>): readonly T[] => {
  const [limit, setLimit] = useState(() => {
    if (typeof window === 'undefined') return chunkSize;
    return Math.max(chunkSize, Math.ceil(window.innerHeight / estimatedRowHeight) + 4);
  });

  const itemKey = items.map((item) => item.id).join('|');
  useEffect(() => {
    setLimit((current) => Math.min(current, Math.max(chunkSize, Math.ceil(window.innerHeight / estimatedRowHeight) + 4)));
  }, [itemKey, chunkSize, estimatedRowHeight]);

  useEffect(() => {
    const element = scrollRef?.current
      ?? document.querySelector<HTMLElement>('.spark-studio-scroll');
    if (!element) return;

    const onScroll = () => {
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining < 320) setLimit((current) => Math.min(items.length, current + chunkSize));
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => element.removeEventListener('scroll', onScroll);
  }, [items.length, chunkSize, scrollRef]);

  return useMemo(() => {
    if (limit >= items.length) return items;
    const forced = new Set(forcedIds.filter(Boolean));
    return items.filter((item, index) => index < limit || forced.has(item.id));
  }, [items, limit, forcedIds]);
};
