/**
 * The left rail: nav rows, the section chevron, the header logo/wordmark, the
 * settings-menu location row, and the collapse staging.
 *
 * Every number here came off the live Gemini app through CDP — `CSS.getStyleSheetText`
 * for authored rules, `CSS.getMatchedStylesForNode` + `CSS.forcePseudoState` for hover
 * states that never appear at rest, and `getBoundingClientRect` for geometry. Where a
 * value is Willow's own choice rather than Gemini's, the test says so explicitly.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const sidebarDir = path.join(repoRoot, 'apps', 'studio', 'src', 'shell', 'sidebar');

const SIDEBAR = () => fs.readFileSync(path.join(sidebarDir, 'Sidebar.tsx'), 'utf8');
const PRIMITIVES = () => fs.readFileSync(path.join(sidebarDir, 'SidebarPrimitives.tsx'), 'utf8');
const SIDEBAR_CSS = () => fs.readFileSync(path.join(sidebarDir, 'Sidebar.css'), 'utf8');

/** Strips comments so a doc block quoting a value can't satisfy an assertion. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('nav row selection and hover', () => {
  it('lights up on hover even when the row is already selected', () => {
    // `.mdc-list-item:hover::before { background-color: rgba(230,230,230,0.08);
    // opacity: 1 }` is NOT gated on `.is-active`, so a selected row still highlights.
    // Pinning the active branch to hover:bg-[#171717] made the selected row inert.
    for (const [name, src] of [['SidebarItem', PRIMITIVES()], ['SparkSidebarItem', SIDEBAR()]]) {
      const s = codeOnly(src);
      assert.match(s, /hover:bg-\[rgba\(230,230,230,0\.08\)\]/,
        `${name}: --lumi-sys-color-states--hover-on-surface`);
      assert.ok(!/hover:bg-\[#171717\]/.test(s),
        `${name}: the active row must not pin its own hover colour`);
    }
  });

  it('uses the measured selected background and nothing else on the row', () => {
    // `.gem-nav-list-item.is-active { background-color: #171717 }` — one declaration.
    assert.match(codeOnly(PRIMITIVES()), /\$\{active \? 'bg-\[#171717\]' : ''\}/);
    assert.match(codeOnly(SIDEBAR()), /active \? 'bg-\[#171717\]' : ''/);
  });

  it('clears every Spark row once a settings view is on screen', () => {
    // Spark's pages all render at `currentView === 'home'`, and the rail keeps
    // listing them while a settings view is open. `sparkLocation` records where
    // Spark was, not whether it is visible, so a row that reads only the location
    // stays highlighted behind Personalization — which the Chat rows, gated on
    // `currentView`, do not do. Every Spark row must carry the view test.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /const isSparkWorkspaceOpen = studioExperience === 'spark' && currentView === 'home'/);

    // Tasks covers three pages, so its gate wraps a parenthesised group.
    assert.match(s, /active=\{\s*isSparkWorkspaceOpen\s*&& \(\s*currentSparkLocation\.page === 'home'/);
    for (const page of ['schedules', 'skills', 'apps']) {
      assert.match(
        s,
        new RegExp(`active=\\{isSparkWorkspaceOpen && currentSparkLocation\\.page === '${page}'\\}`),
        `the ${page} row must test the view as well as the location`,
      );
    }

    // The one that catches a regression whatever the rows are called.
    assert.ok(
      !/active=\{\s*currentSparkLocation/.test(s),
      'a Spark row decides its indicator from the Spark location alone',
    );
  });

  it('bolds the selected label — a deliberate deviation from Gemini', () => {
    // Gemini keeps the active label at weight 400 / #e6e6e6; only the background
    // changes. The weight bump is Willow's, kept because it was asked for by name.
    // If a future measurement pass "corrects" this, it will be undoing a request.
    for (const [name, src] of [['SidebarItem', PRIMITIVES()], ['SparkSidebarItem', SIDEBAR()]]) {
      assert.match(codeOnly(src),
        /active \? 'font-medium text-white' : 'font-normal text-\[#e6e6e6\]'/,
        `${name}: the selected label is bolder and white`);
    }
  });
});

describe('the Chat/Spark tabs', () => {
  it('slides on the measured 400ms curve, via inset-inline-start not transform', () => {
    // `.app-tabs-slider { transition: inset-inline-start .4s cubic-bezier(.25,1,.5,1),
    //                                 width .4s cubic-bezier(.25,1,.5,1) }`
    // with `--chat { inset-inline-start: .125rem }` and `--agent { inset-inline-start: 50% }`.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /left 400ms cubic-bezier\(0\.25, 1, 0\.5, 1\), width 400ms cubic-bezier\(0\.25, 1, 0\.5, 1\)/);
    assert.match(s, /left: studioExperience === 'spark' \? '50%' : '2px'/);
  });

  it('changes only text colour on hover — the tabs have no background layer', () => {
    // `.app-tab { color: rgba(255,255,255,.55); transition: color .2s ease }`
    // `.app-tab--active, .app-tab:hover:not(.app-tab--active) { color: #e3e3e3 }`
    const s = codeOnly(SIDEBAR());
    assert.match(s, /hover:text-\[#e3e3e3\]/, 'measured hover colour, not pure white');
    assert.ok(!/hover:text-white\b/.test(s), '#e3e3e3 is not #ffffff');
  });
});

describe('the section header chevron', () => {
  it('sits 4px from the title, because the title shrink-wraps', () => {
    // `.expandable-section-title { white-space: nowrap; vertical-align: middle }` and
    // nothing else — no flex-1. `.toggle-icon { margin-inline-start: 4px }`. Measured on
    // both sections: "Notebooks" ends at 80.38 with the icon at 84.38; "Recents" ends at
    // 62.28 with the icon at 66.28. A flex-1 title ate the row and pushed the chevron to
    // the far edge, which is the gap that was visible.
    const s = codeOnly(PRIMITIVES());
    const header = s.match(/aria-label=\{`Toggle \$\{title\}`\}[\s\S]*?<\/button>/);
    assert.ok(header, 'could not locate the section header');
    assert.ok(!/\bflex-1\b/.test(header[0]), 'the title must not consume the row');
    assert.ok(!/\bgap-1\b/.test(header[0]), 'spacing comes from the icon margin, not a gap');
    assert.match(header[0], /\bml-1\b/, 'margin-inline-start: 4px');
  });

  it('is hidden at rest and revealed on hover, on the measured curve', () => {
    // `.toggle-icon { opacity: 0; transition: transform .2s cubic-bezier(.2,0,0,1),
    //                 opacity .2s ease }`, with `:hover`/`:focus-visible` -> opacity 1.
    const s = codeOnly(PRIMITIVES());
    assert.match(s, /opacity-0 transition-\[transform,opacity\] duration-200 ease-\[cubic-bezier\(0\.2,0,0,1\)\]/);
    assert.match(s, /group-hover\/section:opacity-100/);
    assert.match(s, /group-focus-visible\/section:opacity-100/);
  });
});

describe('the settings-menu location row', () => {
  it('marks the current location with a 9px filled dot, not an outlined ring', () => {
    // `.location-menu-item-container .location-icon { width: .5625rem; height: .5625rem;
    //   font-size: .5625rem; margin-inline-end: 12px; flex-shrink: 0 }` — 9px — drawn as
    // the Google Symbols `circle` glyph at `font-variation-settings: "FILL" 1`.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /h-\[9px\] w-\[9px\] shrink-0[\s\S]{0,80}?text-\[9px\] leading-\[9px\]/,
      'the measured 9px box');
    assert.match(s, /fontVariationSettings: '"FILL" 1'/, 'filled, so it reads as a dot');
    assert.match(s, /\bmr-3\b/, 'margin-inline-end: 12px');
  });

  it('keeps a hidden copy on the update row purely as a spacer', () => {
    // `.location-update-item .location-icon-spacer { visibility: hidden }` — the glyph is
    // present but invisible, which is what aligns "Update location" (x=281) with the text
    // above it. Removing it and indenting with a margin drifts by a subpixel.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /visibility: 'hidden'/, 'hidden, not absent');
    assert.ok(!/\bml-8\b/.test(s), 'the old 32px text indent stood in for the spacer');
  });

  it('uses the two measured row heights', () => {
    // about-item 284x54 padding 8px radius 12px; update-item 284x36 padding 0 8px.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /h-\[54px\] items-center overflow-hidden rounded-xl p-2/);
    assert.match(s, /Update location[\s\S]{0,40}/);
  });
});

describe('the rail header', () => {
  it('draws the logo at Gemini\'s sparkle size and position', () => {
    // `.sparkle-image { height: 22px; width: 22px }`, measured at (15, 17, 22, 22) inside
    // a 32px button at (14, 12). `ml-[10px] mt-3` on an h-8 w-8 button reproduces both,
    // and also centres the button in the 52px rail ((10+42)/2 = 26), so the glyph does
    // not shift between collapsed and expanded.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /h-\[22px\] w-\[22px\] object-contain/, 'the measured 22px square');
    assert.ok(!/h-7 w-auto object-contain/.test(s), '28px is 6px over the measurement');
    assert.match(s, /ml-\[10px\] mt-3 flex h-8 w-8/, 'button offset and size');
  });

  it('sets the wordmark to the measured 17px/470/24px on-surface', () => {
    // `.gemini-sidenav-text { color: #e6e6e6; margin-inline: 8px }` with
    // `:not(.mobile) { font-size: 17px }`; measured (46, 16, 55.01, 24) at weight 470.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /text-\[17px\] leading-6 text-\[#e6e6e6\]/, 'measured type and colour');
    assert.ok(!/text-\[17\.5px\]/.test(s), '17.5px was half a pixel over');
    assert.ok(!/text-\[#e0e0e0\]/.test(s), 'on-surface is #e6e6e6, not #e0e0e0');
  });
});

describe('the collapse staging', () => {
  it('keeps the rail on Gemini\'s own 300ms width curve', () => {
    // From the compiled bundle, not inferred:
    //   GK("widthTransition", [ JK("open",   EK({width: "var(--bard-sidenav-open-width)"})),
    //                           JK("closed", EK({width: "var(--bard-sidenav-closed-width)"})),
    //                           KK("open => closed", HK("300ms 0ms cubic-bezier(0.2, 0, 0, 1)")),
    //                           KK("closed => open", HK("300ms 0ms cubic-bezier(0.2, 0, 0, 1)")) ])
    // Both directions are the same, so one constant is correct.
    assert.match(codeOnly(SIDEBAR()),
      /GEMINI_SIDEBAR_POSITION_MOTION = '300ms cubic-bezier\(0\.2, 0, 0, 1\)'/);
  });

  it('stages the wordmark and close button behind the width, at the measured delays', () => {
    // `.gemini-sidenav-text.expanded { animation: fadeIn .1s ease forwards;
    //                                  animation-delay: .1s }`
    // `.close-sidenav-button-desktop { opacity: 0; visibility: hidden;
    //    animation: show-close-button 50ms linear .25s forwards }`
    // The 250ms delay lands the button 50ms before the 300ms width settles, so it never
    // paints over a rail narrower than itself.
    const css = SIDEBAR_CSS();
    assert.match(css, /animation: willow-sidenav-text-fade-in 100ms ease 100ms forwards/);
    assert.match(css, /animation: willow-sidenav-show-close-button 50ms linear 250ms forwards/);

    const closeKeyframes = css.match(/@keyframes willow-sidenav-show-close-button \{[\s\S]*?\n\}/);
    assert.ok(closeKeyframes, 'close-button keyframes exist');
    assert.match(closeKeyframes[0], /visibility: visible/,
      'Gemini animates visibility alongside opacity, so the button is unclickable early');

    const s = codeOnly(SIDEBAR());
    assert.match(s, /willow-sidenav-text\b/, 'the wordmark carries the staged class');
    assert.match(s, /willow-sidenav-close-button\b/, 'the close button carries its class');
  });
});

describe('the variable-font width axis', () => {
  it('inherits the measured body axes from the rail, without pinning the weight', () => {
    // Google Sans Flex is variable here (`weight "280 540"`, `stretch "92% 100%"`), and
    // Gemini drives the width axis through a token chain, NOT `font-stretch` (which
    // computes to a flat 100% on every node). 49 of 50 text leaves in Gemini's sidenav
    // compute `"ROND" 0, "slnt" 0, "wdth" 92`, so one inherited rule is the faithful
    // shape. Without it the same string rendered wider than Gemini's: the account name
    // measured 69.1px here against 66.31px there, at identical 15px/400/20px. With it,
    // the live node measures exactly 66.31.
    const css = SIDEBAR_CSS();
    const rule = css.match(/\.studio-sidebar \{[^}]*\}/);
    assert.ok(rule, 'the rail carries a font-variation-settings rule');
    assert.match(rule[0], /font-variation-settings:\s*"ROND" 0, "slnt" 0, "wdth" 92/,
      'the measured body axes, inherited by every descendant');

    // The weight axis is deliberately absent. An inherited `"wght"` overrides
    // `font-weight` on every descendant: pinning 400 collapsed a 500 label from 72.64px
    // onto 70.66px, which would silently kill both the 470 wordmark and the
    // bold-on-selected nav label that was asked for by name.
    assert.ok(!/"wght"/.test(rule[0]),
      'the rail rule must not pin "wght" — it would flatten every bolder label');
  });

  it('gives the wordmark its own axes, which are not the body ones', () => {
    // `.gemini-sidenav-text.gds-title-l-emphasized`: 17px/470/24px at (46,16),
    // "Gemini" 55.01x24, computing `"ROND" 20, "slnt" 0, "wdth" 94, "wght" 470`.
    // ROND 20 / wdth 94 differ from the body's 0 / 92, and because the property
    // replaces rather than merges, the full list has to be restated.
    const css = SIDEBAR_CSS();
    const rule = css.match(/\.willow-sidenav-text \{[^}]*\}/);
    assert.ok(rule, '.willow-sidenav-text exists');
    assert.match(rule[0],
      /font-variation-settings:\s*"ROND" 20, "slnt" 0, "wdth" 94, "wght" 470/,
      'the measured wordmark axes');

    // Widths are NOT comparable between the apps here — "Willow" and "Gemini" are
    // different strings. Only the axes and the 17px/470/24px box transfer.
    const s = codeOnly(SIDEBAR());
    assert.match(s, /text-\[17px\] leading-6/, 'the wordmark box is still 17px/24px');
    assert.match(s, /fontWeight: 470/, 'weight stays in CSS hands, driving the wght axis');
    assert.ok(!/fontVariationSettings: '"wght" 470'/.test(s),
      'the partial inline list is gone — it dropped the inherited ROND/wdth pair');
  });

  it('exempts the beta badge, the one leaf Gemini leaves at `normal`', () => {
    // `.beta-badge` is the single sidebar leaf computing
    // `font-variation-settings: normal` — at 7px the width axis is not applied.
    const css = SIDEBAR_CSS();
    const rule = css.match(/\.studio-sidebar \.willow-beta-badge \{[^}]*\}/);
    assert.ok(rule, 'the badge opts out by class rather than inheriting');
    assert.match(rule[0], /font-variation-settings:\s*normal/);
    assert.match(codeOnly(SIDEBAR()), /willow-beta-badge/, 'the badge carries the class');
  });
});
