/**
 * What Spark's runs and bots make, kept in the user's folder. Each workspace in OPFS — what
 * `harness/workspace/workspace.ts` writes — is mirrored file for file, at the same paths, and read
 * back into a browser whose OPFS lacks them (its storage was cleared, or it is a new copy of Willow
 * on the folder):
 *
 *   tasks   willow-spark/<scope>/workspace/…      Spark/Files/…
 *   a bot   willow-spark/dot-<bot>/workspace/…    Spark/Dots/<bot>/Files/…
 *
 * Nothing is deleted on either side: a file one side lacks is copied to it. Which side changed a
 * file both have is told by what was last copied, kept per folder in localStorage. One both changed,
 * or that differs with nothing copied yet (a first pass), keeps the folder's copy in place and this
 * browser's beside it as `<name> (Conflict <time>).<ext>`. While a run or a bot's turn has its
 * workspace open nothing in OPFS is written: the run would write its own copy back over the change
 * with its next one, and that would read as the newer.
 *
 * A file the harness never reads (over `MAX_SPARK_FILE_BYTES`), a name Windows cannot hold, and the
 * files past a workspace's first MAX_FILES stay where they are, said once in the console.
 */
import { isValidItemId } from '@willow/storage/local-sync';
import { DOTS_FOLDER } from './dots/dots-folder-plan';
import { sparkDots } from './dots/dots-store';
import { MAX_SPARK_FILE_BYTES } from './harness/workspace/workspace';
import { sparkState } from './spark-store';

export const SPARK_FILES_FOLDER = 'Spark/Files';

const MAX_FILES = 2_000;
const MAX_DEPTH = 24;
/** Bytes one pass reads; what is left waits for the next. */
const PASS_BYTES = 64 * 1024 * 1024;

type Dir = FileSystemDirectoryHandle;

interface Workspace {
  /** Its entry among what was copied. */
  id: string;
  /** How the console names it. */
  label: string;
  opfs: string[];
  folder: string[];
  /** Whether a run has it open right now. */
  busy: () => Promise<boolean>;
}

interface Entry {
  path: string;
  handle: FileSystemFileHandle;
  file: File;
}

/** A file as last copied: a hash of its bytes, and each side's size and time while it held them. */
interface Copied {
  hash: string;
  opfs?: string;
  folder?: string;
}

const said = new Set<string>();
const say = (key: string, message: string): void => {
  if (said.has(key)) return;
  said.add(key);
  console.warn(`[spark] ${message}`);
};

const isNotFound = (error: unknown): boolean => (error as { name?: string } | null)?.name === 'NotFoundError';

const entriesOf = (dir: Dir): AsyncIterable<FileSystemHandle> =>
  (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values();

const stampOf = (file: File): string => `${file.size}:${file.lastModified}`;

const hashOf = async (bytes: ArrayBuffer): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
/** OPFS takes any name; the folder may be on Windows, which drops trailing dots and spaces and refuses these. */
const portable = (path: string): boolean => path.split('/').every((part) =>
  part.length <= 255 && !/[\u0000-\u001f\\:*?"<>|]/.test(part) && !/[. ]$/.test(part) && !WINDOWS_RESERVED.test(part));

/** What a browser or the system keeps beside files while they are written or browsed, never a run's. */
const isScratch = (name: string): boolean =>
  name.endsWith('.crswap') || name.startsWith('~$') || /^(desktop\.ini|thumbs\.db|\.ds_store)$/i.test(name);

const copiedKey = (scopeId: string, workspaceId: string) =>
  `willow:spark:files:v1:${encodeURIComponent(scopeId)}:${encodeURIComponent(workspaceId)}`;

const readCopied = (scopeId: string, workspaceId: string): Record<string, Copied> => {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(copiedKey(scopeId, workspaceId)) ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof (value as Copied | null)?.hash === 'string')) as Record<string, Copied>;
  } catch {
    return {};
  }
};

const writeCopied = (scopeId: string, workspaceId: string, copied: Record<string, Copied>): void => {
  try {
    globalThis.localStorage?.setItem(copiedKey(scopeId, workspaceId), JSON.stringify(copied));
  } catch {
    // Storage full: the next pass compares what differs as a first pass would, losing nothing.
  }
};

/** The OPFS root, or null where the browser has none. */
const opfsRoot = async (): Promise<Dir | null> => {
  const storage = (typeof navigator === 'undefined' ? undefined : navigator.storage) as
    | (StorageManager & { getDirectory?: () => Promise<Dir> })
    | undefined;
  if (!storage?.getDirectory) return null;
  try {
    return await storage.getDirectory();
  } catch {
    return null;
  }
};

/** A workspace's own folder, by its exact names: a scope or a bot is never another's spelled otherwise. */
const exactDir = async (root: Dir, parts: readonly string[], create: boolean): Promise<Dir | null> => {
  let dir = root;
  try {
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  } catch (error) {
    if (!create && isNotFound(error)) return null;
    throw error;
  }
};

/** A folder inside a workspace, matched without case when it is not there as spelled: the user's folder
 *  compares names so on Windows, OPFS does not, and a file is matched across the two the same way. */
const childDir = async (dir: Dir, name: string): Promise<Dir> => {
  try {
    return await dir.getDirectoryHandle(name);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const wanted = name.toLowerCase();
  for await (const entry of entriesOf(dir)) {
    if (entry.kind === 'directory' && entry.name.toLowerCase() === wanted) return entry as Dir;
  }
  return dir.getDirectoryHandle(name, { create: true });
};

/** Every file below `dir`, by its path without case; false when it stopped at MAX_FILES. */
const list = async (dir: Dir, out: Map<string, Entry>, prefix = '', depth = 0): Promise<boolean> => {
  for await (const entry of entriesOf(dir)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      if (depth < MAX_DEPTH && !(await list(entry as Dir, out, path, depth + 1))) return false;
      continue;
    }
    if (isScratch(entry.name)) continue;
    if (out.size >= MAX_FILES) return false;
    const key = path.toLowerCase();
    if (out.has(key)) continue;
    try {
      out.set(key, { path, handle: entry as FileSystemFileHandle, file: await (entry as FileSystemFileHandle).getFile() });
    } catch {
      // Gone, or being written: the next pass sees it.
    }
  }
  return true;
};

const writeTo = async (handle: FileSystemFileHandle, bytes: ArrayBuffer): Promise<File> => {
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  return handle.getFile();
};

/** Over a file as it was listed; null when it changed since, for the next pass to compare again. */
const writeOver = async (entry: Entry, bytes: ArrayBuffer): Promise<File | null> =>
  stampOf(await entry.handle.getFile()) === stampOf(entry.file) ? writeTo(entry.handle, bytes) : null;

/** A file the listing did not have; null when one is there now. */
const writeNew = async (root: Dir, path: string, bytes: ArrayBuffer): Promise<File | null> => {
  const parts = path.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await childDir(dir, part);
  const name = parts[parts.length - 1];
  try {
    await dir.getFileHandle(name);
    return null;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return writeTo(await dir.getFileHandle(name, { create: true }), bytes);
};

const conflictPath = (path: string, taken: (key: string) => boolean): string => {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const at = (suffix: string) => `${path.slice(0, slash + 1)}${stem} (Conflict ${stamp}${suffix})${extension}`;
  let candidate = at('');
  for (let count = 2; taken(candidate.toLowerCase()); count += 1) candidate = at(` ${count}`);
  return candidate;
};

const isLockHeld = async (name: string): Promise<boolean> => {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  try {
    return Boolean((await locks?.query())?.held?.some((lock) => lock.name === name));
  } catch {
    return false;
  }
};

const workspacesOf = (scopeId: string): Workspace[] => [
  {
    id: 'tasks',
    label: "Spark's files",
    opfs: ['willow-spark', scopeId, 'workspace'],
    folder: SPARK_FILES_FOLDER.split('/'),
    busy: async () => sparkState.get().tasks.some((task) => task.status === 'running' || task.status === 'queued'),
  },
  ...sparkDots.get().dots.filter((dot) => isValidItemId(dot.id)).map((dot) => ({
    id: `dot-${dot.id}`,
    label: `Bot "${dot.name || dot.id}"`,
    opfs: ['willow-spark', `dot-${dot.id}`, 'workspace'],
    folder: [...DOTS_FOLDER.split('/'), dot.id, 'Files'],
    // Held, in any tab, while the bot's turn runs (`harness/dot-runtime.ts`).
    busy: () => isLockHeld(`willow-dot-turn:${dot.id}`),
  })),
];

interface Budget {
  left: number;
}

const syncWorkspace = async (workspace: Workspace, folderRoot: Dir, opfs: Dir, scopeId: string, budget: Budget): Promise<void> => {
  const opfsDir = await exactDir(opfs, workspace.opfs, false);
  const folderDir = await exactDir(folderRoot, workspace.folder, false);
  if (!opfsDir && !folderDir) return;
  const here = new Map<string, Entry>();
  const there = new Map<string, Entry>();
  const hereWhole = !opfsDir || await list(opfsDir, here);
  const thereWhole = !folderDir || await list(folderDir, there);
  if (!hereWhole) say(`${workspace.id}:many`, `${workspace.label}: only the first ${MAX_FILES} files are kept in the folder.`);
  if (!thereWhole) say(`${workspace.id}:many-there`, `${workspace.label}: only the first ${MAX_FILES} files in the folder are read back.`);

  const copied = readCopied(scopeId, workspace.id);
  let changed = false;
  const record = (key: string, next: Copied | null) => {
    const last = copied[key];
    if (next === null ? !last : last?.hash === next.hash && last.opfs === next.opfs && last.folder === next.folder) return;
    if (next === null) delete copied[key];
    else copied[key] = next;
    changed = true;
  };
  // On neither side any more. Only from whole listings, where missing from one means missing.
  if (hereWhole && thereWhole) for (const key of Object.keys(copied)) if (!here.has(key) && !there.has(key)) record(key, null);

  const opfsSide = async () => opfsDir ?? (await exactDir(opfs, workspace.opfs, true))!;
  const folderSide = async () => folderDir ?? (await exactDir(folderRoot, workspace.folder, true))!;
  const added = new Set<string>();
  const taken = (key: string) => here.has(key) || there.has(key) || added.has(key);
  const bytesOf = (entry: Entry): Promise<ArrayBuffer> => {
    budget.left -= entry.file.size;
    return entry.file.arrayBuffer();
  };
  /** A file's hash: what was last copied when it is unchanged since, else of its bytes, read now. */
  const contentOf = async (entry: Entry, side: 'opfs' | 'folder', last: Copied | undefined) => {
    if (last?.[side] === stampOf(entry.file)) return { hash: last.hash, bytes: null };
    const bytes = await bytesOf(entry);
    return { hash: await hashOf(bytes), bytes };
  };

  const syncFile = async (key: string): Promise<void> => {
    const mine = here.get(key);
    const theirs = there.get(key);
    const last = copied[key];
    const large = [mine, theirs].find((entry) => entry && entry.file.size > MAX_SPARK_FILE_BYTES);
    if (large) {
      say(`${workspace.id}:large:${key}`, `${workspace.label}: ${large.path} is over Spark's ${MAX_SPARK_FILE_BYTES / 1_000_000} MB file limit and is not copied.`);
      return;
    }
    if (mine && !portable(mine.path)) {
      say(`${workspace.id}:name:${key}`, `${workspace.label}: ${mine.path} has a name Windows cannot hold and stays in this browser only.`);
      return;
    }
    if (mine && !theirs) {
      const ours = await contentOf(mine, 'opfs', last);
      if (last?.folder && last.hash === ours.hash) {
        // Copied once and removed from the folder since, by the user: it stays out until it changes here.
        record(key, { ...last, opfs: stampOf(mine.file) });
        return;
      }
      const file = await writeNew(await folderSide(), mine.path, ours.bytes ?? await bytesOf(mine));
      if (file) record(key, { hash: ours.hash, opfs: stampOf(mine.file), folder: stampOf(file) });
      return;
    }
    if (!mine && theirs) {
      if (await workspace.busy()) return;
      const disk = await contentOf(theirs, 'folder', last);
      const file = await writeNew(await opfsSide(), theirs.path, disk.bytes ?? await bytesOf(theirs));
      if (file) record(key, { hash: disk.hash, opfs: stampOf(file), folder: stampOf(theirs.file) });
      return;
    }
    if (!mine || !theirs) return;
    const ours = await contentOf(mine, 'opfs', last);
    const disk = await contentOf(theirs, 'folder', last);
    if (ours.hash === disk.hash) {
      record(key, { hash: ours.hash, opfs: stampOf(mine.file), folder: stampOf(theirs.file) });
      return;
    }
    if (last && disk.hash === last.hash) {
      // Changed here since it was copied.
      const file = await writeOver(theirs, ours.bytes ?? await bytesOf(mine));
      if (file) record(key, { hash: ours.hash, opfs: stampOf(mine.file), folder: stampOf(file) });
      return;
    }
    if (await workspace.busy()) return;
    if (last && ours.hash === last.hash) {
      // Changed in the folder since it was copied: by another copy of Willow, or by the user.
      const file = await writeOver(mine, disk.bytes ?? await bytesOf(theirs));
      if (file) record(key, { hash: disk.hash, opfs: stampOf(file), folder: stampOf(theirs.file) });
      return;
    }
    // Changed on both sides, or nothing copied yet to tell which: the folder's stays, this browser's goes beside it.
    const aside = conflictPath(theirs.path, taken);
    const set = await writeNew(await folderSide(), aside, ours.bytes ?? await bytesOf(mine));
    if (!set) return;
    added.add(aside.toLowerCase());
    record(aside.toLowerCase(), { hash: ours.hash, folder: stampOf(set) });
    say(`${workspace.id}:conflict:${key}`, `${workspace.label}: ${theirs.path} was not the same here as in the folder; this browser's copy is kept beside it as ${aside}.`);
    const file = await writeOver(mine, disk.bytes ?? await bytesOf(theirs));
    if (file) record(key, { hash: disk.hash, opfs: stampOf(file), folder: stampOf(theirs.file) });
  };

  for (const key of [...new Set([...here.keys(), ...there.keys()])].sort()) {
    if (budget.left <= 0) break;
    // Unreadable or unwritable right now, or changed while it was read: the next pass tries it again.
    await syncFile(key).catch(() => undefined);
  }
  if (changed) writeCopied(scopeId, workspace.id, copied);
};

/** One pass over the tasks' workspace and every bot's. Nothing throws: what fails waits for the next pass. */
export const syncSparkWorkspaceFiles = async (root: Dir, scopeId: string): Promise<void> => {
  const opfs = await opfsRoot();
  if (!opfs) return;
  const budget: Budget = { left: PASS_BYTES };
  for (const workspace of workspacesOf(scopeId)) {
    if (budget.left <= 0) return;
    await syncWorkspace(workspace, root, opfs, scopeId, budget).catch(() => undefined);
  }
};
