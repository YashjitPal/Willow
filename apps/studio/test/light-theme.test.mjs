/**
 * Light theme tests verifying 1:1 Google Gemini token parity and zero dark theme regression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('theme-mode module exports correct modes and options', () => {
  const code = read('platform/core/src/theme-mode.ts');
  assert.match(code, /export type ThemeChoice = 'system' \| 'light' \| 'dark'/);
  assert.match(code, /export const \$themeMode/);
  assert.match(code, /export const \$resolvedTheme/);
  assert.match(code, /export const setThemeChoice/);
  assert.match(code, /export const useThemeMode/);
});

test('UserMessageBubble implements measured light mode tokens while keeping dark mode intact', () => {
  const code = read('features/chat/src/UserMessageBubble.tsx');
  // Light mode measured tokens:
  assert.match(code, /bg-\[#f2f0f0\] text-\[#1f1f1f\]/);
  assert.match(code, /bg-\[linear-gradient\(to_right,transparent,#f2f0f0_56px,#f2f0f0_100%\)\]/);
  assert.match(code, /text-\[#444746\]/);
  assert.match(code, /bg-\[#ffffff\]/);

  // Dark mode preserved:
  assert.match(code, /bg-\[#171717\] text-\[#e3e3e3\]/);
  assert.match(code, /bg-\[linear-gradient\(to_right,transparent,#171717_56px,#171717_100%\)\]/);
  assert.match(code, /text-\[#c4c7c5\]/);
  assert.match(code, /bg-\[#1e1f20\]/);
});

test('ThemesMenu and ModelsMenu support light theme popovers', () => {
  const themesCode = read('features/chat/src/composer/ThemesMenu.tsx');
  assert.match(themesCode, /isLight/);
  assert.match(themesCode, /bg-white/);
  assert.match(themesCode, /bg-\[#1c1c1c\]/);

  const modelsCode = read('platform/ui/src/models/ModelsMenu.tsx');
  assert.match(modelsCode, /isLight/);
  assert.match(modelsCode, /bg-white/);
  assert.match(modelsCode, /bg-\[#1f1f1f\]/);
});

test('ChatResponseChrome supports light theme actions and sidebars', () => {
  const code = read('features/chat/src/ChatResponseChrome.tsx');
  assert.match(code, /isLight/);
  // Light action button:
  assert.match(code, /text-\[#000000\]/);
  assert.match(code, /hover:bg-black\/\[0\.08\]/);

  // Dark action button preserved:
  assert.match(code, /text-\[#e6e6e6\]/);
  assert.match(code, /hover:bg-white\/\[0\.08\]/);
});

test('streaming-markdown-styles declares light theme rules', () => {
  const code = read('platform/ui/src/streaming-markdown-styles.ts');
  assert.match(code, /:is\(\.light-theme, \[data-theme="light"\]\) \.smd-root \{ color: rgb\(31, 31, 31\); \}/);
  assert.match(code, /:is\(\.light-theme, \[data-theme="light"\]\) \.smd-link \{ color: #0b57d0;/);
  assert.match(code, /:is\(\.light-theme, \[data-theme="light"\]\) \.smd-code-block \{ background: rgb\(240, 244, 249\); \}/);
});

test('GeminiDialog.css declares light theme rules', () => {
  const code = read('platform/ui/src/GeminiDialog.css');
  assert.match(code, /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-gdlg-surface \{[\s\S]*?background: #ffffff;/);
  assert.match(code, /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-gdlg-pill \{[\s\S]*?background: rgb\(242, 240, 240\);/);
});

test('index.html declares light theme scrollbar and background glow rules', () => {
  const html = read('apps/studio/index.html');
  // Scrollbar light theme tokens:
  assert.match(html, /\.gemini-chat-scrollbar:where\(\.light-theme \*, \[data-theme="light"\] \*\):hover::-webkit-scrollbar-thumb \{\s*background: content-box #dde3ea;/);
  assert.match(html, /\.gemini-chat-scrollbar:where\(\.light-theme \*, \[data-theme="light"\] \*\)::-webkit-scrollbar-thumb:active,\s*\.gemini-chat-scrollbar:where\(\.light-theme \*, \[data-theme="light"\] \*\)::-webkit-scrollbar-thumb:hover \{\s*background: content-box #c4c7c5;/);

  // Background glow light theme tokens:
  assert.match(html, /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-gemini-home-glow::before \{[\s\S]*?var\(--studio-surface, #faf9f9\) 0,[\s\S]*?filter: blur\(125px\);/);
  assert.match(html, /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-gemini-home-glow\.willow-gemini-home-glow-gray::before \{[\s\S]*?rgb\(196, 199, 197\) 50%/);
});

test('Tooltip.css declares light theme tooltip surface and wrapper rules', () => {
  const code = read('platform/ui/src/Tooltip.css');
  assert.match(code, /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-tooltip \{[\s\S]*?color: rgb\(31, 31, 31\);/);
  assert.match(code, /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-tooltip-surface \{[\s\S]*?background-color: rgb\(0, 0, 0\);/);
  assert.match(code, /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-tooltip-surface \{[\s\S]*?color: rgb\(242, 240, 240\);/);
});

test('composers and workspaces adapt send and live button to light mode with high-contrast icon', () => {
  const chatComposer = read('features/chat/src/composer/Composer.tsx');
  assert.match(chatComposer, /workspaceTheme\.sendButton\.lightBg/);
  assert.match(chatComposer, /workspaceTheme\.sendButton\.lightHover/);
  assert.match(chatComposer, /isLight \? 'text-black' : 'text-white'/);

  const designComposer = read('features/design/src/composer/Composer.tsx');
  assert.match(designComposer, /workspaceTheme\.sendButton\.lightBg/);
  assert.match(designComposer, /workspaceTheme\.sendButton\.lightHover/);
  assert.match(designComposer, /isLight \? 'text-black' : 'text-white'/);

  const agentsWorkspace = read('features/agent-builder/src/AgentsWorkspace.tsx');
  assert.match(agentsWorkspace, /theme\.sendButton\.lightBg/);
  assert.match(agentsWorkspace, /theme\.sendButton\.lightHover/);
  assert.match(agentsWorkspace, /isLight \? 'text-black' : 'text-white'/);
});

test('CustomizeView and CustomizeCard declare light theme rules', () => {
  const css = read('apps/studio/src/customize/CustomizeView.css');
  assert.match(css, /:is\(\.light-theme, \[data-theme="light"\]\) \.customize-page-root/);
  assert.match(css, /:is\(\.light-theme, \[data-theme="light"\]\) \.customize-card/);
  assert.match(css, /:is\(\.light-theme, \[data-theme="light"\]\) \.customize-search-input/);

  const card = read('apps/studio/src/customize/CustomizeCard.tsx');
  assert.match(card, /useThemeMode/);
});

test('UsageLimitsView and UsageLimitsTab declare light theme rules', () => {
  const viewCss = read('apps/studio/src/usage/UsageLimitsView.css');
  assert.match(viewCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.usage-limits-root/);
  assert.match(viewCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.usage-current-card/);

  const tabCss = read('apps/studio/src/settings/tabs/usage-limits/UsageLimitsTab.css');
  assert.match(tabCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.usage-limits/);
});

test('GemsView and CreateGemView declare light theme rules', () => {
  const gemsView = read('features/gems/src/GemsView.tsx');
  assert.match(gemsView, /useThemeMode/);
  assert.match(gemsView, /rgb\(240, 244, 249\)/);

  const createGem = read('features/gems/src/CreateGemView.tsx');
  assert.match(createGem, /useThemeMode/);
  assert.match(createGem, /var\(--studio-surface, #faf9f9\)/);
});

test('PersonalIntelligenceTab, SavedInfoTab, ConnectedAppsTab, Memory, and Activity declare light theme rules', () => {
  const piCss = read('apps/studio/src/settings/tabs/personal-intelligence/PersonalIntelligenceTab.css');
  assert.match(piCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.personal-intelligence-container/);

  const savedCss = read('apps/studio/src/settings/tabs/saved-info/SavedInfoTab.css');
  assert.match(savedCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.saved-info-container/);

  const connCss = read('apps/studio/src/settings/tabs/connected-apps/ConnectedAppsTab.css');
  assert.match(connCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.connected-apps-container/);

  const memCss = read('apps/studio/src/settings/tabs/memory/MemoryTab.css');
  assert.match(memCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.mem-container/);

  const importViewCss = read('apps/studio/src/import-memory/ImportMemoryView.css');
  assert.match(importViewCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.import-hub-root/);

  const actCss = read('apps/studio/src/settings/tabs/activity/ActivityTab.css');
  assert.match(actCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.activity-page/);
});

test('Labs, SettingsModal, ModelsApi, Notebooks, and Projects declare light theme rules', () => {
  const labsCss = read('apps/studio/src/settings/tabs/labs/LabsPage.css');
  assert.match(labsCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.labs-page-container/);

  const modalCss = read('apps/studio/src/settings/SettingsModal.css');
  assert.match(modalCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.settings-modal-dialog/);

  const modelsCss = read('apps/studio/src/settings/tabs/models-api/ModelsApiPage.css');
  assert.match(modelsCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.models-api-container/);

  const nbCss = read('features/notebooks/src/notebooks.css');
  assert.match(nbCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.nb-card/);
  assert.match(nbCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.nb-sheet/);
  assert.match(nbCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.nb-create-input/);

  const allNb = read('features/notebooks/src/AllNotebooksPage.tsx');
  assert.match(allNb, /useThemeMode/);

  const projects = read('features/projects/src/ProjectsPage.tsx');
  assert.match(projects, /useThemeMode/);
});

test('Gemini thinking dots and prompt edit form support light theme', () => {
  const dotsTs = read('features/chat/src/gemini-thinking-dots.ts');
  assert.match(dotsTs, /export const GEMINI_THINKING_DOTS_LIGHT_DATA/);
  assert.match(dotsTs, /\[0\.1216,0\.1216,0\.1216,1\]/);

  const visTsx = read('features/chat/src/GeminiThinkingVisualizer.tsx');
  assert.match(visTsx, /useThemeMode/);
  assert.match(visTsx, /GEMINI_THINKING_DOTS_LIGHT_DATA/);
  assert.match(visTsx, /gemini-thinking-visualizer/);

  const thoughtCss = read('features/chat/src/thought-summary.css');
  assert.match(thoughtCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.gemini-thinking-visualizer svg path/);
  assert.match(thoughtCss, /fill: rgb\(31, 31, 31\) !important;/);

  const chatView = read('features/chat/src/ChatView.tsx');
  assert.match(chatView, /isLight \? 'bg-\[#f2f0f0\]' : ''/);
  assert.match(chatView, /isLight \? 'border-\[#0b57d0\]' : 'border-\[#1f3b9b\]'/);
  assert.match(chatView, /isLight \? 'text-\[#1f1f1f\] caret-\[#0b57d0\]' : 'text-\[#e6e6e6\] caret-\[#e6e6e6\]'/);
  assert.match(chatView, /isLight\s*\?\s*'text-\[#1f1f1f\] hover:bg-black\/5/);
  assert.match(chatView, /isLight\s*\?\s*'bg-\[#0b57d0\] text-white/);
});

test('Spark views, customise pages, and editors declare light theme rules', () => {
  const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');
  assert.match(sidebar, /isLight \? 'text-black\/55' : 'text-white\/55'/);

  const wsCss = read('features/spark/src/SparkWorkspace.css');
  assert.match(wsCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-connected-loading/);
  assert.match(wsCss, /#faf9f9/);

  const homeCss = read('features/spark/src/SparkHome.css');
  assert.match(homeCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-home/);
  assert.match(homeCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-suggested-row:hover/);

  const cardCss = read('features/spark/src/SparkTaskCard.css');
  assert.match(cardCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-goal-card/);
  assert.match(cardCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-status-pill--failed/);
  assert.match(cardCss, /#fce8e6/);
  assert.match(cardCss, /#c5221f/);

  const allTasksCss = read('features/spark/src/SparkAllTasks.css');
  assert.match(allTasksCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-all-tasks/);
  assert.match(allTasksCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-all-tasks__row/);
  assert.match(allTasksCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-all-tasks \.spark-status-pill--failed/);

  const taskDetailCss = read('features/spark/src/SparkTaskDetail.css');
  assert.match(taskDetailCss, /--spark-base-surface: var\(--studio-surface, #faf9f9\);/);
  assert.match(taskDetailCss, /--spark-raised-surface: #ffffff;/);
  assert.match(taskDetailCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-task-detail \.spark-task-detail__status-pill/);
  assert.match(taskDetailCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-task-detail \.spark-status-pill--failed/);

  const dialogsCss = read('features/spark/src/SparkTaskDialogs.css');
  assert.match(dialogsCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-task-dialog/);

  const questionCss = read('features/spark/src/SparkQuestionPanel.css');
  assert.match(questionCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-question\b/);

  const customiseCss = read('features/spark/src/SparkCustomisePages.css');
  assert.match(customiseCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-customise-page/);
  assert.match(customiseCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-connected-app-card/);
  assert.match(customiseCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-skill-row/);
  assert.match(customiseCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-schedule-card/);

  const skillEditorCss = read('features/spark/src/SparkSkillEditor.css');
  assert.match(skillEditorCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-skill-editor/);

  const schedEditorCss = read('features/spark/src/SparkScheduleEditor.css');
  assert.match(schedEditorCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-schedule-editor/);
  assert.match(schedEditorCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-schedule-editor__weekdays button\.is-selected/);

  assert.match(wsCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-connected-glow/);
  assert.match(wsCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-connected-composer \.willow-gemini-composer \{[\s\S]*?box-shadow: 0 2px 8px -2px rgba\(0, 0, 0, 0\.16\);/);
  assert.match(homeCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-composer-anchor::before \{\s*display: none;\s*\}/);
  assert.match(taskDetailCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-task-detail::before \{\s*display: none;\s*\}/);
  assert.match(taskDetailCss, /background: var\(--spark-raised-surface, #1f1f1f\);/);
  assert.match(taskDetailCss, /:is\(\.light-theme, \[data-theme="light"\]\)[\s\S]*?\.spark-task-detail__processing-node[\s\S]*?background: #ffffff;/);
  assert.match(taskDetailCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-task-detail__disclaimer \{\s*color: #444746;\s*\}/);
  assert.match(taskDetailCss, /:is\(\.light-theme, \[data-theme="light"\]\) \.spark-task-detail__followup-composer \.willow-gemini-composer \{[\s\S]*?box-shadow: 0 2px 8px -2px rgba\(0, 0, 0, 0\.16\);/);
  const wsTsx = read('features/spark/src/SparkWorkspace.tsx');
  assert.match(wsTsx, /useThemeMode/);
  assert.match(wsTsx, /sharedGlowHost\.style\.setProperty\('--spark-task-detail-accent', resolvedGlow\)/);
  const taskDetailTsx = read('features/spark/src/SparkTaskDetail.tsx');
  assert.match(taskDetailTsx, /useSparkAccentVars/);
  assert.match(taskDetailTsx, /style=\{accentVars\}/);
});

