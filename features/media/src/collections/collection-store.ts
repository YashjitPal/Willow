// Flow's collections: the bound project's collections, outside React so the grid, the collection
// view and the drag system share one copy. Saved through `@willow/storage/media-collections`;
// each collection is also a folder on disk, which MediaView keeps in step (see `collectionFolder`).
// Collections nest: one inside another has the other as its `parentId`, and its folder inside the
// other's.

import { atom } from 'nanostores';
import {
  collectionFolderName,
  collectionPath,
  COLLECTIONS_CHANGED_EVENT,
  deleteCollection as deleteStoredCollection,
  listCollections,
  saveCollection,
  type StoredCollection,
} from '@willow/storage/media-collections';

export type Collection = StoredCollection;

export const UNTITLED_COLLECTION = 'Untitled collection';

export const $collections = atom<Collection[]>([]);
/** True once the bound project's collections have been read; a `?collection=` link waits for it. */
export const $collectionsLoaded = atom(false);

let bound: { projectId: string; scopeId: string } | null = null;
let loadGeneration = 0;

async function load(): Promise<void> {
  const gen = ++loadGeneration;
  const target = bound;
  if (!target) { $collections.set([]); $collectionsLoaded.set(true); return; }
  try {
    const list = await listCollections(target.projectId, target.scopeId);
    if (gen === loadGeneration) $collections.set(list);
  } catch (error) {
    console.warn('[Collections] Could not load collections:', error);
  } finally {
    if (gen === loadGeneration) $collectionsLoaded.set(true);
  }
}

// The disk reconcile adopts folders made outside the app and drops ones deleted there.
if (typeof window !== 'undefined') {
  window.addEventListener(COLLECTIONS_CHANGED_EVENT, (event) => {
    const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
    if (bound && (!projectId || projectId === bound.projectId)) void load();
  });
}

export function bindCollectionProject(projectId: string, scopeId: string): Promise<void> {
  if (bound && bound.projectId === projectId && bound.scopeId === scopeId) return load();
  bound = projectId ? { projectId, scopeId } : null;
  $collections.set([]);
  $collectionsLoaded.set(false);
  return load();
}

export const getCollection = (id: string | undefined): Collection | undefined =>
  id ? $collections.get().find((c) => c.id === id) : undefined;

const byId = (): Map<string, Collection> => new Map($collections.get().map((c) => [c.id, c]));

/** The folder holding a collection's files, from the project folder ("A", "A/B"); undefined for none. */
export const collectionFolder = (id: string | undefined): string | undefined => {
  const c = getCollection(id);
  return c ? collectionPath(c, byId()) : undefined;
};

/** The collection `id` sits in, if that one still exists; undefined at the top of the project. */
export const parentOf = (c: Collection): string | undefined =>
  (c.parentId && getCollection(c.parentId) ? c.parentId : undefined);

/** Every collection inside `id`, at any depth. */
export function descendantsOf(id: string): Collection[] {
  const all = $collections.get();
  const out: Collection[] = [];
  const seen = new Set([id]);
  for (let frontier = [id]; frontier.length;) {
    const next: string[] = [];
    for (const c of all) {
      if (c.parentId && frontier.includes(c.parentId) && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
        next.push(c.id);
      }
    }
    frontier = next;
  }
  return out;
}

const siblingFolders = (parentId: string | undefined, except?: string): string[] =>
  $collections.get().filter((c) => (c.parentId || undefined) === parentId && c.id !== except).map((c) => c.folder);

function persist(collection: Collection): void {
  if (!bound) return;
  void saveCollection(bound.projectId, collection, bound.scopeId).catch((error) => console.warn('[Collections] Could not save:', error));
}

const uid = (): string =>
  `collection-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;

/** A new collection, at the top of the project or inside `parentId`. */
export function createCollection(name = UNTITLED_COLLECTION, parentId?: string): Collection {
  const now = Date.now();
  const folder = collectionFolderName(name, siblingFolders(parentId), !parentId);
  const collection: Collection = { id: uid(), name, folder, ...(parentId ? { parentId } : {}), createdAt: now, updatedAt: now };
  $collections.set([...$collections.get(), collection]);
  persist(collection);
  return collection;
}

export function updateCollection(id: string, patch: Partial<Collection>): Collection | undefined {
  let updated: Collection | undefined;
  $collections.set($collections.get().map((c) => {
    if (c.id !== id) return c;
    updated = { ...c, ...patch, updatedAt: Date.now() };
    return updated;
  }));
  if (updated) persist(updated);
  return updated;
}

/**
 * Renames a collection and gives it the matching folder name. Returns the old and new folder paths
 * so the caller can move the folder on disk.
 */
export function renameCollection(id: string, name: string): { from: string; to: string } | null {
  const current = getCollection(id);
  const trimmed = name.trim();
  if (!current || !trimmed || trimmed === current.name) return null;
  const from = collectionFolder(id) as string;
  const folder = collectionFolderName(trimmed, siblingFolders(parentOf(current), id), !parentOf(current));
  updateCollection(id, { name: trimmed, folder });
  return { from, to: collectionFolder(id) as string };
}

/**
 * Puts a collection inside `parentId` (or back at the top with null), renaming its folder if a
 * sibling there already has the name. Returns the old and new folder paths, or null when it is
 * already there — or would end up inside itself.
 */
export function moveCollection(id: string, parentId: string | null): { from: string; to: string } | null {
  const current = getCollection(id);
  if (!current || (parentOf(current) ?? null) === parentId) return null;
  if (parentId && (parentId === id || descendantsOf(id).some((c) => c.id === parentId))) return null;
  const from = collectionFolder(id) as string;
  const folder = collectionFolderName(current.folder, siblingFolders(parentId ?? undefined, id), !parentId);
  let moved: Collection | undefined;
  $collections.set($collections.get().map((c) => {
    if (c.id !== id) return c;
    const next: Collection = { ...c, folder, updatedAt: Date.now() };
    if (parentId) next.parentId = parentId;
    else delete next.parentId;
    moved = next;
    return next;
  }));
  if (moved) persist(moved);
  return { from, to: collectionFolder(id) as string };
}

/** Removes a collection and every collection inside it; returns all of their ids. */
export function deleteCollection(id: string): string[] {
  const ids = [id, ...descendantsOf(id).map((c) => c.id)];
  $collections.set($collections.get().filter((c) => !ids.includes(c.id)));
  if (bound) for (const gone of ids) void deleteStoredCollection(bound.projectId, gone, bound.scopeId).catch(() => undefined);
  return ids;
}
