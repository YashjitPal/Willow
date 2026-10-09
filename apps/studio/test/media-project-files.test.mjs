/**
 * Willow's own small files in a Media project's folder (`platform/storage/src/media-project-files.ts`),
 * against an in-memory folder: the details file, a character's file in `Images/Characters/`, an
 * agent chat in `Agent sessions/`. What these pin is that a browser starting over, or one that has
 * not met every file yet, never writes its emptier copy over what the folder holds.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';
import { MemoryDir, fileNames, fileText, memoryStorage, useStorage, writeFile } from './memory-fs.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

useStorage(memoryStorage());

let bundleDir = '';
let m;
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-media-project-files-'));
  const outfile = path.join(bundleDir, 'media-project-files.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'media-project-files-entry.ts',
      loader: 'ts',
      contents: `
        import '@willow/storage/local-fs/media-disk';
        export { listMediaFolderFiles, readMediaDetailsFile, removeMediaFolderFile, writeMediaDetailsFile, writeMediaFolderFile } from '@willow/storage/media-project-files';
        export { buildMediaDetails, MEDIA_DETAILS_FILE } from '@willow/storage/media-details';
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

beforeEach(() => {
  useStorage(memoryStorage());
});

const deps = (root) => ({ getActiveHandle: async () => root, resolveCurrentProjectName: (name) => name });
const PROJECT = ['Media', 'Trip'];
const placeOf = (item) => `${item.collectionId ? item.collectionId : item.kind === 'image' ? 'Images' : 'Audio'}/${item.fsName}`;
const item = (id, fsName, extra = {}) => ({ id, kind: 'image', status: 'completed', prompt: `Prompt ${id}`, modelId: 'imagen-5', isSavedToFS: true, fsName, ...extra });
const details = (items) => m.buildMediaDetails(items, placeOf, []);
const detailsOnDisk = async (root) => JSON.parse(await fileText(root, PROJECT, m.MEDIA_DETAILS_FILE));

/** A project folder with two pictures and the details file an earlier copy of Willow wrote for them. */
const projectWithDetails = async () => {
  const root = new MemoryDir();
  await writeFile(root, [...PROJECT, 'Images'], 'Cat.png', 'png');
  await writeFile(root, [...PROJECT, 'Images'], 'Dog.png', 'png');
  assert.ok(await m.writeMediaDetailsFile(deps(root), 'Trip', details([item('cat', 'Cat.png'), item('dog', 'Dog.png')])));
  return root;
};

describe('the details file in a project folder', () => {
  it('is written beside the media and read back', async () => {
    const root = await projectWithDetails();
    const read = await m.readMediaDetailsFile(await (await root.getDirectoryHandle('Media')).getDirectoryHandle('Trip'));
    assert.deepEqual(Object.keys(read.items).sort(), ['Images/Cat.png', 'Images/Dog.png']);
    assert.equal(read.items['Images/Cat.png'].prompt, 'Prompt cat');
  });

  it('keeps every entry a browser starting over has not met, and drops one whose file is gone', async () => {
    const root = await projectWithDetails();
    await (await (await (await root.getDirectoryHandle('Media')).getDirectoryHandle('Trip')).getDirectoryHandle('Images')).removeEntry('Dog.png');
    assert.ok(await m.writeMediaDetailsFile(deps(root), 'Trip', details([])));
    const onDisk = await detailsOnDisk(root);
    assert.deepEqual(Object.keys(onDisk.items), ['Images/Cat.png']);
    assert.equal(onDisk.items['Images/Cat.png'].prompt, 'Prompt cat');
  });

  it('adds this browser\'s entries to the folder\'s', async () => {
    const root = await projectWithDetails();
    await writeFile(root, [...PROJECT, 'Images'], 'Owl.png', 'png');
    assert.ok(await m.writeMediaDetailsFile(deps(root), 'Trip', details([item('owl', 'Owl.png')])));
    assert.deepEqual(Object.keys((await detailsOnDisk(root)).items).sort(), ['Images/Cat.png', 'Images/Dog.png', 'Images/Owl.png']);
  });

  it('leaves a file it cannot read as its own exactly as it is', async () => {
    for (const text of ['{ "format": "willow-media-details", half typed', JSON.stringify({ format: 'willow-media-details', version: 99, items: {} })]) {
      const root = new MemoryDir();
      await writeFile(root, PROJECT, m.MEDIA_DETAILS_FILE, text);
      await writeFile(root, [...PROJECT, 'Images'], 'Cat.png', 'png');
      assert.equal(await m.writeMediaDetailsFile(deps(root), 'Trip', details([item('cat', 'Cat.png')])), false);
      assert.equal(await fileText(root, PROJECT, m.MEDIA_DETAILS_FILE), text);
    }
  });

  it('makes no project folder, and no empty file', async () => {
    const root = new MemoryDir();
    assert.ok(await m.writeMediaDetailsFile(deps(root), 'Trip', details([item('cat', 'Cat.png')])), 'no folder: nothing to describe');
    assert.deepEqual([...root.entries.keys()], []);
    await writeFile(root, [...PROJECT, 'Images'], 'Cat.png', 'png');
    assert.ok(await m.writeMediaDetailsFile(deps(root), 'Trip', details([])));
    assert.deepEqual(await fileNames(root, ...PROJECT), []);
  });

  it('does not write a file that would read the same', async () => {
    const root = await projectWithDetails();
    const projectDir = await (await root.getDirectoryHandle('Media')).getDirectoryHandle('Trip');
    const before = (await projectDir.getFileHandle(m.MEDIA_DETAILS_FILE)).mtime;
    assert.ok(await m.writeMediaDetailsFile(deps(root), 'Trip', details([item('cat', 'Cat.png')])));
    assert.equal((await projectDir.getFileHandle(m.MEDIA_DETAILS_FILE)).mtime, before);
  });
});

describe('Willow\'s files in a project\'s folders', () => {
  it('lists the .json files of a folder, and none for a folder not there', async () => {
    const root = new MemoryDir();
    assert.deepEqual(await m.listMediaFolderFiles(deps(root), 'Trip', 'Images/Characters'), []);
    assert.ok(await m.writeMediaFolderFile(deps(root), 'Trip', 'Images/Characters', 'character-1.json', '{"id":"character-1"}'));
    await writeFile(root, [...PROJECT, 'Images', 'Characters'], 'portrait.png', 'png');
    await writeFile(root, [...PROJECT, 'Images', 'Characters'], '.hidden.json', '{}');
    assert.deepEqual(await m.listMediaFolderFiles(deps(root), 'Trip', 'Images/Characters'), [{ fsName: 'character-1.json', text: '{"id":"character-1"}' }]);
  });

  it('moves a file to the Recycle Bin rather than erasing it', async () => {
    const root = new MemoryDir();
    await m.writeMediaFolderFile(deps(root), 'Trip', 'Agent sessions', 'chat-1.json', '{"id":"chat-1"}');
    assert.ok(await m.removeMediaFolderFile(deps(root), 'Trip', 'Agent sessions', 'chat-1.json'));
    assert.deepEqual(await fileNames(root, ...PROJECT, 'Agent sessions'), []);
    const bin = await root.getDirectoryHandle('Recycle Bin');
    const [day] = [...bin.entries.values()].filter((entry) => entry.kind === 'directory');
    assert.equal(await fileText(day, ['Media', 'Trip', 'Agent sessions'], 'chat-1.json'), '{"id":"chat-1"}');
    assert.ok(await m.removeMediaFolderFile(deps(root), 'Trip', 'Agent sessions', 'chat-1.json'), 'already gone');
  });
});
