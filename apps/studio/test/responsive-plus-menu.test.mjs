/**
 * Tests verifying the 3-tier plus menu behavior matching Google Gemini:
 * 1. Desktop (>960px): 249px floating card with flyout submenus
 * 2. Tablet / Reduced Screen Desktop (<=960px, mouse): 375px compact floating card above button
 * 3. Mobile (touch / mobile UA): Native bottom sheet slider with drag handle and dark backdrop
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('PlusDropdownMenu.tsx defines 3-tier responsive device modes', () => {
  const code = read('features/chat/src/composer/PlusDropdownMenu.tsx');

  // DeviceMode type union:
  assert.match(code, /type DeviceMode = 'desktop' \| 'compact' \| 'mobile';/);

  // Hook detection based on pointer type and viewport:
  assert.match(code, /window\.matchMedia\('\(pointer: coarse\)'\)\.matches/);
  assert.match(code, /Android\|webOS\|iPhone\|iPad\|iPod\|BlackBerry\|IEMobile\|Opera Mini/i);
  assert.match(code, /if \(isTouch && width <= 768\) return 'mobile';/);
  assert.match(code, /if \(width <= 960\) return 'compact';/);
  assert.match(code, /return 'desktop';/);
});

test('PlusDropdownMenu.tsx renders native mobile bottom sheet slider on mobile/touch', () => {
  const code = read('features/chat/src/composer/PlusDropdownMenu.tsx');

  // Mobile portal rendering:
  assert.match(code, /if \(deviceMode === 'mobile'\)/);
  assert.match(code, /createPortal\(/);
  assert.match(code, /willow-bottom-sheet-overlay/);
  assert.match(code, /willow-bottom-sheet-enter/);
  assert.match(code, /willow-backdrop-fade-in/);

  // Drag handle & gesture handlers:
  assert.match(code, /handleTouchStart/);
  assert.match(code, /handleTouchMove/);
  assert.match(code, /handleTouchEnd/);
  assert.match(code, /w-\[54px\] h-\[5px\] rounded-full/);
  assert.match(code, /borderTopLeftRadius:\s*36/);
  assert.match(code, /borderTopRightRadius:\s*36/);
});

test('PlusDropdownMenu.tsx renders compact floating card for tablet & reduced desktop', () => {
  const code = read('features/chat/src/composer/PlusDropdownMenu.tsx');

  // Compact floating card:
  assert.match(code, /if \(deviceMode === 'compact'\)/);
  assert.match(code, /Math\.min\(375,/);
  assert.match(code, /maxHeight:\s*360/);
  assert.match(code, /style=\{\{\s*left:\s*cardLeftOffset\s*\}\}/);
  assert.match(code, /willow-gem-menu-in/);
  assert.match(code, /renderUploadButtonsRow/);
  assert.match(code, /renderToolsList/);

  // Squircle upload buttons: 95.6px (~96px), 40px radius, 4px gap, 16px row padding:
  assert.match(code, /min-w-\[95\.6px\]\s+w-\[95\.6px\]\s+h-\[95\.6px\]/);
  assert.match(code, /rounded-\[40px\]/);
  assert.match(code, /gap-1\s+overflow-x-auto\s+px-4/);

  // Compact tool rows: 64px height (h-16), 16px corners (rounded-2xl), 28px icons:
  assert.match(code, /flex\s+h-16\s+w-full\s+items-center\s+rounded-2xl\s+px-2/);
  assert.match(code, /text-\[16px\]\s+leading-6/);
});

test('PlusDropdownMenu.tsx preserves full desktop 249px menu with submenus', () => {
  const code = read('features/chat/src/composer/PlusDropdownMenu.tsx');

  // Desktop card and flyouts:
  assert.match(code, /<MenuCard\s+width=\{249\}/);
  assert.match(code, /openSub === 'uploads'/);
  assert.match(code, /openSub === 'tools'/);
});

test('Composer.css declares bottom sheet slide-up and backdrop fade animations', () => {
  const css = read('features/chat/src/composer/Composer.css');

  assert.match(css, /@keyframes willow-bottom-sheet-enter/);
  assert.match(css, /transform:\s*translateY\(100%\)/);
  assert.match(css, /transform:\s*translateY\(0\)/);
  assert.match(css, /\.willow-bottom-sheet-enter/);
  assert.match(css, /@keyframes willow-backdrop-fade-in/);
  assert.match(css, /\.willow-backdrop-fade-in/);
  assert.match(css, /\.no-scrollbar/);
});
