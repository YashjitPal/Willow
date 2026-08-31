/**
 * The turn timeline.
 *
 * The Agent tool's transcript reads the way Codex's does: the agent says what it is
 * about to do, the card for that work appears at that point, and when the turn
 * finishes everything above the closing paragraph folds away.
 *
 * That shape lives or dies on one ordered list. These cover the ordering and
 * the split, which is where it would break silently — the UI would still render
 * something plausible, just in the wrong order or with the wrong thing hidden.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { beforeEach, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const store = await importTs(
  path.join(repoRoot, 'features', 'code', 'src', 'agent', 'agent-store.ts'),
);

const TURN = 'turn_1';

const text = (chunk) => ({ type: 'text', chunk });
const callStart = (id, path_ = '/App.tsx') => ({
  type: 'call-start',
  call: { id, kind: 'create', status: 'running', startedAt: 0, path: path_ },
});

const timeline = () => store.turnTimeline(TURN);
const kinds = () => timeline().map((segment) => segment.kind);

beforeEach(() => {
  store.resetActivity();
  store.beginTurn(TURN);
});

/* ---------------------------------------------------------------------- */

it('keeps prose and tool calls in the order they happened', () => {
  store.applyHarnessEvent(TURN, text("I'll create the entry point.\n"));
  store.applyHarnessEvent(TURN, callStart('c1'));
  store.applyHarnessEvent(TURN, text('Now the styles.\n'));
  store.applyHarnessEvent(TURN, callStart('c2', '/styles.css'));
  store.applyHarnessEvent(TURN, text('All set.'));

  assert.deepEqual(kinds(), ['text', 'call', 'text', 'call', 'text']);
});

it('joins consecutive chunks into one run rather than one per token', () => {
  for (const chunk of ['I', "'ll ", 'create ', 'it.']) {
    store.applyHarnessEvent(TURN, text(chunk));
  }

  assert.deepEqual(timeline(), [{ kind: 'text', text: "I'll create it." }]);
});

it('records sub-agents in place, not in a separate list', () => {
  store.applyHarnessEvent(TURN, text('Splitting this up.\n'));
  store.applyHarnessEvent(TURN, {
    type: 'agents-start',
    agents: [
      { id: 'a1', name: 'Card builder', kind: 'implementer', status: 'running', startedAt: 0 },
    ],
  });
  store.applyHarnessEvent(TURN, text('Both are running.'));

  assert.deepEqual(kinds(), ['text', 'agents', 'text']);
  assert.deepEqual(timeline()[1].ids, ['a1']);
});

it('leaves a plain reply whole, with nothing to collapse', () => {
  // A greeting has no work behind it. Folding it behind a disclosure would
  // hide the entire answer.
  store.applyHarnessEvent(TURN, text('Hey! What would you like to build?'));

  const { work, answer } = store.splitTurn(timeline());
  assert.deepEqual(work, []);
  assert.equal(answer, 'Hey! What would you like to build?');
});

it('collapses the narration and the cards, keeping the closing paragraph', () => {
  store.applyHarnessEvent(TURN, text("I'll create the entry point.\n"));
  store.applyHarnessEvent(TURN, callStart('c1'));
  store.applyHarnessEvent(TURN, text('Now the styles.\n'));
  store.applyHarnessEvent(TURN, callStart('c2', '/styles.css'));
  store.applyHarnessEvent(TURN, text('All set — the preview is live.'));

  const { work, answer } = store.splitTurn(timeline());

  // Everything up to and including the last piece of work is hidden — the
  // running commentary included, since it describes the cards beside it.
  assert.deepEqual(
    work.map((s) => s.kind),
    ['text', 'call', 'text', 'call'],
  );
  assert.equal(answer, 'All set — the preview is live.');
  assert.doesNotMatch(answer, /I'll create/, 'narration must not survive as the answer');
});

it('treats a turn that ends on a tool call as all work', () => {
  store.applyHarnessEvent(TURN, text('Creating.\n'));
  store.applyHarnessEvent(TURN, callStart('c1'));

  const { work, answer } = store.splitTurn(timeline());
  assert.equal(work.length, 2);
  assert.equal(answer, '');
});

it('starts each turn with an empty timeline', () => {
  store.applyHarnessEvent(TURN, text('first turn'));
  store.beginTurn('turn_2');

  assert.deepEqual(store.turnTimeline('turn_2'), []);
  assert.equal(store.turnTimeline('turn_1').length, 1, 'the earlier turn is untouched');
});
