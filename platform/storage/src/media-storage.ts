/**
 * Willow Media IndexedDB Service
 * Stores large media item histories (including heavy base64 data URLs)
 * to bypass browser-enforced 5MB localStorage quotas.
 */

import { renameCodeSessions } from './indexeddb/willow-db';
import { readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';

const DB_NAME = 'WillowMediaDB';
const STORE_NAME = 'project_media';
const COVERS_STORE = 'project_covers';
export const PROJECT_COVERS_UPDATED_EVENT = 'willow_project_covers_updated';
const DEFAULT_MEDIA_SCOPE = 'signed-out::browser::My Willow';
const LEGACY_MEDIA_OWNER_KEY = 'willow_media_legacy_owner';

let activeMediaScopeId = DEFAULT_MEDIA_SCOPE;
let mediaIndexQueue: Promise<void> = Promise.resolve();
const coverQueues = new Map<string, Promise<void>>();
const mediaRecordQueues = new Map<string, Promise<void>>();
let lastAllocatedMediaTimestamp = 0;

export function allocateMediaBatchTimestamps(count: number): number[] {
  const safeCount = Math.max(1, Math.floor(count));
  const newest = Math.max(Date.now(), lastAllocatedMediaTimestamp + safeCount);
  lastAllocatedMediaTimestamp = newest;
  return Array.from({ length: safeCount }, (_, index) => newest - index);
}

export function compareMediaItemsNewestFirst(a: any, b: any): number {
  const timestampDelta = (b?.timestamp || 0) - (a?.timestamp || 0);
  if (timestampDelta !== 0) return timestampDelta;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/** Keep browser media metadata isolated by authenticated user, root and workspace. */
export function setMediaStorageScope(scopeId: string): void {
  const nextScopeId = scopeId || DEFAULT_MEDIA_SCOPE;
  if (activeMediaScopeId === nextScopeId) return;
  activeMediaScopeId = nextScopeId;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('willow_media_updated'));
    notifyProjectCoversUpdated();
    void rebuildMediaIndex().catch((error) => {
      console.warn('[MediaStorage] Failed to rebuild the scoped media index:', error);
    });
  }
}

function mediaRecordKey(projectId: string, scopeId = activeMediaScopeId): string {
  return `scope:${encodeURIComponent(scopeId)}:project:${projectId}`;
}

function mediaRecordPrefix(scopeId = activeMediaScopeId): string {
  return `scope:${encodeURIComponent(scopeId)}:project:`;
}

function projectIdFromMediaKey(key: IDBValidKey, scopeId: string): string | null {
  if (typeof key !== 'string') return null;
  const prefix = mediaRecordPrefix(scopeId);
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function ownsLegacyMedia(scopeId: string): boolean {
  if (typeof localStorage === 'undefined' || scopeId.startsWith('signed-out::')) return false;
  const owner = localStorage.getItem(LEGACY_MEDIA_OWNER_KEY);
  if (owner) return owner === scopeId;
  localStorage.setItem(LEGACY_MEDIA_OWNER_KEY, scopeId);
  return true;
}

async function withMediaIndexLock(scopeId: string, operation: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks?.request) {
    await locks.request(`willow-media-index:${scopeId}`, operation);
    return;
  }
  const queued = mediaIndexQueue.catch(() => undefined).then(operation);
  mediaIndexQueue = queued.catch(() => undefined);
  await queued;
}

async function withCoverLock(recordKey: string, operation: () => Promise<void>): Promise<void> {
  const runLocally = async () => {
    const previous = coverQueues.get(recordKey) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    coverQueues.set(recordKey, current);
    try {
      await current;
    } finally {
      if (coverQueues.get(recordKey) === current) coverQueues.delete(recordKey);
    }
  };
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks?.request) {
    await locks.request(`willow-project-cover:${recordKey}`, runLocally);
  } else {
    await runLocally();
  }
}

async function withMediaRecordLock(recordKey: string, operation: () => Promise<void>): Promise<void> {
  const runLocally = async () => {
    const previous = mediaRecordQueues.get(recordKey) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    mediaRecordQueues.set(recordKey, current);
    try {
      await current;
    } finally {
      if (mediaRecordQueues.get(recordKey) === current) mediaRecordQueues.delete(recordKey);
    }
  };
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks?.request) await locks.request(`willow-project-media:${recordKey}`, runLocally);
  else await runLocally();
}

function notifyProjectCoversUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PROJECT_COVERS_UPDATED_EVENT));
  }
}

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(COVERS_STORE)) {
        db.createObjectStore(COVERS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save media items list for a specific project (keyed by projectId).
 *
 * DISK-AS-SOURCE: for any item already written to disk (`isSavedToFS && fsName`)
 * the heavy bytes are NOT stored here — the `url` is dropped, leaving only
 * lightweight metadata. The real PNG/MP4 on disk is the source of truth and the
 * gallery re-hydrates a streaming blob: URL from it on load (see MediaView +
 * LocalFSContext.loadLocalFSMediaUrl). Browser-only items (no folder yet) keep
 * their base64 `url` so they still work without a connected folder.
 */
async function saveProjectMediaInner(projectId: string, mediaItems: any[], scopeId: string): Promise<void> {
    const recordKey = mediaRecordKey(projectId, scopeId);
    const items = Array.isArray(mediaItems) ? mediaItems : [];
    // Realtime, lightweight media INDEX in localStorage. The heavy image/video
    // BYTES can never fit in localStorage (~5MB cap) — they live in IndexedDB /
    // on disk. But we keep a small per-project record here (counts + timestamp)
    // so media presence is visible & synced in localStorage in realtime, and so
    // the UI can tell which projects have media without touching IndexedDB.
    const toStore = items.map((m: any) => {
      if (!m) return m;
      let out = (m.isSavedToFS && m.fsName) ? { ...m, url: '' } : m;
      // blob: object URLs are session-scoped (hydrated from disk files) — they
      // are dead after a reload, so never persist them as media/audio bytes.
      if (typeof out.url === 'string' && out.url.startsWith('blob:')) {
        out = out === m ? { ...m, url: '' } : { ...out, url: '' };
      }
      if (typeof out.audioUrl === 'string' && out.audioUrl.startsWith('blob:')) {
        out = out === m ? { ...m, audioUrl: '' } : { ...out, audioUrl: '' };
      }
      return out;
    });
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(toStore, recordKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save project media'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving project media was aborted'));
    });
    await updateMediaIndex(projectId, items, scopeId);
}

export async function saveProjectMedia(projectId: string, mediaItems: any[], scopeId = activeMediaScopeId): Promise<void> {
  const recordKey = mediaRecordKey(projectId, scopeId);
  await withMediaRecordLock(recordKey, () => saveProjectMediaInner(projectId, mediaItems, scopeId));
}

const MEDIA_INDEX_KEY_PREFIX = 'willow_media_index:';
const MEDIA_INDEX_META_KEY_PREFIX = 'willow_media_index_meta:';
const MEDIA_INDEX_SCHEMA_VERSION = 1;

interface MediaIndexMeta {
  schemaVersion: number;
  revision: number;
  changed: Record<string, number>;
}

function mediaIndexKey(scopeId: string): string {
  return MEDIA_INDEX_KEY_PREFIX + encodeURIComponent(scopeId);
}

function mediaIndexMetaKey(scopeId: string): string {
  return MEDIA_INDEX_META_KEY_PREFIX + encodeURIComponent(scopeId);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === mediaIndexKey(activeMediaScopeId) || event.key === mediaIndexMetaKey(activeMediaScopeId)) {
      window.dispatchEvent(new Event('willow_media_updated'));
    }
  });
}

function readMediaIndexMeta(scopeId: string): MediaIndexMeta {
  try {
    const value = JSON.parse(localStorage.getItem(mediaIndexMetaKey(scopeId)) || 'null');
    if (value?.schemaVersion === MEDIA_INDEX_SCHEMA_VERSION && typeof value.revision === 'number') {
      return { schemaVersion: MEDIA_INDEX_SCHEMA_VERSION, revision: value.revision, changed: value.changed || {} };
    }
  } catch {}
  return { schemaVersion: MEDIA_INDEX_SCHEMA_VERSION, revision: 0, changed: {} };
}

/** Update the realtime localStorage media index for one project + notify the UI. */
async function updateMediaIndex(projectId: string, items: any[], scopeId = activeMediaScopeId): Promise<void> {
  if (typeof window === 'undefined') return;
  await withMediaIndexLock(scopeId, async () => {
    try {
      const completed = (items || []).filter((m: any) => m && m.status === 'completed');
      const raw = localStorage.getItem(mediaIndexKey(scopeId));
      const idx = raw ? JSON.parse(raw) : {};
      if (completed.length === 0) {
        delete idx[projectId];
      } else {
        idx[projectId] = {
          count: completed.length,
          images: completed.filter((m: any) => m.kind === 'image').length,
          videos: completed.filter((m: any) => m.kind === 'video').length,
          updatedAt: Date.now(),
        };
      }
      const meta = readMediaIndexMeta(scopeId);
      meta.revision += 1;
      meta.changed[projectId] = meta.revision;
      localStorage.setItem(mediaIndexKey(scopeId), JSON.stringify(idx));
      localStorage.setItem(mediaIndexMetaKey(scopeId), JSON.stringify(meta));
      if (activeMediaScopeId === scopeId) window.dispatchEvent(new Event('willow_media_updated'));
    } catch (error) {
      console.warn('[MediaStorage] Media saved, but the lightweight index could not be updated:', error);
    }
  });
}

/** Read the realtime media index (projectId -> { count, images, videos, updatedAt }). */
export function getMediaIndex(): Record<string, { count: number; images: number; videos: number; updatedAt: number }> {
  try {
    const raw = localStorage.getItem(mediaIndexKey(activeMediaScopeId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** True if a project has any media (per the realtime index). */
export function projectHasMedia(projectId: string): boolean {
  return (getMediaIndex()[projectId]?.count || 0) > 0;
}

/**
 * Rebuild the localStorage media index from IndexedDB (run once on app mount).
 * Ensures projects that already have media are reflected in the index without
 * having to open each one. Keyed by projectId.
 */
export async function rebuildMediaIndex(): Promise<void> {
    const scopeId = activeMediaScopeId;
    const startMeta = readMediaIndexMeta(scopeId);
    const db = await getDB();
    const entries = await new Promise<Record<string, any[]>>((resolve, reject) => {
      const out: Record<string, any[]> = {};
      const tx = db.transaction(STORE_NAME, 'readonly');
      const c = tx.objectStore(STORE_NAME).openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (cur) {
          const projectId = projectIdFromMediaKey(cur.key, scopeId);
          if (projectId) out[projectId] = (cur.value as any[]) || [];
          cur.continue();
        }
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error ?? c.error ?? new Error('Failed to rebuild media index'));
      tx.onabort = () => reject(tx.error ?? new Error('Media index rebuild was aborted'));
    });
    const idx: Record<string, any> = {};
    for (const [pid, items] of Object.entries(entries)) {
      const completed = (Array.isArray(items) ? items : []).filter((m: any) => m && m.status === 'completed');
      if (completed.length > 0) {
        idx[pid] = {
          count: completed.length,
          images: completed.filter((m: any) => m.kind === 'image').length,
          videos: completed.filter((m: any) => m.kind === 'video').length,
          updatedAt: Date.now(),
        };
      }
    }
    await withMediaIndexLock(scopeId, async () => {
      const currentMeta = readMediaIndexMeta(scopeId);
      if (currentMeta.revision !== startMeta.revision) {
        const raw = localStorage.getItem(mediaIndexKey(scopeId));
        const current = raw ? JSON.parse(raw) : {};
        for (const [projectId, changedAt] of Object.entries(currentMeta.changed)) {
          if (changedAt <= startMeta.revision) continue;
          if (current[projectId]) idx[projectId] = current[projectId];
          else delete idx[projectId];
        }
      }
      localStorage.setItem(mediaIndexKey(scopeId), JSON.stringify(idx));
      localStorage.setItem(mediaIndexMetaKey(scopeId), JSON.stringify(currentMeta));
    });
    if (activeMediaScopeId === scopeId) window.dispatchEvent(new Event('willow_media_updated'));
}

/**
 * Load media items list for a specific project with automatic localStorage migration
 */
export async function loadProjectMedia(projectId: string, scopeId = activeMediaScopeId): Promise<any[]> {
    const recordKey = mediaRecordKey(projectId, scopeId);
    const db = await getDB();
    const diskItems = await new Promise<any[] | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(recordKey);
      let result: any[] | undefined;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Failed to load project media'));
      tx.onabort = () => reject(tx.error ?? new Error('Loading project media was aborted'));
    });

    // A present record is authoritative — even an empty array, which means the
    // user deleted all media. Only fall through to the legacy-localStorage
    // migration when there is NO record at all. Previously an empty array was
    // treated as "no data" and the migration resurrected deleted media.
    if (diskItems !== undefined) {
      return diskItems;
    }

    // The old database used projectId alone. Assign that global record to one
    // authenticated scope only, then remove it after the scoped commit.
    if (ownsLegacyMedia(scopeId)) {
      const legacyItems = await new Promise<any[] | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(projectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (legacyItems !== undefined) {
        await saveProjectMedia(projectId, legacyItems, scopeId);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(projectId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        return legacyItems;
      }
    }

    // Migration Fallback: Load from localStorage if present
    const key = `willow_project_media_${projectId}`;
    const stored = ownsLegacyMedia(scopeId) ? localStorage.getItem(key) : null;
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.length > 0) {
        // Save to IndexedDB so it's migrated. Remove the source only after the
        // destination transaction and its index update have both succeeded.
        await saveProjectMedia(projectId, parsed, scopeId);
        localStorage.removeItem(key);
        return parsed;
      }
    }

    return [];
}

/**
 * Save a project cover image (base64 data URL) in IndexedDB
 */
/**
 * Save a project cover. Converts blob: URLs and external video URLs to base64
 * data URLs so they persist across reloads (videos with API keys expire).
 */
export async function saveProjectCover(projectId: string, coverUrl: string, scopeId = activeMediaScopeId): Promise<void> {
  const recordKey = mediaRecordKey(projectId, scopeId);
  await withCoverLock(recordKey, async () => {
    let urlToSave = coverUrl;

    // Covers must be self-contained so they survive reload. Anything that isn't
    // already an inline data: URL — i.e. blob: object URLs, or external http(s)
    // URLs such as expiring video links — is fetched and converted to base64.
    // (Generated images are already data: URLs; only video covers are external.)
    const needsInlining = coverUrl.startsWith('blob:') ||
      coverUrl.startsWith('http://') || coverUrl.startsWith('https://');

    if (needsInlining) {
      const blob = await fetch(coverUrl).then(r => r.blob());
      urlToSave = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readwrite');
      const store = tx.objectStore(COVERS_STORE);
      store.put(urlToSave, recordKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    // Project surfaces often start loading while a cover is still being
    // generated/hydrated. Publish only after the transaction commits so they
    // cannot get stuck on an earlier snapshot that did not include this cover.
    if (activeMediaScopeId === scopeId) notifyProjectCoversUpdated();
  });
}

/**
 * Load a project cover image from IndexedDB
 */
export async function loadProjectCover(projectId: string, scopeId = activeMediaScopeId): Promise<string | null> {
  try {
    const recordKey = mediaRecordKey(projectId, scopeId);
    const db = await getDB();
    const scopedCover = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readonly');
      const store = tx.objectStore(COVERS_STORE);
      const request = store.get(recordKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (scopedCover !== undefined) return scopedCover;
    if (!ownsLegacyMedia(scopeId)) return null;
    const legacyCover = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readonly');
      const request = tx.objectStore(COVERS_STORE).get(projectId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (legacyCover === undefined) return null;
    await saveProjectCover(projectId, legacyCover, scopeId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readwrite');
      tx.objectStore(COVERS_STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return legacyCover;
  } catch (err) {
    return null;
  }
}

/**
 * Delete all IndexedDB data for a project (media items + cover)
 */
export async function deleteProjectData(projectId: string, scopeId = activeMediaScopeId): Promise<void> {
  const recordKey = mediaRecordKey(projectId, scopeId);
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, COVERS_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).delete(recordKey);
    tx.objectStore(COVERS_STORE).delete(recordKey);
    if (ownsLegacyMedia(scopeId)) {
      tx.objectStore(STORE_NAME).delete(projectId);
      tx.objectStore(COVERS_STORE).delete(projectId);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete project data'));
    tx.onabort = () => reject(tx.error ?? new Error('Deleting project data was aborted'));
  });
  // Only publish deletion after both authoritative records commit atomically.
  await updateMediaIndex(projectId, [], scopeId);
  if (ownsLegacyMedia(scopeId)) localStorage.removeItem(`willow_project_media_${projectId}`);
  if (activeMediaScopeId === scopeId) notifyProjectCoversUpdated();
}

/**
 * Return the set of projectIds that have stored media items in IndexedDB.
 * Only MediaView writes to project_media, so this is a reliable "is a media
 * project" signal (project covers are NOT, since code screenshots use them too).
 */
export async function getMediaProjectIds(): Promise<Set<string>> {
  try {
    const scopeId = activeMediaScopeId;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      const ids = new Set<string>();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const projectId = projectIdFromMediaKey(cursor.key, scopeId);
          const items = cursor.value;
          if (projectId && Array.isArray(items) && items.length > 0) {
            ids.add(projectId);
          }
          cursor.continue();
        } else {
          resolve(ids);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return new Set();
  }
}

/**
 * Fallback project-kind tagging that runs on app mount.
 *
 * IMPORTANT: This only FILLS IN tags for projects that have no `kind` yet. It
 * never overrides an existing tag, because the disk sync
 * (LocalFSContext.syncProjectsFromDisk) is the authoritative source for any
 * project that lives in a connected workspace folder. This fallback exists for
 * browser-only projects, or for the brief window before the folder is
 * authorized on a fresh load.
 *
 * Heuristic for an untagged project: it's `media` if it has media items in
 * IndexedDB or carries a generic/auto-generated name; otherwise `code`.
 */
export async function autoDetectProjectKinds(): Promise<boolean> {
  try {
    const list = readProjectRegistry() as any[];
    if (!Array.isArray(list) || list.length === 0) return false;

    // Only act when something is actually untagged — never override disk tags.
    const needsTag = list.some((p: any) => p && !p.kind);
    if (!needsTag) return false;

    const mediaIds = await getMediaProjectIds();

    let changed = false;
    const updated = list.map((p: any) => {
      if (!p || p.kind) return p; // leave already-tagged projects untouched
      changed = true;
      const isGenericMediaName =
        typeof p.name === 'string' &&
        (p.name.startsWith('Project #') ||
          // Both the legacy "10:15" and the filesystem-safe "10.15" time formats.
          /^\w{3}\s+\d{1,2},\s+\d{1,2}[:.]\d{2}\s+(AM|PM)$/.test(p.name));
      const kind: 'media' | 'code' = (mediaIds.has(p.id) || isGenericMediaName) ? 'media' : 'code';
      return { ...p, kind };
    });

    if (changed) {
      writeProjectRegistry(updated);
      window.dispatchEvent(new Event('willow_projects_updated'));
      return true;
    }

    return false;
  } catch (err) {
    console.error('Auto-detect project kinds failed:', err);
    return false;
  }
}

/**
 * One-time repair of project names containing filesystem-illegal characters.
 *
 * Default project names used to embed a colon ("Jul 11, 10:15 AM"), which is a
 * reserved character on Windows — every getDirectoryHandle for such a name
 * threw "Name is not allowed" inside fail-soft catches, so the project
 * SILENTLY never got a disk folder (it only appeared in the connected folder
 * once the user manually renamed it). New names are generated safe; this
 * migrates existing broken ones: ':' → '.', other reserved chars stripped,
 * deduped against the registry.
 *
 * Only touches rows NOT marked onDisk: a browser-only row is exactly the
 * broken case, while an onDisk row means the folder exists (a case-tolerant
 * OS), where renaming here would fight the disk-authoritative reconciler.
 */
export async function sanitizeProjectNames(): Promise<boolean> {
  try {
    const list = readProjectRegistry() as any[];
    if (!Array.isArray(list) || list.length === 0) return false;

    const sanitize = (name: string): string =>
      name.replace(/:/g, '.').replace(/[\/*?"<>|\\]/g, '').trim();

    const taken = new Set(
      list.map((p: any) => (typeof p?.name === 'string' ? p.name.toLowerCase() : '')).filter(Boolean)
    );

    let changed = false;
    const renames: Array<{ from: string; to: string }> = [];
    const updated = list.map((p: any) => {
      if (!p || typeof p.name !== 'string' || p.onDisk) return p;
      const clean = sanitize(p.name);
      if (!clean || clean === p.name) return p;
      // Dedupe the repaired name against every other project name.
      let unique = clean;
      let counter = 1;
      while (taken.has(unique.toLowerCase())) {
        unique = `${clean} (${counter})`;
        counter++;
      }
      taken.delete(p.name.toLowerCase());
      taken.add(unique.toLowerCase());
      renames.push({ from: p.name, to: unique });
      changed = true;
      return { ...p, name: unique };
    });

    if (!changed) return false;

    // Code-editor sessions are keyed by project NAME — move them with the
    // repair (cheap no-op for media projects).
    const completed: Array<{ from: string; to: string }> = [];
    try {
      for (const r of renames) {
        const moved = await renameCodeSessions(`willow_chat_sessions_${r.from}`, `willow_chat_sessions_${r.to}`);
        if (!moved) throw new Error(`Code sessions already exist for ${r.to}`);
        completed.push(r);
      }
    } catch (error) {
      for (const r of completed.reverse()) {
        try {
          await renameCodeSessions(`willow_chat_sessions_${r.to}`, `willow_chat_sessions_${r.from}`);
        } catch (rollbackError) {
          console.error('Failed to roll back code-session rename:', rollbackError);
        }
      }
      throw error;
    }
    writeProjectRegistry(updated);
    window.dispatchEvent(new Event('willow_projects_updated'));
    return true;
  } catch (err) {
    console.error('Project name sanitation failed:', err);
    return false;
  }
}

/**
 * Legacy migration stub - replaced by autoDetectProjectKinds
 */
export async function migrateProjectKinds(): Promise<boolean> {
  // Repair filesystem-illegal names first so kind-tagging (and everything
  // else this mount) sees the final names.
  const namesChanged = await sanitizeProjectNames();
  const kindsChanged = await autoDetectProjectKinds();
  return namesChanged || kindsChanged;
}

/**
 * Load all project covers as a map { projectId → dataUrl }
 */
export async function loadAllProjectCovers(): Promise<Record<string, string>> {
  try {
    const scopeId = activeMediaScopeId;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readonly');
      const store = tx.objectStore(COVERS_STORE);
      const request = store.openCursor();
      const result: Record<string, string> = {};
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const projectId = projectIdFromMediaKey(cursor.key, scopeId);
          if (projectId) result[projectId] = cursor.value;
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return {};
  }
}
