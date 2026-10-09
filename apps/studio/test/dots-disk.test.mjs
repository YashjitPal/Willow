/**
 * Dots in the workspace's `Spark/Dots/` folder, driven through the real synced-folder driver with
 * the real registration (features/spark/src/dots/dots-folder.ts), the real dots list and the real
 * thread store, against an in-memory folder. Two copies of Willow on one folder are two browsers:
 * each its own localStorage and its own conversation database. What these pin is that no dot and no
 * conversation is lost to the folder: not when another copy made it, not when this copy's storage
 * lost it, not when two copies took one dot two ways.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';
import { MemoryDir, fileNames, fileText, memoryStorage, useStorage, writeFile } from './memory-fs.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const SCOPE = 'user::dots-test-root::Workspace';
const DOTS_KEY = 'willow:spark:dots:v2';

const dotFile = (id, items) => JSON.stringify({
  version: 1,
  dot: { id, name: 'From the folder', presetId: 'blue_beret', appearance: null, petId: null, status: 'ready', category: null, createdAt: 5, updatedAt: 5, messages: [] },
  thread: {
    version: 1,
    dotId: id,
    items: items.map((text, index) => ({ id: `i${index + 1}`, seq: index + 1, kind: 'user', at: 100 + index, text })),
    nextSeq: items.length + 1,
    episodes: [],
    notebook: { 'about.md': { text: 'likes tea', updatedAt: 7 } },
    runtime: { status: 'idle', lastActedSeq: 0, lastCompactedSeq: 0, routines: [], delegations: [], usage: { inputTokens: 0, outputTokens: 0, turns: 0 } },
  },
});

// The first page this process loads found its saved dots list unreadable, with the folder's records
// of an earlier pass still beside it.
const firstStorage = useStorage(memoryStorage());
firstStorage.setItem(DOTS_KEY, '{ not json');
firstStorage.setItem(`willow_synced_ids:${encodeURIComponent('Spark/Dots')}:${encodeURIComponent(SCOPE)}`, JSON.stringify(['dot-saved']));
firstStorage.setItem(`willow_synced_state:${encodeURIComponent('Spark/Dots')}:${encodeURIComponent(SCOPE)}`, JSON.stringify({ 'dot-saved': { revision: 1, diskRevision: 1, diskMtime: 1, dirty: false, tombstone: false, updatedAt: 1 } }));
firstStorage.setItem(`willow_synced_hashes:${encodeURIComponent('Spark/Dots')}:${encodeURIComponent(SCOPE)}`, JSON.stringify({ 'dot-saved': '1' }));
globalThis.addEventListener ??= () => {};

/** `?raw`, as Vite and the production build give it: the file's text (the Spark harness's prompts). */
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
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-dots-disk-'));
  const outfile = path.join(bundleDir, 'dots.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'dots-disk-entry.ts',
      loader: 'ts',
      contents: `
        export { getSyncedFolders, syncRegisteredFolder } from '@willow/storage/local-sync';
        export { sparkDots, insertSparkDot, deleteSparkDot } from '@willow/spark/dots/dots-store';
        export { setDotThreadPersistence, loadDotThread, appendDotItems, flushDotThread, getDotThread, updateDotRuntime } from '@willow/spark/dots/harness/thread/thread-store';
        export { memoryPersistence } from '@willow/spark/dots/harness/thread/thread-persistence';
        export { setDotsFolderPersistence } from '@willow/spark/dots/dots-folder';
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
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

/** A copy of Willow: its localStorage and its conversation database. */
const browser = (storage = memoryStorage()) => ({ storage, threads: m.memoryPersistence() });

/** Puts `copy` in front, with its dots list read from its own storage (an unreadable one, as none). */
const use = (copy) => {
  useStorage(copy.storage);
  m.setDotThreadPersistence(copy.threads);
  m.setDotsFolderPersistence(copy.threads);
  let saved = null;
  try {
    saved = JSON.parse(copy.storage.getItem(DOTS_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  m.sparkDots.set(saved ?? { dots: [], categories: [] });
};

const descriptor = () => m.getSyncedFolders().find((folder) => folder.id === 'spark-dots');
const pass = (root) => m.syncRegisteredFolder(root, descriptor(), SCOPE);

/** A dot made here, with its conversation saved. */
const makeDot = async (id, texts) => {
  m.insertSparkDot({ id, name: null, presetId: 'blue_beret', status: 'ready' });
  await m.loadDotThread(id);
  m.appendDotItems(id, texts.map((text) => ({ kind: 'user', text })));
  await m.flushDotThread(id);
};
const say = async (id, text) => {
  await m.loadDotThread(id);
  m.appendDotItems(id, [{ kind: 'user', text }]);
  await m.flushDotThread(id);
};
const savedTexts = async (copy, id) => (await copy.threads.load(id)).items.map((item) => item.text);
const onDisk = async (root, id) => JSON.parse(await fileText(root, ['Spark', 'Dots'], `${id}.json`));

describe('Dots in the workspace folder', () => {
  it('reads a dots list it could not read back from the folder, instead of taking its dots for deleted', async () => {
    const root = new MemoryDir();
    await writeFile(root, ['Spark', 'Dots'], 'dot-saved.json', dotFile('dot-saved', ['first', 'second']));
    const copy = { storage: firstStorage, threads: m.memoryPersistence() };
    use(copy);
    assert.deepEqual(m.sparkDots.get().dots, [], 'the unreadable list started the dots over');
    await pass(root);
    assert.deepEqual(m.sparkDots.get().dots.map((dot) => dot.id), ['dot-saved']);
    assert.deepEqual(await savedTexts(copy, 'dot-saved'), ['first', 'second']);
    assert.deepEqual(await fileNames(root, 'Spark', 'Dots'), ['dot-saved.json']);
  });

  it('writes each dot with its whole conversation, and another copy reads it back', async () => {
    const root = new MemoryDir();
    const app = browser();
    use(app);
    await makeDot('dot-a', ['hello', 'how are you']);
    await pass(root);
    const file = await onDisk(root, 'dot-a');
    assert.deepEqual(file.thread.items.map((item) => item.text), ['hello', 'how are you']);

    const web = browser();
    use(web);
    await pass(root);
    assert.deepEqual(m.sparkDots.get().dots.map((dot) => dot.id), ['dot-a']);
    assert.deepEqual(await savedTexts(web, 'dot-a'), ['hello', 'how are you']);
  });

  it('brings a conversation another copy carried further up to date', async () => {
    const root = new MemoryDir();
    const app = browser();
    const web = browser();
    use(app);
    await makeDot('dot-b', ['one']);
    await pass(root);
    use(web);
    await pass(root);
    await say('dot-b', 'two, from the browser');
    await pass(root);
    use(app);
    await pass(root);
    assert.deepEqual(await savedTexts(app, 'dot-b'), ['one', 'two, from the browser']);
  });

  it("takes a conversation this copy's storage lost back from the folder, never writing over it", async () => {
    const root = new MemoryDir();
    const app = browser();
    use(app);
    await makeDot('dot-c', ['remember this', 'and this']);
    await pass(root);
    // Browser storage cleared under the page: the conversation database is empty, the list is not.
    const lost = { storage: app.storage, threads: m.memoryPersistence() };
    use(lost);
    await m.loadDotThread('dot-c');
    await m.flushDotThread('dot-c');
    await pass(root);
    assert.deepEqual((await onDisk(root, 'dot-c')).thread.items.map((item) => item.text), ['remember this', 'and this']);
    assert.deepEqual(await savedTexts(lost, 'dot-c'), ['remember this', 'and this']);
  });

  it('carries how freely a dot acts, and what was allowed for good, to a copy starting over', async () => {
    const root = new MemoryDir();
    const app = browser();
    use(app);
    await makeDot('dot-p', ['go ahead']);
    await pass(root);
    // The profile's Permissions (`setDotPermissions`) and a command approved for good, set after the file was written.
    m.updateDotRuntime('dot-p', { permissions: 'act', computer: { root: 'C:\\work', connectedAt: 9, rules: [['npm', 'test']] } });
    await m.flushDotThread('dot-p');
    await pass(root);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(m.getDotThread('dot-p').runtime.permissions, 'act', 'the pass took the folder\'s older runtime back over the choice');
    assert.equal((await onDisk(root, 'dot-p')).thread.runtime.permissions, 'act', 'a change to the runtime alone is written');

    // A reinstall with Willow's data gone: a new copy with nothing of its own, on the same folder.
    const fresh = browser();
    use(fresh);
    await pass(root);
    const runtime = (await fresh.threads.load('dot-p')).meta.runtime;
    assert.equal(runtime.permissions, 'act');
    assert.deepEqual(runtime.computer.rules, [['npm', 'test']]);
    assert.deepEqual(await savedTexts(fresh, 'dot-p'), ['go ahead']);
  });

  it('takes a change to how freely a dot acts made in another copy', async () => {
    const root = new MemoryDir();
    const app = browser();
    const web = browser();
    use(app);
    await makeDot('dot-q', ['shared']);
    await pass(root);
    use(web);
    await pass(root);
    await m.loadDotThread('dot-q');
    m.updateDotRuntime('dot-q', { permissions: 'ask' });
    await m.flushDotThread('dot-q');
    await pass(root);
    use(app);
    await pass(root);
    assert.equal((await app.threads.load('dot-q')).meta.runtime.permissions, 'ask');
  });

  it('lets a dot deleted in one copy go in the other', async () => {
    const root = new MemoryDir();
    const app = browser();
    const web = browser();
    use(app);
    await makeDot('dot-d', ['bye soon']);
    await pass(root);
    use(web);
    await pass(root);
    m.deleteSparkDot('dot-d');
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Spark', 'Dots'), []);
    use(app);
    await pass(root);
    assert.deepEqual(m.sparkDots.get().dots, []);
    assert.deepEqual(await savedTexts(app, 'dot-d'), []);
  });

  it('moves a deleted dot to the Recycle Bin, and moving it back brings it back', async () => {
    const root = new MemoryDir();
    const app = browser();
    use(app);
    await makeDot('dot-f', ['keep me']);
    await pass(root);
    m.deleteSparkDot('dot-f');
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Spark', 'Dots'), []);
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const binned = await fileText(root, ['Recycle Bin', day, 'Spark', 'Dots'], 'dot-f.json');
    await writeFile(root, ['Spark', 'Dots'], 'dot-f.json', binned);
    await pass(root);
    assert.deepEqual(m.sparkDots.get().dots.map((dot) => dot.id), ['dot-f']);
    assert.deepEqual(await savedTexts(app, 'dot-f'), ['keep me']);
  });

  it('keeps both of two conversations that went two ways, and stops writing them over each other', async () => {
    const root = new MemoryDir();
    const app = browser();
    const web = browser();
    use(app);
    await makeDot('dot-e', ['shared']);
    await pass(root);
    use(web);
    await pass(root);
    await say('dot-e', 'said in the browser');
    use(app);
    await say('dot-e', 'said in the app');
    await pass(root);
    use(web);
    await pass(root);
    assert.deepEqual(await savedTexts(web, 'dot-e'), ['shared', 'said in the browser'], 'the browser keeps its own');
    assert.deepEqual(await savedTexts(app, 'dot-e'), ['shared', 'said in the app'], 'and the app its own');
    const written = await fileText(root, ['Spark', 'Dots'], 'dot-e.json');
    await pass(root);
    use(app);
    await pass(root);
    assert.equal(await fileText(root, ['Spark', 'Dots'], 'dot-e.json'), written, 'neither writes over the other until it changes');
  });
});
