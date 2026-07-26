import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeDriveProjectsIntoRegistry } from './driveProjectDiscovery.ts';

test('Drive-only projects receive a stable reopen id and code kind', () => {
  const result = mergeDriveProjectsIntoRegistry([], [{ id: 'folder-123', name: 'Remote App' }]);
  assert.deepEqual(result, {
    changed: true,
    projects: [{
      id: 'drive_folder-123', name: 'Remote App', kind: 'code',
      driveFolderId: 'folder-123', onDrive: true,
    }],
  });
});

test('an existing local code project is linked by name instead of duplicated', () => {
  const result = mergeDriveProjectsIntoRegistry(
    [{ id: '#1234', name: 'Remote App', kind: 'code' }],
    [{ id: 'folder-123', name: 'remote app' }],
  );
  assert.equal(result.projects.length, 1);
  assert.deepEqual(result.projects[0], {
    id: '#1234', name: 'Remote App', kind: 'code', driveFolderId: 'folder-123', onDrive: true,
  });
});

test('Drive discovery never removes projects when a later listing is empty', () => {
  const registry = [{ id: 'drive_folder-123', name: 'Remote App', kind: 'code' as const, driveFolderId: 'folder-123', onDrive: true }];
  assert.deepEqual(mergeDriveProjectsIntoRegistry(registry, []), { projects: registry, changed: false });
});

test('a local deletion tombstone prevents Drive from immediately resurrecting a project', () => {
  const result = mergeDriveProjectsIntoRegistry(
    [],
    [{ id: 'folder-123', name: 'Deleted App' }],
    (name) => name === 'Deleted App',
  );
  assert.deepEqual(result, { projects: [], changed: false });
});
