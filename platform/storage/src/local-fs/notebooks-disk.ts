/**
 * Notebooks on disk.
 *
 * A notebook's sources and chats belong in the folder the user picked for their
 * own data, in a shape they can open in a file manager and understand:
 *
 *   <chosen folder>/<workspace>/Notebooks/<Notebook's name>/
 *     .willow.json     the notebook's stable id
 *     Sources/         one real file per source
 *     Chats/           this notebook's chats, moved out of the global Chats/
 *
 * **The registry is still the source of truth for whether a notebook exists.**
 * `features/notebooks/src/notebooks-backend.ts` is scoped localStorage precisely
 * so notebooks keep working with no folder connected, and that promise is what
 * makes this module a mirror: every function here returns a failure value rather
 * than throwing, and a missing folder is an ordinary outcome, not an error.
 *
 * Folder names arrive as plain strings. Choosing one needs the whole notebook
 * list (titles collide) and it has to be remembered once chosen, so
 * `ensureNotebookFolderName` owns that and this module never reads the registry.
 * The three directory names below are imported rather than re-spelled, because
 * two modules spelling a path separately eventually means a chat written to a
 * folder nobody scans.
 *
 * Two rules carried over from the rest of this layer, both learned the hard way:
 *
 * 1. Read and delete paths never pass `{ create: true }`. Fabricating an empty
 *    workspace folder on a read made every cached chat look externally deleted.
 * 2. A folder holding chats is never removed. Deleting a notebook must not delete
 *    conversations, so `deleteNotebookFolder` refuses while `Chats/` has files in
 *    it and the caller has to unfile them first.
 */

import {
  NOTEBOOKS_DIR_NAME,
  NOTEBOOK_CHATS_DIR_NAME,
  NOTEBOOK_SOURCES_DIR_NAME,
} from '@willow/notebooks/notebooks-backend';

import { readProjectManifest, writeProjectManifest } from '../adapters/local-disk';
import type { DiskDeps } from './disk-deps';

/** Only the workspace-scoped halves of DiskDeps; a notebook is not project-addressed. */
export type NotebookDiskDeps = Pick<DiskDeps, 'getActiveHandle' | 'getSanitizedWorkspaceName'>;

/** Long enough for a real document name, short enough to survive a deep path. */
const MAX_SOURCE_NAME_LENGTH = 120;

/** What counts as an extension worth preserving, for the `(1)` collision suffix. */
const EXTENSION_RE = /\.[A-Za-z0-9]{1,10}$/;

/**
 * A source's title as one legal file name.
 *
 * `/` and `\` become `-` rather than being dropped: a website source with no
 * fetched title is named `en.wikipedia.org/wiki/Photosynthesis`, and deleting the
 * separators runs the words together into mush. Uploads are unaffected — a
 * browser never hands back a `File.name` containing a path separator.
 */
const sanitizeFileName = (raw: string, fallback: string): string => {
  const cleaned = (raw || '')
    .replace(/[\\/]+/g, '-')
    .replace(/[:*?"<>|]/g, '')
    // Control characters are equally illegal and arrive by paste.
    .replace(/[\x00-\x1f\x7f]/g, '')
    // A leading dot hides the file on every Unix-like system and collides with
    // the manifest's own name.
    .replace(/^\.+/, '')
    .trim();
  if (!cleaned) return fallback;
  const ext = EXTENSION_RE.exec(cleaned)?.[0] ?? '';
  const base = cleaned
    .slice(0, cleaned.length - ext.length)
    .slice(0, MAX_SOURCE_NAME_LENGTH)
    /*
     * Windows silently DROPS a trailing dot or space, so a file asked for as
     * "notes ." comes back named "notes" and every later lookup by the requested
     * name misses. Truncation above can leave a trailing space, so this runs
     * after it.
     */
    .replace(/[. ]+$/, '')
    .trim();
  return base ? `${base}${ext}` : fallback;
};

/**
 * What to write for one source.
 *
 * `blob` is the source's own bytes and always wins: an upload keeps the file the
 * user chose, byte for byte and with its own extension. Without one the payload
 * is text, and the name gains a text extension so a `.pdf` never holds plain
 * text — `lecture.pdf` with no bytes is written as `lecture.pdf.txt`, which says
 * exactly what it is.
 */
export interface NotebookSourcePayload {
  /** Display title. The basis for the file name, and the only required field. */
  title: string;
  kind: 'file' | 'website' | 'text' | 'drive';
  /** The source's own bytes, for an upload. */
  blob?: Blob | null;
  /** Extracted or pasted text. */
  content?: string;
  /** For a website: recorded as the file's first line. */
  url?: string;
}

/**
 * A stored `dataUrl` back to real bytes.
 *
 * For the backfill: a source added before this mirror existed kept small binary
 * payloads (images) inlined as a data URL and nothing else, so writing its text
 * body would leave a 0-byte `.txt` named after a picture. Decoding gives the user
 * the actual file in `Sources/`.
 *
 * Deliberately synchronous rather than `fetch(dataUrl)`: this runs inside the disk
 * poll, and a network-stack round trip per source — subject to whatever
 * `connect-src` the page is served under — is a lot of machinery for a base64
 * decode. Whitespace is stripped because a stored URL may have been wrapped.
 */
export const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl || '');
  if (!match) return null;
  const [, mimeType, base64, data] = match;
  const type = mimeType || 'application/octet-stream';
  try {
    if (!base64) return new Blob([decodeURIComponent(data)], { type });
    const binary = atob(data.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
};

/** The file name a payload gets, before collisions are resolved. */
const sourceFileName = (payload: NotebookSourcePayload): string => {
  const fallback = payload.kind === 'website' ? 'Website' : 'Source';
  const name = sanitizeFileName(payload.title, fallback);
  if (payload.blob) return name;
  // No bytes: this is a text file and must be named like one.
  if (payload.kind === 'file') return /\.txt$/i.test(name) ? name : `${name}.txt`;
  return /\.md$/i.test(name) ? name : `${name}.md`;
};

/**
 * The text body for a payload with no bytes.
 *
 * A website's URL goes on the first line, then a blank line, then the copy that
 * was taken when it was added. A page that could not be read is still written as
 * that one line, which is what makes the folder legible: the link is the source.
 */
const sourceTextBody = (payload: NotebookSourcePayload): string => {
  const content = payload.content ?? '';
  if (payload.kind === 'website' && payload.url) {
    return content ? `${payload.url}\n\n${content}\n` : `${payload.url}\n`;
  }
  return content.endsWith('\n') || !content ? content : `${content}\n`;
};

/** Resolve `<workspace>/Notebooks`, optionally creating it. */
const openNotebooksRoot = async (
  workspaceDir: FileSystemDirectoryHandle,
  create = false,
): Promise<FileSystemDirectoryHandle | null> => {
  try {
    return await workspaceDir.getDirectoryHandle(NOTEBOOKS_DIR_NAME, { create });
  } catch {
    return null;
  }
};

/**
 * Resolve one notebook's `Chats/` folder from an already-open workspace handle.
 *
 * The chat reconciler and every chat write go through this, so the path shape is
 * spelled once. Returns null when the folder is not there and `create` is false —
 * an unfiled-looking chat is a decision for the caller, never a fabricated folder.
 */
export const openNotebookChatsDir = async (
  workspaceDir: FileSystemDirectoryHandle,
  folderName: string,
  { create = false }: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle | null> => {
  if (!folderName) return null;
  try {
    const notebooksRoot = await openNotebooksRoot(workspaceDir, create);
    if (!notebooksRoot) return null;
    const notebookDir = await notebooksRoot.getDirectoryHandle(folderName, { create });
    return await notebookDir.getDirectoryHandle(NOTEBOOK_CHATS_DIR_NAME, { create });
  } catch {
    return null;
  }
};

/**
 * Create `Notebooks/<folderName>/` with its manifest and both sub-folders, and
 * return the notebook's own directory — from an already-open workspace handle.
 *
 * The manifest is written only when there is none, and a folder already claiming
 * a **different** id is refused rather than written into. The id in it is what
 * lets a folder rename keep its data, so if the two disagree the folder is
 * evidence and this call is a guess: a hand-renamed folder that happens to land
 * on another notebook's name would otherwise quietly collect that notebook's
 * sources and chats alongside the ones already inside.
 */
export const ensureNotebookDirIn = async (
  workspaceDir: FileSystemDirectoryHandle,
  folderName: string,
  notebookId: string,
): Promise<FileSystemDirectoryHandle | null> => {
  if (!folderName) return null;
  try {
    const notebooksRoot = await workspaceDir.getDirectoryHandle(NOTEBOOKS_DIR_NAME, { create: true });
    const notebookDir = await notebooksRoot.getDirectoryHandle(folderName, { create: true });

    if (notebookId) {
      const existing = await readProjectManifest(notebookDir);
      if (!existing?.id) await writeProjectManifest(notebookDir, notebookId);
      else if (existing.id !== notebookId) return null;
    }

    // Both sub-folders up front: an empty Sources/ next to an empty Chats/ tells
    // the user where things go before there is anything in either.
    await notebookDir.getDirectoryHandle(NOTEBOOK_SOURCES_DIR_NAME, { create: true });
    await notebookDir.getDirectoryHandle(NOTEBOOK_CHATS_DIR_NAME, { create: true });
    return notebookDir;
  } catch {
    return null;
  }
};

/** `ensureNotebookDirIn` for callers that hold deps rather than a workspace handle. */
export const ensureNotebookDir = async (
  { getActiveHandle, getSanitizedWorkspaceName }: NotebookDiskDeps,
  folderName: string,
  notebookId: string,
): Promise<FileSystemDirectoryHandle | null> => {
  if (!folderName) return null;
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return null;
  try {
    const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName(), { create: true });
    return await ensureNotebookDirIn(workspaceDir, folderName, notebookId);
  } catch {
    return null;
  }
};

/**
 * Write one source into `Notebooks/<folderName>/Sources/` and return the file
 * name it actually got, or null when there is no folder or the write failed.
 *
 * The returned name is the caller's to store on the source: two sources can share
 * a title, so collisions are resolved with the same `(1)` suffix
 * `saveMediaFileToDisk` uses, and a name derived again later would not match.
 */
export const saveNotebookSourceToDisk = async (
  deps: NotebookDiskDeps,
  folderName: string,
  notebookId: string,
  payload: NotebookSourcePayload,
): Promise<string | null> => {
  const notebookDir = await ensureNotebookDir(deps, folderName, notebookId);
  if (!notebookDir) return null;

  try {
    const sourcesDir = await notebookDir.getDirectoryHandle(NOTEBOOK_SOURCES_DIR_NAME, { create: true });

    const wanted = sourceFileName(payload);
    const ext = EXTENSION_RE.exec(wanted)?.[0] ?? '';
    const base = wanted.slice(0, wanted.length - ext.length);

    let finalFileName = wanted;
    let counter = 1;
    for (;;) {
      try {
        await sourcesDir.getFileHandle(finalFileName, { create: false });
      } catch {
        break; // the name is free
      }
      finalFileName = `${base} (${counter})${ext}`;
      counter += 1;
    }

    const fileHandle = await sourcesDir.getFileHandle(finalFileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(payload.blob ? payload.blob : sourceTextBody(payload));
      await writable.close();
    } catch (error) {
      // Abort rather than close, so a failed write leaves no truncated file for
      // the next collision probe to trip over.
      try { await writable.abort(error); } catch {}
      return null;
    }
    return finalFileName;
  } catch {
    return null;
  }
};

/**
 * Remove one source's file. Targeted: no folder is created on the way, and a
 * file that is already gone reports failure rather than pretending to have
 * deleted something.
 */
export const deleteNotebookSourceFromDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName }: NotebookDiskDeps,
  folderName: string,
  fsName: string,
): Promise<boolean> => {
  if (!folderName || !fsName) return false;
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;
  try {
    const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
    const notebooksRoot = await workspaceDir.getDirectoryHandle(NOTEBOOKS_DIR_NAME);
    const notebookDir = await notebooksRoot.getDirectoryHandle(folderName);
    const sourcesDir = await notebookDir.getDirectoryHandle(NOTEBOOK_SOURCES_DIR_NAME);
    await sourcesDir.removeEntry(fsName);
    return true;
  } catch {
    return false;
  }
};

/** Recursive copy, used by the rename fallback. Mirrors `renameLocalFSProject`. */
const copyDir = async (src: any, dst: any): Promise<void> => {
  for await (const entry of src.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      const fileHandle = await dst.getFileHandle(entry.name, { create: true });
      const writable = await fileHandle.createWritable();
      await file.stream().pipeTo(writable);
    } else if (entry.kind === 'directory') {
      const sub = await dst.getDirectoryHandle(entry.name, { create: true });
      await copyDir(entry, sub);
    }
  }
};

/**
 * Rename `Notebooks/<oldName>/` to `Notebooks/<newName>/`.
 *
 * Chromium has never implemented `move()` for directories, so this almost always
 * takes the copy-then-delete fallback — and the original is only removed after a
 * complete copy, so an interruption can never leave zero copies.
 *
 * A **case-only** rename ("physics" → "Physics") is the dangerous one: on
 * Windows and a default macOS, `getDirectoryHandle(newName)` resolves to the same
 * directory, so the naive fallback copies a folder into itself and then deletes
 * the one and only copy. Detected with `isSameEntry` and routed through a temp
 * sibling, exactly as the project rename is.
 *
 * The caller **must** hold a rename guard over this: the observer sees the copy
 * as a burst of created files and the delete as a burst of deleted ones, and a
 * reconcile landing in the middle reads a half-copied folder as a mass external
 * delete and persists that loss.
 */
export const renameNotebookFolder = async (
  { getActiveHandle, getSanitizedWorkspaceName }: NotebookDiskDeps,
  oldName: string,
  newName: string,
): Promise<boolean> => {
  if (!oldName || !newName || oldName === newName) return false;
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
    const notebooksRoot = await workspaceDir.getDirectoryHandle(NOTEBOOKS_DIR_NAME);

    let oldHandle: FileSystemDirectoryHandle;
    try {
      oldHandle = await notebooksRoot.getDirectoryHandle(oldName);
    } catch {
      return false; // nothing on disk under the old name; nothing to rename
    }

    if (typeof (oldHandle as any).move === 'function') {
      try {
        await (oldHandle as any).move(newName);
        return true;
      } catch {}
    }

    /*
     * Refuse to merge into a folder that already exists and is a different
     * directory: that would silently mix two notebooks' chats. The caller's
     * collision suffix is what makes this case unreachable in practice, so
     * reaching it means the two disagree and stopping is the safe answer.
     */
    const newHandle = await notebooksRoot.getDirectoryHandle(newName, { create: true });
    let sameEntry = false;
    try { sameEntry = await oldHandle.isSameEntry(newHandle); } catch {}
    if (sameEntry) {
      const tmpName = `${newName}.willow-rename-${crypto.randomUUID?.() || Date.now().toString(36)}`;
      const tmpHandle = await notebooksRoot.getDirectoryHandle(tmpName, { create: true });
      await copyDir(oldHandle, tmpHandle);
      await notebooksRoot.removeEntry(oldName, { recursive: true });
      const finalHandle = await notebooksRoot.getDirectoryHandle(newName, { create: true });
      await copyDir(tmpHandle, finalHandle);
      await notebooksRoot.removeEntry(tmpName, { recursive: true });
      return true;
    }

    // A brand-new folder is empty; anything else was already someone's.
    let occupied = false;
    for await (const _entry of (newHandle as any).values()) { occupied = true; break; }
    if (occupied) {
      return false;
    }

    await copyDir(oldHandle, newHandle);
    await notebooksRoot.removeEntry(oldName, { recursive: true });
    return true;
  } catch {
    return false;
  }
};

/**
 * Remove a notebook's folder, **only** once its `Chats/` is empty.
 *
 * Deleting a notebook is a grouping decision and must not delete conversations;
 * unfiling every chat first is the caller's job, and refusing here is what keeps
 * a mistake there from being unrecoverable. Returns false without touching
 * anything when a chat file is still inside.
 */
export const deleteNotebookFolder = async (
  { getActiveHandle, getSanitizedWorkspaceName }: NotebookDiskDeps,
  folderName: string,
): Promise<boolean> => {
  if (!folderName) return false;
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;
  try {
    const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
    const notebooksRoot = await workspaceDir.getDirectoryHandle(NOTEBOOKS_DIR_NAME);
    const notebookDir = await notebooksRoot.getDirectoryHandle(folderName);

    try {
      const chatsDir = await notebookDir.getDirectoryHandle(NOTEBOOK_CHATS_DIR_NAME);
      for await (const entry of (chatsDir as any).values()) {
        if (entry.kind === 'file') return false;
      }
    } catch {
      // No Chats/ at all is the empty case, not a reason to refuse.
    }

    await notebooksRoot.removeEntry(folderName, { recursive: true });
    return true;
  } catch {
    return false;
  }
};

/**
 * Move one file between two directories, preferring the native atomic move.
 *
 * This is how a chat file crosses between the global `Chats/` and a notebook's,
 * and the ordering is the whole point: the copy completes before the original is
 * removed, so an interruption leaves the file readable in its old home and the
 * reconciler finishes the job on the next poll.
 *
 * Same-directory moves report success without touching the disk, so a caller that
 * cannot tell whether a move is needed does not have to.
 */
export const moveFileBetweenDirs = async (
  fromDir: FileSystemDirectoryHandle,
  toDir: FileSystemDirectoryHandle,
  fileName: string,
): Promise<boolean> => {
  if (!fileName) return false;
  try {
    if (await fromDir.isSameEntry(toDir)) return true;
  } catch {}

  try {
    const fileHandle = await fromDir.getFileHandle(fileName);

    if (typeof (fileHandle as any).move === 'function') {
      try {
        await (fileHandle as any).move(toDir, fileName);
        return true;
      } catch {}
    }

    const file = await fileHandle.getFile();
    const target = await toDir.getFileHandle(fileName, { create: true });
    const writable = await target.createWritable();
    try {
      await file.stream().pipeTo(writable);
    } catch (error) {
      try { await writable.abort(error); } catch {}
      // Leave the original alone: a half-written copy is not a move.
      try { await toDir.removeEntry(fileName); } catch {}
      return false;
    }
    await fromDir.removeEntry(fileName);
    return true;
  } catch {
    return false;
  }
};
