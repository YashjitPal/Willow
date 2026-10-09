/**
 * The timeline's command rows: which rows group, and what the group says.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { commandGroupLabel, isCommandGroupRunning, isCommandRow, withCommandRowStatus } = await importTs(
  path.join(repoRoot, 'features', 'spark', 'src', 'spark-command-rows.ts'),
);

const command = (id, label, status) => ({ id, kind: 'tool', tool: 'command', label, ...(status ? { callId: `call-${id}`, status } : {}) });

it('groups only commands the desktop app ran, not the web sandbox operations', () => {
  assert.equal(isCommandRow(command('a', 'git status')), true);
  assert.equal(isCommandRow({ id: 'b', kind: 'tool', tool: 'command' }), false);
  assert.equal(isCommandRow({ id: 'c', kind: 'tool', tool: 'web_search', label: 'x' }), false);
  assert.equal(isCommandRow({ id: 'd', kind: 'narration', text: 'Checking' }), false);
});

it('reads Running while a command waits or runs, and Ran once they finish', () => {
  const one = [command('a', 'npm install', 'running')];
  assert.equal(commandGroupLabel(one, isCommandGroupRunning(one, true, true)), 'Running command');
  const queued = [command('a', 'git status', 'success'), command('b', 'npm test', 'queued')];
  assert.equal(commandGroupLabel(queued, isCommandGroupRunning(queued, true, false)), 'Running commands');
  const done = [command('a', 'git status', 'success'), command('b', 'npm test', 'error')];
  assert.equal(commandGroupLabel(done, isCommandGroupRunning(done, true, true)), 'Ran commands');
  assert.equal(commandGroupLabel(one, isCommandGroupRunning(one, false, true)), 'Ran command', 'a finished turn has nothing running');
});

it('says when no command in the group was run', () => {
  const declined = [command('a', 'git push', 'cancelled')];
  assert.equal(commandGroupLabel(declined, isCommandGroupRunning(declined, true, true)), "Didn't run command");
});

it('falls back to the timeline position for rows recorded without a status', () => {
  const legacy = [command('a', 'npm test')];
  assert.equal(isCommandGroupRunning(legacy, true, true), true);
  assert.equal(isCommandGroupRunning(legacy, true, false), false);
});

it('updates a row by its call, and only when the status changes', () => {
  const log = [{ id: 'n', kind: 'narration', text: 'Checking' }, command('a', 'npm test', 'queued')];
  const running = withCommandRowStatus(log, 'call-a', 'running');
  assert.equal(running[1].status, 'running');
  assert.equal(log[1].status, 'queued', 'the log it was given is left alone');
  assert.equal(withCommandRowStatus(running, 'call-a', 'running'), null);
  assert.equal(withCommandRowStatus(running, 'call-zzz', 'success'), null);
  assert.equal(withCommandRowStatus(running, 'call-a', undefined), null);
});
