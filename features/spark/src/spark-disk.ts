/**
 * Spark's half of the user's folder: each task's files, kept beside
 * `Spark/Tasks/<task>.json` in `Spark/Tasks/<task>/` — what the user attached in
 * `Attachments/`, what the remote browser saw in `Browser/`.
 *
 * `SparkWorkspace` attaches it through `useLocalFS`. With no folder connected (or
 * before it mounts) every call reports nothing done, and the browser's copy in
 * IndexedDB stands until the next chance to write.
 */
import type { ConversationFile } from '@willow/storage/local-fs/conversation-files';

/** Registered with `registerSyncedFolder` in `register.ts`; each task is `<id>.json` in it. */
export const SPARK_TASKS_FOLDER = 'Spark/Tasks';

export interface SparkDisk {
  write: (taskId: string, files: readonly ConversationFile[]) => Promise<boolean>;
  read: (taskId: string, path: string) => Promise<File | null>;
  remove: (taskId: string) => Promise<boolean>;
}

let attached: SparkDisk | null = null;
const listeners = new Set<() => void>();

export const attachSparkDisk = (disk: SparkDisk | null): void => {
  attached = disk;
  if (disk) listeners.forEach((listener) => listener());
};

export const sparkDisk = (): SparkDisk | null => attached;

/** Told when a folder becomes writable, so files saved without one can be written now. */
export const onSparkDiskAttached = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
