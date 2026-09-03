/**
 * Regression tests: renaming a project.
 *
 * The bug pinned here is one word. `renameLocalFSProject` answered `false` for
 * "this project has no folder in any project area", and
 * `transactionalRenameProject` reads `false` as a failed disk move and rolls the
 * whole rename back. A Media project has no folder until its first generated
 * file lands, so renaming an untouched one committed nothing: the new name
 * appeared in the input and was replaced by the old one immediately.
 *
 * The boolean means "disk agrees with the new name", not "a folder moved". A
 * project with nothing on disk satisfies that vacuously, and the reconciler
 * leaves its registry row alone precisely because `onDisk` is false — so the
 * registry rename is safe to keep on its own.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const renameModule = path.join(repoRoot, 'platform', 'projects', 'src', 'rename.ts');
const LOCAL_FS = () => fs.readFileSync(
  path.join(repoRoot, 'platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx'),
  'utf8',
);

/** The registry reads localStorage at import time; the notifier wants `window`. */
const withBrowserGlobals = async (run) => {
  const hadStorage = 'localStorage' in globalThis;
  const hadWindow = 'window' in globalThis;
  const previousStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const cells = new Map();
  globalThis.localStorage = {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => { cells.set(key, String(value)); },
    removeItem: (key) => { cells.delete(key); },
    clear: () => cells.clear(),
    key: (index) => [...cells.keys()][index] ?? null,
    get length() { return cells.size; },
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  try {
    return await run();
  } finally {
    if (hadStorage) globalThis.localStorage = previousStorage;
    else delete globalThis.localStorage;
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
};

/**
 * Every dependency is injected, so the real registry and IndexedDB are imported
 * but never called — the subject here is the decision, not the storage.
 */
const harness = (projects, diskAnswer) => {
  const state = { projects: projects.map((project) => ({ ...project })), notified: 0, diskCalls: [] };
  return {
    state,
    options: {
      isLocalFolderConnected: true,
      renameLocalFSProject: async (oldName, newName) => {
        state.diskCalls.push(`${oldName} -> ${newName}`);
        return typeof diskAnswer === 'function' ? diskAnswer(oldName, newName) : diskAnswer;
      },
      dependencies: {
        readRegistry: () => state.projects.map((project) => ({ ...project })),
        writeRegistry: (next) => { state.projects = next.map((project) => ({ ...project })); },
        renameSessions: async () => true,
        notifyRegistryUpdated: () => { state.notified += 1; },
      },
    },
  };
};

it('commits a rename for a project that has never been written to disk', async () => {
  await withBrowserGlobals(async () => {
    const { transactionalRenameProject } = await importTs(renameModule);
    // `true` is what the disk layer now answers when the project has no folder
    // in Code/, Media/ or Design/ — the state of a Media project with no
    // generated files yet.
    const { state, options } = harness([{ id: 'p1', name: 'Aug 12, 03.15 PM', kind: 'media' }], true);

    const result = await transactionalRenameProject({ ...options, projectId: 'p1', rawName: 'My Film' });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.changed, true, 'the rename reported no change');
    assert.equal(state.projects[0].name, 'My Film',
      'the registry kept the old name, so the UI would snap back to it');
    assert.equal(state.notified, 1, 'the surfaces were never told to re-read the registry');
  });
});

it('rolls back when a folder exists on disk and cannot be moved', async () => {
  await withBrowserGlobals(async () => {
    const { transactionalRenameProject } = await importTs(renameModule);
    const { state, options } = harness([{ id: 'p1', name: 'Reel', kind: 'media', onDisk: true }], false);

    const result = await transactionalRenameProject({ ...options, projectId: 'p1', rawName: 'Reel Two' });

    assert.equal(result.ok, false, 'a stuck folder must not commit a registry name the disk disagrees with');
    assert.match(result.error ?? '', /local project folder/);
    assert.equal(state.projects[0].name, 'Reel', 'the registry was committed despite the disk failing');
    assert.equal(state.notified, 0);
    // Nothing moved, so there is nothing to move back.
    assert.deepEqual(state.diskCalls, ['Reel -> Reel Two']);
  });
});

it('reverses the disk move when a later step fails', async () => {
  await withBrowserGlobals(async () => {
    const { transactionalRenameProject } = await importTs(renameModule);
    const { state, options } = harness([{ id: 'p1', name: 'Reel', kind: 'media', onDisk: true }], true);
    options.dependencies.renameSessions = async () => false;

    const result = await transactionalRenameProject({ ...options, projectId: 'p1', rawName: 'Reel Two' });

    assert.equal(result.ok, false);
    assert.equal(result.rolledBack, true, 'the folder was left on disk under the uncommitted name');
    assert.deepEqual(state.diskCalls, ['Reel -> Reel Two', 'Reel Two -> Reel'],
      'the compensating rename is missing or in the wrong direction');
    assert.equal(state.projects[0].name, 'Reel');
  });
});

it('treats an absent project folder as nothing to move, not as a failure', () => {
  const source = LOCAL_FS();
  const start = source.indexOf('const renameLocalFSProjectInner');
  assert.ok(start > 0, 'renameLocalFSProjectInner was renamed or moved');
  const body = source.slice(start, source.indexOf('const saveLocalFSMedia', start));

  // Both "nothing on disk" exits. Either one flipped back to `false` puts the
  // reverting rename back for every browser-only project.
  assert.match(body, /if \(sourceParents\.length === 0\) return true;/,
    'a project with no folder in any area reports a failed disk rename again');
  assert.match(body, /if \(!workspaceDir\) return true;/,
    'a root with no workspace folder yet reports a failed disk rename again');

  // The genuine failure must still be a failure, or a folder that could not be
  // moved would commit a registry name the disk-authoritative reconciler then
  // reverts on the next poll.
  assert.match(body, /if \(renameFailed \|\| completedParents\.length !== sourceParents\.length\) \{/,
    'the partial-move rollback is gone');
});
