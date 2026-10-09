/**
 * Where bot threads live on this device.
 *
 * Items and everything else are stored apart. Items are append-only and the
 * list grows without bound, so each one is written once, on its own, the moment
 * it exists — rewriting a months-long thread on every message would make each
 * new message cost more than the last. The rest of the thread (episodes, the
 * notebook, runtime state) is small and changes in place, so it is one record
 * per bot, rewritten as a whole.
 *
 * IndexedDB rather than localStorage because a long thread outgrows
 * localStorage's few megabytes within weeks. A database of its own, so a
 * schema change here never needs another feature's upgrade path.
 */
import type { DotItem, DotThread } from './thread-types';

export type DotThreadMeta = Omit<DotThread, 'items'> & { revision: number };

export interface DotThreadPersistence {
  load(dotId: string): Promise<{ items: DotItem[]; meta: DotThreadMeta | null }>;
  putItems(dotId: string, items: DotItem[]): Promise<void>;
  putMeta(meta: DotThreadMeta): Promise<void>;
  /** Removes a bot's items, keeping the rest of its thread. */
  clearItems(dotId: string): Promise<void>;
  remove(dotId: string): Promise<void>;
}

/** Strips in-memory-only fields before an item is written. */
export const persistableItem = (item: DotItem): DotItem => {
  if (!item.streaming) return item;
  const { streaming: _streaming, ...rest } = item;
  return rest;
};

export const memoryPersistence = (): DotThreadPersistence => {
  const items = new Map<string, Map<number, DotItem>>();
  const metas = new Map<string, DotThreadMeta>();
  return {
    async load(dotId) {
      const stored = [...(items.get(dotId)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
      return { items: stored, meta: metas.get(dotId) ?? null };
    },
    async putItems(dotId, next) {
      const bucket = items.get(dotId) ?? new Map<number, DotItem>();
      for (const item of next) bucket.set(item.seq, persistableItem(item));
      items.set(dotId, bucket);
    },
    async putMeta(meta) {
      metas.set(meta.dotId, structuredClone(meta));
    },
    async clearItems(dotId) {
      items.delete(dotId);
    },
    async remove(dotId) {
      items.delete(dotId);
      metas.delete(dotId);
    },
  };
};

const DB_NAME = 'willow-dots';
const DB_VERSION = 1;
const ITEMS = 'items';
const META = 'meta';

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });

export const indexedDbPersistence = (): DotThreadPersistence => {
  let database: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    database ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: ['dotId', 'seq'] });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'dotId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        database = null;
        reject(req.error ?? new Error('Could not open the bots database'));
      };
    });
    return database;
  };
  const range = (dotId: string) => IDBKeyRange.bound([dotId, 0], [dotId, Number.MAX_SAFE_INTEGER]);

  return {
    async load(dotId) {
      const db = await open();
      const tx = db.transaction([ITEMS, META], 'readonly');
      const [rows, meta] = await Promise.all([
        request(tx.objectStore(ITEMS).getAll(range(dotId)) as IDBRequest<Array<DotItem & { dotId: string }>>),
        request(tx.objectStore(META).get(dotId) as IDBRequest<DotThreadMeta | undefined>),
      ]);
      const items = rows.map(({ dotId: _dotId, ...item }) => item as DotItem).sort((a, b) => a.seq - b.seq);
      return { items, meta: meta ?? null };
    },
    async putItems(dotId, items) {
      if (items.length === 0) return;
      const db = await open();
      const tx = db.transaction(ITEMS, 'readwrite');
      const store = tx.objectStore(ITEMS);
      for (const item of items) store.put({ ...persistableItem(item), dotId });
      await transactionDone(tx);
    },
    async putMeta(meta) {
      const db = await open();
      const tx = db.transaction(META, 'readwrite');
      tx.objectStore(META).put(meta);
      await transactionDone(tx);
    },
    async clearItems(dotId) {
      const db = await open();
      const tx = db.transaction(ITEMS, 'readwrite');
      tx.objectStore(ITEMS).delete(range(dotId));
      await transactionDone(tx);
    },
    async remove(dotId) {
      const db = await open();
      const tx = db.transaction([ITEMS, META], 'readwrite');
      tx.objectStore(ITEMS).delete(range(dotId));
      tx.objectStore(META).delete(dotId);
      await transactionDone(tx);
    },
  };
};

export const defaultPersistence = (): DotThreadPersistence =>
  typeof indexedDB === 'undefined' ? memoryPersistence() : indexedDbPersistence();
