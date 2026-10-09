// Flow's Characters: the bound project's characters, outside React so the grid, the new-character
// page and the edit page share one copy. Saved through `@willow/storage/media-characters`.

import { atom } from 'nanostores';
import {
  deleteCharacter as deleteStoredCharacter,
  listCharacters,
  saveCharacter,
  type StoredCharacter,
} from '@willow/storage/media-characters';

export type Character = StoredCharacter;

export const UNTITLED_CHARACTER = 'Untitled character';

export const characterName = (c: Character): string => c.name.trim() || UNTITLED_CHARACTER;

/** The prompt a character's body is made from, with its portrait as the reference. */
export const fullBodyPrompt = (description: string): string =>
  `Full body shot, head to toe, of this same character in the same outfit, standing.${description ? ` ${description}` : ''}`;

export const $characters = atom<Character[]>([]);
/** True once the bound project's characters have been read; the tab waits for it. */
export const $charactersLoaded = atom(false);

let bound: { projectId: string; scopeId: string } | null = null;
let loadGeneration = 0;

export async function bindCharacterProject(projectId: string, scopeId: string): Promise<void> {
  const gen = ++loadGeneration;
  bound = projectId ? { projectId, scopeId } : null;
  $characters.set([]);
  $charactersLoaded.set(false);
  if (!projectId) { $charactersLoaded.set(true); return; }
  try {
    const list = await listCharacters(projectId, scopeId);
    if (gen === loadGeneration) $characters.set(list);
  } catch (error) {
    console.warn('[Characters] Could not load characters:', error);
  } finally {
    if (gen === loadGeneration) $charactersLoaded.set(true);
  }
}

export const getCharacter = (id: string): Character | undefined => $characters.get().find((c) => c.id === id);

function persist(character: Character): void {
  if (!bound) return;
  void saveCharacter(bound.projectId, character, bound.scopeId).catch((error) => console.warn('[Characters] Could not save:', error));
}

const uid = (): string =>
  `character-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;

export function createCharacter(seed: Partial<Character> = {}): Character {
  const now = Date.now();
  const character: Character = { id: uid(), name: '', createdAt: now, updatedAt: now, ...seed };
  $characters.set([...$characters.get(), character]);
  persist(character);
  return character;
}

export function updateCharacter(id: string, patch: Partial<Character>): Character | undefined {
  let updated: Character | undefined;
  $characters.set($characters.get().map((c) => {
    if (c.id !== id) return c;
    updated = { ...c, ...patch, updatedAt: Date.now() };
    return updated;
  }));
  if (updated) persist(updated);
  return updated;
}

export function deleteCharacter(id: string): void {
  $characters.set($characters.get().filter((c) => c.id !== id));
  if (bound) void deleteStoredCharacter(bound.projectId, id, bound.scopeId).catch(() => undefined);
}

/* ---- opening the pages: MediaView owns the route ---- */

let opener: ((target: string | null) => void) | null = null;

/** MediaView registers how a character page opens: `'new'`, a character id, or null to close. */
export function setCharacterOpener(fn: ((target: string | null) => void) | null): void {
  opener = fn;
}

export function openCharacter(target: string | null): void {
  opener?.(target);
}
