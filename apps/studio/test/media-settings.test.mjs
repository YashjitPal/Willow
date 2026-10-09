/**
 * Media's part of `settings.json` (`features/media/src/media-settings.ts`): the agent's standing
 * instructions and its ask-before-generating switch, the default model picks, the View menu and the
 * Tools favourites, pins and recents. The section runs in the real engine
 * (`platform/core/src/settings-file.ts`) against an in-memory file and in-memory stores. What these
 * pin is that a browser starting over takes the folder's settings and writes nothing over them, that
 * one with settings of its own keeps them beside the file's (even before its Tools preferences have
 * been read from IndexedDB), and that signing in to an account with none does not empty the file.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const SCOPE = 'user-1::folder-1::My Willow';

const storage = new Map();
beforeEach(() => {
  storage.clear();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
});

let engine;
let media;
before(async () => {
  engine = await importTs(path.join(repoRoot, 'platform', 'core', 'src', 'settings-file.ts'));
  media = await importTs(path.join(repoRoot, 'features', 'media', 'src', 'media-settings.ts'));
});
beforeEach(() => engine.__resetSettingsFileForTest());

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await tick();
  await engine.flushSettingsFile();
};

const fakeDisk = (body) => {
  const disk = {
    id: 'folder-1',
    file: body ? { text: `${JSON.stringify(body, null, 2)}\n`, modified: 1 } : null,
    writes: 0,
    async read() { return disk.file ? { ...disk.file } : null; },
    async write(text) {
      disk.writes += 1;
      disk.file = { text, modified: (disk.file?.modified ?? 0) + 1 };
      return disk.file.modified;
    },
    edit(next) { disk.file = { text: `${JSON.stringify(next, null, 2)}\n`, modified: disk.file.modified + 1 }; },
    json() { return JSON.parse(disk.file.text); },
  };
  return disk;
};

const instruction = (id, content) => ({ id, title: id, isActive: true, content });
const VIEW = { viewMode: 'batch', gridSize: 'L', soundOnHover: true, silentVideos: false, tileDetails: true, clearPromptOnSubmit: false };
const FILE_MEDIA = {
  agent: { confirmBeforeGenerating: true, instructions: [instruction('i1', 'Keep it short')] },
  models: { image: 'imagen-from-file' },
  view: VIEW,
  tools: { favorites: ['t1'], pins: ['t2'], recent: ['t3'] },
};

/** The stores the section reads and writes, in memory; `holdTools` keeps the Tools preferences from being read until released. */
const fakeStores = ({ agent = {}, models = {}, view = null, tools = {}, holdTools = false } = {}) => {
  let scope = SCOPE;
  let release = () => {};
  const held = holdTools ? new Promise((resolve) => { release = resolve; }) : null;
  const data = { agent: { ...agent }, models: { ...models }, view, tools: structuredClone(tools), remembered: {} };
  const sets = { agent: new Set(), models: new Set(), view: new Set(), tools: new Set(), scope: new Set() };
  const subscribe = (set) => (listener) => { set.add(listener); return () => set.delete(listener); };
  const notify = (set, ...args) => [...set].forEach((listener) => listener(...args));
  const stores = {
    scope: () => scope,
    onScopeChange: subscribe(sets.scope),
    agent: { read: (s) => data.agent[s] ?? null, write: (s, value) => { data.agent[s] = value; notify(sets.agent); }, subscribe: subscribe(sets.agent) },
    models: { read: (s) => data.models[s] ?? null, write: (s, value) => { data.models[s] = value; notify(sets.models); }, subscribe: subscribe(sets.models) },
    view: { read: () => data.view, write: (value) => { data.view = value; notify(sets.view); }, subscribe: subscribe(sets.view) },
    tools: {
      load: async (s) => {
        if (held) await held;
        return data.tools[s] ? structuredClone(data.tools[s]) : null;
      },
      save: async (s, settings) => {
        data.tools[s] = { favorites: [], pins: [], ...data.tools[s], ...settings };
        notify(sets.tools, s);
      },
      subscribe: subscribe(sets.tools),
    },
    remembered: {
      read: (folder) => data.remembered[folder] ?? null,
      write: (folder, value) => { data.remembered[folder] = structuredClone(value); },
    },
  };
  const signIn = (next) => {
    const previous = scope;
    scope = next;
    notify(sets.scope, next, previous);
  };
  return { stores, data, release: () => release(), signIn };
};

describe('Media\'s settings in settings.json', () => {
  it('a browser starting over takes the folder\'s, and writes nothing over them', async () => {
    const { stores, data } = fakeStores();
    engine.registerSettingsSection('media', media.mediaSettingsSection(stores));
    await tick();
    const disk = fakeDisk({ version: 1, media: FILE_MEDIA });
    await engine.attachSettingsFile(disk);
    await settle();
    assert.deepEqual(data.agent[SCOPE], FILE_MEDIA.agent);
    assert.deepEqual(data.models[SCOPE], FILE_MEDIA.models);
    assert.deepEqual(data.view, VIEW);
    assert.deepEqual(data.tools[SCOPE], { favorites: ['t1'], pins: ['t2'], recent: ['t3'] });
    assert.equal(disk.writes, 0, 'the file was written over');
  });

  it('keeps this browser\'s own beside the file\'s the first time they meet, though its Tools preferences are still being read', async () => {
    const { stores, data, release } = fakeStores({
      agent: { [SCOPE]: { confirmBeforeGenerating: false, instructions: [instruction('i2', 'Use warm colours')] } },
      models: { [SCOPE]: { video: 'veo-chosen-here' } },
      tools: { [SCOPE]: { favorites: ['t9'], pins: [], recent: ['t8'], dockOpen: true } },
      holdTools: true,
    });
    engine.registerSettingsSection('media', media.mediaSettingsSection(stores));
    const disk = fakeDisk({ version: 1, media: FILE_MEDIA });
    await engine.attachSettingsFile(disk);
    release();
    await settle();
    const written = disk.json().media;
    assert.deepEqual(written.agent.instructions.map((i) => i.id), ['i1', 'i2']);
    assert.equal(written.agent.confirmBeforeGenerating, true, 'the file\'s switch wins');
    assert.deepEqual(written.models, { image: 'imagen-from-file', video: 'veo-chosen-here' });
    assert.deepEqual(written.tools, { favorites: ['t1', 't9'], pins: ['t2'], recent: ['t3', 't8'] });
    assert.deepEqual(data.tools[SCOPE].favorites, ['t1', 't9']);
    assert.equal(data.tools[SCOPE].dockOpen, true, 'what the file does not hold is kept');
    assert.deepEqual(data.agent[SCOPE].instructions.map((i) => i.id), ['i1', 'i2']);
  });

  it('leaves the file\'s value as it is while it cannot say all of its own', async () => {
    const { stores, release } = fakeStores({ agent: { [SCOPE]: { confirmBeforeGenerating: false, instructions: [] } }, holdTools: true });
    engine.registerSettingsSection('media', media.mediaSettingsSection(stores));
    const disk = fakeDisk({ version: 1, other: { kept: true } });
    await engine.attachSettingsFile(disk);
    assert.equal(disk.json().media, undefined, 'a value without the Tools part was written');
    release();
    await settle();
    assert.deepEqual(disk.json().media.agent, { confirmBeforeGenerating: false, instructions: [] });
    assert.deepEqual(disk.json().other, { kept: true });
  });

  it('starts an account new to the folder from the file\'s, rather than emptying it', async () => {
    const { stores, data, signIn } = fakeStores();
    engine.registerSettingsSection('media', media.mediaSettingsSection(stores));
    await tick();
    const disk = fakeDisk({ version: 1, media: FILE_MEDIA });
    await engine.attachSettingsFile(disk);
    await settle();
    const other = 'user-2::folder-1::My Willow';
    signIn(other);
    await settle();
    assert.deepEqual(data.agent[other], FILE_MEDIA.agent);
    assert.deepEqual(data.models[other], FILE_MEDIA.models);
    assert.deepEqual(data.tools[other], { favorites: ['t1'], pins: ['t2'], recent: ['t3'] });
    assert.deepEqual(disk.json().media, FILE_MEDIA);
    assert.equal(disk.writes, 0);
  });

  it('takes a hand edit to the file as it is: a favourite taken out stays out', async () => {
    const { stores, data } = fakeStores();
    engine.registerSettingsSection('media', media.mediaSettingsSection(stores));
    await tick();
    const disk = fakeDisk({ version: 1, media: FILE_MEDIA });
    await engine.attachSettingsFile(disk);
    await settle();
    disk.edit({ version: 1, media: { ...FILE_MEDIA, tools: { favorites: [], pins: ['t2'], recent: ['t3'] } } });
    await engine.checkSettingsFileNow();
    await settle();
    assert.deepEqual(data.tools[SCOPE].favorites, []);
    assert.deepEqual(disk.json().media.tools.favorites, []);
  });

  it('writes a change made here', async () => {
    const { stores } = fakeStores();
    engine.registerSettingsSection('media', media.mediaSettingsSection(stores));
    await tick();
    const disk = fakeDisk({ version: 1, media: FILE_MEDIA });
    await engine.attachSettingsFile(disk);
    await settle();
    stores.models.write(SCOPE, { image: 'imagen-from-file', music: 'lyria-picked' });
    await settle();
    assert.deepEqual(disk.json().media.models, { image: 'imagen-from-file', music: 'lyria-picked' });
  });

  it('narrows what the user typed', () => {
    assert.deepEqual(media.narrowMediaSettings({
      agent: 'loud',
      models: { image: 5, video: 'veo' },
      view: { viewMode: 'sideways', gridSize: 'XL' },
      tools: { favorites: ['a', 'a', 3], pins: 'b' },
    }), {
      models: { video: 'veo' },
      view: { viewMode: 'grid', gridSize: 'M', soundOnHover: false, silentVideos: false, tileDetails: true, clearPromptOnSubmit: true },
      tools: { favorites: ['a'], pins: [] },
    });
    assert.deepEqual(media.narrowMediaSettings('nothing'), {});
  });
});
