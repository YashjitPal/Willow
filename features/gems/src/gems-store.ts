import { atom } from 'nanostores';

/**
 * A user-created Gem.
 *
 * The fields mirror what CreateGemView already collects, so persisting a gem
 * needs no new UI. `id` doubles as the on-disk file name stem (`Gems/<id>.json`),
 * which is why it is sanitized at creation rather than at save time — see
 * `makeGemId`.
 */
export interface Gem {
  id: string;
  name: string;
  description: string;
  instructions: string;
  /** Matches the tool picker's label, e.g. "No default tool". */
  defaultTool: string;
  createdAt: number;
  updatedAt: number;
}

export const gemsStore = atom<Gem[]>([]);

/**
 * Build an id that survives a filesystem round trip.
 *
 * The synced-folder engine rejects ids containing `\/:*?"<>|`, so they are
 * stripped here instead of being silently rewritten later — a rename between
 * "the id I hold" and "the id on disk" is exactly what made a chat vanish once.
 */
export const makeGemId = (name: string): string => {
  const base = name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120);
  return base || `gem-${Date.now()}`;
};

export const upsertGem = (gem: Gem): void => {
  const current = gemsStore.get();
  const index = current.findIndex((candidate) => candidate.id === gem.id);
  if (index === -1) {
    gemsStore.set([...current, gem]);
    return;
  }
  const next = [...current];
  next[index] = gem;
  gemsStore.set(next);
};

export const removeGem = (id: string): void => {
  gemsStore.set(gemsStore.get().filter((gem) => gem.id !== id));
};
