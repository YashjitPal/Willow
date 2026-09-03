/**
 * `request_user_input` in Spark: the store half.
 *
 * The three exits are the point of this file. Upstream gives them separate
 * handlers (`onSubmit`, `onSkip`, `onEscapeDismiss`) because the model is meant
 * to read them differently — answers, "carry on without me", and "the request
 * was cancelled". Collapsing skip into dismiss is the easy mistake, and it is
 * invisible until a model treats a shrug as an interruption.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

const store = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'spark-store.ts'));
const {
  createSparkQuestionSink,
  draftSparkQuestionAnswer,
  dismissSparkQuestion,
  skipSparkQuestion,
  sparkPendingQuestions,
  stepSparkQuestion,
  submitSparkQuestion,
} = store;

const QUESTIONS = [
  {
    id: 'storage',
    header: 'Storage',
    question: 'Where should saved tasks live?',
    options: [
      { label: 'IndexedDB', description: 'Survives reload, no sync.' },
      { label: 'Google Drive', description: 'Syncs, needs sign-in.' },
    ],
  },
  {
    id: 'naming',
    header: 'Naming',
    question: 'What should the folder be called?',
    options: [
      { label: 'Tasks', description: 'Short and obvious.' },
      { label: 'Spark', description: 'Matches the product name.' },
    ],
  },
];

const ask = (taskId, questions = QUESTIONS, isBlocking = true) =>
  createSparkQuestionSink(taskId)({ questions, isBlocking });

it('pre-selects the first option, as the Codex app does', () => {
  const pendingPromise = ask('task-preselect');
  const pending = sparkPendingQuestions.get()['task-preselect'];

  // Upstream seeds `selectedOptionId: e.options[0]?.id`, which is why the tool
  // schema tells the model to put the recommended choice first.
  assert.equal(pending.drafts[0].optionLabel, 'IndexedDB');
  assert.equal(pending.drafts[1].optionLabel, 'Tasks');
  assert.equal(pending.index, 0);
  assert.equal(pending.blocking, true);

  dismissSparkQuestion('task-preselect');
  return pendingPromise;
});

it('keeps a draft per question so stepping back is lossless', async () => {
  const answered = ask('task-step');

  draftSparkQuestionAnswer('task-step', { optionLabel: 'Google Drive' });
  stepSparkQuestion('task-step', 1);
  assert.equal(sparkPendingQuestions.get()['task-step'].index, 1);
  draftSparkQuestionAnswer('task-step', { optionLabel: 'Spark' });

  stepSparkQuestion('task-step', -1);
  const pending = sparkPendingQuestions.get()['task-step'];
  assert.equal(pending.index, 0);
  assert.equal(pending.drafts[0].optionLabel, 'Google Drive', 'the first answer survived the round trip');
  assert.equal(pending.drafts[1].optionLabel, 'Spark');

  // The stepper clamps rather than wrapping.
  stepSparkQuestion('task-step', -1);
  assert.equal(sparkPendingQuestions.get()['task-step'].index, 0);

  submitSparkQuestion('task-step');
  assert.deepEqual(await answered, [
    { id: 'storage', answer: 'Google Drive' },
    { id: 'naming', answer: 'Spark' },
  ]);
});

it('advancing through a multi-question round does not resolve it', async () => {
  /*
   * The panel's primary button reads "Next" until the last question and only
   * then "Send". It shipped wired to submit in both states, so pressing Next on
   * question 1 of 3 resolved the whole round and cleared the entry — which
   * presented as the panel vanishing and reappearing rather than as a wrong
   * action, because the turn carried on and asked again.
   *
   * This pins the invariant the label promises: while a next question exists,
   * advancing must leave the round live.
   */
  const answered = ask('task-advance');

  draftSparkQuestionAnswer('task-advance', { optionLabel: 'IndexedDB' });
  stepSparkQuestion('task-advance', 1);

  assert.ok(
    sparkPendingQuestions.get()['task-advance'],
    'advancing must not resolve the round',
  );
  assert.equal(sparkPendingQuestions.get()['task-advance'].index, 1);

  // Only the last question submits.
  draftSparkQuestionAnswer('task-advance', { optionLabel: 'Tasks' });
  submitSparkQuestion('task-advance');
  assert.deepEqual(await answered, [
    { id: 'storage', answer: 'IndexedDB' },
    { id: 'naming', answer: 'Tasks' },
  ]);
});

it('submits a partially answered round, reporting the rest as unanswered', async () => {
  // Leaving one question blank is a legitimate submission: upstream renders the
  // gap as "No answer provided" rather than refusing the round.
  const answered = ask('task-partial');
  draftSparkQuestionAnswer('task-partial', { optionLabel: 'Google Drive' });
  stepSparkQuestion('task-partial', 1);
  draftSparkQuestionAnswer('task-partial', { freeformText: '   ' });
  submitSparkQuestion('task-partial');

  assert.deepEqual(
    await answered,
    [{ id: 'storage', answer: 'Google Drive' }],
    'whitespace is not an answer, and the missing one is simply absent',
  );
});

it('treats an option and free text as alternatives, not additions', () => {
  const pendingPromise = ask('task-freeform');

  draftSparkQuestionAnswer('task-freeform', { freeformText: 'A local folder' });
  let draft = sparkPendingQuestions.get()['task-freeform'].drafts[0];
  assert.equal(draft.optionLabel, null, 'typing clears the pre-selected option');
  assert.equal(draft.freeformText, 'A local folder');

  draftSparkQuestionAnswer('task-freeform', { optionLabel: 'IndexedDB' });
  draft = sparkPendingQuestions.get()['task-freeform'].drafts[0];
  assert.equal(draft.freeformText, '', 'picking an option clears the text');
  assert.equal(draft.optionLabel, 'IndexedDB');

  dismissSparkQuestion('task-freeform');
  return pendingPromise;
});

it('sends free text as the answer when no option is chosen', async () => {
  const answered = ask('task-text', [QUESTIONS[0]]);
  draftSparkQuestionAnswer('task-text', { freeformText: '  A local folder  ' });
  submitSparkQuestion('task-text');
  assert.deepEqual(await answered, [{ id: 'storage', answer: 'A local folder' }]);
});

it('distinguishes skip from dismiss, which upstream reads differently', async () => {
  // Skip resolves an *empty set*, which the tool reports as `{"answers":{}}` —
  // a legitimate outcome meaning "proceed on best judgement".
  const skipped = ask('task-skip');
  skipSparkQuestion('task-skip');
  assert.deepEqual(await skipped, [], 'skip is an empty answer set');

  // Dismiss resolves null, which the tool reports as "cancelled before
  // receiving a response". Not the same thing.
  const dismissed = ask('task-dismiss');
  dismissSparkQuestion('task-dismiss');
  assert.equal(await dismissed, null, 'dismiss is a cancellation');
});

it('clears the entry on every exit, so no task is left un-answerable', async () => {
  for (const [taskId, exit] of [
    ['task-clear-submit', submitSparkQuestion],
    ['task-clear-skip', skipSparkQuestion],
    ['task-clear-dismiss', dismissSparkQuestion],
  ]) {
    const settled = ask(taskId);
    assert.ok(sparkPendingQuestions.get()[taskId], 'the question is live');
    exit(taskId);
    await settled;
    assert.equal(
      sparkPendingQuestions.get()[taskId],
      undefined,
      'a stranded question would show a prompt nobody can answer, with the turn waiting behind it',
    );
  }
});

it('resolves once, so a double click cannot answer twice', async () => {
  const answered = ask('task-once', [QUESTIONS[0]]);
  submitSparkQuestion('task-once');
  // The entry is already gone, so these are no-ops rather than second resolves.
  skipSparkQuestion('task-once');
  dismissSparkQuestion('task-once');
  assert.deepEqual(await answered, [{ id: 'storage', answer: 'IndexedDB' }]);
});

it('keeps concurrent tasks independent', async () => {
  const first = ask('task-a', [QUESTIONS[0]]);
  const second = ask('task-b', [QUESTIONS[1]]);

  draftSparkQuestionAnswer('task-a', { optionLabel: 'Google Drive' });
  submitSparkQuestion('task-a');

  assert.deepEqual(await first, [{ id: 'storage', answer: 'Google Drive' }]);
  assert.ok(sparkPendingQuestions.get()['task-b'], 'the other task is untouched');

  dismissSparkQuestion('task-b');
  assert.equal(await second, null);
});
