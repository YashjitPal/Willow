import { atom } from 'nanostores';

import {
  emptyGemDraft,
  isGemDefaultTool,
  type Gem,
  type GemDraft,
  type GemKnowledgeFile,
} from './gem-types';
import { findPremadeGem, type PremadeGem } from './premade-gems';

export type { Gem } from './gem-types';

/**
 * The user's Gems.
 *
 * Persisted twice, for different reasons. localStorage (`willow_gems:v1`) is what makes
 * Gems work with no workspace folder connected — the same reason notebooks keep a local
 * registry. When a folder IS connected, `register.ts` mirrors the list to
 * `<workspace>/Gems/<id>.json` through the synced-folder engine, which owns revisions,
 * conflicts and delete-safety; its `applyRemote` replaces this store, and the
 * subscription below then writes the result back to localStorage.
 */
export const gemsStore = atom<Gem[]>([]);
export const gemsHydratedStore = atom(false);

const GEMS_KEY = 'willow_gems:v1';
const GEM_CHATS_KEY = 'willow_gem_chats:v1';

/**
 * Knowledge text is stored inline, and localStorage is one quota for the whole origin, so
 * each file's text is capped — beyond this the file is kept by name with a note.
 */
export const MAX_KNOWLEDGE_CHARS = 120_000;

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const parseKnowledge = (value: unknown): GemKnowledgeFile[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): GemKnowledgeFile[] => {
    if (!raw || typeof raw !== 'object') return [];
    const file = raw as Partial<GemKnowledgeFile>;
    if (typeof file.id !== 'string' || typeof file.name !== 'string') return [];
    return [{
      id: file.id,
      name: file.name,
      mimeType: asString(file.mimeType, 'application/octet-stream'),
      size: Number.isFinite(file.size) ? Number(file.size) : 0,
      // Absent rather than undefined, so a file round-trips to exactly what was written.
      ...(typeof file.content === 'string' ? { content: file.content } : {}),
      ...(typeof file.problem === 'string' ? { problem: file.problem } : {}),
      addedAt: Number.isFinite(file.addedAt) ? Number(file.addedAt) : 0,
    }];
  });
};

/**
 * Narrow one untrusted record — from localStorage or a hand-edited file on disk — into a
 * Gem, or null. Lenient on everything but the name: older files only had the four
 * original fields, and they must keep loading.
 */
export const parseGem = (id: string, raw: unknown): Gem | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<Gem>;
  if (typeof value.name !== 'string') return null;
  return {
    id,
    name: value.name,
    description: asString(value.description),
    instructions: asString(value.instructions),
    // Files written before default tools had ids stored the menu label instead.
    defaultTool: isGemDefaultTool(value.defaultTool) ? value.defaultTool : 'none',
    knowledge: parseKnowledge(value.knowledge),
    hideCitations: value.hideCitations === true,
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : 0,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0,
  };
};

/** Most recently changed first, which is the order Gemini's My Gems list keeps. */
export const sortGems = (gems: readonly Gem[]): Gem[] =>
  [...gems].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));

const readStoredGems = (): Gem[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(GEMS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const gem = entry && typeof entry.id === 'string' ? parseGem(entry.id, entry) : null;
      return gem ? [gem] : [];
    });
  } catch {
    return [];
  }
};

/** Last write that failed, so the editor can say why a save did not stick. */
export const gemsWriteErrorStore = atom<string | null>(null);

let writing = false;
gemsStore.subscribe((gems) => {
  if (!gemsHydratedStore.get() || typeof localStorage === 'undefined') return;
  writing = true;
  try {
    localStorage.setItem(GEMS_KEY, JSON.stringify(gems));
    gemsWriteErrorStore.set(null);
  } catch {
    gemsWriteErrorStore.set('Your Gems could not be saved in this browser. Try removing some knowledge files.');
  } finally {
    writing = false;
  }
});

/** Read the stored Gems once, and follow writes from other tabs. Safe to call repeatedly. */
export const hydrateGems = (): void => {
  if (gemsHydratedStore.get() || typeof localStorage === 'undefined') return;
  const stored = readStoredGems();
  // A synced folder may have populated the store first; keep both, disk winning per id.
  const byId = new Map(stored.map((gem) => [gem.id, gem]));
  for (const gem of gemsStore.get()) byId.set(gem.id, gem);
  gemsHydratedStore.set(true);
  gemsStore.set(sortGems([...byId.values()]));
  window.addEventListener('storage', (event) => {
    if (event.key === GEMS_KEY && !writing) gemsStore.set(sortGems(readStoredGems()));
    if (event.key === GEM_CHATS_KEY) gemChatIndexStore.set(readGemChatIndex());
  });
};

/**
 * Build an id that survives a filesystem round trip.
 *
 * The synced-folder engine rejects ids containing `\/:*?"<>|`, so they are stripped here
 * instead of being silently rewritten later — a rename between "the id I hold" and "the
 * id on disk" is exactly what made a chat vanish once.
 */
export const makeGemId = (name: string): string => {
  const base = name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120);
  return base || `gem-${Date.now()}`;
};

/**
 * `makeGemId`, de-duplicated: two Gems may share a name, and a custom Gem must not take a
 * premade one's slug, or `/gem/<id>` would point at two things.
 */
const uniqueGemId = (name: string): string => {
  const base = makeGemId(name);
  const taken = new Set(gemsStore.get().map((gem) => gem.id.toLocaleLowerCase()));
  const free = (id: string) => !taken.has(id.toLocaleLowerCase()) && !findPremadeGem(id);
  if (free(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (free(candidate)) return candidate;
  }
};

export const getGem = (id: string): Gem | undefined => gemsStore.get().find((gem) => gem.id === id);

export const createGem = (draft: GemDraft): Gem => {
  const now = Date.now();
  const gem: Gem = { ...draft, name: draft.name.trim(), id: uniqueGemId(draft.name.trim()), createdAt: now, updatedAt: now };
  gemsStore.set(sortGems([gem, ...gemsStore.get()]));
  return gem;
};

export const updateGem = (id: string, draft: GemDraft): Gem | undefined => {
  const current = getGem(id);
  if (!current) return undefined;
  const next: Gem = { ...current, ...draft, name: draft.name.trim(), id, updatedAt: Date.now() };
  gemsStore.set(sortGems(gemsStore.get().map((gem) => (gem.id === id ? next : gem))));
  return next;
};

export const deleteGem = (id: string): void => {
  gemsStore.set(gemsStore.get().filter((gem) => gem.id !== id));
};

/** Kept for the synced-folder seam and older callers. */
export const upsertGem = (gem: Gem): void => {
  const exists = gemsStore.get().some((candidate) => candidate.id === gem.id);
  gemsStore.set(sortGems(exists ? gemsStore.get().map((g) => (g.id === gem.id ? gem : g)) : [gem, ...gemsStore.get()]));
};

export const removeGem = deleteGem;

/** "Make a copy": the editor opens on this, and nothing exists until it is saved. */
export const copyGemDraft = (source: Gem | PremadeGem): GemDraft => ({
  ...emptyGemDraft(),
  name: `Copy of ${source.name}`,
  description: source.description,
  instructions: source.instructions,
  defaultTool: source.defaultTool,
  knowledge: 'knowledge' in source ? source.knowledge.map((file) => ({ ...file })) : [],
  hideCitations: 'hideCitations' in source ? source.hideCitations : false,
});

/** What a Gem route points at: one of the user's Gems, or a premade one. */
export type ResolvedGem =
  | { kind: 'custom'; gem: Gem }
  | { kind: 'premade'; gem: PremadeGem };

export const resolveGem = (id: string | null | undefined, gems: readonly Gem[] = gemsStore.get()): ResolvedGem | null => {
  if (!id) return null;
  const custom = gems.find((gem) => gem.id === id);
  if (custom) return { kind: 'custom', gem: custom };
  const premade = findPremadeGem(id);
  return premade ? { kind: 'premade', gem: premade } : null;
};

// ── Which chats belong to which Gem ──────────────────────────────────────────

const readGemChatIndex = (): Record<string, string> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(GEM_CHATS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, gemId]) => typeof gemId === 'string')) as Record<string, string>;
  } catch {
    return {};
  }
};

/**
 * Chat id → Gem id, so a Gem chat reopened from Recents is still that Gem's. A chat file
 * carries no Gem field of its own, and a chat's id changes once when its title is
 * generated, so both ids are recorded as they appear.
 */
export const gemChatIndexStore = atom<Record<string, string>>(
  typeof localStorage === 'undefined' ? {} : readGemChatIndex(),
);

export const recordGemChat = (chatId: string, gemId: string): void => {
  const index = gemChatIndexStore.get();
  if (index[chatId] === gemId) return;
  const next = { ...index, [chatId]: gemId };
  gemChatIndexStore.set(next);
  try {
    localStorage.setItem(GEM_CHATS_KEY, JSON.stringify(next));
  } catch {
    // The association is a convenience; a full quota must not break the chat.
  }
};

export const gemIdForChat = (chatId: string | null | undefined): string | null =>
  (chatId ? gemChatIndexStore.get()[chatId] ?? null : null);

/** Chat-to-Gem links as `settings.json` has them; anything but a map of ids leaves them as they are. */
export const replaceGemChatIndex = (value: unknown): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const next = Object.fromEntries(Object.entries(value).filter(([chatId, gemId]) => chatId && typeof gemId === 'string' && gemId)) as Record<string, string>;
  if (JSON.stringify(next) === JSON.stringify(gemChatIndexStore.get())) return;
  gemChatIndexStore.set(next);
  try {
    localStorage.setItem(GEM_CHATS_KEY, JSON.stringify(next));
  } catch {
    // The association is a convenience; a full quota must not break the chat.
  }
};
