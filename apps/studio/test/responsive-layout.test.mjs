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
  assert.match(css, /\.studio-sidebar-mobile-open:active \{\s*background:\s*rgba\(227,\s*227,\s*227,\s*0\.18\)\s*!important;\s*border-radius:\s*50%;/);
  assert.match(css, /:is\(\.light-theme, \[data-theme="light"\]\) \.studio-sidebar-mobile-open \{\s*color:\s*#1f1f1f;\s*\}/);
});

test('StudioLayout.tsx enables universal mobile sidebar toggle and auto-collapse', () => {
  const layout = read('apps/studio/src/shell/StudioLayout.tsx');

  // Mobile open button is no longer restricted to spark:
  assert.doesNotMatch(layout, /studioExperience === 'spark' && isSidebarCollapsed && !isSidebarHidden && \(\s*<button\s*type="button"\s*className="studio-sidebar-mobile-open"/);
  // (Not where the desktop app's Code and Media have the page to themselves.)
  assert.match(layout, /isSidebarCollapsed && !isSidebarHidden && !isSidebarAway && \(\s*<button\s*type="button"\s*className="studio-sidebar-mobile-open"/);

  // Scrim button is universal:
  assert.doesNotMatch(layout, /studioExperience === 'spark' && !isSidebarCollapsed && \(\s*<button\s*type="button"\s*className="studio-sidebar-mobile-scrim"/);
  assert.match(layout, /!isSidebarCollapsed && !isSidebarAway && \(\s*<button\s*type="button"\s*className="studio-sidebar-mobile-scrim"/);

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
  // One bubble box at every width, measured off Gemini from 390 to 960: 508px at most, 20/28 padding, 40px corners, 17/24 type:
  assert.match(bubble, /relative min-w-0 max-w-\[508px\] overflow-visible rounded-\[40px\]/);
  assert.match(bubble, /px-7 py-5 text-\[17px\] font-normal leading-6/);
  assert.doesNotMatch(bubble, /\bsm:|rounded-\[28px\]/);
  // Only the dark fill changes below 961px, to Gemini's #141414, and the collapse fade follows it:
  assert.match(bubble, /'bg-\[#171717\] text-\[#e3e3e3\] max-\[960px\]:bg-\[#141414\]'/);
  assert.match(bubble, /max-\[960px\]:bg-\[linear-gradient\(to_right,transparent,#141414_56px,#141414_100%\)\]/);

  const chatView = read('features/chat/src/ChatView.tsx');
  // Thread column: Gemini's 708px text column inside 24px gutters, first query 92px down; desktop keeps 28px and 72px:
  assert.match(chatView, /max-w-\[760px\] max-\[960px\]:max-w-\[756px\] flex-col border-l-transparent px-6 min-\[961px\]:px-7 pt-\[92px\] min-\[961px\]:pt-\[72px\] pb-\[20px\]/);
  // Query row inset 52px left and 8px right below 961px; desktop keeps the shrink-wrapped 516px column:
  assert.match(chatView, /flex min-w-0 w-full max-\[960px\]:pl-\[52px\] max-\[960px\]:pr-2 min-\[961px\]:w-auto min-\[961px\]:max-w-\[516px\] flex-col items-end/);
  // Copy/edit stays hidden until hover or a press lifts, 20px from the edge below 961px:
  assert.match(chatView, /gemini-user-actions pointer-events-none absolute right-3 max-\[960px\]:right-5 top-full[^"]*opacity-0[^"]*group-hover:opacity-100/);
  // Docked footer: 12px over the composer below 961px; 49px under it from 769px up, where the disclaimer sits:
  assert.match(chatView, /px-4 max-\[960px\]:pt-3 pb-\[12px\] min-\[769px\]:pb-\[49px\]/);
  assert.match(chatView, /max-\[768px\]:max-w-full min-\[769px\]:max-w-\[660px\]/);

  const chrome = read('features/chat/src/ChatResponseChrome.tsx');
  assert.match(chrome, /w-\[400px\] max-w-\[calc\(100%_-_32px\)\]/);
});

test('Chat thread follows Gemini at 960px and below, and leaves desktop alone', () => {
  const compact = read('features/chat/src/use-compact-viewport.ts');
  assert.match(compact, /export const COMPACT_VIEWPORT_QUERY = '\(max-width: 960px\)';/);

  const chatView = read('features/chat/src/ChatView.tsx');
  assert.match(chatView, /const isCompact = useCompactViewport\(\);/);
  // Text fades out under the header once the thread is docked:
  assert.match(chatView, /maskImage: 'linear-gradient\(to bottom, transparent 68px, #000 108px\)'/);
  // The first sent turn fades in as it rises; desktop keeps the rise alone:
  assert.match(chatView, /initial=\{shouldAnimateFirstPromptEntrance \? \{ y: 200, \.\.\.\(isCompact \? \{ opacity: 0 \} : \{\}\) \} : false\}/);
  // Gemini's 48px action row of 36px buttons, and its in-thread disclaimer at 768px and below:
  assert.match(chatView, /compact=\{isCompact\}/);
  assert.match(chatView, /hidden max-\[768px\]:block text-\[13px\] font-normal leading-\[17px\]/);
  // The docked composer, which shrinks its placeholder:
  assert.match(chatView, /docked=\{isThreadDocked\}/);

  const chrome = read('features/chat/src/ChatResponseChrome.tsx');
  assert.match(chrome, /const ACTION_BUTTON_SIZE = 'h-8 w-8 p-1';/);
  assert.match(chrome, /const COMPACT_ACTION_BUTTON_SIZE = 'h-9 w-9 p-1\.5';/);
  assert.match(chrome, /const COMPACT_ACTION_ROW = 'flex h-12 items-center gap-3 -ml-1\.5 max-\[768px\]:ml-0';/);
  assert.match(chrome, /const rowClass = compact \? COMPACT_ACTION_ROW : 'flex h-8 items-center';/);

  const composer = read('features/chat/src/composer/Composer.tsx');
  assert.match(composer, /data-docked=\{chatVariant && docked \? '' : undefined\}/);
  // Gemini drops the mic while a reply is generating, leaving the stop button alone:
  assert.match(composer, /chatVariant && responseControlActive && !isMicMuteToggle && !isDictationActive \? 'max-\[960px\]:hidden' : ''/);
  // The disclaimer moves into the thread at 768px and below:
  assert.match(composer, /top-full mt-4 text-center text-\[13px\] font-normal leading-\[17px\] max-\[768px\]:hidden/);

  const composerCss = read('features/chat/src/composer/Composer.css');
  // "Ask Gemini" is 20px/375 on the empty screen and 17px/400 once a conversation is open, as Gemini's is:
  assert.match(composerCss, /\.willow-gemini-composer\[data-docked\] \.willow-dictation-textarea::placeholder \{\s*font-size: 17px;\s*font-weight: 400;\s*color: #9a9b9c;/);

  const markdown = read('platform/ui/src/streaming-markdown-styles.ts');
  // At 756px and below the 24px block padding replaces the list indent:
  assert.match(markdown, /'@media \(max-width: 756px\) \{',\s*'  \.smd-root > \.smd-list \{ padding-left: 0; \}',/);

  const html = read('apps/studio/index.html');
  // Touch pins the copy/edit row on above-960px screens only:
  assert.match(html, /@media \(min-width: 961px\) and \(hover: none\), \(min-width: 961px\) and \(pointer: coarse\) \{\s*\.gemini-user-actions \{\s*opacity: 1 !important;/);
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

  // Submit / Send / Live button matches Gemini: 32px on desktop and tablet (with 4px either
  // side on tablet), 40px on phones, gated on liveAvailable:
  assert.match(composer, /isSubmitControlHidden \? 'hidden' : 'flex'/);
  assert.match(composer, /!liveAvailable/);
  assert.match(composer, /chatVariant \? 'w-8 h-8 max-\[768px\]:w-10 max-\[768px\]:h-10 min-\[769px\]:max-\[960px\]:mx-1 min-\[961px\]:mr-px' : 'w-\[34px\] h-\[34px\]'/);
  // The mic is the same: 32px on tablets, nudged 1px up to Gemini's 19px from the top, except
  // as the stop button, which sits level with Submit as Gemini's does.
  assert.match(composer, /chatVariant \? `w-8 h-8 max-\[768px\]:w-10 max-\[768px\]:h-10 \$\{/);
  assert.match(composer, /isDictationActive && !isMicMuteToggle \? '' : 'min-\[769px\]:max-\[960px\]:-mt-0\.5'/);

  // Expand input to fullscreen button removed in mobile/tab view:
  assert.match(composer, /max-\[960px\]:hidden absolute right-\[-7px\] top-\[8px\][\s\S]*?Expand input to Fullscreen/);

  // Selected tool chip placement matches Gemini:
  // Tablet & Mobile (<= 960px): dedicated top row above textarea with 48px pill chip:
  assert.match(composer, /min-\[961px\]:hidden flex items-center mb-4 pl-1/);
  assert.match(composer, /<MobileToolChip toolId=\{selectedTool\}/);
  assert.match(composer, /flex h-12 shrink-0 select-none items-center rounded-full/);

  // Desktop (> 960px): bottom row beside plus button:
  assert.match(composer, /hidden min-\[961px\]:block mt-\[1px\][\s\S]*?<ToolChip/);

  // Expanded prompt box layout: Chat's text starts 24px down on phones and 16px on tablets.
  // Spark's starts 36px down at both, below Gemini's empty 8px attachment row, with 69px /
  // 65px under it:
  assert.match(composer, /pt-4 pb-\[62px\] max-\[768px\]:pt-6 min-\[769px\]:max-\[960px\]:pb-\[68px\] max-\[768px\]:pb-\[72px\]\$\{sparkMode \? ' max-\[960px\]:!pt-9 max-\[768px\]:!pb-\[69px\] min-\[769px\]:max-\[960px\]:!pb-\[65px\]' : ''\}/);
  // The plus: 20px in on phones and 24px on tablets at one line; past one line tablets lose
  // 2px, and Spark moves to 16px in and 18px / 12px off the bottom:
  assert.match(composer, /'max-\[768px\]:!left-\[6px\] max-\[768px\]:!bottom-\[20px\] min-\[769px\]:max-\[960px\]:!left-\[10px\] min-\[769px\]:max-\[960px\]:!bottom-\[16px\]'/);
  assert.match(composer, /'max-\[768px\]:!left-\[2px\] max-\[768px\]:!bottom-\[18px\] min-\[769px\]:max-\[960px\]:!left-\[8px\] min-\[769px\]:max-\[960px\]:!bottom-\[12px\]'/);
  assert.match(composer, /'max-\[768px\]:!left-\[6px\] max-\[768px\]:!bottom-\[20px\] min-\[769px\]:max-\[960px\]:!left-\[8px\] min-\[769px\]:max-\[960px\]:!bottom-\[16px\]'/);
  assert.match(composer, /\$\{leadingTouchOffset\} `\}>/);
  // Trailing buttons: 16px tablet / 20px phone baseline, 1px in on tablets, a 6px gap, and
  // past one line 12.5px off the bottom on tablets (18.5px on a Spark phone):
  assert.match(composer, /bottom-\[12px\] min-\[769px\]:max-\[960px\]:bottom-\[16px\] max-\[768px\]:bottom-\[20px\] right-\[0px\] min-\[769px\]:max-\[960px\]:right-\[1px\] max-\[768px\]:right-\[5px\]/);
  assert.match(composer, /\$\{chatVariant \? 'max-\[960px\]:gap-1\.5' : ''\}/);
  assert.match(composer, /'max-\[768px\]:!bottom-\[18\.5px\] min-\[769px\]:max-\[960px\]:!bottom-\[12\.5px\]'/);
  // Left padding of expanded textarea on tablet/mobile matches Gemini (26px total = 14px box + 12px textarea),
  // and the right edge: Chat keeps 72px clear of the box edge, Spark runs to 16px / 12px:
  assert.match(composer, /max-\[960px\]:!pl-\[12px\] \$\{sparkMode \? 'max-\[768px\]:!pr-\[1px\] min-\[769px\]:max-\[960px\]:!pr-0' : 'max-\[960px\]:!pr-\[57px\]'\}/);

  // Left padding of collapsed textarea: Gemini's text starts 10px past the plus — 70px into
  // the box on phones, 74px on tablets:
  assert.match(composer, /min-\[769px\]:max-\[960px\]:!pl-\[60px\] max-\[768px\]:!pl-\[56px\]/);
  // The dictation waveform is Gemini's `butterfly-wave-view`, which starts with the editor's main
  // area, 2px before its text, and ends at the stop button: 142 -> 608 in an 800px window,
  // 84 -> 248.4 in a 390px one:
  assert.match(composer, /min-\[769px\]:max-\[960px\]:left-\[58px\] min-\[769px\]:max-\[960px\]:right-\[107px\] min-\[769px\]:max-\[960px\]:bottom-\[24px\] max-\[768px\]:left-\[54px\] max-\[768px\]:right-\[111px\]/);

  // Autosize hook measures wrap-point with identical responsive padding (60px tablet, 56px mobile,
  // 12px expanded, and the expanded right edge above):
  const autosize = read('features/chat/src/composer/use-composer-textarea-autosize.ts');
  assert.match(autosize, /effectiveCollapsedPaddingLeftVal = chatVariant\s*\?\s*\(isMobileNarrow \? '56px' : isMobileTab \? '60px' : collapsedPaddingLeftVal\)/);
  assert.match(autosize, /effectiveExpandedPaddingLeftVal = chatVariant\s*\?\s*\(isMobileTab \? '12px' : expandedPaddingLeftVal\)/);
  assert.match(autosize, /effectiveExpandedPaddingRightVal = chatVariant && isMobileTab\s*\?\s*\(sparkMode \? \(isMobileNarrow \? '1px' : '0px'\) : '57px'\)/);

  // The one-line editor stops 20px (phone) / 28px (tablet) before the first trailing button:
  const chatLayout = read('features/chat/src/composer/use-composer-chat-layout.ts');
  assert.match(chatLayout, /matchMedia\('\(max-width: 768px\)'\)\.matches \? 20 : 28/);
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
  // Model picker box, text and states, all read off Gemini's live `.logo-pill-btn`:
  assert.match(sidebarCss, /\.studio-mobile-model-button \{[^}]*height:\s*24px;[^}]*padding:\s*0 12px;[^}]*border-radius:\s*9999px;[^}]*color:\s*var\(--sync-062e6f, #062e6f\);/);
  assert.match(sidebarCss, /\.studio-mobile-model-primary,\s*\.studio-mobile-model-secondary \{[^}]*font-size:\s*18px;[^}]*line-height:\s*24px;[^}]*font-variation-settings:\s*"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;/);
  // Name and effort sit exactly one space apart: the name is zoomed so its box ends with its text, then a real space:
  assert.match(sidebarCss, /\.studio-mobile-model-primary \{\s*zoom:\s*0\.888888;\s*color:\s*#e0e0e0;/);
  assert.match(sidebarCss, /\.studio-mobile-model-primary:has\(\+ \.studio-mobile-model-secondary\)::after \{\s*content:\s*"\\00a0";/);
  // The last part keeps Gemini's transform, so the chevron keeps Gemini's spacing:
  assert.match(sidebarCss, /\.studio-mobile-model-secondary \{\s*transform:\s*scale\(0\.888888\);\s*transform-origin:\s*left center;\s*color:\s*rgba\(255, 255, 255, 0\.55\);/);
  assert.match(sidebarCss, /\.studio-mobile-model-state \{\s*background-color:\s*var\(--sync-062e6f, #062e6f\);\s*opacity:\s*0;/);
  assert.match(sidebarCss, /\.studio-mobile-model-button:hover > \.studio-mobile-model-state \{\s*opacity:\s*0\.08;/);
  assert.match(sidebarCss, /\.studio-mobile-model-button:active > \.studio-mobile-model-state \{\s*opacity:\s*0\.12;/);
  // Touch suppression must outrank :active, hence the `span` — a touch press is :hover and :active at once:
  assert.match(sidebarCss, /@media \(hover: none\) \{\s*\.studio-mobile-model-button:hover > span\.studio-mobile-model-state \{\s*opacity:\s*0;/);
  assert.match(sidebarCss, /\.studio-mobile-model-ripple \{[^}]*background-color:\s*rgba\(var\(--sync-a8c7fa-rgb, 168, 199, 250\), 0\.12\);[^}]*transform:\s*scale3d\(0, 0, 0\);[^}]*transition:\s*opacity, transform 0ms cubic-bezier\(0, 0, 0\.2, 1\);/);
  // Actions anchor gets mobile 60px offset inside 960px media query:
  assert.match(sidebarCss, /\.willow-conv-actions-anchor \{\s*right:\s*60px !important;/);
  // Mobile temporary chat icon carries 32px and weight 240:
  assert.match(sidebarCss, /\.willow-temp-chat-icon \{\s*font-size:\s*32px !important;/);

  const chatView = read('features/chat/src/ChatView.tsx');
  const picker = read('features/chat/src/MobileModelPicker.tsx');
  assert.match(chatView, /<MobileModelPicker\s+modelConfig=\{modelConfig\}/);
  // Mobile/tablet top-bar model picker: Gemini's 24px `.logo-pill-btn` at x 56, y 20 (390 and 800px alike):
  assert.match(picker, /min-\[961px\]:hidden absolute top-\[20px\] left-\[56px\] z-30 flex items-center/);
  assert.match(picker, /aria-label=\{`Select model/);
  assert.match(picker, /mobileModelInfo\.primary/);
  assert.match(picker, /mobileModelInfo\.secondary/);
  assert.match(picker, /name="keyboard_arrow_down"[\s\S]*?className="studio-mobile-model-chevron"/);
  // Gemini leaves the button alone while its menu is open: no open-state class, fill or chevron flip.
  const pickerStart = picker.indexOf('ref={mobileModelButtonRef}');
  const pickerButton = picker.slice(pickerStart, picker.indexOf('</button>', pickerStart));
  assert.ok(pickerStart > 0 && pickerButton.includes('className="studio-mobile-model-button pointer-events-auto"'));
  assert.doesNotMatch(pickerButton, /is-open|is-active|rotate-180|isMobileModelsOpen \?/);
  assert.match(pickerButton, /onPointerDown=\{handleMobileModelPointerDown\}/);
  assert.match(picker, /launchMaterialRipple\(\s*host,\s*'studio-mobile-model-ripple'/);

  // The header picker opens Gemini's ≤960px menu, not the desktop one:
  assert.match(picker, /geminiStyle\s+mobile\s+align="left"/);
  const modelsMenu = read('platform/ui/src/models/ModelsMenu.tsx');
  // Row: 8px padding and gaps around 24px leading/trailing slots; 17/24 label over a 13/17 sublabel = 57px:
  assert.match(modelsMenu, /flex w-full min-h-\[36px\] items-center gap-2 rounded-xl p-2/);
  assert.match(modelsMenu, /block truncate text-\[17px\] leading-6/);
  assert.match(modelsMenu, /block truncate text-\[13px\] leading-\[17px\]/);
  assert.match(modelsMenu, /flex h-6 w-6 shrink-0 items-center justify-center/);
  assert.match(modelsMenu, /text-\[#e0e0e0\]/);
  // Panel: content-sized from 225px, Gemini's #1c1c1c fill and 0 0 20px shadow; four 57px rows before scrolling:
  assert.match(modelsMenu, /w-max min-w-\[225px\] max-w-\[calc\(100vw-16px\)\]/);
  assert.match(modelsMenu, /bg-\[#1c1c1c\] shadow-\[0_0_20px_rgba\(0,0,0,0\.28\)\]/);
  assert.match(modelsMenu, /mobile \? 'max-h-\[228px\]' : 'max-h-\[208px\]'/);
  assert.match(modelsMenu, /my-2 h-0 border-t \$\{isLight \? 'border-black\/10' : 'border-white\/\[0\.12\]'\}/);
  assert.match(modelsMenu, /name="check" size=\{24\} weight=\{300\} roundness=\{100\} opticalSize=\{24\}/);

  const ripple = read('features/chat/src/material-ripple.ts');
  // Angular Material's ripple as recorded on Gemini: 225ms grow to the farthest corner, 150ms fade after it:
  assert.match(ripple, /const ENTER_MS = 225;/);
  assert.match(ripple, /const EXIT_MS = 150;/);
  assert.match(ripple, /Math\.hypot\(box\.width - x, box\.height - y\)/);
  assert.match(ripple, /Math\.max\(0, ENTER_MS - \(performance\.now\(\) - startedAt\)\)/);

  const composer = read('features/chat/src/composer/Composer.tsx');
  // Model button inside composer is hidden on mobile/tablets to give full width to input:
  assert.match(composer, /relative hidden min-\[961px\]:block/);
});

test('Sidebar drawer text matches Gemini at 960px and below', () => {
  // Gemini's drawer rows, measured at 390 and 800: 17px/24px at weight 400, the selected row at 540.
  for (const file of ['apps/studio/src/shell/sidebar/SidebarPrimitives.tsx', 'apps/studio/src/shell/sidebar/Sidebar.tsx']) {
    const source = read(file);
    assert.match(source, /sidebar-item-label[^`]*max-\[960px\]:!text-\[17px\] max-\[960px\]:!leading-6/, file);
    assert.match(source, /\$\{active \? ' max-\[960px\]:!font-\[540\]' : ''\}/, file);
    assert.doesNotMatch(source, /max-\[960px\]:!text-\[16px\]|max-\[960px\]:!font-normal/, file);
  }

  const css = read('apps/studio/src/shell/sidebar/Sidebar.css');
  assert.match(css, /\.studio-sidebar \.sidebar-item-label \{\s*font-size: 17px !important;\s*line-height: 24px !important;/);
  // Nothing may pin the label weight, or the selected row loses its 540:
  const darkLabel = css.match(/\.studio-sidebar:not\(\[data-theme="light"\]\):not\(\.light-theme\) \.sidebar-item-label \{[^}]*\}/);
  assert.ok(darkLabel, 'the dark drawer label rule exists');
  assert.doesNotMatch(darkLabel[0], /font-weight/);

  // Spark's "Customize" label is not a section header in Gemini's drawer: it stays 13px in a 32px row, 20px in:
  const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');
  assert.match(sidebar, /`mx-3 mt-3 flex h-8 items-center px-1\.5 max-\[960px\]:pl-2 text-\[13px\] font-normal leading-\[17px\]/);
  assert.doesNotMatch(sidebar, /sidebar-section-header sidebar-section-title/);
});

test('Sidebar drawer geometry, icons and colours match Gemini at 960px and below', () => {
  const css = read('apps/studio/src/shell/sidebar/Sidebar.css');
  // A 28px glyph overhanging a 24px slot: icon at x 22, label at x 60, Gemini's weight 260:
  assert.match(css, /\.studio-sidebar \.sidebar-item-icon-box \{[^}]*margin-left: -2px !important;\s*margin-right: -2px !important;/);
  assert.match(css, /\.sidebar-item-icon-box \.material-symbols-rounded \{[^}]*'wght' 260, 'GRAD' 0, 'opsz' 28/);
  assert.match(css, /\.sidebar-section-chevron \{[^}]*'wght' 300, 'GRAD' 0, 'opsz' 24/);
  assert.match(css, /\.sidebar-row-pin-icon \.luminous-symbols \{[^}]*font-size: 28px !important;[^}]*'wght' 260/);

  const primitives = read('apps/studio/src/shell/sidebar/SidebarPrimitives.tsx');
  // Trailing menu/pin slot at x 269 with the title cut off 5px before it, at x 264:
  assert.match(primitives, /ml-auto pr-0\.5 max-\[960px\]:-ml-\[7px\] max-\[960px\]:-mr-\[9px\] max-\[960px\]:pr-0/);
  // Section titles at x 24:
  assert.match(primitives, /sidebar-section-header[^`]*w-\[calc\(100%-12px\)\] max-\[960px\]:ml-2/);

  const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');
  // Logo at (22, 18), wordmark at (60, 20) in #e0e0e0, close button at (263, 8):
  assert.match(sidebar, /active:scale-95 max-\[960px\]:ml-3 max-\[960px\]:mt-2/);
  assert.match(sidebar, /max-\[960px\]:text-\[#e0e0e0\] max-\[960px\]:!text-\[20px\] max-\[960px\]:!leading-6 max-\[960px\]:ml-2 max-\[960px\]:mt-3/);
  assert.match(sidebar, /absolute right-\[14px\] top-1\.5 max-\[960px\]:right-\[9px\] max-\[960px\]:top-0/);
  // Footer: avatar at x 22, name at x 58, gear at x 269, all centred 36px above the bottom:
  assert.match(sidebar, /max-\[960px\]:!h-\[64px\] max-\[960px\]:pl-\[17px\] max-\[960px\]:pr-\[15px\] max-\[960px\]:pt-2 max-\[960px\]:pb-4/);
  assert.match(sidebar, /self-end max-\[960px\]:self-center/);
  assert.doesNotMatch(sidebar, /max-\[960px\]:gap-2 max-\[960px\]:pl-0/);
});

test('Settings opens as Gemini\'s draggable bottom sheet at 960px and below', () => {
  const sheet = read('apps/studio/src/shell/sidebar/SettingsSheet.tsx');
  // Half the viewport to start, 80% expanded; a drag counts once it covers 20% of where it began:
  assert.match(sheet, /const HALF = 0\.5;/);
  assert.match(sheet, /const EXPANDED = 0\.8;/);
  assert.match(sheet, /const DRAG_THRESHOLD = 0\.2;/);
  assert.match(sheet, /'height 0\.1s ease-out' : 'height 0\.08s ease-out'/);
  assert.match(sheet, /setHeightTransition\('height 0\.3s ease-out'\);\s*onCloseRef\.current\(\);/);
  assert.match(sheet, /maxHeight: 'fit-content'/);
  // Out of the drawer, whose transform would otherwise contain a fixed child:
  assert.match(sheet, /createPortal\(/);
  assert.match(sheet, /Select a theme/);

  const css = read('apps/studio/src/shell/sidebar/Sidebar.css');
  assert.match(css, /\.willow-settings-sheet \{[^}]*border-radius: 56px 56px 0 0;\s*background: #1c1c1c;/);
  assert.match(css, /animation: willow-settings-sheet-enter 195ms cubic-bezier\(0, 0, 0\.2, 1\) forwards;/);
  assert.match(css, /animation: willow-settings-sheet-exit 150ms cubic-bezier\(0\.4, 0, 1, 1\) forwards;/);
  assert.match(css, /\.willow-settings-sheet-backdrop \{\s*background: rgba\(0, 0, 0, 0\.32\);\s*animation: willow-settings-sheet-backdrop-in 400ms cubic-bezier\(0\.25, 0\.8, 0\.25, 1\) forwards;/);
  assert.match(css, /\.willow-settings-sheet-handle \{\s*width: 54px;\s*height: 5px;\s*border-radius: 19px;\s*background: rgba\(255, 255, 255, 0\.55\);/);
  assert.match(css, /\.willow-settings-sheet-row \{[^}]*height: 48px;\s*margin-bottom: 2px;[^}]*border-radius: 4px;\s*background: #0e0e0e;/);
  assert.match(css, /\.willow-settings-sheet-row-label \{[^}]*font-size: 16px;\s*line-height: 24px;/);

  const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');
  assert.match(sidebar, /if \(isCompact\) \{[\s\S]*?<SettingsSheet/);
  // The gear dismisses the drawer, and the sheet outlives the drawer collapsing:
  assert.match(sidebar, /if \(isCompactViewport\(\) && !isCollapsed && !isSettingsMenuOpen\) onToggleCollapse\(\);/);
  assert.match(sidebar, /if \(!isCompactViewport\(\)\) setIsSettingsMenuOpen\(false\);/);
  // The desktop popover's outside-click close stays desktop-only:
  assert.match(sidebar, /if \(!isOpen \|\| isCompact\) return;/);
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
  // A Gem's zero state sits in Gemini's scrolling thread, so it keeps the gutter too.
  assert.match(chatView, /scrollbarGutter: hasStarted \|\| showBlankThread \|\| activeGem \? 'stable' : 'auto'/);
  assert.match(chatView, /hidden min-\[961px\]:block pb-20 empty:pb-0/);

  const mediaHome = read('features/media/src/MediaHome.tsx');
  assert.match(mediaHome, /min-\[961px\]:hidden flex flex-col items-center justify-center w-full px-4 pb-20 text-center select-none/);
});
