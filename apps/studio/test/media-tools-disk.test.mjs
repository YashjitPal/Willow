/**
 * The Tools folder (`Media/Tools/`, features/media/src/tools/tools-disk.ts) driven through the
 * real synced-folder driver, against an in-memory folder that compares names as Windows does and
 * a stand-in for the tools database. What it must never do is lose a tool: not to a rename, a file
 * renamed or copied by hand, an unreadable file, a cleared database, or a name the engine holds a
 * tombstone for.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { MemoryDir, memoryStorage, useStorage } from './memory-fs.mjs';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const disk = await importTs(path.join(ROOT, 'features/media/src/tools/tools-disk.ts'));
const driver = await importTs(path.join(ROOT, 'platform/storage/src/local-fs/synced-folder-driver.ts'));

const SCOPE = 'user::opfs-test-root::Workspace';

/** The tools' own clock, for when each was made and changed. */
let clock = 1_000;

/* ---- The tools database, as @willow/storage/media-tools keeps it -------------------------------- */

const clone = (value) => structuredClone(value);

class ToolsDb {
  constructor() {
    this.tools = new Map();
    this.versions = new Map();
    this.chats = new Map();
    this.storage = new Map();
    this.local = new Map();
    this.state = null;
    this.listeners = new Set();
    this.log = [];
  }
  announce(change) { for (const listener of this.listeners) listener({ scopeId: SCOPE, ...change }); }
  onMediaToolsChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async listTools() { return [...this.tools.values()].map(clone).sort((a, b) => b.updatedAt - a.updatedAt); }
  async listToolVersions(id) { return clone(this.versions.get(id) ?? []); }
  async loadToolChat(id) { return clone(this.chats.get(id) ?? []); }
  async readToolStorage(id) { return { storage: clone(this.storage.get(id) ?? {}), localStorage: clone(this.local.get(id) ?? {}) }; }
  async replaceTool(record) {
    const id = record.tool.id;
    this.tools.set(id, clone(record.tool));
    this.versions.set(id, clone(record.versions));
    this.chats.set(id, clone(record.chat));
    this.storage.set(id, clone(record.storage));
    this.local.set(id, clone(record.localStorage));
    this.log.push(`put back ${id}`);
    this.announce({ toolId: id, what: 'tool', fromDisk: true });
  }
  async deleteTool(id, _scope, options = {}) {
    for (const map of [this.tools, this.versions, this.chats, this.storage, this.local]) map.delete(id);
    this.log.push(`${options.fromDisk ? 'deleted on disk' : 'deleted here'} ${id}`);
    this.announce({ toolId: id, what: 'deleted', ...(options.fromDisk ? { fromDisk: true } : {}) });
  }
  async loadToolsDiskState() { return this.state ? clone(this.state) : null; }
  async saveToolsDiskState(state) { this.state = clone(state); }

  /** A tool made here, as the Tools pages make one. */
  make(id, name, { pending = false, files = [{ path: '/App.tsx', content: `export default () => '${name}';` }], at = clock++ } = {}) {
    const versionId = `v-${id}`;
    this.tools.set(id, {
      id, name, description: `${name}, a tool`, icon: 'https://example.test/icon.png',
      createdAt: at, updatedAt: at, lastOpenedAt: at, versionId, allowRemixing: true,
      ...(pending ? { pending: true } : {}),
    });
    this.versions.set(id, [{ id: versionId, toolId: id, createdAt: at, files, origin: 'create' }]);
    this.chats.set(id, [
      { id: `m1-${id}`, role: 'user', text: `Make ${name}`, createdAt: at },
      { id: `m2-${id}`, role: 'agent', text: 'Done.', createdAt: at + 1, versionId, status: 'done' },
    ]);
    this.storage.set(id, { score: 3, board: { cells: [1, 2] } });
    this.local.set(id, { theme: 'dark' });
    this.announce({ toolId: id, what: 'tool' });
  }
  rename(id, name) {
    this.tools.set(id, { ...this.tools.get(id), name, updatedAt: clock++ });
    this.announce({ toolId: id, what: 'tool' });
  }
}

const setup = ({ db = new ToolsDb(), root = new MemoryDir(), storage = memoryStorage() } = {}) => {
  useStorage(storage);
  const { descriptor } = disk.toolsFolderDescriptor(db, { requestPass: () => {} });
  return { db, root, storage, pass: () => driver.syncRegisteredFolder(root, descriptor, SCOPE) };
};

const folder = async (root) => (await root.getDirectoryHandle('Media')).getDirectoryHandle('Tools');
const fileNames = async (root) => {
  const out = [];
  for await (const entry of (await folder(root)).values()) out.push(entry.name);
  return out.sort();
};
const fileText = async (root, name) => (await (await (await folder(root)).getFileHandle(name)).getFile()).text();
const writeFile = async (root, name, text) => {
  const writable = await (await (await folder(root)).getFileHandle(name, { create: true })).createWritable();
  await writable.write(text);
  await writable.close();
};
const mtimes = async (root) => {
  const out = {};
  for await (const entry of (await folder(root)).values()) out[entry.name] = entry.mtime;
  return out;
};

describe('the Tools folder', () => {
  it('writes each tool of your own as a file named after it, and none for a tool still on its first build', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    db.make('t2', 'Draft', { pending: true });
    const result = await pass();
    assert.equal(result.ok, true);
    assert.deepEqual(await fileNames(root), ['Pixel Sketch.tool.json']);
    const back = disk.parseToolFile(await fileText(root, 'Pixel Sketch.tool.json'));
    assert.equal(back.tool.id, 't1');
    assert.equal(back.tool.name, 'Pixel Sketch');
    assert.equal(back.tool.versionId, 'v-t1');
    assert.equal(back.versions[0].files[0].content, "export default () => 'Pixel Sketch';");
    assert.equal(back.chat.length, 2);
    assert.deepEqual(back.storage, { board: { cells: [1, 2] }, score: 3 });
    assert.deepEqual(back.localStorage, { theme: 'dark' });
    assert.equal(back.tool.lastOpenedAt, undefined, 'opening a tool is not a change worth a write');
  });

  it('writes nothing on a pass where nothing changed', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    await pass();
    const before = await mtimes(root);
    const again = await pass();
    assert.equal(again.ok, true);
    assert.equal(again.changed, false);
    assert.deepEqual(await mtimes(root), before);
  });

  it('moves a tool renamed here to a file of its new name, in one pass', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    await pass();
    db.rename('t1', 'Pixel Paint');
    await pass();
    assert.deepEqual(await fileNames(root), ['Pixel Paint.tool.json']);
    assert.equal(disk.parseToolFile(await fileText(root, 'Pixel Paint.tool.json')).tool.name, 'Pixel Paint');
  });

  it('gives a new browser on the same folder every tool back, whole', async () => {
    const first = setup();
    first.db.make('t1', 'Pixel Sketch');
    await first.pass();

    const fresh = setup({ root: first.root });
    const result = await fresh.pass();
    assert.equal(result.ok, true);
    assert.deepEqual([...fresh.db.tools.keys()], ['t1']);
    assert.deepEqual(fresh.db.versions.get('t1'), first.db.versions.get('t1'));
    assert.deepEqual(fresh.db.chats.get('t1'), first.db.chats.get('t1'));
    assert.deepEqual(fresh.db.storage.get('t1'), first.db.storage.get('t1'));
    assert.deepEqual(fresh.db.local.get('t1'), first.db.local.get('t1'));
    // And then holds still: what it put back reads out as the same file.
    const before = await mtimes(first.root);
    const again = await fresh.pass();
    assert.equal(again.changed, false);
    assert.deepEqual(await mtimes(first.root), before);
  });

  it('deletes a tool whose file was deleted on disk', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    db.make('t2', 'Word Game');
    await pass();
    await (await folder(root)).removeEntry('Word Game.tool.json');
    await pass();
    assert.deepEqual([...db.tools.keys()], ['t1']);
    assert.ok(db.log.includes('deleted on disk t2'));
  });

  it('takes a file put in by hand as it is, so deleting it right after deletes the tool', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    await pass();
    const handMade = JSON.parse(await fileText(root, 'Pixel Sketch.tool.json'));
    handMade.id = 'by-hand';
    handMade.name = 'By hand';
    await writeFile(root, 'By hand.tool.json', JSON.stringify(handMade));
    await pass();
    assert.ok(db.tools.has('by-hand'));
    assert.equal(await fileText(root, 'By hand.tool.json'), JSON.stringify(handMade), 'not rewritten in Willow’s spelling');
    await (await folder(root)).removeEntry('By hand.tool.json');
    await pass();
    assert.deepEqual([...db.tools.keys()], ['t1']);
    assert.deepEqual(await fileNames(root), ['Pixel Sketch.tool.json']);
  });

  it('keeps a tool whose file was renamed by hand, under the file’s new name', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    await pass();
    const text = await fileText(root, 'Pixel Sketch.tool.json');
    await (await folder(root)).removeEntry('Pixel Sketch.tool.json');
    await writeFile(root, 'My sketcher.tool.json', text);
    await pass();
    assert.deepEqual([...db.tools.keys()], ['t1']);
    await pass();
    assert.deepEqual(await fileNames(root), ['My sketcher.tool.json']);
    assert.deepEqual([...db.tools.keys()], ['t1']);
  });

  it('makes a copied file a tool of its own, and keeps the original', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    await pass();
    await writeFile(root, 'Pixel Sketch - Copy.tool.json', await fileText(root, 'Pixel Sketch.tool.json'));
    await pass();
    const ids = [...db.tools.keys()];
    assert.equal(ids.length, 2);
    assert.ok(ids.includes('t1'));
    const copyId = ids.find((id) => id !== 't1');
    await pass();
    assert.equal(disk.parseToolFile(await fileText(root, 'Pixel Sketch - Copy.tool.json')).tool.id, copyId, 'the copy’s file is rewritten under its own id');
    assert.equal(disk.parseToolFile(await fileText(root, 'Pixel Sketch.tool.json')).tool.id, 't1');
  });

  it('leaves a tool whose file was broken by hand, and writes the tool back over it', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    await pass();
    await writeFile(root, 'Pixel Sketch.tool.json', '{ "willowTool": 1, "id": "t1", "versi');
    await pass();
    assert.deepEqual([...db.tools.keys()], ['t1']);
    await pass();
    assert.equal(disk.parseToolFile(await fileText(root, 'Pixel Sketch.tool.json'))?.tool.id, 't1');
  });

  it('reads the folder afresh when the database was cleared and the engine still remembers its files', async () => {
    const first = setup();
    first.db.make('t1', 'Pixel Sketch');
    first.db.make('t2', 'Word Game');
    await first.pass();

    // Same browser, its tools database gone and its localStorage kept: a tool made since is in it.
    const cleared = setup({ root: first.root, storage: first.storage });
    cleared.db.make('t3', 'New One');
    const refused = await cleared.pass();
    assert.equal(refused.ok, false, 'the first pass changes nothing');
    assert.deepEqual(await fileNames(first.root), ['Pixel Sketch.tool.json', 'Word Game.tool.json']);
    await cleared.pass();
    assert.deepEqual([...cleared.db.tools.keys()].sort(), ['t1', 't2', 't3']);
    assert.deepEqual(await fileNames(first.root), ['New One.tool.json', 'Pixel Sketch.tool.json', 'Word Game.tool.json']);
  });

  it('names two tools of one name apart, and never gives a tool a name the engine holds a tombstone for', async () => {
    const { db, root, pass } = setup();
    db.make('a', 'Sketch', { at: 1 });
    db.make('b', 'Sketch', { at: 2 });
    await pass();
    assert.deepEqual(await fileNames(root), ['Sketch (2).tool.json', 'Sketch.tool.json']);
    assert.equal(disk.parseToolFile(await fileText(root, 'Sketch.tool.json')).tool.id, 'a', 'the older keeps the plain name');

    await db.deleteTool('a', SCOPE);
    await pass();
    assert.deepEqual(await fileNames(root), ['Sketch (2).tool.json']);
    db.make('c', 'Sketch');
    await pass();
    assert.deepEqual([...db.tools.keys()].sort(), ['b', 'c'], 'the new tool is not lost to the old one’s tombstone');
    const names = await fileNames(root);
    assert.equal(names.length, 2);
    assert.ok(!names.includes('Sketch.tool.json'));
    const ids = await Promise.all(names.map(async (name) => disk.parseToolFile(await fileText(root, name)).tool.id));
    assert.deepEqual(ids.sort(), ['b', 'c']);
  });

  it('reads nothing but its own files: a project manifest beside them is left alone', async () => {
    const { db, root, pass } = setup();
    db.make('t1', 'Pixel Sketch');
    await pass();
    await writeFile(root, '.willow.json', '{ "id": "#project" }');
    await writeFile(root, 'notes.json', '{}');
    await pass();
    await pass();
    assert.deepEqual(await fileNames(root), ['.willow.json', 'Pixel Sketch.tool.json', 'notes.json']);
    assert.deepEqual([...db.tools.keys()], ['t1']);
  });

  it('takes nothing on trust from a file', () => {
    assert.equal(disk.parseToolFile('not json'), null);
    assert.equal(disk.parseToolFile(JSON.stringify({ willowTool: 1, id: 'x', versions: [] })), null, 'no version, no tool');
    const record = disk.parseToolFile(JSON.stringify({
      willowTool: 1,
      id: 'x',
      name: 7,
      versionId: 'missing',
      versions: [{ id: 'v1', files: [{ path: '/App.tsx', content: 'a' }, { path: 3 }], origin: 'bogus' }],
      chat: [{ id: 'm', role: 'agent', text: 'hi', status: 'weird', feedback: 'up' }, { id: 'n', role: 'robot', text: 'no' }],
      storage: [1, 2],
      localStorage: { ok: 'yes', bad: 4 },
    }));
    assert.equal(record.tool.name, '');
    assert.equal(record.tool.versionId, 'v1', 'an unknown current version falls back to the newest');
    assert.deepEqual(record.versions[0].files, [{ path: '/App.tsx', content: 'a' }]);
    assert.equal(record.versions[0].origin, 'import');
    assert.deepEqual(record.chat, [{ id: 'm', role: 'agent', text: 'hi', feedback: 'up', createdAt: 0 }]);
    assert.deepEqual(record.storage, {});
    assert.deepEqual(record.localStorage, { ok: 'yes' });
  });
});
