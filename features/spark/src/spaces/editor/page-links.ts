import { useMemo } from "react";
import { useDebouncedValue } from "../../codex/ui";
import { pageUri } from "../navigation";
import { useSpacesStore, type PageMetadata, type Space } from "../state";
import type { PagePageReferenceRun } from "./state/page-document";

const pathPattern = /^(page|space):\/\/([A-Za-z0-9][A-Za-z0-9._~-]{0,199})(?:#([A-Za-z0-9][A-Za-z0-9._~-]{0,199}))?$/u;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/u;
/** `Nxr`: origins whose `/spark/space/<page id>` URLs are Page links: Willow's own. */
const pageLinkOrigins = [window.location.origin];

export type PagePathTarget = { kind: "page"; id: string; blockId?: string } | { kind: "space"; id: string };

/** `JZ` (`Y1`): a `page://` or `space://` path, or a Willow `/spark/space/<page id>#<block id>` URL. */
export function parsePagePath(value: string): PagePathTarget | null {
  const match = pathPattern.exec(value);
  if (match != null) return match[1] === "space" ? (match[3] == null ? { kind: "space", id: match[2] } : null) : { kind: "page", id: match[2], blockId: match[3] };
  try {
    const url = new URL(value);
    const prefix = url.pathname.startsWith("/spark/space/") ? "/spark/space/" : "/space/";
    const id = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
    const blockId = url.hash === "" ? undefined : url.hash.slice(1);
    return pageLinkOrigins.includes(url.origin) && url.username === "" && url.password === "" && idPattern.test(id) && (blockId == null || idPattern.test(blockId))
      ? { kind: "page", id, blockId }
      : null;
  } catch {
    return null;
  }
}

/** `xS` (`W`): the Page a link destination points at. */
export function linkedPageId(href: string) {
  const target = parsePagePath(href);
  if (target?.kind === "page") return target.id;
  const id = href.startsWith("page:") ? href.slice(5) : "";
  return /^page_[A-Za-z0-9][A-Za-z0-9_-]{0,122}$/u.test(id) ? id : null;
}

/** `U`: the `pageReferenceMention` a picked Page inserts. */
export function pageReference(pageId: string, title = ""): PagePageReferenceRun {
  return { kind: "pageReference", path: pageUri(pageId), title };
}

function parentPageId(page: PageMetadata) {
  return page.parent != null && "page_id" in page.parent ? page.parent.page_id : null;
}

function byPosition(a: PageMetadata, b: PageMetadata) {
  return (a.position ?? 0) - (b.position ?? 0);
}

/** Pages of a Space from its root, breadth-first in `position` order. */
function spacePagesInTreeOrder(pages: Record<string, PageMetadata>, space: Space) {
  const members = Object.values(pages).filter((page) => page.drive_space_id === space.id || page.page_id === space.root_page_id);
  const childrenOf = (pageId: string) =>
    members
      .filter((page) => parentPageId(page) === pageId || (pageId === space.root_page_id && page.parent != null && "space_id" in page.parent && page.parent.space_id === space.id))
      .sort(byPosition);
  const ordered: PageMetadata[] = [];
  const visited = new Set<string>();
  const queue = members.filter((page) => page.page_id === space.root_page_id);
  while (queue.length > 0) {
    const page = queue.shift()!;
    if (visited.has(page.page_id)) continue;
    visited.add(page.page_id);
    ordered.push(page);
    queue.push(...childrenOf(page.page_id));
  }
  return [...ordered, ...members.filter((page) => !visited.has(page.page_id)).sort(byPosition)];
}

export interface PageLinkSearchOptions {
  enabled: boolean;
  query: string;
  sourcePageId: string;
}

/**
 * `mN` against the mock Spaces store instead of the server: once the query has been stable for 200 ms, the readable
 * Pages of the source Page's Space (Personal Pages when it has none) whose titles contain it, without the source Page.
 */
export function usePageLinkSearch({ enabled, query, sourcePageId }: PageLinkSearchOptions) {
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, 200);
  const pages = useSpacesStore((state) => state.pages);
  const spaces = useSpacesStore((state) => state.spaces);
  const source = pages[sourcePageId];
  const active = enabled && source != null && source.access.can_read && source.deleted_at == null;
  const spaceId = source?.drive_space_id ?? null;
  const items = useMemo(() => {
    if (!active || trimmed !== settled) return undefined;
    const space = spaceId == null ? undefined : spaces.find((candidate) => candidate.id === spaceId);
    const candidates = space != null ? spacePagesInTreeOrder(pages, space) : Object.values(pages).filter((page) => page.drive_space_id == null);
    const needle = settled.toLocaleLowerCase();
    return candidates.filter(
      (page) =>
        (page.title ?? "").toLocaleLowerCase().includes(needle) &&
        page.site_project_id == null &&
        page.page_id !== sourcePageId &&
        page.deleted_at == null &&
        page.access.can_read,
    );
  }, [active, pages, settled, sourcePageId, spaceId, spaces, trimmed]);
  return { items, isFetching: active && trimmed !== settled };
}

/** `UY`: the Space a result belongs to, through its Space binding or its ancestors. */
export function pageSpace(page: PageMetadata, pages: Record<string, PageMetadata>, spaces: Space[]) {
  let current = page;
  const seen = new Set([page.page_id]);
  let space = spaces.find((candidate) => candidate.root_page_id === page.page_id || page.drive_space_id === candidate.id);
  for (let parentId = parentPageId(current); space == null && parentId != null; parentId = parentPageId(current)) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    space = spaces.find((candidate) => candidate.root_page_id === parentId);
    if (space != null) break;
    const parent = pages[parentId];
    if (parent == null) break;
    current = parent;
    space = spaces.find((candidate) => parent.drive_space_id === candidate.id);
  }
  return space;
}
