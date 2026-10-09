/**
 * Saved conversations with the Media agent, per project.
 *
 * A database of its own rather than a store in `WillowMediaDB`: adding a store there means
 * bumping that database's version, and `media-storage.ts` opens it at a fixed version, so
 * the first open at the new version would make every older open fail.
 *
 * Two stores, written together in one transaction: `sessions` holds whole transcripts and
 * `session_index` holds the one-line summaries the history list renders, so listing a
 * project's chats never deserializes every message in them.
 *
 * Keys are scoped like media records (user + root + workspace, see `chatScopeId`), so one
 * account's chats never appear in another's list.
 */

const DB_NAME = 'WillowMediaAgentDB';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const INDEX_STORE = 'session_index';

/** Oldest sessions beyond this many per project are pruned on save. */
export const MAX_AGENT_SESSIONS_PER_PROJECT = 50;

export interface StoredAgentAttachment {
  name?: string;
  mimeType: string;
  /**
   * A small JPEG data URL for the transcript. The full bytes are never stored here; an
   * upload's are a file beside the chat in the project's folder, named by `file`.
   */
  thumb?: string;
  mediaId?: string;
  /** A character the user mentioned, sent to the model by its ID. */
  characterId?: string;
  /** An upload's file beside the chat: `Attachments/<name [hash].ext>` in its folder. */
  file?: string;
}

/** A character or scene the agent made or changed in a reply, drawn as a card under it. */
export interface StoredAgentLink {
  kind: 'character' | 'scene';
  id: string;
  /** For a character, the image made in that reply, so the card keeps showing that version. */
  mediaId?: string;
  /** Where in the reply's `content` the card goes; absent on cards saved before they had a place. */
  at?: number;
}

export interface StoredAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status?: 'done' | 'stopped' | 'error';
  error?: string;
  reaction?: 'like' | 'dislike' | null;
  attachments?: StoredAgentAttachment[];
  links?: StoredAgentLink[];
  /** A line per tool call the reply made, what a later turn is told of it. */
  actions?: string[];
}

export interface StoredAgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredAgentMessage[];
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
}

interface IndexRecord extends AgentSessionSummary {
  key: string;
}

interface SessionRecord {
  key: string;
  session: StoredAgentSession;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) db.createObjectStore(SESSIONS_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(INDEX_STORE)) db.createObjectStore(INDEX_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open the Media agent session store'));
    };
  });
  return dbPromise;
}

const projectPrefix = (scopeId: string, projectId: string): string =>
  `scope:${encodeURIComponent(scopeId)}:project:${encodeURIComponent(projectId)}:session:`;

const sessionKey = (scopeId: string, projectId: string, sessionId: string): string =>
  projectPrefix(scopeId, projectId) + sessionId;

const prefixRange = (prefix: string): IDBKeyRange => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

const summarize = (session: StoredAgentSession): AgentSessionSummary => {
  const firstUser = session.messages.find((m) => m.role === 'user' && m.content.trim());
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview: (firstUser?.content || '').replace(/\s+/g, ' ').trim().slice(0, 140),
  };
};

const done = (tx: IDBTransaction, what: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to ${what}`));
    tx.onabort = () => reject(tx.error ?? new Error(`Aborted while trying to ${what}`));
  });

/** Summaries for a project's saved chats, most recently updated first. */
export async function listAgentSessions(projectId: string, scopeId: string): Promise<AgentSessionSummary[]> {
  if (!projectId) return [];
  const db = await openDB();
  const tx = db.transaction(INDEX_STORE, 'readonly');
  const request = tx.objectStore(INDEX_STORE).getAll(prefixRange(projectPrefix(scopeId, projectId)));
  const records = await new Promise<IndexRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result || []) as IndexRecord[]);
    request.onerror = () => reject(request.error ?? new Error('Failed to list Media agent sessions'));
  });
  return records
    .map(({ key: _key, ...summary }) => summary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadAgentSession(
  projectId: string,
  sessionId: string,
  scopeId: string,
): Promise<StoredAgentSession | null> {
  if (!projectId || !sessionId) return null;
  const db = await openDB();
  const tx = db.transaction(SESSIONS_STORE, 'readonly');
  const request = tx.objectStore(SESSIONS_STORE).get(sessionKey(scopeId, projectId, sessionId));
  const record = await new Promise<SessionRecord | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as SessionRecord | undefined);
    request.onerror = () => reject(request.error ?? new Error('Failed to load the Media agent session'));
  });
  return record?.session ?? null;
}

/** Writes the transcript and its summary together, then prunes past the per-project cap. */
export async function saveAgentSession(
  projectId: string,
  session: StoredAgentSession,
  scopeId: string,
): Promise<void> {
  if (!projectId || !session.id) return;
  const db = await openDB();
  const key = sessionKey(scopeId, projectId, session.id);
  const tx = db.transaction([SESSIONS_STORE, INDEX_STORE], 'readwrite');
  tx.objectStore(SESSIONS_STORE).put({ key, session } satisfies SessionRecord);
  tx.objectStore(INDEX_STORE).put({ key, ...summarize(session) } satisfies IndexRecord);
  await done(tx, 'save the Media agent session');

  const summaries = await listAgentSessions(projectId, scopeId);
  const stale = summaries.slice(MAX_AGENT_SESSIONS_PER_PROJECT);
  if (stale.length) {
    await Promise.all(stale.map((summary) => deleteAgentSession(projectId, summary.id, scopeId)));
  }
}

export async function deleteAgentSession(projectId: string, sessionId: string, scopeId: string): Promise<void> {
  if (!projectId || !sessionId) return;
  const db = await openDB();
  const key = sessionKey(scopeId, projectId, sessionId);
  const tx = db.transaction([SESSIONS_STORE, INDEX_STORE], 'readwrite');
  tx.objectStore(SESSIONS_STORE).delete(key);
  tx.objectStore(INDEX_STORE).delete(key);
  await done(tx, 'delete the Media agent session');
}

/** Removes every saved chat for a project; called when the project itself is deleted. */
export async function deleteAgentSessionsForProject(projectId: string, scopeId: string): Promise<void> {
  if (!projectId) return;
  const db = await openDB();
  const range = prefixRange(projectPrefix(scopeId, projectId));
  const tx = db.transaction([SESSIONS_STORE, INDEX_STORE], 'readwrite');
  tx.objectStore(SESSIONS_STORE).delete(range);
  tx.objectStore(INDEX_STORE).delete(range);
  await done(tx, "delete the project's Media agent sessions");
}
