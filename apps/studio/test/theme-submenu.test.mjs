/**
 * The settings > Theme hover flyout, pinned to what was measured off the live
 * Gemini app over CDP. Six scripts; the last three existed only because the exit
 * recorder kept losing its return value.
 *
 * Capture conditions: gemini.google.com, dpr 1.25, zoom 1, viewport 1419x826,
 * every run guarded by an acked screencast ({acked:true, frames:6, hidden:false})
 * so no rAF measurement came off a throttled tab. Hover only — no theme option
 * was ever clicked in the user's account.
 *
 * This flyout is the THIRD Gemini menu implementation measured in this codebase,
 * and it does not behave like either of the other two. Worth stating plainly,
 * because two of its properties are the exact opposite of the top-right menu's:
 *
 *   - It IS a `.mat-mdc-menu-panel` (`.lm-menu-theme`), so `_mat-menu-enter`
 *     applies and it animates. The top-right `gem-menu` sits in a plain
 *     `cdk-overlay-popover`, matches no panel selector, and has NO animation.
 *   - Its 240px width is AUTHORED, not content-derived. Label natural widths are
 *     only System 44.13 / Light 30.31 / Dark 28.31 against a 240px box, and all
 *     three rows report clientWidth === scrollWidth === 224. The top-right pane
 *     was the reverse: content-derived between a min and a max.
 *
 * The measurements this file guards:
 *
 *   Panel        240x124 at (300, 373.21), bg rgb(31,31,31), radius 20,
 *                padding 8, shadow rgba(0,0,0,0.28) 0 0 20px 0, no border.
 *                124 = 2x8 padding + 3x36 rows, so the row count is load-bearing.
 *   Placement    top = trigger row top - 8; left = 300 against a parent whose
 *                right edge is 308, i.e. an 8px overlap. Both 8s are the parent
 *                pane's own padding, so the panel butts against the parent's
 *                CONTENT box, not its border box.
 *   Rows         3 `role="menuitemradio"`, each 224x36, padding 0 8px, radius 12,
 *                flex/center, gap 0. Hover rgba(230,230,230,0.08) — read via
 *                CSS.forcePseudoState, since synthetic mouse events never set
 *                :hover and a naive read returns rgba(0,0,0,0) both times.
 *   Label        13/17/400, rgb(230,230,230), Google Sans Flex at
 *                "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400, nowrap, flex 1 1 0%.
 *                176px wide checked vs 208 unchecked — the 32px delta IS the
 *                24px glyph box plus its 8px margin, which is why the check is
 *                pushed by the label's flex rather than positioned.
 *   Check        Selected row ONLY. `check` in Luminous Symbols, 20px glyph in a
 *                24x24 box, "FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20,
 *                "wght" 320, rgb(230,230,230), margin-right 8.
 *   Motion       enter `_mat-menu-enter` 120ms cubic-bezier(0,0,0.2,1),
 *                scale(0.8)+opacity 0 -> none+1, transform-origin left top;
 *                exit `_mat-menu-exit` 100ms linear with a 25ms delay, opacity
 *                only, no transform. Identical curves to the Recents row menu,
 *                so `willow-mat-menu-enter`/`-exit` are reused rather than
 *                re-authored.
 *   Trigger arrow  A 5x10 polygon in a 24px-wide box with 12px padding-left,
 *                fill rgb(196,199,197) — Material's own submenu arrow. Measured
 *                because the previous hand-made triangle was 5px wide with
 *                `fill-current`, which put it in the wrong place in the wrong
 *                colour.
 *
 * One divergence, recorded so it reads as a decision: selecting Light or System
 * persists and moves the check, but Willow has no light palette to repaint into,
 * so the surface stays dark. The flyout is what was asked for and what is
 * measured here; a full second palette is a separate piece of work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');

/** Comments quote the measurements, so an assertion could otherwise pass on prose alone. */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const code = codeOnly(sidebar);

/*
 * The flyout component only. Anchored on the `GeminiThemeSubmenu` declaration and
 * closed at the exit-duration constant that follows the settings menu, so a
 * `rounded-[20px]` or `h-9` belonging to some other pane in this 3000-line file
 * cannot satisfy a panel or row assertion.
 */
const submenu = code.slice(
  code.indexOf('const GeminiThemeSubmenu'),
  code.indexOf('const GEMINI_SIDEBAR_POSITION_MOTION'),
);

/** The panel element's own attributes: everything before the first row button. */
const panel = submenu.slice(0, submenu.indexOf('GEMINI_THEME_OPTIONS.map'));

/** The row button and its contents. */
const row = submenu.slice(submenu.indexOf('GEMINI_THEME_OPTIONS.map'));

const arrow = code.slice(code.indexOf('const GeminiSubmenuArrow'), code.indexOf('const GeminiSettingsMenu'));

test('the flyout exists as its own component and is not folded into the settings pane', () => {
  assert.ok(submenu.length > 400, 'GeminiThemeSubmenu slice came back empty or truncated');
  assert.match(code, /GEMINI_THEME_OPTIONS/, 'the three options are not declared');
});

test('panel chrome matches the measured 240x124 surface', () => {
  assert.match(panel, /w-\[240px\]/, 'width must be AUTHORED 240px, not content-derived');
  assert.match(panel, /rounded-\[20px\]/);
  assert.match(panel, /bg-\[#1f1f1f\]/, 'measured rgb(31,31,31)');
  assert.match(panel, /\bp-2\b/, 'measured padding 8px; 124 = 16 + 3x36 depends on it');
  assert.match(panel, /shadow-\[0_0_20px_rgba\(0,0,0,0\.28\)\]/);
  assert.doesNotMatch(panel, /\bborder\b/, 'measured border: none');
});

test('panel width is authored, so no min/max/content sizing sneaks in', () => {
  assert.doesNotMatch(panel, /min-w-|max-w-/, 'the pane is a fixed 240, unlike the top-right menu');
  assert.doesNotMatch(panel, /w-max|w-fit|w-auto/);
});

test('placement is -8px vertically and butts the parent content edge horizontally', () => {
  assert.match(panel, /left: 'calc\(100% - 8px\)'/, 'measured left 300 vs parent right 308');
  assert.match(panel, /top,/, 'top is measured per-open from the trigger row, not hard-coded');
  assert.match(code, /rowTop - 8|- 8/, 'the -8px offset from the row top is missing');
});

test('the enter animation is the measured _mat-menu-enter, reused not re-authored', () => {
  assert.match(panel, /willow-mat-menu-enter/);
  assert.match(panel, /willow-mat-menu-exit/, 'the exit was measured and must play');
  assert.match(panel, /transformOrigin: 'left top'/, "measured inline `transform-origin: left top`");
});

test('transform-origin is left top here, NOT the settings pane bottom-left', () => {
  assert.doesNotMatch(panel, /0 100%/, 'that origin belongs to the upward-growing settings pane');
});

test('the exit is opacity-only, so the fading panel must not swallow clicks', () => {
  assert.match(panel, /pointerEvents: phase === 'closing' \? 'none' : undefined/);
});

test('three options in the measured order', () => {
  /* The declaration carries a type annotation, so the anchor cannot include the `=`. */
  const options = code.slice(
    code.indexOf('const GEMINI_THEME_OPTIONS'),
    code.indexOf('const GEMINI_MAT_MENU_EXIT_MS'),
  );
  const labels = [...options.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['System', 'Light', 'Dark']);
});

test('rows are radios, not plain menu items', () => {
  assert.match(row, /role="menuitemradio"/, 'measured role on all three rows');
  assert.match(row, /aria-checked=\{value === option\.id\}/);
});

test('row box matches the measured 224x36', () => {
  assert.match(row, /\bh-9\b/, 'measured 36px');
  assert.match(row, /\bpx-2\b/, 'measured padding 0px 8px');
  assert.match(row, /rounded-xl/, 'measured border-radius 12px');
  assert.match(row, /w-full/, '224 = the panel content box, so the row fills it');
  assert.match(row, /items-center/);
});

test('row hover is the measured tint and nothing else', () => {
  assert.match(row, /hover:bg-\[rgba\(230,230,230,0\.08\)\]/);
  assert.doesNotMatch(row, /before:/, 'these rows use a background, not a state-layer pseudo-element');
});

test('label carries the measured 13/17/400 and the wdth 92 axis', () => {
  assert.match(row, /text-\[13px\]/);
  assert.match(row, /leading-\[17px\]/);
  assert.match(row, /font-normal/);
  assert.match(row, /text-\[#e6e6e6\]/, 'measured rgb(230,230,230)');
  assert.match(row, /"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400/);
  assert.match(row, /Google Sans Flex/);
});

test('label is nowrap and absorbs the row, which is what positions the check', () => {
  assert.match(row, /whitespace-nowrap/, 'measured white-space: nowrap');
  assert.match(row, /flex-1/, 'measured flex: 1 1 0%');
  assert.doesNotMatch(row, /truncate|text-ellipsis/, 'measured text-overflow: clip, overflow: visible');
});

test('the check renders on the selected row only', () => {
  assert.match(row, /\{value === option\.id && \(/, 'an always-rendered check would break the 176/208 label widths');
});

test('check glyph matches the measured Luminous axes', () => {
  assert.match(row, /name="check"/);
  assert.match(row, /family="luminous"/, 'measured font-family "Luminous Symbols"');
  assert.match(row, /size=\{20\}/, 'measured font-size 20px');
  assert.match(row, /weight=\{320\}/);
  assert.match(row, /roundness=\{100\}/);
  assert.match(row, /opticalSize=\{20\}/);
});

test('check sits in a 24px box with the measured 8px trailing margin', () => {
  assert.match(row, /mr-2/, 'measured margin 0px 8px 0px 0px; icon right 516 = row right 532 - 8 - 8');
  assert.match(row, /width: 24, height: 24/, 'measured 24x24 box around a 20px glyph');
});

test('the trigger arrow is the measured Material polygon, not a hand-made triangle', () => {
  assert.match(arrow, /viewBox="0 0 5 10"/, 'measured a 5x10 polygon');
  assert.match(arrow, /points="0,0 5,5 0,10"/);
  assert.match(arrow, /w-6/, 'measured a 24px-wide box, not the glyph width');
  assert.match(arrow, /pl-3/, 'measured padding-left 12px');
  assert.match(arrow, /fill-\[#c4c7c5\]/, 'measured fill rgb(196,199,197)');
  assert.doesNotMatch(arrow, /fill-current/, 'the arrow is dimmer than the label it sits beside');
});

test('the flyout opens on hover, the way a mat-menu submenu trigger does', () => {
  assert.match(code, /onMouseEnter=\{\(event\) => \{/, 'the settings rows must drive open/close by hover');
  assert.match(code, /openThemeSubmenu\(event\.currentTarget\)/);
  assert.match(code, /else closeThemeSubmenu\(\)/, 'hovering any other row must close it, as measured');
});

test('moving the pointer into the flyout keeps it open', () => {
  assert.match(panel, /onMouseEnter=\{onKeepOpen\}/);
  assert.match(panel, /onMouseLeave=\{onLeave\}/);
});

test('the closing phase is held for the full measured 125ms', () => {
  assert.match(code, /GEMINI_MAT_MENU_EXIT_MS = 125/, '25ms delay + 100ms duration');
  assert.match(code, /themePhase !== 'closed' &&/, 'the panel must outlive the open flag to play its exit');
});

test('the theme row is wired up and no longer inert', () => {
  assert.match(code, /submenu: 'theme'/, "Sidebar's Theme row must declare its flyout");
  assert.match(code, /aria-haspopup=\{item\.submenu \? 'menu' : undefined\}/);
  assert.match(code, /aria-expanded=\{item\.submenu \? themePhase === 'open' : undefined\}/);
});

test('the flyout is a sibling of the settings pane, since that pane clips', () => {
  assert.match(
    code,
    /pointer-events-none absolute z-\[100\] w-\[300px\]/,
    'a positioning wrapper must own left/bottom so the pane can keep overflow-y-auto',
  );
  assert.match(panel, /pointer-events-auto/, 'the wrapper is pass-through, so the panel must opt back in');
  assert.match(panel, /z-\[101\]/, 'above the settings pane it overlaps');
});

test('the selection persists rather than resetting on every open', () => {
  assert.match(code, /GEMINI_THEME_STORAGE_KEY = 'willow_theme'/, 'the chosen theme must survive a reload');
  assert.match(code, /localStorage/, 'the key alone is not persistence');
});
