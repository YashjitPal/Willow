const LEGACY_CODE_CHATS_KEY = 'willow_code_chats';
const LEGACY_CODE_CHAT_STATE_PREFIX = 'willow_code_chat_state:';
const CODE_CHATS_KEY_PREFIX = 'willow_code_chats:v2:';
const CODE_CHAT_STATE_PREFIX = 'willow_code_chat_state:v2:';
export const CODE_CHATS_UPDATED_EVENT = 'willow_code_chats_updated';

type CodeChatMap = Record<string, true>;
interface CodeChatState {
  present: boolean;
  updatedAt: number;
}

function scopeSuffix(scopeId: string): string {
  return encodeURIComponent(scopeId);
}

function snapshotKey(scopeId: string): string {
  return CODE_CHATS_KEY_PREFIX + scopeSuffix(scopeId);
}

function statePrefix(scopeId: string): string {
  return `${CODE_CHAT_STATE_PREFIX}${scopeSuffix(scopeId)}:`;
}

function stateKey(scopeId: string, chatId: string): string {
  return statePrefix(scopeId) + encodeURIComponent(chatId);
}

function parseMap(raw: string | null): CodeChatMap {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: CodeChatMap = {};
    for (const [chatId, present] of Object.entries(parsed)) {
      if (chatId && present === true) result[chatId] = true;
    }
    return result;
  } catch {
    return {};
  }
}

function scanCodeChats(scopeId: string): CodeChatMap {
  if (typeof window === 'undefined' || !scopeId) return {};
  const chats = parseMap(localStorage.getItem(snapshotKey(scopeId)));
  const prefix = statePrefix(scopeId);
  // Per-chat records are canonical. They prevent unrelated simultaneous
  // updates in different tabs from clobbering one shared snapshot.
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const chatId = decodeURIComponent(key.slice(prefix.length));
      const state = JSON.parse(localStorage.getItem(key) || '') as CodeChatState;
      if (state?.present) chats[chatId] = true;
      else delete chats[chatId];
    } catch {}
  }
  return chats;
}

// A scan walks EVERY localStorage key, and there is one per Code-mode chat, so
// its cost grows with the size of the whole registry. Callers ask per chat while
// rendering a list, which made painting the sidebar O(chats x keys) — the reason
// a large history froze the UI on every render. One scan is reused until
// something actually changes it; writers below invalidate explicitly, and the
// listener at the bottom covers changes made by another tab.
let codeChatsCache: { scopeId: string; chats: CodeChatMap } | null = null;

function invalidateCodeChatsCache(): void {
  codeChatsCache = null;
}

/**
 * Cached read of a scope's Code-mode chat map. The returned object is shared
 * between callers and MUST NOT be mutated — writers use `scanCodeChats` for a
 * private copy. Safe to call once per row in a render loop.
 */
export function readCodeChats(scopeId: string): CodeChatMap {
  if (typeof window === 'undefined' || !scopeId) return {};
  if (codeChatsCache?.scopeId === scopeId) return codeChatsCache.chats;
  const chats = scanCodeChats(scopeId);
  codeChatsCache = { scopeId, chats };
  return chats;
}

function notifyCodeChatsUpdated(scopeId: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CODE_CHATS_UPDATED_EVENT, { detail: { scopeId } }));
  }
}

function writeSnapshot(scopeId: string, chats: CodeChatMap): void {
  localStorage.setItem(snapshotKey(scopeId), JSON.stringify(chats));
}

function writeChatState(scopeId: string, chatId: string, present: boolean): void {
  localStorage.setItem(stateKey(scopeId, chatId), JSON.stringify({ present, updatedAt: Date.now() } satisfies CodeChatState));
}

function readLegacyCodeChats(): CodeChatMap {
  if (typeof window === 'undefined') return {};
  const chats = parseMap(localStorage.getItem(LEGACY_CODE_CHATS_KEY));
  // Legacy per-chat records override the legacy shared map, including its
  // tombstones. These records remain unowned and are never adopted directly.
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(LEGACY_CODE_CHAT_STATE_PREFIX) || key.startsWith(CODE_CHAT_STATE_PREFIX)) continue;
    try {
      const chatId = decodeURIComponent(key.slice(LEGACY_CODE_CHAT_STATE_PREFIX.length));
      const state = JSON.parse(localStorage.getItem(key) || '') as CodeChatState;
      if (state?.present) chats[chatId] = true;
      else delete chats[chatId];
    } catch {}
  }
  return chats;
}

// A native storage event is delivered to every *other* tab. Re-dispatch the
// app event there so listeners behave identically in all tabs. Scoped readers
// still only consult their own records.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    // A null key means the whole store was cleared, which invalidates the cache
    // just as surely as a targeted write does.
    if (event.key === null || event.key.startsWith(CODE_CHATS_KEY_PREFIX) || event.key.startsWith(CODE_CHAT_STATE_PREFIX)) {
      invalidateCodeChatsCache();
      notifyCodeChatsUpdated('');
    }
  });
}

export function isCodeChat(scopeId: string, chatId: string): boolean {
  return !!scopeId && !!chatId && readCodeChats(scopeId)[chatId] === true;
}

export function markCodeChat(scopeId: string, chatId: string): void {
  if (!scopeId || !chatId || isCodeChat(scopeId, chatId)) return;
  writeChatState(scopeId, chatId, true);
  const chats = scanCodeChats(scopeId);
  chats[chatId] = true;
  writeSnapshot(scopeId, chats);
  invalidateCodeChatsCache();
  notifyCodeChatsUpdated(scopeId);
}

export function unmarkCodeChat(scopeId: string, chatId: string): void {
  if (!scopeId || !chatId || !isCodeChat(scopeId, chatId)) return;
  // Keep a scope-owned tombstone so an older snapshot cannot resurrect it.
  writeChatState(scopeId, chatId, false);
  const chats = scanCodeChats(scopeId);
  delete chats[chatId];
  writeSnapshot(scopeId, chats);
  invalidateCodeChatsCache();
  notifyCodeChatsUpdated(scopeId);
}

export function renameCodeChat(scopeId: string, oldChatId: string, newChatId: string): void {
  if (!scopeId || !oldChatId || !newChatId || oldChatId === newChatId || !isCodeChat(scopeId, oldChatId)) return;
  writeChatState(scopeId, newChatId, true);
  writeChatState(scopeId, oldChatId, false);
  const chats = scanCodeChats(scopeId);
  delete chats[oldChatId];
  chats[newChatId] = true;
  writeSnapshot(scopeId, chats);
  invalidateCodeChatsCache();
  notifyCodeChatsUpdated(scopeId);
}
/**
 * Adopt a legacy marker only after the caller has independently verified the
 * current scope's chat body contains a Code-mode message. Legacy records have
 * no user/root/workspace owner, so chat-id coincidence alone is not proof and
 * legacy tombstones are deliberately never migrated.
 */
export function migrateVerifiedLegacyCodeChat(scopeId: string, chatId: string): boolean {
  if (!scopeId || !chatId || isCodeChat(scopeId, chatId) || readLegacyCodeChats()[chatId] !== true) return false;
  markCodeChat(scopeId, chatId);
  return true;
}

/* ------------------------- backfill scan bookkeeping ---------------------- */

// Detecting a Code-mode chat that predates the Workbench's direct marking
// requires reading the chat's BODY — an IndexedDB read plus a disk read plus a
// parse, per chat. That is affordable exactly once per chat. It was previously
// tracked in a React ref, so it reset on every launch and the whole history was
// re-read from disk on every startup: the "app lags while chats load" symptom.
//
// One key per scope, holding the whole set. Deliberately NOT one key per chat —
// `scanCodeChats` walks every localStorage key, so per-chat keys here would make
// that scan proportional to history size all over again.
//
// The key must not collide with the prefixes `scanCodeChats`/`readLegacyCodeChats`
// match on ('willow_code_chat_state:'), or those loops would misparse it.
const CODE_CHAT_SCANNED_PREFIX = 'willow_code_chat_scanned:v1:';

function scannedKey(scopeId: string): string {
  return CODE_CHAT_SCANNED_PREFIX + scopeSuffix(scopeId);
}

let scannedCache: { scopeId: string; ids: Set<string> } | null = null;

function readScanned(scopeId: string): Set<string> {
  if (typeof window === 'undefined' || !scopeId) return new Set();
  if (scannedCache?.scopeId === scopeId) return scannedCache.ids;
  let ids = new Set<string>();
  try {
    const parsed = JSON.parse(localStorage.getItem(scannedKey(scopeId)) || '[]');
    if (Array.isArray(parsed)) ids = new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {}
  scannedCache = { scopeId, ids };
  return ids;
}

/**
 * Whether this chat's body has already been examined for a legacy Code-mode
 * marker in this scope. Survives reloads, so the scan is once per chat ever
 * rather than once per chat per launch.
 */
export function hasScannedCodeChat(scopeId: string, chatId: string): boolean {
  return !!scopeId && !!chatId && readScanned(scopeId).has(chatId);
}

/**
 * Record that a chat's body has been examined. Safe to call for a chat that
 * turned out not to be Code-mode — that negative result is exactly what must
 * not be recomputed on the next launch.
 *
 * A chat that BECOMES a Code chat later is marked directly by the Workbench
 * (`markCodeChat`), so recording a negative here cannot strand it. The one thing
 * this does not re-detect is a chat whose body is edited externally on disk to
 * add Code-mode messages; that is deliberate, and cheap to fix by clearing the
 * key if it ever matters.
 */
export function markScannedCodeChat(scopeId: string, chatId: string): void {
  if (typeof window === 'undefined' || !scopeId || !chatId) return;
  const ids = readScanned(scopeId);
  if (ids.has(chatId)) return;
  ids.add(chatId);
  try {
    localStorage.setItem(scannedKey(scopeId), JSON.stringify([...ids]));
  } catch {
    // A full/blocked localStorage must not break the scan; the worst case is
    // that this chat is examined again next launch.
  }
}

/** Drop scan bookkeeping for a chat that no longer exists. */
export function forgetScannedCodeChat(scopeId: string, chatId: string): void {
  if (typeof window === 'undefined' || !scopeId || !chatId) return;
  const ids = readScanned(scopeId);
  if (!ids.delete(chatId)) return;
  try { localStorage.setItem(scannedKey(scopeId), JSON.stringify([...ids])); } catch {}
}

/**
 * Move a chat's scan verdict to a new id. The chat id IS the on-disk filename,
 * so a rename would otherwise look like a brand-new chat and get its body
 * re-read on the next launch.
 */
export function renameScannedCodeChat(scopeId: string, oldChatId: string, newChatId: string): void {
  if (typeof window === 'undefined' || !scopeId || !oldChatId || !newChatId || oldChatId === newChatId) return;
  const ids = readScanned(scopeId);
  if (!ids.delete(oldChatId)) return;
  ids.add(newChatId);
  try { localStorage.setItem(scannedKey(scopeId), JSON.stringify([...ids])); } catch {}
}
