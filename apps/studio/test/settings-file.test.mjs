/**
 * `settings.json`: Willow's settings and API keys in one file in the user's folder
 * (`platform/core/src/settings-file.ts`).
 *
 * The engine runs here against an in-memory file and in-memory sections, so what is pinned is the
 * behaviour: which copy wins when a folder is attached, that a hand edit is taken without
 * reverting anything else, that a half-typed file is never written over, and that a key typed in
 * this browser is not lost to a file that never had one.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const engineModule = path.join(repoRoot, 'platform', 'core', 'src', 'settings-file.ts');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const storage = new Map();
beforeEach(() => {
  storage.clear();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
});

const fakeDisk = (text = null, id = 'folder-1') => {
  const disk = {
    id,
    file: text === null ? null : { text, modified: 1 },
    writes: 0,
    async read() {
      return disk.file ? { ...disk.file } : null;
    },
    async write(next) {
      disk.writes += 1;
      disk.file = { text: next, modified: (disk.file?.modified ?? 0) + 1 };
      return disk.file.modified;
    },
    edit(next) {
      disk.file = { text: next, modified: (disk.file?.modified ?? 0) + 1 };
    },
    json() {
      return JSON.parse(disk.file.text);
    },
  };
  return disk;
};

/** A store with listeners, as the nanostores the real sections wrap. */
const store = (initial, extra = {}) => {
  let value = initial;
  const listeners = new Set();
  const section = {
    read: () => value,
    apply: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...extra,
  };
  return {
    section,
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
  };
};

/** The engine, emptied: Node keeps one instance of a module per URL, so state would carry over. */
const fresh = async () => {
  const engine = await importTs(engineModule);
  engine.__resetSettingsFileForTest();
  return engine;
};

const keysMerge = (fromFile, local) => Object.fromEntries(Object.keys({ ...local, ...fromFile }).map((provider) => [
  provider,
  (fromFile?.[provider] ?? '').trim() ? fromFile[provider] : (local?.[provider] ?? ''),
]));

it('writes the file when the folder has none, in section order, indented', async () => {
  const engine = await fresh();
  const theme = store('dark');
  const keys = store({ gemini: 'g-1' });
  engine.registerSettingsSection('appearance', { ...theme.section, order: 40 });
  engine.registerSettingsSection('apiKeys', { ...keys.section, order: 10 });
  const disk = fakeDisk();
  await engine.attachSettingsFile(disk);
  assert.equal(disk.writes, 1);
  assert.deepEqual(Object.keys(disk.json()), ['version', 'apiKeys', 'appearance']);
  assert.deepEqual(disk.json(), { version: 1, apiKeys: { gemini: 'g-1' }, appearance: 'dark' });
  assert.ok(disk.file.text.includes('\n  "apiKeys"'), 'the file is indented for reading by hand');
});

it('meeting a folder for the first time, the file wins, except a key only this browser has', async () => {
  const engine = await fresh();
  const theme = store('dark');
  const keys = store({ gemini: 'local-gemini', openai: 'local-openai' }, { merge: keysMerge });
  engine.registerSettingsSection('theme', theme.section);
  engine.registerSettingsSection('apiKeys', keys.section);
  const disk = fakeDisk(JSON.stringify({ version: 1, theme: 'light', apiKeys: { gemini: 'file-gemini', openai: '' } }));
  await engine.attachSettingsFile(disk);
  assert.equal(theme.get(), 'light');
  assert.deepEqual(keys.get(), { gemini: 'file-gemini', openai: 'local-openai' });
  assert.deepEqual(disk.json().apiKeys, { gemini: 'file-gemini', openai: 'local-openai' },
    'the key the file lacked is written into it');
});

it('a file unchanged since this browser last synced loses to what changed here meanwhile', async () => {
  const first = await fresh();
  const theme = store('dark');
  first.registerSettingsSection('theme', theme.section);
  const disk = fakeDisk();
  await first.attachSettingsFile(disk);
  await first.attachSettingsFile(null);

  // Away from the folder (a web tab with no folder, say), the setting changes.
  const second = await importTs(engineModule);
  const again = store('light');
  second.registerSettingsSection('theme', again.section);
  await second.attachSettingsFile(disk);
  assert.equal(again.get(), 'light');
  assert.equal(disk.json().theme, 'light');
});

it('a file changed since this browser last synced wins', async () => {
  const first = await fresh();
  first.registerSettingsSection('theme', store('dark').section);
  const disk = fakeDisk();
  await first.attachSettingsFile(disk);
  await first.attachSettingsFile(null);
  disk.edit(JSON.stringify({ version: 1, theme: 'system' }));

  const second = await importTs(engineModule);
  const theme = store('light');
  second.registerSettingsSection('theme', theme.section);
  await second.attachSettingsFile(disk);
  assert.equal(theme.get(), 'system');
});

it('takes a hand edit to one section without reverting a change to another', async () => {
  const engine = await fresh();
  const theme = store('dark');
  const labs = store({ ring: false });
  engine.registerSettingsSection('theme', theme.section);
  engine.registerSettingsSection('labs', labs.section);
  const disk = fakeDisk();
  await engine.attachSettingsFile(disk);

  labs.set({ ring: true });
  const edited = disk.json();
  edited.theme = 'light';
  disk.edit(JSON.stringify(edited, null, 2));
  await engine.flushSettingsFile();

  assert.equal(theme.get(), 'light', 'the hand edit was not taken');
  assert.deepEqual(labs.get(), { ring: true }, 'the change made here was reverted by the file');
  assert.deepEqual(disk.json(), { version: 1, theme: 'light', labs: { ring: true } });
});

it('leaves a file that does not parse alone, and takes it once it does', async () => {
  const engine = await fresh();
  const theme = store('dark');
  engine.registerSettingsSection('theme', theme.section);
  const disk = fakeDisk();
  await engine.attachSettingsFile(disk);
  const writes = disk.writes;

  disk.edit('{ "version": 1, "theme": "li');
  await engine.checkSettingsFileNow();
  theme.set('system');
  await engine.flushSettingsFile();
  assert.equal(disk.writes, writes, 'a half-typed file was written over');
  assert.equal(disk.file.text, '{ "version": 1, "theme": "li');

  disk.edit('{ "version": 1, "theme": "light" }');
  await engine.checkSettingsFileNow();
  assert.equal(theme.get(), 'light');
});

it('keeps keys no part of Willow owns, and writes a deleted file again', async () => {
  const engine = await fresh();
  const theme = store('dark');
  engine.registerSettingsSection('theme', theme.section);
  const disk = fakeDisk(JSON.stringify({ version: 1, theme: 'dark', mine: { note: 'kept' } }));
  await engine.attachSettingsFile(disk);
  theme.set('light');
  await engine.flushSettingsFile();
  assert.deepEqual(disk.json(), { version: 1, theme: 'light', mine: { note: 'kept' } });

  disk.file = null;
  await engine.checkSettingsFileNow();
  assert.equal(disk.json().theme, 'light');
});

it('a section registered later takes what the file had for it, or writes its own', async () => {
  const engine = await fresh();
  engine.registerSettingsSection('theme', store('dark').section);
  const disk = fakeDisk(JSON.stringify({ version: 1, theme: 'dark', mcpServers: [{ id: 'a' }] }));
  await engine.attachSettingsFile(disk);

  const servers = store([]);
  engine.registerSettingsSection('mcpServers', servers.section);
  await engine.checkSettingsFileNow();
  assert.deepEqual(servers.get(), [{ id: 'a' }]);

  const voice = store({ liveModel: 'live-1' });
  engine.registerSettingsSection('voice', voice.section);
  await engine.checkSettingsFileNow();
  assert.deepEqual(disk.json().voice, { liveModel: 'live-1' });
});

it('only writes when something changed', async () => {
  const engine = await fresh();
  const theme = store('dark');
  engine.registerSettingsSection('theme', theme.section);
  const disk = fakeDisk(JSON.stringify({ version: 1, theme: 'dark' }));
  await engine.attachSettingsFile(disk);
  assert.equal(disk.writes, 0, 'an attach that changed nothing rewrote the file');
  theme.set('dark');
  await engine.flushSettingsFile();
  assert.equal(disk.writes, 0);
});

it('is attached by the folder layer and registered by the app', () => {
  const context = read('platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx');
  assert.match(context, /attachSettingsFile\(\{\s*id: rootIdRef\.current,/);
  const features = read('apps', 'studio', 'src', 'app', 'register-features.ts');
  assert.match(features, /import '\.\/register-settings-file';/);
  const sections = read('apps', 'studio', 'src', 'app', 'register-settings-file.ts');
  for (const key of ['apiKeys', 'labs', 'voice', 'rail', 'pets', 'customize', 'mcpServers']) {
    assert.match(sections, new RegExp(`registerSettingsSection\\('${key}'`), `${key} is not in settings.json`);
  }
  const bridge = read('apps', 'studio', 'src', 'app', 'SettingsFileBridge.tsx');
  for (const key of ['baseUrls', 'model', 'appearance']) {
    assert.match(bridge, new RegExp(`registerSettingsSection\\('${key}'`), `${key} is not in settings.json`);
  }
});
