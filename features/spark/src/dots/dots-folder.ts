/**
 * Bots' folder in the user's workspace (`Spark/Dots/`), through the synced-folder registry. What a
 * file holds and what a pass does with disk's files are `dots-folder-plan.ts`; this is where they
 * meet the stores — the bots list (`dots-store.ts`) and each bot's conversation, which lives in the
 * thread store (`harness/thread/`) and its IndexedDB database. A conversation is written there the
 * way another tab's would be: into IndexedDB, and into a copy already loaded through the thread
 * store's own cross-tab channel.
 *
 * Browser storage can lose what it holds while the folder keeps it. A conversation disk carries
 * further than this copy has it is taken from disk before the engine compares, never written over;
 * a bots list this page could not read leaves the folder's records behind, so disk's bots come back
 * as new instead of being taken for deleted.
 */
import { isValidItemId, registerSyncedFolder, requestSyncedFolderPass, syncedFolderKeys, type SyncedItem } from '@willow/storage/local-sync';
import { applySyncedSparkDots, sparkDots, takeUnreadableStoredDots } from './dots-store';
import { DOTS_FOLDER, parseDotFile, planDotsApply, serializeDotFile, threadRelation, withFileRecord, type DotFile } from './dots-folder-plan';
import { defaultPersistence, type DotThreadPersistence } from './harness/thread/thread-persistence';
import { deleteDotThread, dotThreads, getDotThread } from './harness/thread/thread-store';
import { emptyThread, type DotThread } from './harness/thread/thread-types';

let persistence: DotThreadPersistence = defaultPersistence();

/** Test seam: the thread store's own backend, where a test has swapped it for an in-memory one. */
export const setDotsFolderPersistence = (next: DotThreadPersistence): void => {
  persistence = next;
};

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('willow-dots-threads');
// Node (the test runner) keeps a listening channel's process alive; browsers have no `unref`.
(channel as (BroadcastChannel & { unref?: () => void }) | null)?.unref?.();

if (takeUnreadableStoredDots()) {
  const prefixes = Object.values(syncedFolderKeys(DOTS_FOLDER, ''));
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
    }
  } catch {
    // No storage, no records to leave behind.
  }
}

/** A bot's conversation as this copy has it: the loaded one, or what IndexedDB holds, and whether its
 *  state beside the messages was lost from there. A failed read throws, which stops the pass — a
 *  conversation that could not be read is not an empty one. */
const localState = async (dotId: string): Promise<{ thread: DotThread | null; stateLost: boolean }> => {
  const loaded = getDotThread(dotId);
  if (loaded) return { thread: loaded, stateLost: false };
  const stored = await persistence.load(dotId);
  if (!stored.meta && stored.items.length === 0) return { thread: null, stateLost: false };
  const nextSeq = Math.max(stored.meta?.nextSeq ?? 1, ...stored.items.map((item) => item.seq + 1), 1);
  if (!stored.meta) return { thread: { ...emptyThread(dotId), items: stored.items, nextSeq }, stateLost: true };
  const { revision: _revision, ...meta } = stored.meta;
  return { thread: { ...meta, items: stored.items, nextSeq }, stateLost: false };
};

const localThread = async (dotId: string): Promise<DotThread | null> => (await localState(dotId)).thread;

/** What this copy reported of each bot on the last pass: disk holding just that has nothing new for it. */
const reported = new Map<string, string>();

/** Writes a conversation as disk has it. Its revision is ahead of any this copy has given it, so a
 *  loaded copy takes it over its own. */
const writeThread = async (dotId: string, thread: DotThread): Promise<void> => {
  const stored = await persistence.load(dotId);
  const nextSeq = Math.max(thread.nextSeq, ...thread.items.map((item) => item.seq + 1), 1);
  const { items, ...rest } = thread;
  const meta = { ...rest, dotId, nextSeq, revision: Math.max((stored.meta?.revision ?? 0) + 1, Date.now()) };
  // Disk's conversation was started over after this copy's: the messages this copy holds from before it go first.
  const restarted = (thread.runtime.conversationReset?.at ?? 0) > (stored.meta?.runtime.conversationReset?.at ?? 0);
  if (restarted) await persistence.clearItems(dotId);
  await persistence.putItems(dotId, items);
  await persistence.putMeta(meta);
  if (getDotThread(dotId)) {
    if (restarted) channel?.postMessage({ type: 'reset', dotId, meta });
    channel?.postMessage({ type: 'items', dotId, items });
    if (!restarted) channel?.postMessage({ type: 'meta', dotId, meta });
  }
};

/** Bots this pass read here, which alone can have been deleted in another copy. */
let read = new Set<string>();

/**
 * Conversations kept here as they are while disk holds another copy's (`held`): what this copy had
 * then, and disk's file. Until this copy's changes, it reports disk's file, so the two copies do not
 * write their own over each other's on every pass; once it changes here, it is written again.
 */
const held = new Map<string, { local: string; remote: string }>();

registerSyncedFolder('spark-dots', {
  folder: DOTS_FOLDER,
  extension: '.json',
  // One list, shared by every tab through localStorage, which a deletion leaves at once.
  reviveLocal: true,

  async readLocal(ctx) {
    const dots = sparkDots.get().dots.filter((dot) => isValidItemId(dot.id));
    const items: SyncedItem[] = [];
    reported.clear();
    for (const dot of dots) {
      const { thread, stateLost } = await localState(dot.id);
      const onDisk = (await ctx.readDisk?.(dot.id)) ?? null;
      const file = onDisk === null ? null : parseDotFile(dot.id, onDisk);
      // Disk carries the conversation further: messages this copy lacks — another copy's work, or this
      // copy's own from before its storage lost them — or what this copy keeps beside its messages is
      // gone. The same messages with the rest told apart (how freely the bot acts, its triggers, its
      // notebook) are a change on one side, which the engine tells apart and this cannot: taken here, a
      // choice just made in the bot's profile went back to the file's on the next pass.
      // A conversation another copy started over holds fewer messages, not more.
      const restartedOnDisk = (file?.thread?.runtime.conversationReset?.at ?? 0) > (thread?.runtime.conversationReset?.at ?? 0);
      const further = onDisk !== null && file?.thread && threadRelation(thread, file.thread) === 'ahead'
        && (!thread || stateLost || restartedOnDisk || file.thread.items.length > thread.items.length);
      if (onDisk !== null && file?.thread && further) {
        // Taken, and the bot as disk has it unless it changed here since.
        await writeThread(dot.id, file.thread);
        const kept = dot.updatedAt > file.dot.updatedAt ? dot : withFileRecord(dot, file.dot);
        if (kept !== dot) applySyncedSparkDots([kept], [], []);
        const contents = kept === dot ? serializeDotFile(dot, file.thread) : onDisk;
        reported.set(dot.id, contents);
        items.push({ id: dot.id, contents });
        continue;
      }
      const contents = serializeDotFile(dot, thread);
      const kept = held.get(dot.id);
      if (kept?.local === contents && (onDisk === null || kept.remote === onDisk)) {
        reported.set(dot.id, kept.remote);
        items.push({ id: dot.id, contents: kept.remote });
        continue;
      }
      held.delete(dot.id);
      reported.set(dot.id, contents);
      items.push({ id: dot.id, contents });
    }
    read = new Set(dots.map((dot) => dot.id));
    return items;
  },

  async applyRemote(items) {
    const files = items.map((item) => parseDotFile(item.id, item.contents)).filter((file): file is DotFile => file !== null);
    const contents = new Map(items.map((item) => [item.id, item.contents]));
    const dots = sparkDots.get().dots;
    const threads = new Map<string, DotThread | null>();
    for (const dot of dots) threads.set(dot.id, await localThread(dot.id));
    const plan = planDotsApply({ dots, thread: (dotId) => threads.get(dotId) ?? null }, files, read);

    // Conversations first: a bot added to the list is loaded from IndexedDB at once. Disk holding what
    // this copy reported has nothing new, and a change made here while the pass ran stays.
    for (const { dotId, thread } of plan.threads) {
      if (reported.get(dotId) === contents.get(dotId)) continue;
      await writeThread(dotId, thread);
    }
    for (const dotId of plan.held) {
      const dot = dots.find((candidate) => candidate.id === dotId)!;
      held.set(dotId, { local: serializeDotFile(dot, threads.get(dotId) ?? null), remote: contents.get(dotId)! });
    }
    applySyncedSparkDots(plan.updated, plan.added, plan.removed);
    for (const dotId of plan.removed) {
      held.delete(dotId);
      await deleteDotThread(dotId);
    }
  },
});

/* A change here goes to disk soon, not at the watcher's next poll (30s apart while it watches);
   a streaming message changes the thread on every token, so this waits for it to settle. */
let soon: ReturnType<typeof setTimeout> | undefined;
const passSoon = () => {
  clearTimeout(soon);
  soon = setTimeout(requestSyncedFolderPass, 2000);
  (soon as unknown as { unref?: () => void }).unref?.();
};
sparkDots.listen(passSoon);
dotThreads.listen(passSoon);
