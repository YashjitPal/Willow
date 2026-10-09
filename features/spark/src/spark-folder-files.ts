/**
 * Spark's files in the user's folder beyond its records: what was attached to tasks
 * (`spark-task-files.ts`) and sent to bots (`dots/dot-attachment-files.ts`), and what runs and bots
 * made (`spark-workspace-files.ts`). A pass keeps them both ways — written from this browser, read
 * back into one that lacks them — beside the synced folders' own passes: `register.ts` asks for one
 * from the tasks' folder, whose passes wait until Spark's store has loaded the folder's scope. At
 * most one every MIN_GAP_MS, in one tab at a time.
 */
import { getStoredDirectoryRecord, verifyPermission } from '@willow/storage/adapters/local-disk';
import { syncDotAttachmentFiles } from './dots/dot-attachment-files';
import { withWebLock } from './dots/harness/runtime/web-lock';
import { sparkDisk, type SparkDisk } from './spark-disk';
import { isSparkStateHydratedForScope, loadSparkTaskRecordsForSync, sparkState } from './spark-store';
import { mirrorSparkTaskAttachments, restoreSparkTaskAttachments } from './spark-task-files';
import { syncSparkWorkspaceFiles } from './spark-workspace-files';

const MIN_GAP_MS = 30_000;
/** Asked for while the tasks' folder reads, a pass waits for that folder to apply what it read. */
const SETTLE_MS = 2_000;

type FolderLookup = (scopeId: string) => Promise<FileSystemDirectoryHandle | null>;

let found: { disk: SparkDisk; scopeId: string; root: FileSystemDirectoryHandle | null } | null = null;

/**
 * The user's folder itself, for what is not one task's. `LocalFSContext` keeps its folder's handle to
 * itself and stores it where this reads it back: only while Spark's half of the folder is attached,
 * and only when the stored folder is the scope's (a scope is `<account>::<folder id>`). Willow's
 * Android app works on a folder it does not store; there this finds none.
 */
const storedFolder: FolderLookup = async (scopeId) => {
  const disk = sparkDisk();
  if (!disk) return null;
  if (found?.disk !== disk || found.scopeId !== scopeId) {
    const record = await getStoredDirectoryRecord().catch(() => null);
    found = { disk, scopeId, root: record && scopeId.split('::').includes(record.rootId) ? record.handle : null };
  }
  const { root } = found;
  return root && await verifyPermission(root, true, false) ? root : null;
};

let lookUpFolder: FolderLookup = storedFolder;

/** Test seam: the user's folder, where a test keeps it in memory. */
export const setSparkFolderLookup = (next: FolderLookup | null): void => {
  lookUpFolder = next ?? storedFolder;
  found = null;
};

/** One pass over `scopeId`'s files, now. The app asks for one with `requestSparkFolderFiles`. */
export const runSparkFolderFiles = async (scopeId: string): Promise<void> => {
  if (!isSparkStateHydratedForScope(scopeId)) return;
  // Whole records: the list holds summaries, without the turns of tasks not opened since loading.
  const records = await loadSparkTaskRecordsForSync(sparkState.get().tasks, scopeId);
  await restoreSparkTaskAttachments(records, scopeId).catch(() => undefined);
  mirrorSparkTaskAttachments(records, scopeId);
  const root = await lookUpFolder(scopeId).catch(() => null);
  if (!root) return;
  await syncDotAttachmentFiles(root, scopeId);
  // The store can have moved to another scope meanwhile, and the tasks' workspace is the store's.
  if (!isSparkStateHydratedForScope(scopeId)) return;
  await syncSparkWorkspaceFiles(root, scopeId);
};

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let lastStart = -Infinity;
let wanted: string | null = null;

const schedule = (): void => {
  timer = setTimeout(start, Math.max(SETTLE_MS, lastStart + MIN_GAP_MS - Date.now()));
  (timer as unknown as { unref?: () => void }).unref?.();
};

const start = (): void => {
  timer = null;
  const scopeId = wanted;
  wanted = null;
  // Asked for before the store or the folder was there: the next ask comes with the next folder pass.
  if (!scopeId || !isSparkStateHydratedForScope(scopeId) || !sparkDisk()) return;
  running = true;
  lastStart = Date.now();
  // Another tab holding the lock is making this pass, over the same browser storage.
  void withWebLock('willow-spark-folder-files', () => runSparkFolderFiles(scopeId))
    .catch((error) => console.warn('[spark] keeping files in the folder failed', error))
    .finally(() => {
      running = false;
      if (wanted) schedule();
    });
};

/** Asks for a pass over `scopeId`'s files: soon, and then at most every MIN_GAP_MS. */
export const requestSparkFolderFiles = (scopeId: string): void => {
  wanted = scopeId;
  if (!timer && !running) schedule();
};
