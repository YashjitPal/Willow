/**
 * Design projects' screens and chat (features/design/src/design-persistence.ts) with this browser's copy and the
 * project's `Design/<project>/design.json` held in memory. What these pin is that a Design project outlives a restart
 * and a reinstall, and that a copy which can't read the project's file, or finds another copy changed it, never
 * writes its own over it.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

let bundleDir = '';
let outfile = '';
let copies = 0;
/** A fresh copy of the module: what a restart of Willow starts with. */
const launch = () => import(`${pathToFileURL(outfile).href}?copy=${++copies}`);

before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-design-persistence-'));
  outfile = path.join(bundleDir, 'design-persistence.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'design-persistence-entry.ts',
      loader: 'ts',
      contents: `
        export * from '@willow/design/design-persistence';
        export { addDesignNode, designMessagesStore, designNodesStore } from '@willow/design/design-store';
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
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 700));
const node = (id, code) => ({ id, prompt: `make ${id}`, code, fileName: 'App', timestamp: 1, layoutData: { x: 100, y: 100 } });
const message = (id, content, role = 'user') => ({ id, role, content, timestamp: 1 });

/** The project's folder file and this browser's copy, as plain maps. */
const world = () => {
  const files = new Map();
  const saved = new Map();
  return {
    files,
    saved,
    folder: {
      read: async (project, name) => files.get(`${project}/${name}`) ?? null,
      write: async (project, name, content) => { files.set(`${project}/${name}`, content); return true; },
    },
    store: {
      read: async (project) => (saved.has(project) ? structuredClone(saved.get(project)) : null),
      write: async (project, state) => { saved.set(project, structuredClone(state)); },
    },
  };
};

describe('Design projects across restarts and reinstalls', () => {
  it('keeps a project\'s screens and chat across a restart, and in its design.json', async () => {
    const w = world();
    const first = await launch();
    await first.openDesignProjectState('Shop', w.folder, { fresh: true, saved: w.store });
    first.designMessagesStore.set([message('m1', 'a login screen')]);
    first.designNodesStore.set([node('s1', 'export default function App() { return <div>Login</div>; }')]);
    await settle();
    const file = JSON.parse(w.files.get('Shop/design.json'));
    assert.deepEqual(file.nodes.map((n) => n.id), ['s1']);
    assert.deepEqual(file.messages.map((m) => m.content), ['a login screen']);

    const restarted = await launch();
    await restarted.openDesignProjectState('Shop', w.folder, { saved: w.store });
    assert.deepEqual(restarted.designNodesStore.get().map((n) => n.id), ['s1']);
    assert.deepEqual(restarted.designMessagesStore.get().map((m) => m.content), ['a login screen']);
  });

  it('gives a reinstalled copy the project from its design.json, and writes nothing over it', async () => {
    const w = world();
    const text = JSON.stringify({ nodes: [node('s1', 'code one'), node('s2', 'code two')], messages: [message('m1', 'two screens')] }, null, 2);
    w.files.set('Shop/design.json', text);
    const reinstalled = await launch();
    await reinstalled.openDesignProjectState('Shop', w.folder, { saved: w.store });
    assert.deepEqual(reinstalled.designNodesStore.get().map((n) => n.id), ['s1', 's2']);
    assert.deepEqual(reinstalled.designMessagesStore.get().map((m) => m.content), ['two screens']);
    await settle();
    assert.equal(w.files.get('Shop/design.json'), text);
  });

  it('writes nothing over a design.json it could not read', async () => {
    const w = world();
    w.files.set('Shop/design.json', '{"nodes": [');
    const copy = await launch();
    await copy.openDesignProjectState('Shop', w.folder, { saved: w.store });
    copy.designNodesStore.set([node('s9', 'new here')]);
    await settle();
    assert.equal(w.files.get('Shop/design.json'), '{"nodes": [');
    assert.equal(w.saved.size, 0);

    const unreadable = { ...w.folder, read: async () => { throw new Error('locked'); } };
    const other = await launch();
    await other.openDesignProjectState('Shop', unreadable, { saved: w.store });
    other.designNodesStore.set([node('s8', 'also new')]);
    await settle();
    assert.equal(w.files.get('Shop/design.json'), '{"nodes": [');
  });

  it('shows the project as another copy of Willow left it in the folder', async () => {
    const w = world();
    const first = await launch();
    await first.openDesignProjectState('Shop', w.folder, { fresh: true, saved: w.store });
    first.designNodesStore.set([node('s1', 'mine')]);
    await settle();
    w.files.set('Shop/design.json', JSON.stringify({ nodes: [node('s1', 'mine'), node('s2', 'from the other copy')], messages: [] }, null, 2));

    const restarted = await launch();
    await restarted.openDesignProjectState('Shop', w.folder, { saved: w.store });
    assert.deepEqual(restarted.designNodesStore.get().map((n) => n.id), ['s1', 's2']);
  });

  it('keeps each project\'s screens apart', async () => {
    const w = world();
    const copy = await launch();
    await copy.openDesignProjectState('Shop', w.folder, { fresh: true, saved: w.store });
    copy.designNodesStore.set([node('shop-1', 'shop')]);
    await copy.openDesignProjectState('Blog', w.folder, { fresh: true, saved: w.store });
    assert.deepEqual(copy.designNodesStore.get(), [], 'a new project starts empty');
    copy.designNodesStore.set([node('blog-1', 'blog')]);
    await copy.openDesignProjectState('Shop', w.folder, { saved: w.store });
    assert.deepEqual(copy.designNodesStore.get().map((n) => n.id), ['shop-1']);
    await settle();
    assert.deepEqual(JSON.parse(w.files.get('Blog/design.json')).nodes.map((n) => n.id), ['blog-1']);
  });
});
