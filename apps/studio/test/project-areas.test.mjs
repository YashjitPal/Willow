/**
 * Contract tests for project-area registration.
 *
 * A project area owns one top-level workspace folder. The storage lifecycle
 * discovers, bootstraps, renames, and deletes these areas from this registry,
 * so these checks protect the extension point future features depend on.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, beforeEach, it } from 'node:test';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

let bundleDir = '';
let areas;

before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-project-areas-'));
  const outfile = path.join(bundleDir, 'registry.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'project-areas-entry.ts',
      loader: 'ts',
      contents: `export * from '@willow/storage/local-fs/project-areas';`,
    },
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node23',
    plugins: [willowAliasPlugin(repoRoot)],
  });
  areas = await import(pathToFileURL(outfile).href);
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

beforeEach(() => areas.__clearProjectAreasForTest());

it('starts empty so host applications own their defaults', () => {
  assert.deepEqual(areas.getProjectAreas(), []);
});

it('registers a new area and lets higher priority win duplicate names', () => {
  areas.registerProjectArea({ id: 'code', folder: 'Code', kind: 'code', priority: 30 });
  areas.registerProjectArea({ id: 'media', folder: 'Media', kind: 'media', priority: 20 });
  areas.registerProjectArea({ id: 'design', folder: 'Design', kind: 'design', priority: 10 });
  areas.registerProjectArea({ id: 'future', folder: 'Future', kind: 'future', priority: 40 });
  assert.deepEqual(
    areas.getProjectAreas().map((area) => area.id),
    ['future', 'code', 'media', 'design'],
  );
  assert.equal(areas.getProjectAreaFolder('design'), 'Design');
});

it('re-registers one id without duplicating it', () => {
  areas.registerProjectArea({ id: 'design', folder: 'Design', kind: 'design', priority: 10 });
  areas.registerProjectArea({ id: 'design', folder: 'Designs', kind: 'design', priority: 5 });
  const registered = areas.getProjectAreas().filter((area) => area.id === 'design');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].folder, 'Designs');
});

it('rejects duplicate folders and unsafe non-top-level names', () => {
  areas.registerProjectArea({ id: 'design', folder: 'Design', kind: 'design' });
  assert.throws(() => areas.registerProjectArea({ id: 'other', folder: 'design', kind: 'other' }), /already owned by "design"/);
  for (const folder of ['', '   ', 'Design/Nodes', 'Design\\Nodes', '.', '..']) {
    assert.throws(
      () => areas.registerProjectArea({ id: 'bad', folder, kind: 'bad' }),
      /Invalid project area folder/,
      `unsafe folder ${JSON.stringify(folder)} must be rejected`,
    );
  }
});

it('rejects empty ids and reports unknown areas clearly', () => {
  assert.throws(() => areas.registerProjectArea({ id: '  ', folder: 'Future', kind: 'future' }), /id cannot be empty/);
  assert.throws(() => areas.getProjectAreaFolder('missing'), /No local project area registered/);
});
