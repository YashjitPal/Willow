/**
 * Gemini's sidebar footer: the profile row, the settings button, and the bottom fade.
 *
 * Every value here was read out of Gemini's own authored CSS, fetched through CDP's
 * `CSS.getStyleSheetText` across all 100 stylesheets. That path was used instead of the
 * DOM because the browser tab was occluded by then and `document.styleSheets` had shed
 * most of its rules (5085 -> 502); sheet text needs no layout, so it was unaffected.
 *
 * THE PROFILE ROW is Gemini's `mavatar-*` component:
 *
 *   .mavatar-footer-row  { display:flex; align-items:center; justify-content:space-between;
 *                          user-select:none; padding-block: var(--gem-sys-spacing--xs) }
 *   .mavatar-footer-left { padding-inline: 5px 6px; display:flex; align-items:center;
 *                          min-width:0; gap: var(--gem-sys-spacing--s) }
 *   .mavatar-container   { height:30px; width:30px; min-height:30px; min-width:30px;
 *                          padding-block:5px }
 *   .mavatar-image       { width:100%; height:100%; border-radius: corner-full }
 *   .mavatar-user-name   { color: var(--lumi-sys-color--on-surface);
 *                          overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
 *   .mavatar-settings-button { height:32px; width:32px;
 *                              color: var(--lumi-sys-color--on-surface) }
 *
 * with the dark-theme tokens resolving to xs=4px, s=8px and on-surface=#e6e6e6.
 *
 * THE FADE ("fade glow"):
 *
 *   .bottom-gradient-container { position:sticky; height:0; opacity:0; z-index:1;
 *     pointer-events:none; transition: opacity .15s linear }
 *   .bottom-gradient-container.visible { opacity: 1 }
 *   .bottom-gradient { height: var(--bottom-gradient-height, 16px); bottom: 0;
 *     background: linear-gradient(to top, var(--bottom-gradient-color), transparent) }
 *
 * `--bottom-gradient-color` is set to `--lumi-sys-color--surface-bright` on the sidenav,
 * which resolves to #1f1f1f — the sidebar's own background, so the list dissolves into the
 * panel rather than sitting under a scrim.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const sidebarDir = path.join(repoRoot, 'apps', 'studio', 'src', 'shell', 'sidebar');

const SIDEBAR = () => fs.readFileSync(path.join(sidebarDir, 'Sidebar.tsx'), 'utf8');
const SIDEBAR_CSS = () => fs.readFileSync(path.join(sidebarDir, 'Sidebar.css'), 'utf8');

/** Strips comments so a doc block quoting a value can't satisfy an assertion. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the sidebar settings button', () => {
  it('is a 32px box, not 36', () => {
    // `.mavatar-settings-button { height: 32px; width: 32px }`. The comment beside this
    // button in Sidebar.tsx has always recorded a 32px measurement; the class said h-9.
    const s = codeOnly(SIDEBAR());
    const btn = s.match(/aria-label="Settings"[\s\S]{0,900}?<\/button>/);
    assert.ok(btn, 'could not locate the settings button');
    assert.match(btn[0], /\bh-8 w-8\b/, 'measured 32px square');
    assert.ok(!/\bh-9 w-9\b/.test(btn[0]), '36px contradicts the measurement');
  });

  it('uses on-surface for its glyph', () => {
    const s = codeOnly(SIDEBAR());
    const btn = s.match(/aria-label="Settings"[\s\S]{0,900}?<\/button>/);
    assert.match(btn[0], /text-\[#e6e6e6\]/,
      '--lumi-sys-color--on-surface resolves to #e6e6e6 in the dark theme');
  });
});

describe('the profile row', () => {
  it('keeps the measured 30px avatar and 8px gap', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /h-\[30px\] w-\[30px\]/, '.mavatar-container is 30x30');
    assert.match(s, /pl-\[5px\] pr-1\.5/, '.mavatar-footer-left { padding-inline: 5px 6px }');
    assert.match(s, /gap-2 pl-\[5px\]/,
      '.mavatar-footer-left gap is --gem-sys-spacing--s = 8px');
  });

  it('shows the name at on-surface, at the measured 15px', () => {
    // `.mavatar-user-name { color: var(--lumi-sys-color--on-surface) }` — a flat #e6e6e6.
    // `text-white/80` is rgba(255,255,255,0.8), which reads differently over #1f1f1f.
    //
    // 15px/400/20px, measured on the live node (66.31x20 at x=49). This asserted 13px for
    // a while, which was carried over from the nav rows rather than measured on the footer.
    const s = codeOnly(SIDEBAR());
    const row = s.match(/userProfile\?\.displayName \|\| user\?\.email \|\| 'Account'/);
    assert.ok(row, 'could not locate the user-name node');
    assert.match(s, /text-\[15px\] font-normal leading-5 text-\[#e6e6e6\]/, 'measured name type');
  });

  it('hides the name outright when collapsed, rather than shrinking it', () => {
    // `.mavatar-footer-row.collapsed .mavatar-user-name { display: none }`. Animating
    // max-width/opacity instead leaves the name mid-fade over a rail that has already
    // reflowed, which is the "behaves weirdly" the collapsed footer used to show.
    const s = codeOnly(SIDEBAR());
    assert.ok(!/maxWidth: isCollapsed \? '0px' : '180px'/.test(s),
      'the name is unmounted when collapsed, not animated to zero width');
  });

  it('gives the account row no hover layer at all', () => {
    // Probe: :hover was forced on `.mavatar-footer-left` and all seven of its descendants
    // re-read. Not one changed background, ::before or opacity. Gemini's account row is an
    // <a> with no state layer, so a hover:bg here would be ours, not Gemini's.
    const s = codeOnly(SIDEBAR());
    const btn = s.match(/aria-label="Open account menu"[\s\S]{0,700}?>/);
    assert.ok(btn, 'could not locate the account row');
    assert.ok(!/hover:bg-/.test(btn[0]), 'Gemini\'s account row does not highlight');
  });

  it('swaps layout instantly on collapse, with no transition on the footer', () => {
    // All 883 nodes under `sidenav-mavatar-footer` / `mat-action-list.desktop-controls`
    // were walked: zero have a non-zero transition-duration, zero have a CSS animation,
    // zero carry an Angular ng-trigger. Only the rail's own 300ms width animates.
    const s = codeOnly(SIDEBAR());
    const start = s.indexOf('relative mt-auto flex shrink-0');
    assert.ok(start > 0, 'could not locate the footer row');
    const end = s.indexOf('aria-label="Expand sidebar"', start);
    assert.ok(end > start, 'could not bound the footer row');
    assert.ok(!/GEMINI_SIDEBAR_POSITION_MOTION/.test(s.slice(start, end)),
      'the footer must not animate its own reflow');
  });

  it('reverses to a column when collapsed, putting the gear above the avatar', () => {
    // `.mavatar-footer-row.collapsed { flex-direction: column-reverse; align-items:
    // flex-start; justify-content: flex-start; gap: 4px }`. Measured on a detached clone
    // at the 52px rail width: host 92px tall, gear 32x32 at (16,8), avatar at y=48.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /flexDirection: isCollapsed \? 'column-reverse' : 'row'/,
      'collapsed stacks in reverse DOM order');
    assert.match(s, /height: isCollapsed \? '92px' : '48px'/,
      'measured collapsed 92px, expanded 48px (40px content + 4px block padding)');
    assert.match(s, /gap: isCollapsed \? '4px' : '0px'/, '--gem-sys-spacing--xs');
    assert.match(s, /\bself-end\b/, '.mavatar-footer-right { align-self: flex-end }');
  });
});

describe('the bottom fade', () => {
  it('is 16px, not a 56px wash', () => {
    const s = codeOnly(SIDEBAR());
    const fade = s.match(/aria-hidden="true"[\s\S]{0,600}?linear-gradient\(to top[\s\S]{0,200}?\/>/);
    assert.ok(fade, 'could not locate the bottom fade');
    assert.match(fade[0], /\bh-4\b/, '--bottom-gradient-height defaults to 16px');
    assert.ok(!/\bh-14\b/.test(fade[0]), '56px is 3.5x Gemini\'s fade');
  });

  it('fades over 150ms linear', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /transition: 'opacity 150ms linear'/,
      '.bottom-gradient-container { transition: opacity .15s linear }');
  });

  it('runs solid-to-transparent upward, in the sidebar\'s own background', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /linear-gradient\(to top, \$\{isCollapsed \? 'var\(--studio-surface\)' : '#1f1f1f'\}, transparent\)/,
      'the gradient colour is the panel surface, so the list dissolves into it');
  });

  it('does not also mask the scroller', () => {
    // Gemini fades with the sticky gradient element ALONE. Willow additionally masked the
    // scroll wrapper to 20% over its last 10px, so the final row was dimmed twice.
    const s = codeOnly(SIDEBAR());
    assert.ok(
      !/WebkitMaskImage:\s*'linear-gradient\(to bottom, black/.test(s),
      'the scroller mask double-fades the last row',
    );
  });
});

describe('the settings menu', () => {
  it('is drawn on Gemini\'s menu surface', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /rounded-\[20px\] bg-\[#1f1f1f\] p-2/,
      'corner-large-increased 20px, surface-bright #1f1f1f, spacing--s padding');
    assert.match(s, /shadow-\[0_0_20px_rgba\(0,0,0,0\.28\)\]/, 'elevation level 1');
  });

  it('opens with Gemini\'s own _mat-menu-enter pair, not the plus menu\'s expand-in', () => {
    const s = codeOnly(SIDEBAR());
    // Measured off the live pane: _mat-menu-enter at 120ms cubic-bezier(0, 0, 0.2, 1)
    // from scale(0.8)/opacity 0 to none/1, and _mat-menu-exit at 100ms linear
    // opacity 1 -> 0. This is a Material menu, not a Gemini card; the card animation
    // was applied by analogy and was wrong.
    assert.match(s, /willow-mat-menu-enter/, 'enter animation class');
    assert.match(s, /willow-mat-menu-exit/, 'exit animation class');
    assert.ok(!/willow-gem-menu-in/.test(s),
      'the plus-menu animation should not be used here');

    const css = SIDEBAR_CSS();
    const enter = css.match(/@keyframes willow-mat-menu-enter \{[\s\S]*?\n\}/);
    assert.ok(enter, 'enter keyframes exist');
    assert.match(enter[0], /opacity: 0; transform: scale\(0\.8\)/, 'start from scale(0.8)');
    assert.match(enter[0], /opacity: 1; transform: none/, 'end at none');
    assert.match(css, /120ms cubic-bezier\(0, 0, 0\.2, 1\)/, '120ms decelerate');

    const exit = css.match(/@keyframes willow-mat-menu-exit \{[\s\S]*?\n\}/);
    assert.ok(exit, 'exit keyframes exist');
    assert.match(exit[0], /opacity: 1/, 'start opaque');
    assert.match(exit[0], /opacity: 0/, 'end transparent');
    // The measured exit animates opacity ALONE — its keyframes carry no transform at all,
    // which is why the close is easy to miss. Declaring `transform: none` would be adding
    // a property Gemini's keyframes do not have.
    assert.ok(!/transform/.test(exit[0]), 'the exit is opacity-only, no transform');
    assert.match(css, /willow-mat-menu-exit 100ms linear/, '100ms linear');
  });

  it('keeps the node mounted during the exit fade', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /phase === 'closed'\)/, 'third state gates the unmount');
    assert.match(s, /phase === 'closing' \? 'willow-mat-menu-exit'/, 'exit class during closing phase');
    assert.match(s, /phase === 'closing' \? 'none' : undefined/,
      'pointerEvents:none during exit so clicks pass through');
    assert.match(s, /setTimeout\(\(\) => setPhase\('closed'\), 100\)/,
      'matches the measured 100ms exit exactly');
  });

  it('uses the measured row metrics and hover layer', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /h-9 w-full items-center overflow-hidden rounded-xl px-2/,
      'min-height 36px, corner-medium 12px, 8px inline padding');
    assert.match(s, /hover:bg-\[rgba\(230,230,230,0\.08\)\]/,
      '--lumi-sys-color-states--hover-on-surface, not rgba(255,255,255,.08)');
  });
});

describe('the Chat/Spark tab tooltips', () => {
  // Read off Gemini's own tabs. The Spark button resolves its `aria-describedby` to
  // "Switch to Spark (Ctrl+Shift+S)" and carries `gemtooltipposition="below"`, which is
  // Willow's default placement — so no data-tooltip-position override belongs here.
  //
  // Only the INACTIVE tab has one: Gemini's active tab pairs `app-tab--active` with
  // `mat-mdc-tooltip-disabled`, so the tooltip always describes where you would go.
  //
  // The Chat tab's text could NOT be read from the DOM for exactly that reason — it is the
  // active tab, so Material never materialised its describedby node. It came out of the
  // shipped bundle instead, where one computed getter feeds both tabs:
  //
  //   this.Aa  = shortcutEnabled ? ` (${mac ? "⇧⌘S" : "Ctrl+Shift+S"})` : ""
  //   this.Glb = computed(() => "Switch to PLACEHOLDER_NAME"
  //                .replace("PLACEHOLDER_NAME", mode === 0 ? sparkName : "Chat") + this.Aa)
  //
  // and the template binds `Glb` to gemTooltip on both buttons. The suffix sits outside the
  // ternary, so "Switch to Chat" without it was a partial reading.

  it('uses Gemini\'s exact Spark text, shortcut included', () => {
    assert.match(codeOnly(SIDEBAR()), /'Switch to Spark \(Ctrl\+Shift\+S\)'/,
      'the shortcut is part of the tooltip, not decoration');
  });

  it('carries the same shortcut on the Chat tab, since one getter feeds both', () => {
    assert.match(codeOnly(SIDEBAR()), /'Switch to Chat \(Ctrl\+Shift\+S\)'/,
      'the bundle appends the suffix outside the tab ternary');
  });

  it('shows a tooltip only on the tab you are not on', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /title=\{studioExperience === 'spark' \? undefined : 'Switch to Spark \(Ctrl\+Shift\+S\)'\}/,
      'the Spark tab drops its tooltip when Spark is active');
    assert.match(s, /title=\{studioExperience === 'chat' \? undefined : 'Switch to Chat \(Ctrl\+Shift\+S\)'\}/,
      'the Chat tab drops its tooltip when Chat is active');
  });

  it('leaves the tabs on the default placement', () => {
    // `gemtooltipposition="below"` matches Willow's default. The collapsed rail switch is
    // a different control and keeps its own `right` override.
    const s = codeOnly(SIDEBAR());
    const at = s.indexOf("'Switch to Spark (Ctrl+Shift+S)'");
    assert.ok(at > 0, 'could not locate the Spark tab tooltip');
    const start = s.lastIndexOf('<button', at);
    const end = s.indexOf('</button>', at);
    assert.ok(start > 0 && end > start, 'could not bound the Spark tab element');
    assert.ok(!/data-tooltip-position/.test(s.slice(start, end)),
      'the tab tooltip is below, which is already the default');
  });
});
