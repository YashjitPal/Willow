/**
 * Detecting a reply that announced work and then stopped.
 *
 * A turn ends when a reply contains no action and no tool call, because that is
 * what a finished answer looks like. But on a text protocol a model can say what
 * it is about to do in perfectly good prose and never write the tag — ending on
 * "Let's start by setting up the layout." The turn would end looking successful
 * with nothing written.
 *
 * So a reply that reads as an announcement rather than an answer earns one
 * nudge. One, not a retry loop: if the model still writes nothing, it has
 * nothing to write, and asking again would spend the user's budget on it.
 */

/**
 * Verbs that describe the agent doing the work itself. An allow-list, because
 * "Let me know what you'd like" and "Let me set up the project" differ only in
 * the verb.
 */
const ACTION = [
  'create', 'build', 'add', 'write', 'set up', 'scaffold', 'implement', 'start', 'begin',
  'generate', 'define', 'make', 'draft', 'code', 'lay out', 'put together', 'update',
  'wire up', 'sketch', 'fix', 'change', 'refactor', 'replace', 'redesign', 'style',
].join('|');

/** First person, about to act. Second person ("tell me what you'd like") hands control back. */
const ANNOUNCEMENT = new RegExp(
  String.raw`\b(?:i'?ll|i will|i'?m going to|i am going to|let'?s|let me|going to|about to|now i(?:'?ll| will)?)\b` +
    String.raw`(?:\s+\w+){0,3}?\s+(?:${ACTION})\b`,
  'i',
);

/** An announcement is the last thing said; a recap followed by an explanation is not one. */
const TAIL = 400;

export function announcedWithoutActing(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  // A question hands control back to the user, whatever came before it.
  if (trimmed.endsWith('?')) return false;
  return ANNOUNCEMENT.test(trimmed.slice(-TAIL));
}

/** The nudge, phrased as the environment's observation rather than a scolding. */
export const CONTINUE_FEEDBACK =
  'You described what you were about to do, but your reply contained no action tags, so nothing ' +
  'changed. Continue now and write the actions themselves (<willow-write>, <willow-edit>, …). ' +
  'Do not restate the plan.';
