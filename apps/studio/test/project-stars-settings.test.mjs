/**
 * Starred projects in `settings.json` (apps/studio/src/app/project-stars.ts), through the real settings engine and the
 * real project registry, against an in-memory file. What these pin is that a copy starting over — which reads the file
 * before it has found its projects on disk — keeps the file's stars rather than writing an empty list over them, and
 * stars each project once it appears.
 */
import { after, afterEach, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

let bundleDir = '';
let m;
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-project-stars-'));
  const outfile = path.join(bundleDir, 'project-stars.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'project-stars-entry.ts',
      loader: 'ts',
      contents: `
        export * from '@willow/core/settings-file';
        export { projectStarsSection } from './src/app/project-stars';
        export { readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
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

const storage = new Map();
beforeEach(() => {
  storage.clear();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  m.__resetSettingsFileForTest();
});

afterEach(async () => {
  await m.attachSettingsFile(null);
});

const fakeDisk = (body) => {
  const disk = {
    id: 'folder-1',
    file: { text: JSON.stringify({ version: 1, ...body }, null, 2), modified: 1 },
    async read() { return { ...disk.file }; },
    async write(next) {
      disk.file = { text: next, modified: disk.file.modified + 1 };
      return disk.file.modified;
    },
    starred: () => JSON.parse(disk.file.text).projects?.starred,
  };
  return disk;
};

/** What the project scan does when it finds folders on disk. */
const discover = (projects) => {
  m.writeProjectRegistry(projects);
  window.dispatchEvent(new Event('willow_projects_updated'));
};
const starredHere = () => m.readProjectRegistry().filter((project) => project.isStarred === true).map((project) => project.id).sort();

it('keeps the file\'s stars while a copy starting over has yet to find its projects, and stars each as it appears', async () => {
  m.registerSettingsSection('projects', m.projectStarsSection);
  const disk = fakeDisk({ projects: { starred: ['#shop', '#site'] } });
  await m.attachSettingsFile(disk);
  await m.flushSettingsFile();
  assert.deepEqual(disk.starred(), ['#shop', '#site'], 'an empty list was written over the file\'s stars');

  discover([{ id: '#shop', name: 'Shop', kind: 'code' }, { id: '#notes', name: 'Notes', kind: 'media' }]);
  assert.deepEqual(starredHere(), ['#shop']);
  await m.flushSettingsFile();
  assert.deepEqual(disk.starred(), ['#shop', '#site'], 'a star for a project not found yet stays in the file');

  discover([...m.readProjectRegistry(), { id: '#site', name: 'Site', kind: 'code' }]);
  assert.deepEqual(starredHere(), ['#shop', '#site']);
});

it('writes a star taken off here to the file', async () => {
  m.registerSettingsSection('projects', m.projectStarsSection);
  const disk = fakeDisk({ projects: { starred: ['#shop'] } });
  discover([{ id: '#shop', name: 'Shop', kind: 'code' }]);
  await m.attachSettingsFile(disk);
  assert.deepEqual(starredHere(), ['#shop']);

  discover(m.readProjectRegistry().map((project) => ({ ...project, isStarred: false })));
  await m.flushSettingsFile();
  assert.deepEqual(disk.starred(), []);
});
