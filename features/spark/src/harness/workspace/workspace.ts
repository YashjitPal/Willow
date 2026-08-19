import { normalizePath } from '../runtime/apply-patch';
import type { FileMap } from '../runtime/apply-patch';

export const MAX_SPARK_FILE_BYTES = 2_000_000;

export interface SparkWorkspace {
  readonly root: string;
  readFiles(): Promise<FileMap>;
  writeFiles(files: FileMap): Promise<void>;
}

export const emptySparkWorkspace = (root = '/workspace'): SparkWorkspace => {
  let files: FileMap = {};
  return {
    root,
    async readFiles() {
      return { ...files };
    },
    async writeFiles(next) {
      files = { ...next };
    },
  };
};

const splitPath = (path: string): string[] => {
  const normalized = normalizePath(path);
  return normalized === '/' ? [] : normalized.slice(1).split('/');
};

const getDirectory = async (
  root: FileSystemDirectoryHandle,
  parts: readonly string[],
  create = false,
): Promise<FileSystemDirectoryHandle> => {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create });
  return current;
};

const readDirectory = async (
  directory: FileSystemDirectoryHandle,
  prefix: string,
  output: FileMap,
): Promise<void> => {
  for await (const entry of (directory as any).values() as AsyncIterable<FileSystemHandle>) {
    const path = `${prefix}/${entry.name}`;
    if (entry.kind === 'directory') {
      await readDirectory(entry as FileSystemDirectoryHandle, path, output);
      continue;
    }
    const file = await (entry as FileSystemFileHandle).getFile();
    if (file.size > MAX_SPARK_FILE_BYTES) continue;
    output[normalizePath(path)] = await file.text();
  }
};

/** Private, small-file OPFS workspace used by Spark when no mount is supplied. */
export const createOpfsWorkspace = async (
  scope: string,
  rootName = 'workspace',
): Promise<SparkWorkspace> => {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!storage.getDirectory) return emptySparkWorkspace('/workspace');
  const opfsRoot = await storage.getDirectory();
  const root = await getDirectory(opfsRoot, ['willow-spark', scope, rootName], true);
  return {
    root: '/workspace',
    async readFiles() {
      const output: FileMap = {};
      await readDirectory(root, '', output);
      return output;
    },
    async writeFiles(files) {
      for (const [rawPath, contents] of Object.entries(files)) {
        const path = normalizePath(rawPath);
        if (contents.length > MAX_SPARK_FILE_BYTES) throw new Error(`File ${path} exceeds Spark's size limit.`);
        const parts = splitPath(path);
        if (parts.length === 0) continue;
        const directory = await getDirectory(root, parts.slice(0, -1), true);
        const handle = await directory.getFileHandle(parts.at(-1)!, { create: true });
        const writable = await handle.createWritable();
        await writable.write(contents);
        await writable.close();
      }
    },
  };
};
