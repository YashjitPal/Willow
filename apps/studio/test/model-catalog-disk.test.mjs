/**
 * The model list in the workspace's `Models/catalog.json`, driven through the real synced-folder driver with the real
 * registration (apps/studio/src/app/register-model-catalog.ts), against an in-memory folder. What these pin is that a
 * browser starting over — Willow's own storage cleared, a reinstall — takes the folder's list, rather than writing the
 * models Willow starts with over it and moving the user's to the Recycle Bin as a conflict copy.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';
import { MemoryDir, fileNames, fileText, memoryStorage, useStorage, writeFile } from './memory-fs.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const SCOPE = 'user::opfs-test-root::Workspace';

useStorage(memoryStorage());
const events = [];
globalThis.dispatchEvent = (event) => { events.push(event); return true; };

let bundleDir = '';
let m;
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-model-catalog-disk-'));
  const outfile = path.join(bundleDir, 'model-catalog.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'model-catalog-disk-entry.ts',
      loader: 'ts',
      contents: `
        export { getSyncedFolders, syncRegisteredFolder } from '@willow/storage/local-sync';
        import './src/app/register-model-catalog';
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

const empty = { savedModels: [] };
/** What App stores on a browser's first render: `DEFAULT_MODEL_CONFIG`'s models. */
const shipped = (extra = []) => ({
  gemini: {
    model: 'gemini-3.8-flash',
    savedModels: [
      { id: 'default-flash-38', name: 'Gemini 3.8 Flash', thinkingLevel: 3, thinkingLabel: 'High', modelId: 'gemini-3.8-flash' },
      { id: 'default-flash-35-lite', name: 'Gemini 3.5 Flash Lite', thinkingLevel: 1, thinkingLabel: 'Low', modelId: 'gemini-3.5-flash-lite' },
      { id: 'default-pro-high', name: 'Gemini 3.1 Pro', thinkingLevel: 3, thinkingLabel: 'High', modelId: 'gemini-3.1-pro-preview' },
      ...extra,
    ],
  },
  openai: empty, anthropic: empty, moonshot: empty, spacexai: empty, zhipuai: empty,
  modelOrder: extra.map((model) => `gemini:${model.id}`),
});
/** The user's list, as an earlier copy of Willow left it in the folder. */
const usersCatalog = {
  version: 1,
  savedModels: {
    gemini: [{ id: 'custom-flash', name: 'My custom Flash', thinkingLevel: 1, thinkingLabel: 'Low', modelId: 'gemini-3.8-flash' }],
    openai: [{ id: 'custom-gpt', name: 'My GPT', thinkingLevel: 2, modelId: 'gpt-6-sol' }],
    anthropic: [], moonshot: [], spacexai: [], zhipuai: [],
  },
  modelOrder: ['openai:custom-gpt', 'gemini:custom-flash'],
};

const descriptor = () => m.getSyncedFolders().find((f) => f.id === 'model-catalog');
const pass = (root) => m.syncRegisteredFolder(root, descriptor(), SCOPE);
const store = (config) => globalThis.localStorage.setItem('modelConfig', JSON.stringify(config));
const names = (config) => Object.fromEntries(['gemini', 'openai']
  .map((provider) => [provider, (config[provider]?.savedModels ?? []).map((model) => model.name)]));
const stored = () => names(JSON.parse(globalThis.localStorage.getItem('modelConfig')));
const onDisk = async (root) => {
  const { savedModels } = JSON.parse(await fileText(root, ['Models'], 'catalog.json'));
  return Object.fromEntries(['gemini', 'openai'].map((provider) => [provider, savedModels[provider].map((model) => model.name)]));
};
const folderWithUsersList = async () => {
  const root = new MemoryDir();
  await writeFile(root, ['Models'], 'catalog.json', JSON.stringify(usersCatalog, null, 2));
  return root;
};
/** Nothing was set aside: no conflict copy beside the catalog, nothing in Willow's Recycle Bin. */
const nothingSetAside = async (root) => {
  assert.deepEqual(await fileNames(root, 'Models'), ['catalog.json']);
  assert.ok(![...root.entries.keys()].includes('Recycle Bin'), 'a copy of the list went to the Recycle Bin');
};

beforeEach(() => {
  useStorage(memoryStorage());
  events.length = 0;
});

describe('the model list in the workspace folder', () => {
  it('takes the folder\'s list when this browser starts over, and writes nothing over it', async () => {
    const root = await folderWithUsersList();
    store(shipped());
    await pass(root);
    await pass(root);
    const users = { gemini: ['My custom Flash'], openai: ['My GPT'] };
    assert.deepEqual(stored(), users, 'the browser holds the folder\'s list');
    assert.deepEqual(await onDisk(root), users, 'the folder still holds it');
    assert.ok(events.some((event) => event.detail?.savedModels?.gemini?.[0]?.id === 'custom-flash'), 'open tabs are told');
    await nothingSetAside(root);
  });

  it('keeps a model this browser added beside the folder\'s, but not the ones Willow starts with', async () => {
    const root = await folderWithUsersList();
    store(shipped([{ id: 'added-here', name: 'Added here', thinkingLevel: 2, modelId: 'gemini-3.1-pro-preview' }]));
    await pass(root);
    await pass(root);
    const both = { gemini: ['My custom Flash', 'Added here'], openai: ['My GPT'] };
    assert.deepEqual(stored(), both);
    assert.deepEqual(await onDisk(root), both, 'written to the folder on the pass after');
    await nothingSetAside(root);
  });

  it('writes this browser\'s list to a folder that has none yet', async () => {
    const root = new MemoryDir();
    store(shipped());
    await pass(root);
    assert.deepEqual(await onDisk(root), { gemini: ['Gemini 3.8 Flash', 'Gemini 3.5 Flash Lite', 'Gemini 3.1 Pro'], openai: [] });
  });

  it('once synced, takes a model removed here off the folder', async () => {
    const root = await folderWithUsersList();
    store(shipped());
    await pass(root);
    await pass(root);
    const config = JSON.parse(globalThis.localStorage.getItem('modelConfig'));
    store({ ...config, openai: { ...config.openai, savedModels: [] }, modelOrder: ['gemini:custom-flash'] });
    await pass(root);
    assert.deepEqual(await onDisk(root), { gemini: ['My custom Flash'], openai: [] });
    assert.deepEqual(stored(), { gemini: ['My custom Flash'], openai: [] });
  });
});
