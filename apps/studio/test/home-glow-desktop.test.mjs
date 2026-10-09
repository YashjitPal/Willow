/**
 * The zero-state glow above 960px, as measured off Gemini's desktop chat window.
 *
 * Gemini's `.lm-glow` covers the chat window, clipped to it, and holds two copies of its
 * glow mask: the top half filled with `--bard-color-lm-glow-chat`, the bottom half with
 * `--bard-color-lm-glow-bloom` at half opacity. Both are 202.18% of the window's width up
 * to 1601.27px, at 1.4338:1, centred 15px below its middle, and grow from scale(0) over 1s
 * on the standard easing. With the sidebar collapsed (a 1484x825.6 window) that puts both
 * at 1601.26x1116.79 with their top-left at (-58.6, -130.6), which Willow's computed boxes
 * matched exactly.
 *
 * Phones and tablets keep their own glow, so this also pins that none of the desktop rules
 * reach them, and that the narrow rules no longer depend on a base rule that was removed.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const appDir = path.resolve(import.meta.dirname, '..');
const html = () => fs.readFileSync(path.join(appDir, 'index.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The joined bodies of every `@media <query> { … }` block, matched brace for brace. */
const mediaBodies = (css, query) => {
  const opener = `@media ${query} {`;
  const bodies = [];
  let at = css.indexOf(opener);
  while (at !== -1) {
    let depth = 1;
    let i = at + opener.length;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    bodies.push(css.slice(at + opener.length, i - 1));
    at = css.indexOf(opener, i);
  }
  assert.ok(bodies.length > 0, `no @media ${query} block`);
  return bodies.join('\n');
};

/** The stylesheet with every @media block removed. */
const withoutMedia = (css) => {
  let out = '';
  let at = 0;
  for (let start = css.indexOf('@media', at); start !== -1; start = css.indexOf('@media', at)) {
    out += css.slice(at, start);
    let i = css.indexOf('{', start) + 1;
    for (let depth = 1; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    at = i;
  }
  return out + css.slice(at);
};

const DESKTOP = '(min-width: 961px)';
const NARROW = '(max-width: 960px)';

test('the desktop glow is Gemini\'s .lm-glow: a clipped layer holding two masked copies', () => {
  const desktop = mediaBodies(html(), DESKTOP);
  assert.match(desktop, /\.willow-home-glow-layer \{\s*display: block;\s*position: absolute;\s*inset: 0;\s*z-index: -1;\s*overflow: clip;\s*pointer-events: none;/);

  const shared = desktop.match(/\.willow-gemini-home-glow > \.willow-home-glow-layer::before,\s*\.willow-gemini-home-glow > \.willow-home-glow-layer::after \{([^}]*)\}/);
  assert.ok(shared, 'the two copies no longer share one geometry rule');
  for (const declaration of [
    'content: "";', 'position: absolute;', 'top: calc(50% + 15px);', 'left: 50%;', 'transform: translate(-50%, -50%);',
    'width: 202.18%;', 'max-width: 1601.27px;', 'aspect-ratio: 1.4338 / 1;', 'mask-image: url("/glow-mask.webp");',
    'mask-size: 100% 200%;', 'mask-repeat: no-repeat;', 'pointer-events: none;',
  ]) {
    assert.ok(shared[1].includes(declaration), `the glow geometry lost "${declaration}"`);
  }

  // Each copy's own rule, not the shared one whose selector list also names it.
  const accent = desktop.match(/\}\s*\.willow-gemini-home-glow > \.willow-home-glow-layer::before \{([^}]*)\}/)[1];
  assert.match(accent, /mask-position: 0px 0px;/);
  assert.match(accent, /animation: willow-lm-glow-grow 1s cubic-bezier\(0\.2, 0, 0, 1\) both;/);
  const bloom = desktop.match(/\}\s*\.willow-gemini-home-glow > \.willow-home-glow-layer::after \{([^}]*)\}/)[1];
  assert.match(bloom, /mask-position: 0px 100%;/);
  assert.match(bloom, /background: #000000;/);
  assert.match(bloom, /opacity: 0\.5;/);
  assert.match(bloom, /animation: willow-lm-glow-bloom-grow 1s cubic-bezier\(0\.2, 0, 0, 1\) both;/);

  const css = html();
  assert.match(css, /@keyframes willow-lm-glow-grow \{\s*0% \{\s*opacity: 0;\s*transform: translate\(-50%, -50%\) scale\(0\);\s*\}\s*100% \{\s*opacity: 1;\s*transform: translate\(-50%, -50%\) scale\(1\);/);
  assert.match(css, /@keyframes willow-lm-glow-bloom-grow \{\s*0% \{\s*opacity: 0;\s*transform: translate\(-50%, -50%\) scale\(0\);\s*\}\s*100% \{\s*opacity: 0\.5;\s*transform: translate\(-50%, -50%\) scale\(1\);/);
  assert.match(mediaBodies(css, '(prefers-reduced-motion: reduce)'), /\.willow-gemini-home-glow > \.willow-home-glow-layer::before,\s*\.willow-gemini-home-glow > \.willow-home-glow-layer::after \{\s*animation: none;/);
});

test('the desktop mask is the SVG rasterised, so a fresh glow paints from the first frame of its grow', () => {
  // The SVG's 125px blur took ~300ms to rasterise at 1601px on every mount, and a mask still
  // rasterising paints nothing: the grow was over before the glow showed. Phones keep the SVG.
  const bitmap = fs.readFileSync(path.join(appDir, 'public', 'glow-mask.webp'));
  assert.equal(bitmap.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bitmap.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.ok(bitmap.length < 150 * 1024, `the desktop glow mask grew to ${Math.round(bitmap.length / 1024)}KB`);
  assert.ok(fs.existsSync(path.join(appDir, 'public', 'glow-mask.svg')), 'the narrow glow lost its SVG mask');
  const narrow = mediaBodies(html(), NARROW);
  assert.match(narrow, /\.willow-gemini-home-glow::before \{[^}]*mask-image: url\("\/glow-mask\.svg"\);/);
  assert.match(narrow, /\.willow-gemini-home-glow::after \{[^}]*mask-image: url\("\/glow-mask\.svg"\);/);
});

test('phones and tablets keep their own glow: the layer is hidden there and nothing else is shared', () => {
  const css = html();
  const base = withoutMedia(css);
  assert.match(base, /\.willow-home-glow-layer \{\s*display: none;\s*\}/);
  // No glow rule outside a media query: the narrow pseudo-elements carry everything they paint with.
  assert.doesNotMatch(base, /\.willow-gemini-home-glow[^{]*::(before|after)\s*\{/, 'a glow rule outside @media reaches every width again');
  const narrow = mediaBodies(css, NARROW);
  const before = narrow.match(/\n\s*\.willow-gemini-home-glow::before \{([^}]*)\}/);
  assert.ok(before, 'the narrow glow rule is gone');
  assert.match(before[1], /content: "";/);
  assert.match(before[1], /margin: 0 auto;/);
  assert.match(before[1], /background: var\(--willow-home-glow-mobile-accent, var\(--willow-home-glow-accent, rgb\(19, 67, 44\)\)\);/);
});
