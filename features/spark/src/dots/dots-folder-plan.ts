/**
 * Bots in the user's folder (`Spark/Dots/<bot id>.json`): one file per bot, holding the bot and all
 * of its conversation — messages, notebook, episodes, and the runtime with its triggers, approved
 * commands and computer — so a bot outlives the browser storage it was made in, and every copy of
 * Willow on the folder (the desktop app, Willow in a browser) has it.
 *
 * Pure: what a file holds, and what a pass does with what disk hands back. The stores and the
 * registration are `dots-folder.ts`.
 *
 * A copy of Willow never loses what it has. A bot it does not have is added; a conversation disk
 * carries further than this copy's is brought up to date; one that went another way here is kept
 * as it is — each copy numbers a bot's messages itself, so two histories cannot be merged message
 * by message — and written back only once it changes here again. A bot whose file is deleted (it
 * was deleted in another copy) goes here too.
 */
import type { SparkDot } from './dots-store';
import type { DotItem, DotThread } from './harness/thread/thread-types';

export const DOTS_FOLDER = 'Spark/Dots';

/** A bot's file. `thread` is null while the bot has no conversation yet (a bot from before the
 *  harness keeps its old messages on the bot until its thread is made from them). */
export interface DotFile {
  version: 1;
  dot: SparkDot;
  thread: DotThread | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Every object's keys in order: a conversation read from IndexedDB and the same one loaded in
 *  memory have them in different orders, and a file must not change with the way it was read. */
const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, sorted(value[key])]));
};

/** What a file keeps of a dot: everything but what only this session knows. */
const fileDot = (dot: SparkDot): SparkDot => {
  const { isReplying: _isReplying, ...rest } = dot;
  return { ...rest, status: 'ready' };
};

/** A conversation as it is written: its settled items (a streaming message is written once it closes). */
const fileThread = (thread: DotThread | null): DotThread | null =>
  thread && { ...thread, items: thread.items.filter((item) => !item.streaming) };

export const serializeDotFile = (dot: SparkDot, thread: DotThread | null): string =>
  JSON.stringify(sorted({ version: 1, dot: fileDot(dot), thread: fileThread(thread) } satisfies DotFile), null, 2);

const isItem = (value: unknown): value is DotItem =>
  isRecord(value)
  && typeof value.id === 'string'
  && Number.isSafeInteger(value.seq)
  && typeof value.kind === 'string'
  && typeof value.at === 'number'
  && typeof value.text === 'string';

const isThread = (value: unknown, dotId: string): value is DotThread =>
  isRecord(value)
  && value.dotId === dotId
  && Array.isArray(value.items)
  && value.items.every(isItem)
  && Number.isSafeInteger(value.nextSeq)
  && Array.isArray(value.episodes)
  && isRecord(value.notebook)
  && isRecord(value.runtime);

/**
 * Reads a file disk handed back, which anyone may have edited: `null` for anything that is not a
 * bot's file under its own name — malformed JSON, another version, a dot of another id (the
 * engine's "(Disk conflict …)" copies among them).
 */
export const parseDotFile = (id: string, contents: string): DotFile | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.dot)) return null;
  const dot = raw.dot;
  if (dot.id !== id || typeof dot.presetId !== 'string' || typeof dot.createdAt !== 'number' || typeof dot.updatedAt !== 'number') return null;
  const thread: unknown = raw.thread ?? null;
  if (thread !== null && !isThread(thread, id)) return null;
  return {
    version: 1,
    dot: {
      ...(dot as unknown as SparkDot),
      name: typeof dot.name === 'string' ? dot.name : null,
      appearance: typeof dot.appearance === 'string' ? dot.appearance : null,
      petId: typeof dot.petId === 'string' ? dot.petId : null,
      category: typeof dot.category === 'string' ? dot.category : null,
      messages: Array.isArray(dot.messages) ? (dot.messages as SparkDot['messages']) : [],
      status: 'ready',
    },
    thread: thread as DotThread | null,
  };
};

const canonical = (value: unknown): string => JSON.stringify(sorted(value)) ?? 'null';

/** One message in both copies. Each copy numbers a bot's messages itself, so a number, an id and even
 *  a time can be shared by two different messages; what they say tells them apart. */
const sameItem = (a: DotItem, b: DotItem): boolean =>
  a.seq === b.seq && a.id === b.id && a.at === b.at && a.kind === b.kind && a.text === b.text;

/**
 * How the conversation disk holds stands to this copy's: the same, further along (this copy's
 * items, each where it was, and maybe more), behind (disk lacks items this copy has), or diverged.
 * A message still streaming here counts as one disk lacks.
 */
export type ThreadRelation = 'same' | 'ahead' | 'behind' | 'diverged';

export const threadRelation = (local: DotThread | null, remote: DotThread | null): ThreadRelation => {
  if (!remote) return local ? 'behind' : 'same';
  if (!local) return 'ahead';
  const shared = Math.min(local.items.length, remote.items.length);
  for (let index = 0; index < shared; index += 1) {
    if (!sameItem(local.items[index]!, remote.items[index]!)) return 'diverged';
  }
  if (local.items.length > remote.items.length) return 'behind';
  return canonical(local) === canonical(remote) ? 'same' : 'ahead';
};

/** This copy's bot with what its file on disk says of the bot itself. */
export const withFileRecord = (dot: SparkDot, file: SparkDot): SparkDot => ({
  ...dot,
  name: file.name,
  presetId: file.presetId,
  appearance: file.appearance,
  petId: file.petId,
  category: file.category,
  pinned: file.pinned,
  updatedAt: file.updatedAt,
});

export interface DotsApplyPlan {
  /** This copy's bots, with what disk changed of them. */
  updated: SparkDot[];
  /** Bots disk has that this copy does not, newest first. */
  added: SparkDot[];
  /** Conversations to write as disk has them: added bots', and ones disk carries further. */
  threads: Array<{ dotId: string; thread: DotThread }>;
  /** Bots whose conversation went its own way here, or is further along here: kept as they are. */
  held: string[];
  /** Bots deleted in another copy: their files are gone. */
  removed: string[];
}

/**
 * What a pass does with the files disk handed back. `read` is the bots this pass read here: only
 * those can have been deleted elsewhere — one made while the pass ran is simply not on disk yet.
 */
export const planDotsApply = (
  local: { dots: SparkDot[]; thread: (dotId: string) => DotThread | null },
  files: DotFile[],
  read: ReadonlySet<string>,
): DotsApplyPlan => {
  const onDisk = new Map(files.map((file) => [file.dot.id, file]));
  const plan: DotsApplyPlan = { updated: [], added: [], threads: [], held: [], removed: [] };
  for (const dot of local.dots) {
    const file = onDisk.get(dot.id);
    if (!file) {
      if (read.has(dot.id)) plan.removed.push(dot.id);
      continue;
    }
    const relation = threadRelation(local.thread(dot.id), file.thread);
    if (relation === 'behind' || relation === 'diverged') {
      plan.held.push(dot.id);
      continue;
    }
    plan.updated.push(withFileRecord(dot, file.dot));
    if (relation === 'ahead' && file.thread) plan.threads.push({ dotId: dot.id, thread: file.thread });
  }
  const here = new Set(local.dots.map((dot) => dot.id));
  const added = files.filter((file) => !here.has(file.dot.id)).sort((a, b) => b.dot.createdAt - a.dot.createdAt);
  for (const file of added) {
    plan.added.push(file.dot);
    if (file.thread) plan.threads.push({ dotId: file.dot.id, thread: file.thread });
  }
  return plan;
};
