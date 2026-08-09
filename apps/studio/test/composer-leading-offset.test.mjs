/**
 * The composer's leading edge, checked against the Gemini measurement.
 *
 * Gemini builds the plus button's single-line offset from three authored
 * declarations, all under `@media (min-width: 768px)`:
 *
 *   .lm-input-redesign .text-input-field                      padding: 12px
 *   ... :where(.simplified-input-area) .leading-actions-wrapper
 *                                                margin-inline-start: 2px
 *   .simplified-input-menu-container             margin-inline-start: 6px
 *
 * = 20px. At two lines Gemini drops `simplified-input-area` — the field becomes
 * `height-expanded-past-single-line with-toolbox-drawer` — so the 2px rule stops
 * matching and the plus lands at 12+0+6 = 18px. Recorded off the live app while
 * it was typed into a line at a time, settled dwells only:
 *
 *   dwell     height   plusLeft  fromBottom  classes
 *   67324ms   64         20         16       simplified-input-area
 *   12231ms   102-126    18         15       height-expanded-past-single-line …
 *   16458ms   150        18         15       … pre-fullscreen
 *   32593ms   64         20         16       simplified-input-area
 *
 * Our box pads 14px where Gemini's pads 12, so those are `left-[6px]` collapsed
 * and `left-[4px]` expanded. Before the fix collapsed was `left-[0px]` = 14px,
 * so the icon travelled 4px RIGHTWARDS on expand where Gemini's travels 2px
 * leftwards.
 *
 * BEWARE when re-measuring: pasting a large block animates the height from 64px
 * to ~208px in one sweep while Angular's class flip lags several frames. Sampling
 * during that reads 20px at heights the composer never rests at, which looks
 * like "the plus never moves horizontally". It does. Type a line at a time and
 * let each state settle.
 *
 * The vertical axis needs no correction: Gemini and our composer both hold the
 * plus 16px above the box bottom at one line and 15px at two or more, and both
 * travel the same 44px down the screen from one line to three, because the home
 * composer is centred and so grows downward as well as upward.
 *
 * The text offset is pinned in the same file because it is not independent —
 * Gemini's single-line row is a grid with `column-gap: 8px`, so its text sits at
 * 20+32+8 = 60px. Moving the icon without the text would close that gap to 2px.
 *
 * These are asserted as source text rather than rendered geometry because the
 * suite has no DOM; the live numbers above are what the strings encode.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const COMPOSER = () =>
  fs.readFileSync(path.join(repoRoot, 'features', 'chat', 'src', 'composer', 'Composer.tsx'), 'utf8');

/** Strip comments before any *absence* assertion — this file's comments quote the old values. */
const codeOnly = (source) => source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

/**
 * The `absolute ... z-[60]` wrapper that carries the plus button.
 *
 * Bounded by the closing `}>` rather than "up to the next backtick", because the
 * collapsed branch is itself a nested template literal.
 */
const leadingActions = (source) => {
  const m = source.match(
    /<div className=\{`absolute shrink-0 flex items-center gap-2 z-\[60\][\s\S]{0,400}?`\}>/,
  );
  assert.ok(m, 'could not locate the leading-actions wrapper');
  return m[0];
};

/** The composer textarea's className template. */
const textareaClasses = (source) => {
  const m = source.match(/willow-dictation-textarea[\s\S]*?pr-\[76px\]'\}`\}/);
  assert.ok(m, 'could not locate the textarea className');
  return m[0];
};

/**
 * The collapsed chat-variant text padding.
 *
 * Anchored on `--chat-collapsed-right-padding` so it cannot match the maximized
 * or expanded branches, which also start with `chatVariant ? 'pl-[`.
 */
const collapsedTextPad = (source) => {
  const m = textareaClasses(source)
    .match(/chatVariant \? 'pl-\[(\d+)px\] pr-\[var\(--chat-collapsed-right-padding\)\]'/);
  assert.ok(m, 'could not read the collapsed chat text padding');
  return Number(m[1]);
};

// ── The plus button ─────────────────────────────────────────────────────────

it('puts the collapsed plus at Gemini\'s 20px (14px box + 6px)', () => {
  const wrapper = leadingActions(codeOnly(COMPOSER()));
  assert.match(wrapper, /chatVariant \? 'left-\[6px\]' : 'left-\[0px\]'/,
    'the collapsed chat composer no longer offsets the plus by 6px — it will sit at 14px, not Gemini\'s 20px');
});

it('keeps the expanded plus at Gemini\'s 18px (14px box + 4px)', () => {
  const wrapper = leadingActions(codeOnly(COMPOSER()));
  assert.match(wrapper, /solidExpanded && chatVariant \? 'bottom-\[5px\] left-\[4px\]'/,
    'the expanded offset drifted from the measured 18px');
});

it('moves the plus 2px leftwards on expand, as Gemini does', () => {
  // 6px collapsed -> 4px expanded, i.e. 20px -> 18px from the box edge, because
  // Gemini drops `simplified-input-area` at two lines and its 2px
  // margin-inline-start stops applying. If these ever invert, the icon travels
  // the wrong way and the original bug is back; if they ever equalise, someone
  // has re-measured during a paste animation (see the header).
  const wrapper = leadingActions(codeOnly(COMPOSER()));
  const collapsed = wrapper.match(/chatVariant \? 'left-\[(\d+)px\]' : 'left-\[0px\]'/);
  const expanded = wrapper.match(/solidExpanded && chatVariant \? 'bottom-\[5px\] left-\[(\d+)px\]'/);
  assert.ok(collapsed && expanded, 'could not read both offsets');
  assert.ok(
    Number(collapsed[1]) > Number(expanded[1]),
    `collapsed (${collapsed[1]}px) must exceed expanded (${expanded[1]}px) — Gemini moves the icon left when it wraps`,
  );
  assert.equal(Number(collapsed[1]) - Number(expanded[1]), 2,
    'the collapsed->expanded travel is no longer Gemini\'s 2px');
});

it('leaves the non-chat composer\'s plus where it was', () => {
  // The measurement is Gemini's, and only the chat variant clones Gemini.
  const wrapper = leadingActions(codeOnly(COMPOSER()));
  assert.match(wrapper, /: 'left-\[0px\]'/,
    'the non-chat variant lost its own 0px offset');
});

// ── The text that has to move with it ───────────────────────────────────────

it('starts collapsed text at Gemini\'s 60px, 8px past the icon', () => {
  const classes = textareaClasses(codeOnly(COMPOSER()));
  assert.match(classes, /chatVariant \? 'pl-\[46px\] pr-\[var\(--chat-collapsed-right-padding\)\]'/,
    'the collapsed chat text no longer starts at 14+46 = 60px — the gap to the plus is not Gemini\'s 8px');
  assert.match(classes, /: 'pl-\[40px\] pr-\[76px\]'/,
    'the non-chat variant lost its own 40px text offset');
});

it('keeps the icon and the text 8px apart, the measured column-gap', () => {
  const source = codeOnly(COMPOSER());
  const left = Number(leadingActions(source).match(/chatVariant \? 'left-\[(\d+)px\]'/)[1]);
  const pad = collapsedTextPad(source);
  // Both are measured from the same box edge, and the icon is 32px wide.
  assert.equal(pad - (left + 32), 8,
    `text starts ${pad - (left + 32)}px after the icon; Gemini's single-line grid uses column-gap: 8px`);
});

it('aligns the collapsed text with the dictation waveform', () => {
  // The waveform overlay sits at left-[46px] inside the same wrapper. Before the
  // fix the text was at 40px and the two disagreed by exactly the 6px bug.
  const source = codeOnly(COMPOSER());
  const pad = collapsedTextPad(source);
  const wave = source.match(/absolute left-\[(\d+)px\] right-\[86px\] top-1\/2/);
  assert.ok(wave, 'could not locate the dictation waveform overlay');
  assert.equal(pad, Number(wave[1]),
    'the collapsed text and the dictation waveform no longer start at the same x');
});
