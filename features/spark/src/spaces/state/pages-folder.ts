import { syncedFolderKeys, type SyncedFolderDescriptor, type SyncedItem } from "@willow/storage/local-sync";
import type { PageDocument } from "../editor/state/page-document";
import type { SavedPages } from "./pages-saved";
import type { PageMetadata } from "./types";

export const PAGES_FOLDER = "Spark/Pages";

/** `_pages.json`: which Pages there are, and what's pinned, recent and shared with bots. Each Page is `<page id>.json`. */
const LIST_ID = "_pages";

interface PagesList {
  pageIds: string[];
  recentPageIds: SavedPages["recentPageIds"];
  pinnedKeys: SavedPages["pinnedKeys"];
  dotAccess: SavedPages["dotAccess"];
  welcomePageId: string | null;
}

interface PageFile {
  page: PageMetadata;
  document: PageDocument | null;
}

/** Where this browser keeps its Pages, and how an open Pages hears the folder replaced them. */
export interface PagesStore {
  read: () => Promise<SavedPages | null>;
  write: (saved: SavedPages) => Promise<void>;
  replaced: (saved: SavedPages) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const serialize = (value: unknown) => JSON.stringify(value, null, 2);

function parseList(text: string): PagesList | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !Array.isArray(value.pageIds)) return null;
    return {
      pageIds: value.pageIds.filter((id): id is string => typeof id === "string"),
      recentPageIds: Array.isArray(value.recentPageIds) ? value.recentPageIds.filter((id): id is string => typeof id === "string") : [],
      pinnedKeys: Array.isArray(value.pinnedKeys) ? (value.pinnedKeys.filter((key) => typeof key === "string") as PagesList["pinnedKeys"]) : [],
      dotAccess: isRecord(value.dotAccess) ? (value.dotAccess as PagesList["dotAccess"]) : {},
      welcomePageId: typeof value.welcomePageId === "string" ? value.welcomePageId : null,
    };
  } catch {
    return null;
  }
}

function parsePage(text: string): PageFile | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !isRecord(value.page) || typeof value.page.page_id !== "string") return null;
    const document = isRecord(value.document) && Array.isArray(value.document.blocks) ? (value.document as unknown as PageDocument) : null;
    return { page: value.page as unknown as PageMetadata, document };
  } catch {
    return null;
  }
}

export function pagesToItems(saved: SavedPages): SyncedItem[] {
  const pageIds = Object.keys(saved.pages).sort();
  const list: PagesList = {
    pageIds,
    recentPageIds: saved.recentPageIds,
    pinnedKeys: saved.pinnedKeys,
    dotAccess: saved.dotAccess,
    welcomePageId: saved.welcomePageId,
  };
  return [
    { id: LIST_ID, contents: serialize(list) },
    ...pageIds.map((id) => ({ id, contents: serialize({ page: saved.pages[id], document: saved.documents[id] ?? null } satisfies PageFile) })),
  ];
}

/**
 * The folder's files as Pages. A Page the engine set aside as a conflict copy (`<id> (Disk conflict …)`)
 * comes back as a Page of its own under a new id, so both versions stay readable and openable.
 */
export function pagesFromItems(items: SyncedItem[]): SavedPages {
  const list = items.find((item) => item.id === LIST_ID);
  const listed = list ? parseList(list.contents) : null;
  const pages: SavedPages["pages"] = {};
  const documents: SavedPages["documents"] = {};
  for (const item of items) {
    if (item.id === LIST_ID || item.id.startsWith(`${LIST_ID} `)) continue;
    const file = parsePage(item.contents);
    if (!file) continue;
    let { page, document } = file;
    if (page.page_id !== item.id) {
      const pageId = `${page.page_id}-copy-${Date.now().toString(36)}`;
      page = { ...page, page_id: pageId, title: `${page.title?.trim() || "Untitled"} (conflict copy)` };
      if (document) document = { ...document, pageId };
    }
    pages[page.page_id] = page;
    if (document) documents[page.page_id] = document;
  }
  const isPage = (id: string) => pages[id] != null;
  return {
    pages,
    documents,
    recentPageIds: (listed?.recentPageIds ?? []).filter(isPage),
    pinnedKeys: (listed?.pinnedKeys ?? []).filter((key) => !key.startsWith("page:") || isPage(key.slice("page:".length))),
    dotAccess: Object.fromEntries(Object.entries(listed?.dotAccess ?? {}).filter(([id]) => isPage(id))),
    welcomePageId: listed?.welcomePageId != null && isPage(listed.welcomePageId) ? listed.welcomePageId : null,
  };
}

/** The files this browser has synced with this folder: the driver keeps a hash of each. */
function syncedIds(scopeId: string): string[] {
  try {
    const hashes: unknown = JSON.parse(localStorage.getItem(syncedFolderKeys(PAGES_FOLDER, scopeId).hashes) || "null");
    return isRecord(hashes) ? Object.keys(hashes) : [];
  } catch {
    return [];
  }
}

/** `Spark/Pages`: one file per Page and `_pages.json` beside them. */
export function pagesFolder(store: PagesStore): SyncedFolderDescriptor {
  return {
    folder: PAGES_FOLDER,
    extension: ".json",

    async readLocal({ scopeId, readDisk }) {
      const saved = await store.read();
      const synced = syncedIds(scopeId);
      /*
       * A browser starting over (a reinstall, Willow's storage cleared) holds the seed, or nothing,
       * or Pages changed before the folder was first read — the seed's dates differ on every run, so
       * handing those to the engine would set every Page of the folder aside as a conflict copy. So
       * the folder's Pages are taken as they stand, and only a Page this browser alone has is added.
       * The same holds when this browser's saved Pages are gone after it synced: none of the folder's
       * may read as deleted, `_pages.json` or not. An unreadable file throws, and the pass waits.
       */
      if (readDisk && (!saved || synced.length === 0)) {
        const listText = await readDisk(LIST_ID);
        const listed = listText === null ? null : parseList(listText);
        const pageIds = listed
          ? listed.pageIds
          : !saved && synced.length > 0
            ? synced.filter((id) => id !== LIST_ID && !id.startsWith(`${LIST_ID} `))
            : null;
        if (pageIds) {
          const folderItems: SyncedItem[] = [];
          for (const id of pageIds) {
            const contents = await readDisk(id);
            if (contents !== null) folderItems.push({ id, contents });
          }
          const taken = pagesFromItems([...(listText !== null && listed ? [{ id: LIST_ID, contents: listText }] : []), ...folderItems]);
          let added = false;
          for (const [id, page] of Object.entries(saved?.pages ?? {})) {
            if (taken.pages[id]) continue;
            taken.pages[id] = page;
            const document = saved?.documents[id];
            if (document) taken.documents[id] = document;
            added = true;
          }
          await store.write(taken);
          store.replaced(taken);
          const asOnDisk = new Map(folderItems.map((item) => [item.id, item.contents]));
          if (listText !== null && listed && !added) asOnDisk.set(LIST_ID, listText);
          return pagesToItems(taken).map((item) => ({ id: item.id, contents: asOnDisk.get(item.id) ?? item.contents }));
        }
      }
      return saved ? pagesToItems(saved) : [];
    },

    async applyRemote(items) {
      const saved = pagesFromItems(items);
      await store.write(saved);
      store.replaced(saved);
    },
  };
}
