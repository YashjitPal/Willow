/**
 * Detecting a turn that announced work and then stopped.
 *
 * The loop ends when a response contains no tool call, because that is what a
 * finished answer looks like. Upstream can rely on that: Codex uses native
 * function calling, so a model that intends to act emits a call as part of the
 * same response.
 *
 * Here tools are a text protocol, and a model can describe what it is about to
 * do in perfectly good prose and simply never open the envelope — ending its
 * message on "Let's start by creating the project plan." The turn then ends
 * looking successful, having written nothing. The user sees a plan and no app.
 *
 * So a response that reads as an announcement rather than an answer earns one
 * nudge. One, not a retry loop: if the model still emits nothing, it has
 * nothing to emit, and asking again would spend the user's budget on it.
 */

/**
 * Verbs that describe the agent doing the work itself.
 *
 * An allow-list rather than "any verb", because the phrases this has to tell
 * apart are otherwise identical in shape. "Let me know what you'd like to
 * build" and "Let me set up the project" both open with `let me`; only the
 * second is an announcement, and the difference is entirely in the verb.
 */
const ACTION = [
  'create',
  'build',
  'add',
  'write',
  'set up',
  'scaffold',
  'implement',
  'start',
  'begin',
  'generate',
  'define',
  'make',
  'draft',
  'code',
  'lay out',
  'put together',
  'install',
  'update',
  'wire up',
  'sketch',
].join('|');

/**
 * First person, about to act: "I'll create…", "Let's start by…".
 *
 * Second person is deliberately unmatched. "Tell me what you'd like" is the
 * model handing control back, which is a complete answer.
 */
const ANNOUNCEMENT = new RegExp(
  String.raw`\b(?:i'?ll|i will|i'?m going to|i am going to|let'?s|let me|going to|about to)\b` +
    String.raw`(?:\s+\w+){0,3}?\s+(?:${ACTION})\b`,
  'i',
);

/** How much of the tail is examined. An announcement is the last thing said. */
const TAIL = 400;

/**
 * True when the response announced work it never started.
 *
 * Both halves matter. A question is an answer — the model asked and is waiting,
 * so nudging it would talk over the user. And the announcement has to be near
 * the end: "I'll create the entry point" followed by a real explanation is a
 * recap, not an intention.
 */
export function announcedWithoutActing(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;

  // Handing control back to the user, whatever came before it.
  if (trimmed.endsWith('?')) return false;

  return ANNOUNCEMENT.test(trimmed.slice(-TAIL));
}

/**
 * The nudge.
 *
 * Phrased as an observation from the environment rather than a scolding, and it
 * names the mechanism, because the failure is nearly always that the model
 * described the envelope instead of emitting it.
 */
export const CONTINUE_OBSERVATION =
  'You described what you were about to do but did not emit a tool call, so ' +
  'nothing ran and no file changed. Continue now: emit the envelope itself — ' +
  'a `*** Begin Patch` block to write files, or `*** Call:` to use a tool. ' +
  'Do not restate the plan.';
