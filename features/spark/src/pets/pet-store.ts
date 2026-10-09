/**
 * What the pet keeps: its settings, which pet it is, where it was left, and the
 * rest of what BetterGravity's Pets plugin kept in `plugin.storage`.
 *
 * In localStorage, because every tab is a page of its own: the Pets page in one
 * tab changes what the tab keeping the pet (pets-controller.ts) draws, and each
 * tab's store follows the others' writes through `storage` events.
 */
import { atom, type ReadableAtom } from 'nanostores';

const PREFIX = 'willow:pets:';

export type PetHome = 'desktop' | 'window';
export type PetForce =
  | 'auto' | 'idle' | 'running' | 'waiting' | 'review' | 'failed'
  | 'waving' | 'jumping' | 'running-left' | 'running-right';
export type PetBadgeCorner = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';

export interface PetSettings {
  /** On the desktop, in a window of its own, or inside Willow's window. */
  home: PetHome;
  /** Width in pixels; Codex allows 80 to 224. */
  size: number;
  /** Activity cards, and an indicator coloured by the most important one. */
  activity: boolean;
  /** Whether a flick carries the pet on and bounces it off the edges. */
  bounce: boolean;
  /** A URL to a sheet of one's own; empty uses the chosen pet. */
  sheet: string;
  /** One animation held still, for looking at it. */
  force: PetForce;
}

export const PET_MIN_WIDTH = 80;
export const PET_MAX_WIDTH = 224;
export const PET_DEFAULT_WIDTH = 113;

export const PET_FORCES: readonly { value: PetForce; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'idle', label: 'Idle' },
  { value: 'running', label: 'Working' },
  { value: 'waiting', label: 'Needs input' },
  { value: 'review', label: 'Ready' },
  { value: 'failed', label: 'Blocked' },
  { value: 'waving', label: 'Waving' },
  { value: 'jumping', label: 'Jumping' },
  { value: 'running-left', label: 'Running left' },
  { value: 'running-right', label: 'Running right' },
];

const BADGE_CORNERS: readonly PetBadgeCorner[] = ['top-start', 'top-end', 'bottom-start', 'bottom-end'];

const DEFAULT_SETTINGS: PetSettings = {
  home: 'desktop',
  size: PET_DEFAULT_WIDTH,
  activity: true,
  bounce: false,
  sheet: '',
  force: 'auto',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeSettings = (value: unknown): PetSettings => {
  const saved = isRecord(value) ? value : {};
  const size = typeof saved.size === 'number' && Number.isFinite(saved.size) ? saved.size : PET_DEFAULT_WIDTH;
  return {
    home: saved.home === 'window' ? 'window' : 'desktop',
    size: Math.round(Math.min(PET_MAX_WIDTH, Math.max(PET_MIN_WIDTH, size))),
    activity: saved.activity !== false,
    bounce: saved.bounce === true,
    sheet: typeof saved.sheet === 'string' ? saved.sheet : '',
    force: PET_FORCES.some((force) => force.value === saved.force) ? saved.force as PetForce : 'auto',
  };
};

export interface Persisted<T> {
  store: ReadableAtom<T>;
  get(): T;
  set(value: T): void;
}

const followers = new Map<string, (raw: string | null) => void>();
let following = false;

const follow = (key: string, apply: (raw: string | null) => void): void => {
  followers.set(key, apply);
  if (following || typeof window === 'undefined') return;
  following = true;
  window.addEventListener('storage', (event) => {
    if (event.key === null) {
      for (const [name, update] of followers) update(window.localStorage.getItem(name));
      return;
    }
    followers.get(event.key)?.(event.newValue);
  });
};

const parse = (raw: string | null): unknown => {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

function persisted<T>(name: string, normalize: (value: unknown) => T): Persisted<T> {
  const key = PREFIX + name;
  const read = (): T => {
    try {
      return normalize(parse(typeof window === 'undefined' ? null : window.localStorage.getItem(key)));
    } catch {
      return normalize(undefined);
    }
  };
  const store = atom<T>(read());
  follow(key, (raw) => store.set(normalize(parse(raw))));
  return {
    store,
    get: () => store.get(),
    set(value) {
      store.set(value);
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // A full or unavailable storage keeps the value for this tab only.
      }
    },
  };
}

export const petSettings = persisted('settings', normalizeSettings);

const normalizeSelection = (value: unknown): string =>
  typeof value === 'string' && (value === 'rocky' || /^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) ? value : 'rocky';

/** `rocky`, the bundled pet, or `custom:<id>` from the pet library. */
export const petSelection = persisted('selectedPet', normalizeSelection);

/** Whether the pet is out. The paw flips it; it survives a restart. */
export const petShown = persisted('shown', (value) => value !== false);

export const petPosition = persisted<{ x: number; y: number } | null>('position', (value) =>
  isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x as number, y: value.y as number } : null);

/** The badge's own choice of whether the activity pills are out. */
export const petPillsVisible = persisted('activityPillsVisible', (value) => value !== false);

export const petBadgeCorner = persisted<PetBadgeCorner>('badgeCorner', (value) =>
  BADGE_CORNERS.includes(value as PetBadgeCorner) ? value as PetBadgeCorner : 'top-end');

/** The pets that have introduced themselves, by the sheet they wear: once per pet, ever. */
export const petGreeted = persisted<string[]>('greeted', (value) =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);

export interface PetDetails {
  displayName: string;
  description: string;
}

const normalizeDetails = (value: unknown): Record<string, PetDetails> => {
  if (!isRecord(value)) return {};
  const details: Record<string, PetDetails> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.displayName !== 'string') continue;
    details[id] = {
      displayName: entry.displayName.trim().slice(0, 100),
      description: typeof entry.description === 'string' ? entry.description.slice(0, 500) : '',
    };
  }
  return details;
};

/** Names and descriptions given on the Pets page, by pet id (including Rocky's). */
export const petDetails = persisted<Record<string, PetDetails>>('petDetails', normalizeDetails);

/** The pet as the tab keeping it last described it, for the Pets page's status row. */
export const petStatusLine = persisted<string>('status', (value) => typeof value === 'string' ? value : '');

/** A pet with its names as given on the Pets page. */
export const withPetDetails = <T extends { id: string; displayName: string; description?: string }>(pet: T): T => {
  const saved = petDetails.get()[pet.id];
  if (!saved) return pet;
  return {
    ...pet,
    displayName: saved.displayName || pet.displayName,
    description: saved.description,
  };
};

export const setPetDetails = (id: string, details: PetDetails): void => {
  petDetails.set({ ...petDetails.get(), [id]: { displayName: details.displayName.trim().slice(0, 100), description: details.description.slice(0, 500) } });
};

/** Which pet, and every name given, from outside the Pets page (`settings.json`), held to its limits. */
export const choosePet = (value: unknown): void => petSelection.set(normalizeSelection(value));
export const replacePetDetails = (value: unknown): void => petDetails.set(normalizeDetails(value));

export const updatePetSettings = (update: Partial<PetSettings>): void => {
  const next = normalizeSettings({ ...petSettings.get(), ...update });
  petSettings.set(next);
  // A sheet of one's own replaces the chosen pet, as choosing a pet clears the sheet. Second, so a
  // tab hearing both hears the sheet first and redraws the pet instead of restarting it.
  if (update.sheet !== undefined && next.sheet.trim()) petSelection.set('rocky');
};
