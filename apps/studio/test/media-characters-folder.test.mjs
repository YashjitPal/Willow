/**
 * Media's characters read back from a project's `Images/Characters/` (the real
 * `features/media/src/characters/character-folder-sync.ts` and character store), with this browser's
 * character database in memory. What these pin is that a browser starting over gets the project's
 * characters back with their pictures, that a newer copy on either side wins, and that a character
 * deleted here does not come back from a copy left in the folder.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';
import { memoryStorage, useStorage } from './memory-fs.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const SCOPE = 'user-1::folder-1::My Willow';

/** `@willow/storage/media-characters`, in memory: this browser's character database. */
const charactersInMemory = {
  name: 'characters-in-memory',
  setup(build) {
    build.onResolve({ filter: /^@willow\/storage\/media-characters$/ }, () => ({ path: 'media-characters', namespace: 'in-memory' }));
    build.onLoad({ filter: /.*/, namespace: 'in-memory' }, () => ({
      loader: 'js',
      contents: `
        export const database = new Map();
        const rows = (projectId, scopeId) => {
          const key = scopeId + '|' + projectId;
          if (!database.has(key)) database.set(key, new Map());
          return database.get(key);
        };
        export async function listCharacters(projectId, scopeId) {
          return [...rows(projectId, scopeId).values()].map((c) => structuredClone(c)).sort((a, b) => a.createdAt - b.createdAt);
        }
        export async function saveCharacter(projectId, character, scopeId) { rows(projectId, scopeId).set(character.id, structuredClone(character)); }
        export async function deleteCharacter(projectId, id, scopeId) { rows(projectId, scopeId).delete(id); }
      `,
    }));
  },
};

useStorage(memoryStorage());

let bundleDir = '';
let m;
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-media-characters-folder-'));
  const outfile = path.join(bundleDir, 'characters.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'media-characters-folder-entry.ts',
      loader: 'ts',
      contents: `
        export { database } from '@willow/storage/media-characters';
        export { readCharactersFromFolder } from '../../features/media/src/characters/character-folder-sync';
        export { $characters, bindCharacterProject, deleteCharacter } from '../../features/media/src/characters/character-store';
        export { CHARACTER_FILE_FORMAT, characterFileName, characterFileText } from '../../features/media/src/characters/character-files';
      `,
    },
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node23',
    plugins: [charactersInMemory, willowAliasPlugin(repoRoot)],
  });
  m = await import(pathToFileURL(outfile).href);
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

beforeEach(() => {
  useStorage(memoryStorage());
});

let projects = 0;
/** A project of its own for each test: the store and the folder sync keep the one they were last on. */
const newProject = () => `project-${(projects += 1)}`;

const characterFile = (id, name, updatedAt, extra = {}) => ({
  format: m.CHARACTER_FILE_FORMAT, version: 1, id, name, createdAt: 1, updatedAt, ...extra,
});
const folderOf = (files) => ({
  key: 'folder-1',
  list: async () => (files === null ? null : files.map((file) => ({ fsName: m.characterFileName(file.id), text: m.characterFileText(file) }))),
  save: async () => true,
  remove: async () => true,
});
const read = (project, files, items = []) => m.readCharactersFromFolder(folderOf(files), project, SCOPE, 'Trip', items, () => undefined);
const shown = () => m.$characters.get().map((c) => `${c.id}:${c.name}`);
const stored = (project) => [...(m.database.get(`${SCOPE}|${project}`)?.values() ?? [])].map((c) => `${c.id}:${c.name}`).sort();

describe('characters in a project\'s folder', () => {
  it('come back to a browser starting over, their pictures found where their files are', async () => {
    const project = newProject();
    await m.bindCharacterProject(project, SCOPE);
    await read(project, [characterFile('character-1', 'Ada', 5, {
      personality: 'Dry', portrait: { id: 'gen-old-id', file: 'Images/Ada.png' }, body: { id: 'gen-body' },
    })], [{ id: 'disk_image_Ada.png', kind: 'image', fsName: 'ada.png' }]);
    assert.deepEqual(shown(), ['character-1:Ada']);
    const [ada] = m.$characters.get();
    assert.equal(ada.portraitId, 'disk_image_Ada.png');
    assert.equal(ada.bodyId, 'gen-body');
    assert.equal(ada.personality, 'Dry');
    assert.deepEqual(stored(project), ['character-1:Ada']);
  });

  it('take the newer of the two copies of each', async () => {
    const project = newProject();
    m.database.set(`${SCOPE}|${project}`, new Map([
      ['character-1', { id: 'character-1', name: 'Ada changed here', createdAt: 1, updatedAt: 50 }],
      ['character-2', { id: 'character-2', name: 'Bob before', createdAt: 2, updatedAt: 10 }],
    ]));
    await m.bindCharacterProject(project, SCOPE);
    await read(project, [characterFile('character-1', 'Ada in the folder', 40), characterFile('character-2', 'Bob changed elsewhere', 30)]);
    assert.deepEqual(shown(), ['character-1:Ada changed here', 'character-2:Bob changed elsewhere']);
    assert.deepEqual(stored(project), ['character-1:Ada changed here', 'character-2:Bob changed elsewhere']);
  });

  it('take the newest of two files for one character', async () => {
    const project = newProject();
    await m.bindCharacterProject(project, SCOPE);
    await read(project, [characterFile('character-1', 'Copy', 20), characterFile('character-1', 'Newest', 30)]);
    assert.deepEqual(shown(), ['character-1:Newest']);
  });

  it('do not bring back one deleted here', async () => {
    const project = newProject();
    m.database.set(`${SCOPE}|${project}`, new Map([['character-1', { id: 'character-1', name: 'Ada', createdAt: 1, updatedAt: 5 }]]));
    await m.bindCharacterProject(project, SCOPE);
    m.deleteCharacter('character-1');
    await read(project, [characterFile('character-1', 'Ada', 5), characterFile('character-2', 'Bob', 5)]);
    assert.deepEqual(shown(), ['character-2:Bob']);
    assert.deepEqual(stored(project), ['character-2:Bob']);
  });

  it('are left as they are when the folder cannot be read', async () => {
    const project = newProject();
    m.database.set(`${SCOPE}|${project}`, new Map([['character-1', { id: 'character-1', name: 'Ada', createdAt: 1, updatedAt: 5 }]]));
    await m.bindCharacterProject(project, SCOPE);
    await read(project, null);
    assert.deepEqual(shown(), ['character-1:Ada']);
  });

  it('go to their own project when it is not the one shown', async () => {
    const shownProject = newProject();
    const other = newProject();
    await m.bindCharacterProject(shownProject, SCOPE);
    await read(other, [characterFile('character-9', 'Elsewhere', 5)]);
    assert.deepEqual(shown(), []);
    assert.deepEqual(stored(other), ['character-9:Elsewhere']);
  });
});
