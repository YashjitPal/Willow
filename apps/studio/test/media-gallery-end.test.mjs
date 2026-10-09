/**
 * How far a creation tool's gallery scrolls: Gemini's ends with the last row 56px over the
 * prompt box, for image, video and music, at 1536x826, 800x1280 and 390x844
 * (`tools/scratch/gemini-gallery-bottom.cjs`; Willow's side is `willow-gallery-bottom.cjs`).
 * Willow's used to leave 256px, a screen's worth of nothing under the last row.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const css = read('features/chat/src/media/media.css').replace(/\/\*[\s\S]*?\*\//g, '');

it('ends the gallery 56px over the prompt box, at every width', () => {
  // 56 = the grid's 16 + 40 here; Gemini's is its thread's 20 under the content and 20 to the box.
  assert.match(css, /\.gm-gallery \{[^}]*padding: 88px 0 40px;/);
  assert.match(css, /\.gm-gallery__grid \{[^}]*padding: 16px;/);
  // At 960px and below the docked box keeps 12px above itself, so 16 + 28 + 12.
  assert.match(css, /@media \(max-width: 960px\) \{\s*\.gm-gallery \{ padding-bottom: 28px; \}\s*\}/);
  assert.match(read('features/chat/src/ChatView.tsx'), /\? `w-full flex justify-center px-4 max-\[960px\]:pt-3 pb-\[12px\]/,
    "the docked prompt box's 12px top is part of the 56");
});
