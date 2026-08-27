import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  getProjectAreaFolder,
  getProjectAreas,
  isValidItemId,
  registerProjectArea,
  registerProjectFolderWriter,
  registerSyncedFolder,
  getSyncedFolders,
  reconcileFolder,
  syncRegisteredFolder,
  syncedFolderKeys,
} from '../dist/index.js';

class MemoryDirectory {
  constructor() {
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) {
      if (!create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      this.directories.set(name, new MemoryDirectory());
    }
    return this.directories.get(name);
  }

  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      this.files.set(name, { contents: '', mtime: Date.now() });
    }
    const entry = this.files.get(name);
    return {
      async getFile() {
        return { lastModified: entry.mtime, async text() { return entry.contents; } };
      },
      async createWritable() {
        return {
          async write(contents) { entry.contents = contents; entry.mtime = Date.now(); },
          async close() {},
          async abort() {},
        };
      },
    };
  }

  async removeEntry(name) {
    if (!this.files.delete(name)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
  }

  async *values() {
    for (const [name, entry] of this.files) {
      yield {
        kind: 'file',
        name,
        async getFile() { return { lastModified: entry.mtime, async text() { return entry.contents; } }; },
      };
    }
  }
}

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

const cleanRecord = (mtime = 1000) => ({
  revision: 1, diskRevision: 1, diskMtime: mtime,
  dirty: false, tombstone: false, updatedAt: 1,
});

const dirtyRecord = () => ({
  revision: 2, diskRevision: 1, diskMtime: 1000,
  dirty: true, tombstone: false, updatedAt: 2,
});

const enginePorts = ({ disk = {}, cache = {}, records = {}, ids = [], hooks = {} } = {}) => {
  const diskFiles = new Map(Object.entries(disk).map(([id, value]) => [
    id,
    typeof value === 'string' ? { contents: value, mtime: 1000 } : value,
  ]));
  const cacheFiles = new Map(Object.entries(cache));
  const ports = {
    records: structuredClone(records),
    ids: [...ids],
    timestamps: {},
    async list() {
      if (hooks.listThrows) throw new Error('scan failed');
      return [...diskFiles].map(([id, value]) => ({
        id, mtime: value.mtime, async read() { return diskFiles.get(id).contents; },
      }));
    },
    async statNow(id) {
      hooks.beforeStat?.(id, diskFiles);
      return diskFiles.has(id) ? 'present' : 'absent';
    },
    async write(id, contents) {
      if (hooks.writeThrowsFor === id) throw new Error('write failed');
      diskFiles.set(id, { contents, mtime: 2000 });
      return { mtime: 2000 };
    },
    async remove(id) { diskFiles.delete(id); },
    async readCache(id) { return hooks.cacheUnreadableFor === id ? null : cacheFiles.get(id) ?? null; },
    async writeCache(id, contents) { cacheFiles.set(id, contents); },
    async deleteCache(id) { cacheFiles.delete(id); },
    async lock(_ids, operation) { return operation(); },
    nextRevision(id) { return (ports.records[id]?.revision ?? 0) + 1; },
  };
  return { ports, diskFiles };
};

it('registers built-in and extension project areas safely', () => {
  registerProjectArea({ id: 'contract-design', folder: 'ContractDesign', kind: 'design', priority: 10 });
  registerProjectArea({ id: 'contract-future', folder: 'ContractFuture', kind: 'future', priority: 40 });
  assert.deepEqual(getProjectAreas().map((area) => area.id), ['contract-future', 'contract-design']);
  assert.equal(getProjectAreaFolder('contract-design'), 'ContractDesign');
});

it('rejects unsafe area paths and duplicate synced-folder ownership', () => {
  assert.throws(() => registerProjectArea({ id: 'bad', folder: 'Design/Nodes', kind: 'bad' }));
  const descriptor = { folder: 'ContractNotes', extension: '.json', readLocal: async () => [], applyRemote: async () => {} };
  registerSyncedFolder('contract-notes', descriptor);
  assert.throws(() => registerSyncedFolder('contract-other', { ...descriptor }), /already owned/);
  assert.ok(getSyncedFolders().some((folder) => folder.id === 'contract-notes'));
});

it('rejects unsafe or duplicate project-folder writer ownership', () => {
  registerProjectFolderWriter('contract-writer', { folder: 'Metadata', async write() {} });
  assert.throws(
    () => registerProjectFolderWriter('contract-writer-other', { folder: 'metadata', async write() {} }),
    /already owned/,
  );
  assert.throws(
    () => registerProjectFolderWriter('contract-writer-unsafe', { folder: '../Outside', async write() {} }),
    /safe relative path/,
  );
});

it('keeps filesystem item ids safe', () => {
  assert.equal(isValidItemId('notes-1'), true);
  assert.equal(isValidItemId('bad/name'), false);
  assert.equal(isValidItemId(''), false);
});

it('does not turn a failed local read into tombstones', async () => {
  const root = new MemoryDirectory();
  const descriptor = {
    folder: 'ContractReadFailure',
    extension: '.json',
    async readLocal() { throw new Error('temporary state failure'); },
    async applyRemote() { throw new Error('must not run'); },
  };
  const result = await syncRegisteredFolder(root, descriptor, 'contract-read-failure');
  assert.equal(result.ok, false);
  assert.equal(storage.size, 0);
});

it('does not commit sync metadata when applying remote state fails', async () => {
  storage.clear();
  const root = new MemoryDirectory();
  const folder = await root.getDirectoryHandle('ContractApplyFailure', { create: true });
  const file = await folder.getFileHandle('note.json', { create: true });
  const writer = await file.createWritable();
  await writer.write('from disk');
  await writer.close();
  const descriptor = {
    folder: 'ContractApplyFailure',
    extension: '.json',
    async readLocal() { return []; },
    async applyRemote() { throw new Error('temporary state failure'); },
  };
  const result = await syncRegisteredFolder(root, descriptor, 'contract-apply-failure');
  assert.equal(result.ok, false);
  const keys = syncedFolderKeys(descriptor.folder, 'contract-apply-failure');
  assert.equal(storage.has(keys.ids), false);
  assert.equal(storage.has(keys.sync), false);
});

it('makes no deletion decisions after a failed directory scan', async () => {
  const { ports } = enginePorts({
    cache: { note: 'local' }, records: { note: cleanRecord() }, ids: ['note'],
    hooks: { listThrows: true },
  });
  const result = await reconcileFolder(ports);
  assert.equal(result.ok, false);
  assert.deepEqual(ports.ids, ['note']);
  assert.equal(ports.records.note.tombstone, false);
});

it('rechecks stale listings before deleting an item', async () => {
  const { ports } = enginePorts({
    cache: { note: 'local' }, records: { note: cleanRecord() }, ids: ['note'],
    hooks: { beforeStat(id, disk) { disk.set(id, { contents: 'local', mtime: 1000 }); } },
  });
  const result = await reconcileFolder(ports);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(ports.ids, ['note']);
});

it('keeps dirty data retryable when cache or disk is unavailable', async () => {
  const unreadable = enginePorts({
    records: { note: dirtyRecord() }, ids: ['note'], hooks: { cacheUnreadableFor: 'note' },
  });
  await reconcileFolder(unreadable.ports);
  assert.equal(unreadable.ports.records.note.dirty, true);
  assert.equal(unreadable.ports.records.note.tombstone, false);

  const unwritable = enginePorts({
    cache: { note: 'local' }, records: { note: dirtyRecord() }, ids: ['note'],
    hooks: { writeThrowsFor: 'note' },
  });
  await reconcileFolder(unwritable.ports);
  assert.equal(unwritable.ports.records.note.dirty, true);
});

it('preserves external edits as conflict copies', async () => {
  const { ports, diskFiles } = enginePorts({
    disk: { note: { contents: 'external', mtime: 5000 } },
    cache: { note: 'local' }, records: { note: dirtyRecord() }, ids: ['note'],
  });
  const result = await reconcileFolder(ports);
  assert.equal(result.conflicts.length, 1);
  assert.equal(diskFiles.get(result.conflicts[0]).contents, 'external');
  assert.equal(diskFiles.get('note').contents, 'local');
});
