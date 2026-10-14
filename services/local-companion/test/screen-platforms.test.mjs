/**
 * The user's screen on macOS (in the background, app by app) and Linux (a desktop of the bot's own), against stand-ins
 * for each system's tools: what each request runs, and what comes back.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { it } from 'node:test';
import { createScreen } from '../src/screen.mjs';
import { macActScript, macElement, macElementScript, macKey, macWalkScript } from '../src/screen/mac.mjs';
import { ownProfile, splitCommand, xKey } from '../src/screen/linux.mjs';

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
    if (script.includes('const route =')) return { code: 0, stdout: JSON.stringify({ ok: true, name: 'Done' }), stderr: '' };
    if (script.includes('uiElements')) {
      return { code: 0, stdout: JSON.stringify({ window: 'Notes', elements: [{ path: [0, 2], role: 'AXButton', subrole: '', name: 'Done', value: null, enabled: true, position: [100, 40], size: [60, 24], actions: ['AXPress'] }] }), stderr: '' };
    }
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
  assert.deepEqual(listed.elements[0], { index: 0, role: 'button', name: 'Done', actions: ['invoke'], center: { x: 130, y: 52, left: 100, top: 40, width: 60, height: 24 } }, 'in the words the tools use');
  assert.deepEqual(await screen.handle('screen.element', { snapshot: listed.snapshot, index: 0, action: 'invoke' }), { ok: true, name: 'Done' });
  const acted = ran.at(-1).at(-1);
  assert.match(acted, /const route = \[0,2\];/, 'straight back along the path it was found by');
  assert.match(acted, /"role":"AXButton","name":"Done"/, 'and only if the same control is still there');
  await assert.rejects(screen.handle('screen.element', { snapshot: 999, index: 0, action: 'invoke' }), /out of date/);
  await assert.rejects(screen.handle('screen.element', { snapshot: listed.snapshot, index: 0, action: 'format' }), /Unknown action/);

  assert.deepEqual(await screen.handle('screen.begin', { name: 'Pip' }), { shown: false }, 'nothing is drawn over the user\'s screen');
  await assert.rejects(screen.handle('screen.act', { kind: 'click', x: 1, y: 1 }), /Give the "pid"/);
  await assert.rejects(screen.handle('screen.act', { kind: 'type', text: 'hi' }), /Give the "pid"/, 'typing never goes to whatever app is in front');
  assert.equal((await screen.handle('screen.act', { kind: 'click', pid: 10, x: 5, y: 6 })).ok, true);
  const before = ran.length;
  await assert.rejects(screen.handle('screen.act', { kind: 'key', pid: 10, key: 'cmd+bogus' }), /not a key the Mac knows/);
  assert.equal(ran.length, before, 'a key it does not know is said at once, with nothing run');
});

it('on macOS, asks an app that shows next to nothing to build its whole tree, once', async () => {
  const walks = [];
  const run = async (file, args) => {
    const script = args.at(-1);
    walks.push(script);
    const elements = script.includes("if (true) $.AXUIElementSetAttributeValue(app, $('AXEnhancedUserInterface')")
      ? [1, 2, 3, 4].map((n) => ({ path: [0, n], role: 'AXButton', name: `B${n}`, enabled: true, position: [n, n], size: [10, 10], actions: ['AXPress'] }))
      : [];
    return { code: 0, stdout: JSON.stringify({ window: 'Slack', elements }), stderr: '' };
  };
  const screen = createScreen({ platform: 'darwin', run });
  const first = await screen.handle('screen.elements', { pid: 20 });
  assert.equal(first.elements.length, 4, 'the second reading, with the app told assistive software is there');
  assert.equal(walks.length, 2);
  await screen.handle('screen.elements', { pid: 20 });
  assert.equal(walks.length, 3, 'and only the first time');
});

it('on macOS, names keys as the Mac does, types whole characters, and reads controls as the tools name them', () => {
  assert.deepEqual(macKey('cmd+s'), { code: 1, flags: 0x100000 });
  assert.deepEqual(macKey('?'), { code: 44, flags: 0x20000 }, 'Shift and the slash key');
  assert.deepEqual(macKey('cmd+shift+['), { code: 33, flags: 0x120000 });
  assert.deepEqual(macKey('F5'), { code: 96, flags: 0 });
  assert.deepEqual(macKey('option+Left'), { code: 123, flags: 0x80000 });
  assert.deepEqual(macKey('PageDown'), { code: 121, flags: 0 });
  assert.deepEqual(macKey('plus'), { code: 24, flags: 0x20000 });
  assert.deepEqual(macKey('ctrl++'), { code: 24, flags: 0x60000 });
  assert.throws(() => macKey('hyper+a'), /not a modifier/);
  assert.throws(() => macKey('cmd'), /is a modifier/);
  assert.throws(() => macKey('bogus'), /not a key the Mac knows/);

  const script = macActScript({ kind: 'click', pid: 42, x: 100, y: 200, clicks: 2, button: 'left', toX: 0, toY: 0, deltaX: 0, deltaY: 0, text: '', code: -1, flags: 0 });
  assert.match(script, /CGEventPostToPid\(pid, event\)/);
  assert.match(script, /const pid = 42;/);
  assert.match(script, /for \(let i = 0; i < 2; i\+\+\)/);
  const typed = macActScript({ kind: 'type', pid: 42, x: 0, y: 0, clicks: 1, button: 'left', toX: 0, toY: 0, deltaX: 0, deltaY: 0, text: 'a"b\\c 👋', code: -1, flags: 0 });
  assert.ok(typed.includes(JSON.stringify('a"b\\c 👋')), 'text goes in as a JSON string, never spliced raw into the script');
  assert.match(typed, /for \(const character of text\)/, 'a character at a time, both halves of an emoji together');
  const pressed = macActScript({ kind: 'key', pid: 42, x: 0, y: 0, clicks: 1, button: 'left', toX: 0, toY: 0, deltaX: 0, deltaY: 0, text: '', ...macKey('cmd+shift+t') });
  assert.match(pressed, /press\(17, 1179648\)/);

  for (const generated of [script, typed, pressed, macWalkScript({ pid: 7 }), macWalkScript({ pid: 7, enhance: true, wait: true }), macElementScript({ pid: 7, path: [0, 1, 4], role: 'AXTextField', name: 'To', action: 'set_value', value: 'x\'"y' })]) {
    assert.doesNotThrow(() => new Function(generated), 'every script it runs is whole JavaScript');
  }

  assert.deepEqual(macElement({ role: 'AXCheckBox', name: 'Bold', value: 1, enabled: true, actions: ['AXPress'], position: [0, 0], size: [10, 10] }, 3), { index: 3, role: 'checkbox', name: 'Bold', state: 'on', actions: ['toggle'], center: { x: 5, y: 5, left: 0, top: 0, width: 10, height: 10 } });
  assert.deepEqual(macElement({ role: 'AXTextField', subrole: 'AXSearchField', name: 'Search', value: 'cats', enabled: true, actions: [] }, 0), { index: 0, role: 'search box', name: 'Search', value: 'cats', actions: ['set_value'] });
  assert.deepEqual(macElement({ role: 'AXTextField', subrole: 'AXSecureTextField', name: 'Password', value: 'hunter2', enabled: true, actions: [] }, 1), { index: 1, role: 'password box', name: 'Password' }, 'a password is neither shown nor filled');
  assert.deepEqual(macElement({ role: 'AXButton', name: 'Send', enabled: false, actions: ['AXPress'] }, 2), { index: 2, role: 'button', name: 'Send', actions: ['invoke'], disabled: true });
});

/** A Linux stand-in: which programs exist, what each run prints, and the processes started. */
const linuxStandIn = ({ installed = ['Xvfb', 'xdotool', 'import'], refuses = () => false, says = () => '' } = {}) => {
  const ran = [];
  const spawned = [];
  const made = [];
  const run = async (file, args, options = {}) => {
    ran.push({ file, args, display: options.env?.DISPLAY, env: options.env });
    if (file === 'import') return { code: 0, stdout: Buffer.from('PNG'), stderr: '' };
    if (file === 'xdotool' && args[0] === 'search') return { code: 0, stdout: Buffer.from('101\n'), stderr: '' };
    if (file === 'xdotool' && args[0] === 'getwindowname') return { code: 0, stdout: Buffer.from('Firefox\n'), stderr: '' };
    if (file === 'xdotool' && args[0] === 'getwindowgeometry') return { code: 0, stdout: Buffer.from('WINDOW=101\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\n'), stderr: '' };
    return { code: 0, stdout: Buffer.from(''), stderr: says(file, args) };
  };
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
    spawned.push({ file, args, display: options?.env?.DISPLAY, env: options?.env, child });
    if (refuses(file)) setImmediate(() => child.emit('error', Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' })));
    return child;
  };
  const taken = new Set(['/tmp/.X11-unix/X90']);
  return { ran, spawned, made, run, spawn, has: async (name) => installed.includes(name), exists: (path) => taken.has(path), makeDir: (dir) => made.push(dir), home: '/home/pat', sleep: async () => {} };
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
  const typing = standIn.ran.length;
  await screen.handle('screen.act', { kind: 'type', text: 'Dear Sam,\n\nThanks' });
  assert.deepEqual(standIn.ran.slice(typing).map((entry) => entry.args), [
    ['type', '--delay', '12', '--', 'Dear Sam,'], ['key', '--', 'Return'], ['key', '--', 'Return'], ['type', '--delay', '12', '--', 'Thanks'],
  ], 'a new line is pressed as Return');
  await screen.handle('screen.act', { kind: 'drag', x: 0, y: 0, toX: 80, toY: 40 });
  const drag = standIn.ran.at(-1).args;
  assert.equal(drag.filter((word) => word === 'mousemove').length, 9, 'pressed, carried there in steps, and let go');
  assert.deepEqual(drag.slice(-4), ['sleep', '0.1', 'mouseup', '1']);

  const { apps } = await screen.handle('screen.apps');
  assert.deepEqual(apps, [{ title: 'Firefox', window: 101, bounds: { left: 10, top: 20, width: 800, height: 600 } }]);
  await screen.handle('screen.focus', { window: 101 });
  assert.deepEqual(standIn.ran.slice(-2).map((entry) => entry.args), [['windowraise', '101'], ['windowfocus', '101']], 'raised and given the keys, with no window manager to ask');

  await screen.handle('screen.launch', { command: 'firefox --new-window' });
  const app = standIn.spawned.at(-1);
  const profile = '/home/pat/.cache/willow/desktop/firefox';
  assert.deepEqual([app.file, app.args, app.display], ['firefox', ['--no-remote', '--new-instance', '--profile', profile, '--new-window'], ':91'], 'a profile of its own, so it never hands its window to the user\'s Firefox');
  assert.deepEqual(standIn.made, [profile]);
  assert.equal(app.env.WAYLAND_DISPLAY, undefined, 'never on the user\'s Wayland session');
  assert.equal(app.env.GDK_BACKEND, 'x11');
  assert.equal(app.env.QT_QPA_PLATFORM, 'xcb');
  assert.equal(app.env.MOZ_ENABLE_WAYLAND, '0');
  assert.match(app.env.DBUS_SESSION_BUS_ADDRESS, /nonexistent/, 'no session bus to be had rather than the user\'s');
  await assert.rejects(screen.handle('screen.elements', {}), /no accessibility reading/);

  await screen.handle('screen.end');
  assert.equal(server.child.exitCode, 0, 'the desktop ends with the grant');
  assert.equal(app.child.exitCode, 0, 'and so do the apps it opened');
});

it('on Linux, gives the desktop a bus and a window manager of its own when the system has them', async () => {
  const standIn = linuxStandIn({ installed: ['Xvfb', 'xdotool', 'import', 'dbus-daemon', 'fluxbox', 'xfwm4'] });
  const screen = createScreen({ platform: 'linux', ...standIn });
  await screen.handle('screen.capture');
  assert.deepEqual(standIn.spawned.map((entry) => entry.file), ['Xvfb', 'dbus-daemon', 'fluxbox'], 'the first window manager there is');
  assert.equal(standIn.spawned[2].display, ':91');
  await screen.handle('screen.focus', { window: 101 });
  assert.deepEqual(standIn.ran.slice(-3).map((entry) => entry.args), [['windowactivate', '101'], ['windowraise', '101'], ['windowfocus', '101']]);
  await screen.handle('screen.end');
  assert.ok(standIn.spawned.every((entry) => entry.child.exitCode === 0), 'all of it ends with the grant');
});

it('on Linux, says plainly when an app is not there, or a key is not one X knows', async () => {
  const standIn = linuxStandIn({ refuses: (file) => file === 'gimp', says: (file, args) => (args[0] === 'key' && args[2] === 'Hyper_Q' ? "(symbol) No such key name 'Hyper_Q'. Ignoring it.\n" : '') });
  const screen = createScreen({ platform: 'linux', ...standIn });
  await assert.rejects(screen.handle('screen.launch', { command: 'gimp photo.png' }), /gimp is not installed/);
  await assert.rejects(screen.handle('screen.act', { kind: 'key', key: 'Hyper_Q' }), /"Hyper_Q" is not a key X knows/);
  await assert.rejects(screen.handle('screen.launch', { command: 'firefox && rm -rf ~' }), /no shell here/);
  screen.dispose();
});

it('on Linux, names keys as X does, splits a command as a shell would, and keeps profiles apart', () => {
  assert.equal(xKey('ctrl+?'), 'ctrl+question');
  assert.equal(xKey('cmd+C'), 'ctrl+c', 'a Mac\'s cmd is Control here');
  assert.equal(xKey('é'), 'U00E9');
  assert.equal(xKey('ctrl++'), 'ctrl+plus');
  assert.equal(xKey('F5'), 'F5');
  assert.equal(xKey('PageDown'), 'Next');
  assert.equal(xKey('numpad7'), 'KP_7');
  assert.equal(xKey('XF86AudioMute'), 'XF86AudioMute', 'a name X itself knows passes as it is');
  assert.throws(() => xKey('hyper+a'), /not a modifier/);

  assert.deepEqual(splitCommand('libreoffice --calc "/home/pat/My Sheets/budget.ods"'), { file: 'libreoffice', args: ['--calc', '/home/pat/My Sheets/budget.ods'], settings: {} });
  assert.deepEqual(splitCommand("LANG=fr_FR.UTF-8 gedit 'notes (1).txt' a\\ b"), { file: 'gedit', args: ['notes (1).txt', 'a b'], settings: { LANG: 'fr_FR.UTF-8' } });
  assert.throws(() => splitCommand('gedit "notes.txt'), /never closed/);

  const none = () => false;
  assert.deepEqual(ownProfile('google-chrome', ['https://example.com'], { home: '/home/pat', exists: none }).args, ['--user-data-dir=/home/pat/.cache/willow/desktop/google-chrome', '--no-first-run', '--no-default-browser-check', 'https://example.com']);
  assert.deepEqual(ownProfile('firefox', ['-P', 'work'], { home: '/home/pat', exists: none }), { dir: null, args: ['-P', 'work'] }, 'a profile asked for is kept');
  assert.equal(ownProfile('firefox', [], { home: '/home/pat', exists: (file) => file === '/snap/bin/firefox' }).dir, '/home/pat/snap/firefox/common/willow-desktop', 'a snap can only write in its own folder');
  assert.deepEqual(ownProfile('gedit', ['a.txt'], { home: '/home/pat', exists: none }), { dir: null, args: ['a.txt'] });
});
