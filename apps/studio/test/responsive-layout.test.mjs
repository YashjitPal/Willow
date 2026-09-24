/**
 * Responsive layout tests verifying mobile drawer navigation, breakpoints, and zero desktop regressions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('Sidebar.css defines universal mobile drawer and scrim rules at 960px breakpoint', () => {
  const css = read('apps/studio/src/shell/sidebar/Sidebar.css');

  // Universal media query breakpoint:
  assert.match(css, /@media \(max-width:\s*960px\)/);

  // Mobile scrim:
  assert.match(css, /\.studio-sidebar-mobile-scrim \{\s*position:\s*fixed;\s*inset:\s*0;\s*z-index:\s*45;/);

  // Mobile sidebar container:
  assert.match(css, /\.studio-sidebar \{\s*position:\s*fixed !important;\s*inset:\s*0 auto 0 0 !important;\s*z-index:\s*50 !important;/);
  assert.match(css, /\.studio-sidebar--collapsed \{\s*transform:\s*translateX\(-100%\) !important;/);
  assert.match(css, /\.studio-sidebar--expanded \{\s*transform:\s*translateX\(0\) !important;/);

  // Mobile open trigger:
  assert.match(css, /\.studio-sidebar-mobile-open \{\s*position:\s*fixed;\s*top:\s*8px;\s*left:\s*8px;\s*z-index:\s*35;/);
  assert.match(css, /:is\(\.light-theme, \[data-theme="light"\]\) \.studio-sidebar-mobile-open \{\s*color:\s*#444746;\s*\}/);
});

test('StudioLayout.tsx enables universal mobile sidebar toggle and auto-collapse', () => {
  const layout = read('apps/studio/src/shell/StudioLayout.tsx');

  // Mobile open button is no longer restricted to spark:
  assert.doesNotMatch(layout, /studioExperience === 'spark' && isSidebarCollapsed && !isSidebarHidden && \(\s*<button\s*type="button"\s*className="studio-sidebar-mobile-open"/);
  assert.match(layout, /isSidebarCollapsed && !isSidebarHidden && \(\s*<button\s*type="button"\s*className="studio-sidebar-mobile-open"/);

  // Scrim button is universal:
  assert.doesNotMatch(layout, /studioExperience === 'spark' && !isSidebarCollapsed && \(\s*<button\s*type="button"\s*className="studio-sidebar-mobile-scrim"/);
  assert.match(layout, /!isSidebarCollapsed && \(\s*<button\s*type="button"\s*className="studio-sidebar-mobile-scrim"/);

  // Auto-collapse on mobile navigation:
  assert.match(layout, /window\.innerWidth <= 960/);
});

test('App.tsx initializes isSidebarCollapsed responsively and listens to resize', () => {
  const app = read('apps/studio/src/app/App.tsx');
  assert.match(app, /window\.innerWidth <= 960/);
  assert.match(app, /window\.addEventListener\('resize', handleResize\)/);
});

test('Chat surface adapts messages, bubbles, and composer docking for mobile viewports', () => {
  const bubble = read('features/chat/src/UserMessageBubble.tsx');
  assert.match(bubble, /max-w-full sm:max-w-\[508px\]/);
  assert.match(bubble, /rounded-\[28px\] sm:rounded-\[40px\]/);
  assert.match(bubble, /px-4 py-3 sm:px-7 sm:py-5/);

  const chatView = read('features/chat/src/ChatView.tsx');
  assert.match(chatView, /px-3\.5 sm:px-7 pt-\[56px\] sm:pt-\[72px\]/);
  assert.match(chatView, /w-full sm:w-auto sm:max-w-\[516px\]/);
  assert.match(chatView, /px-4 max-\[960px\]:pb-\[8px\] min-\[961px\]:pb-\[49px\]/);

  const chrome = read('features/chat/src/ChatResponseChrome.tsx');
  assert.match(chrome, /w-\[400px\] max-w-\[calc\(100%_-_32px\)\]/);
});

test('Chat top header adapts navigation, actions, model switcher, and user avatar on mobile', () => {
  const layout = read('apps/studio/src/shell/StudioLayout.tsx');
  // Mobile account avatar in top right:
  assert.match(layout, /min-\[961px\]:hidden absolute top-\[8px\] right-\[12px\] z-30 flex items-center/);
  assert.match(layout, /aria-label="Open account menu"/);
  // Temporary chat has mobile offset:
  assert.match(layout, /right-\[12px\] max-\[960px\]:right-\[60px\]/);

  const sidebarCss = read('apps/studio/src/shell/sidebar/Sidebar.css');
  // Actions anchor gets mobile 60px offset inside 960px media query:
  assert.match(sidebarCss, /\.willow-conv-actions-anchor \{\s*right:\s*60px !important;/);

  const chatView = read('features/chat/src/ChatView.tsx');
  // Mobile top-bar model switcher:
  assert.match(chatView, /min-\[961px\]:hidden absolute top-\[14px\] left-\[56px\] z-30 flex items-center/);
  assert.match(chatView, /aria-label="Select model"/);

  const composer = read('features/chat/src/composer/Composer.tsx');
  // Model button inside composer is hidden on mobile/tablets to give full width to input:
  assert.match(composer, /relative hidden min-\[961px\]:block/);
});
