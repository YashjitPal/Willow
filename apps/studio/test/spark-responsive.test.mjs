/**
 * Spark on phones and tablets: the pieces Gemini swaps in below 961px.
 *
 * Every value here was measured off the live Gemini app at 390x844 and 800x1280
 * through CDP (computed styles and geometry, read-only). Gemini's layout breakpoint
 * is 959.98px, and several of its rules split again at 768px, so these live in
 * `(max-width: 960px)`, `(max-width: 768px)` and `(min-width: 769px) and
 * (max-width: 960px)` blocks. The desktop layout was matched separately and must
 * not move, so each test also pins that its rules stay out of the desktop cascade.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const sparkDir = path.join(repoRoot, 'features', 'spark', 'src');
const read = (file) => fs.readFileSync(path.join(sparkDir, file), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The joined bodies of every `@media <query> { … }` block, matched brace for brace. */
const mediaBodies = (css, query) => {
  const opener = `@media ${query} {`;
  const bodies = [];
  let at = css.indexOf(opener);
  while (at !== -1) {
    let depth = 1;
    let i = at + opener.length;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    bodies.push(css.slice(at + opener.length, i - 1));
    at = css.indexOf(opener, i);
  }
  assert.ok(bodies.length > 0, `no @media ${query} block`);
  return bodies.join('\n');
};

/** The stylesheet with every @media block removed: what the desktop always sees. */
const withoutMedia = (css) => {
  let out = '';
  let at = 0;
  for (let start = css.indexOf('@media', at); start !== -1; start = css.indexOf('@media', at)) {
    out += css.slice(at, start);
    let i = css.indexOf('{', start) + 1;
    for (let depth = 1; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    at = i;
  }
  return out + css.slice(at);
};

test('schedule times read "8:00 AM" below 961px and keep "8:00 am" on the desktop', async () => {
  // Gemini's narrow layout formats clock times as en-US; the desktop's lowercase
  // labels were matched separately (`95-schedule-row.cjs`).
  const { formatSparkScheduleTime } = await importTs(path.join(sparkDir, 'SparkScheduleEditor.tsx'));
  assert.equal(formatSparkScheduleTime('08:00', true), '8:00 AM');
  assert.equal(formatSparkScheduleTime('00:15', true), '12:15 AM');
  assert.equal(formatSparkScheduleTime('20:30', true), '8:30 PM');
  assert.equal(formatSparkScheduleTime('20:30'), '8:30 pm');
});

test('the task list swaps in the bottom sheet and Gemini\'s dialogs only when compact', () => {
  const source = read('SparkAllTasks.tsx');
  assert.match(source, /\{filterOpen && !isCompact && \(/,
    'the desktop filter dropdown must stay the desktop\'s');
  assert.match(source, /\{isCompact && \(\s*<GeminiBottomSheet isOpen=\{filterOpen\}/);
  assert.match(source, /\{renameTask && isCompact && \(\s*<SparkTaskRenameDialog/);
  assert.match(source, /\{deleteTask && isCompact && \(\s*<SparkTaskDeleteDialog/);
  assert.match(source, /\{renameTask && !isCompact && typeof document !== 'undefined' && createPortal\(/,
    'the desktop rename dialog must not be replaced');
});

test('the bottom sheet is Material\'s, as Gemini\'s gem-bottom-sheet measures', () => {
  const css = stripComments(fs.readFileSync(
    path.join(repoRoot, 'platform', 'ui', 'src', 'GeminiBottomSheet.css'), 'utf8'));
  assert.match(css, /\.gemini-bottom-sheet \{[^}]*border-radius: 56px 56px 0 0;[^}]*background: #1c1c1c;/);
  assert.match(css, /\.gemini-bottom-sheet \{[^}]*animation: gemini-bottom-sheet-enter 195ms cubic-bezier\(0, 0, 0\.2, 1\)/);
  assert.match(css, /\.gemini-bottom-sheet\.is-leaving \{[^}]*150ms/);
  assert.match(css, /\.gemini-bottom-sheet-backdrop \{[^}]*background: rgba\(0, 0, 0, 0\.32\);[^}]*400ms/);
  assert.match(css, /\.gemini-bottom-sheet-handle \{[^}]*width: 54px;[^}]*height: 5px;/);
  assert.match(css, /\.gemini-bottom-sheet-content \{[^}]*padding: 0 16px 8px;/);
  // The actions list a sheet holds: Gemini's `gem-list` card and its 48px rows.
  assert.match(css, /\.gemini-sheet-list \{[^}]*padding: 12px 8px;[^}]*border-radius: 28px;[^}]*background: #0e0e0e;/);
  assert.match(css, /\.gemini-sheet-item \{[^}]*min-height: 48px;[^}]*gap: 12px;[^}]*padding: 12px 16px;[^}]*border-radius: 16px;/);
});

test('the task list heading exists below 961px and nowhere on the desktop', () => {
  const css = stripComments(read('SparkAllTasks.css'));
  assert.match(mediaBodies(css, '(max-width: 960px)'),
    /\.spark-all-tasks__heading \{[^}]*font-size: 36px;[^}]*font-weight: 320;[^}]*line-height: 44px;/);
  assert.ok(!withoutMedia(css).includes('.spark-all-tasks__heading'),
    'the heading leaks into the desktop cascade');
});

test('the task view\'s follow-up composer splits at 768px as Gemini\'s does', () => {
  const css = stripComments(read('SparkTaskDetail.css'));
  const phone = mediaBodies(css, '(max-width: 768px)');
  const tablet = mediaBodies(css, '(min-width: 769px) and (max-width: 960px)');

  // Phone: the composer fills the bar and glows faintly light; the disclaimer moves
  // to the end of the thread.
  assert.match(phone, /\.spark-task-detail__followup-zone \{\s*padding: 12px 16px 12px;/);
  assert.match(phone, /\.spark-task-detail__followup-composer \.willow-gemini-composer \{\s*box-shadow: 0 0 20px 0 rgba\(227, 227, 227, 0\.04\);/);
  assert.match(phone, /\.spark-task-detail__followup-zone \.spark-task-detail__disclaimer \{\s*display: none;/);

  // Tablet: a 660px column with 32px corners, and the disclaimer stays under it.
  assert.match(tablet, /\.spark-task-detail__followup-composer \{\s*max-width: 660px;/);
  assert.match(tablet, /border-radius: 32px !important;/);
  assert.match(tablet, /\.spark-task-detail__thread-disclaimer \{\s*display: none;/);

  const detail = read('SparkTaskDetail.tsx');
  // Gemini's box now asks the same question at every width.
  assert.match(detail, /const followUpPlaceholder = 'Ask a follow-up';/);
  assert.match(detail, /\{isCompact && \(\s*<p className="spark-task-detail__thread-disclaimer">/);
});

test('the drawer button gives way to the task view\'s own back button below 961px', () => {
  const css = stripComments(fs.readFileSync(
    path.join(repoRoot, 'apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.css'), 'utf8'));
  // Only the task view on show: one kept behind another tab (`inert`) leaves that tab its button.
  assert.match(mediaBodies(css, '(max-width: 960px)'),
    /body:has\(\.spark-task-detail:not\(\[inert\] \*\)\) \.studio-sidebar-mobile-open \{\s*display: none;/);
  assert.ok(!withoutMedia(css).includes('body:has(.spark-task-detail'),
    'the desktop rail must not hide anything for the task view');
});

test('Connected apps keeps Gemini\'s Workspace columns and a chip row that cannot clip', () => {
  const css = stripComments(read('SparkCustomisePages.css'));
  // Willow has four categories to Gemini's two; `safe` starts an overflowing row at
  // its edge rather than centring it off both sides of a phone.
  assert.match(mediaBodies(css, '(max-width: 960px)'),
    /\.spark-app-categories \{[^}]*justify-content: safe center;/);
  assert.match(mediaBodies(css, '(min-width: 769px) and (max-width: 960px)'),
    /\.spark-workspace-card__products \{[^}]*grid-template-columns: repeat\(2, 246px\);/);
  assert.match(mediaBodies(css, '(max-width: 768px)'),
    /\.spark-workspace-card__summary \{\s*margin: 0 60px 12px 0;/);
});

test('the connected composer only reads "Describe task" on the compact task list', () => {
  assert.match(read('SparkWorkspace.tsx'),
    /placeholder=\{isCompact && location\.page === 'all-tasks' \? 'Describe task' : undefined\}/);
});

test('the skill editor fills the viewport below 961px and keeps its desktop card above', () => {
  const css = stripComments(read('SparkSkillEditor.css'));
  const compact = mediaBodies(css, '(max-width: 960px)');
  assert.match(compact, /\.spark-skill-editor__header \{[^}]*height: 60px;[^}]*padding: 12px;/);
  assert.match(compact, /\.spark-skill-editor \.spark-skill-editor__back \{[^}]*height: 36px;[^}]*padding: 0 12px 0 8px;/);
  assert.match(compact, /\.spark-skill-editor__panel \{[^}]*padding: 24px;[^}]*border-color: #141414;/);
  assert.match(compact, /\.spark-skill-editor__panel > \.spark-skill-editor__field:last-child textarea \{[^}]*min-height: 398px;/);
  // The desktop column and its 1060px card are untouched.
  assert.match(withoutMedia(css), /\.spark-skill-editor__content \{\s*width: min\(1060px, calc\(100% - 32px\)\);/);

  // Gemini's long placeholders size its fields at these widths; the desktop keeps Willow's.
  const editor = read('SparkSkillEditor.tsx');
  assert.match(editor, /placeholder=\{isCompact \? 'Name your skill\. For example: "meeting-notes-summarizer"' : 'Name your skill'\}/);
  assert.match(editor, /size=\{isCompact \? 24 : 28\} weight=\{isCompact \? 300 : 260\}/);
});

test('a reply\'s actions and their menu take Gemini\'s compact sizes below 961px', () => {
  const css = stripComments(read('SparkTaskDetail.css'));
  const compact = mediaBodies(css, '(max-width: 960px)');
  // `actions-container-v2.mobile`: a 48px row 4px under the reply, 36px buttons 12px apart.
  assert.match(compact, /\.spark-task-detail__response-actions \{\s*height: 48px;\s*gap: 12px;\s*margin-top: 4px;/);
  assert.match(compact, /\.spark-task-detail__response-actions button \{[^}]*width: 36px;[^}]*height: 36px;[^}]*padding: 6px;[^}]*color: #e0e0e0;/);
  assert.match(mediaBodies(css, '(min-width: 769px) and (max-width: 960px)'),
    /\.spark-task-detail__response-actions \{\s*margin-right: 6px;\s*margin-left: -6px;/,
    'on a tablet the row sits 6px left of the reply');
  // Its menu is `gem-menu`: content-sized, 20px corners, 40px rows with 17px labels.
  assert.match(compact, /\.spark-task-detail__response-menu \{[^}]*width: max-content;[^}]*min-width: min\(225px, 100%\);[^}]*border-radius: 20px;[^}]*background: #1c1c1c;/);
  assert.match(compact, /\.spark-task-detail__response-menu button \{[^}]*height: 40px;[^}]*font-size: 17px;[^}]*line-height: 24px;/);

  const detail = read('SparkTaskDetail.tsx');
  assert.match(detail, /const glyph = isCompact\s*\? \{ size: 24, opticalSize: 24, weight: 300 \}\s*: \{ size: 20, opticalSize: 20, weight: SYMBOL_PROPS\.weight \};/,
    'the glyphs grow to 24px at weight 300 only when compact');
  assert.match(detail, /const menuHeight = isCompact \? 96 : 88;/);
  assert.doesNotMatch(withoutMedia(css), /\.spark-task-detail__response-actions \{[^}]*height: 48px;/,
    'the desktop row keeps its own height');
});

test('the processing pill, lists and links sit where Gemini\'s do below 961px', () => {
  const css = stripComments(read('SparkTaskDetail.css'));
  // `processing-state-container-button` reaches 17px left of the column and pads back in.
  assert.match(mediaBodies(css, '(max-width: 960px)'),
    /\.spark-task-detail \.spark-task-detail__processing-trigger \{[^}]*margin-left: -17px;[^}]*padding-left: 16px;/);
  assert.match(mediaBodies(css, '(min-width: 757px) and (max-width: 960px)'),
    /\.spark-task-detail \.smd-root > \.smd-list \{\s*margin-left: -1\.675px;/);

  const markdown = fs.readFileSync(path.join(repoRoot, 'platform', 'ui', 'src', 'streaming-markdown-styles.ts'), 'utf8');
  assert.match(markdown, /'@media screen and \(max-width: 959\.98px\) \{',\s*'  \.smd-link \{ color: rgb\(224, 224, 224\); text-decoration-color: rgb\(224, 224, 224\); \}',/);
});

test('the task menu drops flush from its trigger with Gemini\'s compact rows below 961px', () => {
  const css = stripComments(read('SparkTaskDetail.css'));
  const compact = mediaBodies(css, '(max-width: 960px)');
  assert.match(compact, /\.spark-task-detail__task-menu \{\s*top: 38px;\s*right: 16px;\s*background: #1c1c1c;\s*color: #e0e0e0;/);
  assert.match(compact, /\.spark-task-detail__task-menu button \{[^}]*font-size: 13px;[^}]*font-weight: 400;[^}]*line-height: 17px;/);
  assert.match(compact, /\.spark-task-detail__task-menu button > span:first-child \{\s*margin: 0 2px;/,
    '20px glyphs centred in 24px boxes');
  assert.match(compact, /\.spark-task-detail__task-menu \.spark-task-detail__menu-divider \{[^}]*margin: 8px 12px;[^}]*border-top: 0\.8px solid rgb\(68, 71, 70\);/);
  assert.match(withoutMedia(css), /\.spark-task-detail__task-menu \{[^}]*top: 48px;[^}]*right: 12px;[^}]*background: #1f1f1f;/,
    'the desktop menu keeps its own placement and surface');
});

test('the status pill opens Gemini\'s full-screen side panel below 961px and the popover above', () => {
  const detail = read('SparkTaskDetail.tsx');
  assert.match(detail, /\{isStatusPopoverOpen && isCompact && \(\s*<div\s*ref=\{statusPopoverRef\}[\s\S]*?className="spark-task-detail__progress-overlay"/);
  assert.match(detail, /\{isStatusPopoverOpen && !isCompact && \(\s*<div\s*ref=\{statusPopoverRef\}[\s\S]*?className="spark-task-detail__progress-popover"/,
    'the desktop popover must stay the desktop\'s');
  assert.match(detail, /const isProgressPanelOpen = isLibraryCollapsed && !isCompact && !isRemoteBrowserOpen && !isFileOpen;/,
    'a list-pane collapse from a wider window must not hide the pill when compact');
  // Gemini's sections, in its order and copy, with the task's schedule between Progress and Files.
  const overlay = detail.slice(detail.indexOf('className="spark-task-detail__progress-overlay"'), detail.indexOf('className="spark-task-detail__progress-popover"'));
  const titles = [...overlay.matchAll(/spark-task-detail__progress-overlay-title[^>]*>\s*([^<{]+?)\s*</g)].map((match) => match[1]);
  assert.deepEqual(titles, ['Progress', 'Schedules', 'Files', 'Skills &amp; apps']);
  assert.match(overlay, /formatSparkScheduleTrigger\(schedule, true\)/);
  assert.match(overlay, /weight=\{300\}\s*\/>/, 'app glyphs at weight 300');

  const css = stripComments(read('SparkTaskDetail.css'));
  const compact = mediaBodies(css, '(max-width: 960px)');
  assert.match(compact, /\.spark-task-detail__progress-overlay \{[^}]*position: fixed;[^}]*inset: 0;[^}]*background: #000;/);
  assert.match(compact, /\.spark-task-detail__progress-overlay-header \{[^}]*height: 48px;[^}]*justify-content: flex-end;[^}]*padding: 8px 8px 0;/);
  assert.match(compact, /\.spark-task-detail__progress-overlay-close \{[^}]*width: 40px;[^}]*height: 40px;[^}]*padding: 8px;[^}]*color: #c4c7c5;/);
  assert.match(compact, /\.spark-task-detail \.spark-task-detail__progress-overlay-title \{[^}]*padding: 14px 16px 10px;[^}]*font-size: 15px;[^}]*line-height: 20px;/);
  assert.match(compact, /\.spark-task-detail__progress-overlay-row \{[^}]*gap: 8px;[^}]*padding: 4px;[^}]*border-radius: 8px;[^}]*font-size: 15px;/);
  // Except the scrollbar-hiding rule Progress shares in all three of its forms: the
  // overlay only renders when compact, so on the desktop that rule styles nothing.
  assert.doesNotMatch(withoutMedia(css), /\.spark-task-detail__progress-overlay(?![\w-]*::-webkit-scrollbar)/,
    'the overlay leaks into the desktop cascade');
});

test('a schedule\'s trigger line reads the way Gemini writes it', async () => {
  const { formatSparkScheduleTrigger } = await importTs(path.join(sparkDir, 'SparkScheduleEditor.tsx'));
  assert.equal(formatSparkScheduleTrigger({ frequency: 'Daily', weekdays: [], time: '08:00' }, true), 'Daily around 8:00 AM');
  assert.equal(formatSparkScheduleTrigger({ frequency: 'Weekly', weekdays: ['Mon', 'Fri'], time: '21:30' }), 'Weekly on Mon, Fri around 9:30 pm');
  assert.equal(formatSparkScheduleTrigger({ frequency: 'Weekly', weekdays: [], time: '07:05' }, true), 'Weekly around 7:05 AM');
});

test('the compact Beta badge sits over the schedule editor but not the skill editor', () => {
  // Gemini's skill editor paints its own header over `remy-badges`; the schedule editor
  // leaves it showing.
  const workspace = read('SparkWorkspace.tsx');
  assert.match(workspace, /if \(location\.page === 'schedule-editor'\) \{\s*return withBots\(\s*<>\s*\{compactBetaBadge\}\s*<SparkScheduleEditor/);
  assert.doesNotMatch(workspace, /\{compactBetaBadge\}\s*<SparkSkillEditor/);
});
