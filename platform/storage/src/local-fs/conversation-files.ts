/**
 * A conversation's files, kept beside it on disk.
 *
 * Willow saves every conversation as one JSON file. What belongs to it — what the
 * user attached, what an agent saw — goes in a folder with the same name next to it:
 *
 *   Chats/Trip ideas.json
 *   Chats/Trip ideas/Attachments/beach [3f2a9c1e].jpg
 *   Spark/Tasks/<task id>/Browser/001 duckduckgo.com.jpg
 *
 * The conversation holds a pointer to each file rather than its bytes, the way
 * ChatGPT's export does: the JSON stays small, and the files open from the folder
 * like any others. No scanner mistakes these folders for conversations — each lists
 * only the `.json` files beside them, and Media reserves the name of its folder.
 *
 * Like the other disk modules here, nothing throws: a mirror write is background
 * sync, reported through the return value and retried by the next save.
 */

import { moveToRecycleBin, type RecycleBinPlace } from './recycle-bin';

export interface ConversationFile {
  /** Where it goes inside the conversation's folder, e.g. `Attachments/beach [3f2a9c1e].jpg`. */
  path: string;
  /** The bytes. Only asked for when the file is not on disk yet, or `replace` is set. */
  read: () => Blob | null | Promise<Blob | null>;
  /** Rewrite it even when it exists: for a list that grows, like `Browser/steps.json`. */
  replace?: boolean;
}

/** The folder names inside a conversation's folder. */
export const CONVERSATION_FOLDERS = {
  attachments: 'Attachments',
  browser: 'Browser',
  screenshots: 'Screenshots',
} as const;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** `name` made safe as one path segment on Windows, macOS and Linux. */
export const safeFileStem = (name: string, fallback = 'file'): string => {
  const cleaned = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Windows drops trailing dots and spaces, which would make two names one file.
  const stem = cleaned.slice(0, 80).replace(/[. ]+$/, '').trim() || fallback;
  return WINDOWS_RESERVED.test(stem) ? `${stem}_` : stem;
};

/** FNV-1a as 8 hex digits: short and stable, enough to tell one conversation's files apart. */
export const shortHash = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/**
 * A key for bytes that came without an id. Hashes the ends and the length rather
 * than every byte, because a save hashes each attachment again and they can be
 * megabytes; two different files that share both ends and their length are not a
 * realistic pair inside one conversation.
 */
export const contentKey = (data: string): string =>
  shortHash(`${data.length}:${data.slice(0, 4096)}:${data.slice(-4096)}`);

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export const extensionForMime = (mimeType: string | undefined): string => {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (EXTENSION_BY_MIME[mime]) return EXTENSION_BY_MIME[mime];
  const subtype = mime.split('/')[1]?.split('+')[0] ?? '';
  return /^[a-z0-9]{1,8}$/.test(subtype) ? subtype : '';
};

/**
 * The file a conversation's attachment is kept as: its own name, tagged with a hash
 * of `key` (its id, or `contentKey` of its bytes). The same attachment always maps
 * to the same file, so a save never writes it twice, and two files of one name
 * never overwrite each other.
 */
export const conversationFileName = (name: string | undefined, key: string, mimeType?: string): string => {
  const base = String(name ?? '').trim();
  const dot = base.lastIndexOf('.');
  const ownExtension = dot > 0 ? base.slice(dot + 1) : '';
  const hasOwnExtension = /^[a-z0-9]{1,10}$/i.test(ownExtension);
  const extension = (hasOwnExtension ? ownExtension : extensionForMime(mimeType)).toLowerCase();
  const stem = safeFileStem(hasOwnExtension ? base.slice(0, dot) : base, 'attachment');
  return `${stem} [${shortHash(key)}]${extension ? `.${extension}` : ''}`;
};

const splitPath = (path: string): string[] | null => {
  const parts = String(path ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  return parts;
};

const isNotFound = (error: unknown): boolean => (error as { name?: string } | null)?.name === 'NotFoundError';

const fileAt = async (
  folder: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean,
): Promise<FileSystemFileHandle> => {
  let dir = folder;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
  return dir.getFileHandle(parts[parts.length - 1], { create });
};

const exists = async (folder: FileSystemDirectoryHandle, parts: string[]): Promise<boolean> => {
  try {
    await fileAt(folder, parts, false);
    return true;
  } catch {
    return false;
  }
};

const writeBlob = async (folder: FileSystemDirectoryHandle, parts: string[], blob: Blob): Promise<void> => {
  const handle = await fileAt(folder, parts, true);
  // The browser writes to a swap file and only replaces the real one on close, so
  // an interrupted write leaves the old file (or none), never half a new one.
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try { await writable.abort(error); } catch {}
    throw error;
  }
};

/**
 * Puts each file in `<dir>/<stem>/` unless it is already there. True once all of
 * them are on disk.
 *
 * `known` is the caller's memory of paths already written for this conversation, so
 * a save that runs on every message does not probe the disk for every file each
 * time. A file whose bytes are not available yet is skipped, not remembered, and the
 * next save tries it again.
 */
export async function writeConversationFiles(
  dir: FileSystemDirectoryHandle,
  stem: string,
  files: readonly ConversationFile[],
  known?: Set<string>,
): Promise<boolean> {
  if (!stem || files.length === 0) return true;
  // Made only for a file that is written: bytes that never arrive leave no empty folder.
  let folder: FileSystemDirectoryHandle | null = null;
  const openFolder = async (create: boolean): Promise<FileSystemDirectoryHandle | null> => {
    if (folder) return folder;
    try {
      folder = await dir.getDirectoryHandle(stem, { create });
    } catch (error) {
      if (create) throw error;
    }
    return folder;
  };
  let complete = true;
  for (const file of files) {
    const parts = splitPath(file.path);
    if (!parts) {
      complete = false;
      continue;
    }
    const key = parts.join('/');
    if (!file.replace && known?.has(key)) continue;
    try {
      const existing = await openFolder(false);
      if (!file.replace && existing && await exists(existing, parts)) {
        known?.add(key);
        continue;
      }
      const blob = await file.read();
      if (!blob) {
        complete = false;
        continue;
      }
      await writeBlob((await openFolder(true))!, parts, blob);
      known?.add(key);
    } catch {
      complete = false;
    }
  }
  return complete;
}

/** The file at `path` in `<dir>/<stem>/`, or null when it is not there. */
export async function readConversationFile(
  dir: FileSystemDirectoryHandle,
  stem: string,
  path: string,
): Promise<File | null> {
  const parts = splitPath(path);
  if (!stem || !parts) return null;
  try {
    const folder = await dir.getDirectoryHandle(stem);
    return await (await fileAt(folder, parts, false)).getFile();
  } catch {
    return null;
  }
}

/** Removes `<dir>/<stem>/` and everything in it, into the Recycle Bin when `bin` says where `dir` is.
 *  True when it is gone, or was never there. */
export async function deleteConversationFolder(dir: FileSystemDirectoryHandle, stem: string, bin?: RecycleBinPlace): Promise<boolean> {
  if (!stem) return false;
  try {
    if (bin) await moveToRecycleBin(bin, dir, stem);
    else await dir.removeEntry(stem, { recursive: true });
    return true;
  } catch (error) {
    return isNotFound(error);
  }
}

const copyFolder = async (from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle): Promise<void> => {
  for await (const entry of (from as any).values()) {
    if (entry.kind === 'directory') {
      await copyFolder(entry, await to.getDirectoryHandle(entry.name, { create: true }));
    } else if (entry.kind === 'file') {
      await writeBlob(to, [entry.name], await entry.getFile());
    }
  }
};

const temporaryName = (stem: string): string =>
  `${stem}.willow-move-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;

/**
 * Moves `<fromDir>/<fromStem>/` to `<toDir>/<toStem>/`, as a conversation's file is
 * renamed or filed elsewhere. True when the files are where they should be, which
 * includes a conversation that had no folder.
 *
 * Chromium has no directory `move()`, so this copies, then removes the original:
 * an interruption leaves a complete copy in at least one place. A rename that only
 * changes case resolves to the same folder on Windows and macOS, and copying a
 * folder into itself and deleting "the old one" would delete it; that case goes
 * through a temporary folder instead, as `renameLocalFSProject` does.
 */
export async function moveConversationFolder(
  fromDir: FileSystemDirectoryHandle,
  fromStem: string,
  toDir: FileSystemDirectoryHandle,
  toStem: string,
): Promise<boolean> {
  if (!fromStem || !toStem) return false;
  let source: FileSystemDirectoryHandle;
  try {
    source = await fromDir.getDirectoryHandle(fromStem);
  } catch (error) {
    return isNotFound(error);
  }
  try {
    let sameParent = false;
    try { sameParent = await fromDir.isSameEntry(toDir); } catch {}
    if (sameParent && fromStem === toStem) return true;

    let target: FileSystemDirectoryHandle | null = null;
    try { target = await toDir.getDirectoryHandle(toStem); } catch {}
    if (target) {
      let sameFolder = false;
      try { sameFolder = await source.isSameEntry(target); } catch {}
      if (sameFolder) {
        const passing = temporaryName(toStem);
        const temporary = await toDir.getDirectoryHandle(passing, { create: true });
        await copyFolder(source, temporary);
        await fromDir.removeEntry(fromStem, { recursive: true });
        await copyFolder(temporary, await toDir.getDirectoryHandle(toStem, { create: true }));
        await toDir.removeEntry(passing, { recursive: true });
        return true;
      }
    }
    await copyFolder(source, target ?? await toDir.getDirectoryHandle(toStem, { create: true }));
    await fromDir.removeEntry(fromStem, { recursive: true });
    return true;
  } catch {
    return false;
  }
}
