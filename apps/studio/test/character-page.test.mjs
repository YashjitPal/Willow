// Media's character page, laid out as Flow's `flow-character-edit-page` (measured live against Flow
// by tools/ui-research/scrapers/flow/media/w-character-page.cjs): history starts hidden and the
// choice is remembered, but never on a tablet; the column only opens onto a slot with versions;
// Flow's grid, footer offset, history width and compact breakpoint; Delete image asks first and
// empties the slot; and the shared history shows a prompt-made version's prompt wherever it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

const stored = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) },
});
const prefs = await importTs(path.join(REPO_ROOT, 'features/media/src/characters/character-page-prefs.ts'));

test('history starts hidden, as the user\'s Flow opens it, and Show / Hide history is remembered', () => {
  stored.clear();
  assert.equal(prefs.readHistoryOpen(), false);
  prefs.writeHistoryOpen(true);
  assert.equal(prefs.readHistoryOpen(), true);
  prefs.writeHistoryOpen(false);
  assert.equal(prefs.readHistoryOpen(), false);
});

test("the tablet breakpoint is Flow's: under 840px portrait, under 1280px landscape", () => {
  const q = prefs.TABLET_OR_SMALLER_QUERY;
  for (const part of [
    '(max-width: 599.98px) and (orientation: portrait)',
    '(max-width: 959.98px) and (orientation: landscape)',
    '(min-width: 600px) and (max-width: 839.98px) and (orientation: portrait)',
    '(min-width: 960px) and (max-width: 1279.98px) and (orientation: landscape)',
  ]) assert.ok(q.includes(part), part);
});

test('the page decides history as Flow does: closed on a tablet, the saved choice above it, only onto versions', () => {
  const page = read('features/media/src/characters/CharacterEditPage.tsx');
  assert.match(page, /useState\(\(\) => !tablet && readHistoryOpen\(\)\)/);
  assert.match(page, /React\.useEffect\(\(\) => \{ setHistoryOpen\(!tablet && readHistoryOpen\(\)\); \}, \[tablet\]\);/);
  assert.match(page, /if \(!tablet\) writeHistoryOpen\(next\);/);
  assert.match(page, /const historyShown = historyOpen && versions\.length > 0;/);
  // On a tablet the toggle and Done are icon buttons. In a short desktop window (Flow's tablet)
  // the open column covers the page; below 961px the history is the version strip under the
  // image instead (media-responsive.test.mjs), and the page stays.
  assert.match(page, /aria-label="Done editing"/);
  assert.match(page, /className=\{`ce-body\$\{historyShown && tablet && !narrow \? ' is-hidden' : ''\}`\}/);
});

test("the layout is Flow's: a 1280px grid of 400px and the rest, the prompt past the form, a 16.8rem column", () => {
  const css = read('features/media/src/characters/characters.css');
  assert.match(css, /\.ce-layout \{[^}]*grid-template-columns: 400px 1fr;[^}]*grid-template-rows: 1fr auto;[^}]*gap: 16px 24px;[^}]*max-width: 1280px;/);
  assert.match(css, /\.ce-body \{[^}]*padding: 64px 24px 24px;/);
  assert.match(css, /\.ce-footer \{ width: 100%; max-width: 1280px; padding-left: 424px; \}/);
  assert.match(css, /\.ce-history \{[^}]*width: 268\.8px;[^}]*padding-block: 64px 112px;[^}]*transition: width 0\.35s ease-in-out;/);
  assert.match(css, /\.ce-history\.is-hidden \{ width: 0; \}/);
  assert.match(css, /@media \(max-height: 40rem\), \(max-width: 60rem\) \{[^@]*\.ce-layout \{ display: flex; flex: none; flex-direction: column;/);
  assert.match(css, /\.ce-frame \{[^}]*width: min\(100cqw, 100cqh \* var\(--ce-aspect, 1\)\);/);
  // Flow's page is dark through and through, scrollbars included.
  assert.match(css, /\.cp-page \{[^}]*color-scheme: dark;/);
});

test('Delete image asks first, then empties the slot', () => {
  const page = read('features/media/src/characters/CharacterEditPage.tsx');
  assert.match(page, /title="Delete this image\?"\s*message="This will remove the image from the character\."\s*confirmLabel="Delete"/);
  assert.match(page, /onClick=\{\(\) => setConfirmDelete\(true\)\}/);
  assert.match(page, /Generate or add an image of your character/);
  assert.match(page, /text: 'Character image deleted'/);
});

test("the shared history follows Flow's rule: a version made from a prompt shows it, an upload doesn't", () => {
  const history = read('features/media/src/editor/ImageHistory.tsx');
  assert.match(history, /const fromPrompt = \(item: MediaItem\) => !!item\.prompt && item\.modelId !== 'upload' && item\.modelId !== 'external' && item\.modelId !== 'crop';/);
  assert.match(history, /\{generated && <HotbarButton label="Flag output"/);
  assert.match(history, /\{generated && <HotbarButton label="Reuse prompt"/);
  assert.doesNotMatch(history, /isEdit && !isCrop/);
  // The prompt row hugs its text, up to the column.
  assert.doesNotMatch(read('features/media/src/scenes/scene-builder.css'), /\.sb-prompt-row \{[^}]*\n\s*width: 100%;/);
});
