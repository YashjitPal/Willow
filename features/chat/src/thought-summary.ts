/**
 * Deriving Gemini's one-line thought summary from a thought stream.
 *
 * Kept free of React and CSS imports so it can be exercised directly by a test
 * rather than asserted as source text.
 *
 * Gemini's summary line is not a paraphrase it computes: its thought stream
 * arrives already sectioned, each section led by a bold heading alone on its
 * line, and the line on screen is simply the newest heading. That was verified
 * against 440 saved Willow chats, reading the `thinkingText` persisted from
 * real API responses:
 *
 *   provider    samples  headings-on-own-line  mid-prose bold  first line is a heading
 *   gemini           69                   150               3                    69/69
 *   spacexai          3                     0               2                     0/3
 *   anthropic         6                     0               0                     0/6
 *
 * Two things follow, and both are measurements rather than choices:
 *
 *   1. Only Gemini sections its thoughts. Grok and Claude emit bare prose
 *      starting mid-thought ("The user said: ..."), so showing their first line
 *      would put the user's own question back on screen as a fake summary.
 *      A heading-less stream therefore has to fall back to the shimmer.
 *   2. Bold does occasionally appear mid-prose (3 spans in 153). Anchoring the
 *      pattern to a whole line is what keeps those out of the summary.
 *
 * The captured Gemini lines this reproduces, recorded off the live app:
 *   "Initiating Inquiry Breakdown", "Finalizing Activity Categories",
 *   "Analyzing the Request", "Clarifying Intent and Capabilities",
 *   "Defining Gemini's Expertise", "Initiating Thought Analysis",
 *   "Prioritizing Instruction Adherence", "Simplifying Core Principles".
 */

/** A `**Heading**` alone on its line, with an optional trailing colon. */
const HEADING_ON_OWN_LINE = /^[ \t]*\*\*(.+?)\*\*[ \t]*:?[ \t]*$/gm;

/**
 * The newest section heading in an in-flight thought stream, or null when the
 * stream has none.
 *
 * Returns the *last* match rather than the first: the stream is appended to as
 * it arrives, so the newest heading is the one at the end, and the summary line
 * tracks it as each new section opens.
 *
 * A trailing colon is trimmed. Gemini's own headings carry none, but a stream
 * that writes "**Heading:**" reads identically to the user and should not show
 * the punctuation.
 */
export const latestThoughtHeading = (thinkingText: string): string | null => {
  if (!thinkingText) return null;
  let latest: string | null = null;
  for (const match of thinkingText.replace(/\r\n/g, '\n').matchAll(HEADING_ON_OWN_LINE)) {
    const heading = match[1].trim().replace(/:$/, '').trim();
    // `**` alone on a line matches the pattern but is not a heading.
    if (heading && heading !== '*') latest = heading;
  }
  return latest;
};
