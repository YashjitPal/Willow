/**
 * The plus menu at each size, checked against Gemini:
 * 1. Desktop (>960px): the 249px floating card with flyout submenus.
 * 2. 960px and below, touch or not: Gemini's `gem-menu.is-mobile` popover, measured at
 *    390x844 and 800x1280 in Chat and Spark with a real CDP touch. Gemini no longer opens a
 *    bottom sheet or a tile card on any of them, so neither does Willow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const MENU = () => read('features/chat/src/composer/PlusDropdownMenu.tsx');

test('PlusDropdownMenu.tsx switches to the touch popover at 960px and below', () => {
  const code = MENU();
  assert.match(code, /import \{ useCompactViewport \} from '\.\.\/use-compact-viewport';/);
  assert.match(code, /const isCompact = useCompactViewport\(\);/);
  assert.match(code, /if \(isCompact\) \{/);
  assert.doesNotMatch(code, /DeviceMode|willow-bottom-sheet|SquircleUploadButton|createPortal/,
    'the bottom sheet and tile card are gone — Gemini shows the popover on phones too');
});

test('the touch panel is gem-menu.is-mobile', () => {
  const code = MENU();
  assert.match(code, /const TOUCH_SURFACE = '#1c1c1c';/);
  assert.match(code, /minWidth: 260,/);
  assert.match(code, /width: 'max-content',/);
  assert.match(code, /maxHeight: 'min\(440px, 42vh\)',/);
  assert.match(code, /padding: '0 8px',/);
  assert.match(code, /borderTop: '8px solid transparent',/);
  assert.match(code, /borderBottom: '8px solid transparent',/);
  assert.match(code, /scrollbarColor: 'transparent transparent',/);
  // 4px left of the plus; 8px below it, or 16px above it when it opens upward.
  assert.match(code, /side === 'top' \? 'bottom-\[calc\(100%\+16px\)\]' : 'top-\[calc\(100%\+8px\)\]'/);
  assert.match(code, /style=\{\{ left: -4 \}\}/);
  assert.match(code, /origin=\{side === 'top' \? 'bottom left' : 'top left'\}/);
});

test('touch rows are 48px with 17px labels and 24px weight-300 glyphs', () => {
  const code = MENU();
  assert.match(code, /className="group\/row relative flex h-12 w-full items-center gap-2 rounded-xl p-3 text-left"/);
  assert.match(code, /text-\[17px\] leading-6 font-normal/);
  assert.match(code, /'"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 24, "wght" 300'/);
  assert.match(code, /const TOUCH_HOVER_LAYER = 'rgba\(224,224,224,0\.08\)';/);
});

test('touch submenus are cards with a title row, placed the way Gemini places them', () => {
  const code = MENU();
  assert.match(code, /className="group\/row relative flex h-12 w-full items-center gap-2 rounded-xl px-3 pb-2 pt-4 text-left"/);
  assert.match(code, /<TouchGlyph name="close" \/>/);
  // From the trigger row's right edge, pushed inside a 24px viewport inset, ending 8px
  // above the main card's bottom.
  assert.match(code, /const TOUCH_SUBMENU_INSET = 24;/);
  assert.match(code, /trigger\.getBoundingClientRect\(\)\.right,\s*window\.innerWidth - TOUCH_SUBMENU_INSET - sub\.offsetWidth/);
  assert.match(code, /card\.getBoundingClientRect\(\)\.bottom - 8 - sub\.offsetHeight/);
  assert.match(code, /new ResizeObserver\(place\)/);
});

test('touch rows use Gemini\'s short mobile labels', () => {
  const code = MENU();
  for (const label of ['Files', 'Drive', 'Google Photos', 'Import code', 'Guided Learning']) {
    assert.match(code, new RegExp(`label="${label}"`), `missing the mobile "${label}" row`);
  }
});

test('tool rows fold into More tools by height, as Gemini\'s do', () => {
  const code = MENU();
  // Three tools inline at 844px tall, four at 920px, all of them from 1000px up.
  assert.match(code, /const TOUCH_UPLOADS_HEIGHT = 16 \+ 3 \* 48 \+ 16\.8;/);
  assert.match(code, /window\.innerHeight >= 1000\) return total;/);
  assert.match(code, /Math\.min\(440, window\.innerHeight \* 0\.42\) - TOUCH_UPLOADS_HEIGHT/);
  assert.match(code, /Math\.floor\(budget \/ 48\)/);
});

test('the touch Personal Intelligence row is Gemini\'s 52px switch row', () => {
  const code = MENU();
  assert.match(code, /className="group\/row relative block h-\[52px\] w-full text-left"/);
  assert.match(code, /className="relative mt-3 flex h-10 items-center gap-4 px-3"/);
  assert.match(code, /className="flex h-6 shrink-0 items-center rounded-full px-2"/);
});

test('PlusDropdownMenu.tsx preserves the full desktop 249px menu with submenus', () => {
  const code = MENU();
  assert.match(code, /<MenuCard\s+width=\{249\}/);
  assert.match(code, /openSub === 'uploads'/);
  assert.match(code, /openSub === 'tools'/);
});

test('Composer.css keeps the pop animation and drops the sheet keyframes', () => {
  const css = read('features/chat/src/composer/Composer.css');
  assert.match(css, /@keyframes willow-gem-menu-in/);
  assert.doesNotMatch(css, /willow-bottom-sheet-enter|willow-backdrop-fade-in/);
  assert.match(css, /\.no-scrollbar/);
  // The leading cluster's 28px glyph rule must not reach the menu rendered inside it.
  assert.match(css, /\.willow-composer-leading-actions \.luminous-symbols:not\(\[role="menu"\] \*\)/);
  // A tap must not leave the hover circle on the composer's icon buttons.
  assert.match(css, /@media \(hover: none\) \{\s*\.willow-composer-icon-button:hover \{\s*background-color: transparent !important;/);
});
