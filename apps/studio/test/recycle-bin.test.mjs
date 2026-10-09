/**
 * The Recycle Bin at the root of the user's folder (platform/storage/src/local-fs/recycle-bin.ts):
 * what Willow deletes is moved there under the path it had, nothing is lost on the way, and the
 * bin explains itself.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';
import { MemoryDir, fileNames, fileText, writeFile } from './memory-fs.mjs';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const { moveToRecycleBin, RECYCLE_BIN_FOLDER } = await importTs(path.join(repo, 'platform', 'storage', 'src', 'local-fs', 'recycle-bin.ts'));

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

it('moves a deleted file into the bin under the path it had, and leaves a README there', async () => {
  const root = new MemoryDir();
  await writeFile(root, ['Chats'], 'Trip ideas.json', '{"messages":[]}');
  await moveToRecycleBin({ root, path: ['Chats'] }, await root.getDirectoryHandle('Chats'), 'Trip ideas.json');

  assert.deepEqual(await fileNames(root, 'Chats'), []);
  assert.equal(await fileText(root, [RECYCLE_BIN_FOLDER, today(), 'Chats'], 'Trip ideas.json'), '{"messages":[]}');
  assert.match(await fileText(root, [RECYCLE_BIN_FOLDER], 'README.txt'), /move it back to that folder as it is/);
});

it('keeps both when something of the same name is deleted twice in a day', async () => {
  const root = new MemoryDir();
  const place = { root, path: ['Gems'] };
  await writeFile(root, ['Gems'], 'Writer.json', 'first');
  await moveToRecycleBin(place, await root.getDirectoryHandle('Gems'), 'Writer.json');
  await writeFile(root, ['Gems'], 'Writer.json', 'second');
  await moveToRecycleBin(place, await root.getDirectoryHandle('Gems'), 'Writer.json');

  assert.deepEqual(await fileNames(root, RECYCLE_BIN_FOLDER, today(), 'Gems'), ['Writer (2).json', 'Writer.json']);
  assert.equal(await fileText(root, [RECYCLE_BIN_FOLDER, today(), 'Gems'], 'Writer (2).json'), 'second');
});

it('moves a whole project folder with everything in it', async () => {
  const root = new MemoryDir();
  await writeFile(root, ['Media', 'Holiday'], '.willow.json', '{"id":"#1"}');
  await writeFile(root, ['Media', 'Holiday', 'Images'], 'beach.png', 'bytes');
  await moveToRecycleBin({ root, path: ['Media'] }, await root.getDirectoryHandle('Media'), 'Holiday');

  assert.deepEqual(await fileNames(root, 'Media'), []);
  assert.equal(await fileText(root, [RECYCLE_BIN_FOLDER, today(), 'Media', 'Holiday', 'Images'], 'beach.png'), 'bytes');
  assert.equal(await fileText(root, [RECYCLE_BIN_FOLDER, today(), 'Media', 'Holiday'], '.willow.json'), '{"id":"#1"}');
});

it('throws, touching nothing, when there is nothing to move', async () => {
  const root = new MemoryDir();
  await root.getDirectoryHandle('Chats', { create: true });
  await assert.rejects(
    moveToRecycleBin({ root, path: ['Chats'] }, await root.getDirectoryHandle('Chats'), 'Missing.json'),
    (error) => error.name === 'NotFoundError',
  );
  assert.deepEqual(await fileNames(root), []);
});
