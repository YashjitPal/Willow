/**
 * Which live model voice mode opens a session with.
 *
 * Separate from the composer's `selectedModelId` on purpose: that one is the
 * text model, and voice mode running does not mean the user wants their next
 * typed message answered by a live model. The picker swaps which of the two it
 * is editing while a session is up — see `voiceModels` in ModelsMenu.tsx.
 *
 * A nanostore for the same reason [voice-settings-store.ts] is one: written by
 * the composer's picker, read by ChatView when it opens a session, and those sit
 * in different parts of the tree.
 *
 * With a single registered model this always resolves to that model, so nothing
 * observable changes until a second one is added to VOICE_PROVIDERS.
 */

import { atom } from 'nanostores';

import { resolveVoiceModelId } from './voice-providers';

const STORAGE_KEY = 'willow:live-model';

const readStored = (): string => {
  try {
    // Resolved on read rather than trusted: a stored id from a build that had a
    // model this one does not would otherwise go straight onto the wire.
    return resolveVoiceModelId(localStorage.getItem(STORAGE_KEY) ?? undefined);
  } catch {
    // Corrupt or unavailable storage must not stop the app booting.
    return resolveVoiceModelId(undefined);
  }
};

export const liveModelStore = atom<string>(readStored());

/** The live model id to start a session with. Always a registered model. */
export const getLiveModelId = (): string => resolveVoiceModelId(liveModelStore.get());

export const setLiveModelId = (modelId: string): void => {
  const next = resolveVoiceModelId(modelId);
  liveModelStore.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A failed write only costs persistence; the in-memory choice still applies.
  }
};
