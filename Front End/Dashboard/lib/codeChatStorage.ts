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

function readCodeChats(scopeId: string): CodeChatMap {
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
    if (event.key?.startsWith(CODE_CHATS_KEY_PREFIX) || event.key?.startsWith(CODE_CHAT_STATE_PREFIX)) {
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
  const chats = readCodeChats(scopeId);
  chats[chatId] = true;
  writeSnapshot(scopeId, chats);
  notifyCodeChatsUpdated(scopeId);
}

export function unmarkCodeChat(scopeId: string, chatId: string): void {
  if (!scopeId || !chatId || !isCodeChat(scopeId, chatId)) return;
  // Keep a scope-owned tombstone so an older snapshot cannot resurrect it.
  writeChatState(scopeId, chatId, false);
  const chats = readCodeChats(scopeId);
  delete chats[chatId];
  writeSnapshot(scopeId, chats);
  notifyCodeChatsUpdated(scopeId);
}

export function renameCodeChat(scopeId: string, oldChatId: string, newChatId: string): void {
  if (!scopeId || !oldChatId || !newChatId || oldChatId === newChatId || !isCodeChat(scopeId, oldChatId)) return;
  writeChatState(scopeId, newChatId, true);
  writeChatState(scopeId, oldChatId, false);
  const chats = readCodeChats(scopeId);
  delete chats[oldChatId];
  chats[newChatId] = true;
  writeSnapshot(scopeId, chats);
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
