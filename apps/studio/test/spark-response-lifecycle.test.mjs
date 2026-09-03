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
const detailSource = fs.readFileSync(path.join(
  repoRoot,
  'features',
  'spark',
  'src',
  'SparkTaskDetail.tsx',
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

/*
 * The Like / Dislike / Copy row waits for the reveal, not for generation.
 *
 * `StreamingMarkdown` paces text through its own queue, so it keeps animating
 * after the final token arrives. Gating the row on task status alone popped it
 * in while the text was still writing itself. Two halves have to hold together:
 * both action rows consult `responseActionsReady`, and a response that never
 * streamed in this session is exempt — otherwise a task opened from disk renders
 * `reveal={false}`, no completion callback ever fires, and the row stays hidden
 * for good.
 */
it('holds the response action row until the reveal animation finishes', () => {
  assert.match(
    detailSource,
    /const responseActionsReady = \(key: string, text: string\) =>\s*\n?\s*!streamedRevealKeysRef\.current\.has\(key\) \|\| revealedLengths\[key\] === text\.length/,
  );
  // Both rows gated: the root exchange and each follow-up.
  assert.match(detailSource, /responseActionsReady\(rootRevealKey, response\)/);
  assert.match(detailSource, /responseActionsReady\(turn\.id, turnResponse\)/);
  // Fed by StreamingMarkdown's own completion signal, not by a timer.
  assert.match(detailSource, /onRevealComplete=\{handleRevealComplete\}/);
  // Length is part of the key's satisfaction so a retry cannot reuse the
  // previous run's completion.
  assert.match(detailSource, /onRevealed\(revealKey, text\.length\)/);
  // Only responses seen streaming are gated at all.
  assert.match(detailSource, /streamedRevealKeysRef\.current\.add\(`root:\$\{currentTask\.id\}`\)/);
  assert.match(detailSource, /streamedRevealKeysRef\.current\.add\(turn\.id\)/);
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

it('keeps an active work phase visible after response text has started', () => {
  assert.match(detailSource, /phase=\{currentTask\.activityPhase\}/);
  assert.match(
    detailSource,
    /phase=\{turn\.activityPhase\s*\?\?\s*\(!hasSparkResponseStarted\(turn\.response\)/,
  );
  assert.match(workspaceSource, /activityLabel\.includes\('thinking'\)\) \{/);
  assert.match(
    workspaceSource,
    /activityPhase !== 'working' && activityPhase !== 'planning'\) activityPhase = 'thinking'/,
  );
});

it('collapses a run of same-label timeline tools that no work-log line interrupts', () => {
  // A model firing several searches back to back drew one "Google Search" row
  // per call. Comparing the rendered label subsumes the file-tool rule this
  // replaced, since every file tool already renders as "Files".
  assert.match(
    detailSource,
    /entry\.kind === 'tool'\s*&& last\?\.kind === 'tool'\s*&& getTimelineToolLabel\(last\.entry\.tool\) === getTimelineToolLabel\(entry\.tool\)/,
  );
  assert.doesNotMatch(detailSource, /isFileTimelineTool\(last\.entry\.tool\)/);
  assert.match(
    detailSource,
    /if \(tool && previousTool && getTimelineToolLabel\(tool\) === getTimelineToolLabel\(previousTool\)\) return;/,
  );

  // Adjacency is the whole test, so narration has to be grouped before the
  // collapse runs: a work-log line between two searches leaves a narration
  // group last, and the next search is no longer adjacent to a tool row.
  const groupStart = detailSource.indexOf('const groupSparkActivity =');
  const narrationBranch = detailSource.indexOf("kind: 'narration', entries: [entry]", groupStart);
  const collapseBranch = detailSource.indexOf('getTimelineToolLabel(last.entry.tool)', groupStart);
  assert.notEqual(groupStart, -1);
  assert.notEqual(narrationBranch, -1);
  assert.ok(narrationBranch < collapseBranch);
});

it('ends the planning phase when the plan call completes', () => {
  assert.match(
    workspaceSource,
    /!activityLabel\)\s*\{[\s\S]*?updateSparkTask\(taskId, \{ activityPhase, progressLabel: 'Thinking it through…' \}\)/,
  );
  assert.match(
    workspaceSource,
    /announce\s*\?[\s\S]*?: \{ plan \}/,
  );
  assert.match(
    workspaceSource,
    /event\.patch\.status && event\.patch\.status !== 'running' && activityPhase === 'planning'[\s\S]*?activityPhase = 'thinking'/,
  );
});
