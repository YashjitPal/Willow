/**
 * The pet library as a page sees it: the pets on this computer, their first
 * frames, and the one chosen. The packages themselves are the desktop app's
 * (validated there); this only reads them, draws from them, and chooses.
 */
import { atom } from 'nanostores';
import {
  loadDesktopPet,
  openDesktopPetFolder,
  readDesktopPets,
  type DesktopPetLibrary,
  type DesktopPetSprite,
} from '@willow/core/desktop-bridge';
import { petSelection, petSettings, updatePetSettings } from './pet-store';

export interface PetLibraryView {
  state: DesktopPetLibrary | null;
  error: string;
  /** Choosing or creating: the library's buttons wait. */
  busy: boolean;
  creating: boolean;
  /** Each pet's first frame, by id. */
  previews: Record<string, string>;
  /** The chosen pet's sheet, when it is one from the library. */
  selected: DesktopPetSprite | null;
}

export const petLibrary = atom<PetLibraryView>({ state: null, error: '', busy: false, creating: false, previews: {}, selected: null });

const patch = (update: Partial<PetLibraryView>): void => petLibrary.set({ ...petLibrary.get(), ...update });

/** At most eight sheets kept decoded-ready, as the plugin's own cache. */
const SPRITE_CACHE = 8;
const sprites = new Map<string, DesktopPetSprite>();
const previews = new Map<string, { stamp: string; url: string }>();

/** A pet's sheet, reloaded only when its package changed. */
export async function loadPetSprite(id: string, stamp?: string): Promise<DesktopPetSprite> {
  const cached = sprites.get(id);
  if (cached && stamp !== undefined && cached.stamp === stamp) return cached;
  const sprite = await loadDesktopPet(id);
  sprites.delete(id);
  sprites.set(id, sprite);
  if (sprites.size > SPRITE_CACHE) sprites.delete(sprites.keys().next().value!);
  return sprite;
}

/** The first cell of a sheet, 192 × 208: how a pet looks in a list. */
async function firstFrame(sheet: string): Promise<string> {
  const image = new Image();
  image.src = sheet;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 208;
  canvas.getContext('2d')?.drawImage(image, 0, 0, 192, 208, 0, 0, 192, 208);
  const url = canvas.toDataURL('image/png');
  canvas.width = canvas.height = 0;
  return url;
}

let request = 0;
let refreshing = false;
let pending = false;

/** Reads the library again. A burst of folder changes makes one follow-up read, not one each. */
export async function refreshPetLibrary(): Promise<void> {
  if (refreshing || petLibrary.get().busy) {
    pending = true;
    return;
  }
  refreshing = true;
  const mine = ++request;
  try {
    const state = await readDesktopPets();
    const issues = state.message ? [state.message] : [];
    const drawn: Record<string, string> = {};
    for (const pet of state.pets) {
      const known = previews.get(pet.id);
      if (known?.stamp === pet.stamp) {
        drawn[pet.id] = known.url;
        continue;
      }
      try {
        const url = await firstFrame((await loadPetSprite(pet.id, pet.stamp)).spritesheetDataUrl);
        previews.set(pet.id, { stamp: pet.stamp, url });
        drawn[pet.id] = url;
      } catch (error) {
        issues.push(`${pet.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (mine !== request) return;
    const selection = petSelection.get();
    const chosen = selection.startsWith('custom:') ? state.pets.find((pet) => pet.id === selection.slice(7)) : undefined;
    const selected = chosen ? await loadPetSprite(chosen.id, chosen.stamp) : null;
    if (mine !== request) return;
    patch({ state, error: issues.join('\n'), previews: drawn, selected });
  } catch (error) {
    if (mine === request) patch({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    refreshing = false;
    if (pending && !petLibrary.get().busy) {
      pending = false;
      void refreshPetLibrary();
    }
  }
}

/** Makes `rocky` or `custom:<id>` the live pet. Choosing one clears a sheet URL of one's own. */
export async function selectPet(id: string): Promise<void> {
  const mine = ++request;
  patch({ busy: true });
  try {
    if (id !== 'rocky' && !id.startsWith('custom:')) throw new Error('Unknown pet selection.');
    const sprite = id === 'rocky' ? null : await loadPetSprite(id.slice(7));
    if (mine !== request) return;
    if (petSettings.get().sheet) updatePetSettings({ sheet: '' });
    petSelection.set(id);
    patch({ selected: sprite, error: '' });
  } catch (error) {
    patch({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    patch({ busy: false });
    if (pending) {
      pending = false;
      void refreshPetLibrary();
    }
  }
}

export async function openPetFolder(): Promise<void> {
  try {
    await openDesktopPetFolder();
  } catch (error) {
    patch({ error: error instanceof Error ? error.message : String(error) });
  }
}

export const setPetLibraryCreating = (creating: boolean, error = ''): void => patch({ busy: creating, creating, error });
