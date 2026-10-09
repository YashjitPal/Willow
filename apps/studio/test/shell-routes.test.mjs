/**
 * Every part of the main shell has an address (`apps/studio/src/app/shell-routes.ts`):
 * Gemini's where Gemini has the part — `/app`, `/app/<chat>`, Spark's `/spark/…` — and
 * Willow's own for the rest. `ShellRouteSync` keeps the address bar on them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const routes = await importTs(path.join(ROOT, 'apps/studio/src/app/shell-routes.ts'));
const spark = await importTs(path.join(ROOT, 'features/spark/src/spark-routes.ts'));

describe('the shell surfaces and their addresses', () => {
  it('gives Chat, Code, the Media home and Spark one each', () => {
    const cases = [
      [{ surface: 'chat', chatId: null }, '/app'],
      [{ surface: 'chat', chatId: 'Pomodoro Timer' }, '/app/Pomodoro%20Timer'],
      [{ surface: 'code', chatId: null }, '/code'],
      [{ surface: 'code', chatId: '2026-10-04T12-18-12_46xo6k' }, '/code/2026-10-04T12-18-12_46xo6k'],
      [{ surface: 'media' }, '/create'],
      [{ surface: 'spark', location: { page: 'home' } }, '/spark'],
      [{ surface: 'spark', location: { page: 'all-tasks' } }, '/spark/tasks'],
      [{ surface: 'spark', location: { page: 'task', taskId: 'task-1' } }, '/spark/chat/task-1'],
      [{ surface: 'spark', location: { page: 'schedules' } }, '/spark/schedules'],
      [{ surface: 'spark', location: { page: 'skills' } }, '/spark/skills'],
      [{ surface: 'spark', location: { page: 'apps' } }, '/spark/apps'],
    ];
    for (const [route, address] of cases) {
      assert.equal(routes.shellPathFor(route), address);
      assert.deepEqual(routes.parseShellPath(address), route, `${address} reads back as what wrote it`);
    }
  });

  it('gives the sidebar\'s creation pages Gemini\'s addresses, until a chat has its own', () => {
    for (const [route, address] of [
      [{ surface: 'chat', chatId: null, page: 'images' }, '/images'],
      [{ surface: 'chat', chatId: null, page: 'videos' }, '/videos'],
    ]) {
      assert.equal(routes.shellPathFor(route), address);
      assert.deepEqual(routes.parseShellPath(address), route, `${address} reads back as what wrote it`);
    }
    assert.equal(routes.shellPathFor({ surface: 'chat', chatId: 'Paper boat', page: 'videos' }), '/app/Paper%20boat');
    assert.equal(routes.isShellPath('/images'), true, 'the shell rewrites /images once the first message names the chat');
  });

  it('keeps Spark\'s editors on the list they edit, as Gemini does', () => {
    assert.equal(spark.sparkPathFor({ page: 'schedule-editor', scheduleId: 's1' }), '/spark/schedules');
    assert.equal(spark.sparkPathFor({ page: 'skill-editor', mode: 'manual' }), '/spark/skills');
  });

  it('carries any chat name through, dots and all', () => {
    for (const chatId of ['v2.0 notes', 'Ünïcødé ✨', '100% done', 'a&b=c?d#e', 'semi;colon']) {
      const address = routes.shellPathFor({ surface: 'chat', chatId });
      assert.doesNotMatch(address.slice('/app/'.length), /[./?#]/, `${chatId} stays one segment, with no dot for a dev server to read as a file`);
      assert.deepEqual(routes.parseShellPath(address), { surface: 'chat', chatId });
    }
  });

  it('leaves every other path to its own page', () => {
    for (const address of ['/', '/search', '/media', '/media/characters', '/gem/abc', '/project1', '/gems/view',
      '/notebook/n1', '/apps', '/codex', '/app/a/b', '/spark/unknown', '/spark/chat', '/spark/tasks/x', '/creator', '/app/%E0%A4%A']) {
      assert.equal(routes.parseShellPath(address), null, address);
    }
    assert.equal(routes.isShellPath('/'), true, '`/` is the shell\'s, and becomes the surface on show');
    assert.equal(routes.isShellPath('/search'), false);
  });

  it('drops the `?mode=` it has read, and keeps the rest of the query', () => {
    assert.equal(routes.shellSearch('?mode=develop'), '');
    assert.equal(routes.shellSearch('?tab=media&foo=1'), '?foo=1');
    assert.equal(routes.shellSearch(''), '');
  });
});

describe('the shell keeping the address in step', () => {
  const app = read('apps/studio/src/app/App.tsx');
  const sync = read('apps/studio/src/app/ShellRouteSync.tsx');

  it('renders the shell for every surface address, and opens the surface one names', () => {
    // The shell renders above the routes, kept mounted (`ShellKeepAlive`); its addresses stay routes of their own.
    assert.match(app, /<ShellKeepAlive onShow=\{isMainShellRoute\}>\{mainAppShell\}<\/ShellKeepAlive>/);
    for (const route of ['/app', '/app/:chatId', '/code', '/code/:chatId', '/create', '/spark/*', '/projects']) {
      assert.ok(app.includes(`<Route path="${route}" element={null} />`), route);
    }
    assert.match(app, /parseShellPath\(location\.pathname\)\?\.surface === 'spark' \? 'spark' : 'chat'/);
    assert.match(app, /if \(surface === 'code'\) return 'develop';/);
    assert.match(app, /<ShellRouteSync\s+currentView=\{currentView\}/);
    assert.match(app, /else if \(view === 'projects'\) navigate\('\/projects'\);/, 'the Projects page has an address now');
  });

  it('lets the URL decide only on a page load or Back/Forward, and the shell decide the rest', () => {
    // By navigation, not key: Spark's entries copy their key, and the page's first entry has
    // none, so Back to it a second time had the same key and address as the load.
    assert.match(sync, /if \(navigationType !== 'POP' \|\| handledLocationRef\.current === location\) return;/);
    assert.doesNotMatch(sync, /location\.key/);
    assert.match(sync, /if \(!isShellPath\(actual\)\) return;/, 'a Gem, a notebook or an editor keeps its own address');
    assert.match(sync, /const replace = replaceNextRef\.current \|\| actual === '\/' \|\| !\(isUserStep \|\| isSurfaceChange\);/,
      'only a user step is a history entry of its own, and `/` is never one');
    assert.match(sync, /window\.history\.replaceState\(window\.history\.state, '', desired \+ search\);/,
      'Spark\'s entries keep the page they carry');
    assert.match(sync, /void checkCodeChat\(chatScopeId, chatId, loadLocalFSChat\)\.then\(\(isCode\) => \{/,
      'a chat named by its address opens in Code or Chat by what it is');
  });

  it('holds the address until the shell shows what it named', () => {
    // The writer runs beside each act with the state from before it; settling there
    // would write the old chat back over a Back.
    assert.match(sync, /if \(wanted\.surface !== 'chat' \|\| activeChatId === null\) \{\s+settle\(\);/);
    assert.match(sync, /if \(sparkPathFor\(spark\) === sparkPathFor\(wanted\.location\)\) \{\s+settle\(\);/);
    assert.match(sync, /replaceSparkLocation\(wanted\.location\);/,
      'the entry\'s own Spark page is the address\'s: Spark restores from it on Back/Forward, before the router reads the address');
    assert.doesNotMatch(sync, /restoreSparkLocation/);
    assert.equal(sync.match(/return giveUpLater\(\);/g)?.length, 3, 'Spark, New chat and a named chat each wait, for a while');
    assert.match(sync, /const isUserStep = intentAt !== null && Date\.now\(\) - intentAt < PUSH_INTENT_MS;/,
      'a picked chat that opens a render later is still a step of its own');
  });
});
