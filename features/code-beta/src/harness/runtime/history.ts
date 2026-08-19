/**
 * Shrinking an assistant turn before it goes back into the conversation.
 *
 * The model must see the envelopes it emitted — without them it cannot tell
 * what produced the observation that follows, and it starts trying to close
 * envelopes it cannot see. But it does not need the *contents* of a patch back.
 * Those already landed in the project, the observation says what was applied,
 * and `read_file` can fetch any of it on demand.
 *
 * The difference is not small. A turn is one request per round, with the whole
 * conversation re-sent each time, so a 500-line patch is re-uploaded on every
 * subsequent round of that turn and pushes up the wait before each new
 * paragraph. Keeping the structure and dropping the body keeps the model
 * oriented at a fraction of the size.
 */

import { PATCH_BEGIN, PATCH_END } from './protocol';

/** Bodies at or under this stay verbatim; small diffs are cheap and useful. */
const KEEP_BODY_LINES = 12;

const FILE_HEADER = /^\*\*\* (Add|Update|Delete|Move) File: /;

/**
 * Replaces long patch bodies with a note, leaving every marker in place.
 *
 * Header lines are kept whatever the size, because they name the files — which
 * is the part the model reasons about next turn.
 */
export function compactForHistory(raw: string): string {
  if (!raw.includes(PATCH_BEGIN)) return raw;

  const lines = raw.split('\n');
  const out: string[] = [];

  let inPatch = false;
  let body: string[] = [];

  const flushBody = () => {
    if (body.length === 0) return;
    if (body.length <= KEEP_BODY_LINES) {
      out.push(...body);
    } else {
      const added = body.filter((line) => line.startsWith('+')).length;
      const removed = body.filter((line) => line.startsWith('-')).length;
      out.push(`[${body.length} lines applied: +${added} -${removed}]`);
    }
    body = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inPatch) {
      if (trimmed === PATCH_BEGIN) {
        inPatch = true;
        out.push(line);
      } else {
        out.push(line);
      }
      continue;
    }

    if (trimmed === PATCH_END) {
      flushBody();
      out.push(line);
      inPatch = false;
      continue;
    }

    // A new file header ends the previous file's body.
    if (FILE_HEADER.test(trimmed)) {
      flushBody();
      out.push(line);
      continue;
    }

    body.push(line);
  }

  // An unterminated envelope still gets its body collapsed.
  flushBody();

  return out.join('\n');
}
