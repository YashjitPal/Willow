/**
 * What the remote browser saw, kept for good.
 *
 * Every screenshot the agent takes is a JPEG in IndexedDB — a database of its own, so
 * the attachment store's fixed-version opens are untouched — and, with a folder
 * connected, a file beside the task:
 *
 *   Spark/Tasks/<task>/Browser/001 duckduckgo.com.jpg
 *   Spark/Tasks/<task>/Browser/steps.json      each step's file, address, title, time
 *
 * The browser's copy is read first and the folder's when that one is gone (site data
 * cleared, another browser on the same folder), which is then kept in IndexedDB again.
 * Nothing is capped; a task's screenshots go when the task is deleted.
 */
import { CONVERSATION_FOLDERS, safeFileStem } from '@willow/storage/local-fs/conversation-files';
import { getActiveSparkStorageScope } from '../spark-store';
import { sparkDisk } from '../spark-disk';

const DB_NAME = 'willow-spark-browser';
const DB_VERSION = 1;
const STORE = 'shots';
const STEPS_FILE = `${CONVERSATION_FOLDERS.browser}/steps.json`;

export interface RemoteBrowserShot {
  id: string;
  /** Its place in the task's history, from 0, which also numbers its file. */
  index: number;
  url: string;
  title: string;
  at: number;
  /** Where it is kept in the task's folder: `Browser/001 duckduckgo.com.jpg`. */
  file: string;
}

interface StoredShot extends RemoteBrowserShot {
  taskId: string;
  blob: Blob;
}

const shotFileName = (index: number, url: string): string => {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {}
  return `${String(index + 1).padStart(3, '0')} ${safeFileStem(host, 'page')}.jpg`;
};

/** The record for the step after `taken`, numbered and named for its file. */
export const nextRemoteBrowserShot = (taken: readonly RemoteBrowserShot[], shot: { url: string; title: string; at: number }): RemoteBrowserShot => {
  const index = taken.reduce((highest, existing) => Math.max(highest, existing.index), -1) + 1;
  return {
    id: `shot-${shot.at.toString(36)}-${index}`,
    index,
    url: shot.url,
    title: shot.title,
    at: shot.at,
    file: `${CONVERSATION_FOLDERS.browser}/${shotFileName(index, shot.url)}`,
  };
};

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Could not open the remote browser store.'));
    };
  });
  return dbPromise;
};

const taskPrefix = (scope: string, taskId: string) => `${scope || 'guest'}\u0000${taskId}\u0000`;
const shotKey = (scope: string, taskId: string, index: number) => `${taskPrefix(scope, taskId)}${String(index).padStart(6, '0')}`;
const taskRange = (scope: string, taskId: string) => IDBKeyRange.bound(taskPrefix(scope, taskId), `${taskPrefix(scope, taskId)}\uffff`);

const finished = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error ?? new Error('Remote browser store transaction failed.'));
  tx.onabort = () => reject(tx.error ?? new Error('Remote browser store transaction was aborted.'));
});

const saveShot = async (scope: string, taskId: string, shot: RemoteBrowserShot, blob: Blob): Promise<void> => {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ ...shot, taskId, blob } satisfies StoredShot, shotKey(scope, taskId, shot.index));
  await finished(tx);
};

const listShots = async (scope: string, taskId: string): Promise<RemoteBrowserShot[]> => {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const request = tx.objectStore(STORE).getAll(taskRange(scope, taskId));
  const records = await new Promise<StoredShot[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result || []) as StoredShot[]);
    request.onerror = () => reject(request.error ?? new Error('Could not list the remote browser history.'));
  });
  return records
    .map(({ blob: _blob, taskId: _taskId, ...shot }) => shot)
    .sort((a, b) => a.index - b.index);
};

const loadShotBlob = async (scope: string, taskId: string, index: number): Promise<Blob | null> => {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const request = tx.objectStore(STORE).get(shotKey(scope, taskId, index));
  const record = await new Promise<StoredShot | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as StoredShot | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read the screenshot.'));
  });
  return record?.blob ?? null;
};

/** Removes a task's screenshots from the browser; its folder goes with the task's. */
export const deleteRemoteBrowserShots = async (taskId: string, scope = getActiveSparkStorageScope()): Promise<void> => {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(taskRange(scope, taskId));
  await finished(tx);
};

/** Bytes not in IndexedDB yet, or that failed to get there: this session's only copy. */
const pending = new Map<string, Blob>();
const pendingKey = (taskId: string, shot: RemoteBrowserShot) => `${taskId}\u0000${shot.id}`;

/** A screenshot's bytes: this session's, then the browser's, then the folder's. */
export const loadRemoteBrowserShot = async (taskId: string, shot: RemoteBrowserShot): Promise<Blob | null> => {
  const held = pending.get(pendingKey(taskId, shot));
  if (held) return held;
  const scope = getActiveSparkStorageScope();
  const stored = await loadShotBlob(scope, taskId, shot.index).catch(() => null);
  if (stored) return stored;
  const file = await sparkDisk()?.read(taskId, shot.file).catch(() => null) ?? null;
  if (file) void saveShot(scope, taskId, shot, file).catch(() => undefined);
  return file;
};

const stepsDocument = (taskId: string, shots: readonly RemoteBrowserShot[]): Blob => new Blob([JSON.stringify({
  taskId,
  steps: shots.map((shot) => ({
    index: shot.index,
    file: shot.file.slice(CONVERSATION_FOLDERS.browser.length + 1),
    url: shot.url,
    title: shot.title,
    at: new Date(shot.at).toISOString(),
  })),
}, null, 2)], { type: 'application/json' });

/**
 * Writes `shots` that are not in the task's folder yet, and the step list for all of
 * `history`. The file of a step is never rewritten; the list is, since it grows.
 */
export const writeRemoteBrowserShotsToDisk = async (
  taskId: string,
  shots: readonly RemoteBrowserShot[],
  history: readonly RemoteBrowserShot[],
): Promise<boolean> => {
  const disk = sparkDisk();
  if (!disk || history.length === 0) return false;
  return disk.write(taskId, [
    ...shots.map((shot) => ({ path: shot.file, read: () => loadRemoteBrowserShot(taskId, shot) })),
    { path: STEPS_FILE, read: () => stepsDocument(taskId, history), replace: true },
  ]);
};

/** Keeps a new screenshot: in memory until IndexedDB has it, and in the task's folder. */
export const keepRemoteBrowserShot = async (
  taskId: string,
  shot: RemoteBrowserShot,
  blob: Blob,
  history: readonly RemoteBrowserShot[],
): Promise<void> => {
  const key = pendingKey(taskId, shot);
  pending.set(key, blob);
  try {
    await saveShot(getActiveSparkStorageScope(), taskId, shot, blob);
    pending.delete(key);
  } catch {
    // Kept in memory for this session; the folder below may still take it.
  }
  await writeRemoteBrowserShotsToDisk(taskId, [shot], history).catch(() => false);
};

const parseSteps = (taskId: string, text: string): RemoteBrowserShot[] => {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed?.steps)) return [];
    return parsed.steps.flatMap((step: any) => {
      if (!step || typeof step.file !== 'string' || !Number.isInteger(step.index) || step.index < 0) return [];
      const at = Date.parse(step.at) || 0;
      return [{
        id: `shot-${taskId}-${step.index}`,
        index: step.index,
        url: typeof step.url === 'string' ? step.url : '',
        title: typeof step.title === 'string' ? step.title : '',
        at,
        file: `${CONVERSATION_FOLDERS.browser}/${safeFileStem(step.file, `${step.index + 1}.jpg`)}`,
      }];
    }).sort((a: RemoteBrowserShot, b: RemoteBrowserShot) => a.index - b.index);
  } catch {
    return [];
  }
};

/**
 * A task's history as it was left: the browser's list, or — when the browser has none
 * — the one in the task's folder.
 */
export const readRemoteBrowserHistory = async (taskId: string): Promise<RemoteBrowserShot[]> => {
  const stored = await listShots(getActiveSparkStorageScope(), taskId).catch(() => [] as RemoteBrowserShot[]);
  if (stored.length) return stored;
  const steps = await sparkDisk()?.read(taskId, STEPS_FILE).catch(() => null);
  return steps ? parseSteps(taskId, await steps.text()) : [];
};
