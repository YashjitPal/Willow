/**
 * A notebook's `.willow.json` carries the notebook, not only its id, so a copy of Willow that starts
 * without the notebook list (a reinstall, a fresh profile, the web version on the same folder)
 * rebuilds it from `Notebooks/` — and finds the chats filed there again.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const backendModule = path.join(repoRoot, 'features', 'notebooks', 'src', 'notebooks-backend.ts');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const notebook = {
  id: 'nb-1',
  title: 'Physics',
  emoji: '🧪',
  vertical: 'study',
  chatIds: ['Chat about forces'],
  sources: [
    { id: 's-1', title: 'notes.md', kind: 'text', content: 'F = ma', fsName: 'notes.md', createdAt: 5 },
    { id: 's-2', title: 'diagram.png', kind: 'file', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA', fsName: 'diagram.png', createdAt: 6 },
  ],
  fsFolder: 'Physics',
  pinned: true,
  instructions: 'Explain like a tutor.',
  createdAt: 1,
  updatedAt: 9,
};

it('writes the details, not the chats or the bytes, into the manifest', async () => {
  const { notebookManifest } = await importTs(backendModule);
  const manifest = notebookManifest(notebook);
  assert.equal(manifest.id, 'nb-1');
  assert.equal(manifest.title, 'Physics');
  assert.equal(manifest.instructions, 'Explain like a tutor.');
  assert.equal(manifest.pinned, true);
  assert.ok(!('chatIds' in manifest), 'which chats a notebook holds is what its Chats/ folder says');
  assert.ok(!('fsFolder' in manifest), 'the folder is where the manifest is');
  assert.equal(manifest.sources[0].content, 'F = ma');
  assert.ok(!('dataUrl' in manifest.sources[1]), "a source's bytes are in Sources/, not in the manifest");
});

it('rebuilds the notebook from its manifest and folder', async () => {
  const { notebookFromManifest, notebookManifest } = await importTs(backendModule);
  const rebuilt = notebookFromManifest(JSON.parse(JSON.stringify(notebookManifest(notebook))), 'Physics');
  assert.equal(rebuilt.id, 'nb-1');
  assert.equal(rebuilt.title, 'Physics');
  assert.equal(rebuilt.vertical, 'study');
  assert.equal(rebuilt.fsFolder, 'Physics');
  assert.deepEqual(rebuilt.chatIds, []);
  assert.equal(rebuilt.sources.length, 2);
  assert.equal(rebuilt.sources[1].fsName, 'diagram.png');

  const bare = notebookFromManifest({ id: 'nb-2' }, 'Old notebook');
  assert.equal(bare.title, 'Old notebook', 'a manifest from before this names the notebook after its folder');
  assert.equal(notebookFromManifest({ title: 'No id' }, 'Folder'), null);
});

it('rebuilds once per scope in the poll, and keeps every manifest current', () => {
  const context = read('platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx');
  const backfill = context.slice(context.indexOf('const backfillNotebooksToDisk'), context.indexOf('const moveLocalFSChatToNotebook'));
  assert.match(backfill, /notebooksAdoptedScopeRef\.current !== scope/);
  assert.match(backfill, /readNotebookManifests\(rootDir\)/);
  assert.match(backfill, /writeNotebooks\(sortNotebooks\(\[\.\.\.known, \.\.\.rebuilt\]\)\)/);
  assert.match(backfill, /writeNotebookManifest\(rootDir, notebook\.fsFolder, notebook\.id, text\)/);
});
