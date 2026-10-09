/**
 * What a new copy of Willow on the user's folder — a reinstall, a fresh profile — finds there that it
 * used to start without: the pinned chats (`settings.json`'s `pinnedChats`) and the Labs companion's
 * conversation (`Labs/Companion/history.json`). The companion's runs through the real synced-folder
 * driver with its real registration, against an in-memory folder.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';
import { MemoryDir, fileNames, fileText, memoryStorage, useStorage, writeFile } from './memory-fs.mjs';
import { importTs } from './ts-module.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const SCOPE = 'user::opfs-test-root::Workspace';
const HISTORY_KEY = 'willow:waifu:history';

useStorage(memoryStorage());
const events = [];
globalThis.dispatchEvent = (event) => { events.push(event); return true; };

let bundleDir = '';
let m;
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-folder-gaps-'));
  const outfile = path.join(bundleDir, 'companion.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'folder-gaps-entry.ts',
      loader: 'ts',
      contents: `
        export { getSyncedFolders, syncRegisteredFolder } from '@willow/storage/local-sync';
        import './src/waifu/register-companion-history';
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

beforeEach(() => {
  useStorage(memoryStorage());
  events.length = 0;
});

const greeting = { id: 'welcome', role: 'assistant', text: 'Hi!', emotion: 'happy', timestamp: 1 };
const conversation = (words) => [
  greeting,
  { id: 'msg-1', role: 'user', text: words, timestamp: 2 },
  { id: 'msg-2', role: 'assistant', text: `You said: ${words}`, emotion: 'happy', timestamp: 3 },
];
const descriptor = () => m.getSyncedFolders().find((folder) => folder.id === 'companion-history');
const pass = (root) => m.syncRegisteredFolder(root, descriptor(), SCOPE);
const holdHere = (history) => globalThis.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
const heldHere = () => JSON.parse(globalThis.localStorage.getItem(HISTORY_KEY));
const onDisk = async (root) => JSON.parse(await fileText(root, ['Labs', 'Companion'], 'history.json'));

describe('the companion\'s conversation in the folder', () => {
  it('is taken from the folder by a browser starting over, and nothing is written over it', async () => {
    const root = new MemoryDir();
    await writeFile(root, ['Labs', 'Companion'], 'history.json', JSON.stringify(conversation('remember me'), null, 2));
    holdHere([greeting]);
    await pass(root);
    await pass(root);
    assert.deepEqual(heldHere().map((message) => message.text), ['Hi!', 'remember me', 'You said: remember me']);
    assert.ok(events.some((event) => event.detail?.[1]?.text === 'remember me'), 'the open companion is told');
    assert.deepEqual((await onDisk(root)).map((message) => message.id), ['welcome', 'msg-1', 'msg-2']);
    assert.ok(![...root.entries.keys()].includes('Recycle Bin'), 'nothing was set aside');
  });

  it('writes nothing for the greeting alone', async () => {
    const root = new MemoryDir();
    holdHere([greeting]);
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Labs', 'Companion'), []);
  });

  it('writes a conversation, lets the file go when it is cleared, and writes the next one again', async () => {
    const root = new MemoryDir();
    holdHere(conversation('first'));
    await pass(root);
    assert.equal((await onDisk(root))[1].text, 'first');

    holdHere([{ ...greeting, id: 'welcome-2' }]);
    await pass(root);
    assert.deepEqual(await fileNames(root, 'Labs', 'Companion'), [], 'cleared here, the file goes (to the Recycle Bin)');

    holdHere(conversation('second'));
    await pass(root);
    assert.equal((await onDisk(root))[1].text, 'second', 'a conversation after a clear is written again');
  });
});

describe('the companion keeps its conversation', () => {
  it('in this browser, from where the folder takes it', () => {
    const store = read('apps', 'studio', 'src', 'waifu', 'waifu-store.ts');
    assert.match(store, /const savedHistory = readCompanionHistory\(\)/);
    assert.match(store, /waifuHistoryStore\.listen\(\(history\) => \{[\s\S]*?localStorage\.setItem\(COMPANION_HISTORY_KEY, JSON\.stringify\(history\.slice\(-COMPANION_HISTORY_LIMIT\)\)\)/);
    assert.match(store, /window\.addEventListener\(COMPANION_HISTORY_EVENT,/);
    assert.match(read('apps', 'studio', 'src', 'app', 'register-features.ts'), /import '\.\.\/waifu\/register-companion-history';/);
  });
});

describe('the pinned chats', () => {
  it('read a scope with no list as none, and tell this tab when one is written', async () => {
    const actions = await importTs(path.join(repoRoot, 'apps', 'studio', 'src', 'shell', 'chat-actions.ts'));
    assert.equal(actions.readPinnedChats('scope-a'), null);
    actions.writePinnedChats('scope-a', ['Trip plans', 'Budget']);
    assert.deepEqual(actions.readPinnedChats('scope-a'), ['Trip plans', 'Budget']);
    assert.equal(globalThis.localStorage.getItem(actions.pinnedChatsStorageKey('scope-a')), '["Trip plans","Budget"]');
    const told = events.find((event) => event.type === actions.PINNED_CHATS_CHANGED_EVENT);
    assert.equal(told?.detail?.chatScopeId, 'scope-a');
    globalThis.localStorage.setItem(actions.pinnedChatsStorageKey('scope-b'), 'not json');
    assert.deepEqual(actions.readPinnedChats('scope-b'), [], 'a corrupt list reads as none');
  });

  it('are kept in settings.json, and the sidebar hears what the file sets', () => {
    const section = read('apps', 'studio', 'src', 'app', 'PinnedChatsSettingsSection.tsx');
    assert.match(section, /registerSettingsSection\('pinnedChats', \{\s*order: 75,/);
    assert.match(section, /read: \(\) => readPinnedChats\(scope\.current\) \?\? undefined,/,
      'a scope that never pinned anything must not empty the file\'s list');
    assert.match(section, /return \[\.\.\.file, \.\.\.pins\(local\)\.filter\(\(chat\) => !file\.includes\(chat\)\)\];/);
    const app = read('apps', 'studio', 'src', 'app', 'App.tsx');
    const provider = app.slice(app.indexOf('<LocalFSProvider modelConfig={modelConfig}>'), app.indexOf('</LocalFSProvider>'));
    assert.match(provider, /<PinnedChatsSettingsSection \/>/, 'the section needs the folder\'s chat scope');
    const sidebar = read('apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.tsx');
    assert.doesNotMatch(sidebar, /localStorage\.setItem\(pinnedChatsKey/, 'a write the file would not hear');
    assert.equal((sidebar.match(/writePinnedChats\(chatScopeId, next\);/g) ?? []).length, 3);
    assert.match(sidebar, /window\.addEventListener\(PINNED_CHATS_CHANGED_EVENT, onChanged\);/);
  });
});
