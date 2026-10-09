/**
 * The live copy of every loaded bot thread, and the only way to change one.
 *
 * Reads are synchronous from `dotThreads`; writes update memory first and
 * persist behind it, so the conversation never waits on IndexedDB. Items are
 * written as they are appended (a streaming message is written once, when it
 * closes); the rest of the thread is written on a short debounce.
 *
 * Several Willow tabs can have the same bot open. Item seqs come from a counter
 * every tab shares, so two tabs appending at once never hand out the same id,
 * and every change is broadcast so the other tabs' copies stay current. Turns
 * themselves are serialised per bot by the runtime's lock, so at most one tab
 * is ever writing a bot's own output.
 */
import { atom } from 'nanostores';
import { defaultPersistence, type DotThreadMeta, type DotThreadPersistence } from './thread-persistence';
import {
  emptyThread,
  itemIdFor,
  type DotEpisode,
  type DotItem,
  type DotRuntimeState,
  type DotThread,
} from './thread-types';

export const dotThreads = atom<Record<string, DotThread>>({});

let persistence: DotThreadPersistence = defaultPersistence();
const revisions = new Map<string, number>();
const loading = new Map<string, Promise<DotThread>>();
const metaTimers = new Map<string, ReturnType<typeof setTimeout>>();
const META_DEBOUNCE_MS = 250;

/** Swaps the storage backend. Tests use the in-memory one. */
export const setDotThreadPersistence = (next: DotThreadPersistence): void => {
  persistence = next;
  dotThreads.set({});
  loading.clear();
  revisions.clear();
};

export const getDotThread = (dotId: string): DotThread | undefined => dotThreads.get()[dotId];

const commit = (thread: DotThread): DotThread => {
  dotThreads.set({ ...dotThreads.get(), [thread.dotId]: thread });
  return thread;
};

/* ------------------------------------------------------------------------ */
/* Cross-tab                                                                 */
/* ------------------------------------------------------------------------ */

type ThreadBroadcast =
  | { type: 'items'; dotId: string; items: DotItem[] }
  | { type: 'meta'; dotId: string; meta: DotThreadMeta }
  | { type: 'removed'; dotId: string };

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('willow-dots-threads');
// Node (the test runner) keeps a listening channel's process alive; browsers have no `unref`.
(channel as (BroadcastChannel & { unref?: () => void }) | null)?.unref?.();

const broadcast = (message: ThreadBroadcast): void => {
  try {
    channel?.postMessage(message);
  } catch {
    // A closed channel just means no other tab hears about this change.
  }
};

const mergeItems = (current: DotItem[], incoming: DotItem[]): DotItem[] => {
  const bySeq = new Map(current.map((item) => [item.seq, item]));
  for (const item of incoming) bySeq.set(item.seq, item);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
};

channel?.addEventListener('message', (event: MessageEvent<ThreadBroadcast>) => {
  const message = event.data;
  if (message.type === 'removed') {
    const { [message.dotId]: _removed, ...rest } = dotThreads.get();
    dotThreads.set(rest);
    return;
  }
  const thread = getDotThread(message.dotId);
  if (!thread) return;
  if (message.type === 'items') {
    const items = mergeItems(thread.items, message.items);
    const nextSeq = Math.max(thread.nextSeq, ...message.items.map((item) => item.seq + 1));
    commit({ ...thread, items, nextSeq });
    return;
  }
  if ((revisions.get(message.dotId) ?? 0) >= message.meta.revision) return;
  revisions.set(message.dotId, message.meta.revision);
  const { revision: _revision, ...meta } = message.meta;
  commit({ ...thread, ...meta, items: thread.items, nextSeq: Math.max(thread.nextSeq, meta.nextSeq) });
});

/* ------------------------------------------------------------------------ */
/* Sequence allocation                                                       */
/* ------------------------------------------------------------------------ */

const seqKey = (dotId: string) => `willow:dots:seq:${dotId}`;

/**
 * Reserves `count` consecutive seqs. The counter lives in localStorage because
 * it is synchronous and shared by every tab; the window between read and write
 * is a single statement, which is as close to atomic as the platform offers.
 */
const allocateSeqs = (thread: DotThread, count: number): number => {
  let start = thread.nextSeq;
  try {
    const stored = Number(localStorage.getItem(seqKey(thread.dotId)) ?? 0);
    if (Number.isFinite(stored) && stored > start) start = stored;
    localStorage.setItem(seqKey(thread.dotId), String(start + count));
  } catch {
    // No storage (tests, private mode): the in-memory counter is enough for one tab.
  }
  return start;
};

/* ------------------------------------------------------------------------ */
/* Persistence scheduling                                                    */
/* ------------------------------------------------------------------------ */

const metaOf = (thread: DotThread): DotThreadMeta => {
  const revision = (revisions.get(thread.dotId) ?? 0) + 1;
  revisions.set(thread.dotId, revision);
  const { items: _items, ...rest } = thread;
  return { ...rest, revision };
};

const scheduleMeta = (dotId: string): void => {
  clearTimeout(metaTimers.get(dotId));
  metaTimers.set(dotId, setTimeout(() => {
    metaTimers.delete(dotId);
    const thread = getDotThread(dotId);
    if (!thread) return;
    const meta = metaOf(thread);
    void persistence.putMeta(meta).catch((error) => console.warn('[bots] could not save thread state', error));
    broadcast({ type: 'meta', dotId, meta });
  }, META_DEBOUNCE_MS));
};

/** Writes pending state now. The runtime calls it before a tab hands a bot over. */
export const flushDotThread = async (dotId: string): Promise<void> => {
  const timer = metaTimers.get(dotId);
  if (timer === undefined) return;
  clearTimeout(timer);
  metaTimers.delete(dotId);
  const thread = getDotThread(dotId);
  if (thread) await persistence.putMeta(metaOf(thread));
};

const persistItems = (dotId: string, items: DotItem[]): void => {
  const settled = items.filter((item) => !item.streaming);
  if (settled.length === 0) return;
  void persistence.putItems(dotId, settled).catch((error) => console.warn('[bots] could not save items', error));
  broadcast({ type: 'items', dotId, items: settled });
};

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

export type DotItemDraft = Omit<DotItem, 'id' | 'seq' | 'at'> & { at?: number };

/**
 * Loads a thread, creating it when it does not exist yet. `seed` supplies the
 * items of a brand-new thread — bots that predate the harness carry their old
 * messages into it this way.
 */
export const loadDotThread = (dotId: string, seed?: () => DotItemDraft[]): Promise<DotThread> => {
  const loaded = getDotThread(dotId);
  if (loaded) return Promise.resolve(loaded);
  const pending = loading.get(dotId);
  if (pending) return pending;
  const promise = (async () => {
    const stored = await persistence.load(dotId).catch((error) => {
      console.warn('[bots] could not read thread; starting from memory', error);
      return { items: [] as DotItem[], meta: null };
    });
    let thread: DotThread;
    if (stored.meta) {
      const { revision, ...meta } = stored.meta;
      revisions.set(dotId, revision);
      const nextSeq = Math.max(meta.nextSeq, ...stored.items.map((item) => item.seq + 1), 1);
      thread = { ...meta, items: stored.items, nextSeq };
    } else {
      thread = emptyThread(dotId);
      thread.items = stored.items;
      thread.nextSeq = Math.max(1, ...stored.items.map((item) => item.seq + 1));
    }
    // Another caller may have created it while we were reading.
    const raced = getDotThread(dotId);
    if (raced) return raced;
    commit(thread);
    if (!stored.meta && thread.items.length === 0 && seed) {
      const drafts = seed();
      if (drafts.length) appendDotItems(dotId, drafts);
    }
    if (!stored.meta) scheduleMeta(dotId);
    return getDotThread(dotId)!;
  })().finally(() => loading.delete(dotId));
  loading.set(dotId, promise);
  return promise;
};

/* ------------------------------------------------------------------------ */
/* Mutations                                                                 */
/* ------------------------------------------------------------------------ */

const requireThread = (dotId: string): DotThread => {
  const thread = getDotThread(dotId);
  if (!thread) throw new Error(`Bot thread ${dotId} is not loaded`);
  return thread;
};

export const appendDotItems = (dotId: string, drafts: DotItemDraft[]): DotItem[] => {
  if (drafts.length === 0) return [];
  const thread = requireThread(dotId);
  const start = allocateSeqs(thread, drafts.length);
  const now = Date.now();
  const items = drafts.map((draft, index): DotItem => ({
    ...draft,
    seq: start + index,
    id: itemIdFor(start + index),
    at: draft.at ?? now,
  }));
  commit({ ...thread, items: [...thread.items, ...items], nextSeq: start + drafts.length });
  persistItems(dotId, items);
  scheduleMeta(dotId);
  return items;
};

export const appendDotItem = (dotId: string, draft: DotItemDraft): DotItem => appendDotItems(dotId, [draft])[0]!;

export const updateDotItem = (dotId: string, itemId: string, patch: Partial<DotItem>): DotItem | null => {
  const thread = requireThread(dotId);
  const index = thread.items.findIndex((item) => item.id === itemId);
  if (index < 0) return null;
  const updated: DotItem = { ...thread.items[index]!, ...patch, id: itemId, seq: thread.items[index]!.seq };
  if (patch.streaming === false) delete updated.streaming;
  const items = thread.items.slice();
  items[index] = updated;
  commit({ ...thread, items });
  if (!updated.streaming) persistItems(dotId, [updated]);
  return updated;
};

export const updateDotRuntime = (
  dotId: string,
  patch: Partial<DotRuntimeState> | ((runtime: DotRuntimeState) => DotRuntimeState),
): DotRuntimeState => {
  const thread = requireThread(dotId);
  const runtime = typeof patch === 'function' ? patch(thread.runtime) : { ...thread.runtime, ...patch };
  commit({ ...thread, runtime });
  scheduleMeta(dotId);
  return runtime;
};

/** Writes one notebook file, or removes it when `text` is null. */
export const writeDotNotebookFile = (dotId: string, name: string, text: string | null): void => {
  const thread = requireThread(dotId);
  const notebook = { ...thread.notebook };
  if (text === null) delete notebook[name];
  else notebook[name] = { text, updatedAt: Date.now() };
  commit({ ...thread, notebook });
  scheduleMeta(dotId);
};

/** Records new episodes and how far level-1 coverage now reaches. */
export const recordDotEpisodes = (
  dotId: string,
  update: { add?: DotEpisode[]; absorb?: { ids: string[]; by: string }; lastCompactedSeq?: number },
): void => {
  const thread = requireThread(dotId);
  let episodes = thread.episodes.slice();
  if (update.absorb) {
    const absorbed = new Set(update.absorb.ids);
    episodes = episodes.map((episode) => (absorbed.has(episode.id) ? { ...episode, absorbedBy: update.absorb!.by } : episode));
  }
  if (update.add) episodes.push(...update.add);
  const runtime = update.lastCompactedSeq === undefined
    ? thread.runtime
    : { ...thread.runtime, lastCompactedSeq: Math.max(thread.runtime.lastCompactedSeq, update.lastCompactedSeq) };
  commit({ ...thread, episodes, runtime });
  scheduleMeta(dotId);
};

export const deleteDotThread = async (dotId: string): Promise<void> => {
  clearTimeout(metaTimers.get(dotId));
  metaTimers.delete(dotId);
  const { [dotId]: _removed, ...rest } = dotThreads.get();
  dotThreads.set(rest);
  revisions.delete(dotId);
  try {
    localStorage.removeItem(seqKey(dotId));
  } catch {
    // Nothing to clean up without storage.
  }
  broadcast({ type: 'removed', dotId });
  await persistence.remove(dotId);
};
