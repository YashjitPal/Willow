/**
 * Behaviour tests for the chat thread's scroll-anchor selection.
 *
 * These run the real function against a hand-built fake DOM rather than
 * asserting on source text, because what can break here is a *choice* — the
 * walker always returns something plausible, so a wrong pick still pins the
 * thread and still looks like an improvement. Only a case that names the
 * expected element catches it.
 *
 * The bug this whole path exists for: opening the thinking-steps panel narrows
 * the thread column, text re-wraps and grows, and content above the viewport
 * pushes the reader's line down the screen. Chrome would normally repay that via
 * scroll anchoring, but the panel animates padding and width — both suppress
 * anchoring — so it is off for exactly the 300ms in which it was needed.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const { findDeepBlockAnchor } = await importTs(
  path.join(repoRoot, 'features', 'chat', 'src', 'scroll-anchor.ts'),
);

/**
 * A box in a fake layout. `top`/`bottom` are viewport coordinates, matching what
 * getBoundingClientRect reports, so the fixtures read like a screenshot.
 */
const box = (name, top, bottom, children = [], display = 'block') => ({
  name,
  display,
  children,
  getBoundingClientRect: () => ({ top, bottom, height: bottom - top }),
});

const displayOf = (element) => element.display;
const find = (root, refY) => findDeepBlockAnchor(root, refY, displayOf);

it('descends to the paragraph, not the message wrapper', () => {
  // The case the pin exists for: one long reply, the reader partway down it.
  // The wrapper's top is far off-screen and never moves, so pinning it would
  // hold a position nothing was drifting from.
  const paragraph = box('p2', -10, 60);
  const root = box('thread', -400, 900, [
    box('turn', -400, 900, [
      box('wrapper', -400, 900, [box('p1', -400, -10), paragraph, box('p3', 60, 900)]),
    ]),
  ]);

  assert.strictEqual(find(root, 0)?.name, 'p2', 'must pin the paragraph crossing the viewport top');
});

it('picks the box coming into view when the line falls in a gap', () => {
  // Thread gaps are 52px, so the viewport top lands between messages often.
  // Holding the next box still holds the gap above it still too.
  const root = box('thread', -300, 800, [
    box('turn-a', -300, -20),
    box('turn-b', 32, 800, [box('body', 32, 800)]),
  ]);

  assert.strictEqual(find(root, 0)?.name, 'body', 'a gap must fall through to the next box down');
});

it('stops at the block boundary instead of pinning a word span', () => {
  // StreamingMarkdown builds a per-word span tree. Re-wrap moves words between
  // lines on purpose — pinning one would fight the reflow the reader wanted and
  // jitter by a line-height doing it.
  const root = box('thread', -100, 500, [
    box('paragraph', -10, 40, [
      box('word', -10, 20, [], 'inline'),
    ]),
  ]);

  assert.strictEqual(find(root, 0)?.name, 'paragraph', 'inline children must not win the walk');
});

it('skips a collapsed box when reaching for the next one below the line', () => {
  // A zero-height box can never straddle, so the guard earns its place on the
  // next-below path: an empty wrapper below the line would otherwise be picked
  // ahead of the real content and pinned at a height that cannot move.
  const root = box('thread', -100, 500, [
    box('collapsed', 40, 40),
    box('real', 60, 200),
  ]);

  assert.strictEqual(find(root, 0)?.name, 'real', 'a zero-height box must never be the anchor');
});

it('returns null when there is nothing at or below the line', () => {
  // Everything scrolled past. The caller treats null as "no pin" and leaves the
  // scroller alone rather than writing a scrollTop it cannot justify.
  const root = box('thread', -900, -100, [box('turn', -900, -100)]);

  assert.strictEqual(find(root, 0), null, 'no candidate must mean no anchor, not a fallback');
});

it('walks past deep nesting without running out of depth', () => {
  // thread -> turn -> wrapper -> prose -> block is five; the cap is twelve. This
  // builds nine to confirm the real tree has headroom.
  let node = box('leaf', -5, 50);
  for (let depth = 8; depth >= 1; depth -= 1) node = box(`level-${depth}`, -5, 50, [node]);

  assert.strictEqual(find(node, 0)?.name, 'leaf', 'the depth cap must clear a realistic tree');
});

it('stops at the cap rather than walking forever', () => {
  // A pathological tree must not spin: the walk is per-frame during the panel
  // transition, so an unbounded descent would be a frame-rate cliff.
  let node = box('bottom', -5, 50);
  for (let depth = 0; depth < 40; depth += 1) node = box(`deep-${depth}`, -5, 50, [node]);

  const anchor = find(node, 0);
  assert.ok(anchor, 'a deep tree must still yield an anchor');
  assert.match(anchor.name, /^deep-/, 'the walk must stop at the cap, not descend to the bottom');
});
