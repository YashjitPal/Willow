/**
 * A bot's own computer, against a fake machine: its tools (OpenBot's), the
 * setup the first one asks for, the wheel — help, takeover, handing back —
 * and what the bot hears of each, plus the prompt section that describes it.
 * The real machine is exercised by `services/local-companion` (see its AGENTS.md).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);

const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const { machineTools, helpOutcome, openHelpRequests, pendingSetupRequests, setupAnswer } = await importTs(harness('tools', 'machine-tools.ts'));
const access = await importTs(harness('runtime', 'machine-access.ts'));
const { createDotSystemPrompt } = await importTs(harness('overlay', 'dot-profile.ts'));
const { renderOutput } = await importTs(harness('memory', 'render.ts'));
const { wakesDot } = await importTs(harness('thread', 'thread-types.ts'));
const wallpaper = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'computer', 'dot-wallpaper.ts'));

store.setDotThreadPersistence(memoryPersistence());

let dotCounter = 0;
const newDot = async () => {
  dotCounter += 1;
  const dotId = `dot-machine-${dotCounter}`;
  await store.loadDotThread(dotId);
  return dotId;
};
const items = (dotId, kind) => store.getDotThread(dotId).items.filter((item) => !kind || item.kind === kind);
const machineEvents = (dotId) => items(dotId, 'event').filter((item) => item.event === 'machine');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** A machine that answers by route, remembers what it was asked, and lets a test push its events. */
const fakeMachine = (routes = {}) => {
  const calls = [];
  const created = new Set();
  const woken = [];
  let listener = null;
  const summary = (dotId) => ({ dotId, state: created.has(dotId) ? 'running' : 'none', error: null, egress: 'on', startedAt: null, createdAt: null, screen: null, control: null, progress: null });
  const bridge = {
    status: async (dotId) => ({ supported: true, reason: null, detail: null, wslVersion: '2.6.3', base: { ready: true, building: false, progress: null }, machine: summary(dotId) }),
    create: async (dotId) => {
      created.add(dotId);
      return summary(dotId);
    },
    start: async (dotId) => summary(dotId),
    stop: async (dotId) => summary(dotId),
    reset: async (dotId) => summary(dotId),
    remove: async () => undefined,
    call: async (dotId, request) => {
      calls.push({ dotId, ...request });
      const route = routes[`${request.method} ${request.path.split('?')[0]}`];
      return route ? route(request) : { status: 404, body: { error: 'Not found.' } };
    },
    watch: async () => undefined,
    installWsl: async () => undefined,
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  const deps = { machine: bridge, now: () => Date.now(), wake: (dotId) => woken.push(dotId) };
  return { bridge, deps, calls, created, woken, emit: (event) => listener?.(event) };
};

const toolsFor = (dotId, bridge, ready) => {
  const env = { dotId, dotName: 'Ada', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: false, machine: { bridge, ready } };
  return Object.fromEntries(machineTools(env).map((entry) => [entry.handler.id, entry.handler]));
};
const context = (turnId = 't1') => ({ dotId: '', turnId, readFiles: () => ({}), writeFiles: () => undefined, emit: () => '', patch: () => undefined, stopTurn: () => undefined });

it('offers OpenBot\'s computer tools and the desktop\'s, every one named for the dot\'s own computer', async () => {
  const dotId = await newDot();
  const { bridge } = fakeMachine();
  const names = Object.keys(toolsFor(dotId, bridge, true));
  assert.deepEqual(names, [
    'computer_navigate', 'computer_read', 'computer_snapshot', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll',
    'computer_screenshot', 'computer_zoom', 'computer_desktop_click', 'computer_desktop_move', 'computer_desktop_type', 'computer_desktop_key', 'computer_desktop_scroll', 'computer_desktop_drag',
    'computer_request_help', 'computer_request_secret', 'computer_list_files', 'computer_read_file', 'computer_write_file', 'computer_apply_patch', 'computer_run_command',
  ]);
});

it('edits code on its own computer with Codex\'s patch format, changing nothing when any part fails', async () => {
  const dotId = await newDot();
  const files = new Map([['app/main.py', 'def main():\n    print("hi")\n']]);
  const { bridge } = fakeMachine({
    'POST /files/read': ({ body }) => (files.has(body.path) ? { status: 200, body: { path: body.path, bytes: files.get(body.path).length, text: files.get(body.path), next: null } } : { status: 404, body: { error: 'No such file.' } }),
    'POST /files/write': ({ body }) => (files.set(body.path, body.contents), { status: 200, body: { path: body.path, bytes: body.contents.length } }),
  });
  const patch = toolsFor(dotId, bridge, true).computer_apply_patch;
  const edited = await patch.run({ patch: '*** Begin Patch\n*** Update File: app/main.py\n@@ def main():\n-    print("hi")\n+    print("hello")\n*** Add File: app/test_main.py\n+from main import main\n*** End Patch' }, context());
  assert.equal(edited.failed, undefined, edited.observation);
  assert.match(edited.observation, /updated app\/main\.py \(\+1 −1\); added app\/test_main\.py \(\+1 −0\)/);
  assert.equal(files.get('app/main.py'), 'def main():\n    print("hello")\n');
  assert.equal(files.get('app/test_main.py'), 'from main import main\n');

  const before = new Map(files);
  const broken = await patch.run({ patch: '*** Begin Patch\n*** Update File: app/main.py\n@@\n-    print("hello")\n+    print("bye")\n*** Update File: app/missing.py\n@@\n-x\n+y\n*** End Patch' }, context());
  assert.equal(broken.failed, true);
  assert.match(broken.observation, /app\/missing\.py does not exist/);
  assert.deepEqual(files, before, 'a patch that fails anywhere changes nothing');
  assert.match((await patch.run({ patch: '*** Begin Patch\n*** Delete File: app/main.py\n*** End Patch' }, context())).observation, /with computer_run_command/);
  assert.match((await patch.run({ patch: '*** Begin Patch\n*** Update File: /etc/passwd\n@@\n-a\n+b\n*** End Patch' }, context())).observation, /not a file inside/);
});

it('sees the desktop as a picture, acts on it by pixel, and gets the screen each action left', async () => {
  const dotId = await newDot();
  const picture = (tag) => ({ data: Buffer.from(`jpeg ${tag}`).toString('base64'), width: 1280, height: 1024 });
  const { bridge, calls } = fakeMachine({
    'GET /desktop/screenshot': () => ({ status: 200, body: { ...picture('now'), active: 'notes.txt - Mousepad' } }),
    'POST /desktop/click': (request) => ({ status: 200, body: { action: 'click', ...request.body, active: 'notes.txt - Mousepad', screenshot: picture('after click') } }),
    'POST /desktop/type': (request) => ({ status: 200, body: { action: 'type', characters: request.body.text.length, screenshot: picture('after typing') } }),
    'POST /desktop/key': () => ({ status: 200, body: { action: 'key', key: 'ctrl+s', screenshot: picture('after saving') } }),
    'POST /desktop/scroll': (request) => ({ status: 200, body: { action: 'scroll', ...request.body } }),
    'POST /desktop/drag': (request) => ({ status: 400, body: { error: `(${request.body.toX}, ${request.body.toY}) is off the screen, which is 1280×1024 pixels.` } }),
  });
  const tools = toolsFor(dotId, bridge, true);

  const looked = await tools.computer_screenshot.run({}, context());
  assert.match(looked.observation, /^Screenshot of your screen\. The window in front is "notes\.txt - Mousepad"\. It comes as a picture of 1280×1024 pixels; give positions in its pixels, from its top left corner\. The picture comes with this step's results/);
  assert.deepEqual(looked.images, [{ type: 'image', mimeType: 'image/jpeg', data: picture('now').data }]);

  const clicked = await tools.computer_desktop_click.run({ x: 640, y: 400, clicks: 2 }, context());
  assert.deepEqual(calls.at(-1).body, { x: 640, y: 400, button: 'left', clicks: 2 });
  assert.equal(clicked.observation, 'Double-clicked at (640, 400). The window in front is "notes.txt - Mousepad". The screen afterwards comes with this step\'s results.');
  assert.equal(clicked.images[0].data, picture('after click').data);

  assert.match((await tools.computer_desktop_type.run({ text: 'Dear Sam,\nThanks.' }, context())).observation, /^Typed 17 characters\./);
  assert.equal((await tools.computer_desktop_key.run({ key: 'ctrl+s' }, context())).images[0].data, picture('after saving').data);

  const scrolled = await tools.computer_desktop_scroll.run({ x: 640, y: 500, deltaY: -300 }, context());
  assert.equal(scrolled.observation, 'Scrolled up 300 pixels at (640, 500).');
  assert.equal(scrolled.images, undefined, 'no picture came back, so none is promised');

  const missing = await tools.computer_desktop_click.run({ x: 'left' }, context());
  assert.equal(missing.failed, true);
  assert.match(missing.observation, /Give "x" and "y"/);
  const offScreen = await tools.computer_desktop_drag.run({ x: 10, y: 10, toX: 2000, toY: 10 }, context());
  assert.equal(offScreen.failed, true);
  assert.match(offScreen.observation, /\(2000, 10\) is not on your screenshot/);
  assert.equal(calls.filter((call) => call.path === '/desktop/drag').length, 0, 'a position off the picture never reaches the computer');
});

/** A renderer that draws nothing but says what it was asked: the picture's size, its crop, its marks and rulers. */
const fakeRender = () => {
  const plans = [];
  const render = async (source, plan) => {
    plans.push(plan);
    const margin = plan.rulers ? 26 : 0;
    return { data: Buffer.from(`drawn ${plans.length}`).toString('base64'), width: plan.size.width + margin, height: plan.size.height + margin, mimeType: 'image/jpeg' };
  };
  return { plans, render };
};

it('points the way each model points, and turns its positions into the screen\'s own pixels', async () => {
  const { visionProfile } = await importTs(harness('runtime', 'screen-view.ts'));
  const shot = { data: Buffer.from('jpeg').toString('base64'), width: 1280, height: 1024 };
  const cases = [
    // Gemini points on a 1000 × 1000 grid; the picture goes at the screen's size.
    { provider: 'gemini', model: 'gemini-3.8-flash', picture: [1280, 1024], click: { x: 500, y: 500 }, screen: { x: 640, y: 512 }, words: /1000 × 1000 grid/ },
    // Claude's API keeps up to about 1.15 megapixels: the picture is sent at that size, and its pixels are the positions.
    { provider: 'anthropic', model: 'claude-sonnet-5', picture: [1198, 959], click: { x: 1197, y: 958 }, screen: { x: 1279, y: 1023 }, words: /picture of 1198×959 pixels/ },
    // OpenAI's keeps 768 on the short side, and so does any other API's.
    { provider: 'openai', model: 'gpt-5.6', picture: [960, 768], click: { x: 480, y: 384 }, screen: { x: 640, y: 512 }, words: /picture of 960×768 pixels/ },
    { provider: 'openai', model: 'google/gemini-3-pro', picture: [1280, 1024], click: { x: 250, y: 750 }, screen: { x: 320, y: 768 }, words: /1000 × 1000 grid/ },
  ];
  for (const sample of cases) {
    const dotId = await newDot();
    const { plans, render } = fakeRender();
    const { bridge, calls } = fakeMachine({
      'GET /desktop/screenshot': () => ({ status: 200, body: shot }),
      'POST /desktop/click': (request) => ({ status: 200, body: { action: 'click', ...request.body, screenshot: shot } }),
    });
    const env = { dotId, dotName: 'Ada', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: false, machine: { bridge, ready: true }, vision: { profile: visionProfile(sample.provider, sample.model), render } };
    const tools = Object.fromEntries(machineTools(env).map((entry) => [entry.handler.id, entry.handler]));
    const looked = await tools.computer_screenshot.run({}, context());
    assert.match(looked.observation, sample.words, sample.model);
    const clicked = await tools.computer_desktop_click.run(sample.click, context());
    assert.ok(!clicked.failed, clicked.observation);
    assert.deepEqual({ x: calls.at(-1).body.x, y: calls.at(-1).body.y }, sample.screen, `${sample.model}: the screen's own pixel`);
    assert.match(clicked.observation, new RegExp(`^Clicked at \\(${sample.click.x}, ${sample.click.y}\\)\\. The screen afterwards comes with this step's results, a ring marking where you acted`));
    const last = plans.at(-1);
    assert.deepEqual([last.size.width, last.size.height], sample.picture, `${sample.model}: a picture its API keeps as it is`);
    assert.deepEqual(last.marks, [{ at: sample.screen, kind: 'point' }], 'the ring is where the click landed');
  }
});

it('never reads one model\'s positions on another\'s picture, when the model changes between them', async () => {
  const { visionProfile } = await importTs(harness('runtime', 'screen-view.ts'));
  const dotId = await newDot();
  const shot = { data: Buffer.from('jpeg').toString('base64'), width: 1280, height: 1024 };
  const { bridge, calls } = fakeMachine({
    'GET /desktop/screenshot': () => ({ status: 200, body: shot }),
    'POST /desktop/click': (request) => ({ status: 200, body: { action: 'click', ...request.body } }),
  });
  const envFor = (provider, model) => ({ dotId, dotName: 'Ada', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: false, machine: { bridge, ready: true }, vision: { profile: visionProfile(provider, model), render: fakeRender().render } });
  const gemini = Object.fromEntries(machineTools(envFor('gemini', 'gemini-3.8-flash')).map((entry) => [entry.handler.id, entry.handler]));
  await gemini.computer_screenshot.run({}, context());
  // Then the user picks Claude: its pixels are on the picture it would be sent, not on Gemini's grid.
  const claude = Object.fromEntries(machineTools(envFor('anthropic', 'claude-sonnet-5')).map((entry) => [entry.handler.id, entry.handler]));
  await claude.computer_desktop_click.run({ x: 599, y: 479 }, context());
  assert.deepEqual({ x: calls.at(-1).body.x, y: calls.at(-1).body.y }, { x: 640, y: 511 });
});

it('looks closer at a region with rulers in the bot\'s own positions, and acts with them', async () => {
  const { visionProfile } = await importTs(harness('runtime', 'screen-view.ts'));
  const dotId = await newDot();
  const { plans, render } = fakeRender();
  const shot = { data: Buffer.from('jpeg').toString('base64'), width: 1280, height: 1024 };
  const { bridge, calls } = fakeMachine({
    'GET /desktop/screenshot': () => ({ status: 200, body: shot }),
    'POST /desktop/move': (request) => ({ status: 200, body: { action: 'move', ...request.body, screenshot: shot } }),
    'POST /desktop/click': (request) => ({ status: 200, body: { action: 'click', ...request.body, held: ['ctrl'], screenshot: shot } }),
  });
  const env = { dotId, dotName: 'Ada', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: false, machine: { bridge, ready: true }, vision: { profile: visionProfile('gemini', 'gemini-3.8-flash'), render } };
  const tools = Object.fromEntries(machineTools(env).map((entry) => [entry.handler.id, entry.handler]));
  await tools.computer_screenshot.run({}, context());

  const closer = await tools.computer_zoom.run({ x: 400, y: 300, width: 100, height: 100 }, context());
  assert.ok(!closer.failed, closer.observation);
  assert.match(closer.observation, /^A closer look at \(400, 300\) to \(500, 400\) of your screen, magnified 4×/);
  const plan = plans.at(-1);
  assert.deepEqual(plan.crop, { left: 512, top: 307, width: 128, height: 103 }, 'the region, in the screen\'s pixels');
  assert.deepEqual([plan.size.width, plan.size.height], [512, 412]);
  assert.equal(plan.rulers.space, 'grid', 'its rulers speak the bot\'s positions');
  assert.equal((await tools.computer_zoom.run({ x: 990, y: 990, width: 1, height: 1 }, context())).failed, true, 'too small to magnify');

  const hovered = await tools.computer_desktop_move.run({ x: 450, y: 350 }, context());
  assert.match(hovered.observation, /^Moved the pointer to \(450, 350\)\./);
  assert.deepEqual(calls.at(-1).body, { x: 576, y: 358 });
  const picked = await tools.computer_desktop_click.run({ x: 450, y: 350, hold: 'ctrl' }, context());
  assert.deepEqual(calls.at(-1).body, { x: 576, y: 358, button: 'left', clicks: 1, hold: 'ctrl' });
  assert.match(picked.observation, /^Clicked holding ctrl at \(450, 350\)\./);
});

it('asks the user to set the computer up the first time, once, and respects a decline', async () => {
  const dotId = await newDot();
  const { bridge, deps, calls, woken } = fakeMachine();
  const tools = toolsFor(dotId, bridge, false);
  const first = await tools.computer_navigate.run({ url: 'example.com' }, context());
  assert.match(first.observation, /not set up yet, so nothing was done/);
  assert.equal(calls.length, 0, 'nothing reaches a computer that does not exist');
  const [request] = items(dotId, 'machine');
  assert.ok(request, 'a setup card is recorded');
  assert.match((await tools.computer_run_command.run({ command: 'ls' }, context())).observation, /already asked the user to set it up/);
  assert.equal(items(dotId, 'machine').length, 1);

  access.declineMachineSetup(dotId, request.id, deps);
  assert.equal(setupAnswer(store.getDotThread(dotId), request.id).machineStep, 'declined');
  assert.deepEqual(woken, [dotId]);
  const after = await tools.computer_navigate.run({ url: 'example.com' }, context());
  assert.equal(after.failed, true);
  assert.match(after.observation, /declined to set up your computer/);
  assert.equal(items(dotId, 'machine').length, 1, 'a decline is not asked again');
});

it('sets the computer up when the user agrees, and tells the bot it is ready', async () => {
  const dotId = await newDot();
  const { bridge, deps, created, woken } = fakeMachine();
  await toolsFor(dotId, bridge, false).computer_snapshot.run({}, context());
  const [request] = items(dotId, 'machine');
  assert.equal(await access.setUpMachine(dotId, deps), null);
  assert.ok(created.has(dotId));
  assert.ok(store.getDotThread(dotId).runtime.machine.allowedAt > 0);
  const steps = machineEvents(dotId).map((item) => [item.machineStep, item.ref]);
  assert.deepEqual(steps, [['allowed', request.id], ['ready', request.id]]);
  assert.equal(pendingSetupRequests(store.getDotThread(dotId)).length, 0);
  assert.deepEqual(woken, [dotId]);

  const unasked = await newDot();
  assert.equal(await access.setUpMachine(unasked, deps), null);
  const [note] = machineEvents(unasked);
  assert.equal(note.machineStep, 'allowed');
  assert.equal(wakesDot(note), false, 'set up unasked, there is nothing for the bot to do yet');
});

it('opens and reads pages, and continues a long one from where it stopped', async () => {
  const dotId = await newDot();
  const { bridge, calls } = fakeMachine({
    'POST /browser/navigate': () => ({ status: 200, body: { url: 'https://example.com/', title: 'Example Domain', text: 'This domain is for use in examples.', truncated: true, next: 8000, notes: ['The browser downloaded a.pdf into Downloads/ in your workspace.'] } }),
    'GET /browser/read': (request) => ({ status: 200, body: { url: 'https://example.com/', title: 'Example Domain', text: `rest from ${request.path.split('=')[1]}`, truncated: false, next: null } }),
  });
  const tools = toolsFor(dotId, bridge, true);
  const opened = (await tools.computer_navigate.run({ url: 'example.com' }, context())).observation;
  assert.match(opened, /^Example Domain\nhttps:\/\/example\.com\/\n\nThis domain is for use in examples\./);
  assert.match(opened, /read the rest with computer_read and "offset": 8000/);
  assert.match(opened, /downloaded a\.pdf/);
  assert.deepEqual(calls[0].body, { url: 'example.com' });
  assert.match((await tools.computer_read.run({ offset: 8000 }, context())).observation, /from character 8000[\s\S]*rest from 8000/);
});

it('turns a challenge page into one card asking the user to take over', async () => {
  const dotId = await newDot();
  const challenge = { kind: 'cloudflare', reason: 'This site is showing a Cloudflare security check.', requestId: 'req-cf' };
  const { bridge } = fakeMachine({
    'POST /browser/navigate': () => ({ status: 200, body: { url: 'https://shop.test/', title: 'Just a moment…', text: 'Checking your browser', challenge } }),
    'POST /browser/snapshot': () => ({ status: 200, body: { snapshotId: 4, url: 'https://shop.test/', title: 'Just a moment…', elements: [], challenge } }),
  });
  const tools = toolsFor(dotId, bridge, true);
  assert.match((await tools.computer_navigate.run({ url: 'shop.test' }, context())).observation, /a check that a person has to clear \(Cloudflare\)/);
  await tools.computer_snapshot.run({}, context());
  const cards = items(dotId, 'help');
  assert.equal(cards.length, 1, 'the same request is one card');
  assert.deepEqual(cards[0].help, { requestId: 'req-cf', kind: 'takeover', reason: challenge.reason, source: 'cloudflare', url: 'https://shop.test/', title: 'Just a moment…' });
  assert.equal(renderOutput(cards[0]), '', 'the card reads to the model as the call that made it');
});

it('lists what can be acted on, one line each, and acts by ref', async () => {
  const dotId = await newDot();
  const { bridge, calls } = fakeMachine({
    'POST /browser/snapshot': () => ({
      status: 200,
      body: {
        snapshotId: 7,
        url: 'https://httpbin.org/forms/post',
        title: 'Order',
        truncated: true,
        elements: [
          { ref: 'e1', role: 'textbox', name: 'Customer name:', value: 'Ada' },
          { ref: 'e2', role: 'radio', name: 'Medium', checked: false },
          { ref: 'e3', role: 'checkbox', name: 'Bacon', checked: true },
          { ref: 'e4', role: 'button', name: 'Submit order', disabled: true },
        ],
      },
    }),
    'POST /browser/click': () => ({ status: 200, body: { action: 'click', ref: 'e2', element: { role: 'radio', name: 'Medium' }, url: 'https://httpbin.org/forms/post' } }),
    'POST /browser/type': () => ({ status: 200, body: { action: 'type', ref: 'e1', element: { role: 'textbox', name: 'Customer name:' }, characters: 10, submitted: true, url: 'https://httpbin.org/post' } }),
  });
  const tools = toolsFor(dotId, bridge, true);
  const listing = (await tools.computer_snapshot.run({}, context())).observation;
  assert.match(listing, /^Snapshot 7 of "Order" https:\/\/httpbin\.org\/forms\/post: 4 things you can act on\./);
  assert.match(listing, /\ne1 textbox "Customer name:", value "Ada"\n/);
  assert.match(listing, /\ne2 radio "Medium", not checked\n/);
  assert.match(listing, /\ne3 checkbox "Bacon", checked\n/);
  assert.match(listing, /\ne4 button "Submit order", disabled/);
  assert.match(listing, /scroll and take another snapshot/);
  assert.match((await tools.computer_click.run({ ref: 'e2', snapshotId: 7 }, context())).observation, /^Clicked the radio "Medium"\./);
  const typed = (await tools.computer_type.run({ ref: 'e1', snapshotId: 7, text: 'Willow Bot', submit: true }, context())).observation;
  assert.equal(typed, 'Entered 10 characters into the textbox "Customer name:" and pressed Enter. The page is now https://httpbin.org/post.');
  assert.deepEqual(calls.at(-1).body, { ref: 'e1', snapshotId: 7, text: 'Willow Bot', submit: true });
});

it('is refused while a person has the computer, and woken when they hand it back', async () => {
  const dotId = await newDot();
  const { bridge, deps, woken, emit } = fakeMachine({
    'POST /browser/click': () => ({ status: 409, body: { error: 'A person has control of this computer.', humanHasControl: true } }),
    'POST /control/request': () => ({ status: 200, body: { holder: 'bot', requested: true, request: { id: 'req-1', reason: 'Sign in for me', source: 'model', status: 'waiting' }, screen: { url: 'https://mail.test/login', title: 'Sign in' } } }),
    // What the watcher's first look finds: the request still waiting.
    'GET /control': () => ({ status: 200, body: { holder: 'bot', requested: true, request: { id: 'req-1', reason: 'Sign in for me', source: 'model', status: 'waiting' } } }),
  });
  await access.setUpMachine(dotId, deps);
  woken.length = 0;
  const tools = toolsFor(dotId, bridge, true);
  const refused = await tools.computer_click.run({ ref: 'e1', snapshotId: 1 }, context());
  assert.equal(refused.failed, true);
  assert.match(refused.observation, /A person has your computer right now/);
  assert.ok(store.getDotThread(dotId).runtime.machine.blockedAt, 'the refusal is remembered');

  const asked = await tools.computer_request_help.run({ reason: 'Sign in for me' }, context());
  assert.match(asked.observation, /Asked the user to take over your computer \(i\d+\)/);
  const [card] = items(dotId, 'help');
  assert.deepEqual(card.help, { requestId: 'req-1', kind: 'takeover', reason: 'Sign in for me', source: 'model', url: 'https://mail.test/login', title: 'Sign in' });

  const stop = access.watchDotMachines(() => deps);
  after(stop);
  emit({ type: 'control', dotId, control: { holder: 'human', since: '', requested: false, request: { id: 'req-1', reason: 'Sign in for me', source: 'model', status: 'taken', createdAt: '', updatedAt: '' }, resumeSnapshotRequired: false } });
  await settle();
  const taken = machineEvents(dotId).find((item) => item.machineStep === 'taken');
  assert.equal(taken.ref, card.id);
  assert.equal(wakesDot(taken), false, 'taking the wheel gives the bot nothing to do');
  // The watcher follows every bot; earlier tests' bots have no computer here, and theirs settle too.
  const wokenHere = () => woken.filter((id) => id === dotId);
  assert.deepEqual(wokenHere(), []);

  emit({ type: 'control', dotId, control: { holder: 'bot', since: '', requested: false, request: { id: 'req-1', reason: 'Sign in for me', source: 'model', status: 'completed', createdAt: '', updatedAt: '' }, resumeSnapshotRequired: true } });
  emit({ type: 'control', dotId, control: { holder: 'bot', since: '', requested: false, request: { id: 'req-1', reason: 'Sign in for me', source: 'model', status: 'completed', createdAt: '', updatedAt: '' }, resumeSnapshotRequired: true } });
  await settle();
  const returned = helpOutcome(store.getDotThread(dotId), card.id);
  assert.equal(returned.machineStep, 'returned');
  assert.match(returned.text, /Look again — a snapshot of the page, or a screenshot — before you act/);
  assert.equal(wakesDot(returned), true);
  assert.deepEqual(wokenHere(), [dotId], 'woken once, however often the computer repeats itself');
  assert.equal(machineEvents(dotId).filter((item) => item.machineStep === 'returned').length, 1);
  assert.equal(store.getDotThread(dotId).runtime.machine.blockedAt, undefined);
  assert.equal(openHelpRequests(store.getDotThread(dotId)).length, 0);
});

it('settles a request the computer no longer knows as interrupted', async () => {
  const dotId = await newDot();
  const { bridge, deps, emit } = fakeMachine({
    'POST /control/request': () => ({ status: 200, body: { request: { id: 'req-old', source: 'model', status: 'waiting' } } }),
    'GET /control': () => ({ status: 404, body: { error: 'That request for help was not found.' } }),
  });
  await access.setUpMachine(dotId, deps);
  const tools = toolsFor(dotId, bridge, true);
  await tools.computer_request_help.run({ reason: 'Choose a seat' }, context());
  const [card] = items(dotId, 'help');
  after(access.watchDotMachines(() => deps));
  // Another request is current now: the old one is asked after by id, and the computer no longer knows it.
  emit({ type: 'control', dotId, control: { holder: 'bot', since: '', requested: true, request: { id: 'req-new', source: 'cloudflare', status: 'waiting', reason: '', createdAt: '', updatedAt: '' }, resumeSnapshotRequired: false } });
  await settle();
  const ended = helpOutcome(store.getDotThread(dotId), card.id);
  assert.equal(ended.machineStep, 'interrupted');
  assert.equal(wakesDot(ended), true);
});

it('takes a secret straight to the field, and never into the thread', async () => {
  const dotId = await newDot();
  const supplied = [];
  const { bridge, deps, woken } = fakeMachine({
    'POST /control/secret': () => ({ status: 200, body: { holder: 'bot', secretWanted: 'the code sent to your phone', secretRef: 'e7', secretRequestedAt: '2026-10-06T10:00:00.000Z' } }),
    'POST /human/secret': (request) => {
      supplied.push(request.body.text);
      return { status: 200, body: { supplied: true, characters: request.body.text.length } };
    },
  });
  await access.setUpMachine(dotId, deps);
  woken.length = 0;
  const asked = await toolsFor(dotId, bridge, true).computer_request_secret.run({ label: 'the code sent to your phone', ref: 'e7', snapshotId: 3 }, context());
  assert.match(asked.observation, /you will not see it/);
  const [card] = items(dotId, 'help');
  assert.equal(card.help.kind, 'secret');
  assert.equal(await access.enterSecret(dotId, card.id, '481516', deps), null);
  assert.deepEqual(supplied, ['481516']);
  assert.equal(helpOutcome(store.getDotThread(dotId), card.id).machineStep, 'entered');
  assert.deepEqual(woken, [dotId]);
  assert.ok(!JSON.stringify(store.getDotThread(dotId)).includes('481516'), 'the value is nowhere in the thread');
});

it('reports a command\'s outcome, and works with files in the dot\'s own folder', async () => {
  const dotId = await newDot();
  const { bridge, calls } = fakeMachine({
    'POST /exec': (request) => ({ status: 200, body: request.body.command === 'false'
      ? { exitCode: 1, stdout: '', stderr: 'nope\n', truncated: false, timedOut: false }
      : { exitCode: 0, stdout: 'dot\n', stderr: '', truncated: true, timedOut: false } }),
    'POST /files/list': () => ({ status: 200, body: { path: '.', entries: [{ path: 'notes', kind: 'folder' }, { path: 'notes/today.md', kind: 'file', bytes: 26 }, { path: 'node_modules', kind: 'folder', skipped: true }], truncated: false } }),
    'POST /files/read': () => ({ status: 200, body: { path: 'notes/today.md', bytes: 26, text: '# Today\nBuy milk\n', offset: 0, next: null } }),
    'POST /files/write': (request) => ({ status: 200, body: { path: request.body.path, bytes: 2_048, appended: request.body.append } }),
  });
  const tools = toolsFor(dotId, bridge, true);
  const ran = await tools.computer_run_command.run({ command: 'whoami', timeout_seconds: 900 }, context());
  assert.equal(ran.failed, undefined);
  assert.match(ran.observation, /^It exited with code 0\.\nOutput:\ndot\n\[Earlier output was cut; this is its end\.\]$/);
  assert.equal(calls.at(-1).body.timeoutMs, 600_000, 'at most ten minutes');
  const failed = await tools.computer_run_command.run({ command: 'false' }, context());
  assert.equal(failed.failed, true);
  assert.match(failed.observation, /exited with code 1\.\nErrors:\nnope/);
  const listing = (await tools.computer_list_files.run({}, context())).observation;
  assert.equal(listing, 'notes/\nnotes/today.md — 26 B\nnode_modules/ (not opened)');
  assert.match((await tools.computer_read_file.run({ path: 'notes/today.md' }, context())).observation, /^notes\/today\.md — 26 B:\n# Today/);
  assert.equal((await tools.computer_write_file.run({ path: 'a.csv', contents: 'x', append: true }, context())).observation, 'Added to a.csv; it is now 2.0 KB.');
});

it('describes the dot\'s own computer as principles, set up or not', () => {
  const base = { dotName: 'Ada', tools: [], skills: [] };
  const without = createDotSystemPrompt(base);
  assert.doesNotMatch(without, /# Your computer/);
  assert.match(without, /or that needs a web browser/);
  const ready = createDotSystemPrompt({ ...base, machine: { ready: true } });
  assert.match(ready, /# Your computer\n\nYou have a computer of your own/);
  assert.match(ready, /your own account on a Linux machine/);
  assert.match(ready, /a folder \(~\/workspace\)/);
  assert.match(ready, /other bots have accounts of their own on the same machine, closed to you as yours is to them/);
  assert.match(ready, /Never ask for a password or a code in a message/);
  assert.match(ready, /with a desktop, a web browser, a shell and a folder/);
  assert.match(ready, /you see with `computer_screenshot` and use with the `computer_desktop_` tools/);
  assert.match(ready, /one of your own ports, whose range is in `\$WILLOW_PORTS`/);
  assert.doesNotMatch(ready, /or that needs a web browser/, 'browsing is the dot\'s own to do');
  const later = createDotSystemPrompt({ ...base, machine: { ready: false } });
  assert.match(later, /It is not set up yet/);
  const both = createDotSystemPrompt({ ...base, machine: { ready: true }, computer: { root: '/home/me/site', shell: '/bin/sh on Linux' } });
  assert.match(both, /# Your computer and theirs\n\nYou can work on two computers: your own, and their folder, \/home\/me\/site\./);
  assert.match(both, /Go where the work's things are/);
  assert.match(both, /goes across with `transfer_file`/);
  assert.doesNotMatch(both, /their screen comes last/, 'no screen to choose without the whole computer');
  assert.match(both, /`user_files` lists, reads and searches/);
  assert.doesNotMatch(ready, /# Your computer and theirs|# The user's computer/, 'with only its own computer, there is nothing to choose');
  for (const prompt of [ready, later, both]) {
    assert.doesNotMatch(prompt.slice(0, prompt.indexOf('# Protocol')), /for example|for instance|e\.g\.|such as/i);
  }
});

it('dresses a dot\'s computer in Codex\'s Blue Hour, in the dot\'s colour, the same picture the profile shows', () => {
  const blue = wallpaper.dotWallpaperColors(null);
  assert.deepEqual(blue, [...wallpaper.BLUE_HOUR_STOPS], 'a bot without a colour of its own keeps the picture as it is');
  assert.deepEqual(wallpaper.dotWallpaperColors('#808080'), blue, 'and so does a grey one');
  const orange = wallpaper.dotWallpaperColors('#d74816');
  assert.equal(orange.length, blue.length);
  assert.ok(orange.every((color, index) => /^#[0-9a-f]{6}$/.test(color) && color !== blue[index]), 'every stop takes the dot\'s colour');
  assert.notDeepEqual(wallpaper.dotWallpaperColors('#37aae1'), orange, 'each colour its own picture');
  const service = fs.readFileSync(path.join(repoRoot, 'services', 'local-companion', 'src', 'computers', 'machine', 'service.mjs'), 'utf8');
  const source = /const wallpaperSvg = (\(c\) => [\s\S]*?<\/svg>`);/.exec(service)?.[1];
  assert.ok(source, 'the computer draws its wallpaper from the colours it is given');
  assert.equal(new Function(`return ${source}`)()(orange), wallpaper.dotWallpaperSvg(orange), 'the computer draws the picture the profile shows');
  assert.match(wallpaper.dotWallpaperUrl(orange), /^data:image\/svg\+xml,/);
});

it('themes a dot\'s browser in Codex\'s colours, in the dot\'s colour', () => {
  const blue = wallpaper.dotBrowserColors(null);
  assert.deepEqual(blue, { frame: '#a2b6ce', toolbar: '#d7e0e9' }, 'a bot without a colour of its own wears Codex\'s browser');
  assert.deepEqual(wallpaper.dotBrowserColors('#808080'), blue, 'and so does a grey one');
  const orange = wallpaper.dotBrowserColors('#d74816');
  assert.ok([orange.frame, orange.toolbar].every((color) => /^#[0-9a-f]{6}$/.test(color)));
  assert.notEqual(orange.frame, blue.frame, 'the frame takes the dot\'s colour');
  assert.notEqual(orange.toolbar, blue.toolbar, 'and so does the toolbar');
  const service = fs.readFileSync(path.join(repoRoot, 'services', 'local-companion', 'src', 'computers', 'machine', 'service.mjs'), 'utf8');
  const fallback = /const BROWSER_COLORS = (\{[^}]*\});/.exec(service)?.[1];
  assert.ok(fallback, 'the computer has the colours to wear before the page sends the dot\'s');
  assert.deepEqual(new Function(`return ${fallback}`)(), blue, 'and they are Codex\'s');
});

it('wakes the bot for what it can act on, not for interim steps', () => {
  for (const step of ['allowed', 'taken', 'reset', 'off']) assert.equal(wakesDot({ kind: 'event', event: 'machine', machineStep: step }), false, step);
  for (const step of ['ready', 'failed', 'declined', 'returned', 'cancelled', 'expired', 'interrupted', 'entered']) assert.equal(wakesDot({ kind: 'event', event: 'machine', machineStep: step }), true, step);
});
