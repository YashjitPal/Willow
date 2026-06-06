/**
 * Willow Media IndexedDB Service
 * Stores large media item histories (including heavy base64 data URLs)
 * to bypass browser-enforced 5MB localStorage quotas.
 */

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
 * Save media items list for a specific project
 */
export async function saveProjectMedia(projectId: string, mediaItems: any[]): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(mediaItems, projectId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    // Fail silently to align with guidelines
  }
}

/**
 * Load media items list for a specific project with automatic localStorage migration
 */
export async function loadProjectMedia(projectId: string): Promise<any[]> {
  try {
    const db = await getDB();
    const diskItems = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(projectId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    if (diskItems && diskItems.length > 0) {
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
export async function saveProjectCover(projectId: string, coverUrl: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readwrite');
      const store = tx.objectStore(COVERS_STORE);
      const request = store.put(coverUrl, projectId);
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

