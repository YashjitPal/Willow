/**
 * Dots' own computers, for real: a companion with computers on, the shared
 * computer made (and the base built, the first time — a few minutes), two dots'
 * accounts on it used at once — screens that start when needed, desktop,
 * browser, shell, files and wheel,
 * driven through `machine.*` the way a page drives them — with each closed to
 * the other, and both removed again. Windows with WSL 2 only; it skips
 * elsewhere.
 *
 *   npm run companion:computers
 *
 * Uses a folder of its own (`WILLOW_COMPUTERS_DIR`, default the temp folder),
 * so it never touches the desktop app's computer.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const port = 43119;
const dir = process.env.WILLOW_COMPUTERS_DIR || path.join(os.tmpdir(), 'willow-computers-smoke');
const dotA = 'dot-computers-smoke-a';
const dotB = 'dot-computers-smoke-b';

const child = spawn(process.execPath, ['src/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, WILLOW_COMPANION_PORT: String(port), WILLOW_COMPUTERS_DIR: dir, WILLOW_COMPANION_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !(await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.ok).catch(() => false))) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});
const pending = new Map();
const events = [];
let counter = 0;
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === 'event') {
    events.push(message);
    if (message.event === 'machine.progress') process.stdout.write(`\r  ${message.payload.detail} ${Math.round(message.payload.fraction * 100)}%   `);
    return;
  }
  const waiter = message.id && pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.ok) waiter.resolve(message.result);
  else waiter.reject(new Error(message.error));
});
const request = (type, payload = {}, timeoutMs = 120_000) => new Promise((resolve, reject) => {
  const id = `smoke-${(counter += 1)}`;
  const timer = setTimeout(() => reject(new Error(`Timed out: ${type}`)), timeoutMs);
  pending.set(id, {
    resolve: (value) => { clearTimeout(timer); resolve(value); },
    reject: (error) => { clearTimeout(timer); reject(error); },
  });
  socket.send(JSON.stringify({ id, type, payload }));
});
const call = async (dotId, method, route, body, timeoutMs = 90_000) => request('machine.call', { dotId, method, path: route, body, timeoutMs, settings: { timeZone: 'UTC', locale: 'en-US' } }, timeoutMs + 600_000);
const run = async (dotId, command) => (await call(dotId, 'POST', '/exec', { command })).body;
const step = (label) => console.log(`\n${label}`);
const desktopOn = async (dotId) => {
  let screen = null;
  const by = Date.now() + 10 * 60_000;
  while (Date.now() < by) {
    screen = (await call(dotId, 'GET', '/state')).body;
    if (screen.desktop === 'on' || screen.desktop === 'unavailable') break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.equal(screen.desktop, 'on', screen.desktopProblem);
};

let failed = false;
try {
  const status = await request('machine.status', { dotId: dotA });
  if (!status.supported) {
    console.log(`Skipped: dots' computers are not available here (${status.reason}).`);
  } else {
    step(`WSL ${status.wslVersion}; computer ${status.base.ready ? 'ready' : 'to make (a few minutes, the first time)'}`);
    for (const dotId of [dotA, dotB]) assert.equal((await request('machine.create', { dotId }, 45 * 60_000)).state, 'stopped');

    step('Two dots at once');
    const [startedA, startedB] = await Promise.all([dotA, dotB].map((dotId) => request('machine.start', { dotId }, 600_000)));
    assert.equal(startedA.state, 'running');
    assert.equal(startedB.state, 'running');

    step('A screen when something needs it');
    for (const dotId of [dotA, dotB]) assert.equal((await call(dotId, 'GET', '/state')).body.desktop, 'off', 'a computer starts with its screen off');
    assert.equal((await run(dotA, 'echo works')).stdout.trim(), 'works');
    assert.equal((await call(dotA, 'GET', '/state')).body.desktop, 'off', 'a command without a window leaves it off');
    const offDisplayB = (await run(dotB, 'echo "$DISPLAY"')).stdout.trim();
    assert.match(offDisplayB, /^:\d+$/, 'commands are told where the screen is while it is off');
    assert.equal((await run(dotA, `DISPLAY=${offDisplayB} xdotool getmouselocation >/dev/null 2>&1 && echo open || echo closed`)).stdout.trim(), 'closed', 'another dot cannot reach a screen that is off');
    assert.equal((await call(dotB, 'GET', '/state')).body.desktop, 'off', 'nor start it');
    assert.match((await run(dotB, 'xdotool getmouselocation')).stdout, /^x:\d+ y:\d+/, 'a program that opens the screen starts it, and is handed through');
    assert.equal((await call(dotB, 'GET', '/state')).body.desktop, 'on');
    const [formA, pageB] = await Promise.all([
      call(dotA, 'POST', '/browser/navigate', { url: 'https://httpbin.org/forms/post' }),
      call(dotB, 'POST', '/browser/navigate', { url: 'https://example.com' }),
    ]);
    assert.equal(formA.status, 200, formA.body.error);
    assert.equal(pageB.status, 200, pageB.body.error);
    assert.match(pageB.body.url, /^https:\/\/example\.com\//);
    await desktopOn(dotA);

    step('Browsing');
    const snap = (await call(dotA, 'POST', '/browser/snapshot', {})).body;
    const ref = (role, name) => snap.elements.find((element) => element.role === role && name.test(element.name))?.ref;
    assert.equal((await call(dotA, 'POST', '/browser/type', { ref: ref('textbox', /Customer name/), snapshotId: snap.snapshotId, text: 'Smoke' })).status, 200);
    assert.equal((await call(dotA, 'POST', '/browser/click', { ref: ref('radio', /Medium/), snapshotId: snap.snapshotId })).status, 200);
    assert.equal((await call(dotA, 'POST', '/browser/click', { ref: ref('button', /Submit/), snapshotId: snap.snapshotId })).status, 200);
    const result = (await call(dotA, 'GET', '/browser/read')).body.text;
    assert.match(result, /"custname": "Smoke"/);
    assert.match(result, /"size": "medium"/);
    assert.equal((await call(dotA, 'POST', '/browser/click', { ref: 'e1', snapshotId: snap.snapshotId })).body.stale, true, 'refs retire with their page');

    step('Shell and files');
    const shell = (await run(dotA, `whoami; pwd; ls -A /mnt/c 2>/dev/null | wc -l; curl -s -m 3 http://127.0.0.1:${port}/health >/dev/null && echo loopback-open || echo loopback-blocked`)).stdout.trim().split('\n');
    assert.match(shell[0], /^d[0-9a-f]{10}$/, 'each dot is a user of its own');
    assert.deepEqual(shell.slice(1), [`/home/${shell[0]}/workspace`, '0', 'loopback-blocked']);
    assert.equal((await call(dotA, 'POST', '/files/write', { path: 'smoke/note.md', contents: 'hello' })).body.bytes, 5);
    assert.equal((await call(dotA, 'POST', '/files/read', { path: '~/workspace/smoke/note.md' })).body.text, 'hello');
    assert.equal((await call(dotA, 'POST', '/files/read', { path: '../.profile' })).status, 403);

    step('Each closed to the other');
    const [userB, displayB, portsB, uidB] = (await run(dotB, 'whoami; echo "$DISPLAY"; echo "$WILLOW_PORTS"; id -u; echo private > ~/workspace/secret.txt')).stdout.trim().split('\n');
    assert.notEqual(userB, shell[0]);
    const portB = Number(portsB.split('-')[0]);
    assert.match((await run(dotB, `nohup python3 -m http.server ${portB} --bind 127.0.0.1 >/dev/null 2>&1 & sleep 2; curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${portB}/`)).stdout, /200/, 'a dot reaches its own server');
    const probe = (await run(dotA, [
      `cat /home/${userB}/workspace/secret.txt >/dev/null 2>&1 && echo files-open || echo files-closed`,
      `DISPLAY=${displayB} xdotool getmouselocation >/dev/null 2>&1 && echo screen-open || echo screen-closed`,
      `ps -eo uid= | tr -d ' ' | grep -qx ${uidB} && echo processes-seen || echo processes-hidden`,
      `curl -s -m 3 http://127.0.0.1:${portB}/ >/dev/null && echo server-open || echo server-closed`,
      'apk del curl >/dev/null 2>&1 && echo removed || echo kept',
    ].join('; '))).stdout.trim().split('\n');
    assert.deepEqual(probe, ['files-closed', 'screen-closed', 'processes-hidden', 'server-closed', 'kept']);

    step('The desktop');
    const picture = (await call(dotA, 'GET', '/desktop/screenshot')).body;
    assert.equal(`${picture.width}x${picture.height}`, '1280x1024');
    assert.ok(picture.data.length > 10_000, 'the screen has something on it');
    const display = (await run(dotA, 'echo "$DISPLAY"; grep -c "@/tmp/.X11-unix" /proc/net/unix; rm -f typed.txt; nohup mousepad typed.txt >/dev/null 2>&1 & sleep 4')).stdout.trim().split('\n');
    assert.notEqual(display[0], displayB, 'a screen of its own');
    assert.equal(display[1], '0', 'on no socket other distros can reach');
    const typed = (await call(dotA, 'POST', '/desktop/type', { text: 'Typed on the desktop.\nSecond line.' })).body;
    assert.match(typed.active ?? '', /Mousepad/);
    assert.equal(typed.screenshot.width, 1280);
    await call(dotA, 'POST', '/desktop/key', { key: 'ctrl+s' });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal((await call(dotA, 'POST', '/files/read', { path: 'typed.txt' })).body.text, 'Typed on the desktop.\nSecond line.');
    assert.equal((await call(dotA, 'POST', '/desktop/click', { x: 5_000, y: 10 })).status, 400);

    step('The desktop\'s browser');
    await run(dotB, 'chromium https://example.org >/dev/null 2>&1');
    let pageOfB = '';
    for (let tries = 0; tries < 60 && !/example\.org/.test(pageOfB); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      pageOfB = (await call(dotB, 'GET', '/state')).body.url ?? '';
    }
    assert.match(pageOfB, /^https:\/\/example\.org\//, 'a browser started on the desktop is the dot\'s own, the one the service runs');
    assert.equal((await run(dotB, 'ps -u "$USER" -o args= | grep "^/usr/lib/chromium/chromium " | grep -v -- --type= | grep -vc -- --remote-debugging-pipe')).stdout.trim(), '0', 'and no other');

    step('The wheel');
    const asked = (await call(dotA, 'POST', '/control/request', { reason: 'Smoke test' })).body.request;
    assert.equal((await call(dotA, 'POST', '/browser/navigate', { url: 'https://example.com' })).body.humanHasControl, true);
    assert.equal((await call(dotB, 'POST', '/browser/navigate', { url: 'https://example.com' })).status, 200, 'one dot\'s wheel is its own');
    assert.equal((await call(dotA, 'POST', '/control/take', { requestId: asked.id })).body.holder, 'human');
    assert.equal((await call(dotA, 'POST', '/human/navigate', { url: 'https://example.com' })).status, 200);
    assert.equal((await call(dotA, 'POST', '/control/release', { requestId: asked.id })).body.holder, 'bot');
    assert.equal((await call(dotA, 'POST', '/browser/navigate', { url: 'https://example.com' })).body.snapshotRequired, true, 'handed back, the dot looks first');

    step('Watching');
    await request('machine.watch', { dotId: dotA, on: true });
    const watchUntil = Date.now() + 8_000;
    while (Date.now() < watchUntil && !events.some((message) => message.event === 'machine.frame')) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await request('machine.watch', { dotId: dotA, on: false });
    const frame = events.find((message) => message.event === 'machine.frame');
    assert.ok(frame, 'frames reach a watching page');
    assert.equal(frame.payload.dotId, dotA);
    assert.equal(`${frame.payload.width}x${frame.payload.height}`, '1280x1024', 'the whole desktop');
    assert.ok(events.some((message) => message.event === 'machine.control'), 'the wheel is announced');

    step('One off, the other on');
    assert.equal((await request('machine.stop', { dotId: dotB })).state, 'stopped');
    assert.equal((await call(dotA, 'GET', '/browser/read')).status, 200, 'the other dot works on');
    console.log('\nComputers smoke test passed.');
  }
} catch (error) {
  failed = true;
  console.error(`\nComputers smoke test failed: ${error.stack || error.message}`);
} finally {
  for (const dotId of [dotA, dotB]) await request('machine.remove', { dotId }, 300_000).catch(() => undefined);
  socket.close();
  child.kill();
}
process.exit(failed ? 1 : 0);
