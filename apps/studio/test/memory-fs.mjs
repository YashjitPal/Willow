/**
 * Just enough of the File System Access API and of Web Storage, in memory, for tests that run a
 * synced folder through the real driver (`platform/storage/src/local-fs/synced-folder-driver.ts`).
 * Names compare without case, as Windows compares them; every write moves the file's
 * `lastModified` on, which is how the engine tells a changed file.
 */

const domError = (name) => Object.assign(new Error(name), { name });
let clock = 1_000;

export class MemoryFile {
  constructor(name) {
    this.kind = 'file';
    this.name = name;
    this.text = '';
    this.mtime = clock++;
  }
  async getFile() {
    return new File([this.text], this.name, { lastModified: this.mtime });
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async (data) => { chunks.push(typeof data?.text === 'function' ? await data.text() : String(data)); },
      close: async () => { this.text = chunks.join(''); this.mtime = clock++; },
      abort: async () => {},
    };
  }
}

export class MemoryDir {
  constructor(name = '') {
    this.kind = 'directory';
    this.name = name;
    this.entries = new Map();
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    const found = this.entries.get(name.toLowerCase());
    if (found) {
      if (found.kind !== 'directory') throw domError('TypeMismatchError');
      return found;
    }
    if (!create) throw domError('NotFoundError');
    const dir = new MemoryDir(name);
    this.entries.set(name.toLowerCase(), dir);
    return dir;
  }
  async getFileHandle(name, { create = false } = {}) {
    const found = this.entries.get(name.toLowerCase());
    if (found) {
      if (found.kind !== 'file') throw domError('TypeMismatchError');
      return found;
    }
    if (!create) throw domError('NotFoundError');
    const file = new MemoryFile(name);
    this.entries.set(name.toLowerCase(), file);
    return file;
  }
  async removeEntry(name) {
    if (!this.entries.delete(name.toLowerCase())) throw domError('NotFoundError');
  }
  async *values() {
    for (const entry of [...this.entries.values()]) yield entry;
  }
}

/** A `localStorage` of its own. */
export const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  };
};

/** Installs `storage` as the global `localStorage`; the driver also wants a `window` to read it. */
export const useStorage = (storage) => {
  globalThis.window ??= globalThis;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  return storage;
};

/** The file names in a folder below `root`, sorted. */
export const fileNames = async (root, ...segments) => {
  let dir = root;
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment);
  const out = [];
  for await (const entry of dir.values()) if (entry.kind === 'file') out.push(entry.name);
  return out.sort();
};

export const fileText = async (root, segments, name) => {
  let dir = root;
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment);
  return (await (await dir.getFileHandle(name)).getFile()).text();
};

export const writeFile = async (root, segments, name, text) => {
  let dir = root;
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true });
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writable.write(text);
  await writable.close();
};
