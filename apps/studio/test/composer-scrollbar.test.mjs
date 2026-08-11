/**
 * The prompt box's internal scrollbar, pinned to what was measured off the live
 * Gemini app over CDP. Five scripts; the last two existed only because the first
 * three were reading the wrong instrument.
 *
 * The reported bug was a black, chunky bar inside Willow's composer once the text
 * exceeds the box's max height. Cause: neither composer textarea carried any
 * scrollbar styling at all, so both fell through to Chrome's default bar.
 *
 * What Gemini actually does there, measured rather than assumed:
 *
 *   - The scroller is `.ql-editor` itself (scrollHeight 288 / clientHeight 168,
 *     `overflow-y: auto`, 12px gutter). Walking eight ancestors found no other
 *     element whose scrollHeight exceeds its clientHeight, so the pseudo-elements
 *     belong to the same node the pointer hovers.
 *
 *   - Authored declarations, read with `CSS.getMatchedStylesForNode` under a
 *     forced `:hover`. Every selector is universal, so they match every scroller
 *     on the page: a 12px transparent bar, a content-box transparent thumb with a
 *     2px transparent border and `--gem-sys-shape--corner-full` (9999px) radius,
 *     `#333537` on container hover, `#444746` on thumb hover/active, 0x0 buttons.
 *
 *   - Painted pixels, from four renders of a 30-CSS-px clip over the gutter,
 *     decoded by hand:
 *         pointer away from the composer        nothing
 *         pointer on the text (`:hover` true)   nothing, byte-identical to away
 *         pointer on the track below the thumb  nothing, byte-identical again
 *         pointer directly on the thumb         rgb(68,71,70), 8.68px wide
 *     The fourth state is the positive control: without it, "nothing painted"
 *     could not be told apart from "captured the wrong 30 pixels".
 *
 * So Gemini's composer shows NO scrollbar while you type. The rules match this
 * scroller and still never paint — Chromium does not repaint the scrollbar layer
 * when the originating element's `:hover` changes, and the only state that paints
 * needs the pointer parked on a thumb that was never drawn in the first place.
 * Authored but dead.
 *
 * Willow therefore hides the bar outright on both composer textareas. An earlier
 * pass opted them into `.gemini-chat-scrollbar` — the shared class that carries
 * Gemini's declarations verbatim — on the theory that identical CSS is identical
 * rendering. It is not: that class DOES paint in Willow, because Willow's
 * textarea is the scroller the pointer sits on, and a bar Gemini never shows is
 * as wrong as the black default it replaced. Hiding is what matches the pixels.
 *
 * The shared class is asserted here unchanged anyway. It has seven other users
 * and "dont alter any other scrollbar" makes all of them this test's blast
 * radius, so the block is pinned to prove the composer fix did not reach them.
 *
 * Asserted as source text: the suite has no DOM, and a rendered check would only
 * re-measure a bar that neither app draws.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const COMPOSER = () => read(repoRoot, 'features', 'chat', 'src', 'composer', 'Composer.tsx');
const INDEX_HTML = () => read(appDir, 'index.html');

/**
 * Strip comments before any *absence* assertion — the notes above the chat
 * textarea quote Gemini's own selectors and colours verbatim, so a naive search
 * over the raw file finds `::-webkit-scrollbar` in prose and reports a
 * composer-local rule that does not exist.
 */
const codeOnly = (source) => source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

/**
 * The two `<textarea>` elements, each bounded by its own self-closing `/>` rather
 * than by the next `<textarea>`. Slicing to the next open tag swallowed the whole
 * actions row and the second variant's attachment rail, which made the absence
 * check below fail on markup 300 lines away from either textarea.
 */
const textareas = () => {
  const code = codeOnly(COMPOSER());
  const opens = [...code.matchAll(/<textarea\b/g)].map((m) => m.index);
  assert.equal(opens.length, 2, 'the composer is expected to have exactly two textareas');
  return opens.map((start) => {
    const end = code.indexOf('/>', start);
    assert.notEqual(end, -1, 'each textarea is self-closing');
    return code.slice(start, end + 2);
  });
};

const chatTextarea = () => {
  const [first, second] = textareas();
  const hit = [first, second].find((t) => t.includes('willow-dictation-textarea'));
  assert.ok(hit, 'the chat-variant textarea is the one carrying willow-dictation-textarea');
  return hit;
};

const homeTextarea = () => {
  const [first, second] = textareas();
  const hit = [first, second].find((t) => t.includes('Ask Willow to create an internal tool'));
  assert.ok(hit, 'the home-variant textarea is the one with the internal-tool placeholder');
  return hit;
};

/** The `@media (pointer: fine)` block that holds the class, bounded by its own brace depth. */
const scrollbarBlock = () => {
  const css = INDEX_HTML();
  const start = css.indexOf('@media (pointer: fine)');
  assert.notEqual(start, -1, 'the pointer:fine block holding .gemini-chat-scrollbar must exist');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unterminated @media block');
};

it('neither composer textarea paints a scrollbar, because Gemini\'s does not', () => {
  for (const textarea of [chatTextarea(), homeTextarea()]) {
    assert.match(textarea, /\[&::-webkit-scrollbar\]:hidden/, 'the webkit bar is hidden outright');
    assert.match(textarea, /\[scrollbar-width:none\]/, 'and its standard-property equivalent');
  }
});

it('neither composer textarea opts into the shared visible scrollbar', () => {
  for (const textarea of [chatTextarea(), homeTextarea()]) {
    assert.doesNotMatch(
      textarea,
      /gemini-chat-scrollbar/,
      'that class paints a thumb here, and the live app paints none',
    );
  }
});

it('both textareas still scroll on the y axis — hidden bar, not lost overflow', () => {
  assert.match(chatTextarea(), /overflow-y-auto/);
  assert.match(homeTextarea(), /overflow-y-auto/);
});

it('authors no textarea-local thumb or track colour', () => {
  for (const textarea of [chatTextarea(), homeTextarea()]) {
    assert.doesNotMatch(textarea, /scrollbar-color|scrollbarColor/);
    assert.doesNotMatch(textarea, /-webkit-scrollbar-thumb|-webkit-scrollbar-track/);
  }
});

/*
 * Four hidden bars now: one per textarea, plus the two horizontal attachment
 * rails that predate this change. Pinned as an exact count rather than a blanket
 * absence check — the first draft of this test used the blanket form and failed
 * on the rails, which are markup 300 lines from either textarea.
 */
it('the attachment rails keep hiding their own horizontal bar', () => {
  const code = codeOnly(COMPOSER());
  assert.equal(
    [...code.matchAll(/\[&::-webkit-scrollbar\]:hidden/g)].length,
    4,
    'two textareas and one rail per composer variant, and nothing else',
  );
  assert.equal(
    [...code.matchAll(/::-webkit-scrollbar/g)].length,
    4,
    'those four are the only pseudo-element scrollbar rules in the composer',
  );
});

it('keeps the gutter reserved so the text does not reflow at the cap', () => {
  assert.match(chatTextarea(), /scrollbarGutter:/);
  assert.match(homeTextarea(), /scrollbarGutter: 'stable'/);
});

/*
 * The rest of this file is the blast-radius pin. `.gemini-chat-scrollbar` has
 * seven users elsewhere in the app and the composer fix must not have touched it.
 */
it('the shared class keeps the measured bar: 12px, transparent, no buttons', () => {
  const block = scrollbarBlock();
  assert.match(block, /\.gemini-chat-scrollbar::-webkit-scrollbar,/);
  assert.match(block, /background: transparent;\s*height: 12px;\s*width: 12px;/);
  assert.match(block, /::-webkit-scrollbar-button\s*\{\s*height: 0px;\s*width: 0px;\s*\}/);
});

it('the shared class keeps the measured thumb: content-box, 2px border, 9999px, min 48px', () => {
  const block = scrollbarBlock();
  const thumb = block.slice(
    block.indexOf('.gemini-chat-scrollbar::-webkit-scrollbar-thumb {'),
    block.indexOf(':hover::-webkit-scrollbar-thumb'),
  );
  assert.match(thumb, /background: content-box transparent;/, 'the resting thumb is invisible, not absent');
  assert.match(thumb, /border: 2px solid transparent;/, 'the 2px border is why the visible pill is 8px of 12');
  assert.match(thumb, /border-radius: 9999px;/, 'Gemini\'s --gem-sys-shape--corner-full resolves to 9999px');
  assert.match(thumb, /min-height: 48px;/);
  assert.match(thumb, /min-width: 48px;/);
});

it('keeps both hover colours exactly as measured, including the one that never paints', () => {
  const block = scrollbarBlock();
  assert.match(
    block,
    /\.gemini-chat-scrollbar:hover::-webkit-scrollbar-thumb \{\s*background: content-box rgb\(51, 53, 55\);/,
    'surface-container-highest #333537 — authored by Gemini, never repainted by Chromium',
  );
  assert.match(
    block,
    /-thumb:active,\s*\.gemini-chat-scrollbar::-webkit-scrollbar-thumb:hover \{\s*background: content-box rgb\(68, 71, 70\);/,
    'outline-variant #444746 — the only state whose render contained colour',
  );
});

it('scopes the scrollbar to fine pointers, as Gemini does', () => {
  assert.match(scrollbarBlock(), /^@media \(pointer: fine\)/);
});

it('leaves every other scrollbar in the app alone', () => {
  const css = INDEX_HTML();
  const selectors = [...css.matchAll(/^\s*([^\n{]*::-webkit-scrollbar[^\n{,]*)[,{]/gm)]
    .map((m) => m[1].trim())
    /* `@supports not (selector(::-webkit-scrollbar))` is a feature query, not a selector. */
    .filter((s) => !s.startsWith('@'));
  const foreign = selectors.filter((s) => !s.startsWith('.gemini-chat-scrollbar'));
  assert.deepEqual(foreign, ['.no-scrollbar::-webkit-scrollbar'], 'the composer fix must add no new scrollbar rule');
});
