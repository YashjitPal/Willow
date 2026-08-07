/**
 * Chat turn spacing, verified against pixels measured from the live Gemini app.
 *
 * Measured over CDP from `infinite-scroller.chat-history` with two turns on
 * screen (Chrome 151, 2x display):
 *
 *   row-gap between .conversation-container          52
 *   query bubble bottom -> model-response top        52
 *   .response-container-footer bottom -> next bubble 52
 *   .response-container-footer height                36  (opacity 0 off the last turn)
 *   response text bottom -> next bubble top          88  (= 52 + the 36 row)
 *
 * So every user/assistant turn boundary in Gemini is 52px, and the action row
 * sits inside the response box rather than in the gap. Our assistant wrapper is
 * built the same way -- the action row is a child of the turn element -- so
 * applying 52 to both boundaries reproduces the 88px perceived blank.
 *
 * The constants and the `gapBefore` expression are parsed out of ChatView rather
 * than restated here, and the expression is evaluated as written. Editing either
 * one makes this recompute and fail instead of passing against a stale copy.
 * Node cannot import the TSX module, which is why the source is read as text --
 * the approach the other tests in this directory take.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../../../features/chat/src/ChatView.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');

/** Measurements from the live Gemini page. */
const GEMINI = {
  turnBoundary: 52,
  actionRowHeight: 36,
  textToNextBubble: 88,
};

const constant = (name) => {
  const match = source.match(new RegExp(`const ${name} = (\\d+);`));
  assert.ok(match, `${name} is no longer a plain numeric constant in ChatView`);
  return Number(match[1]);
};

const MESSAGE_GAP = constant('MESSAGE_GAP');
const THREAD_GAP = constant('THREAD_GAP');
const TARGET_VISUAL_OFFSET = constant('TARGET_VISUAL_OFFSET');
const THREAD_BOTTOM_PADDING = constant('THREAD_BOTTOM_PADDING');

/**
 * Rebuild `gapBefore` from the source expression.
 *
 * Matching to the semicolon keeps the whole nested ternary, so every branch --
 * including the edit-mode collapse -- is the shipped one.
 */
const gapExpression = (() => {
  const match = source.match(/const gapBefore = ([\s\S]+?);\n/);
  assert.ok(match, 'could not locate the gapBefore expression');
  return match[1];
})();

const gapBefore = new Function(
  'messageIndex', 'previousMessage', 'msg', 'isIncognito', 'editingUserId',
  'MESSAGE_GAP', 'THREAD_GAP',
  `return (${gapExpression});`,
);

const user = (id = 'u1') => ({ id, role: 'user' });
const assistant = (id = 'a1') => ({ id, role: 'assistant' });

const gapAt = (previousMessage, msg, opts = {}) => gapBefore(
  opts.messageIndex ?? 1,
  previousMessage,
  msg,
  opts.isIncognito ?? false,
  opts.editingUserId ?? null,
  MESSAGE_GAP,
  THREAD_GAP,
);

describe('chat turn gap', () => {
  it('matches the 52px turn boundary measured off Gemini', () => {
    assert.equal(MESSAGE_GAP, GEMINI.turnBoundary,
      'MESSAGE_GAP no longer matches the measured Gemini row-gap');
  });

  it('spaces an assistant response from the next sent message by the measured gap', () => {
    assert.equal(gapAt(assistant(), user('u2')), GEMINI.turnBoundary,
      'the annotated boundary -- response end to the next sent bubble -- has drifted');
  });

  it('leaves the user-to-assistant boundary at the same measured gap', () => {
    assert.equal(gapAt(user(), assistant()), GEMINI.turnBoundary);
  });

  it('reproduces the perceived blank once the action row is counted', () => {
    // Gemini keeps its 36px action row inside the response box and off the gap,
    // so the visible blank is the boundary plus that row. Ours is built the
    // same way, which is what makes the two comparable.
    assert.equal(MESSAGE_GAP + GEMINI.actionRowHeight, GEMINI.textToNextBubble);
  });
});

describe('chat mechanism the gap must not disturb', () => {
  it('still collapses the gap under the bubble being edited', () => {
    // The edit form grows into the space below the bubble, so the reserve math
    // drops MESSAGE_GAP for that turn. If this stops returning 0 the editor
    // overlaps the response.
    assert.equal(
      gapAt(user('u1'), assistant(), { editingUserId: 'u1' }),
      0,
    );
  });

  it('keeps the first message flush to the top of the thread', () => {
    // Zero here is what lets `scrollMarginTop` land the first bubble exactly on
    // TARGET_VISUAL_OFFSET.
    assert.equal(gapAt(undefined, user(), { messageIndex: 0 }), 0);
    assert.ok(TARGET_VISUAL_OFFSET > 0, 'the scroll anchor offset went missing');
  });

  it('leaves the incognito banner spacing alone', () => {
    // Not measured off Gemini and not part of the request, so it must stay on
    // THREAD_GAP rather than follow the turn boundary. This is now THREAD_GAP's
    // only caller -- keep it distinct so a future edit can't quietly alias the
    // two constants and make this assertion vacuous.
    assert.equal(
      gapAt(undefined, user(), { messageIndex: 0, isIncognito: true }),
      THREAD_GAP,
    );
    assert.notEqual(THREAD_GAP, MESSAGE_GAP);
  });

  it('spaces same-role runs like every other boundary', () => {
    // Measured in Chrome: a same-role neighbour used to render a 32px margin
    // while both real turn boundaries render 52, so that one gap read as
    // visibly tighter than the rest of the thread. Same-role runs occur on
    // split/live turns and on reloads where a contentless message between two
    // turns was dropped, so they are not hypothetical.
    assert.equal(gapAt(assistant('a1'), assistant('a2')), MESSAGE_GAP);
    assert.equal(gapAt(user('u1'), user('u2')), MESSAGE_GAP);
  });

  it('uses one spacing for every message boundary in the thread', () => {
    // The actual regression was non-uniformity, so assert it directly: no
    // boundary between two messages may differ from any other.
    const roles = ['user', 'assistant'];
    const gaps = new Set();
    for (const prev of roles) {
      for (const next of roles) {
        gaps.add(gapAt({ id: 'p', role: prev }, { id: 'n', role: next }));
      }
    }
    assert.deepEqual([...gaps], [MESSAGE_GAP],
      'message boundaries no longer share a single gap');
  });

  it('reserves against the column padding so the thread cannot be scrolled early', () => {
    // The reserve fills the viewport from the anchored bubble to the scrollport's
    // bottom edge, but the column's pb sits *below* that. Measured in Chrome:
    // omitting it leaves exactly `pb` of scrollTop past the anchor at every
    // viewport/bubble size tried, subtracting it leaves 0. Tailwind can't read
    // the constant, so assert the two agree.
    const cls = source.match(/pb-\[(\d+)px\]/);
    assert.ok(cls, 'the thread column no longer carries a pb-[Npx] class');
    assert.equal(
      THREAD_BOTTOM_PADDING,
      Number(cls[1]),
      'THREAD_BOTTOM_PADDING drifted from the column pb- class; the post-send '
        + 'thread would become scrollable by the difference',
    );

    // Every reserve site must subtract it, or that site reintroduces the slop.
    // Keyed on subtracting the bubble's offsetHeight, which is the reserve
    // formula's signature -- TARGET_VISUAL_OFFSET alone also appears in the
    // N-turn jump, which sets scrollTop and must *not* subtract the padding.
    const reserveSites = [...source.matchAll(/-\s*(?:msgEl|messageElement)\.offsetHeight/g)];
    assert.ok(reserveSites.length >= 4, 'expected four response-area reserve sites');
    const subtractions = [...source.matchAll(/-\s*THREAD_BOTTOM_PADDING/g)];
    assert.equal(
      subtractions.length,
      reserveSites.length,
      'a response-area reserve site does not subtract THREAD_BOTTOM_PADDING',
    );
  });

  it('reserves response height against the user-to-assistant gap only', () => {
    // All four scroll-math sites subtract the gap below the last *user* bubble.
    // Were any of them reading the assistant->user boundary, this change would
    // have moved the send-scroll target.
    const reserveSites = [...source.matchAll(/- MESSAGE_GAP|MESSAGE_GAP\)/g)];
    assert.ok(reserveSites.length >= 4,
      'the response-area reserve no longer subtracts MESSAGE_GAP');
    for (const match of source.matchAll(/([^\n]*MESSAGE_GAP[^\n]*)/g)) {
      const line = match[1];
      if (!line.includes('editingUserId === lastUser') && !line.includes('- MESSAGE_GAP')) continue;
      assert.ok(!line.includes('assistant'),
        `a reserve site reads an assistant boundary: ${line.trim()}`);
    }
  });
});
