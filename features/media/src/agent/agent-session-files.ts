// The Media agent's chats, read back from the project folder. Each chat is written to
// `Media/<project>/Agent sessions/<id>.json` whenever it is saved (LocalFSContext), its uploads in
// `<id>/` beside it. A browser that starts over has none of them in IndexedDB, so its history list
// would be empty: these put back the ones it lacks, newest first, as many as the list keeps without
// pushing out a chat it has. The uploads stay where they are, named by each attachment's `file`, and
// a transcript keeps its thumbnails.

import {
  listAgentSessions,
  MAX_AGENT_SESSIONS_PER_PROJECT,
  saveAgentSession,
  type StoredAgentAttachment,
  type StoredAgentLink,
  type StoredAgentMessage,
  type StoredAgentSession,
} from '@willow/storage/media-agent-sessions';

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function attachmentOf(raw: any): StoredAgentAttachment | null {
  if (!raw || typeof raw !== 'object' || !text(raw.mimeType)) return null;
  return {
    mimeType: raw.mimeType,
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(text(raw.thumb) && raw.thumb.startsWith('data:image/') ? { thumb: raw.thumb } : {}),
    ...(text(raw.mediaId) ? { mediaId: raw.mediaId } : {}),
    ...(text(raw.characterId) ? { characterId: raw.characterId } : {}),
    ...(text(raw.file) ? { file: raw.file } : {}),
  };
}

function linkOf(raw: any): StoredAgentLink | null {
  if (!raw || typeof raw !== 'object' || (raw.kind !== 'character' && raw.kind !== 'scene') || !text(raw.id)) return null;
  return {
    kind: raw.kind,
    id: raw.id,
    ...(text(raw.mediaId) ? { mediaId: raw.mediaId } : {}),
    ...(finite(raw.at) ? { at: raw.at } : {}),
  };
}

function messageOf(raw: any): StoredAgentMessage | null {
  if (!raw || typeof raw !== 'object' || !text(raw.id) || (raw.role !== 'user' && raw.role !== 'assistant')) return null;
  const attachments = Array.isArray(raw.attachments) ? raw.attachments.map(attachmentOf).filter(Boolean) as StoredAgentAttachment[] : [];
  const links = Array.isArray(raw.links) ? raw.links.map(linkOf).filter(Boolean) as StoredAgentLink[] : [];
  const actions = Array.isArray(raw.actions) ? raw.actions.filter((a: unknown): a is string => typeof a === 'string') : [];
  return {
    id: raw.id,
    role: raw.role,
    content: typeof raw.content === 'string' ? raw.content : '',
    createdAt: finite(raw.createdAt) ? raw.createdAt : 0,
    ...(raw.status === 'done' || raw.status === 'stopped' || raw.status === 'error' ? { status: raw.status } : {}),
    ...(text(raw.error) ? { error: raw.error } : {}),
    ...(raw.reaction === 'like' || raw.reaction === 'dislike' ? { reaction: raw.reaction } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(links.length ? { links } : {}),
    ...(actions.length ? { actions } : {}),
  };
}

/** A chat's file read back, or null for anything that isn't one. */
export function parseAgentSessionFile(source: string): StoredAgentSession | null {
  let raw: any;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !text(raw.id) || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages.map(messageOf).filter(Boolean) as StoredAgentMessage[];
  if (!messages.length) return null;
  const createdAt = finite(raw.createdAt) ? raw.createdAt : messages[0].createdAt;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    createdAt,
    updatedAt: finite(raw.updatedAt) ? raw.updatedAt : createdAt,
    messages,
  };
}

/**
 * The chats to put back: those in the folder this browser has none of (and did not delete), newest
 * first, as many as fit beside the ones it has.
 */
export function sessionsToImport(
  local: readonly { id: string }[],
  fromFolder: readonly StoredAgentSession[],
  deleted: (id: string) => boolean,
): StoredAgentSession[] {
  const have = new Set(local.map((s) => s.id));
  const room = Math.max(0, MAX_AGENT_SESSIONS_PER_PROJECT - have.size);
  const seen = new Set<string>();
  return [...fromFolder]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((s) => {
      if (have.has(s.id) || deleted(s.id) || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .slice(0, room);
}

/** Puts the folder's chats this browser lacks into its history. Returns how many. */
export async function importAgentSessions(
  projectId: string,
  scopeId: string,
  files: readonly { text: string }[],
  deleted: (id: string) => boolean,
): Promise<number> {
  if (!projectId || !files.length) return 0;
  const fromFolder = files.map((f) => parseAgentSessionFile(f.text)).filter(Boolean) as StoredAgentSession[];
  if (!fromFolder.length) return 0;
  const toImport = sessionsToImport(await listAgentSessions(projectId, scopeId), fromFolder, deleted);
  // Oldest first: each save prunes past the cap by age, and these all fit.
  for (const session of [...toImport].reverse()) await saveAgentSession(projectId, session, scopeId);
  return toImport.length;
}
