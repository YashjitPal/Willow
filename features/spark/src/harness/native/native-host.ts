/**
 * Where Spark's native runtime runs things: the desktop app's local companion,
 * over its `spark.*` requests (services/local-companion/src/spark-runtime.mjs).
 *
 * An interface rather than direct calls so the runtime can be driven by a fake
 * computer in tests.
 */

import { localCompanion } from '@willow/code/local-companion';

export interface NativeEnvironment {
  platform: string;
  release: string;
  arch: string;
  home: string;
  tmp: string;
  user: string;
  hostname: string;
  shell: { name: string; path: string };
  pathSeparator: string;
}

/** One `exec_command` or `write_stdin` round, as Codex's unified exec reports it. */
export interface NativeExecResponse {
  chunkId: string;
  wallTimeMs: number;
  /** Set once the process has exited. */
  exitCode: number | null;
  /** Set while the process is still running. */
  sessionId: number | null;
  originalTokenCount: number | null;
  output: string;
  /** The complete response text the model reads. */
  text: string;
}

export interface NativeExecStart {
  cmd: string;
  /** Absolute. */
  workdir: string;
  shell?: string;
  login?: boolean;
  yieldTimeMs?: number;
  maxOutputTokens?: number;
  /** The task the process belongs to, so stopping the task stops it. */
  owner?: string;
}

export interface NativeExecWrite {
  sessionId: number;
  chars: string;
  yieldTimeMs?: number;
  maxOutputTokens?: number;
}

export interface NativeFile {
  path: string;
  exists: boolean;
  isDirectory?: boolean;
  size?: number;
  binary?: boolean;
  tooLarge?: boolean;
  text?: string;
}

export interface NativeStat {
  path: string;
  exists: boolean;
  isFile?: boolean;
  isDirectory?: boolean;
  size?: number;
  modifiedAt?: number;
}

export interface NativeListing {
  path: string;
  entries: { path: string; type: 'file' | 'dir'; size?: number; skipped?: boolean }[];
  truncated: boolean;
}

export interface NativeSearch {
  path: string;
  query: string;
  matches: { path: string; line: number; text: string }[];
  truncated: boolean;
}

export interface SparkNativeHost {
  environment: () => Promise<NativeEnvironment>;
  execStart: (request: NativeExecStart) => Promise<NativeExecResponse>;
  execWrite: (request: NativeExecWrite) => Promise<NativeExecResponse>;
  /** Stops one session, or every session a task owns. */
  execKill: (request: { owner?: string; sessionId?: number }) => Promise<void>;
  stat: (path: string) => Promise<NativeStat>;
  read: (paths: string[]) => Promise<NativeFile[]>;
  write: (path: string, text: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  list: (path: string, depth: number) => Promise<NativeListing>;
  search: (path: string, query: string, regex: boolean) => Promise<NativeSearch>;
}

const companion = async () => localCompanion;

/** A request's own wait plus room for the round trip; `write_stdin` may wait five minutes. */
const execTimeout = (yieldTimeMs: number | undefined, ceiling: number): number => Math.min(Math.max(Number(yieldTimeMs) || 0, 0), ceiling) + 30_000;

export const companionNativeHost: SparkNativeHost = {
  async environment() {
    return (await companion()).request<NativeEnvironment>('spark.env', {}, 10_000);
  },
  async execStart(request) {
    return (await companion()).request<NativeExecResponse>('spark.exec.start', { ...request }, execTimeout(request.yieldTimeMs ?? 10_000, 30_000));
  },
  async execWrite(request) {
    return (await companion()).request<NativeExecResponse>('spark.exec.write', { ...request }, execTimeout(request.yieldTimeMs ?? 5_000, 300_000));
  },
  async execKill(request) {
    await (await companion()).request('spark.exec.kill', { ...request }, 10_000);
  },
  async stat(path) {
    return (await companion()).request<NativeStat>('spark.fs.stat', { path }, 15_000);
  },
  async read(paths) {
    const result = await (await companion()).request<{ files: NativeFile[] }>('spark.fs.read', { paths }, 60_000);
    return result.files;
  },
  async write(path, text) {
    await (await companion()).request('spark.fs.write', { path, text }, 60_000);
  },
  async remove(path) {
    await (await companion()).request('spark.fs.delete', { path }, 15_000);
  },
  async list(path, depth) {
    return (await companion()).request<NativeListing>('spark.fs.list', { path, depth }, 60_000);
  },
  async search(path, query, regex) {
    return (await companion()).request<NativeSearch>('spark.fs.search', { path, query, regex }, 120_000);
  },
};

/**
 * The computer this window can run Spark on natively, or null: in a browser, or
 * when the desktop app's companion is not answering or predates the runtime.
 */
export const probeNativeEnvironment = async (host: SparkNativeHost = companionNativeHost): Promise<NativeEnvironment | null> => {
  try {
    const client = await companion();
    if (!(await client.connect(2_000))) return null;
    return await host.environment();
  } catch {
    return null;
  }
};
