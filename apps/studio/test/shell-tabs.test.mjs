/**
 * The rail's tabs behave as opened tabs: going to another and back finds one as it was, not built
 * again. Inside the main shell each tab is kept mounted once opened, the ones not on show hidden as
 * a working screen is; and the shell itself is kept mounted beside the screens outside it (a Media
 * or Code project, Willow TV), rendered against its last address.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const app = read('apps', 'studio', 'src', 'app', 'App.tsx');

it('keeps each of the shell\'s tabs mounted once opened, hidden while another is on show', () => {
  assert.match(app, /const SHELL_TABS: readonly ShellTab\[\] = \['chat', 'spark', 'media', 'customize'\];/);
  assert.match(app, /if \(shellTab\) openedShellTabsRef\.current\.add\(shellTab\);/);
  assert.match(app, /\{keptShellTabs\.map\(\(tab\) => \(\s*<div\s+key=\{tab\}\s+style=\{tab === shellTab \? VISIBLE_SURFACE_STYLE : BACKGROUND_SURFACE_STYLE\}\s+inert=\{tab !== shellTab\}/);
  // The view switch no longer renders them itself, or each would be built twice.
  assert.match(app, /\) : currentView === 'home' \? \(\s*\/\/[^\n]*\n\s*null\s*\) : currentView === 'personal-intelligence'/);
  assert.match(app, /\) : currentView === 'customize' \? \(\s*\/\/[^\n]*\n\s*null\s*\) : currentView === 'waifu'/);
  assert.equal((app.match(/<CustomizeView \/>/g) ?? []).length, 1);
  assert.equal((app.match(/<ChatView\b/g) ?? []).length, 1);
});

it('keeps Bots and the rest of Spark as two tabs inside the one Spark workspace', () => {
  const spark = read('features', 'spark', 'src', 'SparkWorkspace.tsx');
  // One workspace (it runs Spark's schedules and turns): the page behind Bots is the one Spark last showed.
  assert.match(spark, /const isDotsShown = liveLocation\.page === 'dots';/);
  assert.match(spark, /if \(!isDotsShown\) lastSparkPageRef\.current = liveLocation;/);
  assert.match(spark, /const location = isDotsShown && lastSparkPageRef\.current \? lastSparkPageRef\.current : liveLocation;/);
  assert.match(spark, /<div key="spark" style=\{isDotsShown \? KEPT_PAGE_STYLE : SHOWN_PAGE_STYLE\} inert=\{isDotsShown\}/);
  assert.match(spark, /\{dotsOpenedRef\.current && \(\s*<div key="bots" style=\{isDotsShown \? SHOWN_PAGE_STYLE : KEPT_PAGE_STYLE\} inert=\{!isDotsShown\}/);
  assert.match(spark, /\/\/ Behind Bots[^\n]*\n\s*if \(isDotsShown\) return;\s*if \(location\.page === 'task' && !task\) replaceSparkLocation/,
    'a redirect behind Bots would take the user off Bots');
  // Every page goes through `withBots`, or the other layer is dropped on that page.
  const pages = spark.slice(spark.indexOf('if (backgroundOnly) return null;'), spark.indexOf('export const sparkWorkspaceNavigation'));
  assert.doesNotMatch(pages, /\n {2,4}return \(/);
  assert.match(pages, /const wrapConnectedPage = \(content: React\.ReactNode\) => withBots\(/);
  assert.equal((spark.match(/<SparkDotsPage\b/g) ?? []).length, 1);
});

it('keeps the Code home mounted once opened, not only while its turn runs', () => {
  assert.match(app, /if \(isCodeSurface && isOnMainShell\) codeHomeOpenedRef\.current = true;/);
  assert.match(app, /keptCodeHomes\.has\(home\.key\) \|\| \(home === shownCodeHome && codeHomeOpenedRef\.current\)/);
});

it('keeps the shell mounted beside the screens outside it, against its last address', () => {
  const keeper = app.slice(app.indexOf('const ShellKeepAlive'), app.indexOf('/** Make projects created on another device'));
  assert.match(keeper, /if \(onShow\) lastShellLocationRef\.current = location;/);
  assert.match(keeper, /<Routes location=\{shown\}>\s*<Route path="\*" element=\{children\} \/>/);
  assert.match(keeper, /inert=\{!onShow\}/);
  assert.match(keeper, /<ShellActiveContext\.Provider value=\{onShow\}>/);
  assert.match(app, /<ShellKeepAlive onShow=\{isMainShellRoute\}>\{mainAppShell\}<\/ShellKeepAlive>/);
  assert.ok(!app.includes('element={mainAppShell}'), 'a route still renders a second shell');
});

it('leaves the window\'s files, Escape and Settings to the tab on show', () => {
  // Spark's composer, Media's landing and the chat are the same composer: one drop, one attachment.
  const composer = read('features', 'chat', 'src', 'composer', 'Composer.tsx');
  assert.match(composer, /const isBehindAnotherTab = \(\) => \(chatComposerBoxRef\.current \?\? devComposerBoxRef\.current\)\?\.closest\('\[inert\]'\) != null;/);
  assert.match(composer, /const handleWindowDrop = \(e: DragEvent\) => \{\s*e\.preventDefault\(\);\s*const hadFiles = hasFiles\(e\) && !isBehindAnotherTab\(\);/,
    'a hidden composer still takes the drop, so the page is not swapped for the file');
  assert.match(read('features', 'chat', 'src', 'canvas', 'CanvasPanel.tsx'), /if \(panelRef\.current\?\.closest\('\[inert\]'\)\) return;/);
  assert.match(read('features', 'chat', 'src', 'research', 'ResearchPanel.tsx'), /!bodyRef\.current\?\.closest\('\[inert\]'\)\) onClose\(\)/);
  assert.match(app, /\{hasOpenedSettings && isMainShellRoute && \(/, 'the hidden shell opens a second Settings beside the screen\'s own');
  // Spark's and Bots' overlays stay open behind another tab, so their Escape checks too.
  const spark = (...parts) => read('features', 'spark', 'src', ...parts);
  assert.match(spark('dots', 'DotConversation.tsx'), /if \(conversationRef\.current\?\.closest\('\[inert\]'\)\) return;\s*closeDotComputer\(dot\.id\);/);
  const detail = spark('SparkTaskDetail.tsx');
  assert.match(detail, /if \(event\.key === 'Escape' && !conversationRef\.current\?\.closest\('\[inert\]'\)\) closeSparkFile\(currentTask\.id\);/);
  assert.match(detail, /if \(conversationRef\.current\?\.closest\('\[inert\]'\)\) return;\s*closeRemoteBrowserPane\(currentTask\.id\);/);
  assert.match(spark('spaces', 'willow', 'SpacesSidePanel.tsx'), /if \(panelRef\.current\?\.closest\('\[inert\]'\)\) return;/);
});

it('opens Customize where it was left, after a reload too', () => {
  const view = read('apps', 'studio', 'src', 'customize', 'CustomizeView.tsx');
  assert.match(view, /const LEFT_KEY = 'willow:customize-left';/);
  assert.match(view, /const left = readLeft\(\);/);
  assert.match(view, /sessionStorage\.setItem\(LEFT_KEY, JSON\.stringify\(left\)\);/);
  assert.match(view, /useState<CustomizeTab>\(\(\) => left\.tab\)/);
});

it('lets only the frame on show answer the strip\'s menus and open Ask Willow', () => {
  const frame = read('apps', 'studio', 'src', 'shell', 'rail', 'DesktopFrame.tsx');
  assert.match(frame, /\{active && \(\s*<AppMenu/);
  assert.match(frame, /\{active && askWillow && \(/);
  const layout = read('apps', 'studio', 'src', 'shell', 'StudioLayout.tsx');
  assert.match(layout, /const shellActive = React\.useContext\(ShellActiveContext\);/);
  assert.match(layout, /active=\{shellActive\}/);
});
