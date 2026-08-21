import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const lifecycle = await importTs(path.join(
  repoRoot,
  'features',
  'spark',
  'src',
  'spark-response-lifecycle.ts',
));
const storeSource = fs.readFileSync(path.join(
  repoRoot,
  'features',
  'spark',
  'src',
  'spark-store.ts',
), 'utf8');
const workspaceSource = fs.readFileSync(path.join(
  repoRoot,
  'features',
  'spark',
  'src',
  'SparkWorkspace.tsx',
), 'utf8');

const createTask = (overrides = {}) => ({
  id: 'task-1',
  title: 'Task',
  description: 'Working',
  time: 'Just now',
  status: 'running',
  prompt: 'Do the task',
  response: 'Original response',
  turns: [],
  isPinned: false,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  ...overrides,
});

const createTurn = (id, overrides = {}) => ({
  id,
  prompt: `Follow-up ${id}`,
  response: '',
  activityPhase: 'thinking',
  createdAt: '2026-08-21T00:00:00.000Z',
  ...overrides,
});

it('assigns an active Spark run to exactly one response', () => {
  const rootRun = createTask({ response: '', turns: [] });
  assert.equal(lifecycle.isSparkRootResponseStreaming(rootRun), true);

  const first = createTurn('turn-1', { response: 'Finished' });
  const latest = createTurn('turn-2');
  const followUpRun = createTask({ turns: [first, latest] });
  assert.equal(lifecycle.isSparkRootResponseStreaming(followUpRun), false);
  assert.equal(lifecycle.isSparkTurnResponseStreaming(followUpRun, first), false);
  assert.equal(lifecycle.isSparkTurnResponseStreaming(followUpRun, latest), true);
});

it('clears a follow-up processing phase when undefined is explicitly supplied', () => {
  assert.match(
    storeSource,
    /activityPhase:\s*Object\.prototype\.hasOwnProperty\.call\(update, 'activityPhase'\)/,
  );
});

it('keeps follow-up processing metadata on the follow-up turn', () => {
  const executeTurnStart = workspaceSource.indexOf('const executeTurn = useCallback');
  const submitFollowUpStart = workspaceSource.indexOf('const submitFollowUp = useCallback', executeTurnStart);
  assert.notEqual(executeTurnStart, -1);
  assert.notEqual(submitFollowUpStart, -1);

  const executeTurnSource = workspaceSource.slice(executeTurnStart, submitFollowUpStart);
  const parentTaskUpdates = [...executeTurnSource.matchAll(
    /updateSparkTask\(taskId,\s*\{([\s\S]*?)\}\);/g,
  )].map((match) => match[1]);

  assert.ok(parentTaskUpdates.length > 0);
  for (const update of parentTaskUpdates) {
    assert.doesNotMatch(update, /\bactivity(?:Title|Log|Phase)\s*:/);
  }
  assert.match(executeTurnSource, /updateSparkTaskTurn\(taskId, turnId, \{ activityTitle \}\)/);
  assert.match(executeTurnSource, /updateSparkTaskTurnActivityTransient\(taskId, turnId, activityLog\)/);
  assert.match(executeTurnSource, /updateSparkTaskTurn\(taskId, turnId, \{ activityPhase/);
});
