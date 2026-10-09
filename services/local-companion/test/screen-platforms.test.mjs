/**
 * The user's screen on macOS (in the background, app by app) and Linux (a desktop of the bot's own), against stand-ins
 * for each system's tools: what each request runs, and what comes back.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { it } from 'node:test';
import { createScreen } from '../src/screen.mjs';
import { macActScript } from '../src/screen/mac.mjs';

it('on macOS, lists apps without Willow, captures one window off-screen, and acts through Accessibility', async () => {
  const ran = [];
  const run = async (file, args) => {
    ran.push([file, ...args]);
    if (file.endsWith('screencapture')) {
      const target = args.at(-1);
      await import('node:fs/promises').then((fs) => fs.writeFile(target, Buffer.from('PNGDATA')));
      return { code: 0, stdout: '', stderr: '' };
    }
    const script = args.at(-1);
    if (script.includes('CGWindowListCopyWindowInfo')) {
      return { code: 0, stdout: JSON.stringify({ apps: [{ app: 'Notes', pid: 10, window: 77, title: 'Shopping' }, { app: 'Willow', pid: 11, window: 78, title: 'Willow' }] }), stderr: '' };
    }
    if (script.includes('uiElements') && script.includes('flat')) return { code: 0, stdout: JSON.stringify({ ok: true, name: 'Done' }), stderr: '' };
    if (script.includes('uiElements')) return { code: 0, stdout: JSON.stringify({ window: 'Notes', elements: [{ index: 0, role: 'AXButton', name: 'Done', actions: ['AXPress'] }] }), stderr: '' };
    if (script.includes('frontmost')) return { code: 0, stdout: JSON.stringify({ ok: true, title: 'Notes' }), stderr: '' };
    return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' };
  };
  const screen = createScreen({ platform: 'darwin', run });
  assert.equal(screen.platform, 'mac');

  const { apps } = await screen.handle('screen.apps');
  assert.deepEqual(apps.map((app) => app.app), ['Notes'], 'Willow itself is never offered');

  const shot = await screen.handle('screen.capture', { window: 77 });
  assert.equal(Buffer.from(shot.data, 'base64').toString(), 'PNGDATA');
  const capture = ran.find(([file]) => file.endsWith('screencapture'));
  assert.deepEqual(capture.slice(1, 5), ['-x', '-o', '-l', '77'], 'one window by id, silently, without its shadow: no focus taken');
  await assert.rejects(screen.handle('screen.capture', {}), /Give the "window"/);

  const listed = await screen.handle('screen.elements', { pid: 10 });
  assert.equal(listed.elements[0].name, 'Done');
  assert.deepEqual(await screen.handle('screen.element', { snapshot: listed.snapshot, index: 0, action: 'invoke' }), { ok: true, name: 'Done' });
  await assert.rejects(screen.handle('screen.element', { snapshot: 999, index: 0, action: 'invoke' }), /out of date/);
  await assert.rejects(screen.handle('screen.element', { snapshot: listed.snapshot, index: 0, action: 'format' }), /Unknown action/);

  assert.deepEqual(await screen.handle('screen.begin', { name: 'Pip' }), { shown: false }, 'nothing is drawn over the user\'s screen');
  await assert.rejects(screen.handle('screen.act', { kind: 'click', x: 1, y: 1 }), /Give the "pid"/);
  assert.equal((await screen.handle('screen.act', { kind: 'click', pid: 10, x: 5, y: 6 })).ok, true);
});

it('on macOS, sends raw input to one app\'s process rather than to the screen', () => {
  const script = macActScript({ kind: 'click', pid: 42, x: 100, y: 200, clicks: 2, button: 'left', toX: 0, toY: 0, deltaX: 0, deltaY: 0, text: '', key: '' });
  assert.match(script, /CGEventPostToPid\(pid, event\)/);
  assert.match(script, /const pid = 42;/);
  assert.match(script, /for \(let i = 0; i < 2; i\+\+\)/);
  const typed = macActScript({ kind: 'type', pid: 42, x: 0, y: 0, clicks: 1, button: 'left', toX: 0, toY: 0, deltaX: 0, deltaY: 0, text: 'a"b\\c', key: '' });
  assert.ok(typed.includes(JSON.stringify('a"b\\c')), 'text goes in as a JSON string, never spliced raw into the script');
});

/** A Linux stand-in: which programs exist, what each run prints, and the processes started. */
const linuxStandIn = ({ installed = ['Xvfb', 'xdotool', 'import'] } = {}) => {
  const ran = [];
  const spawned = [];
  const run = async (file, args, options = {}) => {
    ran.push({ file, args, display: options.env?.DISPLAY });
    if (file === 'import') return { code: 0, stdout: Buffer.from('PNG'), stderr: '' };
    if (file === 'xdotool' && args[0] === 'search') return { code: 0, stdout: Buffer.from('101\n'), stderr: '' };
    if (file === 'xdotool' && args[0] === 'getwindowname') return { code: 0, stdout: Buffer.from('Firefox\n'), stderr: '' };
    if (file === 'xdotool' && args[0] === 'getwindowgeometry') return { code: 0, stdout: Buffer.from('WINDOW=101\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\n'), stderr: '' };
    return { code: 0, stdout: Buffer.from(''), stderr: '' };
  };
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
    spawned.push({ file, args, display: options?.env?.DISPLAY, child });
    return child;
  };
  const taken = new Set(['/tmp/.X11-unix/X90']);
  return { ran, spawned, run, spawn, has: async (name) => installed.includes(name), exists: (path) => taken.has(path) };
};

it('on Linux, says which tools are missing and how to get them', async () => {
  const standIn = linuxStandIn({ installed: ['import'] });
  const screen = createScreen({ platform: 'linux', ...standIn });
  const info = await screen.handle('screen.info');
  assert.deepEqual(info.missing, ['Xvfb', 'xdotool']);
  assert.match(info.hint, /apt install xvfb xdotool/);
  await assert.rejects(screen.handle('screen.capture'), /needs Xvfb, xdotool, which are not installed/);
  assert.equal(standIn.spawned.length, 0, 'nothing starts without its tools');
});

it('on Linux, runs a desktop of the bot\'s own and never the user\'s display', async () => {
  const standIn = linuxStandIn();
  const screen = createScreen({ platform: 'linux', ...standIn });
  assert.equal(screen.platform, 'linux');
  const shot = await screen.handle('screen.capture');
  assert.equal(Buffer.from(shot.data, 'base64').toString(), 'PNG');
  const [server] = standIn.spawned;
  assert.equal(server.file, 'Xvfb');
  assert.equal(server.args[0], ':91', 'the first display number nobody holds');
  assert.ok(server.args.includes('-nolisten'), 'reachable only on this computer');
  assert.ok(standIn.ran.every((entry) => entry.display === ':91'), 'every tool runs on the bot\'s display, never the user\'s');

  await screen.handle('screen.act', { kind: 'click', x: 10.4, y: 20, button: 'right', clicks: 2 });
  assert.deepEqual(standIn.ran.at(-1).args, ['mousemove', '10', '20', 'click', '--repeat', '2', '--delay', '80', '3']);
  await screen.handle('screen.act', { kind: 'key', key: 'ctrl+Enter' });
  assert.deepEqual(standIn.ran.at(-1).args, ['key', '--', 'ctrl+Return']);
  await screen.handle('screen.act', { kind: 'type', text: '--help me' });
  assert.deepEqual(standIn.ran.at(-1).args, ['type', '--delay', '12', '--', '--help me'], 'text that looks like an option is still text');

  const { apps } = await screen.handle('screen.apps');
  assert.deepEqual(apps, [{ title: 'Firefox', window: 101, bounds: { left: 10, top: 20, width: 800, height: 600 } }]);

  await screen.handle('screen.launch', { command: 'firefox --new-window' });
  const app = standIn.spawned.at(-1);
  assert.deepEqual([app.file, app.args, app.display], ['firefox', ['--new-window'], ':91']);
  await assert.rejects(screen.handle('screen.elements', {}), /no accessibility reading/);

  await screen.handle('screen.end');
  assert.equal(server.child.exitCode, 0, 'the desktop ends with the grant');
  assert.equal(app.child.exitCode, 0, 'and so do the apps it opened');
});
