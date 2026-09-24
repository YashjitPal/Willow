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
  assert.match(chatView, /px-4 pb-\[12px\] min-\[769px\]:pb-\[16px\] min-\[961px\]:pb-\[49px\]/);
  assert.match(chatView, /max-\[768px\]:max-w-full min-\[769px\]:max-w-\[660px\]/);

  const chrome = read('features/chat/src/ChatResponseChrome.tsx');
  assert.match(chrome, /w-\[400px\] max-w-\[calc\(100%_-_32px\)\]/);
});

test('Chat prompt box matches Gemini 3-tier specs: 64px desktop, 72px tablet, 80px mobile', () => {
  const composer = read('features/chat/src/composer/Composer.tsx');

  // Height: 64px desktop (> 960px), 72px tablet (769px-960px), 80px mobile (<= 768px):
  assert.match(composer, /py-\[20px\] min-\[769px\]:max-\[960px\]:py-\[24px\] max-\[768px\]:py-\[28px\] min-h-\[64px\] min-\[769px\]:max-\[960px\]:min-h-\[72px\] max-\[768px\]:min-h-\[80px\]/);

  // Corner radius: 32px desktop, 36px tablet, 40px mobile:
  assert.match(composer, /rounded-\[32px\] min-\[769px\]:max-\[960px\]:rounded-\[36px\] max-\[768px\]:rounded-\[40px\]/);

  // Plus, mic, and submit buttons: 32px desktop, 40px tablet & mobile (<= 960px):
  assert.match(composer, /w-8 max-\[960px\]:w-10/);
  // Plus button and trailing controls vertically centered for each tier:
  assert.match(composer, /bottom-\[16px\] max-\[768px\]:bottom-\[20px\]/);
  assert.match(composer, /bottom-\[12px\] min-\[769px\]:max-\[960px\]:bottom-\[16px\] max-\[768px\]:bottom-\[20px\]/);

  // Typography: 17px prompt text across all viewports; 20px 375-weight placeholder on tablet & mobile (<= 960px):
  assert.match(composer, /text-\[17px\] leading-6/);
  assert.doesNotMatch(composer, /max-\[960px\]:text-\[20px\]/);
  assert.match(composer, /placeholder:text-\[17px\] max-\[960px\]:placeholder:text-\[20px\] max-\[960px\]:placeholder:font-\[375\]/);

  // Width: consumes full width on mobile (<= 768px) and max-w-[660px] on tablet/desktop:
  assert.match(composer, /max-\[768px\]:max-w-full min-\[769px\]:max-w-\[660px\]/);

  // Submit / Send / Live button matches Gemini: 32px desktop, 40px mobile/tab, gated on liveAvailable:
  assert.match(composer, /isSubmitControlHidden \? 'hidden' : 'flex'/);
  assert.match(composer, /!liveAvailable/);
  assert.match(composer, /chatVariant \? 'w-8 h-8 max-\[960px\]:w-10 max-\[960px\]:h-10' : 'w-\[34px\] h-\[34px\]'/);

  // Expand input to fullscreen button removed in mobile/tab view:
  assert.match(composer, /max-\[960px\]:hidden absolute right-\[-7px\] top-\[8px\][\s\S]*?Expand input to Fullscreen/);

  // Selected tool chip placement matches Gemini:
  // Tablet & Mobile (<= 960px): dedicated top row above textarea with 48px pill chip:
  assert.match(composer, /min-\[961px\]:hidden flex items-center mb-4 pl-1/);
  assert.match(composer, /<MobileToolChip toolId=\{selectedTool\}/);
  assert.match(composer, /flex h-12 shrink-0 select-none items-center rounded-full/);

  // Desktop (> 960px): bottom row beside plus button:
  assert.match(composer, /hidden min-\[961px\]:block mt-\[1px\][\s\S]*?<ToolChip/);

  // Expanded prompt box layout: generous top padding and button clearance on tablet/mobile:
  assert.match(composer, /pt-4 pb-\[62px\] max-\[960px\]:pt-6 max-\[960px\]:pb-\[64px\]/);
  // Bottom buttons baseline (16px tablet, 20px mobile) and lateral offset in expanded form on tablet & mobile:
  assert.match(composer, /min-\[769px\]:max-\[960px\]:!bottom-\[16px\] max-\[768px\]:!bottom-\[20px\] max-\[960px\]:!left-\[6px\]/);
  assert.match(composer, /bottom-\[12px\] min-\[769px\]:max-\[960px\]:bottom-\[16px\] max-\[768px\]:bottom-\[20px\] right-\[0px\]/);
});

test('Chat top header adapts navigation, actions, model switcher, and user avatar on mobile', () => {
  const layout = read('apps/studio/src/shell/StudioLayout.tsx');
  // Mobile sidebar open button renders exact Gemini 32px Luminous menu icon (not 2-bar SVG):
  assert.match(layout, /className="studio-sidebar-mobile-open"[\s\S]*?lumi-symbols[\s\S]*?menu/);
  assert.match(layout, /fontVariationSettings:\s*'"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 32, "wght" 240'/);

  // Mobile account avatar in top right (exact Gemini specs: right: 8px, top: 12px, 40x40):
  assert.match(layout, /min-\[961px\]:hidden absolute top-\[12px\] right-\[8px\] z-30 flex items-center/);
  assert.match(layout, /aria-label="Open account menu"/);
  // Full 32px avatar without shrinking padding or fake border:
  assert.match(layout, /h-8 w-8 rounded-full/);
  // Ring experiment conditionally overlays 42x42 ring at -top-[1px] -left-[1px]:
  assert.match(layout, /isRingEnabled && \([\s\S]*?profileRingAsset[\s\S]*?w-\[42px\] h-\[42px\]/);
  // Temporary chat has mobile 52px offset (4px gap to 40px avatar at right 8px):
  assert.match(layout, /right-\[12px\] max-\[960px\]:right-\[52px\]/);
  assert.match(layout, /willow-temp-chat-icon/);

  // New Chat button on mobile during ongoing conversation (adjacent to actions menu at right 12px):
  assert.match(layout, /min-\[961px\]:hidden absolute top-\[14px\] right-\[48px\] z-30 flex items-center/);
  assert.match(layout, /aria-label="New Chat"/);

  const sidebarCss = read('apps/studio/src/shell/sidebar/Sidebar.css');
  // Actions anchor gets mobile 60px offset inside 960px media query:
  assert.match(sidebarCss, /\.willow-conv-actions-anchor \{\s*right:\s*60px !important;/);
  // Mobile temporary chat icon carries 32px and weight 240:
  assert.match(sidebarCss, /\.willow-temp-chat-icon \{\s*font-size:\s*32px !important;/);

  const chatView = read('features/chat/src/ChatView.tsx');
  // Mobile top-bar model switcher:
  assert.match(chatView, /min-\[961px\]:hidden absolute top-\[8px\] left-\[56px\] z-30 flex items-center/);
  assert.match(chatView, /aria-label=\{`Select model/);
  // Mobile model switcher renders two-tone 20px typography (white primary + off-white secondary):
  assert.match(chatView, /text-\[20px\] leading-6/);
  assert.match(chatView, /mobileModelInfo\.primary/);
  assert.match(chatView, /mobileModelInfo\.secondary/);
  // Mobile model switcher dropdown chevron is dark blue (#062e6f) matching Gemini app:
  assert.match(chatView, /name="expand_more"[\s\S]*?text-\[#062e6f\]/);

  const composer = read('features/chat/src/composer/Composer.tsx');
  // Model button inside composer is hidden on mobile/tablets to give full width to input:
  assert.match(composer, /relative hidden min-\[961px\]:block/);
});

test('Mobile zero-state suppresses overflow, scrollbars, and asymmetric gutters for 100% horizontal centering', () => {
  const html = read('apps/studio/index.html');
  assert.match(html, /main\s*\{\s*scrollbar-gutter:\s*auto\s*!important;\s*\}/);
  assert.match(html, /\.gemini-chat-scrollbar\s*\{\s*scrollbar-gutter:\s*auto\s*!important;\s*\}/);

  const layout = read('apps/studio/src/shell/StudioLayout.tsx');
  assert.match(layout, /isChatExperience \? 'overflow-hidden' : 'overflow-y-auto scroll-smooth'/);
  assert.match(layout, /style=\{isChatExperience \? undefined : \{ scrollbarGutter: 'stable' \}\}/);

  const chatView = read('features/chat/src/ChatView.tsx');
  assert.match(chatView, /overflow-y-hidden min-\[961px\]:overflow-y-auto/);
  assert.match(chatView, /scrollbarGutter: hasStarted \|\| showBlankThread \? 'stable' : 'auto'/);
  assert.match(chatView, /hidden min-\[961px\]:block pb-20 empty:pb-0/);

  const mediaHome = read('features/media/src/MediaHome.tsx');
  assert.match(mediaHome, /min-\[961px\]:hidden flex flex-col items-center justify-center w-full px-4 pb-20 text-center select-none/);
});
