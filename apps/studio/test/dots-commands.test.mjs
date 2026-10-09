/**
 * The commands a bot ran, as the user finds them: out of the conversation once decided, and in Activity, one entry
 * for each stretch between messages, opening on every command it ran.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const dots = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', ...parts);

const store = await importTs(dots('harness', 'thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(dots('harness', 'thread', 'thread-persistence.ts'));
const commands = await importTs(dots('commands', 'dot-commands.ts'));

store.setDotThreadPersistence(memoryPersistence());

let counter = 0;
const newDot = async () => {
  counter += 1;
  const dotId = `dot-commands-${counter}`;
  await store.loadDotThread(dotId);
  return dotId;
};

const command = (dotId, text, extra = {}) => store.appendDotItem(dotId, { kind: 'approval', text, approval: { command: text, cwd: '.', root: 'C:\\work', reason: `To ${text}`, timeoutSeconds: 60, ...extra } });
const step = (dotId, ref, approvalStep, draft = {}) => store.appendDotItem(dotId, { kind: 'event', event: 'approval', ref, approvalStep, text: `${approvalStep}`, ...draft });

it('groups the commands of each stretch between messages, newest first, and says how each went', async () => {
  const dotId = await newDot();
  store.appendDotItem(dotId, { kind: 'user', text: 'Run the tests and build it' });
  const tests = command(dotId, 'npm test');
  step(dotId, tests.id, 'approved');
  step(dotId, tests.id, 'finished', { text: `\`npm test\` (${tests.id}) exited with code 0.\nOutput: 42 passing` });
  const build = command(dotId, 'npm run build');
  step(dotId, build.id, 'approved');
  step(dotId, build.id, 'finished', { failed: true, text: `\`npm run build\` (${build.id}) exited with code 1.\nOutput: error` });
  store.appendDotItem(dotId, { kind: 'dot', text: 'Tests pass; the build fails on one type error.' });
  const server = command(dotId, 'npm run dev', { background: true });
  step(dotId, server.id, 'started');
  const waiting = command(dotId, 'git push');

  const thread = store.getDotThread(dotId);
  const groups = commands.commandGroups(thread);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.text)), [['npm run dev', 'git push'], ['npm test', 'npm run build']], 'a message closes a stretch');
  assert.equal(groups[1].key, tests.id, 'a group is named by its first command');

  assert.equal(commands.commandState(thread, tests), 'done');
  assert.equal(commands.commandState(thread, build), 'failed');
  assert.equal(commands.commandState(thread, server), 'background');
  assert.equal(commands.commandState(thread, waiting), 'pending');
  assert.deepEqual(commands.commandReport(thread, tests), { summary: 'Exited with code 0.', details: 'Output: 42 passing' });
  assert.equal(commands.commandReport(thread, waiting), null);

  assert.deepEqual(commands.groupSummary(thread, groups[1]), { title: 'Ran 2 commands', status: '1 with a problem', busy: false });
  assert.deepEqual(commands.groupSummary(thread, groups[0]), { title: 'Ran 2 commands', status: '1 waiting for you · 1 in the background', busy: true });
  assert.deepEqual(commands.groupSummary(thread, { key: tests.id, items: [tests], at: tests.at }), { title: 'npm test', status: 'Ran', busy: false }, 'one command is named by itself');
});

it('keeps only commands still waiting for the user in the conversation', async () => {
  const dotId = await newDot();
  const ran = command(dotId, 'ls');
  step(dotId, ran.id, 'approved', { quiet: true });
  step(dotId, ran.id, 'finished', { quiet: true, text: `\`ls\` (${ran.id}) exited with code 0.` });
  const declined = command(dotId, 'rm -rf build');
  step(dotId, declined.id, 'declined');
  const waiting = command(dotId, 'git push');
  const decided = commands.decidedCommands(store.getDotThread(dotId));
  assert.equal(decided.has(ran.id), true);
  assert.equal(decided.has(declined.id), true);
  assert.equal(decided.has(waiting.id), false, 'a request still waiting stays where the user answers it');
});

it('writes where a command ran as the user reads paths', () => {
  assert.equal(commands.commandFolder({ root: 'C:\\work\\', cwd: 'src/app', command: 'x', reason: '', timeoutSeconds: 1 }), 'C:\\work\\src\\app');
  assert.equal(commands.commandFolder({ root: '/home/sam/site', cwd: 'web', command: 'x', reason: '', timeoutSeconds: 1 }), '/home/sam/site/web');
  assert.equal(commands.commandFolder({ root: '/home/sam/site', cwd: '.', command: 'x', reason: '', timeoutSeconds: 1 }), '/home/sam/site');
});
