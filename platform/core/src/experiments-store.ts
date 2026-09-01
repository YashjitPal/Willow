/**
 * Labs experiment flags.
 *
 * Experiments are opt-in and default to off, so a fresh profile behaves exactly
 * as it did before any experiment existed. State is mirrored into localStorage
 * under one key so a reload does not silently revert a toggle the user just set.
 *
 * Deliberately a nanostore rather than a React context: the flags are read from
 * both feature code and settings UI that sit in different parts of the tree, and
 * a store avoids threading another provider through App.tsx.
 */

import { atom } from 'nanostores';

export type ExperimentId =
  | 'darker-design-background'
  | 'design-surface'
  | 'agents-surface';

export type ExperimentFlags = Record<ExperimentId, boolean>;

const STORAGE_KEY = 'willow:experiments';

export const EXPERIMENT_DEFAULTS: ExperimentFlags = {
  'darker-design-background': false,
  'design-surface': false,
  'agents-surface': false,
};

/**
 * Read persisted flags, ignoring anything unrecognised.
 *
 * Unknown keys are dropped rather than merged: a flag removed from the codebase
 * should not linger in a user's storage and reappear if the id is ever reused.
 */
const readStoredFlags = (): ExperimentFlags => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EXPERIMENT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const next: Record<string, boolean> = { ...EXPERIMENT_DEFAULTS };
    for (const id of Object.keys(EXPERIMENT_DEFAULTS) as ExperimentId[]) {
      if (typeof parsed?.[id] === 'boolean') next[id as string] = parsed[id] as boolean;
    }
    return next as unknown as ExperimentFlags;
  } catch {
    // Corrupt or unavailable storage must not stop the app booting.
    return { ...EXPERIMENT_DEFAULTS };
  }
};

export const experimentsStore = atom<ExperimentFlags>(readStoredFlags());

export const setExperiment = (id: ExperimentId, enabled: boolean): void => {
  const next = { ...experimentsStore.get(), [id]: enabled };
  experimentsStore.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A failed write only costs persistence; the in-memory flag still applies.
  }
};

export const isExperimentEnabled = (id: ExperimentId): boolean =>
  experimentsStore.get()[id] ?? EXPERIMENT_DEFAULTS[id];
