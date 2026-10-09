import { useMemo } from "react";
import { resolveDot, useDots } from "../willow/dot/dot-identity";
import { useDotStore, type Dot } from "../willow/dot/state/dot-store";
import { descendantPageIds, useSpacesStore, type DotAccessEntry } from "./spaces-store";
import type { DotRole, PageMetadata } from "./types";

export interface DotOnPage {
  dot: Dot;
  role: DotRole;
  /** The ancestor Page the access comes from; `null` when it is set on this Page. */
  inheritedFrom: string | null;
}

function parentId(page: PageMetadata | undefined) {
  return page?.parent != null && "page_id" in page.parent ? page.parent.page_id : null;
}

/** The Page and its ancestors, nearest first. */
export function pageLineage(pages: Record<string, PageMetadata>, pageId: string) {
  const lineage: string[] = [];
  for (let id: string | null = pageId; id != null && !lineage.includes(id); id = parentId(pages[id])) lineage.push(id);
  return lineage;
}

/** Each bot's access on a Page: the nearest explicit entry along its lineage decides, and `none` blocks inheritance. */
export function dotsOnPage(
  pages: Record<string, PageMetadata>,
  dotAccess: Record<string, Record<string, DotAccessEntry>>,
  dots: readonly Dot[],
  pageId: string,
): DotOnPage[] {
  const decided = new Set<string>();
  const result: DotOnPage[] = [];
  for (const id of pageLineage(pages, pageId)) {
    for (const [key, entry] of Object.entries(dotAccess[id] ?? {})) {
      const dot = resolveDot(dots, key);
      if (dot == null || decided.has(dot.conversationId)) continue;
      decided.add(dot.conversationId);
      if (entry !== "none") result.push({ dot, role: entry, inheritedFrom: id === pageId ? null : id });
    }
  }
  return result;
}

export function useDotsOnPage(pageId: string | null | undefined) {
  const dots = useDots();
  const pages = useSpacesStore((state) => state.pages);
  const dotAccess = useSpacesStore((state) => state.dotAccess);
  return useMemo(() => (pageId == null ? [] : dotsOnPage(pages, dotAccess, dots, pageId)), [dotAccess, dots, pageId, pages]);
}

/** The bots that work anywhere in a Page's tree: on it, or on any of its subpages. */
export function useDotsInTree(pageId: string) {
  const dots = useDots();
  const pages = useSpacesStore((state) => state.pages);
  const dotAccess = useSpacesStore((state) => state.dotAccess);
  return useMemo(() => {
    const found = new Map<string, Dot>();
    for (const id of [pageId, ...descendantPageIds(pages, pageId)]) {
      if (pages[id]?.deleted_at != null) continue;
      for (const { dot } of dotsOnPage(pages, dotAccess, dots, id)) if (!found.has(dot.conversationId)) found.set(dot.conversationId, dot);
    }
    return [...found.values()];
  }, [dotAccess, dots, pageId, pages]);
}

/** A bot asked to help on a Page joins it as an editor, unless it already has access there. */
export function addDotToPage(pageId: string, dotId: string) {
  const { pages, dotAccess, setDotAccess } = useSpacesStore.getState();
  if (dotsOnPage(pages, dotAccess, useDotStore.getState().dots, pageId).some(({ dot }) => dot.conversationId === dotId)) return;
  setDotAccess(pageId, dotId, "editor");
}
