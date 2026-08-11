/**
 * Gemini's top-right conversation-actions menu, pinned to what was measured off
 * the live app over CDP so a later tidy-up cannot quietly drift it.
 *
 * Capture conditions: gemini.google.com, viewport 1536x826, dpr 1.25, zoom 1,
 * with an acked Page.startScreencast and a rAF positive control, taken from
 * `[aria-label="Open menu for conversation actions."]` and the pane it opens on
 * a pinned normal conversation.
 *
 * This is a DIFFERENT implementation from the Recents row menu, and the
 * difference is the single most important thing this file guards:
 *
 *   Recents row menu   an Angular Material `mat-menu`. `.mat-mdc-menu-panel`
 *                      matches, so `_mat-menu-enter` / `_mat-menu-exit` apply
 *                      and it animates in and out.
 *   This menu          a `gem-menu` inside a plain `cdk-overlay-popover`.
 *                      `.mat-mdc-menu-panel` does NOT match, so Material's
 *                      keyframes never reach it and there is NO animation in
 *                      either direction.
 *
 * "No animation" is measured, not assumed. Opening, the pane was fully formed
 * and byte-identical in every sampled frame (`animationName: none`,
 * `transform: matrix(1,0,0,1,0,4)`, `opacity: 1`, h 268, y 54). Closing, 19
 * identical frames then GONE in one. The recorder was armed before the click and
 * reported 11 baseline frames, so the absent intermediate frames are an absence
 * of animation, not an absence of frames.
 *
 * The measurements this file guards:
 *
 *   Trigger    BUTTON 36x36 at (1488, 14) -> top 14 / right 12, radius 9999,
 *              padding 6, transparent background, colour rgb(230,230,230), glyph
 *              `more_vert` in Luminous at 24px / ROND 100 / opsz 24 / wght 300.
 *              The hover tint is a pseudo-element, rgb(196,199,197) at
 *              opacity 0 -> 0.08 — not the button's own background, which stayed
 *              rgba(0,0,0,0) throughout.
 *   Pane       203.26 x 268 at (1320.74, 54). Right edge 1524 = trigger.right,
 *              top = trigger.bottom + 4 (the CDK wrapper is
 *              `inset: 50px 12px auto auto` and the pane carries
 *              `translateY(4px)`). bg rgb(31,31,31), radius 20, padding 8,
 *              shadow rgba(0,0,0,0.28) 0 0 20px 0, no border, no dividers.
 *   Width      content-derived and MUST NOT be authored. 203.26 = 8 + 187.26 + 8,
 *              and the row's 187.26 - 16 padding = 171.26 = 20 (leading) + 8 +
 *              115.26 ("Share conversation") + 8 + 20 (trailing). That trailing
 *              20px box is EMPTY in all seven rows — `innerHTML` was three
 *              Angular comment anchors and nothing else — and has to be
 *              reproduced or the pane comes out 28px narrow with every other
 *              value right. Gemini's authored `min-width: min(225px, 100%)`
 *              measured inert (the pane came out 203.26, under 225) so it is
 *              deliberately NOT reproduced.
 *   Rows       7, each 36 tall, padding 8, gap 8, radius 12, hover
 *              rgba(230,230,230,0.08) on the row's own background. Height checks
 *              out: 268 = 16 padding + 7 x 36.
 *   Icons      20px, FILL 0 / GRAD 0 / ROND 100 / opsz 20 / wght 320, colour
 *              rgb(227,227,227) — one step off the label, hence set separately.
 *              Six are Luminous; `download` alone is Google Symbols.
 *   Labels     13px/17px 400 in rgb(230,230,230), nowrap + ellipsis, at
 *              ROND 0 / slnt 0 / wdth 92 / wght 400.
 *
 * Two deliberate divergences, recorded here so they read as decisions:
 *
 *   1. Download PDF and Export to Docs are rendered but stubbed. Willow has no
 *      PDF pipeline and no Docs integration. They stay in the pane because the
 *      measured 268px height IS 16 + 7 x 36 — dropping a row would change a
 *      measured value — and they say plainly that they are unavailable rather
 *      than claiming to have run. Share and Add to notebook are stubbed the same
 *      way the Recents row menu already stubs them.
 *   2. Pin / Rename / Delete raise an intent instead of acting. The sidebar is
 *      the single writer for the pin list, the rename sanitizer and dup-check,
 *      the pin carry across a rename, and the Code-mode / scanned-chat id maps.
 *      A second writer would have to hold all of that in lock-step.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const menu = read('apps/studio/src/shell/ConversationActionsMenu.tsx');
const menuCss = read('apps/studio/src/shell/ConversationActionsMenu.css');
const actions = read('apps/studio/src/shell/chat-actions.ts');
const layout = read('apps/studio/src/shell/StudioLayout.tsx');
const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');

/** Strip comments so a measured value quoted in prose cannot satisfy a match. */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const menuCode = codeOnly(menu);
const menuCssCode = codeOnly(menuCss);
const actionsCode = codeOnly(actions);
const layoutCode = codeOnly(layout);
const sidebarCode = codeOnly(sidebar);

/** The pane element's own attributes, so a row's class cannot satisfy a pane assertion. */
const paneEl = menuCode.slice(
  menuCode.indexOf('willow-conv-menu absolute'),
  menuCode.indexOf('onClick={(event) => event.stopPropagation()}'),
);

/*
 * The seven-row table. Ends at the JSX root and NOT at `return (` — the
 * document-listener effect's cleanup is `return () =>`, which comes first in the
 * file and collapsed this slice to nothing.
 */
const rowTable = menuCode.slice(menuCode.indexOf('const rows:'), menuCode.indexOf('<div ref={rootRef}'));

// --- The trigger -----------------------------------------------------------

test('the trigger sits in the measured 36x36 box at top 14 / right 12', () => {
  const trigger = menuCode.slice(menuCode.indexOf('aria-label="Open menu'), menuCode.indexOf('name="more_vert"'));
  assert.ok(trigger.length > 0, 'could not locate the trigger');
  // The root owns the offset; both the trigger and the pane anchor off it.
  assert.match(menuCode, /absolute top-\[14px\] right-\[12px\] z-30/);
  // 36x36 with 6px padding: h-9/w-9 and p-1.5 on Tailwind's 4px scale.
  assert.match(trigger, /h-9 w-9/);
  assert.match(trigger, /(?<![-\w])p-1\.5(?![-\w])/);
  assert.match(trigger, /rounded-full/);
  assert.match(trigger, /bg-transparent/);
  assert.match(trigger, /border-0/);
  assert.match(trigger, /text-\[#e6e6e6\]/);
});

test('the trigger hover tint is the measured pseudo-element, not a background', () => {
  const trigger = menuCode.slice(menuCode.indexOf('aria-label="Open menu'), menuCode.indexOf('name="more_vert"'));
  // rgb(196,199,197) at 0 -> 0.08, inset 0, radius inherited. Same mechanism as
  // the Recents row trigger, which is where the shared value comes from.
  assert.match(trigger, /before:absolute/);
  assert.match(trigger, /before:inset-0/);
  assert.match(trigger, /before:rounded-full/);
  assert.match(trigger, /before:bg-\[rgb\(196,199,197\)\]/);
  assert.match(trigger, /before:opacity-0/);
  assert.match(trigger, /hover:before:opacity-\[0\.08\]/);
  // 0.12 is MDC's FOCUS overlay. The first read of this said 0.12 only because
  // the button still carried cdk-keyboard-focused from being opened
  // programmatically; the authored hover rule is 0.08.
  assert.doesNotMatch(trigger, /0\.12/, 'the hover tint is 0.08 — 0.12 is the focus overlay');
  // The button's own background measured rgba(0,0,0,0) in every state.
  assert.doesNotMatch(trigger, /hover:bg-/, 'the tint is a pseudo-element, not the button background');
});

test('the trigger glyph is more_vert in Luminous at the measured axes', () => {
  const glyph = menuCode.slice(menuCode.indexOf('name="more_vert"'), menuCode.indexOf('</button>'));
  assert.match(glyph, /family="luminous"/);
  assert.match(glyph, /size=\{24\}/);
  assert.match(glyph, /weight=\{300\}/);
  assert.match(glyph, /roundness=\{100\}/);
  assert.match(glyph, /opticalSize=\{24\}/);
});

// --- The pane --------------------------------------------------------------

test('the pane keeps the measured card chrome', () => {
  assert.ok(paneEl.length > 0, 'could not locate the pane');
  assert.match(paneEl, /rounded-\[20px\]/);
  assert.match(paneEl, /bg-\[#1f1f1f\]/);
  assert.match(paneEl, /(?<![-\w])p-2(?![-\w])/);
  assert.match(paneEl, /shadow-\[0_0_20px_rgba\(0,0,0,0\.28\)\]/);
  assert.match(paneEl, /flex flex-col/);
  // Measured `border: none` and `dividers: 0`.
  assert.doesNotMatch(paneEl, /border-\[|divide-/, 'the pane has no border and no dividers');
});

test('the pane is anchored trigger.bottom + 4 and right-aligned to the trigger', () => {
  // 14 (trigger top) + 36 (trigger height) + 4 (the pane's own translateY) = 54,
  // which is 40 below the root's own top of 14.
  assert.match(paneEl, /top-\[40px\]/);
  // The CDK wrapper's `align-items: flex-end` against `right: 12px` put the
  // pane's right edge on trigger.right (1524). Contrast the Recents menu, which
  // is left-aligned and butts against its trigger with zero gap.
  assert.match(paneEl, /right-0/);
  assert.doesNotMatch(paneEl, /left-/, 'the pane is right-aligned, not left-aligned');
});

test('the pane width is content-derived and never authored', () => {
  // 203.26 fell out of the content. Authoring it — or reproducing Gemini's
  // measured-inert `min-width: min(225px, 100%)` — would pin the wrong number.
  assert.doesNotMatch(paneEl, /(?<![-\w])w-\[\d/, 'the pane must not author a width');
  assert.doesNotMatch(paneEl, /min-w-\[|max-w-\[/, 'no min/max width — the pane shrink-wraps its rows');
  assert.doesNotMatch(menuCssCode, /width:/, 'the CSS must not author a width either');
});

// --- No animation, in either direction -------------------------------------

test('the pane has no enter or exit animation', () => {
  // The Recents menu's classes must never appear here — the whole point of the
  // separate component is that this pane is not a mat-menu.
  assert.doesNotMatch(menuCode, /willow-mat-menu-enter|willow-mat-menu-exit/);
  assert.doesNotMatch(menuCode, /animate-|transition-transform/);
  assert.doesNotMatch(menuCssCode, /@keyframes|animation:/);
  // No transition on the pane itself; the only transitions in the file are the
  // trigger's tint and the row's hover colour, both of which are measured.
  assert.doesNotMatch(paneEl, /transition/);
});

test('the pane unmounts in the same frame, with no closing state or hold', () => {
  // The measured close was 19 identical frames then GONE in one. A `closing`
  // flag or a setTimeout unmount hold — both of which the Recents menu and the
  // dialogs correctly have — would be wrong here.
  assert.doesNotMatch(menuCode, /setTimeout/, 'no unmount hold: the pane is removed in one frame');
  assert.doesNotMatch(menuCode, /[Cc]losing/, 'no closing state: there is nothing to animate out');
  assert.match(menuCode, /\{isOpen && \(/, 'the pane renders straight off isOpen');
});

// --- The rows --------------------------------------------------------------

test('the rows keep the measured box', () => {
  const rowClass = menuCode.slice(menuCode.indexOf('const ROW_CLASS'), menuCode.indexOf('const LABEL_CLASS'));
  assert.match(rowClass, /(?<![-\w])h-9(?![-\w])/); // 36
  assert.match(rowClass, /(?<![-\w])p-2(?![-\w])/); // 8
  assert.match(rowClass, /(?<![-\w])gap-2(?![-\w])/); // 8
  assert.match(rowClass, /rounded-xl/); // 12
  assert.match(rowClass, /cursor-pointer/);
  assert.match(rowClass, /items-center/);
  // Hover is the row's OWN background, not a ripple — that is the trigger's
  // mechanism, not the row's.
  assert.match(rowClass, /hover:bg-\[rgba\(230,230,230,0\.08\)\]/);
  assert.doesNotMatch(rowClass, /before:/, 'the row tints its own background, it has no ripple');
});

test('the label carries the measured type and does not grow into the row', () => {
  const labelClass = menuCode.slice(menuCode.indexOf('const LABEL_CLASS'), menuCode.indexOf('const SLOT_CLASS'));
  assert.match(labelClass, /text-\[13px\]/);
  assert.match(labelClass, /leading-\[17px\]/);
  assert.match(labelClass, /font-normal/);
  assert.match(labelClass, /text-\[#e6e6e6\]/);
  assert.match(labelClass, /whitespace-nowrap/);
  assert.match(labelClass, /overflow-hidden/);
  assert.match(labelClass, /text-ellipsis/);
  // Every label measured its natural text width — 115.26 for "Share
  // conversation" but 35.14 for "Unpin" — so it must not flex.
  assert.doesNotMatch(labelClass, /flex-1|grow/, 'labels measured their natural width, they do not grow');
});

test('every row reserves the empty 20px trailing slot that sets the pane width', () => {
  const slotClass = menuCode.slice(menuCode.indexOf('const SLOT_CLASS'), menuCode.indexOf('type ConversationActionRow'));
  assert.match(slotClass, /(?<![-\w])h-5(?![-\w])/); // 20
  assert.match(slotClass, /(?<![-\w])w-5(?![-\w])/); // 20
  assert.match(slotClass, /shrink-0/);
  // Empty in all seven measured rows, and flush right in all seven — trailing.x
  // was 1488 on both the 115.26px row and the 35.14px one, so the slack goes
  // here as an auto margin rather than into the label.
  const trailing = menuCode.slice(menuCode.indexOf('aria-hidden="true"'));
  assert.match(trailing, /\$\{SLOT_CLASS\} ml-auto/);
  assert.match(trailing, /ml-auto`\}\s*\/>/, 'the trailing slot is self-closing — it is empty');
});

test('the seven rows are in the measured order with the measured glyphs', () => {
  const labels = [...rowTable.matchAll(/label: (?:isPinned \? '(?:Unpin)' : '(?:Pin)'|'([^']+)')/g)].map(
    (m) => m[1] ?? 'Pin/Unpin',
  );
  assert.deepEqual(labels, [
    'Share conversation',
    'Pin/Unpin',
    'Rename',
    'Download PDF',
    'Export to Docs',
    'Add to notebook',
    'Delete',
  ]);
  const icons = [...rowTable.matchAll(/icon: (?:isPinned \? '(unpin)' : '(?:push_pin)'|'([^']+)')/g)].map(
    (m) => m[1] ?? m[2],
  );
  assert.deepEqual(icons, ['share_1', 'unpin', 'edit', 'download', 'docs', 'notebook', 'delete']);
  // Pane height 268 = 16 padding + 7 x 36, so the count is itself a measurement.
  assert.equal((rowTable.match(/onSelect:/g) ?? []).length, 7);
  // `share_1` here, not the Recents menu's `share_2` — two different glyphs on
  // two different surfaces, both read off `data-mat-icon-name`.
  assert.doesNotMatch(rowTable, /share_2/);
});

test('download alone is Google Symbols; the other six are Luminous', () => {
  assert.equal((rowTable.match(/family: 'google-symbols'/g) ?? []).length, 1);
  assert.equal((rowTable.match(/family: 'luminous'/g) ?? []).length, 6);
  const download = rowTable.slice(rowTable.indexOf("id: 'download'"), rowTable.indexOf("id: 'export'"));
  assert.match(download, /family: 'google-symbols'/);
});

test('the row icons carry the measured axes and their own colour', () => {
  const icon = menuCode.slice(menuCode.indexOf('name={row.icon}'), menuCode.indexOf('className={LABEL_CLASS}'));
  assert.match(icon, /family=\{row\.family\}/);
  assert.match(icon, /size=\{20\}/);
  assert.match(icon, /weight=\{320\}/);
  assert.match(icon, /roundness=\{100\}/);
  assert.match(icon, /opticalSize=\{20\}/);
  // rgb(227,227,227), one step off the label's rgb(230,230,230).
  assert.match(menuCssCode, /\.willow-conv-menu-icon\s*\{[^}]*color: rgb\(227, 227, 227\)/);
});

test('the pane declares its own width axis, since it sits outside the sidebar', () => {
  // font-variation-settings replaces rather than merges, so the full list is
  // restated. `wght` is included here unlike the sidebar's inherited rule —
  // every label in this pane measured 400 and nothing below overrides it.
  assert.match(
    menuCssCode,
    /\.willow-conv-menu\s*\{[^}]*font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400/,
  );
  assert.match(menuCssCode, /\.willow-conv-menu\s*\{[^}]*font-family: "Google Sans Flex"/);
});

// --- Wiring: one control in the box, one writer for the state --------------

test('the menu is the exact isChatOngoing complement of the temporary-chat button', () => {
  // Gemini shows one control in this box at a time: the three-dot during a
  // conversation, the temporary-chat toggle before one. Both occupy the same
  // measured 36x36 at top 14 / right 12.
  assert.match(layoutCode, /isChatOngoing && !!activeChatId && \(\s*<ConversationActionsMenu chatId=\{activeChatId\} \/>/);
  assert.match(layoutCode, /studioMode === 'chat' && !isChatOngoing && \(/);
});

test('the menu raises intents and never writes chat state itself', () => {
  // Single writer. The sidebar owns the scope-guarded pin list, the rename
  // sanitizer and dup-check, the pin carry, and the Code-mode / scanned-chat maps.
  assert.doesNotMatch(menuCode, /localStorage\.setItem/, 'the sidebar is the only writer');
  for (const action of ['pin', 'rename', 'delete']) {
    assert.match(menuCode, new RegExp(`emitChatActionIntent\\(\\{ action: '${action}', chatId \\}\\)`));
  }
});

test('the sidebar routes every raised intent to the handler the row menu uses', () => {
  const listener = sidebarCode.slice(
    sidebarCode.indexOf('onChatActionIntent(({ action, chatId })'),
    sidebarCode.indexOf('const handleClose = () =>'),
  );
  assert.ok(listener.length > 0, 'could not locate the intent listener');
  assert.match(listener, /action === 'pin'\) togglePinChat\(chatId\)/);
  assert.match(listener, /action === 'rename'\) openRenameDialog\(chatId\)/);
  assert.match(listener, /action === 'delete'\) handleDeleteChat\(chatId\)/);
  // togglePinChat closes over pinnedChats, so a stale subscription would toggle
  // against an out-of-date list and drop concurrent pins.
  assert.match(listener, /\[pinnedChats, chatScopeId, pinnedChatsKey\]/);
});

test('both surfaces build the pinned-chats key from one place', () => {
  // v2 and the encoding are load-bearing: an un-encoded scope id can contain the
  // separator and collide across scopes.
  assert.match(actionsCode, /willow_pinned_chats:v2:\$\{encodeURIComponent\(chatScopeId\)\}/);
  assert.match(sidebarCode, /const pinnedChatsKey = pinnedChatsStorageKey\(chatScopeId\)/);
  assert.doesNotMatch(sidebarCode, /`willow_pinned_chats/, 'the sidebar must not rebuild the key inline');
});

test('the pin row reads storage on each open rather than holding stale state', () => {
  // Pinning closes the pane, so the next open re-reads and there is nothing to
  // invalidate. This is why no same-tab broadcast is needed — the sidebar's own
  // `storage` listener is cross-tab only.
  assert.match(menuCode, /if \(!isOpen\) setIsPinned\(isChatPinned\(chatScopeId, chatId\)\)/);
  assert.match(menuCode, /label: isPinned \? 'Unpin' : 'Pin'/);
  assert.match(menuCode, /icon: isPinned \? 'unpin' : 'push_pin'/);
});
