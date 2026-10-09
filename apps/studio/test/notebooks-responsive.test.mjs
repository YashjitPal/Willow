/**
 * Notebooks on phones and tablets: the pieces Gemini swaps in below 961px.
 *
 * Every value here was measured off the live Gemini app at 390x844 and 800x1280 through
 * CDP (computed styles and geometry, opening and cancelling UI only). Gemini's layout
 * breakpoint is 959.98px, so the rules live in `(max-width: 960px)` blocks, with the
 * card rows splitting again at 600px and the snackbar at 480px. The desktop layout was
 * matched separately and must not move, so the last test pins that none of these
 * narrow-only rules reaches the desktop cascade.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const notebooksDir = path.join(repoRoot, 'features', 'notebooks', 'src');
const read = (file) => fs.readFileSync(path.join(notebooksDir, file), 'utf8');
const readRepo = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
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

/** The declarations of the first rule whose selector list is exactly `selector`. */
const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
};

const css = stripComments(read('notebooks.css'));
const narrow = mediaBodies(css, '(max-width: 960px)');

test('the all-notebooks grid takes the narrow header, card grid and one touch trigger', () => {
  assert.match(rule(narrow, '.nb-grid-page'), /margin-top:\s*68px/);
  assert.match(rule(narrow, '.nb-card-grid'), /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*1fr\)\)/);
  // The create pill is the workspace accent, passed down as a variable.
  assert.match(rule(narrow, '.nb-grid-create'), /background-color:\s*var\(--nb-grid-create-bg,\s*rgb\(31,\s*59,\s*155\)\)/);

  // At 600px and below the cards become 32px-round rows.
  const rows = mediaBodies(css, '(max-width: 600px)');
  assert.match(rule(rows, '.nb-card'), /flex-direction:\s*row/);
  assert.match(rule(rows, '.nb-card'), /border-radius:\s*32px/);

  // One 36px trigger in a 24px slot replaces the desktop pin + menu pair, and it opens
  // the page's shared menu rather than toggling the pin.
  const page = read('AllNotebooksPage.tsx');
  assert.match(page, /isCompact \? \([\s\S]*?className="nb-card-trigger-slot"/);
  assert.match(page, /onOpenCompactMenu\(rectOf\(event\.currentTarget\)\)/);
  assert.match(page, /<NotebookActionsMenu target=\{compactMenu\} onClose=\{\(\) => setCompactMenu\(null\)\} \/>/);
});

test('the notebook page docks its composer and drops the sticky header below 961px', () => {
  assert.match(rule(narrow, '.nb-page-host'), /margin-top:\s*68px/);
  const composer = rule(narrow, '.nb-page-composer');
  assert.match(composer, /position:\s*sticky/);
  assert.match(composer, /bottom:\s*0/);
  assert.match(rule(narrow, '.nb-page-header'), /position:\s*static/);
  // The shell's top-bar model picker is shown here too, as on a new chat.
  assert.match(read('NotebookPage.tsx'), /<div className="nb-page-model">\{renderModelPicker\(\)\}<\/div>/);
});

test('notebook menus use gem-menu\'s narrow rows and stay flush with their trigger', () => {
  assert.match(rule(narrow, '.nb-menu-item'), /height:\s*40px/);
  assert.match(rule(narrow, '.nb-menu-label'), /font-size:\s*17px/);

  const menu = read('NotebookMenu.tsx');
  assert.match(menu, /const glyph = isCompact \? \{ size: 24, weight: 300 \} : \{ size: 20, weight: 320 \}/);
  // Desktop keeps its 8px viewport margin; narrow follows the trigger to the edge.
  assert.match(menu, /right: isCompact\s*\? window\.innerWidth - \(anchor\.x \+ anchor\.w\)\s*: Math\.max\(8, window\.innerWidth - \(anchor\.x \+ anchor\.w\)\)/);
  // The drawer's menu hangs from the trigger's left edge and is pushed back on screen.
  assert.match(menu, /Math\.round\(Math\.min\(anchor\.x, document\.documentElement\.clientWidth - width\)\)/);
  assert.match(menu, /const width = panelRef\.current\.offsetWidth;/);
});

test('the drawer lists two notebooks with always-visible triggers and its own tinted menu', () => {
  const section = read('NotebooksSection.tsx');
  assert.match(section, /const COMPACT_NOTEBOOK_LIMIT = 2;/);
  assert.match(section, /notebooks\.slice\(0, isCompact \? COMPACT_NOTEBOOK_LIMIT : SIDEBAR_NOTEBOOK_LIMIT\)/);
  // The pin stands in for the three dots while pinned; both open the same menu.
  assert.match(section, /name=\{notebook\.pinned \? 'push_pin' : 'more_vert'\}/);
  assert.match(section, /align="start"\s+menuClassName="nb-menu--drawer"/);
  // The shell's own menu, when one is wired, still wins.
  assert.match(section, /const hasCompactMenu = isCompact && !onNotebookMenu;/);

  assert.match(rule(narrow, '.nb-menu--drawer .nb-menu-item > .luminous-symbols'), /color:\s*rgb\(196,\s*199,\s*197\)/);
});

test('card and drawer menus share one Pin / Rename / Delete menu and its dialogs', () => {
  const actions = read('NotebookActionsMenu.tsx');
  for (const label of ["menuNotebook.pinned ? 'Unpin' : 'Pin'", "'Rename'", "'Delete'"]) {
    assert.ok(actions.includes(`label: ${label}`), `missing ${label}`);
  }
  assert.doesNotMatch(actions, /danger:\s*true/, 'Gemini does not tint Delete in these menus');
  assert.match(actions, /<RenameNotebookDialog notebook=\{dialogNotebook\}/);
  assert.match(actions, /void deleteNotebookWithFolder\(dialogNotebook\.id\)/);
});

test('sources rows print Gemini\'s format labels for each kind of source', async () => {
  const { fileTypeOf, formatLabel, tileDisplayName } = await importTs(
    path.join(repoRoot, 'platform', 'core', 'src', 'gemini-file-info.ts'),
  );
  // SourceRow gives copied text and websites the MIME types Gemini prints for them.
  const label = (name, mimeType) => formatLabel({ name, mimeType, fileType: fileTypeOf(mimeType, name) });
  assert.equal(label('Copied text', 'text/plain'), 'TXT');
  assert.equal(label('https://en.wikipedia.org/wiki/Electrochemistry', 'text/html'), 'HTML');
  assert.equal(label('Lecture 1.pdf', 'application/pdf'), 'PDF');
  // The name is the tile's own middle truncation, so a row and a tile agree.
  assert.equal(
    tileDisplayName('https://en.wikipedia.org/wiki/Electrochemistry', fileTypeOf('text/html', 'x')),
    'https://en...ochemistry',
  );

  const tile = read('SourceTile.tsx');
  assert.match(tile, /source\.kind === 'text' \? 'text\/plain' : source\.kind === 'website' \? 'text\/html' : ''/);
});

test('the narrow Sources dialog is full screen, with rows and a "+" sheet beside the scrim', () => {
  const dialog = read('NotebookSourcesDialog.tsx');
  assert.match(dialog, /\{isCompact \? \(\s*<div className="nb-src-mobile">/);
  assert.match(dialog, /<SourceRow key=\{source\.id\} source=\{source\} onRemove=/);
  // The sheet's rows, in Gemini's order and with its narrow label for copied text.
  const sheet = dialog.slice(dialog.indexOf('const addSheet'), dialog.indexOf('const isEmpty'));
  const labels = [...sheet.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Upload files', 'Add from Drive', 'Add websites', 'Add text']);
  assert.match(sheet, /name="add" family="luminous" size=\{24\} weight=\{300\}/);

  // A portal's events bubble through React, so the sheet must not sit inside the scrim
  // whose click closes the dialog: it follows the scrim's closing tag.
  const scrimEnd = dialog.lastIndexOf('</SubDialog>');
  assert.ok(dialog.indexOf('<GeminiBottomSheet', scrimEnd) > dialog.indexOf('</div>', scrimEnd));

  const sheetCss = rule(narrow, '.nb-sheet');
  assert.match(sheetCss, /width:\s*100%/);
  assert.match(sheetCss, /border-radius:\s*0/);
  assert.match(rule(narrow, '.nb-src-row'), /padding:\s*16px 20px 16px 12px/);
  assert.match(rule(narrow, '.nb-src-mobile-add-disc'), /translate:\s*0 3\.4px/);
  // Lifted over the Sources scrim, whichever stylesheet loads last.
  assert.match(rule(narrow, '.gemini-bottom-sheet-layer.nb-src-add-sheet'), /z-index:\s*2147483005/);
});

test('the narrow sub-dialogs: an outlined URL field and Gemini\'s own "Add text" layout', () => {
  const dialog = read('NotebookSourcesDialog.tsx');
  assert.match(dialog, /icon=\{isCompact \? 'link' : 'web'\}/);
  // Nothing takes focus on open, so the label rests inside the outline as the prompt.
  const outlined = dialog.slice(dialog.indexOf('<label className="nb-sub-outlined">'), dialog.indexOf('</label>'));
  assert.ok(outlined.length > 0, 'no outlined field');
  assert.doesNotMatch(outlined, /autoFocus/);
  assert.match(outlined, /placeholder=" "/);
  assert.match(dialog, /\{sub === 'text' && isCompact && \(\s*<AddTextDialog/);
  assert.match(dialog, /Paste plain text and Willow will add it as a source\./);

  // Focus or text floats the label into the notch: 12px, centred on the top edge.
  assert.match(narrow, /\.nb-sub-outlined-input:focus \+ \.nb-sub-outlined-label,\s+\.nb-sub-outlined-input:not\(:placeholder-shown\) \+ \.nb-sub-outlined-label\s*\{[^}]*transform:\s*translate\(1\.6px, -25\.5px\) scale\(0\.75\)/);
  assert.match(rule(narrow, '.nb-sub-pill'), /background-color:\s*var\(--nb-accent-bg, rgb\(31, 59, 155\)\)/);
  assert.match(rule(narrow, '.nb-sub-pill:disabled'), /background-color:\s*rgba\(224, 224, 224, 0\.12\)/);
  assert.match(rule(narrow, '.nb-addtext-input'), /height:\s*244px/);
  // Up to 600px wide and edge to edge on a phone.
  assert.match(rule(narrow, '.nb-sub-scrim'), /padding:\s*0/);
});

test('rename, move and settings take the narrow type cuts and phone widths', () => {
  assert.match(rule(narrow, '.nb-ren-emoji-glyph'), /font-size:\s*min\(48px, 10vw\)/);
  assert.match(rule(narrow, '.nb-ren-title'), /"wdth" 94/);
  assert.match(rule(narrow, '.nb-move'), /max-width:\s*calc\(100vw - 44px\)/);
  assert.match(rule(narrow, '.nb-move-title'), /"wdth" 94/);
  assert.match(rule(narrow, '.nb-set-label'), /"wdth" 95/);
  assert.match(rule(narrow, '.nb-set-textarea'), /"wdth" 92/);
  // Both closes are weight-400 Google Symbols below 961px.
  for (const file of ['RenameNotebookDialog.tsx', 'MoveChatDialog.tsx']) {
    assert.match(read(file), /family="google-symbols" size=\{24\} weight=\{isCompact \? 400 : undefined\}/, file);
  }
});

test('the snackbar takes the narrow tokens and spans a phone', () => {
  const snack = rule(narrow, '.nb-snack');
  assert.match(snack, /background-color:\s*rgb\(28, 28, 28\)/);
  assert.match(snack, /color:\s*rgb\(224, 224, 224\)/);
  const phone = mediaBodies(css, '(max-width: 480px)');
  assert.match(rule(phone, '.nb-snack'), /min-width:\s*100%/);
});

test('the notebook list and create screens carry the Willow wordmark and a New chat button', () => {
  const layout = readRepo('apps/studio/src/shell/StudioLayout.tsx');
  const start = layout.indexOf("(currentView === 'notebooks' || currentView === 'notebook-create'");
  assert.ok(start >= 0, 'no notebooks top bar');
  const bar = layout.slice(start);
  assert.match(bar, /min-\[961px\]:hidden absolute top-\[14px\] left-\[56px\]/);
  assert.match(bar, /<span className="studio-mobile-wordmark-text">Willow<\/span>/);
  assert.match(bar, /min-\[961px\]:hidden absolute top-\[14px\] right-\[12px\]/);

  const sidebarCss = stripComments(readRepo('apps/studio/src/shell/sidebar/Sidebar.css'));
  const wordmark = rule(mediaBodies(sidebarCss, '(max-width: 960px)'), '.studio-mobile-wordmark-text');
  assert.match(wordmark, /font-size:\s*18px/);
  assert.match(wordmark, /transform:\s*scale\(0\.888888\)/);
});

test('notebook copy names Willow, not Gemini', () => {
  assert.doesNotMatch(read('NotebookSettingsDialog.tsx'), /(Tell|how) Gemini /);
  assert.doesNotMatch(read('DeleteNotebookDialog.tsx'), /Gemini Apps/);
  assert.match(read('NotebookSourcesDialog.tsx'), /Add files that Willow can reference in your notebook/);
});

test('shared pieces: the message dialog, the sheet\'s layer class and glyph slot', () => {
  const gdlg = readRepo('platform/ui/src/GeminiDialog.tsx');
  assert.match(gdlg, /message \? ' willow-gdlg-surface--message' : ''/);
  const gdlgCss = stripComments(readRepo('platform/ui/src/GeminiDialog.css'));
  assert.match(rule(mediaBodies(gdlgCss, '(max-width: 960px)'), '.willow-gdlg-surface--message'), /max-width:\s*332px/);
  assert.match(read('DeleteNotebookDialog.tsx'), /width=\{512\}\s+message/);

  const sheet = readRepo('platform/ui/src/GeminiBottomSheet.tsx');
  assert.match(sheet, /className=\{`gemini-bottom-sheet-layer\$\{className \? ` \$\{className\}` : ''\}`\}/);
  assert.match(sheet, /\{glyph \?\? \(icon && \(/);
});

test('none of the narrow-only rules reaches the desktop cascade', () => {
  const desktop = withoutMedia(css);
  for (const selector of [
    '.nb-src-mobile', '.nb-src-row', '.nb-src-add-sheet', '.nb-sub-outlined', '.nb-sub-pill',
    '.nb-addtext', '.nb-menu--drawer', '.nb-card-trigger-slot',
  ]) {
    assert.ok(!desktop.includes(selector), `${selector} leaks into the desktop cascade`);
  }
  // The desktop values the narrow blocks override are still the desktop's.
  assert.match(rule(desktop, '.nb-sheet'), /width:\s*887px/);
  assert.match(rule(desktop, '.nb-sub-scrim'), /padding:\s*24px/);
  assert.match(rule(desktop, '.nb-move-scrim'), /padding:\s*24px/);
  assert.match(rule(desktop, '.nb-snack'), /min-width:\s*344px/);
  assert.match(rule(desktop, '.nb-ren-emoji-glyph'), /font-size:\s*36px/);
});
