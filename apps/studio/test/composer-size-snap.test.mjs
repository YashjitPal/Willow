/**
 * The chat composer changes size instantly, because Gemini's does.
 *
 * Measured off the live Gemini app (read-only; computed styles, not guesses).
 * Every element in its composer size chain:
 *
 *   .input-area                        transition: all   0s
 *   .text-input-field                  transition: all   0s
 *   .text-input-field_textarea-wrapper transition: all   0s
 *   rich-textarea                      transition: all   0s
 *   .leading-actions-wrapper           transition: all   0s
 *   .trailing-actions-wrapper          transition: all   0s
 *   .simplified-input-menu-container   transition: all   0s
 *   .ql-editor                         transition: none  0s
 *   .text-input-field_textarea-inner   transition: none  0s
 *
 * The only authored height transitions in the whole composer are
 * `.text-input-field_textarea-wrapper.pre-fullscreen` and `.fullscreen`
 * (`height 0.4s cubic-bezier(0.2,0,0,1)`) — the near-fullscreen toggle, not
 * ordinary wrapping. A `.ui-improvements-phase-1 .text-input-field_textarea-inner
 * { transition: height 0.25s }` exists in the cascade but loses and computes to
 * `none`. Gemini's surviving composer transitions are opacity/transform only
 * (send button, mic, placeholder, fullscreen control), plus `box-shadow 0.1s` on
 * `input-area-v2` and `padding-inline 0.2s` on `input-container` — neither of
 * which is the box's size.
 *
 * So the box snaps in all four cases: a line wraps, a line unwraps, the prompt is
 * sent, or a block is pasted. They are one assertion, not four, because they are
 * one mechanism: `.textarea-wrapper`'s padding IS the composer's height — 40px
 * collapsed (`py-[20px]`) against 78px expanded (`pt-4 pb-[62px]`) — so any
 * transition on `padding` there animates the entire box growing and shrinking.
 *
 * Scope: the chat variant only. The non-chat composer is not a Gemini clone and
 * keeps its own 200ms easing, so each test below has a sibling pinning that the
 * change did not leak across the ternary.
 *
 * Asserted as source text rather than rendered geometry because the suite has no
 * DOM. Verified live afterwards by sampling the box height every frame across a
 * wrap: no intermediate heights occur.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const COMPOSER = () =>
  fs.readFileSync(path.join(repoRoot, 'features', 'chat', 'src', 'composer', 'Composer.tsx'), 'utf8');

/** Strip comments before any *absence* assertion — the comments quote Gemini's own durations. */
const codeOnly = (source) => source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

/**
 * The `.textarea-wrapper` div, whose padding is the composer's height.
 *
 * Bounded by the closing `}>` and a length cap rather than "up to the next
 * backtick", because these classNames nest template literals.
 */
const sizeWrapper = (source) => {
  const m = source.match(/<div className=\{`textarea-wrapper[\s\S]{0,500}?`\}>/);
  assert.ok(m, 'could not locate the .textarea-wrapper div');
  return m[0];
};

/** The composer textarea's className template. */
const textareaClasses = (source) => {
  const m = source.match(/willow-dictation-textarea[\s\S]*?pr-\[76px\]'\}`\}/);
  assert.ok(m, 'could not locate the textarea className');
  return m[0];
};

/** The absolutely-positioned trailing controls. */
const rightControls = (source) => {
  const m = source.match(/<div ref=\{rightControlsRef\} className=\{`[\s\S]{0,400}?`\}>/);
  assert.ok(m, 'could not locate the right-controls div');
  return m[0];
};

/** The chat-variant arm of a `${chatVariant ? … : …}` slot, quoted either way. */
const chatArm = (classes, quote = "'") => {
  const m = classes.match(new RegExp(`chatVariant \\? ${quote}([^${quote}]*)${quote}`));
  assert.ok(m, 'could not read the chatVariant branch');
  return m[1];
};

// ── The box itself ──────────────────────────────────────────────────────────

it('snaps the chat composer to its new height instead of easing the padding', () => {
  // This one class is all four of the reported cases: wrap, unwrap, send, paste.
  const wrapper = sizeWrapper(codeOnly(COMPOSER()));
  assert.doesNotMatch(chatArm(wrapper), /transition|duration-/,
    'the chat composer\'s padding is animating again, so the box grows and shrinks in realtime; Gemini\'s size chain is transition-duration: 0s throughout');
  assert.match(wrapper, /\$\{chatVariant \? '' : 'transition-all duration-200'\}/,
    'the size wrapper no longer distinguishes the chat variant from the non-chat one');
});

it('leaves the non-chat composer easing its own size', () => {
  // Only the chat variant clones Gemini; the other composer was never measured
  // against it and keeps the 200ms it always had.
  const wrapper = sizeWrapper(codeOnly(COMPOSER()));
  assert.match(wrapper, /: 'transition-all duration-200'/,
    'the non-chat composer lost its own size transition');
});

// ── The text inside it ──────────────────────────────────────────────────────

it('snaps the chat editor\'s padding, which slides the text as the box moves', () => {
  // pl-[46px] -> pl-[10px] on expand. Easing it drags the caret across 36px
  // while the box is resizing; Gemini's .ql-editor is `transition: none`.
  const classes = textareaClasses(codeOnly(COMPOSER()));
  assert.doesNotMatch(chatArm(classes, '"'), /transition|duration-/,
    'the chat editor is easing its padding again');
});

it('keeps the non-chat editor\'s padding and opacity transition', () => {
  const classes = textareaClasses(codeOnly(COMPOSER()));
  assert.match(classes, /: 'transition-\[padding,opacity\] duration-200 text-\[15\.5px\]/,
    'the non-chat editor lost its own padding transition');
});

it('does not disturb the dictation fades, which are authored in CSS', () => {
  // The textarea's opacity transitions come from `.willow-dictation-textarea`
  // rules, not from the Tailwind class that was removed: `.dictation-hidden`
  // declares `transition: none` and `.exiting-dictation` declares its own
  // `opacity 250ms linear 100ms`. Both are two-class selectors and outrank a
  // utility anyway, so removing the utility cannot have changed them.
  const css = fs.readFileSync(
    path.join(repoRoot, 'features', 'chat', 'src', 'composer', 'Composer.css'), 'utf8');
  assert.match(css, /\.willow-dictation-textarea\.dictation-hidden \{[\s\S]*?transition: none;[\s\S]*?\}/,
    'the entering-dictation rule no longer pins its own transition');
  assert.match(css, /\.willow-dictation-textarea\.exiting-dictation \{[\s\S]*?transition: opacity 250ms linear 100ms;/,
    'the exiting-dictation fade no longer declares its own transition');
});

// ── The controls that move with it ──────────────────────────────────────────

it('snaps the trailing controls, as Gemini\'s trailing-actions-wrapper does', () => {
  const controls = rightControls(codeOnly(COMPOSER()));
  assert.doesNotMatch(chatArm(controls), /transition|duration-/,
    'the trailing controls are easing again');
  assert.match(controls, /\$\{chatVariant \? 'gap-1' : 'gap-3 transition-all duration-200'\}/,
    'the trailing controls no longer distinguish the chat variant');
});

it('keeps the trailing controls at a fixed right anchor', () => {
  // These are right-anchored to `.textarea-wrapper`, whose right edge never
  // moves, so `right` is the only thing that can shift them sideways. It used to
  // be `solidExpanded ? 'right-[1px]' : 'right-[0px]'` — a 1px hop on every wrap
  // and unwrap, which was hidden by the 400ms ease until the ease was removed
  // and it turned into a visible jerk. It must not depend on the expanded state.
  const controls = rightControls(codeOnly(COMPOSER()));
  const anchors = [...controls.matchAll(/right-\[(-?\d+)px\]/g)].map((m) => Number(m[1]));
  assert.ok(anchors.length > 0, 'could not read the trailing controls\' right anchor');
  assert.equal(new Set(anchors).size, 1,
    `the trailing controls have more than one right anchor (${anchors.join(', ')}) — they will jump sideways when the composer expands`);
  assert.doesNotMatch(controls, /solidExpanded/,
    'the trailing controls\' position depends on the expanded state again');
});

// ── Nothing left over ───────────────────────────────────────────────────────

it('has no 400ms size easing left anywhere in the composer', () => {
  // The three removed classes all shared `duration-[400ms]
  // ease-[cubic-bezier(0.2,0,0,1)]`. Nothing else in the file used it, so its
  // reappearance means one of them came back.
  assert.doesNotMatch(codeOnly(COMPOSER()), /duration-\[400ms\]/,
    'a 400ms transition is back in the composer — the size easing was reintroduced');
});

it('keeps the opacity and colour transitions Gemini also keeps', () => {
  // Gemini eases its own send button, mic, placeholder and fullscreen control on
  // opacity/transform. Removing the SIZE transitions must not have taken those
  // with it — the fullscreen toggle's fade is the load-bearing one.
  const source = codeOnly(COMPOSER());
  assert.match(source, /transition-\[opacity,transform,background-color\] duration-\[300ms\]/,
    'the fullscreen toggle lost its fade, which is opacity/transform and not size');
});

// ── The wrap point is measured against the padding that actually renders ─────
//
// Reported symptom: typing near the model pill, characters stopped appearing —
// then a space made them all show up at once in the expanded box.
//
// `use-composer-textarea-autosize` decides whether to expand by writing inline
// padding, reading `scrollHeight`, then clearing the inline padding so the
// Tailwind class takes over. The two have to agree. They drifted when the chat
// textarea moved to `pl-[46px]` (aligning with the dictation waveform's
// `left-[46px]`) while the measurement stayed at 40px, so the hypothetical box
// was 6px wider than the real one. Text that genuinely wrapped still measured as
// one line: `shouldExpand` stayed false, the editor stayed one row with
// `overflowY: 'hidden'`, and the wrapped line was clipped and unreachable.

const AUTOSIZE = () =>
  fs.readFileSync(
    path.join(repoRoot, 'features', 'chat', 'src', 'composer', 'use-composer-textarea-autosize.ts'),
    'utf8',
  );

/** Both branches of a `chatVariant ? a : b` measurement constant. */
const measuredPadding = (source, name) => {
  const m = source.match(
    new RegExp(`const ${name} = chatVariant \\? '(\\d+)px' : '(\\d+)px';`),
  );
  assert.ok(m, `could not locate ${name}`);
  return { chat: m[1], other: m[2] };
};

it('measures the collapsed wrap point at the padding the textarea really has', () => {
  const classes = textareaClasses(COMPOSER());

  // The collapsed pair, straight out of the className ternary.
  const chatCollapsed = classes.match(/'pl-\[(\d+)px\] pr-\[var\(--chat-collapsed-right-padding\)\]'/);
  assert.ok(chatCollapsed, 'could not locate the chat collapsed padding class');
  // Anchored past the chat collapsed class: the expanded `pl-[10px] pr-[24px]`
  // pairs sit earlier in the same template and would otherwise match first.
  const otherCollapsed = classes.match(
    /--chat-collapsed-right-padding\)\]'[\s\S]*?'pl-\[(\d+)px\] pr-\[(\d+)px\]'/,
  );
  assert.ok(otherCollapsed, 'could not locate the non-chat collapsed padding class');

  const measured = measuredPadding(AUTOSIZE(), 'collapsedPaddingLeftVal');

  assert.equal(measured.chat, chatCollapsed[1],
    'the chat collapsed left padding is measured at a different value than it renders — '
    + 'a real wrap will measure as one line and the wrapped text will be clipped');
  assert.equal(measured.other, otherCollapsed[1],
    'the non-chat collapsed left padding drifted from its measurement');
});

it('measures the expanded wrap point at the padding the textarea really has', () => {
  const classes = textareaClasses(COMPOSER());
  assert.match(classes, /'pl-\[10px\] pr-\[24px\]'/,
    'the chat expanded padding class changed — update the measurement with it');

  const source = AUTOSIZE();
  assert.equal(measuredPadding(source, 'expandedPaddingLeftVal').chat, '10');
  assert.equal(measuredPadding(source, 'expandedPaddingRightVal').chat, '24');
});

it('never leaves the measurement padding on the painted box', () => {
  // The inline values are scratch. Left behind, they would beat the class and
  // the editor would render at the measurement geometry instead of its own.
  const source = codeOnly(AUTOSIZE());
  assert.match(source, /style\.paddingLeft = '';/,
    'the measurement no longer clears its inline paddingLeft');
  assert.match(source, /style\.paddingRight = '';/,
    'the measurement no longer clears its inline paddingRight');
});

it('does not expand an empty composer when only its placeholder wraps', () => {
  const source = codeOnly(AUTOSIZE());

  assert.match(source, /const hasPromptText = promptText\.length > 0;/,
    'the autosize hook must distinguish entered text from placeholder layout');
  assert.match(source, /hasPromptText && hypotheticalScrollHeight > baseHeight/,
    'a wrapped placeholder can still set the composer multiline state');
  assert.match(source, /hasPromptText[\s\S]*?naturalExpandedScrollHeight >= baseHeight \* 3/,
    'a wrapped placeholder can still reveal the fullscreen control');
  assert.match(source, /else if \(hasPromptText && scrollHeight > baseHeight\)/,
    'a wrapped placeholder can still increase the textarea height');
});
