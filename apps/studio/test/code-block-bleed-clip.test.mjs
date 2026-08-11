/**
 * The full-bleed / paint-containment interaction, pinned.
 *
 * `.smd-code-block` sets `margin: 16px -16px 0` — it deliberately paints 16px
 * outside its column on each side, with a 40px corner radius. Any ancestor that
 * applies paint containment (`contain: paint`, or anything implying it such as
 * `content-visibility: auto`) clips descendants to its own padding box, which is
 * a rectangle with no radius. That slices those 16px off both sides, straight
 * through the widest part of the curve, and the block reads as having chiselled
 * flat edges.
 *
 * Verified by screenshot pixel sampling, not by layout rects — a clipped box
 * reports byte-identical geometry to an unclipped one, so `getBoundingClientRect`
 * cannot see this class of bug at all. Measured in Chrome at the block's bleed
 * columns: unclipped read rgb(255,0,0), clipped read the page background.
 *
 * These are source assertions because the interaction is between two files that
 * cannot import each other's runtime behaviour, and the failure is silent: the
 * layout stays correct, the tests all pass, and only rendered pixels differ.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), 'utf8');

const STYLES = () => read('platform', 'ui', 'src', 'streaming-markdown-styles.ts');
const CHAT_VIEW = () => read('features', 'chat', 'src', 'ChatView.tsx');

it('exports the bleed width instead of leaving it implicit', () => {
  assert.match(
    STYLES(),
    /export const MARKDOWN_BLOCK_BLEED_PX = 16;/,
    'the overhang must be a named export — an ancestor applying containment has to know it',
  );
});

it('keeps the exported constant agreeing with the rule it describes', () => {
  // If the negative margin changed and the constant did not, the compensation
  // would be wrong by exactly the difference and the corners would clip again.
  assert.match(
    STYLES(),
    /'\s*margin: 16px -16px 0;',/,
    '.smd-code-block bleed must stay 16px per side, or MARKDOWN_BLOCK_BLEED_PX must change with it',
  );
});

it('compensates in ChatView using that constant, not a copied number', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /import \{ MARKDOWN_BLOCK_BLEED_PX \} from '@willow\/ui\/streaming-markdown-styles';/,
    'ChatView must import the constant rather than restate 16',
  );
  assert.match(
    view,
    /paddingInline: MARKDOWN_BLOCK_BLEED_PX,\s*\n\s*marginInline: -MARKDOWN_BLOCK_BLEED_PX,/,
    'padding and margin must be equal and opposite so the content box is unchanged',
  );
});

it('applies the compensation only where containment is actually on', () => {
  // A turn without content-visibility has no clip, so widening its padding box
  // would be a gratuitous box change on the one element that also carries the
  // response reserve.
  assert.match(
    CHAT_VIEW(),
    /\.\.\.\(skip\.contentVisibility\s*\n?\s*\?\s*\{/,
    'the padding compensation must be gated on the skip actually being applied',
  );
});

it('reads the skip once and reuses it, so style and gate cannot disagree', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /const skip = messageSkipStyle\(\s*msg\.id,/,
    'a second messageSkipStyle call could return a different result from the one spread',
  );
});

it('stands containment down for the whole thread while a turn is in flight', () => {
  // A send is exactly when the previous reply stops being isLastAssistant. If it
  // gained containment at that moment, the first layout after the flip would
  // report its intrinsic size rather than its real one (measured: 1152px -> 240px),
  // and the entrance animation reads offsetTop in the very next rAF to size its
  // glide. Gating on the thread-wide flag keeps the send path at its original
  // geometry; the panel toggle this optimisation is for happens when idle.
  assert.match(
    CHAT_VIEW(),
    /!isLastAssistant && !generating && !isGenerating,/,
    'the thread-wide isGenerating gate is what keeps the send entrance measuring true geometry',
  );
});

it('measures the inner content wrapper, never the reserve-carrying outer box', () => {
  const view = CHAT_VIEW();
  // The outer box of the last assistant turn carries responseAreaMinHeight.
  // Caching that inflated height and then handing it back as an intrinsic size
  // is what drove entranceOffset negative and made the new turn teleport.
  assert.doesNotMatch(
    view,
    /messageRefs\.current\[msg\.id\] = el;\s*\n\s*measureMessageRef/,
    'measurement must not sit on the outer wrapper — that box includes the reserve',
  );
  assert.match(
    view,
    /if \(isLastAssistant\) lastAssistantContentRef\.current = el;\s*\n\s*else if \(lastAssistantContentRef\.current === el\) lastAssistantContentRef\.current = null;\s*\n\s*measureMessageRef\(msg\.id\)\(el\);/,
    'measurement belongs on the inner content wrapper, and the last-assistant ref must still be cleared by hand',
  );
});
