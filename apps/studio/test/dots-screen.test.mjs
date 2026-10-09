/**
 * The user's own screen (their whole computer connected, in the desktop app), against a fake screen: asking to see
 * and use it, in each of the Permissions; positions in the model's own space, across monitors; what the screen turns
 * away and how the bot hears it; and copying files between the bot's computer and the user's. Plus the prompt's
 * sections for their screen and for choosing between the two computers.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);

const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const { userScreenTools } = await importTs(harness('tools', 'user-screen-tools.ts'));
const { transferTool } = await importTs(harness('tools', 'transfer-tools.ts'));
const control = await importTs(harness('runtime', 'screen-control.ts'));
const edits = await importTs(harness('runtime', 'edits.ts'));
const access = await importTs(harness('runtime', 'computer-access.ts'));
const { visionProfile } = await importTs(harness('runtime', 'screen-view.ts'));
const { createDotSystemPrompt } = await importTs(harness('overlay', 'dot-profile.ts'));
const { wakesDot } = await importTs(harness('thread', 'thread-types.ts'));

store.setDotThreadPersistence(memoryPersistence());

const HOME = 'C:\\Users\\Sam';
let counter = 0;
const newDot = async (permissions) => {
  counter += 1;
  const dotId = `dot-screen-${counter}`;
  await store.loadDotThread(dotId);
  store.updateDotRuntime(dotId, { computer: { root: 'C:\\', connectedAt: 1, whole: true, home: HOME }, ...(permissions ? { permissions } : {}) });
  return dotId;
};
const context = (turnId = 't1') => ({ turnId });
const items = (dotId, kind) => store.getDotThread(dotId).items.filter((item) => item.kind === kind);

/** Two monitors side by side, the main one 1920×1200 at 0,0 and a second 1280×1024 to its right. */
const fakeScreen = (overrides = {}) => {
  const acts = [];
  const shots = [];
  const begun = [];
  const ended = [];
  const asked = [];
  const bridge = {
    available: async () => true,
    platform: async () => overrides.platform ?? 'windows',
    info: async () => ({ monitors: [], cursor: { x: 0, y: 0 }, foreground: { title: '', process: '', willow: false }, userIdleMs: null, locked: false }),
    capture: async (target) => {
      const monitor = target?.monitor ?? 1;
      shots.push(target?.window ? `window ${target.window}` : monitor);
      if (target?.window) return { data: Buffer.from(`window ${target.window}`).toString('base64'), format: 'png', width: 1600, height: 1000, window: target.window };
      const second = monitor === 2;
      return { data: Buffer.from(`screen ${monitor}`).toString('base64'), left: second ? 1920 : 0, top: 0, width: second ? 1280 : 1920, height: second ? 1024 : 1200, monitor, monitors: 2, primary: !second, foreground: { title: 'Budget.xlsx - Excel', process: 'EXCEL', willow: false }, userIdleMs: 4_000 };
    },
    act: async (action) => {
      acts.push(action);
      return overrides.act ? overrides.act(action) : { ok: true, cursor: { x: action.x ?? 0, y: action.y ?? 0 } };
    },
    apps: async () => ({ apps: overrides.apps ?? [{ title: 'Budget.xlsx - Excel', process: 'EXCEL', pid: 4242, foreground: true }, { title: 'Untitled - Notepad', process: 'notepad', pid: 77, minimized: true }] }),
    elements: async (target) => {
      asked.push({ elements: target });
      return overrides.elements ? overrides.elements(target) : {
        snapshot: 12,
        window: 'Budget.xlsx - Excel',
        process: 'EXCEL',
        truncated: false,
        elements: [
          { index: 0, role: 'button', name: 'Save', actions: ['invoke'], center: { x: 960, y: 600, left: 940, top: 590, width: 40, height: 20 } },
          { index: 1, role: 'textbox', name: 'Name Box', value: 'A1', actions: ['set_value'], center: { x: 3000, y: 50, left: 2990, top: 40, width: 20, height: 20 } },
        ],
      };
    },
    element: async (request) => {
      asked.push({ element: request });
      return overrides.element ? overrides.element(request) : { ok: true, name: 'Save' };
    },
    focus: async (target) => {
      asked.push({ focus: target });
      return { ok: true, foreground: true, title: 'Untitled - Notepad' };
    },
    launch: async (command) => {
      asked.push({ launch: command });
      return { ok: true, started: command.split(' ')[0] };
    },
    begin: async (show) => { begun.push(show); return { shown: true }; },
    end: async () => { ended.push(true); return { shown: false }; },
    onStopped: () => () => {},
  };
  return { bridge, acts, shots, begun, ended, asked };
};

const fakeRender = () => async (source, plan) => ({ data: Buffer.from(`drawn ${plan.size.width}x${plan.size.height}`).toString('base64'), width: plan.size.width, height: plan.size.height, mimeType: 'image/jpeg' });

const toolsFor = (dotId, bridge, { provider = 'anthropic', model = 'claude-sonnet-5', permissions, woken = [], platform = 'windows', waitForUserMs = 0 } = {}) => {
  const env = {
    dotId, dotName: 'Pip', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: true, permissions,
    computer: { root: 'C:\\', shell: 'cmd.exe on Windows', whole: true, home: HOME, bridge: {} },
    screen: { bridge, deps: { now: () => Date.now(), wake: (id) => woken.push(id) }, platform, color: '#7cacf8', waitForUserMs },
    vision: { profile: visionProfile(provider, model), render: fakeRender() },
  };
  return Object.fromEntries(userScreenTools(env).map((entry) => [entry.handler.id, entry.handler]));
};

it('asks the user before it sees or uses their screen, and goes at once only when they allow it', async () => {
  const dotId = await newDot();
  const { bridge, acts, shots } = fakeScreen();
  const woken = [];
  const tools = toolsFor(dotId, bridge, { woken });

  const asked = await tools.user_screenshot.run({ reason: 'To fill in the budget sheet in Excel' }, context());
  assert.match(asked.observation, /^Asked the user to let you see and use their screen \(i\d+\), so nothing was done yet/);
  assert.equal(shots.length, 0, 'nothing is seen before they allow it');
  const [card] = items(dotId, 'screen');
  assert.equal(card.screen.reason, 'To fill in the budget sheet in Excel');
  assert.deepEqual(control.pendingScreenRequests(store.getDotThread(dotId)).map((item) => item.id), [card.id]);
  assert.match((await tools.user_desktop_click.run({ x: 10, y: 10 }, context())).observation, /already asked to see and use the user's screen/);
  assert.equal(items(dotId, 'screen').length, 1, 'one card, however often it is reached for');

  control.allowScreen(dotId, card.id, { now: () => Date.now(), wake: (id) => woken.push(id) });
  assert.deepEqual(woken, [dotId], 'the bot hears it may go on');
  const allowed = store.getDotThread(dotId).items.at(-1);
  assert.equal(allowed.screenStep, 'allowed');
  assert.equal(wakesDot(allowed), true);
  assert.equal(control.screenState(store.getDotThread(dotId), card, Date.now()), 'allowed');

  const looked = await tools.user_screenshot.run({}, context());
  assert.match(looked.observation, /^Screenshot of the user's screen — screen 1 of 2, their main one\. The window in front is "Budget\.xlsx - Excel"\. It comes as a picture of 1356×847 pixels/);
  assert.match(looked.observation, /They used the mouse or keyboard 4 seconds ago, so they may be at the computer/);
  assert.equal(looked.images.length, 1);

  // Claude's pixels on its 1356×847 picture, back to the main screen's own.
  const clicked = await tools.user_desktop_click.run({ x: 678, y: 423, clicks: 2 }, context());
  assert.ok(!clicked.failed, clicked.observation);
  assert.deepEqual(acts.at(-1), { kind: 'click', x: 960, y: 599, button: 'left', clicks: 2, grant: card.id }, 'each action carries the grant it is done under');
  assert.match(clicked.observation, /^Double-clicked at \(678, 423\)\. The window in front is "Budget\.xlsx - Excel"\. The screen afterwards comes with this step's results, a ring marking where you acted/);

  // On the second monitor, a position on its own picture is the desktop's, its left edge added.
  await tools.user_screenshot.run({ monitor: 2 }, context());
  await tools.user_desktop_move.run({ x: 0, y: 0 }, context());
  assert.deepEqual(acts.at(-1), { kind: 'move', x: 1920, y: 0, grant: card.id });
  assert.equal(shots.at(-1), 2, 'the screen afterwards is the monitor it acted on');

  control.stopScreen(dotId, { now: () => Date.now(), wake: (id) => woken.push(id) });
  assert.equal(store.getDotThread(dotId).items.at(-1).screenStep, 'stopped');
  assert.equal(store.getDotThread(dotId).runtime.screen, undefined);
  assert.match((await tools.user_screenshot.run({}, context())).observation, /^Asked the user to let you see and use their screen/, 'after Stop, it asks again');
});

it('has the screen at once when the user lets it act without asking, and Stop still ends it', async () => {
  const dotId = await newDot('act');
  const { bridge, shots } = fakeScreen();
  const tools = toolsFor(dotId, bridge, { permissions: 'act' });
  const looked = await tools.user_screenshot.run({ reason: 'To check the error on screen' }, context());
  assert.match(looked.observation, /^Screenshot of the user's screen/);
  assert.equal(shots.length, 1);
  const [card] = items(dotId, 'screen');
  assert.equal(card.screen.standing, 'mode', 'the card is the record, and says why');
  const allowed = store.getDotThread(dotId).items.find((item) => item.ref === card.id);
  assert.equal(allowed.quiet, true, 'the bot already knows; it is not woken for it');
  assert.equal(wakesDot(allowed), false);
});

it('says plainly what the screen turned away, and never reaches past it', async () => {
  const dotId = await newDot('act');
  const refusals = ['user-active', 'willow', 'willow-focus', 'locked'];
  let next = 0;
  const { bridge } = fakeScreen({ act: () => ({ ok: false, refused: refusals[next++], message: 'refused' }) });
  const tools = toolsFor(dotId, bridge, { provider: 'gemini', model: 'gemini-3.8-flash', permissions: 'act' });
  assert.match((await tools.user_desktop_click.run({ x: 500, y: 500 }, context())).observation, /^Take a screenshot of the user's screen first/);
  const looked = await tools.user_screenshot.run({}, context());
  assert.match(looked.observation, /Give positions on it on a 1000 × 1000 grid/);
  const expected = [/kept using their computer .* for the last half minute, so nothing was done\. Ask them in a message whether you should go on/, /Willow's own window, which you never act on/, /Willow is the window in front, and you never type into it/, /screen is locked/];
  for (const pattern of expected) {
    const result = await tools.user_desktop_click.run({ x: 500, y: 500 }, context());
    assert.equal(result.failed, true);
    assert.match(result.observation, pattern);
  }
  assert.match((await tools.user_desktop_click.run({ x: 1200, y: 10 }, context())).observation, /is not on your screenshot/, 'past the grid is off the picture');
});

it('waits out a user at the mouse and then acts, telling the bot only if they keep at it', async () => {
  const dotId = await newDot('act');
  let tries = 0;
  const { bridge } = fakeScreen({ act: () => (++tries <= 2 ? { ok: false, refused: 'user-active', message: 'refused' } : { ok: true }) });
  const tools = toolsFor(dotId, bridge, { provider: 'gemini', model: 'gemini-3.8-flash', permissions: 'act', waitForUserMs: 10_000 });
  await tools.user_screenshot.run({}, context());
  const labels = [];
  const clicked = await tools.user_desktop_click.run({ x: 500, y: 500 }, { ...context(), activity: (label) => labels.push(label) });
  assert.equal(clicked.failed, undefined, 'the click went ahead once they stopped');
  assert.match(clicked.observation, /^Clicked at \(500, 500\)\./);
  assert.equal(tries, 3, 'tried again while they were at it, and not once more');
  assert.deepEqual(labels, ['Waiting for you to finish', null], 'the user sees what it waits on, and that it has stopped waiting');

  const { patiently } = await importTs(harness('tools', 'user-screen-tools.ts'));
  assert.deepEqual(await patiently({}, async () => ({ refused: 'locked' }), 10_000), { refused: 'locked' }, 'only a user at the computer is waited out');
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await patiently({ signal: aborted.signal }, async () => ({ refused: 'user-active' }), 10_000), { refused: 'user-active' }, 'a stopped turn does not wait');
});

it('lets a grant lapse when unused, and takes the screen away with the whole computer', async () => {
  const dotId = await newDot('act');
  const { bridge } = fakeScreen();
  const tools = toolsFor(dotId, bridge, { permissions: 'act' });
  await tools.user_screenshot.run({}, context());
  const grant = store.getDotThread(dotId).runtime.screen;
  control.endLapsedScreen(dotId, grant.lastAt + control.SCREEN_QUIET_MS + 1);
  assert.equal(store.getDotThread(dotId).runtime.screen, undefined);
  assert.equal(store.getDotThread(dotId).items.at(-1).screenStep, 'ended');
  assert.equal(store.getDotThread(dotId).items.at(-1).quiet, true);

  await tools.user_screenshot.run({}, context());
  assert.ok(store.getDotThread(dotId).runtime.screen, 'a new grant');
  const deps = { computer: { authorize: async (root) => root }, now: () => 2, wake: () => undefined };
  await access.connectComputer(dotId, 'C:\\Users\\Sam\\project', deps);
  assert.equal(store.getDotThread(dotId).runtime.screen, undefined, 'one folder in place of the whole computer takes the screen with it');
});

it('waits for the user\'s word after they decline, before asking again', async () => {
  const dotId = await newDot();
  const { bridge } = fakeScreen();
  const tools = toolsFor(dotId, bridge);
  await tools.user_screenshot.run({ reason: 'To look at the chart' }, context());
  const [card] = items(dotId, 'screen');
  control.declineScreen(dotId, card.id, { now: () => Date.now(), wake: () => undefined });
  const again = await tools.user_screenshot.run({}, context());
  assert.equal(again.failed, true);
  assert.match(again.observation, /declined to let you use their screen/);
  store.appendDotItem(dotId, { kind: 'user', text: 'Ok, go ahead and look.' });
  assert.match((await tools.user_screenshot.run({}, context())).observation, /^Asked the user to let you see and use their screen/);
});

/* ------------------------------------------------------------------------ */
/* Copying between the two computers                                         */
/* ------------------------------------------------------------------------ */

const twoComputers = () => {
  const mine = new Map([['reports/summary.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02])]]);
  const theirs = new Map([['C:\\|Users/Sam/Documents/data.csv', Buffer.from('a,b\n1,2\n')]]);
  const machine = {
    call: async (_dotId, request) => {
      const body = request.body ?? {};
      if (request.path === '/files/read') {
        const bytes = mine.get(body.path);
        if (!bytes) return { status: 404, body: { error: `${body.path} does not exist in your workspace.` } };
        const piece = bytes.subarray(body.offset, body.offset + 4);
        const next = body.offset + piece.length < bytes.length ? body.offset + piece.length : null;
        return { status: 200, body: { path: body.path, bytes: bytes.length, data: piece.toString('base64'), offset: body.offset, next } };
      }
      if (request.path === '/files/list') return mine.has(body.path) ? { status: 200, body: { entries: [] } } : { status: 404, body: { error: 'does not exist' } };
      if (request.path === '/files/write') {
        const piece = Buffer.from(body.contents, 'base64');
        mine.set(body.path, body.append ? Buffer.concat([mine.get(body.path) ?? Buffer.alloc(0), piece]) : piece);
        return { status: 200, body: { path: body.path, bytes: mine.get(body.path).length } };
      }
      return { status: 404, body: { error: 'Not found.' } };
    },
  };
  const computer = {
    authorize: async (root) => root,
    readFile: async (root, at) => {
      if (!theirs.has(`${root}|${at}`)) throw new Error(`ENOENT: no such file or directory '${at}'`);
      return { path: at, size: theirs.get(`${root}|${at}`).length, binary: false, text: 'x', offset: 0, next: null };
    },
    readBytes: async (root, at, offset) => {
      const bytes = theirs.get(`${root}|${at}`);
      if (!bytes) throw new Error(`ENOENT: no such file or directory '${at}'`);
      const piece = bytes.subarray(offset, offset + 3);
      return { data: piece.toString('base64'), size: bytes.length, next: offset + piece.length < bytes.length ? offset + piece.length : null };
    },
    writeBytes: async (root, at, data, append) => {
      const piece = Buffer.from(data, 'base64');
      theirs.set(`${root}|${at}`, append ? Buffer.concat([theirs.get(`${root}|${at}`) ?? Buffer.alloc(0), piece]) : piece);
      return { path: at, size: theirs.get(`${root}|${at}`).length, modifiedAt: 1, created: !append };
    },
  };
  return { mine, theirs, machine, computer };
};

const transferFor = (dotId, { machine, computer }, permissions) => transferTool({
  dotId, dotName: 'Pip', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: true, permissions,
  computer: { root: 'C:\\', shell: 'cmd.exe on Windows', whole: true, home: HOME, bridge: computer },
  machine: { bridge: machine, ready: true },
}).handler;

it('copies files between its own computer and the user\'s, as they are, never over one', async () => {
  const dotId = await newDot();
  const computers = twoComputers();
  const transfer = transferFor(dotId, computers);

  const sent = await transfer.run({ from: 'yours', path: 'reports/summary.pdf', to: 'Downloads/summary.pdf' }, context());
  assert.ok(!sent.failed, sent.observation);
  assert.match(sent.observation, /^Copied reports\/summary\.pdf from your computer to C:\\Users\\Sam\\Downloads\\summary\.pdf on theirs \(7 B, i\d+\)\./);
  assert.deepEqual(computers.theirs.get('C:\\|Users/Sam/Downloads/summary.pdf'), computers.mine.get('reports/summary.pdf'), 'byte for byte, in pieces');
  const card = items(dotId, 'edit').at(-1);
  assert.deepEqual(card.edit, { root: 'C:\\Users\\Sam\\Downloads', files: [{ path: 'summary.pdf', kind: 'add', added: 0, removed: 0, bytes: 7 }] });

  const again = await transfer.run({ from: 'yours', path: 'reports/summary.pdf', to: 'Downloads/summary.pdf' }, context());
  assert.equal(again.failed, true);
  assert.match(again.observation, /already there on their computer/);

  const fetched = await transfer.run({ from: 'theirs', path: '~/Documents/data.csv', to: 'data/data.csv' }, context());
  assert.match(fetched.observation, /^Copied C:\\Users\\Sam\\Documents\\data\.csv from the user's computer to data\/data\.csv in your folder \(8 B\)\./);
  assert.equal(computers.mine.get('data/data.csv').toString(), 'a,b\n1,2\n');

  assert.match((await transfer.run({ from: 'theirs', path: '~/.ssh/id_rsa', to: 'key' }, context())).observation, /holds secrets/);
  assert.match((await transfer.run({ from: 'yours', path: '/etc/passwd', to: 'x' }, context())).observation, /a file in your folder/);
  assert.match((await transfer.run({ from: 'somewhere', path: 'a', to: 'b' }, context())).observation, /Say "from"/);
});

it('proposes a copy onto the user\'s computer while it asks first, and copies once they apply it', async () => {
  const dotId = await newDot('ask');
  const computers = twoComputers();
  const transfer = transferFor(dotId, computers, 'ask');
  const proposed = await transfer.run({ from: 'yours', path: 'reports/summary.pdf', to: 'Desktop/summary.pdf' }, context());
  assert.match(proposed.observation, /^Asked the user to accept a copy of reports\/summary\.pdf at C:\\Users\\Sam\\Desktop\\summary\.pdf \(i\d+\)\. Nothing is there yet/);
  assert.equal(computers.theirs.has('C:\\|Users/Sam/Desktop/summary.pdf'), false);
  const card = items(dotId, 'edit').at(-1);
  assert.deepEqual(card.edit.proposed.copy, { from: 'reports/summary.pdf', root: 'C:\\', path: 'Users/Sam/Desktop/summary.pdf' });
  assert.equal(edits.editState(store.getDotThread(dotId), card), 'pending');

  const woken = [];
  await edits.applyProposedEdit(dotId, card.id, { computer: computers.computer, machine: computers.machine, now: () => Date.now(), wake: (id) => woken.push(id) });
  assert.deepEqual(computers.theirs.get('C:\\|Users/Sam/Desktop/summary.pdf'), computers.mine.get('reports/summary.pdf'));
  assert.equal(edits.editState(store.getDotThread(dotId), card), 'applied');
  assert.match(store.getDotThread(dotId).items.at(-1).text, /^The user accepted your copy of reports\/summary\.pdf \(i\d+\): it is now in C:\\Users\\Sam\\Desktop \(7 B\)\./);
  assert.deepEqual(woken, [dotId]);
});

/* ------------------------------------------------------------------------ */
/* The prompt                                                                */
/* ------------------------------------------------------------------------ */

it('speaks of their screen, and of choosing a computer, only when there is one to choose', () => {
  const base = { dotName: 'Pip', tools: [], skills: [], environment: 'desktop' };
  const whole = { root: 'C:\\', shell: 'cmd.exe on Windows', whole: true, home: HOME };
  const alone = createDotSystemPrompt({ ...base, machine: { ready: true } });
  assert.doesNotMatch(alone, /# The user's computer|# Your computer and theirs|user_screenshot/, 'their computer not connected: nothing about it');

  const files = createDotSystemPrompt({ ...base, machine: { ready: true }, computer: whole });
  assert.match(files, /# Your computer and theirs\n\nYou can work on two computers: your own, and their whole computer\./);
  assert.doesNotMatch(files, /user_screenshot|their screen comes last/, 'no screen offered, none described');

  const screen = createDotSystemPrompt({ ...base, machine: { ready: true }, computer: { ...whole, screen: 'windows' } });
  assert.match(screen, /Their screen is within reach too — the one they are looking at, shared with them: `user_screenshot` shows it/);
  assert.match(screen, /a glow and your own cursor show them you are at the controls, and Stop or Esc there takes the screen back at once/);
  assert.match(screen, /a numbered control from `user_elements` is surer than a position/);
  assert.match(screen, /Commands go through `user_run_command`, where the user sees them, never into a terminal on the screen/);
  assert.match(screen, /Their screen is a shared space\. Look before every action, and leave it alone while they are using the computer/);
  assert.match(screen, /Willow's own window is never yours to act on/);
  assert.match(screen, /their screen comes last, for a program that offers no other way in/);
  assert.match(screen, /Go where the work's things are/);

  const web = createDotSystemPrompt({ ...base, environment: 'web', computer: { root: 'C:\\site', shell: 'cmd.exe on Windows' } });
  assert.match(web, /# The user's computer/);
  assert.doesNotMatch(web, /# Your computer and theirs/, 'with no computer of its own, there is nothing to choose');

  for (const prompt of [alone, files, screen, web]) {
    assert.doesNotMatch(prompt.slice(0, prompt.indexOf('# Protocol')), /for example|for instance|e\.g\.|such as/i, 'principles, not samples');
  }
});

/* ------------------------------------------------------------------------ */
/* Windows: apps, controls, and the overlay                                  */
/* ------------------------------------------------------------------------ */

it('lists the open windows and a window\'s controls, and works one by number', async () => {
  const dotId = await newDot('act');
  const { bridge, asked, acts } = fakeScreen();
  const tools = toolsFor(dotId, bridge, { permissions: 'act' });
  const apps = await tools.user_apps.run({}, context());
  assert.match(apps.observation, /- "Budget\.xlsx - Excel" \(EXCEL\) — pid 4242; in front/);
  assert.match(apps.observation, /- "Untitled - Notepad" \(notepad\) — pid 77; minimized/);

  await tools.user_screenshot.run({}, context());
  const listed = await tools.user_elements.run({ program: 'excel.exe' }, context());
  assert.deepEqual(asked.at(-1), { elements: { process: 'excel' } }, 'a program is named without its .exe');
  // Claude's picture of the 1920×1200 main screen is 1356×847: the Save button's centre, in the bot's own positions.
  assert.match(listed.observation, /\[0\] button "Save" — invoke at \(678, 424\)/);
  assert.match(listed.observation, /\[1\] textbox "Name Box" — value "A1" — set_value\n?$/, 'a control off the latest picture has no position');

  const pressed = await tools.user_element.run({ index: 0, action: 'invoke' }, context());
  assert.ok(!pressed.failed, pressed.observation);
  assert.deepEqual(asked.at(-1), { element: { snapshot: 12, index: 0, action: 'invoke' } }, 'by the list it came from');
  assert.match(pressed.observation, /^Pressed button "Save"\. The window in front is "Budget\.xlsx - Excel"\./);
  assert.equal(pressed.images.length, 1, 'with what it looks like now');
  await tools.user_element.run({ index: 1, action: 'set_value', value: 'B7' }, context());
  assert.deepEqual(asked.at(-1), { element: { snapshot: 12, index: 1, action: 'set_value', value: 'B7' } });
  assert.match((await tools.user_element.run({ index: 9 }, context())).observation, /There is no control 9/);
  assert.match((await tools.user_element.run({ index: 0, action: 'delete' }, context())).observation, /"action" is invoke, toggle/);
  assert.equal(acts.length, 0, 'controls are worked without the mouse');

  const focused = await tools.user_focus_window.run({ program: 'notepad' }, context());
  assert.deepEqual(asked.at(-1), { focus: { process: 'notepad' } });
  assert.match(focused.observation, /^Brought "Untitled - Notepad" to the front\./);
});

it('shows the overlay for the bot under its grant, once, and takes it down when the grant ends', async () => {
  const dotId = await newDot('act');
  const { bridge, begun, ended } = fakeScreen();
  const overlay = await importTs(harness('runtime', 'screen-overlay.ts'));
  const unsubscribe = control.onScreenGrantEnded((id) => void overlay.hideScreenOverlay(bridge, id));
  try {
    const tools = toolsFor(dotId, bridge, { permissions: 'act' });
    await tools.user_screenshot.run({ reason: 'To read the chart' }, context());
    await tools.user_desktop_click.run({ x: 10, y: 10 }, context());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const grant = store.getDotThread(dotId).runtime.screen.itemId;
    assert.deepEqual(begun, [{ name: 'Pip', color: '#7cacf8', grant, session: dotId }], 'shown once for the grant, with the bot\'s name and colour');
    assert.deepEqual(overlay.screenOverlayShowing(), { dotId, grant });

    control.stopScreen(dotId, { now: () => Date.now(), wake: () => undefined }, 'escape');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ended.length, 1, 'the grant ended, and the overlay with it');
    assert.equal(overlay.screenOverlayShowing(), null);
    assert.match(store.getDotThread(dotId).items.at(-1).text, /stopped you using their screen \(i\d+\) — they pressed Esc\./);
  } finally {
    unsubscribe();
  }
});

it('turns away an action under a grant the user stopped from their screen', async () => {
  const dotId = await newDot('act');
  const { bridge } = fakeScreen({ act: () => ({ ok: false, refused: 'stopped', message: 'stopped' }) });
  const tools = toolsFor(dotId, bridge, { permissions: 'act' });
  await tools.user_screenshot.run({}, context());
  const refused = await tools.user_desktop_click.run({ x: 10, y: 10 }, context());
  assert.equal(refused.failed, true);
  assert.match(refused.observation, /The user stopped you using their screen, so nothing was done/);
});

/* ------------------------------------------------------------------------ */
/* macOS and Linux                                                           */
/* ------------------------------------------------------------------------ */

it('on macOS, works apps in the background: a window by id, controls by number, typing into that app', async () => {
  const dotId = await newDot('act');
  const { bridge, acts, shots } = fakeScreen({ platform: 'mac', apps: [{ title: 'Groceries', app: 'Notes', pid: 501, window: 88 }] });
  const tools = toolsFor(dotId, bridge, { permissions: 'act', platform: 'mac' });
  assert.deepEqual(Object.keys(tools).sort(), ['user_apps', 'user_desktop_key', 'user_desktop_type', 'user_element', 'user_elements', 'user_focus_window', 'user_screenshot', 'user_zoom'], 'no clicking by position: the app is worked by its controls');

  assert.match((await tools.user_apps.run({}, context())).observation, /- "Groceries" \(Notes\) — window 88, pid 501/);
  assert.match((await tools.user_screenshot.run({}, context())).observation, /Give the "window"/);
  assert.match((await tools.user_desktop_type.run({ text: 'milk' }, context())).observation, /Look at a window with user_screenshot/, 'typing needs an app to go to');

  const looked = await tools.user_screenshot.run({ window: 88 }, context());
  assert.equal(shots.at(-1), 'window 88');
  assert.match(looked.observation, /^"Groceries" in Notes, as it is now\. Its controls are not reached by position here: list them with user_elements \(pid 501\)/);
  await tools.user_desktop_type.run({ text: 'milk' }, context());
  assert.equal(acts.at(-1).pid, 501, 'into that app, in the background');
  assert.equal(acts.at(-1).kind, 'type');
  assert.equal(shots.at(-1), 'window 88', 'and the window afterwards');

  assert.match((await tools.user_elements.run({}, context())).observation, /Give the "pid"/);
});

it('on Linux, works a desktop of its own: opening apps there, pointing and typing on it', async () => {
  const dotId = await newDot('act');
  const { bridge, asked, acts } = fakeScreen({ platform: 'linux', apps: [] });
  const tools = toolsFor(dotId, bridge, { permissions: 'act', platform: 'linux' });
  assert.ok(tools.user_open_app && tools.user_desktop_click && !tools.user_elements, 'no accessibility reading there');
  assert.match((await tools.user_apps.run({}, context())).observation, /Nothing is open on your desktop yet: open what the work needs with user_open_app/);
  const opened = await tools.user_open_app.run({ command: 'firefox --new-window' }, context());
  assert.deepEqual(asked.at(-1), { launch: 'firefox --new-window' });
  assert.match(opened.observation, /^Started firefox on your desktop/);
  const looked = await tools.user_screenshot.run({}, context());
  assert.match(looked.observation, /^Screenshot of your desktop on the user's computer\./);
  await tools.user_desktop_click.run({ x: 678, y: 423 }, context());
  assert.equal(acts.at(-1).kind, 'click');
});

it('describes each system\'s way in the prompt, as principles', () => {
  const base = { dotName: 'Pip', tools: [], skills: [], environment: 'desktop' };
  const whole = { root: '/', shell: 'bash on Linux', whole: true, home: '/home/sam' };
  const mac = createDotSystemPrompt({ ...base, computer: { ...whole, screen: 'mac' } });
  assert.match(mac, /Their apps are within reach too, in the background: you work a window where it stands, without taking their screen or their focus/);
  assert.match(mac, /Work the app, not the screen/);
  assert.doesNotMatch(mac, /glow and your own cursor/);
  const linux = createDotSystemPrompt({ ...base, computer: { ...whole, screen: 'linux' } });
  assert.match(linux, /A desktop of your own is within reach too, on their computer but off their screen/);
  assert.match(linux, /It starts empty and fresh, signed in to nothing/);
  assert.match(linux, /Commands go through `user_run_command`/);
  for (const prompt of [mac, linux]) {
    assert.doesNotMatch(prompt.slice(0, prompt.indexOf('# Protocol')), /for example|for instance|e\.g\.|such as/i, 'principles, not samples');
  }
});
