/**
 * Local File System Service
 * Uses browser File System Access API to store files/folders locally
 * Persists directory handles in IndexedDB
 */

import { getProjectFileUploadPayload, readProjectFileContent } from './projectFileContent.ts';

// IndexedDB database name and store name
const DB_NAME = 'WillowLocalFS';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'local_projects_dir';
// Keep a durable catalog of every folder the user has selected. Disconnecting
// clears only the active selection; the catalog lets a later re-selection of
// the same directory recover its stable root identity instead of minting a
// fresh scope (which would make chats/projects appear to disappear).
const CATALOG_KEY = 'local_projects_catalog';

export interface StoredDirectoryRecord {
  handle: FileSystemDirectoryHandle;
  rootId: string;
}

export interface StoredDirectoryCatalogEntry extends StoredDirectoryRecord {
  lastUsedAt?: number;
}

export interface LocalProjectFile {
  name: string;
  content: string;
}

function createRootId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `root_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function isStoredDirectoryRecord(value: unknown): value is StoredDirectoryRecord {
  return !!value && typeof value === 'object' &&
    typeof (value as StoredDirectoryRecord).rootId === 'string' &&
    !!(value as StoredDirectoryRecord).handle;
}

async function handlesReferToSameEntry(
  left: FileSystemDirectoryHandle,
  right: FileSystemDirectoryHandle
): Promise<boolean> {
  if (left === right) return true;
  try {
    return typeof left.isSameEntry === 'function' && await left.isSameEntry(right);
  } catch {
    return false;
  }
}

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
export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle, rootId?: string): Promise<string> {
  const db = await getDB();
  let stableRootId = rootId;
  if (!stableRootId) {
    const existing = await getStoredDirectoryCatalog();
    for (const entry of existing) {
      if (await handlesReferToSameEntry(entry.handle, handle)) {
        stableRootId = entry.rootId;
        break;
      }
    }
    // Versions before the catalog stored a single root record only. Preserve
    // that identity during the first re-selection after upgrade.
    if (!stableRootId) {
      const current = await getStoredDirectoryRecord();
      if (current && await handlesReferToSameEntry(current.handle, handle)) {
        stableRootId = current.rootId;
      }
    }
  }
  stableRootId ||= createRootId();
  const record: StoredDirectoryRecord = { handle, rootId: stableRootId };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record, HANDLE_KEY);
    // Read/update catalog in the same transaction so a crash cannot leave the
    // current key and catalog disagreeing.
    const request = store.get(CATALOG_KEY);
    request.onsuccess = () => {
      const raw = request.result;
      const catalog: StoredDirectoryCatalogEntry[] = Array.isArray(raw) ? raw.filter(isStoredDirectoryRecord) : [];
      const next = catalog.filter((entry) => entry.rootId !== stableRootId);
      next.push({ ...record, lastUsedAt: Date.now() });
      store.put(next, CATALOG_KEY);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store directory handle'));
    tx.onabort = () => reject(tx.error ?? new Error('Storing directory handle was aborted'));
  });
  return stableRootId;
}

/** Return all previously selected directories, preserving their root IDs. */
export async function getStoredDirectoryCatalog(): Promise<StoredDirectoryCatalogEntry[]> {
  const db = await getDB();
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(CATALOG_KEY);
    let result: unknown = null;
    request.onsuccess = () => { result = request.result ?? null; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Failed to read directory catalog'));
    tx.onabort = () => reject(tx.error ?? request.error ?? new Error('Reading directory catalog was aborted'));
  });
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredDirectoryRecord) as StoredDirectoryCatalogEntry[];
}

async function upsertDirectoryCatalogEntry(record: StoredDirectoryRecord): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(CATALOG_KEY);
    request.onsuccess = () => {
      const raw = request.result;
      const catalog: StoredDirectoryCatalogEntry[] = Array.isArray(raw) ? raw.filter(isStoredDirectoryRecord) : [];
      const next = catalog.filter((entry) => entry.rootId !== record.rootId);
      next.push({ ...record, lastUsedAt: Date.now() });
      store.put(next, CATALOG_KEY);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to update directory catalog'));
    tx.onabort = () => reject(tx.error ?? new Error('Updating directory catalog was aborted'));
  });
}

/**
 * Retrieve the saved directory handle and its stable root identity. Legacy
 * records that stored only the handle are upgraded in place on first read.
 */
export async function getStoredDirectoryRecord(): Promise<StoredDirectoryRecord | null> {
  const db = await getDB();
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    let result: unknown = null;
    request.onsuccess = () => { result = request.result ?? null; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Failed to read directory handle'));
    tx.onabort = () => reject(tx.error ?? new Error('Reading directory handle was aborted'));
  });
  if (!value) return null;
  if (isStoredDirectoryRecord(value)) {
    // Backfill records written by the pre-catalog implementation so a
    // disconnect/reselect cycle can still recover this root ID.
    try { await upsertDirectoryCatalogEntry(value); } catch {}
    return value;
  }

  // Version-1 stored the FileSystemDirectoryHandle as the value directly.
  const handle = value as FileSystemDirectoryHandle;
  const rootId = createRootId();
  await storeDirectoryHandle(handle, rootId);
  return { handle, rootId };
}

/** Retrieve only the handle for backward-compatible callers. */
export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await getStoredDirectoryRecord())?.handle ?? null;
  } catch {
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
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to remove directory handle'));
    tx.onabort = () => reject(tx.error ?? new Error('Removing directory handle was aborted'));
  });
}

/**
 * Verify if we have read/write permission to the directory.
 * Prompts the user if permission is not already granted.
 */
export async function verifyPermission(handle: FileSystemDirectoryHandle, readWrite = true, interactive = false): Promise<boolean> {
  const opts = { mode: readWrite ? 'readwrite' as const : 'read' as const };
  try {
    if ((await (handle as any).queryPermission(opts)) === 'granted') {
      return true;
    }
    if (interactive) {
      if ((await (handle as any).requestPermission(opts)) === 'granted') {
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
  content: string | Blob | BufferSource | ReadableStream<Uint8Array>
): Promise<void> {
  // Normalize path and split parts
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
  const parts = normalizedPath.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  
  let currentDir = rootDirHandle;
  
  // Traverse and create folders as necessary
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    currentDir = await currentDir.getDirectoryHandle(part, { create: true });
  }
  
  // Create or get the file handle
  const fileName = parts[parts.length - 1];
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });

  // Write the file content
  const writable = await fileHandle.createWritable();
  try {
    if (content instanceof ReadableStream) {
      // pipeTo applies backpressure and avoids materializing large files in RAM.
      await content.pipeTo(writable);
    } else {
      const decoded = typeof content === 'string'
        ? getProjectFileUploadPayload(filePath, content)
        : null;
      await writable.write(decoded?.binary ? decoded.blob : content);
      await writable.close();
    }
  } catch (error) {
    try { await writable.abort(error); } catch {}
    throw error;
  }
}

/**
 * Read a directory tree into the flat path/content shape used by the workbench.
 * The traversal is deterministic and fails as a whole if any file cannot be
 * read, so callers never mistake a partial project for a complete restore.
 */
export async function readFilesRecursively(
  rootDirHandle: FileSystemDirectoryHandle
): Promise<LocalProjectFile[]> {
  const files: LocalProjectFile[] = [];

  const visit = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    const entries: any[] = [];
    for await (const entry of (dir as any).values()) entries.push(entry);
    entries.sort((left, right) => String(left.name).localeCompare(String(right.name)));

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await visit(entry as FileSystemDirectoryHandle, relativePath);
      } else if (entry.kind === 'file') {
        const file = await (entry as FileSystemFileHandle).getFile();
        files.push({ name: relativePath, content: await readProjectFileContent(file) });
      }
    }
  };

  await visit(rootDirHandle, '');
  return files;
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
