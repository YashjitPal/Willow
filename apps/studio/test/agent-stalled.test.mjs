/**
 * The "announced but never acted" guard.
 *
 * A response with no tool call normally means the answer is done. On a text
 * protocol it can also mean the model described the envelope instead of
 * emitting one and stopped mid-flow, which ends the turn looking successful
 * with nothing written.
 *
 * The whole risk here is false positives: nudging a model that has genuinely
 * finished talks over the user and spends their budget. Most of these cover
 * that direction.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { announcedWithoutActing, CONTINUE_OBSERVATION } = await importTs(
  path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'runtime', 'stalled.ts'),
);

/* --- announcements, which must be nudged ------------------------------- */

it('catches the announcement that ends a turn with nothing written', () => {
  // Observed: a full feature plan, then this, then the turn ended.
  assert.equal(
    announcedWithoutActing(
      'I am going to build AURA — The Ambient Soundscape.\n\n' +
        'It will include a procedural audio engine and a visualizer.\n\n' +
        "Let's start by creating the project plan.",
    ),
    true,
  );
});

it('catches the other ways a model says it is about to begin', () => {
  for (const ending of [
    "I'll create the entry point now.",
    'I will set up the project structure.',
    "I'm going to build the component tree.",
    'Let me scaffold the app first.',
    'Next, I will add the styles.',
    'Going to start with package.json.',
  ]) {
    assert.equal(announcedWithoutActing(ending), true, ending);
  }
});

/* --- answers, which must be left alone --------------------------------- */

it('leaves a greeting alone, including "let me know"', () => {
  // The dangerous near-miss: same opening as "Let me set up the project",
  // opposite meaning. The verb is the only thing telling them apart.
  assert.equal(
    announcedWithoutActing(
      "Hey! How can I help you today? Let me know what you'd like to build.",
    ),
    false,
  );
});

it('leaves a question alone, however it was phrased before', () => {
  // The model asked and is waiting. Nudging would talk over the user.
  assert.equal(
    announcedWithoutActing("I'll create whichever you prefer — which should I build?"),
    false,
  );
});

it('leaves a finished report alone', () => {
  for (const ending of [
    'All set — the preview is live and the counter works.',
    'I added the header and wired the nav links. Everything renders.',
    'That is done. The dependency is in package.json now.',
  ]) {
    assert.equal(announcedWithoutActing(ending), false, ending);
  }
});

it('treats an announcement followed by real explanation as a recap', () => {
  // The intention has to be the last thing said. Early in a message that goes
  // on to explain what happened, it is narration of work already done.
  const text =
    "I'll create the entry point.\n\n".padEnd(60, ' ') +
    'x'.repeat(500) +
    '\n\nThe file is in place and the preview reloaded.';
  assert.equal(announcedWithoutActing(text), false);
});

it('says nothing about an empty response', () => {
  assert.equal(announcedWithoutActing(''), false);
  assert.equal(announcedWithoutActing('   \n  '), false);
});

/* --- the nudge itself --------------------------------------------------- */

it('tells the model what to emit rather than only that it failed', () => {
  assert.match(CONTINUE_OBSERVATION, /\*\*\* Begin Patch/);
  assert.match(CONTINUE_OBSERVATION, /\*\*\* Call:/);
  // Restating the plan is the likely wrong response, so it is ruled out.
  assert.match(CONTINUE_OBSERVATION, /Do not restate the plan/);
});
