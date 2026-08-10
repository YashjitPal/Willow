/**
 * Gemini's plus menu: the panel, the rows, both icon fonts, and the enter animation.
 *
 * Every value asserted here was read off the running gemini.google.com over CDP, and each
 * one is corroborated by Gemini's own authored CSS, fetched through CDP's CSS domain
 * (`CSS.getStyleSheetText` over all 100 stylesheets). Where the two could disagree they
 * did not, so a failure here means the clone drifted — not that a number wants retuning.
 *
 * THE PANEL, from the authored rule:
 *
 *   .mat-mdc-card.card-container.lm-menu-theme, .mat-mdc-card.more-uploads-card-container.lm-menu-theme,
 *   .mat-mdc-card.toolbox-drawer-simplified-more-menu-card.lm-menu-theme {
 *     background-color: var(--lumi-sys-color--surface-bright);
 *     border-radius: var(--gem-sys-shape--corner-large-increased);
 *     box-shadow: <elevation level 1>;
 *     padding: var(--gem-sys-spacing--s); }
 *
 * with the dark-theme tokens resolving to #1f1f1f, 20px, 0 0 20px rgba(0,0,0,.28) and 8px.
 * Measured widths: root 249px, More uploads 220px, More tools 253px.
 *
 * THE ROWS, from the authored rule:
 *
 *   .mat-mdc-list-item.lm-menu-item-theme { padding: 0 var(--gem-sys-spacing--s); gap: 0;
 *     min-height: 36px; border-radius: var(--gem-sys-shape--corner-medium); }
 *
 * Hover is an MDC state layer measured at rgba(230,230,230,0.08) — which is exactly
 * `--lumi-sys-color-states--hover-on-surface` — with `transition: all 0s`. Gemini snaps it
 * in; a fade would be wrong.
 *
 * TWO ICON FONTS, not interchangeable. Every tool glyph and chevron is Luminous Symbols at
 * `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320`; `drive` and `more_horiz` are
 * Google Symbols. Names are each mat-icon's own `data-mat-icon-name`.
 *
 * THE ENTER ANIMATION, from the authored keyframes:
 *
 *   @keyframes expand-in { 0% { opacity:.25; transform:scale(.5) } to { opacity:1; transform:scale(1) } }
 *   .card-container { animation: expand-in .1s ease-in-out }
 *
 * It starts at half scale and quarter opacity, not from zero. Confirmed live by sampling
 * getAnimations() the frame each pane appeared, on the root menu and both submenus.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const chatSrc = (...p) => path.join(repoRoot, 'features', 'chat', 'src', 'composer', ...p);

const MENU = () => fs.readFileSync(chatSrc('PlusDropdownMenu.tsx'), 'utf8');
const OPTIONS = () => fs.readFileSync(chatSrc('composer-options.tsx'), 'utf8');
const CSS = () => fs.readFileSync(chatSrc('Composer.css'), 'utf8');

/** Strips comments so a doc block quoting a value can't satisfy an assertion. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the plus menu panel', () => {
  it('is 249px on the measured surface, with 20px corners and 8px padding', () => {
    const s = codeOnly(MENU());
    assert.match(s, /SURFACE = '#1f1f1f'/, 'surface-bright resolves to #1f1f1f in dark theme');
    assert.match(s, /width=\{249\}/, 'root card measured 249px wide');
    assert.match(s, /borderRadius: 20/, 'corner-large-increased is 20px');
    assert.match(s, /padding: 8/, 'gem-sys-spacing--s is 8px');
    assert.match(s, /MENU_SHADOW = '0 0 20px rgba\(0,0,0,0\.28\)'/, 'elevation level 1');
  });

  it('uses the measured submenu widths', () => {
    const s = codeOnly(MENU());
    assert.match(s, /width=\{220\}/, 'More uploads card measured 220px');
    assert.match(s, /width=\{253\}/, 'More tools card measured 253px');
  });

  it('opens bottom-left when it opens upward, top-left for submenus', () => {
    // Measured transform-origin: root `0px 320.8px` (its own height) because Gemini's
    // composer is bottom-docked; both submenus `0px 0px`.
    const s = codeOnly(MENU());
    assert.match(s, /origin=\{side === 'top' \? '0 100%' : '0 0'\}/,
      'the root card pivots on the corner it grows from');
    assert.match(s, /origin="0 0"/, 'submenus pivot top-left');
  });
});

describe('the rows', () => {
  it('are 36px with 12px corners and 8px inline padding', () => {
    const s = codeOnly(MENU());
    assert.match(s, /h-9 w-full items-center rounded-xl px-2/,
      'min-height 36px (h-9), corner-medium 12px (rounded-xl), padding 0 8px (px-2)');
  });

  it('snaps the hover layer in with no transition', () => {
    const s = codeOnly(MENU());
    assert.match(s, /HOVER_LAYER = 'rgba\(230,230,230,0\.08\)'/,
      'measured state layer, == --lumi-sys-color-states--hover-on-surface');
    // The layer is its own node so it can toggle opacity without a transition. If a
    // duration ever appears on it, Gemini's instant reveal has been lost.
    const layer = s.match(/group-hover\/row:opacity-100[^/]*/);
    assert.ok(layer, 'the hover layer must be opacity-toggled');
    assert.ok(
      !/transition-\[opacity\]|duration-\d+/.test(s.split('HOVER_LAYER')[1]?.slice(0, 2000) ?? ''),
      'Gemini computes transition: all 0s on the row — no fade',
    );
  });

  it('insets the icon 8px and the label 40px or 44px', () => {
    const s = codeOnly(MENU());
    // Icon box 24x24 at the row's 8px padding; glyph itself 20px inside it.
    assert.match(s, /h-6 w-6 shrink-0 items-center justify-center/, '24px icon box');
    assert.match(s, /size=\{20\}/, 'glyph renders at 20px inside the 24px box');
    // 40 on the uploader rows, 44 on the tool rows — a real 4px difference between
    // Gemini's two row templates, measured on every row of each.
    assert.match(s, /labelInset\?: 40 \| 44/, 'only the two measured insets are allowed');
    assert.match(s, /labelInset = 40/, 'uploader rows default to 40');
    assert.match(s, /labelInset=\{44\}/, 'tool rows use 44');
  });
});

describe('the two icon fonts', () => {
  it('keeps drive and more_horiz on Google Symbols and everything else on Luminous', () => {
    const s = codeOnly(MENU());
    // Whitespace-tolerant: the two "More …" rows are written as multi-line JSX.
    assert.match(s, /glyph="drive"\s+family="google-symbols"/);
    assert.match(s, /glyph="more_horiz"\s+family="google-symbols"/);
    assert.match(s, /name="chevron_right"\s+family="luminous"/);
    assert.match(s, /family = 'luminous'/, 'Luminous is the default, as it is on most rows');
  });

  it('carries the measured Luminous variation axes', () => {
    assert.match(
      codeOnly(MENU()),
      /"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320/,
      'read off every Luminous glyph in the menu',
    );
  });

  it('maps each tool to the glyph Gemini uses for it', () => {
    const s = codeOnly(OPTIONS());
    for (const [tool, glyph] of [
      ['images', 'image_create'], ['video', 'movie'], ['music', 'music'],
      ['canvas', 'canvas'], ['research', 'deep_research'], ['learn', 'guided_learning'],
    ]) {
      assert.match(s, new RegExp(`${tool}: '${glyph}'`), `${tool} -> ${glyph}`);
    }
  });
});

describe('the tool set matches Gemini', () => {
  it('drops the tools Gemini has no row for', () => {
    const s = codeOnly(OPTIONS());
    for (const gone of ['thinking', 'quizzes', 'spotify', "'web'"]) {
      assert.ok(!s.includes(gone), `${gone} is not in Gemini's menu`);
    }
  });

  it('offers exactly the six selectable tools Gemini offers', () => {
    const s = codeOnly(OPTIONS());
    assert.match(
      s,
      /export type ToolId = 'images' \| 'video' \| 'music' \| 'canvas' \| 'research' \| 'learn'/,
      'Create image / video / music / Canvas on the root, Deep research / Guided learning under More tools',
    );
  });

  it('labels them the way Gemini does', () => {
    const s = codeOnly(OPTIONS());
    for (const label of ['Create image', 'Create video', 'Create music', 'Canvas',
                         'Deep research', 'Guided learning']) {
      assert.ok(s.includes(`label: '${label}'`), `missing row label "${label}"`);
    }
    assert.ok(!s.includes('Study and learn'), 'Gemini calls it Guided learning');
  });
});

describe('the enter animation', () => {
  it('starts at half scale and quarter opacity over 100ms ease-in-out', () => {
    const css = CSS();
    const block = css.match(/@keyframes willow-gem-menu-in \{[\s\S]*?\n\}/);
    assert.ok(block, 'the keyframes must exist');
    assert.match(block[0], /opacity: 0\.25/, 'Gemini starts at .25, not 0');
    assert.match(block[0], /transform: scale\(0\.5\)/, 'and at half scale, not 0');
    assert.match(css, /animation: willow-gem-menu-in 0\.1s ease-in-out/,
      'authored as `expand-in .1s ease-in-out`');
  });

  it('has no leave animation, because Gemini removes the pane outright', () => {
    const s = codeOnly(MENU());
    assert.ok(!/exit|leave|willow-gem-menu-out/.test(s),
      'every element in Gemini\'s menu computes transition: all 0s');
  });

  it('is applied to every card, root and submenu alike', () => {
    assert.match(codeOnly(MENU()), /className=\{`willow-gem-menu-in/,
      'MenuCard carries the animation, so both submenus inherit it');
  });
});

describe('the submenus sit outside the scrolling card', () => {
  // Gemini puts each submenu in its own `cdk-overlay-pane` on the body, so the parent
  // card's `overflow: auto` never sees it. Nesting them inside the card instead made the
  // card treat the submenu as overflow: it clipped it, grew both scrollbars, and scrolled
  // sideways far enough to cut its own labels off ("Upload files" rendering as "files").
  it('renders both submenus after the root card closes, not within it', () => {
    const s = codeOnly(MENU());
    const rootClose = s.indexOf('</MenuCard>');
    assert.ok(rootClose > 0, 'could not find the root card');

    for (const which of ['uploads', 'tools']) {
      const at = s.indexOf(`{openSub === '${which}' && (`);
      assert.ok(at > 0, `could not find the ${which} submenu render`);
      assert.ok(
        at > rootClose,
        `the ${which} submenu is inside the card, which will clip it and add scrollbars`,
      );
    }
  });

  it('positions them from the trigger row rather than a nested anchor', () => {
    const s = codeOnly(MENU());
    assert.match(s, /const SUB_LEFT = 249 - 8/,
      'the submenu card overhangs the parent content edge by its own 8px padding');
    assert.match(s, /style=\{\{ left: SUB_LEFT, top: subTop - 8 \}\}/,
      'siblings need the row offset passed in; a nested anchor could use top-[-8px]');
    assert.match(s, /if \(trigger\) setSubTop\(trigger\.offsetTop\)/,
      'the offset is read off the trigger when the submenu opens');
  });
});

describe('the Personal Intelligence row', () => {
  it('is 48px with a Labs subtitle at the measured colour', () => {
    const s = codeOnly(MENU());
    assert.match(s, /h-12 w-full items-center rounded-xl px-2/, 'measured 48px tall, not 36');
    assert.match(s, /rgba\(255,255,255,0\.55\)/, 'the "Labs" subtitle colour, measured');
    assert.match(s, />\s*Labs\s*</, 'the subtitle text');
  });

  it('draws the switch at the measured tokens and scale', () => {
    const s = codeOnly(MENU());
    assert.match(s, /width: 52, height: 32/, 'MDC intrinsic track');
    assert.match(s, /transform: 'scale\(0\.75\)'/, 'rendered 39x24 == 52x32 at .75');
    assert.match(s, /'#a8c7fa'/, 'selected track, measured');
    assert.match(s, /'#444746'/, 'unselected track, measured');
    assert.match(s, /'#062e6f'/, '--mat-slide-toggle-selected-handle-color');
    assert.match(s, /'#8e918f'/, '--mat-slide-toggle-unselected-handle-color');
    assert.match(s, /#d3e3fd/, 'the check glyph fill, measured');
    assert.match(s, /width: checked \? 24 : 16/, 'selected handle 24px, unselected 16px');
    assert.match(s, /75ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/, 'measured handle motion');
  });

  it('flags the one glyph that could not be measured', () => {
    // Gemini renders this icon as a masked span with no data-mat-icon-name, and the rule
    // holding its mask never loaded during capture. The name follows the convention every
    // other glyph obeys, but it is inferred — the comment must keep saying so.
    const raw = MENU();
    assert.match(raw, /INFERENCE, not a measurement/,
      'the inferred glyph must stay labelled as inferred');
    assert.match(codeOnly(raw), /name="personal_intelligence"/);
  });
});
