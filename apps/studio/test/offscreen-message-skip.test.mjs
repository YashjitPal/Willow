/**
 * Behaviour tests for the intrinsic size handed to skipped chat messages.
 *
 * `content-visibility: auto` makes Chrome skip layout for off-screen messages,
 * which is the only fix that stops a long thread re-flowing in full on every
 * frame of the context panel's width animation. The price is that a skipped
 * element still reports a height, taken from `contain-intrinsic-size` — and
 * ChatView positions its scroll jumps off `offsetTop`, the running sum of
 * preceding siblings' heights. A wrong intrinsic height therefore does not look
 * like a styling bug; it lands "jump to answer" in the wrong place, worst in
 * exactly the long threads this exists to speed up.
 *
 * So these pin the two properties that keep the number honest: the `auto`
 * keyword must be present (it tells Chrome to prefer the height it actually
 * measured over anything written here), and a value that cannot be trusted must
 * fall back rather than emit invalid CSS — an invalid `contain-intrinsic-size`
 * drops the whole declaration, and a skipped element with no intrinsic size
 * collapses to zero, which would corrupt every offset below it at once.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const { skipStyleFor } = await importTs(
  path.join(repoRoot, 'features', 'chat', 'src', 'offscreen-message-skip.ts'),
);

it('adds nothing at all when the skip is off', () => {
  // The last assistant turn and any generating turn opt out; they must render
  // byte-identically to before this change existed.
  assert.deepStrictEqual(skipStyleFor(840, false), {});
  assert.deepStrictEqual(skipStyleFor(undefined, false), {});
});

it('uses the height that was actually measured', () => {
  const style = skipStyleFor(840, true);
  assert.strictEqual(style.contentVisibility, 'auto');
  assert.strictEqual(style.containIntrinsicSize, 'auto 840px');
});

it('keeps the auto keyword, which is what makes the number self-correcting', () => {
  // Without `auto`, Chrome would hold the written length forever instead of
  // replacing it with the real height once the element has been on screen —
  // and every offset below a re-wrapped message would stay permanently stale.
  for (const height of [240, 840, 5000]) {
    assert.match(
      skipStyleFor(height, true).containIntrinsicSize,
      /^auto \d+px$/,
      'intrinsic size must be "auto <length>"',
    );
  }
});

it('falls back rather than emitting a value CSS would reject', () => {
  // Each of these is reachable: no measurement yet (undefined), a detached node
  // (0), and a ResizeObserver reporting a fractional or non-finite box.
  for (const bad of [undefined, 0, -120, Number.NaN, Number.POSITIVE_INFINITY]) {
    const style = skipStyleFor(bad, true);
    assert.match(
      style.containIntrinsicSize,
      /^auto \d+px$/,
      `an untrusted height (${String(bad)}) must still produce valid CSS`,
    );
    const px = Number(style.containIntrinsicSize.match(/(\d+)px/)[1]);
    assert.ok(px > 0, 'a zero intrinsic size would collapse the message to nothing');
  }
});

it('rounds a fractional measurement instead of passing it through', () => {
  // ResizeObserver reports fractional block sizes on a fractional-DPR display,
  // and sub-pixel intrinsic sizes accumulate into visible offset drift over a
  // long thread.
  assert.strictEqual(skipStyleFor(840.6, true).containIntrinsicSize, 'auto 841px');
});
