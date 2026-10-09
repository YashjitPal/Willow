/**
 * The desktop rail's Media and Code go back to the project left there (`rail-returns.ts`).
 *
 * What broke it: an agent tab opened from a Media project puts the shell behind it back on the
 * surface it last showed, whose address is the Media landing's (`/create`), and the landing's
 * address was read as the user going there — so Media opened on its landing again.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const returnsModule = path.join(repoRoot, 'apps', 'studio', 'src', 'shell', 'rail', 'rail-returns.ts');

const session = new Map();
beforeEach(() => {
  session.clear();
  globalThis.sessionStorage = {
    getItem: (key) => (session.has(key) ? session.get(key) : null),
    setItem: (key, value) => session.set(key, String(value)),
    removeItem: (key) => session.delete(key),
  };
});

/** The module, emptied. Node keeps one instance per URL, so the first address of a load is long noted. */
const fresh = async () => {
  const returns = await importTs(returnsModule);
  returns.noteRailPlace('/app', '');
  returns.$railReturns.set({ media: null, code: null, dots: null, spark: null });
  return returns;
};

const PROJECT = '/media?projectId=%231234';

it('keeps the Media project while an agent tab is in front of the landing', async () => {
  const { $railReturns, noteRailPlace } = await fresh();
  noteRailPlace('/media', '?projectId=%231234');
  noteRailPlace('/create', '', false);
  assert.equal($railReturns.get().media, PROJECT, 'the project was forgotten behind the agent tab');
  noteRailPlace('/create', '', true);
  assert.equal($railReturns.get().media, null, 'the landing on show lets the project go');
});

it('keeps the Code project the same way', async () => {
  const { $railReturns, noteRailPlace } = await fresh();
  noteRailPlace('/project1', '?project=demo');
  noteRailPlace('/code', '', false);
  assert.equal($railReturns.get().code, '/project1?project=demo');
  noteRailPlace('/code', '', true);
  assert.equal($railReturns.get().code, null);
});

it('keeps the bot left open in Bots and the page left in Spark, each its own', async () => {
  const { $railReturns, noteSparkPlace } = await fresh();
  noteSparkPlace({ page: 'dots', dotId: 'dot-1' });
  noteSparkPlace({ page: 'task', taskId: 'task-1' });
  assert.equal($railReturns.get().dots, 'dot-1', 'opening a Spark task forgot the bot');
  assert.deepEqual($railReturns.get().spark, { page: 'task', taskId: 'task-1' });
  noteSparkPlace({ page: 'dots' });
  assert.equal($railReturns.get().dots, null, 'the bots list is Bots\' landing');
  noteSparkPlace({ page: 'home' });
  assert.equal($railReturns.get().spark, null, 'Spark\'s home is its landing');

  const navigation = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'shell', 'rail', 'rail-navigation.ts'), 'utf8');
  assert.match(navigation, /const bot = shell\.current === 'dots' \? null : \$railReturns\.get\(\)\.dots;\s*if \(bot\) goToSparkDot\(bot\);\s*else goToSparkDots\(\);/);
  assert.match(navigation, /const page = shell\.current === 'spark' \? null : \$railReturns\.get\(\)\.spark;\s*if \(page && isSparkLocation\(page\)\) navigateSpark\(page\);\s*else goToSparkHome\(\);/);
  const app = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'App.tsx'), 'utf8');
  assert.match(app, /sparkLocation\.subscribe\(noteSparkPlace\)/);
});

it('keeps the places for the session, through a reload', async () => {
  const { noteRailPlace } = await fresh();
  noteRailPlace('/media', '?projectId=%231234');
  assert.deepEqual(JSON.parse(session.get('willow:rail-returns')), { media: PROJECT, code: null, dots: null, spark: null });

  // A reload while an agent tab was open comes back on the landing's address, with the tab gone.
  const source = fs.readFileSync(returnsModule, 'utf8');
  assert.match(source, /const leaving = landingOnShow && noted;/, 'the first address after a load must not let a place go');
});

it('goes to the landing only from the project itself, and from the landing to the project left', () => {
  const navigation = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'shell', 'rail', 'rail-navigation.ts'), 'utf8');
  assert.match(navigation, /const left = destination === shell\.current && !shell\.onShell \? null : \$railReturns\.get\(\)\[destination\];/);
});

it('leaves an agent tab in front until the project has replaced the shell', () => {
  // Closed first, the tab uncovered the landing behind it for a frame or two before the project.
  const navigation = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'shell', 'rail', 'rail-navigation.ts'), 'utf8');
  const back = navigation.indexOf('if (left) {');
  assert.ok(back > 0 && back < navigation.indexOf('closeHarnessTab();'), 'the agent tab closes before the project lands');
  const app = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'App.tsx'), 'utf8');
  assert.match(app, /React\.useEffect\(\(\) => \{\s*if \(!isOnMainShell\) closeHarnessTab\(\);\s*\}, \[isOnMainShell\]\);/);
});

it('tells the places which landing is on show', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'App.tsx'), 'utf8');
  assert.match(app, /const agentTabInFront = useStore\(\$harnessTab\) !== null;/);
  assert.match(app, /noteRailPlace\(location\.pathname, location\.search, !agentTabInFront\);\s*\}, \[location\.pathname, location\.search, agentTabInFront\]\);/);
});
