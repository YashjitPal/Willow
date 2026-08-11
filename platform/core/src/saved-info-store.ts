/**
 * Saved Info — the instructions the user has explicitly told Willow to remember.
 *
 * Settings → Personal Intelligence → Saved Info writes these; a chat turn reads
 * them. Those two live in different parts of the tree, so this is a nanostore
 * mirrored into localStorage rather than a React context, matching
 * `experiments-store` and `voice-settings-store`.
 *
 * Durable storage is the user's own folder, not this browser: once a folder is
 * connected, every edit is written to `<folder>/<workspace>/Personal/saved-info.json`
 * through the adapter passed to `attachSavedInfoDisk`. localStorage remains as
 * the instant-read mirror the store boots from — see that function for why both
 * exist.
 *
 * The default is EMPTY. A saved instruction is something the user typed on
 * purpose about themselves, so there is no sensible thing to ship in its place —
 * a fresh profile that already "remembers" facts about a stranger is worse than
 * one that remembers nothing. (An earlier revision seeded thirty real entries,
 * including a name, a birthdate and two email addresses, into every install.)
 *
 * Entries are dated because Gemini's own prompt block renders them that way —
 * `- [2025-12-09] Keep your responses 3 sentences long.` — which lets the model
 * weigh a preference set last week against one set a year ago. `createdAt` is
 * optional: entries migrated from the older string-only format have no honest
 * date, and stamping them with today would be a made-up one.
 */

import { atom } from 'nanostores';

export type SavedInstruction = {
  /**
   * Stable across reorder, edit and delete. The list was keyed by array index
   * before, which is wrong here specifically: new entries are PREPENDED, so
   * every existing index shifts the moment one is added.
   */
  id: string;
  text: string;
  /** ISO-8601 instant. Absent on entries migrated from the pre-dated format. */
  createdAt?: string;
};

export type SavedInfoState = {
  /**
   * The master switch on the Saved Info page. Off means the entries stay
   * stored and visible in settings but never reach a prompt — the user asked
   * Willow to stop using them, not to forget them.
   */
  enabled: boolean;
  instructions: SavedInstruction[];
};

const STORAGE_KEY = 'willow:saved-info';

/**
 * The shape this used to be: a bare `string[]` under its own key, written by the
 * settings page and read by nothing. Migrated on first load so a user who
 * already typed instructions keeps them.
 */
const LEGACY_STORAGE_KEY = 'willow-saved-instructions';

export const SAVED_INFO_DEFAULTS: SavedInfoState = { enabled: true, instructions: [] };

let idCounter = 0;

const newId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Non-secure contexts throw rather than returning undefined.
  }
  idCounter += 1;
  return `si-${Date.now().toString(36)}-${idCounter}`;
};

/** Drop anything that is not a non-empty string, and normalise the rest. */
const toInstruction = (value: unknown): SavedInstruction | null => {
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? { id: newId(), text } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SavedInstruction>;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    text,
    ...(typeof raw.createdAt === 'string' && raw.createdAt ? { createdAt: raw.createdAt } : {}),
  };
};

const readStored = (): SavedInfoState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedInfoState>;
      return {
        enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : SAVED_INFO_DEFAULTS.enabled,
        instructions: Array.isArray(parsed?.instructions)
          ? parsed.instructions.map(toInstruction).filter((entry): entry is SavedInstruction => entry !== null)
          : [],
      };
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown;
      if (Array.isArray(parsed)) {
        return {
          enabled: true,
          instructions: parsed
            .map(toInstruction)
            .filter((entry): entry is SavedInstruction => entry !== null),
        };
      }
    }

    return { ...SAVED_INFO_DEFAULTS, instructions: [] };
  } catch {
    // Corrupt or unavailable storage must not stop the app booting.
    return { ...SAVED_INFO_DEFAULTS, instructions: [] };
  }
};

export const savedInfoStore = atom<SavedInfoState>(readStored());

/**
 * The disk half of persistence, injected rather than imported.
 *
 * These instructions live in the folder the user chose for their own data —
 * `<folder>/<workspace>/Personal/saved-info.json` — so they survive clearing
 * site data and travel with the rest of their files. That folder is reached
 * through the File System Access layer in `@willow/storage`, which is a React
 * context holding a directory handle and cannot be imported from here without
 * pointing this package at the one above it. So the provider hands the two
 * operations in instead.
 *
 * localStorage stays as the mirror, and is what the store boots from. It has to:
 * `savedInfoBlock()` builds a prompt synchronously, a directory handle needs an
 * async permission check, and there is no folder at all until the user connects
 * one. Disk is the durable copy; localStorage is the copy available instantly.
 */
export type SavedInfoDisk = {
  /** `null` when there is no folder, no permission, or no file yet — never "clear it". */
  load: () => Promise<Partial<SavedInfoState> | null>;
  save: (state: SavedInfoState) => Promise<boolean>;
  /** Called when nothing is saved any more, so the folder keeps no stale copy. */
  remove?: () => Promise<boolean>;
};

let disk: SavedInfoDisk | null = null;

const commit = (next: SavedInfoState, { toDisk = true } = {}): void => {
  savedInfoStore.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A failed write only costs persistence; the in-memory state still applies.
  }
  if (!toDisk || !disk) return;
  // Fire and forget. A settings toggle must not wait on a filesystem round trip,
  // and the disk writer reports failure by returning false rather than throwing.
  if (next.instructions.length === 0 && next.enabled && disk.remove) {
    void disk.remove();
  } else {
    void disk.save(next);
  }
};

/**
 * Point the store at the user's folder, adopting whatever is already there.
 *
 * Call this only once the workspace name is real. It is the name of the folder
 * the write path creates, and it falls back to "My Willow" until the profile
 * loads — attaching too early is how junk folders get minted under the fallback.
 *
 * Disk wins over localStorage when a file exists, because the file is the copy
 * that survives a reinstall or a second browser. When the folder has no file yet
 * but instructions are already sitting in localStorage, those get written out —
 * that is the one-time migration for anyone who typed instructions before this
 * existed. Pass `null` to detach when the folder is disconnected.
 */
export const attachSavedInfoDisk = async (next: SavedInfoDisk | null): Promise<void> => {
  disk = next;
  if (!disk) return;

  const stored = await disk.load();
  if (stored) {
    const instructions = Array.isArray(stored.instructions)
      ? stored.instructions.map(toInstruction).filter((entry): entry is SavedInstruction => entry !== null)
      : savedInfoStore.get().instructions;
    commit(
      {
        enabled: typeof stored.enabled === 'boolean' ? stored.enabled : savedInfoStore.get().enabled,
        instructions,
      },
      // Nothing changed on disk — writing back would only re-stamp updatedAt.
      { toDisk: false },
    );
    return;
  }

  const current = savedInfoStore.get();
  if (current.instructions.length > 0) void disk.save(current);
};

export const setSavedInfoEnabled = (enabled: boolean): void => {
  commit({ ...savedInfoStore.get(), enabled });
};

/**
 * Newest first, matching both the settings list and the order Gemini renders
 * them in — the most recent instruction is the one most likely to still hold.
 */
export const addSavedInstruction = (text: string): void => {
  const trimmed = text.trim();
  if (!trimmed) return;
  const state = savedInfoStore.get();
  const entry: SavedInstruction = { id: newId(), text: trimmed, createdAt: new Date().toISOString() };
  commit({ ...state, instructions: [entry, ...state.instructions] });
};

/**
 * Editing keeps the original date. The entry is the same remembered thing with
 * its wording corrected, not a new one, and re-dating it would quietly promote
 * an old preference above instructions the user has genuinely set since.
 */
export const updateSavedInstruction = (id: string, text: string): void => {
  const trimmed = text.trim();
  if (!trimmed) return;
  const state = savedInfoStore.get();
  commit({
    ...state,
    instructions: state.instructions.map((entry) =>
      entry.id === id ? { ...entry, text: trimmed } : entry,
    ),
  });
};

export const removeSavedInstruction = (id: string): void => {
  const state = savedInfoStore.get();
  commit({ ...state, instructions: state.instructions.filter((entry) => entry.id !== id) });
};

export const clearSavedInstructions = (): void => {
  commit({ ...savedInfoStore.get(), instructions: [] });
};

/**
 * `YYYY-MM-DD` in the user's own timezone, or null when the entry predates
 * dating. Local rather than UTC: the date is shown back to the person who set
 * it, and an instruction saved at 9pm should not read as tomorrow.
 */
export const savedInstructionDate = (entry: SavedInstruction): string | null => {
  if (!entry.createdAt) return null;
  const at = new Date(entry.createdAt);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};
