import type { PageDocument } from "../editor/state/page-document";
import type { DotAccessEntry } from "./spaces-store";
import type { PageMetadata, SpacesPinKey } from "./types";

/** Pages as this browser keeps them between runs: every Page, its document, and what's pinned, recent and shared with bots. */
export interface SavedPages {
  pages: Record<string, PageMetadata>;
  documents: Record<string, PageDocument>;
  recentPageIds: string[];
  pinnedKeys: SpacesPinKey[];
  dotAccess: Record<string, Record<string, DotAccessEntry>>;
  welcomePageId: string | null;
}

/** Fired with the `SavedPages` the workspace folder gave this browser, for an open Pages to show. */
export const PAGES_REPLACED_EVENT = "willow:pages-replaced";

const DATABASE = "willow-pages";
const STORE = "saved";
const KEY = "pages";

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);

export function isSavedPages(value: unknown): value is SavedPages {
  return (
    isRecord(value) &&
    isRecord(value.pages) &&
    isRecord(value.documents) &&
    Array.isArray(value.recentPageIds) &&
    Array.isArray(value.pinnedKeys) &&
    isRecord(value.dotAccess) &&
    (value.welcomePageId === null || typeof value.welcomePageId === "string")
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

/** `null` until Pages are first changed here: the Pages a browser starts with are the seed, which isn't saved. Rejects when the store can't be read. */
export async function readSavedPages(): Promise<SavedPages | null> {
  const saved = await inStore<unknown>("readonly", (store) => store.get(KEY));
  return isSavedPages(saved) ? saved : null;
}

export async function writeSavedPages(saved: SavedPages): Promise<void> {
  await inStore("readwrite", (store) => store.put(saved, KEY));
}
