/**
 * Customize on tablets and phones, as gemini.google.com/customize draws it at 800x1280 and 390x844.
 *
 * Gemini changes two things at two widths: below 960px Lumi's tokens take their narrow values (#141414 surfaces,
 * #e0e0e0 text, #1c1c1c menus) and the search field grows to 48px; at 768px and below the layout changes (tabs
 * scroll in a 16px band, the header's search and buttons move to the top bar, one column of cards, back rows of
 * 48px with 16px above and below, the details page's sections lose their own padding). Menus stay dropdowns at
 * every size. The desktop layout is pinned too, since the narrow rules must leave it alone.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const customize = (...file) => read('apps', 'studio', 'src', 'customize', ...file);
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

/** Each `selector { body }` of a block, outermost rules only. */
const rules = (css) => {
  const out = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    if (open === -1) break;
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    out.push({ selector: css.slice(at, open).trim(), body: css.slice(open + 1, i - 1) });
    at = i;
  }
  return out;
};

const TOKENS = '(max-width: 959.98px)';
const LAYOUT = '(max-width: 768px)';
const DARK = ':where(:root:not(.light-theme))';

test('the shell keeps only its menu button over Customize at 768px and below', () => {
  const layout = read('apps', 'studio', 'src', 'shell', 'StudioLayout.tsx');
  const at = layout.search(/\(currentView === 'notebooks' \|\| currentView === 'notebook-create' \|\| currentView === 'gems' \|\| currentView === 'customize'(?: \|\| currentView === '[a-z-]+')*\) && \(/);
  assert.ok(at !== -1, 'Customize is missing from the narrow top bar');
  const bar = layout.slice(at, layout.indexOf('</>', at));
  // Between 769px and 960px the wordmark stays; below, the page's search and "+" take the bar's right side.
  assert.match(bar, /min-\[961px\]:hidden absolute top-\[14px\] left-\[56px\] z-30 flex items-center\$\{currentView === 'customize' \? ' max-\[768px\]:hidden' : ''\}/);
  assert.match(bar, /currentView !== 'customize' && \(\s*<div className="min-\[961px\]:hidden absolute top-\[14px\] right-\[12px\]/);
});

test('below 960px the page hangs under the 68px bar and takes Lumi\'s narrow tokens, in the dark theme only', () => {
  const css = customizeCss();
  const narrow = mediaBodies(css, TOKENS);
  assert.match(narrow, /\.customize-page-root \{\s*height: calc\(100% - 68px\);\s*margin-top: 68px;\s*\}/);
  assert.match(narrow, /\.customize-page-root \.customize-search-container \{\s*height: 48px;/);
  assert.match(narrow, /\.customize-page-root \.customize-search-icon \{\s*width: 24px !important;\s*height: 24px !important;/);

  // Every colour in the block is the dark theme's; the light sheet keeps its own at every width.
  for (const { selector, body } of rules(narrow)) {
    if (/(?:^|[\s;])(?:color|background(?:-color)?|border-color):/.test(body)) {
      assert.ok(selector.startsWith(DARK), `${selector} paints without the dark-theme guard`);
    }
  }
  assert.match(narrow, /\.customize-nav-button\.selected,[\s\S]*?\) \{\s*background-color: #141414;/);
  assert.match(narrow, /:is\(\.app-icon-container, \.related-app-icon-container\) \{\s*background: #000;\s*border-color: #141414;/);
  assert.match(narrow, /:is\(\.customize-card-menu-panel, \.customize-create-menu-panel\) \{\s*background-color: #1c1c1c;/);
  assert.match(narrow, /\.save-button:disabled \{\s*background-color: rgba\(224, 224, 224, 0\.12\);/);

  const desktop = withoutMedia(css);
  assert.doesNotMatch(desktop.match(/\.customize-page-root \{[^}]*\}/)[0], /margin-top/);
  assert.match(desktop, /\.customize-search-container \{[^}]*width: 230px;[^}]*height: 36px;/);
  assert.match(desktop, /\.customize-card-menu-panel \{[^}]*min-width: 112px;[^}]*background-color: #1f1f1f;/);
});

test('at 768px and below the tabs scroll, the header gives its controls to the top bar and the cards make one column', () => {
  const css = customizeCss();
  const phone = mediaBodies(css, LAYOUT);
  assert.match(phone, /\.customize-nav-buttons \{\s*flex-wrap: nowrap;\s*overflow-x: auto;\s*overscroll-behavior-x: contain;\s*padding-block: 16px;/);
  assert.match(phone, /\.customize-nav-buttons \.customize-nav-button \{\s*flex-shrink: 0;\s*height: 40px;/);
  assert.match(phone, /\.customize-page-header \{\s*margin-bottom: 16px;\s*padding-inline: 8px;/);
  assert.match(phone, /\.customize-header-actions :is\(\.customize-search-container, \.customize-custom-button\),\s*\.customize-create-dropdown-container > \.customize-create-button \{\s*display: none;/);
  assert.match(phone, /\.customize-category-header \{\s*min-height: 48px;\s*padding-left: 8px;/);
  assert.match(phone, /\.customize-card \{\s*width: 100%;\s*border-radius: 16px;\s*padding: 8px 16px 8px 8px;/);

  const actions = stripComments(customize('CustomizeMobileActions.css'));
  const top = mediaBodies(actions, LAYOUT);
  assert.match(top, /\.customize-mobile-actions \{[^}]*position: fixed;[^}]*top: 12px;[^}]*right: 16px;/);

  const desktop = withoutMedia(css);
  assert.match(desktop, /\.customize-nav-buttons \{[^}]*padding-block: 16px 72px;/);
  assert.match(desktop, /\.customize-card \{[^}]*width: 348px;/);
  assert.match(desktop, /grid-template-columns: 348px 348px;/);
});

test('back rows open every page behind a card: 36px with 8px over and 12px under, 48px with 16px either side on a phone', () => {
  const css = customizeCss();
  const desktop = withoutMedia(css);
  assert.match(desktop, /\.back-button,\s*\.back-to-skills-btn,\s*\.customize-category-back-button \{[^}]*gap: 12px;\s*height: 32px;\s*padding: 0 16px 0 12px;[^}]*font-size: 17px;\s*line-height: 24px;\s*font-weight: 370;/);
  assert.match(desktop, /\.top-nav-bar \{[^}]*flex: none;[^}]*min-height: 36px;\s*padding: 8px 0 12px;\s*box-sizing: content-box;/);
  assert.match(desktop, /\.manager-header \{[^}]*flex: none;[^}]*min-height: 36px;\s*padding: 8px 0 12px;\s*box-sizing: content-box;/);
  assert.match(desktop, /\.customize-category-top-nav \{\s*flex: none;[^}]*min-height: 36px;\s*padding: 8px 0 48px;/);

  const phone = mediaBodies(css, LAYOUT);
  assert.match(phone, /\.customize-page-root :is\(\.customize-category-top-nav, \.top-nav-bar, \.manager-header\) \{\s*padding-block: 16px;/);
  assert.match(phone, /\.customize-page-root :is\(\.back-button, \.back-to-skills-btn, \.customize-category-back-button\) \{\s*min-height: 48px;/);

  for (const file of ['CustomizeDetailView.tsx', 'CustomizeCategoryView.tsx', 'custom-app/CustomAppDetail.tsx']) {
    assert.match(customize(...file.split('/')), /<LmIcon name="arrow_back" size=\{20\} className="back-icon" \/>/, file);
  }
});

test('a connector\'s page loses its section padding on a phone and lists its prompts in one column', () => {
  const css = customizeCss();
  const phone = mediaBodies(css, LAYOUT);
  assert.match(phone, /\.customize-page-root \.details-content-column \{\s*padding-inline: 8px;/);
  assert.match(phone, /\.app-header,\s*\.prompts-section,\s*\.capabilities-section,\s*\.info-section,/);
  assert.match(phone, /\.customize-page-root \.prompts-row \{\s*grid-template-columns: 1fr;/);
  assert.match(phone, /\.customize-page-root \.related-app-card \{\s*padding: 0;/);

  const desktop = withoutMedia(css);
  assert.match(desktop, /\.details-content-column \{[^}]*max-width: 708px;[^}]*padding: 32px 0 48px;/);
  assert.match(desktop, /\.prompts-section \{[^}]*padding-inline: 16px;/);
  assert.match(desktop, /\.prompts-row \{[^}]*grid-template-columns: repeat\(3, minmax\(0px, 1fr\)\);/);
  assert.match(desktop, /\.section-title \{\s*font-size: 17px;\s*line-height: 24px;/);
  assert.match(desktop, /\.app-title-row \{[^}]*flex-wrap: wrap;/);

  // Gemini lists what a connector can do before its prompts.
  const detail = customize('CustomizeDetailView.tsx');
  assert.ok(detail.indexOf('className="capabilities-section"') < detail.indexOf('className="prompts-section"'));
  // Connected: an accent Disconnect and ⋯ (whose menu has only Use now); not connected: Connect.
  assert.match(detail, /aria-label=\{`Disconnect \$\{item\.title\}`\}\s*onClick=\{handleDisconnectClick\}/);
  assert.match(detail, /aria-label=\{`Connect \$\{item\.title\}`\}/);
});

test('menus stay dropdowns at every size, sized by their rows', () => {
  const menu = customize('CustomizeCardMenu.tsx');
  assert.doesNotMatch(menu, /GeminiBottomSheet/);
  assert.match(menu, /export const cardMenuExitMs = \(_isCompact\?: boolean\) => 125;/);
  assert.match(menu, /\.\.\.\(onDisconnect\s*\?/, 'Disconnect is left out where the page header already has it');
  const view = customize('CustomizeView.tsx');
  assert.doesNotMatch(view, /GeminiBottomSheet/);
  assert.match(view, /onDisconnect=\{cardMenu\.onPage \? undefined : handleDisconnectClick\}/);

  const desktop = withoutMedia(customizeCss());
  // lm-menu-item-theme: the label (body-s) 32px after the 16px glyph.
  assert.match(desktop, /\.customize-card-menu-item \{[^}]*gap: 16px;[^}]*padding: 0 8px;[^}]*font-size: 13px;\s*line-height: 17px;/);
  assert.match(desktop, /\.customize-create-menu-item \{[^}]*font-size: 13px;[^}]*line-height: 17px;/);
});

test('the skill editor stretches to 140px above the page\'s end and validates on Create', () => {
  const desktop = withoutMedia(customizeCss());
  assert.match(desktop, /\.skill-folder-manager \{[^}]*flex: 1 0 auto;[^}]*padding-bottom: 140px;/);
  assert.match(desktop, /\.editor-actions \{[^}]*gap: 4px;/);
  assert.match(desktop, /\.save-button \{\s*height: 36px;\s*padding: 0 12px;/);
  assert.match(desktop, /\.content-editable \{[^}]*flex: 1 0 auto;\s*min-height: 431\.6px;/);
  assert.match(desktop, /\.description-text \{[^}]*resize: none;\s*field-sizing: content;/);
  assert.match(desktop, /\.skill-folder-manager \.error-message \{\s*color: #f2b8b5;\s*margin-top: 4px;\s*margin-inline-start: 16px;/);

  const detail = customize('CustomizeDetailView.tsx');
  assert.match(detail, /disabled=\{isEditing && !isDirty\}/, 'Create is always pressable; Save once something changed');
  assert.match(detail, /if \(!canSubmit\) \{\s*setValidated\(true\);\s*return;\s*\}/);
});

test('Customize\'s confirmations take the mobile message panel, which scrolls if it outgrows the screen', () => {
  for (const file of ['CustomizeView.tsx', 'CustomizeDetailView.tsx']) {
    const source = customize(file);
    const dialogs = source.split(/<GeminiDialog\s/).slice(1).map((rest) => rest.slice(0, rest.indexOf('onDismiss')));
    assert.ok(dialogs.length > 0);
    for (const props of dialogs) assert.match(props, /\n\s+message\n/, `a dialog in ${file} is not a message dialog`);
  }
  const dialogCss = stripComments(read('platform', 'ui', 'src', 'GeminiDialog.css'));
  const narrow = mediaBodies(dialogCss, '(max-width: 960px)');
  assert.match(narrow, /\.willow-gdlg-surface \{\s*max-height: 100%;/);
  assert.doesNotMatch(withoutMedia(dialogCss), /max-height/);
});
