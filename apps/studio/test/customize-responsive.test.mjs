/**
 * Customize on phones and tablets. Gemini has no Customize surface to measure, so below
 * 961px it follows the pages that do: the shell's top bar (menu button, wordmark, New
 * chat), every screen's first row opening the page with even gaps above and below it,
 * touch-sized card actions, bottom sheets for menus and the mobile message panel for
 * confirmations.
 * The desktop layout was matched separately and must not move, so the tests also pin the
 * desktop rules the narrow ones leave alone.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const customize = (file) => read('apps', 'studio', 'src', 'customize', file);
const customizeCss = () => stripComments(customize('CustomizeView.css'));

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
const ONE_COLUMN = '(max-width: 740px)';
const PHONE = '(max-width: 600px)';

test('the shell draws the narrow top bar on every Customize screen', () => {
  const layout = read('apps', 'studio', 'src', 'shell', 'StudioLayout.tsx');
  const condition = "(currentView === 'notebooks' || currentView === 'notebook-create' || currentView === 'gems' || currentView === 'customize') && (";
  const at = layout.indexOf(condition);
  assert.ok(at !== -1, 'Customize is missing from the narrow top bar');
  const bar = layout.slice(at, layout.indexOf('</>', at));
  assert.match(bar, /min-\[961px\]:hidden absolute top-\[14px\] left-\[56px\][\s\S]*studio-mobile-wordmark-text">Willow</);
  assert.match(bar, /min-\[961px\]:hidden absolute top-\[14px\] right-\[12px\][\s\S]*aria-label="New Chat"/);
});

test('Customize hangs under the top bar, its first row opening the page with matching gaps above and below', () => {
  const css = customizeCss();
  const narrow = mediaBodies(css, NARROW);
  const page = narrow.match(/\.customize-page-root \{\s*height: calc\(100% - (\d+)px\);\s*margin-top: \1px;/);
  assert.ok(page, 'the page no longer starts under the top bar');
  const pageTop = Number(page[1]);
  assert.equal(pageTop, 68);
  const row = narrow.match(
    /\.customize-page-root :is\(\.customize-nav-buttons, \.customize-category-top-nav, \.top-nav-bar, \.manager-header\) \{([^}]*)\}/,
  );
  assert.ok(row, 'the pills, the category back row, the detail back row and the editor header share one rule');
  assert.match(row[1], /flex: none;/, 'the category row would shrink in the scrolling column');
  assert.match(row[1], /height: 36px;/);
  assert.match(row[1], /padding-block: 0;/);

  // The row opens the page, so the space above it runs from the shell's menu glyph, whose
  // ink ends at y 36 (32px Luminous `menu` in the 48px button at top 8; measured with
  // tools/scratch/cz-top-gap.cjs). The space under it matches that.
  const MENU_GLYPH_INK_BOTTOM = 36;
  const [, top, below] = row[1].match(/margin: (\d+) 0 (\d+)px;/);
  assert.equal(Number(top), 0);
  assert.equal(Number(below), pageTop - MENU_GLYPH_INK_BOTTOM, 'the gap under the first row no longer matches the one above it');
  assert.match(narrow, /:is\(\.customize-nav-button, \.customize-category-back-button\):focus-visible \{\s*outline-offset: -2px;/);
  assert.match(narrow, /\.customize-page-root \.details-content-column \{\s*padding-top: 0;/);

  const desktop = withoutMedia(css);
  assert.match(desktop, /\.customize-nav-buttons \{[^}]*padding-block: 16px 72px;/);
  assert.match(desktop, /\.customize-category-top-nav \{[^}]*height: 96px;\s*padding: 12px 0 48px;/);
  assert.match(desktop, /\.top-nav-bar \{[^}]*height: 60px;\s*padding: 12px 0;/);
  assert.match(desktop, /\.details-content-column \{[^}]*padding: 32px 0 48px;/);
  assert.doesNotMatch(desktop.match(/\.customize-page-root \{[^}]*\}/)[0], /margin-top/);
});

test('cards keep their add and more buttons on a touchscreen, and fill a one-column grid', () => {
  const css = customizeCss();
  assert.match(
    mediaBodies(css, NARROW),
    /\.customize-card \.add-button,\s*\.customize-card \.more-button \{\s*opacity: 1;\s*pointer-events: auto;\s*visibility: visible;/,
  );
  assert.match(mediaBodies(css, ONE_COLUMN), /\.customize-card \{\s*width: 100%;/);
  const desktop = withoutMedia(css);
  assert.match(desktop, /\.customize-card \.add-button,\s*\.customize-card \.more-button \{[^}]*opacity: 0;[^}]*visibility: hidden;/);
  assert.match(desktop, /\.customize-card \{[^}]*width: 348px;/);
});

test('on a phone the headers stack, a connector\'s actions drop under its title and the prompts scroll sideways', () => {
  const css = customizeCss();
  const phone = mediaBodies(css, PHONE);
  assert.match(phone, /:is\(\.customize-page-header, \.customize-category-page-header\) \{\s*flex-direction: column;\s*align-items: stretch;/);
  assert.match(phone, /\.customize-header-actions \.customize-search-container \{\s*flex: 1 1 auto;\s*width: auto;\s*min-width: 0;/);
  assert.match(phone, /\.customize-category-page-header \.customize-search-container \{\s*width: 100%;/);
  assert.match(phone, /\.app-header-main \{\s*flex-direction: column;/);
  // Edge to edge: the row bleeds over the page's 16px inline padding and pads it back.
  assert.match(phone, /\.prompts-row \{\s*display: flex;\s*width: auto;\s*margin-inline: -16px;\s*padding-inline: 16px;\s*overflow-x: auto;/);
  assert.match(phone, /\.prompt-card \{\s*flex: none;\s*width: 200px;/);
  assert.match(phone, /\.related-apps-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(withoutMedia(css), /\.customize-page-root \{[^}]*padding-inline: 16px;/);

  const desktop = withoutMedia(css);
  assert.match(desktop, /\.customize-search-container \{[^}]*width: 230px;/);
  assert.match(desktop, /\.prompts-row \{[^}]*grid-template-columns: repeat\(3, minmax\(0px, 1fr\)\);/);
  assert.match(desktop, /\.related-apps-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0px, 1fr\)\);/);

  // Every phone rule is scoped to the page: the detail and editor views' class names are generic.
  const selectors = phone.split('}').map((chunk) => chunk.slice(0, chunk.indexOf('{')).trim()).filter(Boolean);
  assert.ok(selectors.length > 0);
  for (const selector of selectors) assert.match(selector, /^\.customize-page-root /, `${selector} is not scoped to Customize`);
});

test('below 961px the card menu and the Create menu are bottom sheets that finish their exit', () => {
  const menu = customize('CustomizeCardMenu.tsx');
  assert.match(menu, /import \{ GeminiBottomSheet, GeminiSheetItem, GeminiSheetList \} from '@willow\/ui\/GeminiBottomSheet';/);
  assert.match(menu, /if \(isCompact\) \{[\s\S]*<GeminiBottomSheet isOpen=\{isOpen\}/);
  assert.match(menu, /className=\{`customize-card-menu-panel \$\{isClosing \? 'is-closing' : 'is-open'\}`\}/);
  // The sheet takes Escape itself; the dropdown's listener stands down so it is not closed twice.
  assert.match(menu, /useEffect\(\(\) => \{\s*\/\/ The sheet takes Escape itself\.\s*if \(isCompact\) return;/);

  // The menu stays mounted for as long as the sheet takes to leave.
  const [, compactMs, desktopMs] = menu.match(/cardMenuExitMs = \(isCompact: boolean\) => \(isCompact \? (\d+) : (\d+)\);/);
  const sheetUnmountMs = Number(read('platform', 'ui', 'src', 'GeminiBottomSheet.tsx').match(/const UNMOUNT_MS = (\d+);/)[1]);
  assert.ok(Number(compactMs) >= sheetUnmountMs, 'the card menu unmounts before its sheet has slid out');
  assert.equal(Number(desktopMs), 125, 'the dropdown keeps its 125ms exit');
  for (const file of ['CustomizeView.tsx', 'CustomizeDetailView.tsx']) {
    assert.match(customize(file), /\}, cardMenuExitMs\(isCompact\)\);/, `${file} closes its card menu on the desktop timing`);
  }

  const view = customize('CustomizeView.tsx');
  assert.match(view, /\{!isCompact && createMenuState !== 'closed' && \(/);
  assert.match(view, /<GeminiBottomSheet\s+isOpen=\{isCompact && createMenuState === 'open'\}/);
  // A sheet tap would otherwise count as a click outside the dropdown and close it mid-tap.
  assert.match(view, /if \(createMenuState !== 'open' \|\| isCompact\) return;/);
});

test('Customize\'s confirmations take the mobile message panel, which scrolls if it outgrows the screen', () => {
  for (const file of ['CustomizeView.tsx', 'CustomizeDetailView.tsx']) {
    const source = customize(file);
    const dialogs = source.split(/<GeminiDialog\s/).slice(1).map((rest) => rest.slice(0, rest.indexOf('onDismiss')));
    assert.ok(dialogs.length > 0);
    for (const props of dialogs) assert.match(props, /\n\s+message\n/, `a dialog in ${file} is not a message dialog`);
  }
  const dialogCss = stripComments(read('platform', 'ui', 'src', 'GeminiDialog.css'));
  const narrow = mediaBodies(dialogCss, NARROW);
  assert.match(narrow, /\.willow-gdlg-surface \{\s*max-height: 100%;/);
  assert.match(
    narrow,
    /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-gdlg-surface--message \.willow-gdlg-pill--text \{\s*background: rgb\(242, 240, 240\);/,
  );
  assert.doesNotMatch(withoutMedia(dialogCss), /max-height/);
});
