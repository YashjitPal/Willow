/**
 * Chat's /images page against Gemini's, where the 2x2 tile opens the whole template set.
 * Recorded on gemini.google.com/images at 1536x826, 800x1280 and 390x844
 * (`tools/scratch/gemini-images-more.cjs`); Willow's side is `tools/scratch/willow-images-more.cjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const css = read('features/chat/src/media/media.css').replace(/\/\*[\s\S]*?\*\//g, '');
const view = read('features/chat/src/ChatView.tsx');
const page = read('features/chat/src/media/ImagesPage.tsx');

it("keeps the scrollbar's gutter, so opening the grid moves nothing sideways", () => {
  // Gemini's `.images-page-container { overflow-y: auto; scrollbar-gutter: stable }`, at every
  // width: the grid makes the page scroll, and a gutter taken only then slid it 6px left.
  assert.match(view, /\$\{imagesPage \? 'gm-images-scroller' : ''\}/);
  assert.match(css, /\.gemini-chat-scrollbar\.gm-images-scroller \{ scrollbar-gutter: stable !important; \}/,
    "it has to beat the shell's ≤960px `.gemini-chat-scrollbar { scrollbar-gutter: auto !important }`");
});

it("puts the composer on the page's centre line, gutter and all", () => {
  // The composer's layer spans the scroller's gutter; the page centres without it.
  const align = view.slice(view.indexOf("// The page centres in the scroller's content box"));
  assert.match(align, /useLayoutEffect\(\(\) => \{/, 'before the first paint, or the composer jumps 6px on arrival');
  assert.match(align, /layer\.style\.paddingRight = `\$\{inset \+ scroller\.offsetWidth - scroller\.clientWidth\}px`;/);
  assert.match(align, /new ResizeObserver\(align\)/);
  assert.match(align, /\}, \[imagesPage\]\);/, 'a phone docks the composer, and its gutter is the same');
});

it("fades the carousel and the grid in as each is put in, as Gemini's `fade-layout`", () => {
  // `.fade-layout { animation: 0.4s ease-in-out both fadeInLayout }`, opacity 0 to 1, on
  // `carousel-image-layout` and `grid-image-layout`: the tile and Close each fade the new one in.
  assert.match(css, /\.gm-images-carousel,\s*\.gm-images-grid \{ animation: gm-images-fade-in 0\.4s ease-in-out both; \}/);
  assert.match(css, /@keyframes gm-images-fade-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/);
  const content = css.slice(css.indexOf('.gm-images-page__content {'), css.indexOf('}', css.indexOf('.gm-images-page__content {')));
  assert.doesNotMatch(content, /animation/, 'on the wrapper it ran once, when the page arrived, and the grid appeared instantly');
  // Each layout is its own element, so a toggle mounts it and the animation starts again.
  assert.match(page, /<div className="gm-images-grid" key="grid">/);
  assert.match(page, /<div className="gm-images-carousel" key="carousel">/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.gm-images-carousel,\s*\.gm-images-grid,[\s\S]*?\{ animation: none; \}/);
});
