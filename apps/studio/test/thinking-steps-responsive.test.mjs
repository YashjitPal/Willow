/**
 * "Thinking steps" (and "View sources", the same `context-sidebar`) below 961px, measured
 * on Gemini at 800x1280: a full-screen sheet rather than the desktop's docked card.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'features', 'chat', 'src', 'ChatResponseChrome.tsx'), 'utf8');

const sidebar = source.slice(source.indexOf('const ContextSidebar'), source.indexOf('export const SourcesSidebar'));
const compact = sidebar.slice(sidebar.indexOf('if (isCompact) {'), sidebar.indexOf('document.body,'));

test('below 961px the context sidebar is a full-screen sheet over the top bar', () => {
  assert.match(sidebar, /const isCompact = useCompactViewport\(\);/);
  assert.match(compact, /return createPortal\(/);
  assert.match(compact, /fixed inset-0 z-\[1000\] flex flex-col overflow-hidden/);
  assert.match(compact, /bg-\[#131314\] text-\[#e3e3e3\]/);
  const sheetClasses = compact.slice(compact.indexOf('className={`fixed inset-0'), compact.indexOf('<header'));
  assert.doesNotMatch(sheetClasses, /rounded|border/, 'no radius or border on the narrow sheet');
  assert.doesNotMatch(compact, /bg-black\/55/, 'no scrim behind the narrow sheet');
  assert.match(compact, /<header className="flex h-16 shrink-0 items-center justify-between py-3 pl-6 pr-3">/);
});

test('it enters on its right margin and opacity, off WAAPI', () => {
  assert.match(compact, /initial=\{\{ opacity: 0, marginRight: -424 \}\}/);
  assert.match(compact, /animate=\{\{ opacity: 1, marginRight: 0 \}\}/);
  assert.match(compact, /exit=\{\{ opacity: 0, marginRight: -424 \}\}/);
  assert.match(compact, /marginRight: \{ duration: 0\.3, ease: \[0\.2, 0, 0, 1\] \}/);
  assert.match(compact, /opacity: \{ duration: 0\.2, ease: 'linear' \}/);
  assert.match(compact, /onUpdate=\{noop\}/);
});

test('focus lands on the close button with Gemini\'s program-focus ring', () => {
  assert.match(sidebar, /closeRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*setProgramFocused\(true\);/);
  assert.match(compact, /onBlur=\{\(\) => setProgramFocused\(false\)\}/);
  assert.match(compact, /boxShadow: `inset 0 0 0 0\.8px \$\{isLight \? 'var\(--sync-0b57d0, #0b57d0\)' : 'var\(--sync-a8c7fa, #a8c7fa\)'\}`/);
  assert.match(compact, /'rgba\(196, 199, 197, 0\.12\)'/);
  assert.match(compact, /aria-label="Close sidebar"/);
});

test('thought titles and the dotted rail take the narrow on-surface; desktop keeps its card', () => {
  assert.match(source, /const thoughtInk = isCompact \? '#e0e0e0' : '#e6e6e6';/);
  assert.match(source, /radial-gradient\(circle closest-side, \$\{thoughtInk\} 100%, transparent 100%\)/);

  const desktop = sidebar.slice(sidebar.indexOf('document.body,'));
  assert.match(desktop, /initial=\{\{ opacity: 0, x: 424 \}\}/);
  assert.match(desktop, /w-\[400px\] max-w-\[calc\(100%_-_32px\)\]/);
  assert.match(desktop, /bg-black\/55 min-\[1024px\]:hidden/);
});
