/**
 * Local File System Service
 * Uses browser File System Access API to store files/folders locally
 * Persists directory handles in IndexedDB
 */

// IndexedDB database name and store name
const DB_NAME = 'WillowLocalFS';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'local_projects_dir';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if the browser supports File System Access API
 */
export function isFSAAPISupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Save directory handle in IndexedDB
 */
export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(handle, HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve saved directory handle from IndexedDB
 */
export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return null;
  }
}

/**
 * Remove saved directory handle from IndexedDB
 */
export async function removeStoredDirectoryHandle(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Verify if we have read/write permission to the directory.
 * Prompts the user if permission is not already granted.
 */
export async function verifyPermission(handle: FileSystemDirectoryHandle, readWrite = true, interactive = false): Promise<boolean> {
  const opts = { mode: readWrite ? 'readwrite' as const : 'read' as const };
  try {
    if ((await handle.queryPermission(opts)) === 'granted') {
      return true;
    }
    if (interactive) {
      if ((await handle.requestPermission(opts)) === 'granted') {
        return true;
      }
    }
  } catch (err) {
    // Ignored to avoid logging
  }
  return false;
}

/**
 * Write a file recursively (creating directories as needed)
 */
export async function writeFileRecursively(
  rootDirHandle: FileSystemDirectoryHandle,
  filePath: string,
  content: string
): Promise<void> {
  // Normalize path and split parts
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
  const parts = normalizedPath.split('/');
  
  let currentDir = rootDirHandle;
  
  // Traverse and create folders as necessary
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === '.' || part === '..') continue;
    currentDir = await currentDir.getDirectoryHandle(part, { create: true });
  }
  
  // Create or get the file handle
  const fileName = parts[parts.length - 1];
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });

  // Write the file content
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

// Per-project manifest file. Holds the stable project id so that a project
// re-discovered from disk keeps the same id it had in localStorage/IndexedDB
// (which keys covers and media), instead of being assigned a fresh random id.
const PROJECT_MANIFEST_NAME = '.willow.json';

/**
 * Read a project's `.willow.json` manifest from its folder handle.
 * Returns null if the manifest is absent or unreadable.
 */
export async function readProjectManifest(
  projectDirHandle: FileSystemDirectoryHandle
): Promise<{ id?: string } | null> {
  try {
    const fileHandle = await projectDirHandle.getFileHandle(PROJECT_MANIFEST_NAME);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Write (or overwrite) a project's `.willow.json` manifest with its stable id.
 */
export async function writeProjectManifest(
  projectDirHandle: FileSystemDirectoryHandle,
  id: string
): Promise<void> {
  try {
    const fileHandle = await projectDirHandle.getFileHandle(PROJECT_MANIFEST_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ id }, null, 2));
    await writable.close();
  } catch {
    // Fail silently to align with guidelines
  }
}
