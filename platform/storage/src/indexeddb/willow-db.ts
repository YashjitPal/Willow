/**
 * Willow shared IndexedDB store.
 * Holds heavy per-record data that must NOT be subject to the browser's
 * ~5MB localStorage quota:
 *   - chat bodies (full message arrays), keyed by chatId
 *   - code-editor sessions (per project), keyed by the legacy storage key
 *
 * Mirrors the pattern in mediaStorage.ts (WillowMediaDB): open DB → object
 * store → put/get by key, fail-soft try/catch, and a one-time localStorage →
 * IndexedDB migration on read so existing data is never lost.
 *
 * Code sessions additionally use CONTENT-ADDRESSED DEDUP. Each session and each
 * assistant message carries a full `filesSnapshot` (path → file content) to power
 * revert/preview, so a multi-turn project would otherwise store many near-identical
 * full-codebase copies. Instead we store every unique file content ONCE in the
 * `code_blobs` store (keyed by a SHA-256 of the content) and replace each snapshot
 * with a tiny manifest of { path → hash }. Callers always see fully-inflated
 * snapshots — the (de)compression happens entirely at this boundary.
 */

import { canAdoptLegacyCodeSession, claimLegacyCodeSession } from '@willow/projects/registry';
import type { ChatAttachment } from '@willow/core/attachments';

const DB_NAME = 'WillowDB';
const DB_VERSION = 5; // v5 adds cached chat-search embeddings
const CHATS_STORE = 'chats';
const CHAT_SCOPE_CLAIMS_STORE = 'chat_scope_claims';
const CHAT_ATTACHMENTS_STORE = 'chat_attachments';
const CHAT_EMBEDDINGS_STORE = 'chat_embeddings';
const CODE_SESSIONS_STORE = 'code_sessions';
const CODE_BLOBS_STORE = 'code_blobs';
const DEFAULT_CODE_SESSION_SCOPE = 'signed-out::browser::My Willow';

let activeCodeSessionScopeId = DEFAULT_CODE_SESSION_SCOPE;

export function setCodeSessionStorageScope(scopeId: string): void {
  activeCodeSessionScopeId = scopeId || DEFAULT_CODE_SESSION_SCOPE;
}

function scopedCodeSessionKey(logicalStorageKey: string, scopeId = activeCodeSessionScopeId): string {
  return `scope:${encodeURIComponent(scopeId)}:code-session:${logicalStorageKey}`;
}

const LEGACY_CHAT_PREFIX = 'willow_chat_';

// NUL separates the project key from the content hash in a blob key. It cannot
// appear in a project/storage key or a hex hash, so prefix scans stay unambiguous.
const KEY_SEP = '\u0000';
// High sentinel for prefix range scans (no real key sorts at/above it).
const KEY_MAX = '￿';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHATS_STORE)) {
        db.createObjectStore(CHATS_STORE);
      }
      if (!db.objectStoreNames.contains(CHAT_SCOPE_CLAIMS_STORE)) {
        db.createObjectStore(CHAT_SCOPE_CLAIMS_STORE);
      }
      if (!db.objectStoreNames.contains(CHAT_ATTACHMENTS_STORE)) {
        db.createObjectStore(CHAT_ATTACHMENTS_STORE);
      }
      if (!db.objectStoreNames.contains(CHAT_EMBEDDINGS_STORE)) {
        db.createObjectStore(CHAT_EMBEDDINGS_STORE);
      }
      if (!db.objectStoreNames.contains(CODE_SESSIONS_STORE)) {
        db.createObjectStore(CODE_SESSIONS_STORE);
      }
      if (!db.objectStoreNames.contains(CODE_BLOBS_STORE)) {
        db.createObjectStore(CODE_BLOBS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ----------------------------- generic helpers ---------------------------- */

async function idbPut(store: string, key: string, value: any): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`IndexedDB write failed for ${store}`));
    tx.onabort = () => reject(tx.error ?? new Error(`IndexedDB write aborted for ${store}`));
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await getDB();
  return await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    let result: T | null = null;
    request.onsuccess = () => { result = (request.result as T) ?? null; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error(`IndexedDB read failed for ${store}`));
    tx.onabort = () => reject(tx.error ?? new Error(`IndexedDB read aborted for ${store}`));
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`IndexedDB delete failed for ${store}`));
    tx.onabort = () => reject(tx.error ?? new Error(`IndexedDB delete aborted for ${store}`));
  });
}

/* ------------------------------- chat bodies ------------------------------ */

export interface ChatStorageScope {
  userId?: string;
  rootId?: string;
  workspaceId?: string;
}

function encodeScopePart(value: string | undefined): string {
  return encodeURIComponent(value || '_');
}

/**
 * Build the physical IndexedDB key for a chat. Omitting scope intentionally
 * preserves the historical key exactly, so all existing callers remain valid.
 */
export function buildChatStorageKey(chatId: string, scope?: ChatStorageScope): string {
  if (!scope || (!scope.userId && !scope.rootId && !scope.workspaceId)) return chatId;
  return `v2:${encodeScopePart(scope.userId)}:${encodeScopePart(scope.rootId)}:${encodeScopePart(scope.workspaceId)}:${encodeURIComponent(chatId)}`;
}

function scopeIdentity(scope: ChatStorageScope): string {
  return `${encodeScopePart(scope.userId)}:${encodeScopePart(scope.rootId)}:${encodeScopePart(scope.workspaceId)}`;
}

/* ------------------------- chat-search embeddings ------------------------ */

export interface ChatEmbeddingRecord {
  scopeId: string;
  chatId: string;
  provider: string;
  modelId: string;
  contentHash: string;
  vector: number[];
  updatedAt: number;
}

function buildChatEmbeddingStorageKey(
  scopeId: string,
  provider: string,
  modelId: string,
  chatId: string,
): string {
  return [scopeId, provider, modelId, chatId].map(encodeURIComponent).join(':');
}

export async function loadChatEmbedding(
  scopeId: string,
  provider: string,
  modelId: string,
  chatId: string,
): Promise<ChatEmbeddingRecord | null> {
  return await idbGet<ChatEmbeddingRecord>(
    CHAT_EMBEDDINGS_STORE,
    buildChatEmbeddingStorageKey(scopeId, provider, modelId, chatId),
  );
}

export async function saveChatEmbedding(record: ChatEmbeddingRecord): Promise<void> {
  await idbPut(
    CHAT_EMBEDDINGS_STORE,
    buildChatEmbeddingStorageKey(record.scopeId, record.provider, record.modelId, record.chatId),
    record,
  );
}

/* -------------------------- binary chat attachments ---------------------- */

export interface StoredChatAttachment {
  attachment: ChatAttachment;
  blob: Blob;
  savedAt: number;
}

function buildChatAttachmentStorageKey(attachmentId: string, scope?: ChatStorageScope): string {
  const owner = scope ? scopeIdentity(scope) : '_:_:_';
  return `${owner}:attachment:${encodeURIComponent(attachmentId)}`;
}

export async function saveChatAttachment(
  attachment: ChatAttachment,
  blob: Blob,
  scope?: ChatStorageScope,
): Promise<void> {
  const { url: _url, ...persistedAttachment } = attachment;
  const record: StoredChatAttachment = {
    attachment: persistedAttachment,
    blob,
    savedAt: Date.now(),
  };
  await idbPut(
    CHAT_ATTACHMENTS_STORE,
    buildChatAttachmentStorageKey(attachment.id, scope),
    record,
  );
}

export async function loadChatAttachment(
  attachmentId: string,
  scope?: ChatStorageScope,
): Promise<StoredChatAttachment | null> {
  return await idbGet<StoredChatAttachment>(
    CHAT_ATTACHMENTS_STORE,
    buildChatAttachmentStorageKey(attachmentId, scope),
  );
}

export async function deleteChatAttachments(
  attachmentIds: Iterable<string>,
  scope?: ChatStorageScope,
): Promise<void> {
  const ids = [...new Set(Array.from(attachmentIds).filter(Boolean))];
  if (ids.length === 0) return;
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHAT_ATTACHMENTS_STORE, 'readwrite');
    const store = tx.objectStore(CHAT_ATTACHMENTS_STORE);
    for (const id of ids) store.delete(buildChatAttachmentStorageKey(id, scope));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Chat attachment delete failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Chat attachment delete was aborted'));
  });
}

function collectChatAttachmentIds(messages: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(messages)) return ids;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const attachments = (message as any).attachments;
    if (!Array.isArray(attachments)) continue;
    for (const attachment of attachments) {
      if (attachment && typeof attachment.id === 'string') ids.add(attachment.id);
    }
  }
  return ids;
}

/**
 * Atomically lets exactly one scope adopt an ambiguous legacy body. The claim
 * prevents a later account/root from copying the same old global chat into its
 * namespace. Moving source and destination in one transaction avoids loss.
 */
async function claimAndCopyLegacyChat(
  chatId: string,
  scope: ChatStorageScope,
  localStorageBody: any[] | null
): Promise<{ body: any[] | null; claimedLocalStorage: boolean }> {
  const db = await getDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction([CHATS_STORE, CHAT_SCOPE_CLAIMS_STORE], 'readwrite');
    const chats = tx.objectStore(CHATS_STORE);
    const claims = tx.objectStore(CHAT_SCOPE_CLAIMS_STORE);
    const targetKey = buildChatStorageKey(chatId, scope);
    const owner = scopeIdentity(scope);
    let body: any[] | null = null;
    let claimedLocalStorage = false;
    const claimRequest = claims.get(chatId);
    claimRequest.onsuccess = () => {
      const existingOwner = claimRequest.result as string | undefined;
      if (existingOwner && existingOwner !== owner) return;
      if (!existingOwner) claims.put(owner, chatId);
      const legacyRequest = chats.get(chatId);
      legacyRequest.onsuccess = () => {
        body = (legacyRequest.result as any[] | undefined) ?? localStorageBody;
        claimedLocalStorage = body !== null && localStorageBody !== null;
        if (body !== null) {
          chats.put(body, targetKey);
          // Source and destination change atomically, so a crash cannot lose
          // the only copy and the old global key cannot later resurrect it.
          chats.delete(chatId);
        }
      };
    };
    tx.oncomplete = () => resolve({ body, claimedLocalStorage });
    tx.onerror = () => reject(tx.error ?? claimRequest.error ?? new Error('Legacy chat migration failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Legacy chat migration was aborted'));
  });
}

/**
 * Whether a chat body is already stored under the current scope, without
 * deserializing it. `loadChatBody` returns the entire message array (including
 * inline content), so using it merely to test presence made reconciliation cost
 * proportional to total history size. `getKey` reads the index only.
 *
 * Note this deliberately does NOT consider legacy localStorage bodies, so a
 * `false` result still routes callers through `loadChatBody` and its migration.
 */
export async function hasChatBody(chatId: string, scope?: ChatStorageScope): Promise<boolean> {
  const key = buildChatStorageKey(chatId, scope);
  const db = await getDB();
  return await new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(CHATS_STORE, 'readonly');
    const request = tx.objectStore(CHATS_STORE).getKey(key);
    let found = false;
    request.onsuccess = () => { found = request.result !== undefined; };
    tx.oncomplete = () => resolve(found);
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error('IndexedDB key probe failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB key probe aborted'));
  });
}

/**
 * Persist a chat's full message array (keyed by chatId) in IndexedDB.
 */
export async function saveChatBody(chatId: string, messages: any[], scope?: ChatStorageScope): Promise<void> {
  const key = buildChatStorageKey(chatId, scope);
  const previous = await idbGet<any[]>(CHATS_STORE, key);
  await idbPut(CHATS_STORE, key, messages);

  // Editing a turn can remove attachments from the remaining branch. Drop only
  // binaries no longer referenced by this chat so local storage does not grow
  // forever while preserving attachments reused by regenerate/edit flows.
  if (previous) {
    const currentIds = collectChatAttachmentIds(messages);
    const staleIds = [...collectChatAttachmentIds(previous)].filter((id) => !currentIds.has(id));
    if (staleIds.length > 0) {
      try { await deleteChatAttachments(staleIds, scope); } catch {}
    }
  }
}

/**
 * Load a chat's message array. Returns null if the chat has never been stored.
 * Transparently migrates a legacy `willow_chat_<id>` localStorage entry into
 * IndexedDB (then frees the localStorage key) so old data survives the upgrade.
 */
export async function loadChatBody(chatId: string, scope?: ChatStorageScope): Promise<any[] | null> {
  const scopedKey = buildChatStorageKey(chatId, scope);
  const fromDb = await idbGet<any[]>(CHATS_STORE, scopedKey);
  if (fromDb !== null) {
    return fromDb;
  }

  if (scopedKey !== chatId) {
    let localStorageBody: any[] | null = null;
    const legacy = localStorage.getItem(LEGACY_CHAT_PREFIX + chatId);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)) localStorageBody = parsed;
        else localStorage.removeItem(LEGACY_CHAT_PREFIX + chatId);
      } catch {
        localStorage.removeItem(LEGACY_CHAT_PREFIX + chatId);
      }
    }
    const migrated = await claimAndCopyLegacyChat(chatId, scope!, localStorageBody);
    if (migrated.claimedLocalStorage) {
      // The scoped destination and ownership claim have committed.
      localStorage.removeItem(LEGACY_CHAT_PREFIX + chatId);
    }
    return migrated.body;
  }

  // Migration fallback: pull from legacy localStorage if present.
  const legacy = localStorage.getItem(LEGACY_CHAT_PREFIX + chatId);
  if (legacy) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(legacy);
    } catch {
      localStorage.removeItem(LEGACY_CHAT_PREFIX + chatId);
      return null;
    }
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(LEGACY_CHAT_PREFIX + chatId);
      return null;
    }
    await saveChatBody(chatId, parsed, scope);
    // Only remove the legacy source after the destination transaction commits.
    localStorage.removeItem(LEGACY_CHAT_PREFIX + chatId);
    return parsed;
  }

  return null;
}

/**
 * Remove a chat body from IndexedDB (and any leftover legacy localStorage key).
 */
export async function deleteChatBody(chatId: string, scope?: ChatStorageScope): Promise<void> {
  const key = buildChatStorageKey(chatId, scope);
  const body = await loadChatBody(chatId, scope);
  if (key !== chatId) {
    // Claim/migrate any still-legacy body before deleting, otherwise a chat
    // deleted before its first open could later be adopted by another scope.
    await loadChatBody(chatId, scope);
  }
  await idbDelete(CHATS_STORE, key);
  if (body) {
    try { await deleteChatAttachments(collectChatAttachmentIds(body), scope); } catch {}
  }
  if (key === chatId) {
    localStorage.removeItem(LEGACY_CHAT_PREFIX + chatId);
  }
}

/**
 * Move a chat body from one id to another (used when a temp chat id is replaced
 * by its generated title).
 */
export async function renameChatBody(oldChatId: string, newChatId: string, scope?: ChatStorageScope): Promise<void> {
  if (oldChatId === newChatId) return;
  // Ensure any localStorage-only legacy source is durably migrated first.
  await loadChatBody(oldChatId, scope);
  const oldKey = buildChatStorageKey(oldChatId, scope);
  const newKey = buildChatStorageKey(newChatId, scope);
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHATS_STORE, 'readwrite');
    const store = tx.objectStore(CHATS_STORE);
    let conflict = false;
    let requestError: DOMException | null = null;
    const getNew = store.get(newKey);
    getNew.onerror = () => { requestError = getNew.error; };
    getNew.onsuccess = () => {
      if (getNew.result !== undefined) {
        conflict = true;
        tx.abort();
        return;
      }
      const getOld = store.get(oldKey);
      getOld.onerror = () => { requestError = getOld.error; };
      getOld.onsuccess = () => {
        if (getOld.result !== undefined) {
          store.put(getOld.result, newKey);
          store.delete(oldKey);
        }
      };
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? requestError ?? new Error('Chat rename failed'));
    tx.onabort = () => reject(conflict ? new Error(`Chat already exists: ${newChatId}`) : tx.error ?? requestError ?? new Error('Chat rename aborted'));
  });
  if (oldKey === oldChatId) localStorage.removeItem(LEGACY_CHAT_PREFIX + oldChatId);
}

/* ---------------------- content-addressed snapshot dedup ------------------- */

// A snapshot stored on disk in deflated form: { __refs: { path -> contentHash } }.
interface DeflatedSnapshot {
  __refs: Record<string, string>;
}

function isDeflated(snap: any): snap is DeflatedSnapshot {
  return !!snap && typeof snap === 'object' && !!snap.__refs && typeof snap.__refs === 'object';
}

function blobKey(storageKey: string, hash: string): string {
  return `${storageKey}${KEY_SEP}${hash}`;
}

// Session-lifetime memo of content -> hash to avoid re-hashing unchanged files
// on every save. Soft-capped so it can't grow without bound.
const hashCache = new Map<string, string>();
const MAX_HASH_CACHE_ENTRY_BYTES = 256 * 1024;
const MAX_HASH_CACHE_BYTES = 8 * 1024 * 1024;
let hashCacheBytes = 0;

async function hashContent(content: string): Promise<string> {
  const estimatedBytes = content.length * 2;
  const cached = estimatedBytes <= MAX_HASH_CACHE_ENTRY_BYTES ? hashCache.get(content) : undefined;
  if (cached) return cached;

  const data = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }

  if (estimatedBytes <= MAX_HASH_CACHE_ENTRY_BYTES) {
    if (hashCacheBytes + estimatedBytes > MAX_HASH_CACHE_BYTES) {
      hashCache.clear();
      hashCacheBytes = 0;
    }
    hashCache.set(content, hex);
    hashCacheBytes += estimatedBytes;
  }
  return hex;
}

// Deflate one snapshot (path -> content) into { __refs: path -> hash }, recording
// every unique content into `blobs` and every hash into `referenced`.
async function deflateSnapshot(
  snap: any,
  blobs: Map<string, string>,
  referenced: Set<string>
): Promise<any> {
  if (!snap || typeof snap !== 'object') return snap;
  if (isDeflated(snap)) {
    for (const h of Object.values(snap.__refs)) referenced.add(h);
    return snap;
  }
  const refs: Record<string, string> = {};
  for (const [path, content] of Object.entries(snap)) {
    if (typeof content !== 'string') continue;
    const h = await hashContent(content);
    refs[path] = h;
    blobs.set(h, content);
    referenced.add(h);
  }
  return { __refs: refs };
}

// Rebuild a deflated snapshot back into path -> content using a preloaded blob map.
function inflateSnapshot(snap: any, blobMap: Map<string, string>): any {
  if (!isDeflated(snap)) return snap; // legacy inline snapshot or empty
  const out: Record<string, string> = {};
  for (const [path, hash] of Object.entries(snap.__refs)) {
    out[path] = blobMap.get(hash) ?? '';
  }
  return out;
}

function collectHashes(snap: any, hashes: Set<string>): void {
  if (isDeflated(snap)) {
    for (const h of Object.values(snap.__refs)) hashes.add(h);
  }
}

// Write deflated sessions + their blobs, and garbage-collect this project's blobs
// that are no longer referenced — all in one transaction.
async function writeDeflated(
  storageKey: string,
  deflated: any[],
  blobs: Map<string, string>,
  referenced: Set<string>
): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([CODE_SESSIONS_STORE, CODE_BLOBS_STORE], 'readwrite');
    const sessionsStore = tx.objectStore(CODE_SESSIONS_STORE);
    const blobStore = tx.objectStore(CODE_BLOBS_STORE);

    sessionsStore.put(deflated, storageKey);
    for (const [hash, content] of blobs) {
      blobStore.put(content, blobKey(storageKey, hash));
    }

    // GC: drop any of this project's blobs not referenced by the new sessions.
    const prefix = `${storageKey}${KEY_SEP}`;
    const range = IDBKeyRange.bound(prefix, prefix + KEY_MAX);
    const cursorReq = blobStore.openCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const hash = (cursor.key as string).slice(prefix.length);
        if (!referenced.has(hash)) cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Load every blob for this project whose hash is in `hashes`, via one cursor scan.
async function loadBlobs(storageKey: string, hashes: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (hashes.size === 0) return map;
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CODE_BLOBS_STORE, 'readonly');
    const store = tx.objectStore(CODE_BLOBS_STORE);
    const prefix = `${storageKey}${KEY_SEP}`;
    const range = IDBKeyRange.bound(prefix, prefix + KEY_MAX);
    const cursorReq = store.openCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const hash = (cursor.key as string).slice(prefix.length);
        if (hashes.has(hash) && typeof cursor.value === 'string') {
          map.set(hash, cursor.value);
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? cursorReq.error ?? new Error('Code blob read failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Code blob read aborted'));
  });
  return map;
}

/* --------------------------- code-editor sessions -------------------------- */

/**
 * Persist a project's code-editor sessions array. `storageKey` is the existing
 * `willow_chat_sessions_<project>` (or `willow_chat_sessions_default`) string,
 * reused verbatim as both the IndexedDB key and the legacy localStorage key.
 *
 * Full file snapshots are deflated to content-hash manifests; unique file
 * contents are stored once in code_blobs and unreferenced ones are GC'd.
 *
 * Saves are SERIALIZED per storageKey. Several independent effects (message
 * autosave, session auto-naming, switch/new-chat handlers) fire
 * `void saveCodeSessions(sameKey, …)` with the full array; each is its own
 * IndexedDB transaction whose completion order isn't guaranteed, so two racing
 * saves could land older-snapshot-last and drop a concurrent update (e.g. an
 * auto-generated session name). Chaining per key makes the last call win.
 */
const saveChains = new Map<string, Promise<void>>();

export function saveCodeSessions(storageKey: string, sessions: any[]): Promise<void> {
  const physicalStorageKey = scopedCodeSessionKey(storageKey);
  const prev = saveChains.get(physicalStorageKey) ?? Promise.resolve();
  // Snapshot the array now so a caller mutating it after the call can't change
  // what this save persists.
  const snapshot = Array.isArray(sessions) ? [...sessions] : sessions;
  const run = prev
    .catch(() => {}) // a failed prior save must not break the chain
    .then(() => saveCodeSessionsInner(physicalStorageKey, snapshot));
  // Keep the chain tail current; clean up the map once this is the last link.
  saveChains.set(physicalStorageKey, run);
  void run.then(
    () => { if (saveChains.get(physicalStorageKey) === run) saveChains.delete(physicalStorageKey); },
    () => { if (saveChains.get(physicalStorageKey) === run) saveChains.delete(physicalStorageKey); }
  );
  return run;
}

async function saveCodeSessionsInner(storageKey: string, sessions: any[]): Promise<void> {
  try {
    const blobs = new Map<string, string>();
    const referenced = new Set<string>();
    const deflated: any[] = [];

    for (const session of sessions) {
      const s: any = { ...session };
      s.filesSnapshot = await deflateSnapshot(session.filesSnapshot, blobs, referenced);
      if (Array.isArray(session.messages)) {
        s.messages = [];
        for (const m of session.messages) {
          if (m && m.filesSnapshot) {
            s.messages.push({ ...m, filesSnapshot: await deflateSnapshot(m.filesSnapshot, blobs, referenced) });
          } else {
            s.messages.push(m);
          }
        }
      }
      deflated.push(s);
    }

    await writeDeflated(storageKey, deflated, blobs, referenced);
  } catch {
    // If hashing/IDB is unavailable (e.g. non-secure context), store inline so
    // nothing is lost; loadCodeSessions handles inline snapshots transparently.
    await idbPut(CODE_SESSIONS_STORE, storageKey, sessions);
  }
}

/**
 * Load a project's code-editor sessions, re-inflating any deflated file
 * snapshots back to full content. Returns null if none stored. Migrates a
 * legacy localStorage value into IndexedDB on first read.
 */
export async function loadCodeSessions(storageKey: string): Promise<any[] | null> {
  const scopeId = activeCodeSessionScopeId;
  const physicalStorageKey = scopedCodeSessionKey(storageKey, scopeId);
  const fromDb = await idbGet<any[]>(CODE_SESSIONS_STORE, physicalStorageKey);
  if (fromDb !== null) {
    return await inflateSessions(physicalStorageKey, fromDb);
  }

  return migrateLegacyCodeSessions(storageKey, scopeId, false);
}

async function migrateLegacyCodeSessions(
  logicalStorageKey: string,
  scopeId: string,
  verifiedForScope: boolean,
): Promise<any[] | null> {
  const legacyDb = await idbGet<any[]>(CODE_SESSIONS_STORE, logicalStorageKey);
  const legacyLocal = localStorage.getItem(logicalStorageKey);
  if (legacyDb === null && legacyLocal === null) return null;
  if (!claimLegacyCodeSession(logicalStorageKey, scopeId, verifiedForScope)) return null;

  let sessions: any[];
  if (legacyDb !== null) {
    sessions = await inflateSessions(logicalStorageKey, legacyDb);
  } else {
    const parsed = JSON.parse(legacyLocal!);
    if (!Array.isArray(parsed)) return null;
    sessions = parsed;
  }

  const destinationKey = scopedCodeSessionKey(logicalStorageKey, scopeId);
  const existing = await idbGet<any[]>(CODE_SESSIONS_STORE, destinationKey);
  if (existing === null) await saveCodeSessionsInner(destinationKey, sessions);
  // The destination commits before the unowned legacy source is removed.
  await deleteCodeSessionsPhysical(logicalStorageKey);
  localStorage.removeItem(logicalStorageKey);
  return sessions;

}

async function inflateSessions(storageKey: string, sessions: any[]): Promise<any[]> {
  let anyDeflated = false;
  const hashes = new Set<string>();
  for (const session of sessions) {
    if (isDeflated(session?.filesSnapshot)) anyDeflated = true;
    collectHashes(session?.filesSnapshot, hashes);
    if (Array.isArray(session?.messages)) {
      for (const m of session.messages) {
        if (isDeflated(m?.filesSnapshot)) anyDeflated = true;
        collectHashes(m?.filesSnapshot, hashes);
      }
    }
  }

  if (!anyDeflated) return sessions; // pure legacy inline — nothing to do

  const blobMap = await loadBlobs(storageKey, hashes);

  return sessions.map((session) => {
    const s: any = { ...session, filesSnapshot: inflateSnapshot(session.filesSnapshot, blobMap) };
    if (Array.isArray(session.messages)) {
      s.messages = session.messages.map((m: any) =>
        m && isDeflated(m.filesSnapshot) ? { ...m, filesSnapshot: inflateSnapshot(m.filesSnapshot, blobMap) } : m
      );
    }
    return s;
  });
}

/**
 * Delete a project's code-editor sessions record AND all of its
 * content-addressed blobs (they're keyed per storage key, so nothing else
 * references them). Also clears any legacy localStorage value under the key.
 */
export async function deleteCodeSessions(storageKey: string): Promise<void> {
  const scopeId = activeCodeSessionScopeId;
  await deleteCodeSessionsPhysical(scopedCodeSessionKey(storageKey, scopeId));
  localStorage.removeItem(scopedCodeSessionKey(storageKey, scopeId));
  // If this scope is the verified owner of an old global bucket, remove it too
  // so a later read cannot resurrect a project that was explicitly deleted.
  if (claimLegacyCodeSession(storageKey, scopeId)) {
    await deleteCodeSessionsPhysical(storageKey);
    localStorage.removeItem(storageKey);
  }
}

async function deleteCodeSessionsPhysical(storageKey: string): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([CODE_SESSIONS_STORE, CODE_BLOBS_STORE], 'readwrite');
    tx.objectStore(CODE_SESSIONS_STORE).delete(storageKey);
    const blobStore = tx.objectStore(CODE_BLOBS_STORE);
    const prefix = `${storageKey}${KEY_SEP}`;
    const range = IDBKeyRange.bound(prefix, prefix + KEY_MAX);
    const cursorReq = blobStore.openCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? cursorReq.error ?? new Error('Code session delete failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Code session delete aborted'));
  });
}

/**
 * Move a project's code-editor sessions from one storage key to another. The
 * key embeds the project NAME, so a project rename orphaned its entire session
 * history (chats + file snapshots) under the old key — the renamed project
 * opened empty. Loads fully inflated, re-saves under the new key (re-deflating
 * blobs there), then deletes the old record + blobs. No-op if the old key has
 * nothing stored; never clobbers sessions already present under the new key.
 */
export async function renameCodeSessions(oldStorageKey: string, newStorageKey: string): Promise<boolean> {
  if (oldStorageKey === newStorageKey) return true;
  const scopeId = activeCodeSessionScopeId;
  let sessions = await loadCodeSessions(oldStorageKey);
  // A registry rename removes the old project name before this migration runs.
  // The destination name still verifies ownership, so it is safe to adopt the
  // old unscoped bucket into this already-owned scope exactly once.
  if (sessions === null && canAdoptLegacyCodeSession(newStorageKey, scopeId)) {
    sessions = await migrateLegacyCodeSessions(oldStorageKey, scopeId, true);
  }
  if (sessions === null) return true;
  const destinationKey = scopedCodeSessionKey(newStorageKey, scopeId);
  const sourceKey = scopedCodeSessionKey(oldStorageKey, scopeId);
  const existing = await idbGet<any[]>(CODE_SESSIONS_STORE, destinationKey);
  if (existing !== null) return false;
  await saveCodeSessionsInner(destinationKey, sessions);
  // Destination is committed before the source and its blobs are removed.
  await deleteCodeSessionsPhysical(sourceKey);
  localStorage.removeItem(sourceKey);
  return true;
}
