/**
 * Willow Media IndexedDB Service
 * Stores large media item histories (including heavy base64 data URLs)
 * to bypass browser-enforced 5MB localStorage quotas.
 */

import { renameCodeSessions } from './willowDB';

const DB_NAME = 'WillowMediaDB';
const STORE_NAME = 'project_media';
const COVERS_STORE = 'project_covers';

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
export async function saveProjectMedia(projectId: string, mediaItems: any[]): Promise<void> {
  try {
    const items = Array.isArray(mediaItems) ? mediaItems : [];
    // Realtime, lightweight media INDEX in localStorage. The heavy image/video
    // BYTES can never fit in localStorage (~5MB cap) — they live in IndexedDB /
    // on disk. But we keep a small per-project record here (counts + timestamp)
    // so media presence is visible & synced in localStorage in realtime, and so
    // the UI can tell which projects have media without touching IndexedDB.
    updateMediaIndex(projectId, items);

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
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(toStore, projectId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    // Fail silently to align with guidelines
  }
}

const MEDIA_INDEX_KEY = 'willow_media_index';

/** Update the realtime localStorage media index for one project + notify the UI. */
function updateMediaIndex(projectId: string, items: any[]): void {
  if (typeof window === 'undefined') return;
  try {
    const completed = (items || []).filter((m: any) => m && m.status === 'completed');
    const raw = localStorage.getItem(MEDIA_INDEX_KEY);
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
    localStorage.setItem(MEDIA_INDEX_KEY, JSON.stringify(idx));
    window.dispatchEvent(new Event('willow_media_updated'));
  } catch {}
}

/** Read the realtime media index (projectId -> { count, images, videos, updatedAt }). */
export function getMediaIndex(): Record<string, { count: number; images: number; videos: number; updatedAt: number }> {
  try {
    const raw = localStorage.getItem(MEDIA_INDEX_KEY);
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
  try {
    const db = await getDB();
    const entries = await new Promise<Record<string, any[]>>((resolve, reject) => {
      const out: Record<string, any[]> = {};
      const tx = db.transaction(STORE_NAME, 'readonly');
      const c = tx.objectStore(STORE_NAME).openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { out[cur.key as string] = (cur.value as any[]) || []; cur.continue(); } else resolve(out); };
      c.onerror = () => reject(c.error);
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
    localStorage.setItem(MEDIA_INDEX_KEY, JSON.stringify(idx));
    window.dispatchEvent(new Event('willow_media_updated'));
  } catch {}
}

/**
 * Load media items list for a specific project with automatic localStorage migration
 */
export async function loadProjectMedia(projectId: string): Promise<any[]> {
  try {
    const db = await getDB();
    const diskItems = await new Promise<any[] | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(projectId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // A present record is authoritative — even an empty array, which means the
    // user deleted all media. Only fall through to the legacy-localStorage
    // migration when there is NO record at all. Previously an empty array was
    // treated as "no data" and the migration resurrected deleted media.
    if (diskItems !== undefined) {
      return diskItems;
    }

    // Migration Fallback: Load from localStorage if present
    const key = `willow_project_media_${projectId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.length > 0) {
          // Save to IndexedDB so it's migrated
          await saveProjectMedia(projectId, parsed);
          // Delete from localStorage to free up the 5MB quota
          localStorage.removeItem(key);
          return parsed;
        }
      } catch (e) {}
    }

    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Save a project cover image (base64 data URL) in IndexedDB
 */
/**
 * Save a project cover. Converts blob: URLs and external video URLs to base64
 * data URLs so they persist across reloads (videos with API keys expire).
 */
export async function saveProjectCover(projectId: string, coverUrl: string): Promise<void> {
  try {
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readwrite');
      const store = tx.objectStore(COVERS_STORE);
      const request = store.put(urlToSave, projectId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    // Fail silently
  }
}

/**
 * Load a project cover image from IndexedDB
 */
export async function loadProjectCover(projectId: string): Promise<string | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readonly');
      const store = tx.objectStore(COVERS_STORE);
      const request = store.get(projectId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return null;
  }
}

/**
 * Delete all IndexedDB data for a project (media items + cover)
 */
export async function deleteProjectData(projectId: string): Promise<void> {
  // Remove from the realtime localStorage media index first.
  try {
    const raw = localStorage.getItem(MEDIA_INDEX_KEY);
    if (raw) {
      const idx = JSON.parse(raw);
      if (idx[projectId]) {
        delete idx[projectId];
        localStorage.setItem(MEDIA_INDEX_KEY, JSON.stringify(idx));
        window.dispatchEvent(new Event('willow_media_updated'));
      }
    }
  } catch {}
  // Also drop any leftover legacy per-project media key, otherwise a deleted
  // project's media resurrects via loadProjectMedia's migration fallback.
  try {
    localStorage.removeItem(`willow_project_media_${projectId}`);
  } catch {}
  try {
    const db = await getDB();

    // Delete from project_media store
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(projectId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Delete from project_covers store
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readwrite');
      const store = tx.objectStore(COVERS_STORE);
      const request = store.delete(projectId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to delete project data from IndexedDB:', err);
  }
}

/**
 * Return the set of projectIds that have stored media items in IndexedDB.
 * Only MediaView writes to project_media, so this is a reliable "is a media
 * project" signal (project covers are NOT, since code screenshots use them too).
 */
export async function getMediaProjectIds(): Promise<Set<string>> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      const ids = new Set<string>();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const items = cursor.value;
          if (Array.isArray(items) && items.length > 0) {
            ids.add(cursor.key as string);
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
    const stored = localStorage.getItem('willow_projects_list');
    if (!stored) return false;

    const list = JSON.parse(stored);
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
      localStorage.setItem('willow_projects_list', JSON.stringify(updated));
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
    const stored = localStorage.getItem('willow_projects_list');
    if (!stored) return false;
    const list = JSON.parse(stored);
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

    localStorage.setItem('willow_projects_list', JSON.stringify(updated));
    // Code-editor sessions are keyed by project NAME — move them with the
    // repair (cheap no-op for media projects).
    for (const r of renames) {
      void renameCodeSessions(`willow_chat_sessions_${r.from}`, `willow_chat_sessions_${r.to}`);
    }
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
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readonly');
      const store = tx.objectStore(COVERS_STORE);
      const request = store.openCursor();
      const result: Record<string, string> = {};
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          result[cursor.key as string] = cursor.value;
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

