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
    assert.match(s, /px-\[5px\]/, '.mavatar-footer-left pads 5px at the start');
    assert.match(s, /marginLeft: isCollapsed \? '0px' : '8px'/,
      '.mavatar-footer-left gap is --gem-sys-spacing--s = 8px');
  });

  it('shows the name at on-surface, not a translucent white', () => {
    // `.mavatar-user-name { color: var(--lumi-sys-color--on-surface) }` — a flat #e6e6e6.
    // `text-white/80` is rgba(255,255,255,0.8), which reads differently over #1f1f1f.
    const s = codeOnly(SIDEBAR());
    const row = s.match(/userProfile\?\.displayName \|\| user\?\.email \|\| 'Account'/);
    assert.ok(row, 'could not locate the user-name node');
    assert.match(s, /text-\[13px\] text-\[#e6e6e6\]/, 'measured name colour');
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

  it('opens with the same expand-in animation as the plus menu', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /className="willow-gem-menu-in absolute/, 'the pane must animate in');
    assert.match(s, /transformOrigin: '0 100%'/,
      'anchored bottom-left, so it grows up and right from the gear');

    const css = SIDEBAR_CSS();
    const block = css.match(/@keyframes willow-gem-menu-in \{[\s\S]*?\n\}/);
    assert.ok(block, 'the keyframes must be defined where the sidebar can see them');
    assert.match(block[0], /opacity: 0\.25/, 'Gemini starts at .25, not 0');
    assert.match(block[0], /transform: scale\(0\.5\)/, 'and at half scale, not 0');
    assert.match(css, /animation: willow-gem-menu-in 0\.1s ease-in-out/);
  });

  it('keeps the analogy honest in the comment', () => {
    // The settings pane's own animation was never sampled — the tab was occluded by the
    // time that capture was attempted. It is applied because Gemini's card rule groups
    // `.mat-mdc-menu-panel.lm-menu-theme` with the plus-menu cards. Say so.
    assert.match(SIDEBAR_CSS(), /APPLIED BY ANALOGY/,
      'an inferred animation must stay labelled as inferred');
  });

  it('uses the measured row metrics and hover layer', () => {
    const s = codeOnly(SIDEBAR());
    assert.match(s, /h-9 w-full items-center overflow-hidden rounded-xl px-2/,
      'min-height 36px, corner-medium 12px, 8px inline padding');
    assert.match(s, /hover:bg-\[rgba\(230,230,230,0\.08\)\]/,
      '--lumi-sys-color-states--hover-on-surface, not rgba(255,255,255,.08)');
  });
});
