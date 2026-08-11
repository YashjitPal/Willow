/**
 * The profile the app reads and the settings page edits.
 *
 * Same shape as `@willow/core/saved-info-store` on purpose: a nanostore mirrored
 * into localStorage, with the durable copy in the user's own folder reached
 * through an injected adapter. The reasons are the same too — a chat turn and a
 * settings tab live in different parts of the tree, and `profileBlock()` builds a
 * prompt synchronously while a directory handle needs an async permission check.
 *
 * Durable storage is `<folder>/<workspace>/Personal/profile.json`, a sibling of
 * `saved-info.json`. Two files rather than one because they are written by
 * different things at different times — the user typing, and a batch job — and a
 * shared file would mean a build in progress could clobber an edit made while it
 * ran.
 *
 * The default is EMPTY, and this matters more here than it did for Saved Info: a
 * profile that ships with bullets in it is a stranger's guesses about the person
 * who just installed the app.
 */

import { atom } from 'nanostores';

import { PROFILE_SECTIONS, type ProfileSectionId } from './sections';
import {
  bulletFingerprint,
  PROFILE_DEFAULTS,
  type ProfileBullet,
  type ProfileState,
} from './types';

const STORAGE_KEY = 'willow:personal-profile';

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
  return `pb-${Date.now().toString(36)}-${idCounter}`;
};

const SECTION_IDS = new Set<string>(PROFILE_SECTIONS.map((section) => section.id));

/** `YYYY-MM-DD` only. A half-parsed date is worse than none: expiry runs off it. */
const asDate = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Adopt one bullet from storage, or drop it.
 *
 * A bullet with no text has nothing to say and a bullet with no known section has
 * nowhere to render, so both are dropped. Everything else is repaired: a missing
 * id gets one, a missing `origin` is treated as `auto` (the only thing that
 * existed before user edits did), and a missing `createdAt` is left as the epoch
 * rather than stamped with today — a made-up date would sort a year-old bullet to
 * the top of the list.
 */
export const adoptBullet = (value: unknown): ProfileBullet | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ProfileBullet>;
  const text = asText(raw.text);
  if (!text) return null;
  const section = typeof raw.section === 'string' && SECTION_IDS.has(raw.section)
    ? (raw.section as ProfileSectionId)
    : null;
  if (!section) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    section,
    text,
    source: asText(raw.source) || 'Willow chat history',
    evidence: asText(raw.evidence),
    ...(asDate(raw.date) ? { date: asDate(raw.date) } : {}),
    origin: raw.origin === 'user' ? 'user' : 'auto',
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date(0).toISOString(),
    ...(typeof raw.updatedAt === 'string' && raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
  };
};

/** Repair a whole state object from an untrusted source (storage, or disk). */
export const adoptProfileState = (parsed: unknown, fallback: ProfileState): ProfileState => {
  if (!parsed || typeof parsed !== 'object') return fallback;
  const raw = parsed as Partial<ProfileState>;
  const digested: Record<string, number> = {};
  if (raw.digested && typeof raw.digested === 'object') {
    for (const [chatId, at] of Object.entries(raw.digested)) {
      if (typeof at === 'number' && Number.isFinite(at)) digested[chatId] = at;
    }
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    bullets: Array.isArray(raw.bullets)
      ? raw.bullets.map(adoptBullet).filter((bullet): bullet is ProfileBullet => bullet !== null)
      : fallback.bullets,
    suppressed: Array.isArray(raw.suppressed)
      ? raw.suppressed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : fallback.suppressed,
    ...(typeof raw.lastBuiltAt === 'string' && raw.lastBuiltAt ? { lastBuiltAt: raw.lastBuiltAt } : {}),
    digested,
  };
};

const readStored = (): ProfileState => {
  const empty: ProfileState = { ...PROFILE_DEFAULTS, bullets: [], suppressed: [], digested: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    return adoptProfileState(JSON.parse(raw), empty);
  } catch {
    // Corrupt or unavailable storage must not stop the app booting.
    return empty;
  }
};

export const profileStore = atom<ProfileState>(readStored());

/**
 * The disk half of persistence, injected rather than imported.
 *
 * Identical arrangement to Saved Info's: the folder is reached through the File
 * System Access layer in `@willow/storage`, which is a React context holding a
 * directory handle and cannot be imported from a platform package below it, so
 * the provider hands the operations in instead.
 */
export type ProfileDisk = {
  /** `null` when there is no folder, no permission, or no file yet — never "clear it". */
  load: () => Promise<Partial<ProfileState> | null>;
  save: (state: ProfileState) => Promise<boolean>;
  /** Called when the profile is emptied, so the folder keeps no stale copy. */
  remove?: () => Promise<boolean>;
};

let disk: ProfileDisk | null = null;

/**
 * A build can take tens of seconds and writes once at the end. If the user
 * deleted a bullet while it ran, the build's own snapshot of the state is stale
 * and committing it would resurrect the deleted bullet. Every writer therefore
 * derives the next state from `profileStore.get()` at the moment it commits,
 * never from a value captured earlier — and the builder additionally checks this
 * counter to notice that it lost a race.
 */
let revision = 0;

export const profileRevision = (): number => revision;

const commit = (next: ProfileState, { toDisk = true } = {}): void => {
  revision += 1;
  profileStore.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A failed write only costs persistence; the in-memory state still applies.
  }
  if (!toDisk || !disk) return;
  // Fire and forget. A settings toggle must not wait on a filesystem round trip,
  // and the disk writer reports failure by returning false rather than throwing.
  const isEmpty = next.bullets.length === 0 && next.suppressed.length === 0 && !next.lastBuiltAt;
  if (isEmpty && next.enabled && disk.remove) {
    void disk.remove();
  } else {
    void disk.save(next);
  }
};

/**
 * Point the store at the user's folder, adopting whatever is already there.
 *
 * Same three rules as `attachSavedInfoDisk`, for the same reasons: call it only
 * once the workspace name is real, disk wins over localStorage when a file
 * exists, and a local-only profile migrates *into* an empty folder. Pass `null`
 * to detach when the folder is disconnected.
 */
export const attachProfileDisk = async (next: ProfileDisk | null): Promise<void> => {
  disk = next;
  if (!disk) return;

  const stored = await disk.load();
  if (stored) {
    // Nothing changed on disk — writing back would only re-stamp updatedAt.
    commit(adoptProfileState(stored, profileStore.get()), { toDisk: false });
    return;
  }

  const current = profileStore.get();
  if (current.bullets.length > 0 || current.suppressed.length > 0) void disk.save(current);
};

/** The Memory switch. Off stops builds and keeps the profile out of prompts. */
export const setProfileEnabled = (enabled: boolean): void => {
  commit({ ...profileStore.get(), enabled });
};

/**
 * Replace the derived half of the profile with the result of a build.
 *
 * `origin: 'user'` bullets are not passed in and are not touched — a build has
 * no business rewriting a line the user typed themselves. `digested` is merged
 * rather than replaced so a build that only looked at three chats does not
 * forget the two hundred an earlier one had already folded in.
 */
export const commitBuildResult = (result: {
  bullets: ProfileBullet[];
  digested: Record<string, number>;
  builtAt?: string;
}): void => {
  const state = profileStore.get();
  const userBullets = state.bullets.filter((bullet) => bullet.origin === 'user');
  commit({
    ...state,
    bullets: [...userBullets, ...result.bullets],
    digested: { ...state.digested, ...result.digested },
    lastBuiltAt: result.builtAt ?? new Date().toISOString(),
  });
};

/** Add a bullet the user typed themselves. */
export const addUserBullet = (input: {
  section: ProfileSectionId;
  text: string;
  date?: string;
}): void => {
  const text = input.text.trim();
  if (!text) return;
  const state = profileStore.get();
  const bullet: ProfileBullet = {
    id: newId(),
    section: input.section,
    text,
    source: 'You wrote this',
    evidence: 'Added by you in Settings.',
    ...(input.date ? { date: input.date } : {}),
    origin: 'user',
    createdAt: new Date().toISOString(),
  };
  commit({ ...state, bullets: [bullet, ...state.bullets] });
};

/**
 * Edit a bullet's wording.
 *
 * An edited `auto` bullet becomes a `user` one. That is the point of editing: the
 * user is correcting a guess, and leaving it as `auto` would let the next build
 * overwrite the correction with the same guess. `createdAt` is preserved — it is
 * the same remembered thing with its wording fixed, and re-dating it would
 * promote an old observation above newer ones.
 */
export const updateBullet = (id: string, patch: { text?: string; date?: string | null }): void => {
  const state = profileStore.get();
  const now = new Date().toISOString();
  commit({
    ...state,
    bullets: state.bullets.map((bullet) => {
      if (bullet.id !== id) return bullet;
      const text = patch.text === undefined ? bullet.text : patch.text.trim();
      if (!text) return bullet;
      const next: ProfileBullet = { ...bullet, text, origin: 'user', updatedAt: now };
      if (patch.date === null) delete next.date;
      else if (patch.date !== undefined) next.date = patch.date;
      return next;
    }),
  });
};

/**
 * Delete a bullet and remember that it was deleted.
 *
 * The fingerprint goes into `suppressed` so the next build cannot re-derive the
 * same claim from the same chats. Only `auto` bullets need suppressing: a
 * user-written one was never derived and nothing will re-derive it.
 */
export const removeBullet = (id: string): void => {
  const state = profileStore.get();
  const target = state.bullets.find((bullet) => bullet.id === id);
  if (!target) return;
  const suppressed = target.origin === 'auto'
    ? Array.from(new Set([...state.suppressed, bulletFingerprint(target.text)]))
    : state.suppressed;
  commit({
    ...state,
    bullets: state.bullets.filter((bullet) => bullet.id !== id),
    suppressed,
  });
};

/**
 * Forget everything, including that anything was ever forgotten.
 *
 * `suppressed` is cleared too, and `digested` with it. Anything else would be a
 * surprise: a user who deletes their whole profile and then asks Willow to
 * rebuild it expects the chats to be read fresh, not filtered through a list of
 * lines they deleted six months ago.
 */
export const clearProfile = (): void => {
  commit({ ...profileStore.get(), bullets: [], suppressed: [], digested: {}, lastBuiltAt: undefined });
};

