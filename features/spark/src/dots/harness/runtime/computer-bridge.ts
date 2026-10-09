/**
 * How a bot reaches the user's computer: Willow's local companion
 * (services/local-companion) over its loopback WebSocket — loopback only,
 * confined to the folder the user connected, and paired by token in the
 * desktop app. The companion authorises folders per connection, and the
 * connection may have been replaced since the folder was connected, so every
 * call that touches the folder authorises it first.
 *
 * Tests swap the whole bridge for a fake (`configureDotRuntime`).
 */

export interface DotCommandRequest {
  root: string;
  /** Relative to `root`. */
  cwd: string;
  command: string;
  timeoutMs: number;
}

export interface DotCommandOutput {
  code: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
}

export interface DotJobState {
  jobId: string;
  running: boolean;
  code: number | null;
  signal: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface DotJobOutput extends DotJobState {
  text: string;
  /** Offset to read from next time, into everything the job has printed. */
  next: number;
  /** Output between the requested offset and `text` was dropped from the companion's buffer. */
  truncated: boolean;
}

export interface DotFileEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: number;
  /** A folder listed but not descended into (dependencies, build output, version control). */
  skipped?: boolean;
}

export interface DotFileListing {
  path: string;
  entries: DotFileEntry[];
  truncated: boolean;
}

export interface DotFileContent {
  path: string;
  size: number;
  /** When the file last changed, which a write can require to be unchanged. */
  modifiedAt?: number;
  binary: boolean;
  text: string;
  offset: number;
  next: number | null;
}

export interface DotFileWrite {
  path: string;
  size: number;
  modifiedAt: number;
  created: boolean;
}

export interface DotFileSearch {
  matches: { path: string; line: number; text: string }[];
  truncated: boolean;
}

export interface DotComputerBridge {
  /** Confirms a folder can be used and resolves to its absolute path. */
  authorize: (root: string) => Promise<string>;
  execute: (request: DotCommandRequest) => Promise<DotCommandOutput>;
  startJob: (request: Omit<DotCommandRequest, 'timeoutMs'>) => Promise<DotJobState>;
  /** The job's state and output from `since`, or its latest output when `since` is absent. */
  readJob: (jobId: string, since?: number) => Promise<DotJobOutput>;
  stopJob: (jobId: string) => Promise<void>;
  /** Types into a running job's input; `close` ends the input after it. */
  writeJob: (jobId: string, text: string, close?: boolean) => Promise<void>;
  listFiles: (root: string, path: string, depth: number) => Promise<DotFileListing>;
  readFile: (root: string, path: string, offset?: number) => Promise<DotFileContent>;
  searchFiles: (root: string, query: string, path: string) => Promise<DotFileSearch>;
  /** Writes a whole file inside the folder; with `expectModifiedAt`, only if it has not changed since it was read. */
  writeFile: (root: string, path: string, text: string, expectModifiedAt?: number) => Promise<DotFileWrite>;
  /** A piece of a file's bytes, base64, from `offset`: for a copy to or from the bot's own computer. */
  readBytes?: (root: string, path: string, offset: number) => Promise<{ data: string; size: number; next: number | null }>;
  /** Writes a piece of a file's bytes, base64 — the first replacing the file, the rest `append`ed. */
  writeBytes?: (root: string, path: string, data: string, append: boolean) => Promise<DotFileWrite>;
  /** The shell commands run in, as the bot's instructions describe it. */
  shell: () => string;
}

const companion = () => import('@willow/code/local-companion').then((module) => module.localCompanion);

const authorised = async (root: string) => {
  const client = await companion();
  const { workspaceId } = await client.request<{ workspaceId: string }>('workspace.authorize', { root });
  return { client, workspaceId };
};

export const companionComputer: DotComputerBridge = {
  async authorize(root) {
    const client = await companion();
    const result = await client.request<{ workspaceId: string; root: string }>('workspace.authorize', { root });
    return result.root || root;
  },
  async execute({ root, cwd, command, timeoutMs }) {
    const { client, workspaceId } = await authorised(root);
    return client.request<DotCommandOutput>('shell.exec', { workspaceId, cwd, command, timeoutMs }, timeoutMs + 15_000);
  },
  async startJob({ root, cwd, command }) {
    const { client, workspaceId } = await authorised(root);
    return client.request<DotJobState>('job.start', { workspaceId, cwd, command });
  },
  async readJob(jobId, since) {
    const client = await companion();
    return client.request<DotJobOutput>('job.read', since === undefined ? { jobId } : { jobId, since });
  },
  async stopJob(jobId) {
    const client = await companion();
    await client.request('job.stop', { jobId });
  },
  async writeJob(jobId, text, close) {
    const client = await companion();
    await client.request('job.write', { jobId, text, ...(close ? { close: true } : {}) });
  },
  async listFiles(root, path, depth) {
    const { client, workspaceId } = await authorised(root);
    return client.request<DotFileListing>('fs.list', { workspaceId, path, depth });
  },
  async readFile(root, path, offset) {
    const { client, workspaceId } = await authorised(root);
    return client.request<DotFileContent>('fs.read', offset ? { workspaceId, path, offset } : { workspaceId, path });
  },
  async searchFiles(root, query, path) {
    const { client, workspaceId } = await authorised(root);
    return client.request<DotFileSearch>('fs.search', { workspaceId, query, path });
  },
  async writeFile(root, path, text, expectModifiedAt) {
    const { client, workspaceId } = await authorised(root);
    return client.request<DotFileWrite>('fs.write', { workspaceId, path, text, ...(expectModifiedAt !== undefined ? { expectModifiedAt } : {}) });
  },
  async readBytes(root, path, offset) {
    const { client, workspaceId } = await authorised(root);
    return client.request<{ data: string; size: number; next: number | null }>('fs.read', { workspaceId, path, offset, encoding: 'base64' }, 60_000);
  },
  async writeBytes(root, path, data, append) {
    const { client, workspaceId } = await authorised(root);
    return client.request<DotFileWrite>('fs.write', { workspaceId, path, data, encoding: 'base64', ...(append ? { append: true } : {}) }, 60_000);
  },
  shell() {
    const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    if (/Windows/i.test(agent)) return 'cmd.exe on Windows';
    if (/Macintosh|Mac OS X/i.test(agent)) return '/bin/sh on macOS';
    return '/bin/sh on Linux';
  },
};

/** Any other request of the companion's, for features beyond the connected folder (`relay.telegram`). */
export const companionRequest = async <T,>(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<T> =>
  (await companion()).request<T>(type, payload, timeoutMs);

/** Whether this window can reach Willow's local companion. */
export const companionReachable = async (): Promise<boolean> => {
  try {
    return await (await companion()).connect(1_500);
  } catch {
    return false;
  }
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A failure from the companion, in words the user — and the bot — can act on. */
export const computerProblem = (error: unknown): string => {
  const message = errorText(error);
  if (/not running|unavailable|disconnected|timed out/i.test(message)) {
    return "Willow can't reach this computer. Open the Willow desktop app, or start the local companion with `npm run companion:start`, then try again.";
  }
  if (/Unknown companion request/i.test(message)) return "This computer's Willow companion is out of date and can't do that. Update Willow, then try again.";
  if (/ENOENT|no such file/i.test(message)) return "That path doesn't exist.";
  if (/must be a directory|ENOTDIR/i.test(message)) return 'Choose a folder, not a file.';
  return message;
};
