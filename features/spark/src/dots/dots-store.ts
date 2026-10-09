import { atom } from 'nanostores';
import { pendingEdits } from './harness/runtime/edits';
import { pendingScreenRequests } from './harness/runtime/screen-control';
import { pendingApprovals } from './harness/tools/computer-tools';
import { getDotThread } from './harness/thread/thread-store';

/**
 * Legacy message shape. Conversations now live in each bot's harness thread
 * (`harness/thread/`); these are only read once, to seed the thread of a bot
 * created before the harness existed.
 */
export interface SparkDotMessage {
  id: string;
  role: 'user' | 'dot';
  text: string;
  createdAt: number;
}

export interface SparkDot {
  id: string;
  /** The nickname; `null` until the user picks one, shown as "bot" like Codex. */
  name: string | null;
  /** The Codex orbit preset the character starts from, e.g. `blue_beret`. */
  presetId: string;
  /** Base64 ORBAST1 bytes once the character has been customised in the editor. */
  appearance: string | null;
  petId: string | null;
  /** `creating` while the new bot is being set up, as in Codex. */
  status: 'creating' | 'ready';
  category: string | null;
  /** Pinned from the bot's menu, as a task is: listed first. */
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  /** Messages from before the harness. Read once to seed the bot's thread; never written. */
  messages: SparkDotMessage[];
  /** Retired: whether a bot is working now comes from the harness runtime's `dotActivity`. */
  isReplying?: boolean;
}

export interface SparkDotsState {
  dots: SparkDot[];
  categories: string[];
}

export type SparkDotUpdate = Partial<Pick<SparkDot, 'name' | 'presetId' | 'appearance' | 'petId' | 'status'>>;

const STORAGE_KEY = 'willow:spark:dots:v2';
const LEGACY_STORAGE_KEY = 'willow:spark:dots:v1';

/** Codex's name for a bot without a nickname. */
export const DEFAULT_SPARK_DOT_NAME = 'bot';

export const sparkDotName = (dot: Pick<SparkDot, 'name'>): string => dot.name?.trim() || DEFAULT_SPARK_DOT_NAME;

/** Bots saved before they had Codex characters: the old colour picker gave way to a preset. */
const migrateLegacyDots = (fallbackPresetId: string): SparkDotsState | null => {
  const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null') as { dots?: Array<Record<string, unknown>>; categories?: string[] } | null;
  if (!legacy || !Array.isArray(legacy.dots) || !Array.isArray(legacy.categories)) return null;
  return {
    categories: legacy.categories,
    dots: legacy.dots.map((dot) => ({
      ...(dot as unknown as SparkDot),
      presetId: fallbackPresetId,
      appearance: null,
      petId: null,
      status: 'ready',
    })),
  };
};

/** Whether this page found a saved bots list it could not read, and started the bots over. */
let unreadableStoredDots = false;

const readStoredDots = (fallbackPresetId: string): SparkDotsState => {
  try {
    const stored = (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SparkDotsState | null) ?? migrateLegacyDots(fallbackPresetId);
    if (stored && Array.isArray(stored.dots) && Array.isArray(stored.categories)) {
      return { dots: stored.dots.map((dot) => ({ ...dot, isReplying: false, status: 'ready' })), categories: stored.categories };
    }
    unreadableStoredDots = stored !== null;
  } catch {
    // A corrupt entry starts the bots over rather than breaking Spark.
    unreadableStoredDots = true;
  }
  return { dots: [], categories: [] };
};

/** Once: whether the bots list this page started with was a saved one it could not read
 *  (`dots-folder.ts` then reads the bots back from the user's folder). */
export const takeUnreadableStoredDots = (): boolean => {
  const unreadable = unreadableStoredDots;
  unreadableStoredDots = false;
  return unreadable;
};

export const sparkDots = atom<SparkDotsState>(readStoredDots('blue_beret'));

sparkDots.listen((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable: the bots stay in memory for this session.
  }
});

const updateDot = (dotId: string, update: (dot: SparkDot) => SparkDot) => {
  const state = sparkDots.get();
  sparkDots.set({ ...state, dots: state.dots.map((dot) => (dot.id === dotId ? update(dot) : dot)) });
};

export const findSparkDot = (dotId: string | undefined): SparkDot | undefined =>
  dotId == null ? undefined : sparkDots.get().dots.find((dot) => dot.id === dotId);

/**
 * Adds the bot the Codex onboarding created. Its conversation starts empty: once
 * the bot is ready, the harness runtime has it introduce itself in its own words.
 */
export const insertSparkDot = ({ id, name, presetId, status }: Pick<SparkDot, 'id' | 'name' | 'presetId' | 'status'>): SparkDot => {
  const now = Date.now();
  const dot: SparkDot = {
    id,
    name,
    presetId,
    appearance: null,
    petId: null,
    status,
    category: null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  const state = sparkDots.get();
  sparkDots.set({ ...state, dots: [dot, ...state.dots] });
  return dot;
};

export const updateSparkDot = (dotId: string, update: SparkDotUpdate): void =>
  updateDot(dotId, (dot) => ({ ...dot, ...update, updatedAt: update.name === undefined ? dot.updatedAt : Date.now() }));

export const toggleSparkDotPin = (dotId: string): void => updateDot(dotId, (dot) => ({ ...dot, pinned: !dot.pinned }));

/** A bot the sidebar is opening expanded, with the bots list collapsed beside it; the open bot takes it once. */
export const sparkDotExpandRequest = atom<string | null>(null);

/*
 * Sending and stopping go through the harness runtime. It is imported lazily
 * because the runtime itself reads this store; a static import would make the
 * two modules depend on each other.
 */
const runtime = () => import('./harness/dot-runtime');

/** The user wrote to a bot. The runtime appends it to the thread and wakes the bot. */
export const sendSparkDotMessage = (dotId: string, text: string): void => {
  if (!text.trim() || findSparkDot(dotId) == null) return;
  void runtime().then((module) => {
    module.startDotsRuntime();
    return module.sendDotMessage(dotId, text);
  });
};

/** Stops what the bot is doing right now. */
export const stopSparkDotReply = (dotId: string): void => {
  void runtime().then((module) => module.interruptDot(dotId));
};

/** Starts a bot's conversation over and keeps everything else it has (the runtime's `resetDotConversation`). */
export const resetSparkDotConversation = async (dotId: string): Promise<void> => {
  if (findSparkDot(dotId) == null) return;
  await (await runtime()).resetDotConversation(dotId);
  // A bot from before the harness still carries the first messages of that same conversation on itself.
  if (findSparkDot(dotId)?.messages.length) updateDot(dotId, (dot) => ({ ...dot, messages: [] }));
};

export const addSparkDotCategory = (name: string): void => {
  const category = name.trim();
  const state = sparkDots.get();
  if (!category || state.categories.includes(category)) return;
  sparkDots.set({ ...state, categories: [...state.categories, category] });
};

export const setSparkDotCategory = (dotId: string, category: string | null): void => updateDot(dotId, (dot) => ({ ...dot, category }));

/**
 * Deletes a category. Its bots stay, filed under none: a bot still wearing it would bring the category back the next
 * time the bots folder is read (`applySyncedSparkDots`).
 */
export const deleteSparkDotCategory = (category: string): void => {
  const state = sparkDots.get();
  sparkDots.set({
    categories: state.categories.filter((candidate) => candidate !== category),
    dots: state.dots.map((dot) => (dot.category === category ? { ...dot, category: null } : dot)),
  });
};

/** Deletes a bot. The runtime notices and removes its thread and stops its work. */
export const deleteSparkDot = (dotId: string): void => {
  const state = sparkDots.get();
  sparkDots.set({ ...state, dots: state.dots.filter((dot) => dot.id !== dotId) });
};

/**
 * What a pass over the bots' folder (`dots-folder.ts`) found: bots it changed, bots another copy of
 * Willow made, and bots deleted there. Applied to the list as it is now, so a bot made or deleted
 * here while the pass ran stays made or deleted.
 */
export const applySyncedSparkDots = (updated: SparkDot[], added: SparkDot[], removed: string[]): void => {
  const state = sparkDots.get();
  const gone = new Set(removed);
  const changes = new Map(updated.map((dot) => [dot.id, dot]));
  const kept = state.dots
    .filter((dot) => !gone.has(dot.id))
    .map((dot) => {
      const change = changes.get(dot.id);
      return change ? { ...change, status: dot.status, isReplying: dot.isReplying } : dot;
    });
  const here = new Set(state.dots.map((dot) => dot.id));
  const dots = [...added.filter((dot) => !here.has(dot.id)), ...kept];
  const categories = [...state.categories];
  for (const dot of dots) if (dot.category && !categories.includes(dot.category)) categories.push(dot.category);
  const next = { dots, categories };
  if (JSON.stringify(next) !== JSON.stringify(state)) sparkDots.set(next);
};

const lastVisibleItem = (dot: SparkDot) => {
  const items = getDotThread(dot.id)?.items ?? [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if ((item.kind === 'user' || item.kind === 'dot') && item.text.trim()) return item;
  }
  return undefined;
};

/** The newest line a bot or its user wrote, for list rows — unless the bot is waiting on the user to approve a command. */
export const sparkDotPreview = (dot: SparkDot): string => {
  const thread = getDotThread(dot.id);
  if (thread && (pendingApprovals(thread).length > 0 || pendingEdits(thread).length > 0 || pendingScreenRequests(thread).length > 0)) return 'Waiting for your approval';
  return lastVisibleItem(dot)?.text ?? dot.messages.at(-1)?.text ?? '';
};

/** When the bot's conversation last moved, for sorting lists. */
export const sparkDotLastActivity = (dot: SparkDot): number => Math.max(dot.updatedAt, lastVisibleItem(dot)?.at ?? 0);

/** A draft waiting for a bot's composer, like Codex's `prefillPrompt` navigation state. */
export const sparkDotComposerPrefill = atom<{ dotId: string; text: string } | null>(null);

export const prefillSparkDotComposer = (dotId: string, text: string): void => sparkDotComposerPrefill.set({ dotId, text });
