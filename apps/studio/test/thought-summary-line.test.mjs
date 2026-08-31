/**
 * Gemini's live "line of thought" summary — the label beside the thinking dots.
 *
 * Everything asserted here was measured off the running Gemini app over CDP.
 *
 * THE WIPE. Gemini animates a CSS mask, not opacity or transform. The live
 * computed style on `div.animated-thinking-content` is:
 *
 *   mask-image: linear-gradient(90deg, rgb(0,0,0) 50%, rgba(0,0,0,0) calc(50% + 80px))
 *   mask-size: 300% 100%
 *   mask-position: 100% 0px
 *   mask-repeat: no-repeat
 *   animation: 0.35s linear forwards <ng-scoped>_swipe-in-animation
 *
 * and getAnimations() on that node reports keyframes
 *   {offset:0, webkitMaskPositionX:"100%", webkitMaskPositionY:"0px"} ->
 *   {offset:1, webkitMaskPositionX:"0px",  webkitMaskPositionY:"0px"}
 *   duration 350, delay 0, iterations 1, easing linear, fill forwards.
 *
 * Only X moves, linearly. A 240-frame rAF capture of the real thing agrees:
 * mask-position stepped 100% -> 95.2571% -> 90.4857% -> ... -> 0.0285714% at a
 * flat ~4.77%/frame, with no easing curvature anywhere in the ramp. 349ms wall
 * clock across that ramp.
 *
 * The 300% size with a 50%..calc(50%+80px) stop is what makes it read as a
 * soft-edged wipe and not a slide: the gradient is three times the element's
 * width, so travelling its position from 100% to 0% drags the 80px soft edge
 * across the text exactly once.
 *
 * TWO HALVES. A line change is out-wipe then in-wipe, from a MutationObserver
 * record of five real transitions:
 *
 *   531288ms  +animated-content-off   (swipe-out-animation)
 *   531666ms  -animated-content-off   (swipe-in-animation)
 *
 * gaps 346, 346, 378, 363, 363 ms against a 350ms animation — i.e. the swap
 * happens when the out-wipe ends, not on a separate timer. The rAF capture
 * shows the text width changing (241.8px -> 202.9px) on exactly the frame the
 * class flips back, confirming the swap point.
 *
 * TYPOGRAPHY, via getComputedStyle on that same live node:
 *   font-size 17px, line-height 24px, weight 400, letter-spacing normal,
 *   color rgb(227,227,227), white-space normal, display inline-flex,
 *   align-items center, flex-wrap wrap,
 *   family "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif.
 * The colour is --gem-sys-color--on-surface (#E3E3E3) — independently the same
 * value confirmed for the thinking dots' fill.
 *
 * SPACING. Gemini's dots sit at x=550 and the text at x=586. The 36px delta is
 * 24px of dots plus `margin-inline-end: var(--gem-sys-spacing--m)` = 12px. Row
 * min-height is var(--gem-sys-typography-type-scale--body-l-line-height) = 24px.
 *
 * WHICH MODELS. Gemini's summary is just the newest bold heading of its own
 * thought stream, so it only works for a provider that sections its thoughts.
 * Surveyed across 440 saved Willow chats, on real persisted `thinkingText`:
 *
 *   provider    samples  own-line headings  first line is a heading
 *   gemini           69                150                    69/69
 *   spacexai          3                  0                     0/3
 *   anthropic         6                  0                     0/6
 *
 * Grok and Claude emit bare prose beginning mid-thought ("The user said: ..."),
 * which is why a heading-less stream must keep the shimmering "Thinking" label
 * instead of showing its first line.
 *
 * A Gemini turn shows no generic label at any point — the row is the dots alone
 * until its first heading arrives, then the heading. That is gated on the turn's
 * recorded provider, not on "no heading yet", because the pre-first-heading
 * window is precisely where the two are indistinguishable by content.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const chatSrc = (...parts) => path.join(repoRoot, 'features', 'chat', 'src', ...parts);

const CSS = () => fs.readFileSync(chatSrc('thought-summary.css'), 'utf8');
const VIEW = () => fs.readFileSync(chatSrc('ChatView.tsx'), 'utf8');
const LINE = () => fs.readFileSync(chatSrc('ThoughtSummaryLine.tsx'), 'utf8');

/** Strip comments before any assertion — this file's sources quote measurements. */
const codeOnly = (source) => source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

const rule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = codeOnly(source).match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `could not locate the ${selector} rule`);
  return m[1];
};

// ── The summary text itself ──────────────────────────────────────────────────

it('takes the newest section heading, so the line advances with the stream', async () => {
  const { latestThoughtHeading } = await importTs(chatSrc('thought-summary.ts'));

  // Shape of a real Gemini stream, from a saved chat: heading alone on its
  // line, prose beneath, sections separated by blank lines.
  const stream = [
    '**Analyzing the Context**',
    '',
    "I'm currently focused on dissecting the user's question.",
    '',
    '',
    '**Accessing Image Context**',
    '',
    "I've established that the image is immediately accessible.",
  ].join('\n');

  assert.equal(latestThoughtHeading(stream), 'Accessing Image Context');
});

it('shows a heading the moment it arrives, before its prose does', async () => {
  const { latestThoughtHeading } = await importTs(chatSrc('thought-summary.ts'));
  // Mid-stream: the heading has streamed in but its body has not. Gemini
  // updates the line here rather than waiting for the paragraph.
  assert.equal(latestThoughtHeading('**Analyzing the Request**\n'), 'Analyzing the Request');
});

it('ignores bold that appears mid-prose', async () => {
  const { latestThoughtHeading } = await importTs(chatSrc('thought-summary.ts'));
  // 3 of 153 bold spans across the Gemini survey were mid-prose like this.
  // Anchoring to a whole line is what keeps them out of the summary.
  const stream = '**Real Heading**\n\nThe user asked about **molecule man** specifically.';
  assert.equal(latestThoughtHeading(stream), 'Real Heading');
});

it('returns null for a stream with no headings, so the shimmer stays', async () => {
  const { latestThoughtHeading } = await importTs(chatSrc('thought-summary.ts'));

  // Verbatim openings from the survey — Grok and Claude respectively.
  const grok = 'The user said: "heya how can you help me today?"\n';
  const claude = 'I should keep my response casual and conversational, matching their tone.';

  assert.equal(latestThoughtHeading(grok), null, 'Grok prose must not become a summary line');
  assert.equal(latestThoughtHeading(claude), null, 'Claude prose must not become a summary line');
  assert.equal(latestThoughtHeading(''), null);
});

it('tolerates CRLF and a trailing colon', async () => {
  const { latestThoughtHeading } = await importTs(chatSrc('thought-summary.ts'));
  assert.equal(latestThoughtHeading('**First**\r\n\r\nbody\r\n\r\n**Second:**\r\n'), 'Second');
});

// ── The wipe ─────────────────────────────────────────────────────────────────

it('wipes with the measured mask, not opacity or transform', () => {
  const base = rule(CSS(), '.thought-summary-line');

  // The gradient, size, position and repeat exactly as Gemini computes them.
  assert.match(
    base,
    /mask-image:\s*linear-gradient\(90deg,\s*rgb\(0,\s*0,\s*0\)\s*50%,\s*rgba\(0,\s*0,\s*0,\s*0\)\s*calc\(50%\s*\+\s*80px\)\)/,
  );
  assert.match(base, /mask-size:\s*300%\s*100%/);
  assert.match(base, /mask-position:\s*100%\s*0/);
  assert.match(base, /mask-repeat:\s*no-repeat/);

  // 350ms, linear, forwards. Any easing here would contradict the flat ramp.
  assert.match(base, /animation:\s*0\.35s\s+linear\s+forwards\s+thought-summary-swipe-in/);

  assert.doesNotMatch(base, /transition/, 'the wipe is an animation, not a transition');
});

it('inverts the gradient to hide rather than reveal on the way out', () => {
  const out = rule(CSS(), '.thought-summary-line--out');

  // Opaque half trails the soft edge, so the text is progressively hidden.
  assert.match(
    out,
    /mask-image:\s*linear-gradient\(90deg,\s*rgba\(0,\s*0,\s*0,\s*0\)\s*50%,\s*rgb\(0,\s*0,\s*0\)\s*calc\(50%\s*\+\s*80px\)\)/,
  );
  assert.match(out, /animation:\s*0\.35s\s+linear\s+forwards\s+thought-summary-swipe-out/);
});

it('travels mask-position 100% -> 0 in both directions', () => {
  const css = codeOnly(CSS());
  for (const name of ['thought-summary-swipe-in', 'thought-summary-swipe-out']) {
    const m = css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
    assert.ok(m, `missing @keyframes ${name}`);
    const frames = m[1];
    assert.match(frames, /from\s*\{[^}]*mask-position:\s*100%\s*0/, `${name} must start at 100%`);
    assert.match(frames, /to\s*\{[^}]*mask-position:\s*0\s*0/, `${name} must end at 0`);
    // Y never moves: the captured keyframes hold maskPositionY at "0px".
    assert.doesNotMatch(frames, /mask-position:\s*\d+%?\s+[1-9]/, `${name} must not move Y`);
  }
});

it('drops the mask entirely under reduced motion, as Gemini does', () => {
  const css = codeOnly(CSS());
  const m = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'missing the reduced-motion branch');
  assert.match(m[1], /animation:\s*none/);
  assert.match(m[1], /mask-image:\s*none/);
});

// ── Typography and spacing ───────────────────────────────────────────────────

it('matches the measured typography of Gemini\'s summary line', () => {
  const base = rule(CSS(), '.thought-summary-line');
  assert.match(base, /font-size:\s*17px/);
  assert.match(base, /line-height:\s*24px/);
  assert.match(base, /font-weight:\s*400/);
  assert.match(base, /letter-spacing:\s*normal/);
  assert.match(base, /color:\s*rgb\(227,\s*227,\s*227\)/);
  assert.match(base, /display:\s*inline-flex/);
  assert.match(base, /align-items:\s*center/);
  assert.match(base, /flex-wrap:\s*wrap/);
  assert.match(base, /white-space:\s*normal/);
  assert.match(base, /font-family:\s*"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif/);
});

it('sets the row gap to Gemini\'s 12px only when the summary is showing', () => {
  const view = codeOnly(VIEW());
  // 24px dots + 12px margin-inline-end = the measured 36px dots-to-text delta.
  // Gap is keyed on the heading alone: with no text there is no second child
  // for it to act on. Height is asserted separately, since it must also hold
  // through the silent pre-heading window.
  assert.match(view, /gap:\s*summaryHeading\s*\?\s*'12px'\s*:\s*'10px'/);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

it('falls back to the shimmer only for a provider that cannot section', () => {
  const view = codeOnly(VIEW());

  // The summary is only attempted while actually thinking — plus `tooling`,
  // which is a declared function running (Canvas, personalization). That phase
  // has no app-written label of its own, so without it here the row would drop
  // to bare dots for the seconds a document takes to write. `executing` and
  // `searching` are excluded because they DO have labels, and those win.
  assert.match(
    view,
    /const thoughtHeading = active && \(thinkingPhase === 'thinking' \|\| thinkingPhase === 'tooling'\)\s*\?\s*latestThoughtHeading\(msg\.thinkingText \|\| ''\)\s*:\s*null;/,
  );
  // ...and a null heading falls through to TextShimmer, not to a blank row —
  // but only once `suppressLabel` has had its say.
  assert.match(
    view,
    /summaryHeading \? \(\s*<ThoughtSummaryLine[\s\S]{0,300}?heading=\{summaryHeading\}\s*\/>\s*\) : suppressLabel \? null : active \? \(\s*<TextShimmer/,
  );
});

it('renders tool states as animated summary headings without replacing the dots', () => {
  const view = codeOnly(VIEW());

  assert.match(view, /bodyText\.trim\(\)\.length === 0/);
  assert.doesNotMatch(
    view,
    /hasActiveToolStatus/,
    'tool status must disappear with the thinking row once answer text begins',
  );
  assert.match(view, /thinkingPhase === 'searching' \? 'Searching the web'/);
  assert.match(view, /thinkingPhase === 'executing' \? 'Running code'/);
  assert.match(view, /const summaryHeading = statusHeading\s*\?\? thoughtHeading;/);
  assert.match(
    view,
    /key=\{statusHeading \? `status:\$\{statusHeading\}` : 'thought-summary'\}/,
    'tool statuses must bypass the thought-heading hold via their own React identity',
  );
  assert.match(view, /<GeminiThinkingVisualizer \/>\s*\{summaryHeading \? \(/);
  assert.doesNotMatch(view, /const phaseSymbol/);
  assert.doesNotMatch(view, /<MaterialSymbol name=\{phaseSymbol\}/);
});

it('does not guess image analysis from an attached image', () => {
  const view = codeOnly(VIEW());

  assert.doesNotMatch(view, /const isAnalyzingImage/);
  assert.doesNotMatch(view, /Analyzing image/);
});

it('never shows a generic label on a Gemini turn, before the heading or after', () => {
  const view = codeOnly(VIEW());

  // Read off the turn's own recorded provider. Inferring "Gemini" from the
  // absence of a heading cannot work: the pre-first-heading window is exactly
  // where a Gemini stream and a Grok one look identical.
  assert.match(
    view,
    /const suppressLabel =\s*msg\.modelSnapshot\?\.provider === 'gemini' && thinkingPhase === 'thinking';/,
  );

  // `modelSnapshot` is stamped onto the assistant placeholder at send time, so
  // it is populated on the row's very first render rather than arriving later.
  assert.match(
    view,
    /const assistantPlaceholder: ChatMsg = \{[\s\S]{0,200}?modelSnapshot: \{\s*provider,/,
    'the placeholder no longer records its provider — suppressLabel would read undefined',
  );

  // Scoped to the thinking phase only: "Searching" and "Running code" are real
  // distinct states Gemini itself surfaces, not placeholders for silence.
  assert.ok(
    /thinkingPhase === 'thinking'/.test(view.match(/const suppressLabel =[\s\S]*?;/)[0]),
    'suppressLabel would also blank the Searching / Running code labels',
  );
});

it('holds the row height across the silent window, so the dots do not shift', () => {
  const view = codeOnly(VIEW());
  // 24px is Gemini's body-l line-height. Applying it only once a heading exists
  // would let the row grow under the dots the moment one arrives.
  assert.match(view, /minHeight: summaryHeading \|\| suppressLabel \? 24 : undefined/);
});

it('swaps the text when the out-wipe ends, not on an independent timer', () => {
  const source = codeOnly(LINE());
  // animationend drives the swap; the timeout only exists because a
  // reduced-motion `animation: none` never fires one.
  assert.match(source, /onAnimationEnd=\{leaving \? \(\) => commitRef\.current\(\) : undefined\}/);
  assert.match(source, /setTimeout\(\(\) => commitRef\.current\(\), 380\)/);
  // A fresh element per phase, or a `forwards` animation would not replay.
  // The two key spaces must not collide, or a heading literally named "out"
  // would skip its own wipe — hence the prefix on the showing branch.
  assert.match(source, /key=\{leaving \? 'out' : `in:\$\{shown\}`\}/);
});

it('holds a heading for three seconds and then samples only the newest replacement', () => {
  const source = codeOnly(LINE());

  assert.match(source, /const MINIMUM_HEADING_HOLD_MS = 3000/);
  assert.match(source, /const shownAtRef = useRef\(performance\.now\(\)\)/);
  assert.match(
    source,
    /const remaining = MINIMUM_HEADING_HOLD_MS - \(performance\.now\(\) - shownAtRef\.current\)/,
  );
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*holdTimerRef\.current = null;\s*beginLeavingRef\.current\(\);\s*\}, remaining\)/);
  assert.match(source, /pendingRef\.current = heading/);
  assert.match(source, /setShown\(pendingRef\.current\)/);
  assert.match(source, /shownAtRef\.current = performance\.now\(\)/);
  assert.doesNotMatch(source, /pendingQueue|push\(heading\)|shift\(\)/);
});
