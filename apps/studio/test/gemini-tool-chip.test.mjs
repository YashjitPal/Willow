/**
 * Gemini's tool chip: the surface, the two glyph slots, the hover geometry, and the
 * absence of any animation.
 *
 * Every number here was measured off the live Gemini app over CDP. None of it is a
 * design choice, so a failure means the clone drifted from the original — not that a
 * value wants retuning.
 *
 * THE SURFACE. The chip is a single `button` inside `toolbox-drawer`, 24px tall,
 * `border-radius: 9999px`, background `rgba(255,255,255,0.12)`, colour
 * `rgb(230,230,230)`, `padding: 0 8px 0 4px`, `cursor: default`. There is no blue
 * anywhere in it — it is a neutral tonal button. Willow previously rendered it in
 * `#bae6fd` / `bg-sky-500/10` with the source comment "Refined light blue color
 * (sky-200)", i.e. a Tailwind guess, which is exactly the reported defect.
 *
 * THE TWO GLYPH SLOTS. Content is a 4px-gap flex row: tool glyph, label, and — on hover
 * or focus only — a close glyph APPENDED after the label. Gemini's rule is
 * `.on-focus-secondary-icon { display: none }` lifted by `button:hover, button:focus`,
 * so the tool glyph never leaves. Willow used to SWAP the tool glyph for the close
 * glyph, which made the chip appear to change identity under the cursor.
 *
 * THE HOVER GEOMETRY follows from that. The chip grows exactly 16px because the right
 * padding drops 8px -> 4px as the 16px close glyph and its 4px gap arrive. Verified
 * against live rects with the "Deep research" label (43.9px wide):
 *   rest  4 + 16 + 4 + 43.9 + 8            = 75.9  (measured 75.9)
 *   hover 4 + 16 + 4 + 43.9 + 4 + 16 + 4   = 91.9  (measured 91.9)
 *
 * GLYPHS are Luminous Symbols at 16px weight 330, axes
 * `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 16, "wght" 330`. Note `opsz` is 16 here where
 * the plus menu's rows use 20, so the two cannot share one constant. The label is
 * Gemini's shared body token: 13px / 17px, weight 400, `"wdth" 92`.
 *
 * NO ANIMATION, in either direction. rAF traces of the attach (70 frames) and the detach
 * (71 frames) show the field snapping 64 <-> 102px in a single frame, with
 * `getAnimations()` empty on the field, the input area, the leading cluster and
 * `toolbox-drawer` on every frame — against a passing positive control (16 distinct
 * intermediate values on a probe animation in the same page). A separate trace of the
 * chip button itself found opacity 1, transform none and full width from its first
 * painted frame. The `ng-trigger-toolboxDrawerEnter` attribute is present on the
 * container but declares nothing that runs here.
 *
 * LABELS. The chip label is not the menu row's label, and three of Willow's six were
 * wrong. Measured from the live chip:
 *   Create image -> Images | Create video -> Videos | Create music -> Music
 *   Canvas -> Canvas | Deep research -> Deep research | Guided learning -> Learn
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const chatSrc = (...parts) => path.join(repoRoot, 'features', 'chat', 'src', ...parts);

const COMPOSER = () => fs.readFileSync(chatSrc('composer', 'Composer.tsx'), 'utf8');
const OPTIONS = () => fs.readFileSync(chatSrc('composer', 'composer-options.tsx'), 'utf8');

/** Strips comments so a doc block quoting a value can't satisfy an assertion. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The ToolChip component body, isolated so assertions can't pass on unrelated code. */
const chipBody = () => {
  const source = codeOnly(COMPOSER());
  const start = source.indexOf('const ToolChip =');
  assert.ok(start > 0, 'ToolChip component not found in Composer.tsx');
  const end = source.indexOf('\n  };', start);
  assert.ok(end > start, 'could not find the end of ToolChip');
  return source.slice(start, end);
};

describe('the chip surface is neutral, not blue', () => {
  it('uses the measured tonal background and text colour', () => {
    const chip = chipBody();
    assert.match(chip, /bg-\[rgba\(255,255,255,0\.12\)\]/,
      'the chip surface must be rgba(255,255,255,0.12), measured off Gemini');
    assert.match(chip, /text-\[#e6e6e6\]/,
      'chip content must be rgb(230,230,230)');
  });

  it('has no blue left anywhere in it', () => {
    const chip = chipBody();
    assert.ok(!/#bae6fd/i.test(chip), 'the guessed sky-200 blue is still present');
    assert.ok(!/sky-\d|blue-\d|cyan-\d|indigo-\d/.test(chip),
      'a Tailwind blue palette class is still tinting the chip');
  });

  it('keeps the measured box: 24px tall, fully rounded, padding 4px left / 8px right', () => {
    const chip = chipBody();
    assert.match(chip, /\bh-6\b/, 'the chip is 24px tall');
    assert.match(chip, /rounded-full/, 'border-radius is 9999px');
    assert.match(chip, /\bpl-1\b/, 'left padding is 4px');
    assert.match(chip, /\bpr-2\b/, 'resting right padding is 8px');
    assert.match(chip, /cursor-default/, 'Gemini computes cursor: default, not pointer');
  });
});

describe('the close glyph is appended on hover, not swapped in', () => {
  it('renders the tool glyph unconditionally', () => {
    const chip = chipBody();
    // The tool glyph must not sit behind a hover check — Gemini never removes it.
    assert.ok(!/isHovered|hovered\s*\?/.test(chip),
      'a hover state is still deciding which glyph renders; Gemini keeps both');
  });

  it('gates the close glyph on hover/focus via CSS, matching Gemini\'s display rule', () => {
    const chip = chipBody();
    assert.match(chip, /hidden group-hover:flex group-focus-visible:flex/,
      'the close glyph is display:none until hover or focus');
  });

  it('drops the right padding to 4px on hover so the chip grows exactly 16px', () => {
    const chip = chipBody();
    assert.match(chip, /hover:pr-1/, 'hover right padding must be 4px');
    assert.match(chip, /focus-visible:pr-1/, 'focus matches hover, as in Gemini\'s rule');
  });
});

describe('the chip has no animation in either direction', () => {
  it('does not ease the hover growth', () => {
    const chip = chipBody();
    assert.ok(!/transition-|duration-\d/.test(chip),
      'Gemini\'s only authored transition on this button is box-shadow 0.28s, which never '
      + 'changes here, so the hover growth is instant');
  });

  it('does not animate the chip in or out at the render sites', () => {
    const source = codeOnly(COMPOSER());
    for (const match of source.matchAll(/<div className="([^"]*)">\s*<ToolChip/g)) {
      assert.ok(!/animate-in|animate-out|fade-in|zoom-in|slide-in|duration-\d/.test(match[1]),
        `the chip wrapper "${match[1]}" animates; measured traces of Gemini's attach `
        + '(70 frames) and detach (71 frames) show zero running animations');
    }
  });
});

describe('the glyph and label typography', () => {
  it('uses the measured 16px Luminous axes, distinct from the plus menu\'s 20px set', () => {
    const source = codeOnly(COMPOSER());
    assert.match(source,
      /CHIP_GLYPH_AXES\s*=\s*'"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 16, "wght" 330'/,
      'chip glyph axes must be opsz 16 / wght 330');
    const chip = chipBody();
    assert.match(chip, /family="luminous"/, 'tool glyphs are Luminous Symbols');
    assert.match(chip, /variationSettings=\{CHIP_GLYPH_AXES\}/,
      'the axes must be passed explicitly — MaterialSymbol writes fontVariationSettings '
      + 'inline, which replaces the property wholesale rather than merging');
  });

  it('uses Gemini\'s shared body token for the label', () => {
    const source = codeOnly(COMPOSER());
    assert.match(source,
      /CHIP_LABEL_STYLE[\s\S]{0,220}fontVariationSettings:\s*'"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400'/,
      'the label carries the shared body axes with wdth 92');
    const chip = chipBody();
    assert.match(chip, /text-\[13px\][^"]*leading-\[17px\]/,
      'the label is 13px / 17px, measured');
    assert.match(chip, /style=\{CHIP_LABEL_STYLE\}/);
  });

  it('states the font family, without which wdth 92 is silently inert', () => {
    // Measured: Gemini renders this label in Google Sans Flex, whose wdth axis is live
    // ("Music" 35.29px at wdth 92 vs 36.67px at 100). Willow's default face is Inter,
    // which has no wdth axis — so omitting the family made every chip ~1.6px too wide
    // (67.29 measured on Gemini vs 68.88 rendered by Willow) with no other visible clue.
    const source = codeOnly(COMPOSER());
    assert.match(source,
      /CHIP_LABEL_STYLE[\s\S]{0,220}fontFamily:\s*'"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif'/,
      'the chip label must name Google Sans Flex explicitly');
  });
});

describe('the chip labels match the live chip, not the menu row', () => {
  it('carries Gemini\'s six measured labels', () => {
    const source = codeOnly(OPTIONS());
    const expected = {
      images: 'Images',
      video: 'Videos',
      music: 'Music',
      canvas: 'Canvas',
      research: 'Deep research',
      learn: 'Learn',
    };
    for (const [id, label] of Object.entries(expected)) {
      const row = source.match(new RegExp(`\\b${id}:\\s*\\{[^}]*\\}`));
      assert.ok(row, `no TOOLS entry for ${id}`);
      assert.match(row[0], new RegExp(`chipLabel:\\s*'${label}'`),
        `${id} must show "${label}" on the chip`);
    }
  });

  it('names the chip by Gemini\'s own accessible name', () => {
    const chip = chipBody();
    assert.match(chip, /aria-label=\{`Deselect \$\{tool\.chipLabel\}`\}/,
      'Gemini labels the whole chip "Deselect <label>"');
  });
});
