/**
 * Spark Pages in the workspace's `Spark/Pages` (features/spark/src/spaces/state/pages-folder.ts), driven through the
 * real synced-folder driver against an in-memory folder, with this browser's saved Pages held in memory. What these
 * pin is that Pages outlive Willow's own storage: a browser starting over takes the folder's Pages as they stand,
 * keeps a Page only it has, and sets none of the folder's aside as a conflict copy or into the Recycle Bin.
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

let bundleDir = '';
let m;
before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-pages-disk-'));
  const outfile = path.join(bundleDir, 'pages-disk.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'pages-disk-entry.ts',
      loader: 'ts',
      contents: `
        export { syncRegisteredFolder } from '@willow/storage/local-sync';
        export { pagesFolder } from '@willow/spark/spaces/state/pages-folder';
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

const access = { can_read: true, can_write: true, can_comment: true, can_share: true, can_delete: true };
const self = { actor_type: 'user', account_user_id: 'self' };
const page = (id, title, updated = '2026-10-01T10:00:00.000Z') => ({
  page_id: id, title, document_type: 'page', symbol: null, parent: null, drive_space_id: null, site_project_id: null,
  has_children: false, position: 0, created_at: updated, updated_at: updated, deleted_at: null, access,
  interaction_mode: null, created_by: self, last_edited_by: self,
});
const paragraph = (text) => ({ id: `block-${text.length}`, type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (pageId, text) => ({ pageId, status: 'ready', blocks: [paragraph(text)], threads: [], taskMentions: {}, attribution: {} });
const pages = (entries, extra = {}) => ({
  pages: Object.fromEntries(entries.map(([p]) => [p.page_id, p])),
  documents: Object.fromEntries(entries.filter(([, d]) => d).map(([p, d]) => [p.page_id, d])),
  recentPageIds: entries.map(([p]) => p.page_id),
  pinnedKeys: [],
  dotAccess: {},
  welcomePageId: null,
  ...extra,
});

/** This browser's saved Pages, and what an open Pages was handed. */
let browser;
const descriptor = () => ({
  id: 'spark-pages',
  ...m.pagesFolder({
    read: async () => (browser.saved === null ? null : structuredClone(browser.saved)),
    write: async (saved) => { browser.saved = structuredClone(saved); },
    replaced: (saved) => { browser.replaced.push(structuredClone(saved)); },
  }),
});
const pass = (root) => m.syncRegisteredFolder(root, descriptor(), SCOPE);
const titles = (saved) => Object.values(saved.pages).map((p) => p.title).sort();
const onDisk = async (root) => fileNames(root, 'Spark', 'Pages');
const nothingSetAside = async (root) => {
  assert.ok(!(await onDisk(root)).some((name) => name.includes('conflict')), 'a Page was set aside as a conflict copy');
  assert.ok(![...root.entries.keys()].includes('Recycle Bin'), 'a Page went to the Recycle Bin');
};

/** A folder an earlier copy of Willow left: the user's two Pages, one of them pinned. */
const usersFolder = async () => {
  const root = new MemoryDir();
  browser = { saved: pages([[page('page-plan', 'Launch plan'), doc('page-plan', 'Ship on Friday')], [page('page-notes', 'Notes'), doc('page-notes', 'Call Sam')]], { pinnedKeys: ['page:page-plan'] }), replaced: [] };
  await pass(root);
  return root;
};

beforeEach(() => {
  useStorage(memoryStorage());
  browser = { saved: null, replaced: [] };
});

describe('Spark Pages in the workspace folder', () => {
  it('writes one file per Page, and _pages.json with what is pinned and recent', async () => {
    const root = await usersFolder();
    assert.deepEqual(await onDisk(root), ['_pages.json', 'page-notes.json', 'page-plan.json']);
    const plan = JSON.parse(await fileText(root, ['Spark', 'Pages'], 'page-plan.json'));
    assert.equal(plan.page.title, 'Launch plan');
    assert.equal(plan.document.blocks[0].content[0].text, 'Ship on Friday');
    const list = JSON.parse(await fileText(root, ['Spark', 'Pages'], '_pages.json'));
    assert.deepEqual(list.pinnedKeys, ['page:page-plan']);
  });

  it('gives a browser starting over the folder\'s Pages, with their documents and pins', async () => {
    const root = await usersFolder();
    useStorage(memoryStorage());
    browser = { saved: null, replaced: [] };
    await pass(root);
    await pass(root);
    assert.deepEqual(titles(browser.saved), ['Launch plan', 'Notes']);
    assert.equal(browser.saved.documents['page-notes'].blocks[0].content[0].text, 'Call Sam');
    assert.deepEqual(browser.saved.pinnedKeys, ['page:page-plan']);
    assert.ok(browser.replaced.length > 0, 'an open Pages is told');
    assert.deepEqual(await onDisk(root), ['_pages.json', 'page-notes.json', 'page-plan.json']);
    await nothingSetAside(root);
  });

  it('takes the folder\'s Pages over the seed a fresh copy saved before its first pass, and keeps a Page only it has', async () => {
    const root = await usersFolder();
    const before = await fileText(root, ['Spark', 'Pages'], 'page-plan.json');
    useStorage(memoryStorage());
    // The seed's dates are made fresh on every run, so the same Page differs from the folder's copy.
    browser = { saved: pages([[page('page-plan', 'Launch plan', new Date().toISOString()), doc('page-plan', 'seed text')], [page('page-new', 'Written here first'), doc('page-new', 'new')]]), replaced: [] };
    await pass(root);
    await pass(root);
    assert.deepEqual(titles(browser.saved), ['Launch plan', 'Notes', 'Written here first']);
    assert.equal(browser.saved.documents['page-plan'].blocks[0].content[0].text, 'Ship on Friday', 'the folder\'s copy of a Page wins');
    assert.equal(await fileText(root, ['Spark', 'Pages'], 'page-plan.json'), before, 'nothing is written over it');
    assert.deepEqual(await onDisk(root), ['_pages.json', 'page-new.json', 'page-notes.json', 'page-plan.json']);
    await nothingSetAside(root);
  });

  it('moves nothing out of the folder when this browser loses its saved Pages after syncing', async () => {
    const root = await usersFolder();
    browser.saved = null;
    await pass(root);
    await pass(root);
    assert.deepEqual(await onDisk(root), ['_pages.json', 'page-notes.json', 'page-plan.json']);
    assert.deepEqual(titles(browser.saved), ['Launch plan', 'Notes']);
    await nothingSetAside(root);
  });

  it('takes a Page deleted here off the folder, and a Page added in the folder into this browser', async () => {
    const root = await usersFolder();
    const { 'page-notes': _notes, ...rest } = browser.saved.pages;
    browser.saved = { ...browser.saved, pages: rest, recentPageIds: ['page-plan'] };
    await pass(root);
    assert.deepEqual(await onDisk(root), ['_pages.json', 'page-plan.json']);
    await writeFile(root, ['Spark', 'Pages'], 'page-idea.json', JSON.stringify({ page: page('page-idea', 'Idea'), document: doc('page-idea', 'From another copy') }, null, 2));
    await pass(root);
    assert.deepEqual(titles(browser.saved), ['Idea', 'Launch plan']);
  });
});
