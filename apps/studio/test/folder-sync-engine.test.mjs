/**
 * Tests for the shared reconcile engine.
 *
 * The point of extracting `reconcileFolder` out of LocalFSContext was that the
 * sync rules could finally be executed in a test instead of restated in prose
 * for each new data type. So these tests are the real specification of the
 * engine's delete-safety guarantees — including the two that have actually lost
 * user data in this app:
 *
 *   1. a stale directory listing must not drive a delete decision, and
 *   2. a dirty item with an unreadable body must be retried, not erased.
 *
 * The engine is imported directly. `--experimental-strip-types` handles the TS.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, it } from 'node:test';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

// The engine is browser-side source: `@willow/*` aliases, no file extensions.
// Bundling it through the app's own alias plugin means this test resolves it
// exactly the way the app does, rather than duplicating the path map here.
let bundleDir = '';
let reconcileFolder;

before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-folder-sync-'));
  const outfile = path.join(bundleDir, 'engine.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'folder-sync-entry.ts',
      loader: 'ts',
      contents: `export { reconcileFolder } from '@willow/storage/local-fs/folder-sync-engine';`,
    },
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node23',
    plugins: [willowAliasPlugin(repoRoot)],
  });
  ({ reconcileFolder } = await import(pathToFileURL(outfile).href));
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

/**
 * In-memory stand-in for a workspace folder plus its local cache.
 *
 * `hooks` is what makes the race tests possible: `beforeStat` runs at the moment
 * the engine asks "does this still exist?", which is exactly the window a real
 * save lands in.
 */
const makeFakes = ({
  disk = {},
  cache = {},
  records = {},
  ids = [],
  timestamps = {},
  hooks = {},
} = {}) => {
  const diskFiles = new Map(Object.entries(disk).map(([id, v]) => [
    id,
    typeof v === 'string' ? { contents: v, mtime: 1000 } : v,
  ]));
  const cacheFiles = new Map(Object.entries(cache));
  const log = [];

  const ports = {
    records: { ...records },
    ids: [...ids],
    timestamps: { ...timestamps },

    list: async () => {
      if (hooks.listThrows) throw new Error('scan failed');
      // Snapshot, exactly like a real directory enumeration.
      return [...diskFiles].map(([id, f]) => ({
        id,
        mtime: f.mtime,
        read: async () => {
          if (hooks.readThrowsFor === id) throw new Error('unreadable');
          const current = diskFiles.get(id);
          if (!current) throw new Error('gone');
          return current.contents;
        },
      }));
    },

    statNow: async (id) => {
      hooks.beforeStat?.(id, { diskFiles, cacheFiles, ports });
      if (hooks.statUnreadableFor === id) return 'unreadable';
      return diskFiles.has(id) ? 'present' : 'absent';
    },

    write: async (id, contents) => {
      if (hooks.writeThrowsFor === id) throw new Error('write failed');
      log.push(`write:${id}`);
      diskFiles.set(id, { contents, mtime: 2000 });
      return { mtime: 2000 };
    },
    remove: async (id) => { log.push(`remove:${id}`); diskFiles.delete(id); },

    readCache: async (id) => {
      if (hooks.cacheUnreadableFor === id) return null;
      return cacheFiles.has(id) ? cacheFiles.get(id) : null;
    },
    writeCache: async (id, contents) => { cacheFiles.set(id, contents); },
    deleteCache: async (id) => { log.push(`deleteCache:${id}`); cacheFiles.delete(id); },

    lock: async (_ids, operation) => operation(),
    nextRevision: (id) => (ports.records[id]?.revision || 0) + 1,
    onItemChanged: (id, change) => log.push(`${change}:${id}`),
  };

  return { ports, diskFiles, cacheFiles, log };
};

const clean = (mtime = 1000) => ({
  revision: 1, diskRevision: 1, diskMtime: mtime, dirty: false, tombstone: false, updatedAt: 1,
});
const dirty = () => ({
  revision: 2, diskRevision: 1, diskMtime: 1000, dirty: true, tombstone: false, updatedAt: 2,
});

// ── The two failures that actually destroyed user data ──────────────────────

it('does not delete an item that lands on disk after the listing was taken', async () => {
  // The real timeline: reconcile lists the folder, then a save writes a new file
  // while the pass is still walking earlier items. The listing cannot see it.
  const { ports, diskFiles } = makeFakes({
    disk: { 'Older Chat': 'old' },
    cache: { 'Older Chat': 'old', 'Renamed To Its Title': 'live conversation' },
    records: { 'Older Chat': clean(), 'Renamed To Its Title': clean(2000) },
    ids: ['Older Chat', 'Renamed To Its Title'],
    hooks: {
      // The save completes exactly when the engine checks liveness.
      beforeStat: (id) => {
        if (id === 'Renamed To Its Title') {
          diskFiles.set(id, { contents: 'live conversation', mtime: 2000 });
        }
      },
    },
  });

  const result = await reconcileFolder(ports);

  assert.deepEqual(result.deleted, [], 'nothing may be deleted');
  assert.ok(ports.ids.includes('Renamed To Its Title'), 'the live item must survive');
  assert.equal(ports.records['Renamed To Its Title'].tombstone, false);
  assert.ok(result.items.some((i) => i.id === 'Renamed To Its Title'));
});

it('retries a dirty item whose cached body cannot be read, instead of erasing it', async () => {
  // A save registers the item before writing its body, so a pass landing
  // mid-save sees dirty-with-no-body.
  const { ports } = makeFakes({
    disk: {},
    cache: {},
    records: { 'Save In Flight': dirty() },
    ids: ['Save In Flight'],
    hooks: { cacheUnreadableFor: 'Save In Flight' },
  });

  const result = await reconcileFolder(ports);

  assert.deepEqual(result.deleted, []);
  assert.equal(ports.records['Save In Flight'].tombstone, false);
  assert.equal(ports.records['Save In Flight'].dirty, true, 'must stay dirty so a later pass retries');
});

// ── Deletion that SHOULD happen ─────────────────────────────────────────────

it('deletes an item genuinely removed from disk, and tombstones it', async () => {
  const { ports, log } = makeFakes({
    disk: {},
    cache: { 'Deleted In Explorer': 'bye' },
    records: { 'Deleted In Explorer': clean() },
    ids: ['Deleted In Explorer'],
  });

  const result = await reconcileFolder(ports);

  assert.deepEqual(result.deleted, ['Deleted In Explorer']);
  assert.equal(ports.records['Deleted In Explorer'].tombstone, true);
  assert.deepEqual(ports.ids, []);
  assert.ok(log.includes('deleteCache:Deleted In Explorer'), 'the cached body must go too');
});

it('treats an unreadable liveness check as inconclusive, not as a deletion', async () => {
  const { ports } = makeFakes({
    disk: {},
    cache: { 'Permission Blip': 'x' },
    records: { 'Permission Blip': clean() },
    ids: ['Permission Blip'],
    hooks: { statUnreadableFor: 'Permission Blip' },
  });

  const result = await reconcileFolder(ports);

  assert.deepEqual(result.deleted, [], 'a permission error is not proof of deletion');
  assert.equal(ports.records['Permission Blip'].tombstone, false);
});

it('performs zero deletions when the scan itself failed', async () => {
  const { ports } = makeFakes({
    cache: { A: '1', B: '2' },
    records: { A: clean(), B: clean() },
    ids: ['A', 'B'],
    hooks: { listThrows: true },
  });

  const result = await reconcileFolder(ports);

  assert.equal(result.ok, false, 'a failed scan must report not-ok');
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(ports.ids, ['A', 'B'], 'the id list must be untouched');
});

// ── Tombstones, conflicts, ingest ───────────────────────────────────────────

it('re-removes a tombstoned item that reappeared on disk', async () => {
  // A failed removal, or a file restored from a backup, must not resurrect it.
  const { ports, diskFiles, log } = makeFakes({
    disk: { Zombie: 'back again' },
    records: { Zombie: { ...clean(), tombstone: true } },
    ids: ['Zombie'],
  });

  await reconcileFolder(ports);

  assert.equal(diskFiles.has('Zombie'), false, 'the file must be removed again');
  assert.ok(log.includes('remove:Zombie'));
  assert.deepEqual(ports.ids, []);
});

it('ingests a new file created outside the app', async () => {
  const { ports, cacheFiles } = makeFakes({
    disk: { 'Dropped In': 'hello from explorer' },
  });

  const result = await reconcileFolder(ports);

  assert.ok(ports.ids.includes('Dropped In'));
  assert.equal(cacheFiles.get('Dropped In'), 'hello from explorer');
  assert.equal(result.changed, true);
  assert.ok(result.items.some((i) => i.id === 'Dropped In' && i.contents === 'hello from explorer'));
});

it('preserves an external edit as a conflict copy before rewriting local work', async () => {
  const { ports, diskFiles } = makeFakes({
    // Disk changed under us (different mtime) AND we have unsaved local work.
    disk: { Notes: { contents: 'edited in another editor', mtime: 5000 } },
    cache: { Notes: 'my unsaved local version' },
    records: { Notes: dirty() },
    ids: ['Notes'],
  });

  const result = await reconcileFolder(ports);

  assert.equal(result.conflicts.length, 1, 'the external version must be preserved');
  const conflictId = result.conflicts[0];
  assert.match(conflictId, /^Notes \(Disk conflict /);
  assert.equal(diskFiles.get(conflictId).contents, 'edited in another editor');
  assert.equal(diskFiles.get('Notes').contents, 'my unsaved local version', 'local work wins the original name');
});

it('leaves an item dirty when the flush to disk fails', async () => {
  const { ports } = makeFakes({
    disk: {},
    cache: { Unflushable: 'local work' },
    records: { Unflushable: dirty() },
    ids: ['Unflushable'],
    hooks: { writeThrowsFor: 'Unflushable' },
  });

  const result = await reconcileFolder(ports);

  assert.deepEqual(result.deleted, []);
  assert.equal(ports.records['Unflushable'].dirty, true, 'still dirty, so a later pass retries');
  assert.equal(ports.records['Unflushable'].tombstone, false);
});

it('flushes a dirty item to disk when it is missing there', async () => {
  const { ports, diskFiles } = makeFakes({
    disk: {},
    cache: { 'Never Written': 'local work' },
    records: { 'Never Written': dirty() },
    ids: ['Never Written'],
  });

  await reconcileFolder(ports);

  assert.equal(diskFiles.get('Never Written').contents, 'local work');
  assert.equal(ports.records['Never Written'].dirty, false, 'clean once disk has it');
});

// ── Change-only behaviour (invariant 7) ─────────────────────────────────────

it('reports no change when disk and cache already agree', async () => {
  const { ports } = makeFakes({
    disk: { Settled: { contents: 'same', mtime: 1000 } },
    cache: { Settled: 'same' },
    records: { Settled: clean(1000) },
    ids: ['Settled'],
  });

  const result = await reconcileFolder(ports);

  assert.equal(result.ok, true);
  assert.equal(result.changed, false, 'a steady state must not report a change, or the UI flickers every poll');
});

it('ignores ids that could not survive a filesystem round trip', async () => {
  const { ports } = makeFakes({ disk: { 'bad/name': 'x', '': 'y', good: 'z' } });

  await reconcileFolder(ports);

  assert.deepEqual(ports.ids, ['good']);
});
