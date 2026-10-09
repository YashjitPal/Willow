/**
 * Gems in the workspace's `Gems/` folder, driven through the real synced-folder driver with the
 * real Gems registration (features/gems/src/register.ts), against an in-memory folder. What these
 * pin is that no Gem is lost to the engine's bookkeeping: not to the tombstone a deleted Gem of
 * the same name left, and not to a pass that runs before this browser's Gems were read.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';
import { MemoryDir, fileNames, memoryStorage, useStorage, writeFile } from './memory-fs.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const SCOPE = 'user::opfs-test-root::Workspace';

// The store reads localStorage as it loads, and listens for other tabs' writes once hydrated.
useStorage(memoryStorage());
globalThis.addEventListener ??= () => {};

let bundleDir = '';
let m;
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-gems-disk-'));
  const outfile = path.join(bundleDir, 'gems.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'gems-disk-entry.ts',
      loader: 'ts',
      contents: `
        export { getSyncedFolders, syncRegisteredFolder, syncedFolderKeys } from '@willow/storage/local-sync';
        export * from '@willow/gems/gems-store';
        export { emptyGemDraft } from '@willow/gems/gem-types';
        import '@willow/gems/register';
      `,
    },
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node23',
    plugins: [willowAliasPlugin(repoRoot)],
  });
  m = await import(pathToFileURL(outfile).href);
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

/** A browser: its localStorage, with the store as a page that has not read it yet holds it. */
const freshPage = (storage = memoryStorage()) => {
  useStorage(storage);
  m.gemsHydratedStore.set(false);
  m.gemsStore.set([]);
  return storage;
};

const descriptor = () => m.getSyncedFolders().find((f) => f.id === 'gems');
const pass = (root) => m.syncRegisteredFolder(root, descriptor(), SCOPE);
const draft = (name, instructions = `Be ${name}.`) => ({ ...m.emptyGemDraft(), name, instructions });

beforeEach(() => {
  freshPage();
  m.hydrateGems();
});

describe('Gems in the workspace folder', () => {
  it('writes a Gem made with a deleted Gem\'s name, and keeps it', async () => {
    const root = new MemoryDir();
    const first = m.createGem(draft('Writer'));
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Gems'), ['Writer.json']);
    m.deleteGem(first.id);
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Gems'), []);

    const second = m.createGem(draft('Writer', 'Write tightly.'));
    await pass(root);
    assert.equal(m.getGem(second.id)?.instructions, 'Write tightly.');
    assert.equal((await fileNames(root, 'Gems')).length, 1, 'the new Gem has its file');

    // A change on disk makes the next pass hand the folder's Gems back to the store.
    await writeFile(root, ['Gems'], 'From disk.json', JSON.stringify({ name: 'From disk' }));
    await pass(root);
    assert.deepEqual(m.gemsStore.get().map((g) => g.name).sort(), ['From disk', 'Writer'], 'the new Gem is still here');
  });

  it('deletes nothing when a pass runs before this page has read its Gems', async () => {
    const root = new MemoryDir();
    m.createGem(draft('Writer'));
    m.createGem(draft('Coach'));
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Gems'), ['Coach.json', 'Writer.json']);

    // A reload onto a page that never reads the Gems (Media, Code): the first pass comes first.
    const storage = freshPage(globalThis.localStorage);
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Gems'), ['Coach.json', 'Writer.json'], 'no Gem file is deleted');

    m.hydrateGems();
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Gems'), ['Coach.json', 'Writer.json']);
    assert.deepEqual(JSON.parse(storage.getItem('willow_gems:v1')).map((g) => g.name).sort(), ['Coach', 'Writer']);
  });

  it('writes back the Gems an earlier pass refused, and keeps them', async () => {
    // What the bug left behind: the Gem here, its file gone, its id tombstoned.
    const root = new MemoryDir();
    const gem = m.createGem(draft('Writer'));
    await pass(root);
    await (await root.getDirectoryHandle('Gems')).removeEntry('Writer.json');
    const keys = m.syncedFolderKeys('Gems', SCOPE);
    const records = JSON.parse(globalThis.localStorage.getItem(keys.sync));
    records.Writer = { ...records.Writer, revision: records.Writer.revision + 1, tombstone: true, dirty: false };
    globalThis.localStorage.setItem(keys.sync, JSON.stringify(records));
    globalThis.localStorage.setItem(keys.ids, JSON.stringify([]));

    await pass(root);
    assert.deepEqual(await fileNames(root, 'Gems'), ['Writer.json']);
    await writeFile(root, ['Gems'], 'Other.json', JSON.stringify({ name: 'Other' }));
    await pass(root);
    assert.ok(m.getGem(gem.id), 'and the next pass from disk keeps it');
  });

  it('keeps what disk deleted deleted, even when disk speaks before this page has read its Gems', async () => {
    m.createGem(draft('Writer'));
    m.createGem(draft('Coach'));
    const storage = freshPage(globalThis.localStorage);
    const coach = JSON.parse(storage.getItem('willow_gems:v1')).find((g) => g.name === 'Coach');
    await descriptor().applyRemote([{ id: coach.id, contents: JSON.stringify(coach) }], { scopeId: SCOPE });
    m.hydrateGems();
    assert.deepEqual(m.gemsStore.get().map((g) => g.name), ['Coach']);
    assert.deepEqual(JSON.parse(storage.getItem('willow_gems:v1')).map((g) => g.name), ['Coach']);
  });

  it('keeps a Gem deleted here deleted', async () => {
    const root = new MemoryDir();
    const gem = m.createGem(draft('Writer'));
    await pass(root);
    m.deleteGem(gem.id);
    await pass(root);
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Gems'), []);
    assert.equal(m.getGem(gem.id), undefined);
  });

  it('deletes a Gem whose file was deleted on disk, for good', async () => {
    const root = new MemoryDir();
    const gem = m.createGem(draft('Writer'));
    m.createGem(draft('Coach'));
    await pass(root);
    await (await root.getDirectoryHandle('Gems')).removeEntry('Writer.json');
    await pass(root);
    assert.equal(m.getGem(gem.id), undefined);
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Gems'), ['Coach.json'], 'not written back');
    assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('willow_gems:v1')).map((g) => g.name), ['Coach']);
  });
});
