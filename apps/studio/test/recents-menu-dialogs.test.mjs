/**
 * The Recents row's three-dot menu and the two dialogs it raises, pinned to what
 * was measured off the live Gemini app over CDP so a later tidy-up cannot quietly
 * drift them.
 *
 * Capture conditions: gemini.google.com, dpr 1.25, zoom 1. The menu and the first
 * dialog pass ran at viewport 1419x826, a later confirmation pass at 1536x826;
 * every content-derived width reproduced identically across both, which is how we
 * know they are content-derived rather than authored.
 *
 * The measurements this file guards:
 *
 *   Menu pane      content-derived width between min 150 and max 280 (measured
 *                  179.26 = the widest row's 40 + 115.26 + 8, plus 2x8 padding),
 *                  bg rgb(31,31,31), radius 20, padding 8, shadow
 *                  rgba(0,0,0,0.28) 0 0 20px 0, no border. Butts against the
 *                  trigger with NO gap in either direction; transform-origin
 *                  measured `0px 0px` opening down and `0px <height>px` opening
 *                  up.
 *   Menu rows      5, each 36 tall, icons from the Luminous Symbols family at
 *                  20/320/100/20 — `share_2`, `push_pin`/`unpin`, `edit`,
 *                  `notebook`, `delete`. Gemini's icon names live in
 *                  `data-mat-icon-name`, never in the MAT-ICON's text.
 *   Menu motion    enter `_mat-menu-enter` 120ms cubic-bezier(0,0,0.2,1),
 *                  scale(0.8)+opacity 0 -> none+1; exit `_mat-menu-exit` 100ms
 *                  linear with a 25ms delay, opacity only, no transform.
 *   Rename dialog  512x213, H2 title, inner content padded `24px 0 0` above a
 *                  452x56 outlined field, Rename pill DISABLED at open.
 *   Delete dialog  600 wide, H1 title, body flush under the content padding,
 *                  BOTH pills rgb(23,23,23) and both enabled.
 *   Dialog motion  surface scales in on a 150ms transition and never animates
 *                  out; only the backdrop fades, and the node is removed 75ms in.
 *
 * A deliberate divergence, recorded here so it reads as a decision and not a
 * miss: Gemini's Delete body names "your Gemini Apps Activity" and carries a
 * "Learn more" link to support.google.com/gemini?p=deleted_chats. Willow deletes
 * one local chat file, has no activity store and no support page, so the sentence
 * says what is actually deleted and the link is dropped. Everything measurable
 * about the dialog — width, chrome, type, padding, pills — is unchanged.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');
const sidebarCss = read('apps/studio/src/shell/sidebar/Sidebar.css');
const row = read('apps/studio/src/shell/sidebar/RecentChatRow.tsx');
const dialog = read('platform/ui/src/GeminiDialog.tsx');
const dialogCss = read('platform/ui/src/GeminiDialog.css');

/** Strip comments so a measured value quoted in prose cannot satisfy a match. */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const sidebarCode = codeOnly(sidebar);
const sidebarCssCode = codeOnly(sidebarCss);
const rowCode = codeOnly(row);
const dialogCode = codeOnly(dialog);
const dialogCssCode = codeOnly(dialogCss);

// --- The menu pane ---------------------------------------------------------

test('the menu pane keeps the measured card chrome and its content-derived width', () => {
  const pane = sidebarCode.slice(
    sidebarCode.indexOf('fixed z-[9999]'),
    sidebarCode.indexOf('Share conversation'),
  );
  assert.ok(pane.length > 0, 'could not locate the menu pane');
  // Width is bounded, never pinned — the pane shrink-wraps its widest row.
  assert.match(pane, /min-w-\[150px\]/);
  assert.match(pane, /max-w-\[280px\]/);
  // Negative lookbehind, or `max-w-[280px]` satisfies this itself.
  assert.doesNotMatch(pane, /(?<![-\w])w-\[\d/, 'the pane must not author a fixed width');
  assert.match(pane, /rounded-\[20px\]/);
  assert.match(pane, /bg-\[#1f1f1f\]/);
  assert.match(pane, /\bp-2\b/);
  assert.match(pane, /shadow-\[0_0_20px_rgba\(0,0,0,0\.28\)\]/);
  assert.doesNotMatch(pane, /\bborder-\[/, 'the measured pane has no border');
});

test('the pane butts against the trigger with no gap, in both directions', () => {
  // Measured: opening down, pane.y === trigger.bottom; opening up,
  // pane.bottom === trigger.top. Anchoring the upward case by `bottom` avoids
  // guessing a height that is content-derived.
  assert.match(sidebarCode, /top:\s*isAbove\s*\?\s*undefined\s*:\s*rect\.bottom/);
  assert.match(sidebarCode, /bottom:\s*isAbove\s*\?\s*window\.innerHeight\s*-\s*rect\.top\s*:\s*undefined/);
  assert.match(sidebarCode, /left:\s*rect\.left/);
  // transform-origin follows the corner nearest the trigger.
  assert.match(sidebarCode, /origin-bottom-left/);
  assert.match(sidebarCode, /origin-top-left/);
});

test('the five measured rows are present, in order, with their measured glyphs', () => {
  const pane = sidebarCode.slice(sidebarCode.indexOf('fixed z-[9999]'));
  const order = ['share_2', 'push_pin', 'edit', 'notebook', 'delete'];
  let cursor = 0;
  for (const glyph of order) {
    const at = pane.indexOf(`name="${glyph}"`) >= 0 ? pane.indexOf(`name="${glyph}"`) : pane.indexOf(`'${glyph}'`);
    assert.ok(at > cursor, `expected ${glyph} after the previous row`);
    cursor = at;
  }
  // Pin flips glyph AND label with the pinned state — measured `unpin` when set.
  assert.match(pane, /'unpin'\s*:\s*'push_pin'/);
  assert.match(pane, /\?\s*'Unpin'\s*:\s*'Pin'/);
  for (const label of ['Share conversation', 'Rename', 'Add to notebook', 'Delete']) {
    assert.ok(pane.includes(label), `missing row label ${label}`);
  }
});

test('every row icon carries the measured Luminous Symbols axes', () => {
  const pane = sidebarCode.slice(sidebarCode.indexOf('fixed z-[9999]'));
  const icons = pane.match(/<MaterialSymbol[\s\S]*?\/>/g) ?? [];
  assert.equal(icons.length, 5, 'expected exactly five row icons');
  for (const icon of icons) {
    assert.match(icon, /family="luminous"/);
    assert.match(icon, /size=\{20\}/);
    assert.match(icon, /weight=\{320\}/);
    assert.match(icon, /roundness=\{100\}/);
    assert.match(icon, /opticalSize=\{20\}/);
  }
});

test('rows are 36 tall with the measured label type', () => {
  // h-9 === 36px. Label 13px/17px 400 in rgb(230,230,230).
  const item = sidebarCode.slice(
    sidebarCode.indexOf('GEMINI_MENU_ITEM_CLASS ='),
    sidebarCode.indexOf('GEMINI_MENU_LABEL_CLASS ='),
  );
  assert.ok(item.length > 0, 'could not locate GEMINI_MENU_ITEM_CLASS');
  assert.match(item, /\bh-9\b/);
  assert.match(item, /text-\[13px\]/);
  assert.match(item, /leading-\[17px\]/);
  assert.match(item, /text-\[#e6e6e6\]/);
});

// --- Menu motion -----------------------------------------------------------

test('the menu enter and exit match Material’s measured pair', () => {
  const enter = sidebarCssCode.slice(
    sidebarCssCode.indexOf('@keyframes willow-mat-menu-enter'),
    sidebarCssCode.indexOf('@keyframes willow-mat-menu-exit'),
  );
  assert.match(enter, /opacity:\s*0;\s*transform:\s*scale\(0\.8\)/);
  assert.match(enter, /opacity:\s*1;\s*transform:\s*none/);

  const exit = sidebarCssCode.slice(sidebarCssCode.indexOf('@keyframes willow-mat-menu-exit'));
  // Measured exit is a pure opacity fade — no transform at all.
  assert.doesNotMatch(
    exit.slice(0, exit.indexOf('.willow-mat-menu-enter')),
    /transform/,
    'the measured exit has no transform',
  );

  assert.match(sidebarCssCode, /\.willow-mat-menu-enter\s*\{[^}]*120ms cubic-bezier\(0,\s*0,\s*0\.2,\s*1\)/);
  assert.match(sidebarCssCode, /\.willow-mat-menu-exit\s*\{[^}]*100ms linear 25ms forwards/);
});

test('the close hold covers the exit animation plus its measured delay', () => {
  // 100ms linear + 25ms delay = the node is gone by 125ms.
  const close = sidebarCode.slice(
    sidebarCode.indexOf('const triggerCloseMenu'),
    sidebarCode.indexOf('const openRenameDialog'),
  );
  assert.ok(close.length > 0, 'could not locate triggerCloseMenu');
  assert.match(close, /\}, 125\);/);
});

// --- The dialog shell ------------------------------------------------------

test('the dialog surface scales in on a transition and never animates out', () => {
  const surface = dialogCssCode.slice(
    dialogCssCode.indexOf('.willow-gdlg-surface {'),
    dialogCssCode.indexOf('.willow-gdlg-title'),
  );
  assert.ok(surface.length > 0, 'could not locate the surface rule');
  assert.match(surface, /border-radius:\s*32px/);
  assert.match(surface, /background:\s*rgb\(31,\s*31,\s*31\)/);
  assert.match(surface, /box-shadow:\s*rgba\(0,\s*0,\s*0,\s*0\.28\)\s*0\s*0\s*20px\s*0/);
  assert.match(surface, /transform:\s*scale\(0\.8\)/);
  assert.match(surface, /transition:\s*transform 150ms cubic-bezier\(0,\s*0,\s*0\.2,\s*1\)/);
  // Opacity was 1 in every sampled frame, opening AND closing.
  assert.doesNotMatch(surface, /opacity/, 'the measured surface never changes opacity');
  // `closing` must reach the backdrop only — the surface has no closing state.
  assert.match(dialogCode, /willow-gdlg-backdrop\$\{shown && !closing/);
  assert.match(dialogCode, /willow-gdlg-surface\$\{shown \?/);
});

test('the backdrop is the measured flat 32% black with no blur', () => {
  const backdrop = dialogCssCode.slice(
    dialogCssCode.indexOf('.willow-gdlg-backdrop {'),
    dialogCssCode.indexOf('.willow-gdlg-backdrop--shown'),
  );
  assert.match(backdrop, /background:\s*rgba\(0,\s*0,\s*0,\s*0\.32\)/);
  assert.match(backdrop, /transition:\s*opacity 0\.4s cubic-bezier\(0\.25,\s*0\.8,\s*0\.25,\s*1\)/);
  assert.doesNotMatch(backdrop, /backdrop-filter/, 'there is no blur behind a Gemini dialog');
});

test('the scale-in starts a frame after mount, or it would never be seen', () => {
  assert.match(dialogCode, /requestAnimationFrame\(\(\) => setShown\(true\)\)/);
});

test('title and content keep the measured padding and type', () => {
  const title = dialogCssCode.slice(
    dialogCssCode.indexOf('.willow-gdlg-title'),
    dialogCssCode.indexOf('.willow-gdlg-content {'),
  );
  assert.match(title, /padding:\s*24px 24px 0/);
  assert.match(title, /margin:\s*0 0 1px/);
  assert.match(title, /font-size:\s*20px/);
  assert.match(title, /line-height:\s*24px/);
  assert.match(title, /font-weight:\s*470/);
  // The title is the one node NOT on the body's width axis.
  assert.match(title, /font-variation-settings:\s*"ROND" 20,\s*"slnt" 0,\s*"wdth" 94,\s*"wght" 470/);

  const content = dialogCssCode.slice(
    dialogCssCode.indexOf('.willow-gdlg-content {'),
    dialogCssCode.indexOf('.willow-gdlg-link'),
  );
  assert.match(content, /padding:\s*16px 24px 0/);
  assert.match(content, /font-size:\s*15px/);
  assert.match(content, /line-height:\s*20px/);
  assert.match(content, /font-variation-settings:\s*"ROND" 0,\s*"slnt" 0,\s*"wdth" 92,\s*"wght" 400/);
});

test('the action row and pills match, and pill width stays content-derived', () => {
  const actions = dialogCssCode.slice(
    dialogCssCode.indexOf('.willow-gdlg-actions'),
    dialogCssCode.indexOf('.willow-gdlg-pill {'),
  );
  assert.match(actions, /justify-content:\s*flex-end/);
  assert.match(actions, /gap:\s*8px/);
  assert.match(actions, /padding:\s*16px/);

  const pill = dialogCssCode.slice(
    dialogCssCode.indexOf('.willow-gdlg-pill {'),
    dialogCssCode.indexOf('.willow-gdlg-pill:disabled'),
  );
  assert.match(pill, /height:\s*36px/);
  assert.match(pill, /padding:\s*0 12px/);
  assert.match(pill, /background:\s*rgb\(23,\s*23,\s*23\)/);
  assert.match(pill, /font-size:\s*14px/);
  assert.match(pill, /font-weight:\s*500/);
  // Cancel 70.72 = 12 + 46.73 + 12, Rename 78.93 = 12 + 54.92 + 12 — so the
  // width follows the label and must not be authored. `\bwidth:` would match
  // `min-width`, so anchor on the property name itself.
  assert.doesNotMatch(pill, /(?<!min-)width:\s*\d/, 'pill width is content-derived');
  assert.match(pill, /min-width:\s*0/);

  const disabled = dialogCssCode.slice(dialogCssCode.indexOf('.willow-gdlg-pill:disabled'));
  assert.match(disabled, /background:\s*rgba\(230,\s*230,\s*230,\s*0\.12\)/);
  assert.match(disabled, /color:\s*rgba\(230,\s*230,\s*230,\s*0\.38\)/);
  // The hover tint is the persistent ripple, not the button background.
  assert.match(dialogCssCode, /\.willow-gdlg-pill:not\(:disabled\):hover::before\s*\{\s*opacity:\s*0\.08/);
});

test('the outlined field walks the three measured border states', () => {
  const outline = dialogCssCode.slice(
    dialogCssCode.indexOf('.willow-gdlg-field__outline'),
    dialogCssCode.indexOf('.willow-gdlg-field__input'),
  );
  assert.match(outline, /border:\s*0\.8px solid rgb\(142,\s*145,\s*143\)/);
  assert.match(outline, /border-radius:\s*4px/);
  assert.match(outline, /:hover \.willow-gdlg-field__outline\s*\{\s*border-color:\s*rgb\(230,\s*230,\s*230\)/);
  assert.match(outline, /:focus-within \.willow-gdlg-field__outline\s*\{\s*border-width:\s*1\.6px/);
  // Absolutely positioned so 0.8 -> 1.6px cannot shift the input.
  assert.match(outline, /position:\s*absolute/);

  const field = dialogCssCode.slice(
    dialogCssCode.indexOf('.willow-gdlg-field {'),
    dialogCssCode.indexOf('.willow-gdlg-field__outline'),
  );
  assert.match(field, /height:\s*56px/);
  assert.match(field, /padding:\s*0 16px/);
});

// --- Rename ----------------------------------------------------------------

test('Rename is a 512-wide H2 dialog with the measured 24px gap above the field', () => {
  // Anchored on the opening prop rather than a byte offset before the title:
  // a fixed lookback can spill into the previous dialog's closing tag, which
  // then makes the end index precede the start and yields an empty slice.
  const rename = sidebarCode.slice(
    sidebarCode.indexOf('headingAs="h2"'),
    sidebarCode.indexOf('headingAs="h1"'),
  );
  assert.ok(rename.length > 0, 'could not locate the Rename dialog');
  assert.match(rename, /title="Rename this chat"/);
  assert.match(rename, /headingAs="h2"/);
  assert.match(rename, /width=\{512\}/);
  // Gemini's inner `.dialog-content` has `padding: 24px 0 0` INSIDE the dialog
  // content block, which is why the field lands at dy 89 and not 65.
  assert.match(rename, /paddingTop:\s*24/);
  assert.match(rename, /<GeminiOutlinedField/);
});

test('the Rename pill is disabled at open and while the field is empty', () => {
  const rename = sidebarCode.slice(
    sidebarCode.indexOf('headingAs="h2"'),
    sidebarCode.indexOf('headingAs="h1"'),
  );
  // Measured on a freshly opened dialog: bg at alpha 0.12, colour at 0.38 —
  // i.e. disabled, because the field starts at the unchanged title.
  assert.match(rename, /disabled=\{!editValue\.trim\(\) \|\| editValue === editingChatId\}/);
});

test('the rename field is prefilled with the current name', () => {
  // Measured selection {start: 29, end: 29} on a 29-char title: caret at the
  // end, nothing selected. A prefilled autoFocus input gives exactly that.
  assert.match(sidebarCode, /setEditValue\(chat\)/);
  assert.match(dialogCode, /autoFocus/);
  assert.doesNotMatch(dialogCode, /\.select\(\)/, 'Gemini does not select-all on open');
});

// --- Delete ----------------------------------------------------------------

test('Delete is a 600-wide H1 dialog with two enabled, untinted pills', () => {
  const del = sidebarCode.slice(sidebarCode.indexOf('headingAs="h1"'));
  assert.ok(del.length > 0, 'could not locate the Delete dialog');
  assert.match(del, /title="Delete chat\?"/);
  assert.match(del, /width=\{600\}/);
  const pills = del.slice(del.indexOf('actions='), del.indexOf('</GeminiDialog>'));
  assert.ok(pills.includes('Cancel') && pills.includes('Delete'), 'expected both pills');
  // Gemini does NOT tint the destructive action red, and does not disable it.
  assert.doesNotMatch(pills, /disabled/, 'neither Delete pill is gated');
  assert.doesNotMatch(pills, /red|#b3261e|error/i, 'Gemini does not tint Delete red');
});

test('Delete has no inner top padding — its body is flush under the content pad', () => {
  const del = sidebarCode.slice(sidebarCode.indexOf('headingAs="h1"'));
  const body = del.slice(del.indexOf('>'), del.indexOf('</GeminiDialog>'));
  assert.doesNotMatch(body, /paddingTop/, 'Delete measured no 24px inner pad, unlike Rename');
  assert.match(body, /<p>/);
});

// --- Close timing ----------------------------------------------------------

test('both dialogs hold for the 75ms the measured removal brackets to', () => {
  // Rename bracketed removal at 66.7-101.2ms and Delete at 49.9-82.3ms; the
  // only span in both is 66.7-82.3, and MDC's exit duration is 75ms.
  const renameClose = sidebarCode.slice(
    sidebarCode.indexOf('const triggerCloseRename'),
    sidebarCode.indexOf('const commitRename'),
  );
  assert.match(renameClose, /\}, 75\);/);

  const deleteClose = sidebarCode.slice(
    sidebarCode.indexOf('const triggerCloseDelete'),
    sidebarCode.indexOf('const confirmDeleteChat'),
  );
  assert.match(deleteClose, /\}, 75\);/);
});

test('deleting dismisses before it awaits the disk, not after', () => {
  // 75ms is nowhere near long enough to have waited on a delete, so leaving the
  // dialog up until the write resolves would read as a frozen dialog.
  const confirm = sidebarCode.slice(
    sidebarCode.indexOf('const confirmDeleteChat'),
    sidebarCode.indexOf('const confirmDeleteChat') + 900,
  );
  assert.ok(
    confirm.indexOf('triggerCloseDelete()') < confirm.indexOf('await deleteLocalFSChat'),
    'the dialog must dismiss before awaiting the delete',
  );
});

// --- The row no longer renames inline --------------------------------------

test('the row has no inline rename input — Gemini raises a dialog instead', () => {
  assert.doesNotMatch(rowCode, /<input/, 'the rename input moved into the dialog');
  for (const prop of ['isEditing', 'editValue', 'onEditValueChange', 'onEditCommit', 'onEditCancel']) {
    assert.ok(!rowCode.includes(prop), `RecentChatRow should no longer take ${prop}`);
  }
});

test('the row trigger keeps its measured 24x24 button and ripple-only hover', () => {
  // Measured: BUTTON 24x24, transparent background, radius 9999, padding 0,
  // revealed by visibility with opacity 1 in BOTH states (so no fade). The tint
  // is a persistent-ripple child at rgb(196,199,197) opacity 0.08.
  const trigger = rowCode.slice(rowCode.indexOf('<button'), rowCode.indexOf('</button>'));
  assert.match(trigger, /\bh-6 w-6\b/);
  assert.match(trigger, /rounded-full/);
  assert.match(trigger, /\bp-0\b/);
  assert.match(trigger, /before:bg-\[rgb\(196,199,197\)\]/);
  assert.match(trigger, /hover:before:opacity-\[0\.08\]/);
  assert.match(trigger, /invisible group-hover\/item:visible/);
  assert.doesNotMatch(trigger, /transition-opacity[^"]*group-hover\/item:opacity-100"/, 'the reveal is visibility, not a fade');
});

test('the renaming row stays mounted even when windowed out', () => {
  // The dialog is a portal so it would survive, but the row re-sorts to the top
  // the moment the rename lands and must not be missing when it does.
  assert.match(sidebarCode, /\[editingChatId,\s*menuActiveChat,\s*activeChatId\]/);
});
