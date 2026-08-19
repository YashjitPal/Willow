/**
 * Chat metadata: the localStorage side of the local-disk chat index.
 *
 * Split out of LocalFSContext because none of it touches React or the
 * directory handle. Everything here is defensive by design: the values come
 * from localStorage, which the user can edit and older builds may have written
 * in a different shape, so each validator narrows untrusted JSON rather than
 * trusting it. A malformed entry is dropped, never thrown on.
 */

export interface ChatSyncRecord {
  revision: number;
  diskRevision: number;
  diskMtime: number;
  dirty: boolean;
  tombstone: boolean;
  updatedAt: number;
  /**
   * Which folder this chat's file belongs in: a notebook id, or `''` for the
   * global `Chats/`. This is the app's *intent*, not an observation — the
   * reconciler compares it against where the file actually turned up and either
   * completes the move or adopts the new location (see `locationDirty`).
   */
  notebookId: string;
  /**
   * The move has been asked for but not yet landed on disk.
   *
   * Same durable-dirty contract as `dirty` for content: set before the move,
   * cleared after it succeeds, so an interrupted move is retried on the next
   * poll rather than lost. It is also the tie-break that stops a file
   * ping-ponging — while it is set, disk is behind the registry and the move is
   * completed; while it is clear, a file in an unexpected folder was moved by the
   * user and the registry follows it.
   */
  locationDirty: boolean;
}

export interface ChatMetadataKeys {
  chats: string;
  timestamps: string;
  sync: string;
}

export const LEGACY_CHAT_KEYS: ChatMetadataKeys = {
  chats: 'willow_local_chats',
  timestamps: 'willow_chat_timestamps',
  sync: 'willow_chat_sync_state',
};
export const LEGACY_CHAT_MIGRATION_KEY = 'willow_chat_metadata_migrated_v2';

export const isValidChatId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 240;

export const validateChatList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isValidChatId)));
};

export const validateTimestampMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: Record<string, number> = {};
  for (const [chatId, timestamp] of Object.entries(value as Record<string, unknown>)) {
    if (isValidChatId(chatId) && typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0) {
      next[chatId] = timestamp;
    }
  }
  return next;
};

/**
 * Narrow a stored sync map.
 *
 * Rebuilt field by field, deliberately: an unknown key from an older or newer
 * build is dropped rather than carried. The flip side is that **every field on
 * `ChatSyncRecord` must be listed here** — one that is not gets silently erased
 * on the next localStorage round trip, so the feature that depends on it appears
 * to work until the first reload.
 */
export const validateSyncRecords = (value: unknown): Record<string, ChatSyncRecord> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: Record<string, ChatSyncRecord> = {};
  for (const [chatId, raw] of Object.entries(value as Record<string, any>)) {
    if (!isValidChatId(chatId) || !raw || typeof raw !== 'object') continue;
    next[chatId] = {
      revision: Number.isFinite(raw.revision) ? Math.max(0, raw.revision) : 0,
      diskRevision: Number.isFinite(raw.diskRevision) ? Math.max(0, raw.diskRevision) : 0,
      diskMtime: Number.isFinite(raw.diskMtime) ? Math.max(0, raw.diskMtime) : 0,
      dirty: raw.dirty === true,
      tombstone: raw.tombstone === true,
      updatedAt: Number.isFinite(raw.updatedAt) ? Math.max(0, raw.updatedAt) : 0,
      // A malformed id falls back to the global folder rather than being dropped.
      // `''` is the normal value here, so it cannot use `isValidChatId`.
      notebookId: typeof raw.notebookId === 'string' && raw.notebookId.length <= 240
        ? raw.notebookId
        : '',
      locationDirty: raw.locationDirty === true,
    };
  }
  return next;
};

export const readJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

export const chatMetadataKeysForScope = (scopeId: string): ChatMetadataKeys => {
  const suffix = encodeURIComponent(scopeId);
  return {
    chats: `willow_local_chats:${suffix}`,
    timestamps: `willow_chat_timestamps:${suffix}`,
    sync: `willow_chat_sync_state:${suffix}`,
  };
};

// A brand-new chat is stored under a generated timestamp id
// ("YYYY-MM-DDTHH-MM-SS_xxxxxx") until the naming agent renames it to a real
// title. Single source of truth: the sidebar's skeleton, the timestamp parser
// and the load path must all agree on what "still unnamed" means, or a chat can
// shimmer as un-named in one place while counting as named in another.
export const isTempChatId = (chatId: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_[a-z0-9]{6}$/i.test(chatId);

/**
 * The chat id as it should be shown to the user.
 *
 * A chat id IS its on-disk filename (Chats/<id>.json), so when the naming model
 * picks a title another chat already has, the writer appends " (1)", " (2)", …
 * to keep the two files apart. That suffix is a storage detail: it exists so the
 * ids don't collide, and it means nothing to the reader. Every surface that
 * renders a chat name strips it, and nothing that addresses a chat may — pass
 * the raw id to select/rename/delete and this only to a text node.
 *
 * A name that is nothing but a suffix ("(2)") would strip to empty, so the raw
 * id stands in rather than rendering a blank row.
 */
export const chatDisplayName = (chatId: string): string => {
  const stripped = chatId.replace(/ \(\d+\)$/, '');
  return stripped.trim() ? stripped : chatId;
};

// Parse the creation time embedded in a temp chat id
// ("YYYY-MM-DDTHH-MM-SS_xxxxxx"), or 0 if the id isn't in that format.
export const parseTempIdTimestamp = (chatId: string): number => {
  if (!isTempChatId(chatId)) return 0;
  try {
    const firstPart = chatId.split('_')[0]; // "2026-06-06T06-44-09"
    const tIdx = firstPart.indexOf('T');
    if (tIdx !== -1) {
      const datePart = firstPart.slice(0, tIdx); // "2026-06-06"
      const timePart = firstPart.slice(tIdx + 1).replace(/-/g, ':'); // "06:44:09"
      // The id is built from new Date().toISOString() — i.e. UTC wall-clock —
      // so parse it back as UTC. Without the 'Z', new Date() treats a
      // time-bearing string with no offset as LOCAL time, dating every
      // brand-new chat off by the viewer's UTC offset (e.g. −5h at UTC+5),
      // which could sort a just-created chat below older ones.
      const dateStr = `${datePart}T${timePart}Z`;
      const parsedTime = new Date(dateStr).getTime();
      if (!isNaN(parsedTime)) {
        return parsedTime;
      }
    }
  } catch {}
  return 0;
};

export const sortChatsNewestToOldest = (chats: string[], timestamps?: Record<string, number>): string[] => {
  const stored: Record<string, number> = timestamps || {};
  const ts = (chatId: string): number => stored[chatId] || parseTempIdTimestamp(chatId);
  // Deterministic TOTAL order: newest first, then a stable id tiebreaker. The
  // tiebreaker is essential — without it, chats with equal or missing
  // timestamps keep whatever order the input happened to have (disk
  // enumeration order, which varies), so the persisted list and the sidebar's
  // render-sort could disagree and the list visibly reshuffled on open. This
  // MUST match the comparator the sidebar uses (see Sidebar.tsx).
  return validateChatList(chats).sort((a, b) => {
    const tA = ts(a);
    const tB = ts(b);
    if (tB !== tA) return tB - tA;
    return a.localeCompare(b);
  });
};

/**
 * Merges two sets of sync records, keeping the newer side of each conflict.
 *
 * Revision wins first; `updatedAt` only breaks a revision tie. Two devices
 * writing the same chat can reach the same revision, and without the tiebreak
 * the merge result would depend on argument order.
 */
export const mergeSyncRecords = (
  current: Record<string, ChatSyncRecord>,
  incoming: Record<string, ChatSyncRecord>,
): Record<string, ChatSyncRecord> => {
  const merged = { ...current };
  for (const [chatId, candidate] of Object.entries(incoming)) {
    const existing = merged[chatId];
    if (!existing || candidate.revision > existing.revision ||
        (candidate.revision === existing.revision && candidate.updatedAt > existing.updatedAt)) {
      merged[chatId] = candidate;
    }
  }
  return merged;
};
