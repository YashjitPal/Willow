/**
 * Tests for the synced-folder registry — the seam a feature uses to start
 * syncing a workspace folder without editing platform/storage.
 *
 * The registry's job is small but its failure modes are nasty: two features
 * claiming one folder would reconcile against each other and delete each other's
 * files, and a folder name with a path separator would escape the workspace. Both
 * are rejected at registration, loudly, rather than at 3am on a user's disk.
 *
 * The last test is the one that matters for "can a new feature just plug in?":
 * it registers the real Gems descriptor and checks it satisfies the contract.
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
let registry;
let gemsModule;

before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-synced-folders-'));
  const outfile = path.join(bundleDir, 'registry.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'synced-folders-entry.ts',
      loader: 'ts',
      contents: `
        export * from '@willow/storage/synced-folders';
        export { gemsStore, makeGemId, upsertGem, removeGem } from '@willow/gems/gems-store';
        // Importing for its side effect registers the real Gems descriptor.
        export async function loadGemsRegistration() { await import('@willow/gems/register'); }
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
  registry = await import(pathToFileURL(outfile).href);
  gemsModule = registry;
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

beforeEach(() => {
  registry.__clearSyncedFoldersForTest();
});

const descriptor = (overrides = {}) => ({
  folder: 'Things',
  extension: '.json',
  readLocal: async () => [],
  applyRemote: async () => {},
  ...overrides,
});

/**
 * Gems' real descriptor, surviving `beforeEach`'s registry reset.
 *
 * The registration is a module side effect and ESM caches modules, so a second
 * `import` is a no-op. Capture the descriptor the first time and re-register it
 * afterwards, so each test still starts from a clean registry.
 */
let cachedGemsDescriptor;
const loadGemsDescriptor = async () => {
  if (!cachedGemsDescriptor) {
    await gemsModule.loadGemsRegistration();
    cachedGemsDescriptor = registry.getSyncedFolders().find((f) => f.id === 'gems');
    assert.ok(cachedGemsDescriptor, 'importing @willow/gems/register must register the folder');
  }
  registry.registerSyncedFolder('gems', cachedGemsDescriptor);
  return registry.getSyncedFolders().find((f) => f.id === 'gems');
};

it('registers a folder and exposes it to the engine', () => {
  registry.registerSyncedFolder('things', descriptor());
  const all = registry.getSyncedFolders();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 'things');
  assert.equal(all[0].folder, 'Things');
});

it('is idempotent under hot-module reload', () => {
  registry.registerSyncedFolder('things', descriptor());
  registry.registerSyncedFolder('things', descriptor({ extension: '.txt' }));
  const all = registry.getSyncedFolders();
  assert.equal(all.length, 1, 're-registering the same id must replace, not duplicate');
  assert.equal(all[0].extension, '.txt');
});

it('rejects two features claiming the same folder', () => {
  registry.registerSyncedFolder('things', descriptor());
  assert.throws(
    () => registry.registerSyncedFolder('other', descriptor()),
    /already owned by "things"/,
    'two reconcilers over one folder would delete each other\'s files',
  );
});

it('rejects a same-folder claim that differs only in case', () => {
  // Windows and macOS default to case-insensitive filesystems, so "Gems" and
  // "gems" are the same directory — the collision must still be caught.
  registry.registerSyncedFolder('things', descriptor({ folder: 'Gems' }));
  assert.throws(
    () => registry.registerSyncedFolder('other', descriptor({ folder: 'gems' })),
    /already owned by "things"/,
  );
});

it('accepts safe nested folder paths and rejects invalid paths', () => {
  registry.registerSyncedFolder('nested', descriptor({ folder: 'Spark/Tasks' }));
  assert.equal(registry.getSyncedFolders()[0].folder, 'Spark/Tasks');
  for (const folder of ['a//b', '/a', 'a/', 'a\\b', '', '   ']) {
    assert.throws(
      () => registry.registerSyncedFolder('bad', descriptor({ folder })),
      /non-empty path/,
      `"${folder}" must be rejected`,
    );
  }
});

it('rejects an extension missing its dot', () => {
  assert.throws(
    () => registry.registerSyncedFolder('bad', descriptor({ extension: 'json' })),
    /must start with a dot/,
  );
});

it('unregisters cleanly', () => {
  registry.registerSyncedFolder('things', descriptor());
  registry.unregisterSyncedFolder('things');
  assert.deepEqual(registry.getSyncedFolders(), []);
  // And the folder is free again.
  registry.registerSyncedFolder('other', descriptor());
  assert.equal(registry.getSyncedFolders()[0].id, 'other');
});

// ── The actual question: can a feature just plug in? ────────────────────────

it('Gems registers itself by importing its register module, and round-trips', async () => {
  const gems = await loadGemsDescriptor();
  assert.equal(gems.folder, 'Gems');
  assert.equal(gems.extension, '.json');

  // readLocal reflects the feature's own store...
  const gem = {
    id: 'Research Helper',
    name: 'Research Helper',
    description: 'Finds sources',
    instructions: 'Be rigorous.',
    defaultTool: 'No default tool',
    createdAt: 1,
    updatedAt: 2,
  };
  gemsModule.gemsStore.set([gem]);
  const local = await gems.readLocal({ scopeId: 'test' });
  assert.equal(local.length, 1);
  assert.equal(local[0].id, 'Research Helper');

  // ...and applyRemote parses disk contents back into it, losslessly.
  gemsModule.gemsStore.set([]);
  await gems.applyRemote(local, { scopeId: 'test' });
  assert.deepEqual(gemsModule.gemsStore.get(), [gem], 'a disk round trip must not lose fields');
});

it('Gems skips a malformed file instead of throwing the whole pass', async () => {
  // `beforeEach` clears the registry, and ESM caches the module so its
  // side-effect import will not fire twice — re-register from the captured
  // descriptor instead of re-importing.
  const gems = await loadGemsDescriptor();

  gemsModule.gemsStore.set([]);
  await gems.applyRemote([
    { id: 'broken', contents: 'not json at all' },
    { id: 'no-name', contents: '{"description":"missing its name"}' },
    { id: 'Fine', contents: '{"name":"Fine"}' },
  ], { scopeId: 'test' });

  const ids = gemsModule.gemsStore.get().map((g) => g.id);
  assert.deepEqual(ids, ['Fine'], 'one bad file must not take the good ones down with it');
});

it('gem ids are safe to use as file names', () => {
  // The id IS the file name stem, so it must survive a filesystem round trip.
  assert.equal(gemsModule.makeGemId('Notes: v2 / draft'), 'Notes v2  draft');
  // A name that sanitizes down to nothing still has to yield a usable id.
  assert.match(gemsModule.makeGemId('  '), /^gem-\d+$/);
  assert.match(gemsModule.makeGemId('///'), /^gem-\d+$/);
  assert.ok(!/[\\/:*?"<>|]/.test(gemsModule.makeGemId('a/b:c*d?e"f<g>h|i')));
});
