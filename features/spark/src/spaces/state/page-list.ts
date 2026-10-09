import { useMemo } from "react";
import { useSpacesStore } from "./spaces-store";
import type { PageMetadata } from "./types";

export interface PageListEntry {
  page: PageMetadata;
  /** The Page this one is a subpage of, if any. */
  parentPage?: PageMetadata;
}

/** page-data chunk `r`: readable Pages, newest first, each with the Page it sits in. */
export function usePageListEntries(): PageListEntry[] | undefined {
  const pages = useSpacesStore((state) => state.pages);
  const pagesReady = useSpacesStore((state) => state.pagesStatus === "ready");
  return useMemo(() => {
    if (!pagesReady) return undefined;
    return Object.values(pages)
      .filter((page) => page.access.can_read && page.deleted_at == null)
      .map((page) => {
        const parentId = page.parent != null && "page_id" in page.parent ? page.parent.page_id : null;
        const parentPage = parentId == null ? undefined : pages[parentId];
        return { page, parentPage: parentPage?.deleted_at == null ? parentPage : undefined };
      })
      .sort((a, b) => Date.parse(b.page.updated_at) - Date.parse(a.page.updated_at));
  }, [pages, pagesReady]);
}

/** Top-level Pages, pinned first and then most recently updated: the cards on the Pages home. */
export function useTopLevelPages(pinnedKeys: readonly string[]) {
  const pages = useSpacesStore((state) => state.pages);
  return useMemo(
    () =>
      Object.values(pages)
        .filter((page) => page.parent == null && page.deleted_at == null && page.access.can_read)
        .sort(
          (a, b) =>
            Number(pinnedKeys.includes(`page:${b.page_id}`)) - Number(pinnedKeys.includes(`page:${a.page_id}`)) ||
            Date.parse(b.updated_at) - Date.parse(a.updated_at),
        ),
    [pages, pinnedKeys],
  );
}
