import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { it } from 'node:test';
import { createScreen } from '../src/screen.mjs';

/** A helper that answers each request line with what `respond` says, as the real one does. */
const standIn = (respond) => {
  const seen = [];
  const launch = async () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit('exit', 0);
    let buffer = '';
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        seen.push(request);
        child.stdout.write(`${JSON.stringify({ id: request.id, ...respond(request, seen) })}\n`);
      }
    });
    setImmediate(() => child.stdout.write('{"ready":true,"pid":1}\n'));
    return child;
  };
  return { seen, launch };
};

it('asks the helper for the screen, and says plainly what it refused', async () => {
  const { seen, launch } = standIn((request) => {
    if (request.op === 'info') return { ok: true, result: { monitors: [{ index: 1, primary: true, left: 0, top: 0, width: 1920, height: 1200, scale: 1.25 }], userIdleMs: 90_000, locked: false } };
    if (request.op === 'capture') return { ok: true, result: { data: 'AAAA', left: 0, top: 0, width: 1920, height: 1200, monitor: 1, monitors: 1, primary: true } };
    if (request.kind === 'click' && request.x === 5) return { ok: false, refused: 'willow', error: "That point is on Willow's own window, which a bot never clicks." };
    return { ok: true, result: { cursor: { x: request.x, y: request.y }, foreground: { title: 'Notes', process: 'notepad', willow: false } } };
  });
  const screen = createScreen({ platform: 'win32', launch });
  try {
    assert.deepEqual(screen.requests, ['screen.info', 'screen.capture', 'screen.act', 'screen.apps', 'screen.elements', 'screen.element', 'screen.focus', 'screen.begin', 'screen.end']);
    assert.equal((await screen.handle('screen.info')).monitors[0].width, 1920);
    assert.equal((await screen.handle('screen.capture', { monitor: 1 })).data, 'AAAA');
    assert.deepEqual(seen.at(-1), { monitor: 1, id: 2, op: 'capture' });

    const clicked = await screen.handle('screen.act', { kind: 'click', x: 640.4, y: 400, button: 'left', clicks: 2, hold: 'ctrl', unexpected: 'dropped' });
    assert.equal(clicked.ok, true);
    assert.deepEqual(seen.at(-1), { kind: 'click', x: 640, y: 400, clicks: 2, button: 'left', hold: 'ctrl', id: 3, op: 'act' }, 'only what an action takes reaches the helper');
    assert.deepEqual(await screen.handle('screen.act', { kind: 'click', x: 5, y: 5 }), { ok: false, refused: 'willow', message: "That point is on Willow's own window, which a bot never clicks." });
    await assert.rejects(screen.handle('screen.act', { kind: 'format-disk' }), /Unknown action/);
  } finally {
    screen.dispose();
  }
});

it('waits out the user\'s own touch once, and gives up if they keep using the computer', async () => {
  let refusals = 1;
  const { seen, launch } = standIn((request) => {
    if (request.op === 'info') return { ok: true, result: { userIdleMs: 1_300 } };
    if (request.op === 'act' && refusals > 0) {
      refusals -= 1;
      return { ok: false, refused: 'user-active', error: 'The user is using the computer right now.' };
    }
    return { ok: true, result: { cursor: { x: 1, y: 1 } } };
  });
  const screen = createScreen({ platform: 'win32', launch });
  try {
    const started = Date.now();
    const moved = await screen.handle('screen.act', { kind: 'move', x: 1, y: 1 });
    assert.equal(moved.ok, true, 'the click that allowed it is waited out');
    assert.ok(Date.now() - started >= 300, 'until the user has been still long enough');
    assert.deepEqual(seen.map((request) => request.op), ['act', 'info', 'act']);

    refusals = 2;
    const refused = await screen.handle('screen.act', { kind: 'move', x: 1, y: 1 });
    assert.deepEqual(refused, { ok: false, refused: 'user-active', message: 'The user is using the computer right now.' });
  } finally {
    screen.dispose();
  }
});

it('reaches the open apps and their controls, carries the grant, and drives the overlay', async () => {
  const { seen, launch } = standIn((request) => {
    if (request.op === 'apps') return { ok: true, result: { apps: [{ title: 'Notes', process: 'notepad', pid: 42 }] } };
    if (request.op === 'elements') return { ok: true, result: { snapshot: 7, elements: [{ index: 0, role: 'button', name: 'Save', actions: ['invoke'] }] } };
    if (request.op === 'element' && request.index === 9) return { ok: false, error: 'There is no element 9 in that list.' };
    if (request.op === 'element') return { ok: true, result: { ok: true, name: 'Save' } };
    if (request.op === 'focus') return { ok: false, refused: 'willow', error: "That is Willow's own window, which a bot never brings forward." };
    if (request.op === 'begin') return { ok: true, result: { shown: true } };
    if (request.op === 'act' && request.grant === 'stopped-grant') return { ok: false, refused: 'stopped', error: 'The user stopped you using their screen.' };
    return { ok: true, result: { shown: false } };
  });
  const screen = createScreen({ platform: 'win32', launch });
  try {
    assert.equal(screen.platform, 'windows');
    assert.deepEqual(await screen.handle('screen.end'), { shown: false }, 'ending with no helper running starts nothing');
    assert.equal(seen.length, 0);

    assert.equal((await screen.handle('screen.apps')).apps[0].pid, 42);
    await screen.handle('screen.elements', { pid: '42', title: '  Notes ', bogus: 1 });
    assert.deepEqual(seen.at(-1), { pid: 42, title: 'Notes', id: 2, op: 'elements' }, 'only a window target reaches the helper');

    await screen.handle('screen.element', { snapshot: 7, index: 0, action: 'set_value', value: 'hello' });
    assert.deepEqual(seen.at(-1), { snapshot: 7, index: 0, action: 'set_value', value: 'hello', id: 3, op: 'element' });
    await assert.rejects(screen.handle('screen.element', { snapshot: 7, index: 9, action: 'invoke' }), /no element 9/);
    await assert.rejects(screen.handle('screen.element', { snapshot: 7, index: 0, action: 'delete-everything' }), /Unknown action on an element/);
    assert.deepEqual(await screen.handle('screen.focus', { process: 'willow-desktop' }), { ok: false, refused: 'willow', message: "That is Willow's own window, which a bot never brings forward." });

    await screen.handle('screen.begin', { name: 'Pip', color: '#7CACF8', grant: 'g1', session: 'dot-1', extra: true });
    assert.deepEqual(seen.at(-1), { name: 'Pip', color: '#7CACF8', grant: 'g1', session: 'dot-1', id: 6, op: 'begin' });
    await screen.handle('screen.begin', { name: 'Pip', color: 'red; DROP', grant: 'g1' });
    assert.equal(seen.at(-1).color, '', 'a colour is a hex colour or nothing');

    assert.deepEqual(await screen.handle('screen.act', { kind: 'click', x: 1, y: 1, grant: 'stopped-grant' }), { ok: false, refused: 'stopped', message: 'The user stopped you using their screen.' });
    assert.equal(seen.at(-1).grant, 'stopped-grant', 'the grant goes with each action, so one the user stopped is turned away');
  } finally {
    screen.dispose();
  }
});

it('passes on what the helper says by itself: the user stopping the bot from the overlay', async () => {
  const heard = [];
  let child;
  const launch = async () => {
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit('exit', 0);
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        const request = JSON.parse(line);
        child.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result: { shown: true } })}\n`);
      }
    });
    setImmediate(() => child.stdout.write('{"ready":true,"pid":1}\n'));
    return child;
  };
  const screen = createScreen({ platform: 'win32', launch, onEvent: (event) => heard.push(event) });
  try {
    await screen.handle('screen.begin', { name: 'Pip', grant: 'g1', session: 'dot-1' });
    child.stdout.write('{"event":"stopped","how":"escape","grant":"g1","session":"dot-1"}\n');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(heard, [{ event: 'stopped', how: 'escape', grant: 'g1', session: 'dot-1' }]);
  } finally {
    screen.dispose();
  }
});

it('builds the real helper with Windows\' own compiler, and it sees the screen in real pixels', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'willow-screen-'));
  const screen = createScreen({ dir });
  try {
    const info = await screen.handle('screen.info');
    assert.equal(info.platform, 'windows');
    assert.equal(info.mode, 'shared');
    assert.ok(Array.isArray(info.monitors) && info.monitors.length >= 1, 'it finds the screens');
    const main = info.monitors[0];
    assert.equal(main.primary, true, 'the main screen comes first');
    assert.ok(main.width > 0 && main.height > 0 && main.scale >= 1);
    assert.equal(typeof info.locked, 'boolean');
    // The overlay and UI Automation are built in with it: the open apps can be listed, with Willow's own left out.
    const { apps } = await screen.handle('screen.apps');
    assert.ok(Array.isArray(apps));
    assert.ok(apps.every((app) => app.process !== 'willow-desktop'));
    assert.ok((await readdir(dir)).some((name) => /^willow-screen-[0-9a-f]{12}\.exe$/.test(name)), 'kept by its source\'s hash');
  } finally {
    screen.dispose();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
