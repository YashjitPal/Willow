/**
 * An image the user sent opens over the chat in Gemini's lightbox, as Gemini's does, rather
 * than as a blob in a new tab. Recorded on gemini.google.com at 1536x826, 800x1280 and 390x844
 * (`tools/scratch/gemini-sent-image.cjs`); Willow's side is `tools/scratch/willow-sent-image.cjs`,
 * which matched every box to Gemini's at all three sizes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const css = read('features/chat/src/media/media.css').replace(/\/\*[\s\S]*?\*\//g, '');
const viewer = read('features/chat/src/media/SentImageViewer.tsx');
const view = read('features/chat/src/ChatView.tsx');
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is gone`);
  return css.slice(start, css.indexOf('}', start));
};

describe('opening a sent image', () => {
  it('opens the lightbox over the chat instead of a tab', () => {
    const open = view.slice(view.indexOf('const handleOpenAttachment'), view.indexOf('const handleCopy'));
    assert.match(open, /if \(attachment\.kind === 'image'\) \{\s*setSentImagePreview\(\{ id: attachment\.id, url, name: attachment\.name \}\);\s*return;\s*\}/);
    assert.doesNotMatch(open, /const opensInline = attachment\.kind === 'image'/, 'images no longer open in a tab');
    assert.match(view, /<SentImageViewer\s+url=\{sentImagePreview\.url\}\s+name=\{sentImagePreview\.name\}\s+onClose=\{\(\) => setSentImagePreview\(null\)\}/);
    assert.match(view, /useEffect\(\(\) => \{ setSentImagePreview\(null\); \}, \[chatSessionId\]\);/,
      "another chat's object URLs replace this one's; `activeChatId` would close it when a new chat is named");
  });

  it("fades the thumbnail out while its image is open, and has it back once it closes", () => {
    assert.equal(view.match(/previewing=\{sentImagePreview\?\.id === attachment\.id\}/g)?.length, 2, 'both places a sent message draws its files');
    assert.match(read('platform/ui/src/GeminiAttachmentCard.tsx'),
      /style=\{previewing \? \{ \.\.\.TILE_FONT, opacity: 0, transition: 'opacity 83ms linear' \} : TILE_FONT\}/);
  });
});

describe("Gemini's trusted-image lightbox", () => {
  it('has a header of Close, the image glyph and the name, and More options with Copy — and no editing', () => {
    assert.match(viewer, /aria-label="Close"/);
    assert.match(viewer, /name="arrow_back"/);
    assert.match(viewer, /name="image"/);
    assert.match(viewer, /<span className="gm-sent-viewer__name" title=\{name\}>\{name\}<\/span>/);
    assert.match(viewer, /aria-label="More options"/);
    assert.match(viewer, /name="content_copy"[\s\S]*?<span>Copy<\/span>/);
    assert.doesNotMatch(viewer, /Describe your changes|Resize|Erase/);
  });

  it('closes from Close (and Escape), never from the dark area, in 75ms', () => {
    assert.match(viewer, /const CLOSE_MS = 75;/);
    assert.doesNotMatch(viewer, /gm-sent-viewer__backdrop"[^>]*onClick/, "Gemini's dialog ignores clicks around the image");
    assert.match(viewer, /if \(menuOpen\) setMenuOpen\(false\);\s*else setClosing\(true\);/);
    assert.match(viewer, /backRef\.current\?\.focus\(\{ preventScroll: true \}\)/, 'Close takes focus, as the dialog does');
  });

  it('copies the image itself, as PNG', () => {
    assert.match(viewer, /navigator\.clipboard\.write\(\[new ClipboardItem\(\{ 'image\/png': png \}\)\]\)/);
    assert.match(viewer, /canvas\.toBlob\(\(png\) => \(png \? resolve\(png\) : reject\(new Error\('no PNG'\)\)\), 'image\/png'\)/);
  });

  it('sizes the image as Gemini does at every width', () => {
    // 768 at 1536 (its own cap), 600 at 800 (max(75vw, 480px)), 371 at 390 (95vw); 90vh tall.
    assert.match(block('.gm-sent-viewer__img'), /max-width: min\(95vw, 768px, max\(75vw, 480px\)\);\s*max-height: 90vh;/);
    assert.match(block('.gm-sent-viewer__content'), /max-width: min\(95vw, max\(75vw, 480px\)\);/);
  });

  it("places the header as Gemini's `.arrow-back-container`", () => {
    assert.match(block('.gm-sent-viewer__header'), /top: 12px;\s*right: 32px;\s*left: 28px;/);
    assert.match(css, /@media \(max-width: 600px\) \{\s*\.gm-sent-viewer__header \{ left: 12px; \}/);
    assert.match(block('.gm-sent-viewer__title'), /gap: 12px;/);
    assert.match(block('.gm-sent-viewer__name-row'), /gap: 8px;/);
    assert.match(block('.gm-sent-viewer__name'), /max-width: 30vw;[\s\S]*font-size: 17px;[\s\S]*"wdth" 92/);
  });

  it("draws More options as the lightbox's frosted menu", () => {
    assert.match(block('.gm-sent-viewer__menu'), /width: 256px;\s*padding: 12px 0;\s*border: 1px solid rgba\(17, 19, 21, 0\.14\);\s*border-radius: 28px;\s*background: rgba\(244, 237, 223, 0\.61\);/);
    assert.match(block('.gm-sent-viewer__menu'), /backdrop-filter: blur\(46px\) saturate\(1\.9\);/);
    assert.match(block('.gm-sent-viewer__menu-item'), /height: 48px;\s*margin: 0 6px;\s*padding: 12px 24px;[\s\S]*font-size: 17px;/);
  });

  it("opens and closes on Gemini's clock", () => {
    assert.match(block('.gm-sent-viewer__backdrop'), /animation: gm-sent-viewer-fade 83ms linear both;/);
    assert.match(block('.gm-sent-viewer__header'), /animation: gm-sent-viewer-hold-fade 333ms linear both;/);
    assert.match(css, /@keyframes gm-sent-viewer-hold-fade \{ 0%, 25% \{ opacity: 0; \} 100% \{ opacity: 1; \} \}/);
    assert.match(block('.gm-sent-viewer__img'), /animation: gm-sent-viewer-fade 400ms cubic-bezier\(0\.4, 0, 0\.02, 1\) 40ms both;/);
    assert.match(css, /\.gm-sent-viewer\.is-closing \.gm-sent-viewer__img \{ animation: gm-sent-viewer-shrink 75ms cubic-bezier\(0, 0, 0\.2, 1\) both; \}/);
  });
});
