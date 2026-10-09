/**
 * The settings pages on phones and tablets: what Gemini's own pages do below 961px.
 *
 * Every value was measured off the live pages (/personalization-settings, /saved-info,
 * /apps, /import, /usage, /gems/view, /gemini-spark and My Activity) at 390x844 and
 * 800x1280 through CDP, read-only. Two things hold on all of them: the page scrolls in a
 * region that starts under the top bar, so content never passes beneath the menu button,
 * and the desktop's fixed column widths give way to the page width. The desktop layout was
 * matched separately and must not move, so each test also pins the desktop rule it leaves.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const settingsCss = (...parts) => stripComments(read('apps', 'studio', 'src', ...parts));

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

const NARROW = '(max-width: 960px)';
const TABLET = '(min-width: 769px) and (max-width: 960px)';
const PHONE = '(max-width: 768px)';

/** Starts under the 68px top bar rather than scrolling beneath it. */
const assertUnderTopBar = (css, root) => {
  const pattern = new RegExp(`${root.replace(/\./g, '\\.')} \\{[^}]*height: calc\\(100% - 68px\\);[^}]*margin-top: 68px;`);
  assert.match(mediaBodies(css, NARROW), pattern, `${root} no longer starts under the top bar`);
};

test('Personal Intelligence keeps Gemini\'s type axes and top offsets below 961px', () => {
  const css = settingsCss('settings', 'tabs', 'personal-intelligence', 'PersonalIntelligenceTab.css');
  assertUnderTopBar(css, '.personal-intelligence-container');
  const narrow = mediaBodies(css, NARROW);
  assert.match(narrow, /\.dark-theme \.personal-intelligence-container \{\s*background-color: #000000;/);
  assert.match(narrow, /\.gds-display-s \{\s*font-variation-settings: "ROND" 100, "slnt" 0, "wdth" 100, "wght" 360;/);
  assert.match(narrow, /\.gds-title-l \{\s*font-variation-settings: "ROND" 20, "slnt" 0, "wdth" 94, "wght" 470;/);
  // The checked switch shows its check alone, not the check squeezed beside the minus.
  assert.match(narrow, /\.mdc-switch--checked \.mdc-switch__icon--off \{\s*display: none;/);
  // Headline at y=92 on a tablet (12px page margin + its own 12px), y=80 on a phone.
  assert.match(mediaBodies(css, TABLET), /\.page-content \{\s*margin-top: 12px;/);
  assert.match(withoutMedia(css), /\.personal-intelligence-container \.page-content \{[^}]*margin: 68px auto/);
});

test('Saved info swaps its fixed desktop grid for Gemini\'s fluid one below 961px', () => {
  const css = settingsCss('settings', 'tabs', 'saved-info', 'SavedInfoTab.css');
  assertUnderTopBar(css, '.saved-info-container');
  const narrow = mediaBodies(css, NARROW);
  assert.match(narrow, /grid-template-areas:\s*"title toggle"\s*"intro intro"\s*"buttons buttons";/);
  assert.match(narrow, /grid-template-columns: minmax\(0, 1fr\) 52px;/);
  assert.match(narrow, /\.action-buttons-container \{[^}]*grid-template-columns: auto 1fr auto;[^}]*gap: 12px;/);
  assert.match(narrow, /\.intro-text ul \{\s*margin: 17px 0;\s*padding-left: 40px;/);
  assert.match(narrow, /\.memory-actions-button \.mat-icon \{[^}]*font-size: 24px;/);
  // The desktop's 650 + 52px grid is untouched.
  assert.match(withoutMedia(css), /\.header\.desktop \{[^}]*grid-template-columns: 650px 52px;/);
});

test('a saved instruction\'s actions open Gemini\'s bottom sheet when compact, and its dialog closes on Escape', () => {
  const source = read('apps', 'studio', 'src', 'settings', 'tabs', 'saved-info', 'SavedInfoTab.tsx');
  assert.match(source, /\{activeMenuId === inst\.id && !isCompact && \(/, 'the desktop dropdown must stay the desktop\'s');
  assert.match(source, /<GeminiBottomSheet\s+isOpen=\{isCompact && activeMenuId !== null\}/);
  assert.match(source, /<GeminiSheetItem\s+icon="edit"\s+label="Edit"/);
  assert.match(source, /<GeminiSheetItem\s+icon="delete"\s+label="Delete"/);
  assert.match(source, /if \(event\.key === 'Escape'\) handleCloseModal\(\);/);
});

test('Connected apps follows Gemini\'s tablet and phone grids', () => {
  const css = settingsCss('settings', 'tabs', 'connected-apps', 'ConnectedAppsTab.css');
  assertUnderTopBar(css, '.connected-apps-container');
  // Tablet: the Workspace card spans three tracks of a two-column grid, as Gemini's does.
  const tablet = mediaBodies(css, TABLET);
  assert.match(tablet, /\.ca-parent-card \{\s*grid-column: span 3;/);
  assert.match(tablet, /\.ca-parent-title \{[^}]*flex: 1 1 0;/);
  // Phone: one column, cards as tall as their content, the collapsed block at its own height.
  const phone = mediaBodies(css, PHONE);
  assert.match(phone, /\.ca-card-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(phone, /\.ca-card \{\s*height: auto;/);
  assert.match(phone, /\.ca-collapsed-content \{\s*flex: 0 0 auto;/);
  assert.match(phone, /\.ca-parent-title \{[^}]*margin: 0 60px 0 0;/);
  assert.match(mediaBodies(css, NARROW), /:not\(:has\(> \.ca-handle\)\) \{\s*padding-bottom: var\(--ca-spacing-s\);/);
  assert.match(withoutMedia(css), /\.ca-parent-card \{[^}]*grid-column: 1 \/ -1;/);
});

test('Import memory, Usage limits and Spark settings drop their fixed desktop columns below 961px', () => {
  const importCss = settingsCss('import-memory', 'ImportMemoryView.css');
  assert.match(mediaBodies(importCss, NARROW), /\.import-hub-window \{[^}]*padding: 3% 2\.5%;/);
  assert.match(mediaBodies(importCss, NARROW), /\.dark-theme \.import-hub-window \{\s*background-color: #131314;/);
  assert.match(withoutMedia(importCss), /\.import-hub-content \{[^}]*width: 800px;/);

  const usageCss = settingsCss('usage', 'UsageLimitsView.css');
  assertUnderTopBar(usageCss, '.usage-limits-root');
  assert.match(mediaBodies(usageCss, NARROW), /\.usage-pro-badge,\s*\.usage-current-card,\s*\.usage-weekly-card \{\s*background: rgb\(20, 20, 20\);/);
  // Where the popover cannot open beside its button it drops below it, kept 4.8px inside.
  assert.match(mediaBodies(usageCss, '(max-width: 435.98px)'), /\.usage-popover \{\s*top: 30\.4px;\s*left: min\(119\.2px, calc\(100vw - 288\.8px\)\);/);

  const sparkCss = settingsCss('spark-settings', 'SparkSettingsView.css');
  assertUnderTopBar(sparkCss, '.spark-settings-root');
  const spark = mediaBodies(sparkCss, NARROW);
  assert.match(spark, /\.spark-settings-card \{[^}]*background: rgb\(20, 20, 20\);/);
  assert.match(spark, /\.spark-settings-title \{\s*font-variation-settings: "ROND" 100/);
  assert.match(spark, /\.spark-dialog-surface \{[^}]*max-width: min\(512px, 100%\);/);
});

test('Activity scrolls under My Activity\'s 64px app bar, 56px on a phone', () => {
  const css = settingsCss('settings', 'tabs', 'activity', 'ActivityTab.css');
  const narrow = mediaBodies(css, NARROW);
  assert.match(narrow, /\.activity-page \{[^}]*--activity-app-bar: 64px;[^}]*margin-top: var\(--activity-app-bar\);[^}]*box-shadow: 0 calc\(-1 \* var\(--activity-app-bar\)\) 0 0 #131314;/);
  assert.match(mediaBodies(css, '(max-width: 599.98px)'), /--activity-app-bar: 56px;/);
});

test('Gems renders Gemini\'s is-mobile variant when compact and leaves the desktop sizes alone', () => {
  const css = stripComments(read('features', 'gems', 'src', 'gems.css'));
  const narrow = mediaBodies(css, NARROW);
  assert.match(narrow, /\.gems-premade-cards-inner \{[^}]*flex-wrap: nowrap;/);
  assert.match(narrow, /\.gems-premade-cards,\s*\.gems-premade-cards\.is-expanded \{[^}]*overflow-x: auto;/);
  assert.match(narrow, /\.gems-show-more \{[^}]*display: none;/);
  assert.match(narrow, /\.gems-page \{[^}]*margin-top: 68px;/);
  assert.match(css, /\.gems-inner \{[^}]*max-width: 878px;/);
  assert.match(css, /\.gems-premade-cards-inner \{[^}]*flex-wrap: wrap;/);
});

/*
 * The Willow-only pages have no Gemini page to measure, so below 961px they take the
 * narrow treatment of the Gemini-matched page each is drawn after (Personal Intelligence):
 * the scroll region starts under the 68px bar, on black, and the 68px the page held inside
 * goes. Their desktop margins stay.
 */
test('Labs, Models & API and Memory start under the top bar on black, like the Gemini-matched pages', () => {
  const pages = [
    ['settings/tabs/labs/LabsPage.css', 'labs-page-container', 'lp-page-content', /--lp-surface: #000000;/],
    ['settings/tabs/models-api/ModelsApiPage.css', 'models-api-container', 'ma-page-content', /--ma-surface: #000000;/],
    ['settings/tabs/memory/MemoryTab.css', 'mem-container', 'mem-window', /background: #000000;/],
  ];
  for (const [file, root, content, black] of pages) {
    const css = settingsCss(...file.split('/'));
    const narrow = mediaBodies(css, NARROW);
    assert.match(narrow, new RegExp(`\\.${root} \\{[^}]*height: calc\\(100% - 68px\\);[^}]*margin-top: 68px;`), file);
    assert.match(narrow, new RegExp(`\\.dark-theme \\.${root} \\{[^}]*`), file);
    assert.match(narrow, black, file);
    assert.match(narrow, new RegExp(`\\.${root} \\.${content} \\{[^}]*margin-top: 0;`), file);
    assert.match(narrow, /font-variation-settings: "ROND" 100, "slnt" 0, "wdth" 100, "wght" 360;/, file);
    assert.match(withoutMedia(css), new RegExp(`\\.${content} \\{[^}]*margin: 68px auto`), file);
  }
});

test('Models & API keeps its model and provider rows inside the card; on a phone a model row takes two lines', () => {
  const css = settingsCss('settings', 'tabs', 'models-api', 'ModelsApiPage.css');
  const narrow = mediaBodies(css, NARROW);
  // An `auto` grid track grows to a row's min-content (the whole unwrapped name plus the
  // price pill and both buttons) and pushed the page sideways.
  assert.match(narrow, /\.ma-model-list,\s*\.models-api-container \.ma-provider-list \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(narrow, /\.ma-model-row,\s*\.models-api-container \.ma-provider-row \{[^}]*min-width: 0;/);
  const phone = mediaBodies(css, '(max-width: 600px)');
  assert.match(phone, /\.ma-model-row \{[^}]*display: grid;[^}]*grid-template-areas:\s*"mark text actions"\s*"mark price actions";/);
  assert.match(phone, /\.ma-model-price \{[^}]*grid-area: price;/);
  assert.match(withoutMedia(css), /\.ma-model-row \{[^}]*display: flex;/);
});

test('Memory\'s add / edit dialog closes on Escape', () => {
  const tab = read('apps', 'studio', 'src', 'settings', 'tabs', 'memory', 'MemoryTab.tsx');
  assert.match(tab, /if \(!isModalOpen\) return undefined;\s*const onKeyDown = \(event: KeyboardEvent\) => \{\s*if \(event\.key === 'Escape'\) handleCloseModal\(\);/);
});

test('Memory keeps its pill labels on one line and lists a row\'s actions in a bottom sheet', () => {
  const narrow = mediaBodies(settingsCss('settings', 'tabs', 'memory', 'MemoryTab.css'), NARROW);
  assert.match(narrow, /\.mem-actions \{[^}]*flex-wrap: wrap;/);
  assert.match(narrow, /\.mem-button \{[^}]*white-space: nowrap;/);
  const list = read('apps', 'studio', 'src', 'settings', 'tabs', 'memory', 'MemoryList.tsx');
  assert.match(list, /<GeminiBottomSheet\s+isOpen=\{isCompact && !!activeBullet\}/);
  assert.match(list, /showsDropdown=\{!isCompact\}/);
});

test('Search starts under the top bar too, so its field never sits under the menu button', () => {
  const css = settingsCss('shell', 'SearchChats.css');
  const narrow = mediaBodies(css, NARROW);
  assert.match(narrow, /\.willow-search-page \{[^}]*margin-top: 68px;[^}]*padding-top: 12px;/);
  assert.match(withoutMedia(css), /\.willow-search-page \{[^}]*padding-top: 100px;/);
});

test('the settings modal becomes a two-level full-screen settings screen below 961px', () => {
  const modal = read('apps', 'studio', 'src', 'settings', 'SettingsModal.tsx');
  assert.match(modal, /const isCompact = useCompactViewport\(\);/);
  assert.match(modal, /useState<'list' \| 'content'>\(initialTab \? 'content' : 'list'\)/);
  assert.match(modal, /aria-label="Back to settings"/);
  assert.match(modal, /'is-compact w-full h-full flex-col'/);
  assert.match(modal, /'w-\[calc\(100vw_-_12vh\)\] h-\[88vh\] rounded-\[10px\] shadow-2xl border border-white\/10'/);

  const css = settingsCss('settings', 'SettingsModal.css');
  assert.match(css, /\.settings-modal-compact-header \{[^}]*height: 64px;/);
  assert.match(css, /\.settings-modal-compact-list > button,\s*\.settings-modal-compact-list > \.settings-modal-labs-item \{[^}]*min-height: 48px;/);
  assert.match(css, /\.settings-modal-dialog\.is-compact \.settings-modal-content \.px-12 \{[^}]*padding-left: 24px;/);
  const phone = mediaBodies(css, '(max-width: 600px)');
  assert.match(phone, /\.flex\.items-start\.gap-8:not\(\.justify-between\) \{[^}]*flex-direction: column;/);
  assert.match(phone, /\.justify-between:has\(> \.w-64\) \{[^}]*flex-direction: column;/);
  assert.match(phone, /\.grid-cols-3 \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
});

test('the narrow settings sheet scrolls without painting a scrollbar', () => {
  const css = settingsCss('shell', 'sidebar', 'Sidebar.css');
  assert.match(css, /\.willow-settings-sheet-content \{[^}]*scrollbar-width: none;/);
  assert.match(css, /\.willow-settings-sheet-content::-webkit-scrollbar \{[^}]*display: none;/);
});
