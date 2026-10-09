import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);

const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const { computerTools, locatePath, shownPath } = await importTs(harness('tools', 'computer-tools.ts'));
const access = await importTs(harness('runtime', 'computer-access.ts'));
const { triggerTool } = await importTs(harness('tools', 'trigger-tools.ts'));
const { createDotSystemPrompt } = await importTs(harness('overlay', 'dot-profile.ts'));

store.setDotThreadPersistence(memoryPersistence());

const HOME = 'C:\\Users\\Sam';
const WHOLE = { root: 'C:\\', whole: true, home: HOME };

let counter = 0;
const newDot = async () => {
  counter += 1;
  const dotId = `dot-whole-${counter}`;
  await store.loadDotThread(dotId);
  return dotId;
};

/** A Windows computer that keeps a few files on two drives and remembers what it was asked. */
const fakeComputer = () => {
  const files = new Map([
    ['C:\\|Users/Sam/notes/todo.md', { text: 'buy milk\n', modifiedAt: 1_000 }],
    ['C:\\|Users/Sam/project/src/app.ts', { text: 'export const app = 1;\n', modifiedAt: 1_000 }],
    ['D:\\|photos/list.txt', { text: 'beach.jpg\n', modifiedAt: 1_000 }],
  ]);
  const calls = [];
  const bridge = {
    authorize: async (root) => {
      calls.push(['authorize', root]);
      return root;
    },
    execute: async (request) => {
      calls.push(['execute', request.root, request.cwd, request.command]);
      return { code: 0, signal: null, stdout: 'done\n', stderr: '' };
    },
    startJob: async ({ root, cwd, command }) => ({ jobId: 'job-1', running: true, code: null, signal: null, startedAt: Date.now(), endedAt: null, root, cwd, command }),
    readJob: async () => ({ running: false, code: 0, signal: null, startedAt: 0, endedAt: 0, text: '', next: 0, truncated: false }),
    stopJob: async () => undefined,
    writeJob: async () => undefined,
    listFiles: async (root, at) => {
      calls.push(['list', root, at]);
      return { path: at, entries: [{ path: `${at === '.' ? '' : `${at}/`}notes`, type: 'dir' }, { path: `${at === '.' ? '' : `${at}/`}AppData/Local/Google/Chrome/User Data/Cookies`, type: 'file', size: 10 }], truncated: false };
    },
    readFile: async (root, at) => {
      calls.push(['read', root, at]);
      const file = files.get(`${root}|${at}`);
      if (!file) throw new Error(`ENOENT: no such file or directory '${at}'`);
      return { path: at, size: file.text.length, modifiedAt: file.modifiedAt, binary: false, text: file.text, offset: 0, next: null };
    },
    searchFiles: async () => ({ matches: [], truncated: false }),
    writeFile: async (root, at, text) => {
      calls.push(['write', root, at]);
      files.set(`${root}|${at}`, { text, modifiedAt: 2_000 });
      return { path: at, size: text.length, modifiedAt: 2_000, created: false };
    },
    shell: () => 'cmd.exe on Windows',
  };
  return { bridge, calls, files, deps: { computer: bridge, now: () => Date.now(), wake: () => undefined } };
};

const tools = (dotId, bridge) => {
  const env = { dotId, dotName: 'Pip', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: true, computer: { ...WHOLE, shell: bridge.shell(), bridge } };
  return Object.fromEntries(computerTools(env).map((entry) => [entry.handler.id, entry]));
};

it('finds a path anywhere on the computer, or only inside the folder that was connected', () => {
  assert.deepEqual(locatePath(WHOLE, undefined), { root: 'C:\\', path: 'Users/Sam' }, 'nothing given: the home folder');
  assert.deepEqual(locatePath(WHOLE, '~/notes/todo.md'), { root: 'C:\\', path: 'Users/Sam/notes/todo.md' });
  assert.deepEqual(locatePath(WHOLE, 'project\\src'), { root: 'C:\\', path: 'Users/Sam/project/src' }, 'relative to the home folder');
  assert.deepEqual(locatePath(WHOLE, 'd:\\photos\\list.txt'), { root: 'D:\\', path: 'photos/list.txt' }, 'another drive');
  assert.deepEqual(locatePath(WHOLE, 'C:'), { root: 'C:\\', path: '.' });
  assert.equal(locatePath(WHOLE, 'C:\\Users\\..\\Windows'), null, 'no climbing out with ..');
  assert.equal(shownPath(WHOLE, 'C:\\', 'Users/Sam/notes'), 'C:\\Users\\Sam\\notes');
  assert.equal(shownPath({ root: '/', whole: true, home: '/home/sam' }, '/', 'home/sam/x'), '/home/sam/x');

  const folder = { root: 'C:\\Users\\Sam\\project' };
  assert.deepEqual(locatePath(folder, 'src/app.ts'), { root: folder.root, path: 'src/app.ts' });
  assert.deepEqual(locatePath(folder, 'c:\\users\\sam\\PROJECT\\src'), { root: folder.root, path: 'src' }, 'a full path inside the folder, in any case');
  assert.equal(locatePath(folder, 'C:\\Users\\Sam\\notes'), null, 'outside the folder');
  assert.equal(locatePath(folder, '~/notes'), null);
  assert.equal(locatePath(folder, '../notes'), null);
  assert.equal(shownPath(folder, folder.root, 'src/app.ts'), 'src/app.ts', 'a folder keeps relative paths');
});

it('looks and edits anywhere with the whole computer connected, in full paths, keeping browsers and credentials out of reach', async () => {
  const dotId = await newDot();
  const { bridge, calls, files } = fakeComputer();
  await access.connectWholeComputer(dotId, { root: 'C:\\', home: HOME }, { computer: bridge, now: () => 1, wake: () => undefined });
  assert.deepEqual(store.getDotThread(dotId).runtime.computer, { root: 'C:\\', connectedAt: 1, whole: true, home: HOME });
  assert.match(store.getDotThread(dotId).items.at(-1).text, /connected their whole computer/);

  const toolset = tools(dotId, bridge);
  assert.match(toolset.user_files.doc.description, /anywhere on it/);
  const listed = await toolset.user_files.handler.run({ action: 'list' }, { turnId: 't1' });
  assert.match(listed.observation, /^C:\\Users\\Sam:\nC:\\Users\\Sam\\notes\//, 'the home folder, in full paths');
  assert.match(listed.observation, /Cookies — 10 B \(off limits\)/, "a browser's profile is off limits");
  const read = await toolset.user_files.handler.run({ action: 'read', path: 'D:\\photos\\list.txt' }, { turnId: 't1' });
  assert.match(read.observation, /^D:\\photos\\list\.txt — /);
  assert.deepEqual(calls.filter((call) => call[0] === 'read').at(-1), ['read', 'D:\\', 'photos/list.txt']);
  const secret = await toolset.user_files.handler.run({ action: 'read', path: 'C:\\Users\\Sam\\AppData\\Roaming\\Microsoft\\Credentials\\x' }, { turnId: 't1' });
  assert.equal(secret.failed, true);

  const patch = [
    '*** Begin Patch',
    '*** Update File: ~/project/src/app.ts',
    '@@',
    '-export const app = 1;',
    '+export const app = 2;',
    '*** Add File: C:\\Users\\Sam\\project\\README.md',
    '+# Project',
    '*** End Patch',
  ].join('\n');
  const edited = await toolset.user_apply_patch.handler.run({ patch }, { turnId: 't1' });
  assert.ok(!edited.failed, edited.observation);
  assert.equal(files.get('C:\\|Users/Sam/project/src/app.ts').text, 'export const app = 2;\n');
  assert.equal(files.get('C:\\|Users/Sam/project/README.md').text, '# Project\n');
  const card = store.getDotThread(dotId).items.at(-1);
  assert.equal(card.edit.root, 'C:\\Users\\Sam\\project', 'the card names the folder the changes share');
  assert.deepEqual(card.edit.files.map((file) => file.path).sort(), ['README.md', 'src/app.ts']);
});

it('asks to run commands in any folder, on any drive, and runs them there once approved', async () => {
  const dotId = await newDot();
  const { bridge, calls, deps } = fakeComputer();
  await access.connectWholeComputer(dotId, { root: 'C:\\', home: HOME }, deps);
  const toolset = tools(dotId, bridge);

  const asked = await toolset.user_run_command.handler.run({ command: 'dir', reason: 'See the photos', cwd: 'D:\\photos' }, { dotId, turnId: 't1' });
  assert.match(asked.observation, /Asked the user to approve/);
  const request = store.getDotThread(dotId).items.at(-1);
  assert.deepEqual({ root: request.approval.root, cwd: request.approval.cwd }, { root: 'D:\\', cwd: 'photos' });
  await access.approveCommand(dotId, request.id, deps);
  assert.deepEqual(calls.filter((call) => call[0] === 'execute').at(-1), ['execute', 'D:\\', 'photos', 'dir'], 'another drive is not refused');
  assert.ok(store.getDotThread(dotId).items.some((item) => item.ref === request.id && /D:\\photos/.test(item.text)), 'the bot hears where it ran');

  await toolset.user_run_command.handler.run({ command: 'git status', reason: 'Check the project' }, { dotId, turnId: 't2' });
  const home = store.getDotThread(dotId).items.at(-1);
  assert.deepEqual({ root: home.approval.root, cwd: home.approval.cwd }, { root: 'C:\\', cwd: 'Users/Sam' }, 'no folder given: the home folder');

  // Choosing one folder afterwards takes the whole computer back.
  await access.connectComputer(dotId, 'C:\\Users\\Sam\\project', deps);
  assert.equal(store.getDotThread(dotId).runtime.computer.whole, undefined);
  assert.equal(store.getDotThread(dotId).items.find((item) => item.ref === home.id)?.approvalStep, 'withdrawn');
});

it('watches a folder named in full, and tells the bot how far it may go', async () => {
  const dotId = await newDot();
  const { bridge } = fakeComputer();
  const env = { dotId, dotName: 'Pip', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: true, computer: { ...WHOLE, shell: bridge.shell(), bridge } };
  const created = await triggerTool(env).handler.run({ action: 'create', name: 'Downloads', when: { type: 'folder', path: '~/Downloads' }, instruction: 'Sort what arrives.' }, { turnId: 't1' });
  assert.ok(!created.failed, created.observation);
  assert.deepEqual(store.getDotThread(dotId).runtime.triggers[0].when, { type: 'folder', path: 'C:\\Users\\Sam\\Downloads' });
  assert.match(created.observation, /When files change in C:\\Users\\Sam\\Downloads/);
  const elsewhere = await triggerTool(env).handler.run({ action: 'create', name: 'Photos', when: { type: 'folder', path: 'D:\\photos' }, instruction: 'x' }, { turnId: 't1' });
  assert.equal(elsewhere.failed, true);

  const prompt = createDotSystemPrompt({ dotName: 'Pip', tools: [], skills: [], computer: { root: 'C:\\', shell: 'cmd.exe on Windows', whole: true, home: HOME } });
  assert.match(prompt, /connected their whole computer: you can work anywhere their account can reach, from their home folder, C:\\Users\\Sam, on any drive/);
  assert.match(prompt, /not licence to roam it/);
  const unconnected = createDotSystemPrompt({ dotName: 'Pip', tools: [], skills: [], environment: 'desktop', machine: { ready: true } });
  assert.doesNotMatch(unconnected, /# The user's computer|# Your computer and theirs/, 'with their computer not connected, there is nothing to choose');
});
