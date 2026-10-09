/**
 * Reading a Code project's chats back from its `Chat sessions/` folder.
 *
 * A project's chat sessions live in IndexedDB. The folder is the copy on disk, and
 * it is the only one that survives a reinstall that wipes browser storage, or reaches
 * another copy of Willow pointed at the same folder. Opened there, the project gets
 * its files back from `Codebase/` and, through this, its chats.
 *
 * The folder mirrors screens rather than sessions: each screen that opens the
 * project writes one file, under its own title, holding whichever session it showed
 * last. So a chat that was reopened is on disk once per reopening, as it stood each
 * time, and a chat is known by its first message rather than by its file's name. Of
 * its copies the longest is kept: Code only ever appends to a chat, so that copy
 * holds every other.
 *
 * A Design chat is written to the same folder but is never a session, so a file with
 * a reply linked to a canvas node is skipped. Revert checkpoints come back with the
 * messages they are on (`filesSnapshot`); which one the session last reverted to is
 * not on disk, so a restored session starts on none.
 *
 * The files are in the user's own folder and may have been edited, or written by an
 * older build, so every message goes through the same sanitiser as a chat reopened
 * from Recents (./resume-code-chat). A file that is not a chat is skipped.
 */
import { isTempChatId } from '@willow/storage/local-fs/chat-metadata';
import type { ProjectChatOnDisk } from '@willow/storage/local-fs/code-disk';
import { shortHash } from '@willow/storage/local-fs/conversation-files';
import { joinChatFiles } from './chat-files';
import { latestResumedSnapshot, sanitizeResumedCodeMessages, type ResumedCodeMessage } from './resume-code-chat';

/** Structurally the workbench's own `ChatSession`, which is declared inside `WorkbenchSidebar`. */
export interface RestoredCodeSession {
  id: string;
  name: string;
  messages: ResumedCodeMessage[];
  filesSnapshot: Record<string, string>;
  activeSnapshotId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Which chat a list of messages is: its first message's id and time, normalised the
 * way the sanitiser normalises them. The same in the JSON on disk, in a stored session,
 * and in a session restored from either, so each copy of one chat matches the others.
 */
const chatKey = (messages: unknown): string | null => {
  if (!Array.isArray(messages)) return null;
  const first = messages.find((entry: any) =>
    entry
    && typeof entry === 'object'
    && (entry.role === 'user' || entry.role === 'assistant')
    && typeof entry.content === 'string');
  if (!first) return null;
  const id = typeof first.id === 'string' && first.id ? first.id : 'resumed_0';
  const timestamp = Number.isFinite(first.timestamp) && Number(first.timestamp) > 0 ? Math.floor(Number(first.timestamp)) : 0;
  return `${id}@${timestamp}`;
};

const isDesignMessage = (entry: any): boolean =>
  !!entry && typeof entry === 'object' && typeof entry.designNodeId === 'string' && entry.designNodeId.length > 0;

/**
 * The sessions a project's chats on disk make, newest first. Takes what
 * `loadLocalFSProjectChats` answered; nothing to read is no sessions.
 */
export const readProjectChatSessions = async (chats: readonly ProjectChatOnDisk[] | null): Promise<RestoredCodeSession[]> => {
  if (!chats?.length) return [];

  const copies = new Map<string, { chat: ProjectChatOnDisk; messages: unknown[] }[]>();
  for (const chat of chats) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(chat.text);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed) || parsed.some(isDesignMessage)) continue;
    const key = chatKey(parsed);
    if (!key) continue;
    const list = copies.get(key) ?? [];
    list.push({ chat, messages: parsed });
    copies.set(key, list);
  }

  const sessions: RestoredCodeSession[] = [];
  for (const [key, list] of copies) {
    list.sort((a, b) => b.messages.length - a.messages.length || b.chat.lastModified - a.chat.lastModified);
    const { chat } = list[0];
    const messages = sanitizeResumedCodeMessages(await joinChatFiles(list[0].messages, chat.readFile));
    if (!messages.length) continue;
    // A copy left on its generated id was never named; another copy of it may have been.
    const name = list.map((copy) => copy.chat.chatId).find((chatId) => !isTempChatId(chatId));
    const createdAt = messages[0].timestamp || chat.lastModified || Date.now();
    const lastMessageAt = messages.reduce((latest, message) => Math.max(latest, message.timestamp), 0);
    sessions.push({
      id: `session_${createdAt}_${shortHash(key)}`,
      // The placeholder the sidebar's session naming looks for.
      name: name ?? 'Initial Chat',
      messages,
      filesSnapshot: latestResumedSnapshot(messages) ?? {},
      activeSnapshotId: null,
      createdAt,
      // From the messages rather than the file, whose time a copied folder resets.
      updatedAt: Math.max(createdAt, lastMessageAt || chat.lastModified),
    });
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
};

/**
 * What a project's stored sessions become with the chats read back from disk, or
 * null to leave them as they are. They are only ever added to: a chat that is
 * already a session stays as the browser has it, and none is added twice.
 */
export const withRestoredChats = <S extends { messages?: unknown }>(
  stored: readonly S[] | null,
  restored: readonly RestoredCodeSession[],
): (S | RestoredCodeSession)[] | null => {
  const present = new Set((stored ?? []).map((session) => chatKey(session?.messages)));
  const missing = restored.filter((session) => {
    const key = chatKey(session.messages);
    if (present.has(key)) return false;
    present.add(key);
    return true;
  });
  return missing.length ? [...(stored ?? []), ...missing] : null;
};
