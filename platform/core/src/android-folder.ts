/**
 * Willow's folder on the user's computer, for Willow on its Android app: a File System Access
 * directory handle whose every call goes to the computer (vendor/t3code apps/server
 * src/willow/folder.ts). Willow's storage takes it as it takes the folder the desktop app hands
 * over, so the phone is one more copy of Willow on the computer's folder: its chats, projects,
 * dots and `settings.json` (API keys included) are the computer's, and Willow's sync engine keeps
 * both copies on it (platform/storage ARCHITECTURE.md, "Disk = truth").
 *
 * Willow reconciles every few seconds, listing the same folders and reading each file's time. The
 * computer says when anything in the folder changed (its version), so until then a listing is
 * reused, what is missing is known from it, and a file's body is not asked for again.
 */
import { isAndroidApp } from './android-bridge';

const API = '/api/willow/folder';
/** How long a version answer stands before the computer is asked again. */
const VERSION_MS = 1_000;
const KEPT_BYTES = 64 * 1024 * 1024;
const KEPT_FILE_BYTES = 8 * 1024 * 1024;

interface Entry {
  name: string;
  kind: 'file' | 'directory';
  size: number;
  modified: number;
}

interface Body {
  etag: string;
  modified: number;
  size: number;
  file: File;
}

type WriteChunk =
  | BufferSource
  | Blob
  | string
  | { type: 'write'; data?: BufferSource | Blob | string; position?: number }
  | { type: 'seek'; position: number }
  | { type: 'truncate'; size: number };

/** Where each handle is in the folder; `move` changes it, as the API's does. */
const paths = new WeakMap<object, string>();
const listings = new Map<string, { version: string; entries: Entry[] }>();
/** In use order, oldest first. */
const bodies = new Map<string, Body>();
let keptBytes = 0;
const folder = {
  name: 'Willow',
  ignoresCase: true,
  version: '',
  checkedAt: 0,
  checking: null as Promise<string> | null,
};

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
const lastOf = (path: string) => path.split('/').pop() || folder.name;

const checkName = (name: unknown): string => {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new TypeError(`Name is not allowed: ${String(name)}`);
  }
  return name;
};

const notFound = (path: string) => new DOMException(`${path} is not there.`, 'NotFoundError');

const failure = async (response: Response): Promise<DOMException> => {
  const body = (await response.json().catch(() => null)) as { error?: { name?: string; message?: string } } | null;
  return new DOMException(
    body?.error?.message ?? `The computer answered ${response.status}.`,
    body?.error?.name ?? 'UnknownError',
  );
};

const ask = async (method: string, route: string, params: Record<string, string>, init: RequestInit = {}) => {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${API}${route}${query ? `?${query}` : ''}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });
  if (!response.ok && response.status !== 304) throw await failure(response);
  return response;
};

/** The folder's version now, asked of the computer at most once a second. */
const currentVersion = async (): Promise<string> => {
  if (folder.version && Date.now() - folder.checkedAt < VERSION_MS) return folder.version;
  folder.checking ??= ask('GET', '/version', {})
    .then((response) => response.json() as Promise<{ version: unknown }>)
    .then(({ version }) => {
      folder.version = String(version);
      folder.checkedAt = Date.now();
      return folder.version;
    })
    .finally(() => {
      folder.checking = null;
    });
  return folder.checking;
};

/** After this page's own change: the next look asks the computer again. */
const changedHere = () => {
  listings.clear();
  folder.checkedAt = 0;
};

const forgetBody = (path: string) => {
  const body = bodies.get(path);
  if (!body) return;
  keptBytes -= body.size;
  bodies.delete(path);
};

const forgetUnder = (path: string) => {
  for (const key of [...bodies.keys()]) {
    if (key === path || key.startsWith(`${path}/`)) forgetBody(key);
  }
};

const keepBody = (path: string, body: Body) => {
  forgetBody(path);
  if (body.size > KEPT_FILE_BYTES) return;
  bodies.set(path, body);
  keptBytes += body.size;
  while (keptBytes > KEPT_BYTES) {
    const oldest = bodies.keys().next().value;
    if (oldest === undefined) break;
    forgetBody(oldest);
  }
};

const usedBody = (path: string): Body | undefined => {
  const body = bodies.get(path);
  if (body) {
    bodies.delete(path);
    bodies.set(path, body);
  }
  return body;
};

async function list(path: string): Promise<Entry[]> {
  const version = await currentVersion();
  const kept = listings.get(path);
  if (kept && kept.version === version) return kept.entries;
  const response = await ask('GET', '/list', { path });
  const { entries } = (await response.json()) as { entries: Entry[] };
  listings.set(path, { version, entries });
  return entries;
}

const findIn = (entries: Entry[], name: string): Entry | undefined =>
  entries.find((entry) => entry.name === name) ??
  (folder.ignoresCase ? entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase()) : undefined);

/** What is at `path`, from its folder's listing: what the listing lacks is not there. */
async function entryAt(path: string): Promise<Entry> {
  const entry = findIn(await list(parentOf(path)), lastOf(path));
  if (!entry) throw notFound(path);
  return entry;
}

const pathOf = (handle: unknown): string | null =>
  handle && typeof handle === 'object' ? (paths.get(handle) ?? null) : null;

async function moveHandle(handle: RemoteFileHandle | RemoteDirectoryHandle, first: unknown, second?: unknown) {
  const from = pathOf(handle);
  if (from === null || from === '') throw new DOMException("Willow's folder itself cannot be moved.", 'InvalidModificationError');
  let parent = parentOf(from);
  let name = lastOf(from);
  if (typeof first === 'string') {
    name = first;
  } else {
    const dir = pathOf(first);
    if (dir === null || (first as { kind?: unknown }).kind !== 'directory') {
      throw new TypeError('A handle moves into a folder of the same computer.');
    }
    parent = dir;
    if (typeof second === 'string') name = second;
  }
  const to = join(parent, checkName(name));
  try {
    await ask('POST', '/move', {}, { body: JSON.stringify({ from, to }), headers: { 'Content-Type': 'application/json' } });
  } finally {
    changedHere();
  }
  forgetUnder(from);
  paths.set(handle, to);
}

function take(parts: BlobPart[], chunk: WriteChunk) {
  if (chunk && typeof chunk === 'object' && !(chunk instanceof Blob) && 'type' in chunk && typeof chunk.type === 'string') {
    if (chunk.type === 'write' && chunk.position === undefined) {
      if (chunk.data !== undefined) parts.push(chunk.data as BlobPart);
      return;
    }
    if (chunk.type === 'truncate' && chunk.size === 0) {
      parts.length = 0;
      return;
    }
    throw new DOMException("Writing at a position is not supported on the computer's folder.", 'NotSupportedError');
  }
  parts.push(chunk as BlobPart);
}

/** What `createWritable` hands back: a stream that pipes may write into, and the API's own `write`. */
class RemoteWritable extends WritableStream<WriteChunk> {
  constructor(target: RemoteFileHandle, start: Blob | null) {
    const parts: BlobPart[] = start ? [start] : [];
    super({
      write: (chunk) => take(parts, chunk),
      close: () => target.upload(new Blob(parts)),
      abort: () => {
        parts.length = 0;
      },
    });
  }

  async write(data: WriteChunk): Promise<void> {
    const writer = this.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  async seek(position: number): Promise<void> {
    await this.write({ type: 'seek', position });
  }

  async truncate(size: number): Promise<void> {
    await this.write({ type: 'truncate', size });
  }
}

abstract class RemoteHandle {
  abstract readonly kind: 'file' | 'directory';

  constructor(path: string) {
    paths.set(this, path);
  }

  get name(): string {
    return lastOf(paths.get(this) ?? '');
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return pathOf(other) === paths.get(this) && (other as { kind?: unknown }).kind === this.kind;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }
}

class RemoteFileHandle extends RemoteHandle {
  readonly kind = 'file' as const;

  async getFile(): Promise<File> {
    const path = paths.get(this) ?? '';
    const kept = usedBody(path);
    if (kept) {
      const version = await currentVersion();
      const listing = listings.get(parentOf(path));
      const entry = listing?.version === version ? findIn(listing.entries, lastOf(path)) : undefined;
      if (entry && entry.modified === kept.modified && entry.size === kept.size) return kept.file;
    }
    const response = await ask('GET', '/file', { path }, kept ? { headers: { 'If-None-Match': kept.etag } } : {});
    if (response.status === 304) {
      if (kept) return kept.file;
      throw new DOMException(`${path} could not be read.`, 'UnknownError');
    }
    const blob = await response.blob();
    const modified = Number(response.headers.get('X-Willow-Modified')) || Date.now();
    const file = new File([blob], this.name, { type: blob.type, lastModified: modified });
    keepBody(path, { etag: response.headers.get('ETag') ?? '', modified, size: file.size, file });
    return file;
  }

  async createWritable(options?: { keepExistingData?: boolean }): Promise<RemoteWritable> {
    const start = options?.keepExistingData ? await this.getFile() : null;
    return new RemoteWritable(this, start);
  }

  /** The writable's close: the computer replaces the file whole, as the API does. */
  async upload(blob: Blob): Promise<void> {
    const path = paths.get(this) ?? '';
    let written: Omit<Entry, 'name'>;
    try {
      const response = await ask('PUT', '/file', { path }, { body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
      written = (await response.json()) as Omit<Entry, 'name'>;
    } finally {
      changedHere();
    }
    const file = new File([blob], this.name, { type: blob.type, lastModified: written.modified });
    keepBody(path, { etag: `"${written.modified}-${written.size}"`, modified: written.modified, size: written.size, file });
  }

  async move(first: unknown, second?: unknown): Promise<void> {
    await moveHandle(this, first, second);
  }
}

class RemoteDirectoryHandle extends RemoteHandle {
  readonly kind = 'directory' as const;

  /** A child, made when asked to and it is not there yet; a kind that does not match is refused. */
  async #child(name: string, kind: Entry['kind'], create: boolean | undefined): Promise<string> {
    const path = join(paths.get(this) ?? '', checkName(name));
    let entry: Entry | null = null;
    try {
      entry = await entryAt(path);
    } catch (error) {
      if (!create || (error as DOMException | undefined)?.name !== 'NotFoundError') throw error;
    }
    if (!entry) {
      try {
        await ask('POST', '/create', { path, kind });
      } finally {
        changedHere();
      }
      return path;
    }
    if (entry.kind !== kind) {
      throw new DOMException(`${path} is not a ${kind === 'file' ? 'file' : 'folder'}.`, 'TypeMismatchError');
    }
    return join(paths.get(this) ?? '', entry.name);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<RemoteDirectoryHandle> {
    return new RemoteDirectoryHandle(await this.#child(name, 'directory', options?.create));
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<RemoteFileHandle> {
    return new RemoteFileHandle(await this.#child(name, 'file', options?.create));
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const path = join(paths.get(this) ?? '', checkName(name));
    try {
      await ask('DELETE', '/entry', { path, recursive: options?.recursive ? '1' : '0' });
    } finally {
      changedHere();
    }
    forgetUnder(path);
  }

  async resolve(possibleDescendant: unknown): Promise<string[] | null> {
    const own = paths.get(this) ?? '';
    const other = pathOf(possibleDescendant);
    if (other === null) return null;
    if (other === own) return [];
    const prefix = own ? `${own}/` : '';
    return other.startsWith(prefix) ? other.slice(prefix.length).split('/') : null;
  }

  async move(first: unknown, second?: unknown): Promise<void> {
    await moveHandle(this, first, second);
  }

  async *entries(): AsyncGenerator<[string, RemoteFileHandle | RemoteDirectoryHandle]> {
    const own = paths.get(this) ?? '';
    for (const entry of await list(own)) yield [entry.name, handleFor(own, entry)];
  }

  async *values(): AsyncGenerator<RemoteFileHandle | RemoteDirectoryHandle> {
    const own = paths.get(this) ?? '';
    for (const entry of await list(own)) yield handleFor(own, entry);
  }

  async *keys(): AsyncGenerator<string> {
    for (const entry of await list(paths.get(this) ?? '')) yield entry.name;
  }

  [Symbol.asyncIterator](): AsyncGenerator<[string, RemoteFileHandle | RemoteDirectoryHandle]> {
    return this.entries();
  }
}

const handleFor = (dir: string, entry: Entry): RemoteFileHandle | RemoteDirectoryHandle => {
  const path = join(dir, entry.name);
  return entry.kind === 'directory' ? new RemoteDirectoryHandle(path) : new RemoteFileHandle(path);
};

export interface AndroidLocalFolder {
  handle: FileSystemDirectoryHandle;
  /** Stable for the computer's folder, so the phone keeps one storage scope for it. */
  rootId: string;
}

/** The computer's Willow folder, on Willow's Android app; null elsewhere, or when the computer has none. */
export const openAndroidLocalFolder = async (): Promise<AndroidLocalFolder | null> => {
  if (!isAndroidApp()) return null;
  try {
    const response = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    const info = (await response.json()) as { id?: unknown; name?: unknown; ignoresCase?: unknown; version?: unknown };
    if (typeof info.id !== 'string' || typeof info.name !== 'string') return null;
    folder.name = info.name;
    folder.ignoresCase = info.ignoresCase !== false;
    if (typeof info.version === 'string') {
      folder.version = info.version;
      folder.checkedAt = Date.now();
    }
    return { handle: new RemoteDirectoryHandle('') as unknown as FileSystemDirectoryHandle, rootId: `computer-${info.id}` };
  } catch {
    return null;
  }
};

/** Whether a handle is the computer's folder: one that cannot be kept in IndexedDB as the browser's can. */
export const isAndroidLocalFolder = (handle: unknown): boolean => handle instanceof RemoteDirectoryHandle;
