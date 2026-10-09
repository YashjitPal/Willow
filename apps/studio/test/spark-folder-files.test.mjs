/**
 * Spark's files in the user's folder beyond its records (features/spark/src/spark-folder-files.ts):
 * a task's attachments, the files the user sent a bot, and what runs and bots made in their OPFS
 * workspace. Driven through the real synced-folder driver with Spark's real registrations, the real
 * attachment storage and the harness's own OPFS workspace, against in-memory stand-ins that keep
 * bytes as bytes: the folder (names compared without case, as Windows does), each copy's OPFS and
 * each copy's IndexedDB. Two copies of Willow on one folder are two browsers; the second, starting
 * with empty browser storage under a new folder id, is a reinstall. What these pin is that a copy
 * starting over gets every file back from the folder, and that no file is lost on either side.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';
import { fileNames, fileText, memoryStorage, useStorage } from './memory-fs.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const DOTS_KEY = 'willow:spark:dots:v2';

useStorage(memoryStorage());
globalThis.addEventListener ??= () => {};
// Spark's cross-tab channel would hold the test process open.
globalThis.BroadcastChannel = undefined;
globalThis.FileReader ??= class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload?.();
    }, (error) => {
      this.error = error;
      this.onerror?.();
    });
  }
};

/* ------------------------------ in memory, as bytes ------------------------------ */

const domError = (name) => Object.assign(new Error(name), { name });
let clock = 1_000_000;
let fileWrites = 0;

const asBytes = async (data) => {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  throw new TypeError('not something a file takes');
};

class BytesFile {
  constructor(name) {
    this.kind = 'file';
    this.name = name;
    this.bytes = new Uint8Array(0);
    this.mtime = clock++;
  }
  async getFile() {
    return new File([this.bytes], this.name, { lastModified: this.mtime });
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async (data) => { chunks.push(await asBytes(data)); },
      close: async () => {
        this.bytes = new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
        this.mtime = clock++;
        fileWrites += 1;
      },
      abort: async () => {},
    };
  }
}

/** A directory: the user's folder compares names without case, OPFS with. */
class BytesDir {
  constructor(name = '', caseless = true) {
    this.kind = 'directory';
    this.name = name;
    this.caseless = caseless;
    this.entries = new Map();
  }
  key(name) {
    return this.caseless ? name.toLowerCase() : name;
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    const found = this.entries.get(this.key(name));
    if (found) {
      if (found.kind !== 'directory') throw domError('TypeMismatchError');
      return found;
    }
    if (!create) throw domError('NotFoundError');
    const dir = new BytesDir(name, this.caseless);
    this.entries.set(this.key(name), dir);
    return dir;
  }
  async getFileHandle(name, { create = false } = {}) {
    const found = this.entries.get(this.key(name));
    if (found) {
      if (found.kind !== 'file') throw domError('TypeMismatchError');
      return found;
    }
    if (!create) throw domError('NotFoundError');
    const file = new BytesFile(name);
    this.entries.set(this.key(name), file);
    return file;
  }
  async removeEntry(name) {
    if (!this.entries.delete(this.key(name))) throw domError('NotFoundError');
  }
  async *values() {
    for (const entry of [...this.entries.values()]) yield entry;
  }
}

const dirAt = async (root, segments, create = false) => {
  let dir = root;
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create });
  return dir;
};
const bytesAt = async (root, segments, name) => new Uint8Array(await (await (await (await dirAt(root, segments)).getFileHandle(name)).getFile()).arrayBuffer());
const putFile = async (root, segments, name, data) => {
  const writable = await (await (await dirAt(root, segments, true)).getFileHandle(name, { create: true })).createWritable();
  await writable.write(data);
  await writable.close();
};
const has = async (root, segments, name) => {
  try {
    await (await dirAt(root, segments)).getFileHandle(name);
    return true;
  } catch {
    return false;
  }
};

/** Just enough of IndexedDB for Spark's attachment payloads. Each transaction runs whole, in one turn. */
const memoryIndexedDB = () => {
  const databases = new Map();
  class Transaction {
    constructor(stores) {
      this.stores = stores;
      this.queue = [];
      this.error = null;
      setImmediate(() => {
        while (this.queue.length) this.queue.shift()();
        this.oncomplete?.();
      });
    }
    request(op) {
      const request = { result: undefined, error: null };
      this.queue.push(() => {
        request.result = op();
        request.onsuccess?.({ target: request });
      });
      return request;
    }
    objectStore(name) {
      const data = this.stores.get(name);
      return {
        put: (value, key) => this.request(() => { data.set(key, structuredClone(value)); return key; }),
        get: (key) => this.request(() => (data.has(key) ? structuredClone(data.get(key)) : undefined)),
        count: (key) => this.request(() => (data.has(key) ? 1 : 0)),
        delete: (key) => this.request(() => { data.delete(key); }),
      };
    }
  }
  return {
    databases,
    open: (name) => {
      const request = { result: null, error: null };
      setImmediate(() => {
        const fresh = !databases.has(name);
        if (fresh) databases.set(name, new Map());
        const stores = databases.get(name);
        request.result = {
          objectStoreNames: { contains: (store) => stores.has(store) },
          createObjectStore: (store) => { stores.set(store, new Map()); },
          transaction: () => new Transaction(stores),
          close: () => {},
        };
        if (fresh) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
};

/* ------------------------------------ the app ------------------------------------ */

/** `?raw`, as Vite gives it: the file's text (the Spark harness's prompts). */
const rawPlugin = {
  name: 'raw-imports',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, async (args) => {
      const resolved = await build.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: args.kind });
      if (resolved.errors.length) return { errors: resolved.errors };
      return { path: resolved.path, namespace: 'raw-text' };
    });
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => ({ contents: await fs.promises.readFile(args.path, 'utf8'), loader: 'text' }));
  },
};

let bundleDir = '';
let m;
let releaseLock = () => {};
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-spark-folder-files-'));
  const outfile = path.join(bundleDir, 'spark.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'spark-folder-files-entry.ts',
      loader: 'ts',
      contents: `
        export { getSyncedFolders, syncRegisteredFolder } from '@willow/storage/local-sync';
        export { readConversationFile, writeConversationFiles } from '@willow/storage/local-fs/conversation-files';
        export { attachSparkDisk } from '@willow/spark/spark-disk';
        export { hydrateSparkState, sparkState, createSparkTask, updateSparkTask } from '@willow/spark/spark-store';
        export { createSparkTaskAttachments, resolveSparkTaskAttachments } from '@willow/spark/attachment-storage';
        export { sparkAttachmentPath } from '@willow/spark/spark-task-files';
        export { runSparkFolderFiles, setSparkFolderLookup } from '@willow/spark/spark-folder-files';
        export { sparkDots, insertSparkDot } from '@willow/spark/dots/dots-store';
        export { setDotThreadPersistence, loadDotThread, appendDotItems, flushDotThread } from '@willow/spark/dots/harness/thread/thread-store';
        export { memoryPersistence } from '@willow/spark/dots/harness/thread/thread-persistence';
        export { setDotsFolderPersistence } from '@willow/spark/dots/dots-folder';
        export { storeDotAttachments, dotAttachmentBlob } from '@willow/spark/dots/harness/runtime/dot-attachments';
        export { createOpfsWorkspace, readSparkWorkspaceFile } from '@willow/spark/harness/workspace/workspace';
        import '@willow/spark/register';
      `,
    },
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node23',
    loader: { '.css': 'empty' },
    plugins: [rawPlugin, willowAliasPlugin(repoRoot)],
  });
  m = await import(pathToFileURL(outfile).href);
  // The app's own passes, asked for by the tasks' folder, find another tab making them: only the ones
  // these tests make run.
  await new Promise((held) => {
    void navigator.locks.request('willow-spark-folder-files', () => new Promise((release) => {
      releaseLock = release;
      held();
    }));
  });
});

after(() => {
  releaseLock();
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

/** A copy of Willow: its localStorage, IndexedDB, OPFS and bot conversations. */
const browser = () => ({ storage: memoryStorage(), idb: memoryIndexedDB(), opfs: new BytesDir('', false), threads: m.memoryPersistence() });
let current = null;
Object.defineProperty(navigator, 'storage', { value: { getDirectory: async () => current.opfs }, configurable: true });

/** Puts `copy` in front, on `root`, with Spark's store loaded for `scope` (each copy its own folder id). */
const use = (copy, root, scope) => {
  current = copy;
  useStorage(copy.storage);
  globalThis.indexedDB = copy.idb;
  m.setDotThreadPersistence(copy.threads);
  m.setDotsFolderPersistence(copy.threads);
  let saved = null;
  try {
    saved = JSON.parse(copy.storage.getItem(DOTS_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  m.sparkDots.set(saved ?? { dots: [], categories: [] });
  m.hydrateSparkState(scope);
  const tasksDir = (create) => dirAt(root, ['Spark', 'Tasks'], create);
  m.attachSparkDisk({
    write: async (taskId, files) => m.writeConversationFiles(await tasksDir(true), taskId, files),
    read: async (taskId, filePath) => m.readConversationFile(await tasksDir(false), taskId, filePath).catch(() => null),
    remove: async () => true,
  });
  m.setSparkFolderLookup(async () => root);
};

const descriptor = (id) => m.getSyncedFolders().find((folder) => folder.id === id);
const idle = () => new Promise((resolve) => setTimeout(resolve, 10));
/** What the app does on each poll: the bots' folder, the tasks' folder, then the files beside them. */
const pass = async (root, scope) => {
  await m.syncRegisteredFolder(root, descriptor('spark-dots'), scope);
  await m.syncRegisteredFolder(root, descriptor('spark-tasks'), scope);
  await m.runSparkFolderFiles(scope);
  await idle();
};
const eventually = async (check, what) => {
  for (let tries = 0; tries < 100; tries += 1) {
    if (await check()) return;
    await idle();
  }
  assert.fail(`never: ${what}`);
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x7f]);
const base64 = (bytes) => Buffer.from(bytes).toString('base64');
const payloads = (copy) => copy.idb.databases.get('willow-spark')?.get('attachment-payloads') ?? new Map();
const workspace = (scope) => ['willow-spark', scope, 'workspace'];
/** A bot's workspace scope, as `harness/dot-runtime.ts` opens it. */
const botScope = (dotId) => `dot-${dotId}`;
const opfsText = async (copy, scope, name, ...segments) => (await (await (await dirAt(copy.opfs, [...workspace(scope), ...segments])).getFileHandle(name)).getFile()).text();
const makeBot = async (id, name) => {
  m.insertSparkDot({ id, name, presetId: 'blue_beret', status: 'ready' });
  await m.loadDotThread(id);
};

describe("a task's attachments", () => {
  it('come back from the folder into a copy starting over, byte for byte, with nothing written over them', async () => {
    const root = new BytesDir();
    const app = browser();
    use(app, root, 'user::app-1');
    const kept = await m.createSparkTaskAttachments([
      new File([PNG], 'chart.png', { type: 'image/png' }),
      new File(['# Notes\nkeep these'], 'notes.md', { type: 'text/markdown' }),
    ], 'user::app-1');
    const [chart, notes] = kept.map(({ data: _data, ...attachment }) => attachment);
    const [later] = (await m.createSparkTaskAttachments([new File(['and one more'], 'later.txt', { type: 'text/plain' })], 'user::app-1'))
      .map(({ data: _data, ...attachment }) => attachment);
    m.createSparkTask('Summarize the chart', {
      id: 'task-files',
      status: 'complete',
      openTask: false,
      attachments: [chart, notes],
      turns: [{ id: 'turn-1', prompt: 'And this', response: 'Done', createdAt: '2026-10-09T10:00:00.000Z', attachments: [later] }],
    });
    await pass(root, 'user::app-1');
    const folder = ['Spark', 'Tasks', 'task-files'];
    await eventually(async () => (await fileNames(root, ...folder, 'Attachments')).length === 3, 'every attachment is written beside its task');
    const chartFile = m.sparkAttachmentPath(chart).split('/');
    assert.deepEqual(await bytesAt(root, [...folder, chartFile[0]], chartFile[1]), PNG);

    const reinstalled = browser();
    use(reinstalled, root, 'user::app-2');
    await pass(root, 'user::app-2');
    const task = m.sparkState.get().tasks.find((candidate) => candidate.id === 'task-files');
    assert.ok(task, 'the task came back from the folder');
    const resolved = await m.resolveSparkTaskAttachments([chart, notes, later], 'user::app-2');
    assert.deepEqual(resolved.map((attachment) => [attachment.name, attachment.type, attachment.data]), [
      ['chart.png', 'image', base64(PNG)],
      ['notes.md', 'text', '# Notes\nkeep these'],
      ['later.txt', 'text', 'and one more'],
    ]);
    assert.deepEqual(await bytesAt(root, [...folder, chartFile[0]], chartFile[1]), PNG, 'the folder copy stands as it was');
  });

  it('reads back only what a task names, and leaves one missing from the folder for later', async () => {
    const root = new BytesDir();
    const app = browser();
    use(app, root, 'user::named-1');
    const [shown, lost] = (await m.createSparkTaskAttachments([
      new File(['here'], 'here.txt', { type: 'text/plain' }),
      new File(['gone'], 'gone.txt', { type: 'text/plain' }),
    ], 'user::named-1')).map(({ data: _data, ...attachment }) => attachment);
    m.createSparkTask('Two files', { id: 'task-named', status: 'complete', openTask: false, attachments: [shown, lost] });
    await pass(root, 'user::named-1');
    await eventually(async () => (await fileNames(root, 'Spark', 'Tasks', 'task-named', 'Attachments')).length === 2, 'both are written');
    const [, lostName] = m.sparkAttachmentPath(lost).split('/');
    await (await dirAt(root, ['Spark', 'Tasks', 'task-named', 'Attachments'])).removeEntry(lostName);
    await putFile(root, ['Spark', 'Tasks', 'task-named', 'Attachments'], 'stray.txt', 'not an attachment');

    const reinstalled = browser();
    use(reinstalled, root, 'user::named-2');
    await pass(root, 'user::named-2');
    assert.deepEqual([...payloads(reinstalled).keys()], [`user::named-2:${shown.id}`]);
    assert.deepEqual((await m.resolveSparkTaskAttachments([shown, lost], 'user::named-2')).map((attachment) => attachment.data), ['here']);
  });
});

describe('the files the user sent a bot', () => {
  it('are kept beside the bot, which the bots folder still reads as one bot', async () => {
    const root = new BytesDir();
    const app = browser();
    use(app, root, 'user::bot-1');
    await makeBot('dot-files', 'Ada');
    const refs = await m.storeDotAttachments([new File([PNG], 'photo.png', { type: 'image/png' })]);
    m.appendDotItems('dot-files', [{ kind: 'user', text: 'look at this', attachments: refs }]);
    await m.flushDotThread('dot-files');
    await pass(root, 'user::bot-1');
    await pass(root, 'user::bot-1');
    const [folderName, fileName] = m.sparkAttachmentPath({ id: refs[0].id, name: refs[0].name, mimeType: refs[0].mimeType }).split('/');
    assert.deepEqual(await bytesAt(root, ['Spark', 'Dots', 'dot-files', folderName], fileName), PNG);
    assert.deepEqual(await fileNames(root, 'Spark', 'Dots'), ['dot-files.json'], 'the folder beside the bot is not a bot, nor a conflict');
    assert.deepEqual(m.sparkDots.get().dots.map((dot) => dot.id), ['dot-files']);
  });

  it('come back from the folder into a copy starting over', async () => {
    const root = new BytesDir();
    const app = browser();
    use(app, root, 'user::bot-a');
    await makeBot('dot-back', 'Bea');
    const refs = await m.storeDotAttachments([
      new File([PNG], 'photo.png', { type: 'image/png' }),
      new File(['a list'], 'list.txt', { type: 'text/plain' }),
    ]);
    m.appendDotItems('dot-back', [{ kind: 'user', text: 'two files', attachments: refs }]);
    await m.flushDotThread('dot-back');
    await pass(root, 'user::bot-a');
    await pass(root, 'user::bot-a');

    const reinstalled = browser();
    use(reinstalled, root, 'user::bot-b');
    await pass(root, 'user::bot-b');
    assert.deepEqual(m.sparkDots.get().dots.map((dot) => dot.id), ['dot-back'], 'the bot came back from its file');
    const photo = await m.dotAttachmentBlob(refs[0]);
    assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), PNG);
    assert.equal(await (await m.dotAttachmentBlob(refs[1])).text(), 'a list');
  });
});

describe('what runs and bots made', () => {
  it('is mirrored to the folder at the same paths, and read back into a copy starting over under its new scope', async () => {
    const root = new BytesDir();
    const app = browser();
    use(app, root, 'user::ws-1');
    await makeBot('dot-ws', 'Cy');
    await (await m.createOpfsWorkspace('user::ws-1')).writeFiles({ '/report.md': '# Report', '/data/table.csv': 'a,b\n1,2' });
    await (await m.createOpfsWorkspace(botScope('dot-ws'))).writeFiles({ '/notes.txt': 'remember this' });
    await pass(root, 'user::ws-1');
    assert.equal(await fileText(root, ['Spark', 'Files'], 'report.md'), '# Report');
    assert.equal(await fileText(root, ['Spark', 'Files', 'data'], 'table.csv'), 'a,b\n1,2');
    assert.equal(await fileText(root, ['Spark', 'Dots', 'dot-ws', 'Files'], 'notes.txt'), 'remember this');
    assert.deepEqual(await fileNames(root, 'Spark', 'Dots'), ['dot-ws.json']);

    const reinstalled = browser();
    use(reinstalled, root, 'user::ws-2');
    await pass(root, 'user::ws-2');
    assert.equal(await m.readSparkWorkspaceFile('user::ws-2', '/report.md'), '# Report');
    assert.deepEqual(await (await m.createOpfsWorkspace('user::ws-2')).readFiles(), { '/report.md': '# Report', '/data/table.csv': 'a,b\n1,2' });
    assert.equal(await m.readSparkWorkspaceFile(botScope('dot-ws'), '/notes.txt'), 'remember this');
  });

  it("carries a change either way, and keeps both sides' copies when both changed", async () => {
    const root = new BytesDir();
    const app = browser();
    const web = browser();
    use(app, root, 'user::two-a');
    await (await m.createOpfsWorkspace('user::two-a')).writeFiles({ '/plan.md': 'v1' });
    await pass(root, 'user::two-a');
    use(web, root, 'user::two-b');
    await pass(root, 'user::two-b');
    assert.equal(await m.readSparkWorkspaceFile('user::two-b', '/plan.md'), 'v1');

    use(app, root, 'user::two-a');
    await (await m.createOpfsWorkspace('user::two-a')).writeFiles({ '/plan.md': 'v2 from the app' });
    await pass(root, 'user::two-a');
    assert.equal(await fileText(root, ['Spark', 'Files'], 'plan.md'), 'v2 from the app');
    use(web, root, 'user::two-b');
    await pass(root, 'user::two-b');
    assert.equal(await m.readSparkWorkspaceFile('user::two-b', '/plan.md'), 'v2 from the app', 'the folder changed and this copy had not');

    await (await m.createOpfsWorkspace('user::two-b')).writeFiles({ '/plan.md': 'v3 from the browser' });
    use(app, root, 'user::two-a');
    await (await m.createOpfsWorkspace('user::two-a')).writeFiles({ '/plan.md': 'v3 from the app' });
    await pass(root, 'user::two-a');
    use(web, root, 'user::two-b');
    await pass(root, 'user::two-b');
    const names = await fileNames(root, 'Spark', 'Files');
    const aside = names.find((name) => /^plan \(Conflict [\d-]+\)\.md$/.test(name));
    assert.ok(aside, `this browser's copy is kept beside the folder's: ${names.join(', ')}`);
    assert.equal(await fileText(root, ['Spark', 'Files'], 'plan.md'), 'v3 from the app', "the folder's copy stays in place");
    assert.equal(await fileText(root, ['Spark', 'Files'], aside), 'v3 from the browser');
    assert.equal(await m.readSparkWorkspaceFile('user::two-b', '/plan.md'), 'v3 from the app');
    await pass(root, 'user::two-b');
    assert.equal(await m.readSparkWorkspaceFile('user::two-b', `/${aside}`), 'v3 from the browser', 'and it reaches the workspace too');
  });

  it("keeps the folder's copy on a first pass that finds this copy's differing, with its own beside it", async () => {
    const root = new BytesDir();
    await putFile(root, ['Spark', 'Files'], 'todo.md', 'from before the reinstall');
    const fresh = browser();
    use(fresh, root, 'user::first');
    await (await m.createOpfsWorkspace('user::first')).writeFiles({ '/todo.md': 'written here first' });
    await pass(root, 'user::first');
    await pass(root, 'user::first');
    const names = await fileNames(root, 'Spark', 'Files');
    assert.equal(names.length, 2);
    assert.equal(await fileText(root, ['Spark', 'Files'], 'todo.md'), 'from before the reinstall');
    assert.equal(await fileText(root, ['Spark', 'Files'], names.find((name) => name !== 'todo.md')), 'written here first');
    const files = await (await m.createOpfsWorkspace('user::first')).readFiles();
    assert.deepEqual(Object.values(files).sort(), ['from before the reinstall', 'written here first']);
  });

  it('writes nothing in a workspace a run has open, and catches up when it is done', async () => {
    const root = new BytesDir();
    await putFile(root, ['Spark', 'Files'], 'brief.md', 'from the folder');
    await putFile(root, ['Spark', 'Dots', 'dot-busy', 'Files'], 'memo.md', 'for the bot');
    const copy = browser();
    use(copy, root, 'user::busy');
    await makeBot('dot-busy', 'Di');
    await (await m.createOpfsWorkspace('user::busy')).writeFiles({ '/made.md': 'by the run' });
    m.createSparkTask('Still going', { id: 'task-busy', status: 'running', openTask: false });
    let endTurn = () => {};
    const turn = new Promise((started) => {
      void navigator.locks.request('willow-dot-turn:dot-busy', () => new Promise((end) => {
        endTurn = end;
        started();
      }));
    });
    await turn;
    await pass(root, 'user::busy');
    assert.equal(await m.readSparkWorkspaceFile('user::busy', '/brief.md'), null, 'not while the run has the workspace open');
    assert.equal(await m.readSparkWorkspaceFile(botScope('dot-busy'), '/memo.md'), null, "not while the bot's turn runs");
    assert.equal(await fileText(root, ['Spark', 'Files'], 'made.md'), 'by the run', 'what the run made still reaches the folder');

    m.updateSparkTask('task-busy', { status: 'complete' });
    endTurn();
    await idle();
    await pass(root, 'user::busy');
    assert.equal(await m.readSparkWorkspaceFile('user::busy', '/brief.md'), 'from the folder');
    assert.equal(await m.readSparkWorkspaceFile(botScope('dot-busy'), '/memo.md'), 'for the bot');
  });

  it('never deletes, never writes back what the user removed from the folder, and does nothing on a pass with nothing new', async () => {
    const root = new BytesDir();
    const copy = browser();
    use(copy, root, 'user::quiet');
    await (await m.createOpfsWorkspace('user::quiet')).writeFiles({ '/keep.md': 'keep', '/drop.md': 'drop' });
    await pass(root, 'user::quiet');
    await (await dirAt(root, ['Spark', 'Files'])).removeEntry('drop.md');
    await pass(root, 'user::quiet');
    assert.deepEqual(await fileNames(root, 'Spark', 'Files'), ['keep.md'], 'removed from the folder by the user, it stays removed');
    assert.equal(await opfsText(copy, 'user::quiet', 'drop.md'), 'drop', 'and the workspace keeps it');

    const before = fileWrites;
    await pass(root, 'user::quiet');
    assert.equal(fileWrites, before, 'nothing new, nothing written');

    await (await m.createOpfsWorkspace('user::quiet')).writeFiles({ '/drop.md': 'drop, changed' });
    await pass(root, 'user::quiet');
    assert.equal(await fileText(root, ['Spark', 'Files'], 'drop.md'), 'drop, changed', 'changed here, it is written again');
  });

  it("leaves a file over Spark's limit, and a name Windows cannot hold, where they are", async () => {
    const root = new BytesDir();
    const big = new Uint8Array(2_000_001).fill(0x61);
    await putFile(root, ['Spark', 'Files'], 'huge-there.txt', big);
    const copy = browser();
    use(copy, root, 'user::limits');
    await putFile(copy.opfs, workspace('user::limits'), 'huge-here.txt', big);
    await putFile(copy.opfs, workspace('user::limits'), 'what?.md', 'a question');
    await putFile(copy.opfs, workspace('user::limits'), 'fine.md', 'fine');
    const warn = console.warn;
    const said = [];
    console.warn = (...args) => said.push(args.join(' '));
    try {
      await pass(root, 'user::limits');
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(await fileNames(root, 'Spark', 'Files'), ['fine.md', 'huge-there.txt']);
    assert.equal(await has(copy.opfs, workspace('user::limits'), 'huge-there.txt'), false);
    assert.equal(said.filter((line) => /huge-here\.txt|huge-there\.txt|what\?\.md/.test(line)).length, 3, said.join('\n'));
  });
});

describe('the pass', () => {
  it('is asked for from the tasks folder, and is registered with the rest of Spark', () => {
    const register = read('features', 'spark', 'src', 'register.ts');
    assert.match(register, /import \{ requestSparkFolderFiles \} from '\.\/spark-folder-files';/);
    assert.match(register, /if \(collection === 'tasks'\) requestSparkFolderFiles\(ctx\.scopeId\);/);
    const pass = read('features', 'spark', 'src', 'spark-folder-files.ts');
    assert.match(pass, /withWebLock\('willow-spark-folder-files'/, 'one tab at a time');
    assert.match(pass, /if \(!scopeId \|\| !isSparkStateHydratedForScope\(scopeId\) \|\| !sparkDisk\(\)\) return;/,
      'never before the store has loaded the scope, or without the folder');
  });

  it('touches no folder before the store has loaded the scope', async () => {
    const root = new BytesDir();
    const copy = browser();
    use(copy, root, 'user::loaded');
    await (await m.createOpfsWorkspace('user::loaded')).writeFiles({ '/x.md': 'x' });
    await m.runSparkFolderFiles('user::someone-else');
    assert.deepEqual([...root.entries.keys()], []);
  });
});
