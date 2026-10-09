/**
 * The home glow's accent stop, checked against the measurement it came from.
 *
 * Gemini's rule names one token for the accent —
 * `var(--lumi-sys-color--surface-accent) 50%` — and in dark theme that token
 * resolves to `#14204f`. That was confirmed three ways off the live app: the
 * authored declaration under `:where(.theme-host):where(.dark-theme)`, the value
 * resolved on both `body` and the glow host, and the host's own `::before`
 * re-resolved with `is-temporary-chat` lifted, which painted `rgb(20, 32, 79)`.
 * The same probe showed `backgroundImage` is the ONLY property that differs
 * between normal and temporary chat.
 *
 * Baked colour constants drift from the transform that produced them, so this
 * re-runs the derivation and requires the constants to equal its output. The
 * transform is anchored rather than asserted into existence: applied to the blue
 * swatch it has to reproduce Gemini's `#14204f`, which is the one pair that can
 * falsify it.
 *
 * Two requirements are pinned beyond equality because both are easy to lose in a
 * refactor and neither shows up in a spot check:
 *
 *   green's accents are held, since green is the default, and the desktop glow's
 *   green is the held one carried across the step Gemini's own blue took when its
 *   desktop glow changed, so it brightens with every other colour
 *
 *   temporary chat must keep its literal gray at every workspace colour — in
 *   Gemini `is-temporary-chat` replaces the accent stop outright
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const INDEX_HTML = () => read(appDir, 'index.html');
const MEDIA_HOME = () => read(repoRoot, 'features', 'media', 'src', 'MediaHome.tsx');

/** Strip comments before any *absence* assertion — this file quotes the values it replaced. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

const flat = (source) => source.replace(/\s+/g, ' ');

const glowModule = path.join(repoRoot, 'features', 'media', 'src', 'home-glow.ts');
const {
  DEFAULT_GLOW_ACCENT,
  DEFAULT_GLOW_ACCENT_LIGHT,
  DEFAULT_GLOW_ACCENT_MOBILE,
  GEMINI_GLOW_ACCENT_HEX,
  GEMINI_GLOW_ACCENT_LIGHT_HEX,
  GEMINI_GLOW_ACCENT_MOBILE_HEX,
  GLOW_ACCENT_TRANSFORM,
  GLOW_ACCENT_LIGHT_TRANSFORM,
  GLOW_ACCENT_MOBILE_TRANSFORM,
  GLOW_ACCENT_DESKTOP_STEP,
  DEFAULT_GLOW_ACCENT_DESKTOP,
  HOME_GLOW_ACCENT,
  HOME_GLOW_ACCENT_LIGHT,
  HOME_GLOW_DESKTOP_ACCENT,
  HOME_GLOW_MOBILE_ACCENT,
  WORKSPACE_COLOR_HEX,
  deriveGlowAccent,
  deriveGlowAccentLight,
  deriveGlowMobileAccent,
  homeGlowAccent,
  homeGlowAccentLight,
  homeGlowDesktopAccent,
  homeGlowMobileAccent,
  stepGlowAccentToDesktop,
} = await importTs(glowModule);

const asRgb = (hex) => {
  const n = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${n.join(', ')})`;
};

// ── The measurement ─────────────────────────────────────────────────────────

it('carries Gemini\'s measured accent for blue', () => {
  assert.equal(GEMINI_GLOW_ACCENT_HEX, '#14204f',
    'the accent drifted from Gemini\'s measured --lumi-sys-color--surface-accent');
  assert.equal(HOME_GLOW_ACCENT.blue, 'rgb(20, 32, 79)',
    'the blue glow is no longer Gemini\'s #14204f');
  assert.equal(HOME_GLOW_ACCENT.blue, asRgb(GEMINI_GLOW_ACCENT_HEX),
    'the baked blue and the measured hex disagree');
});

it('anchors the transform on the Gemini pair it was measured from', () => {
  // Applied to the blue swatch, the transform must land back on Gemini's token.
  // This is what makes the other three swatches Gemini's relationship rather
  // than a choice: if this drifts, they are all meaningless.
  assert.equal(deriveGlowAccent(WORKSPACE_COLOR_HEX.blue), asRgb(GEMINI_GLOW_ACCENT_HEX),
    'the transform no longer reproduces #14204f from #3b82f6 — it is not Gemini\'s any more');
});

it('keeps every derived accent equal to the derivation', () => {
  for (const name of ['pink', 'yellow', 'orange', 'purple', 'lilac', 'coral', 'teal']) {
    assert.equal(
      HOME_GLOW_ACCENT[name],
      deriveGlowAccent(WORKSPACE_COLOR_HEX[name]),
      `the baked ${name} accent drifted from deriveGlowAccent(${WORKSPACE_COLOR_HEX[name]})`,
    );
  }
});

it('covers every workspace swatch exactly once', () => {
  assert.deepEqual(
    Object.keys(HOME_GLOW_ACCENT).sort(),
    Object.keys(WORKSPACE_COLOR_HEX).sort(),
    'the glow accents and the workspace swatches have diverged',
  );
});

it('carries Gemini\'s measured light accent for blue', () => {
  assert.equal(GEMINI_GLOW_ACCENT_LIGHT_HEX, '#9dd2ff',
    'the light accent drifted from Gemini\'s measured --bard-color-lm-glow-chat');
  assert.equal(HOME_GLOW_ACCENT_LIGHT.blue, 'rgb(157, 210, 255)',
    'the blue light glow is no longer Gemini\'s #9dd2ff');
  assert.equal(HOME_GLOW_ACCENT_LIGHT.blue, asRgb(GEMINI_GLOW_ACCENT_LIGHT_HEX),
    'the baked blue light accent and the measured hex disagree');
});

it('anchors the light transform on the Gemini pair it was measured from', () => {
  assert.equal(deriveGlowAccentLight(WORKSPACE_COLOR_HEX.blue), asRgb(GEMINI_GLOW_ACCENT_LIGHT_HEX),
    'the light transform no longer reproduces #9dd2ff from #3b82f6');
});

it('keeps every derived light accent equal to the derivation', () => {
  for (const name of Object.keys(HOME_GLOW_ACCENT_LIGHT)) {
    assert.equal(
      HOME_GLOW_ACCENT_LIGHT[name],
      deriveGlowAccentLight(WORKSPACE_COLOR_HEX[name]),
      `the baked ${name} light accent drifted from deriveGlowAccentLight(${WORKSPACE_COLOR_HEX[name]})`,
    );
  }
});

it('carries Gemini\'s measured mobile accent for blue', () => {
  assert.equal(GEMINI_GLOW_ACCENT_MOBILE_HEX, '#1f3b9b',
    'the mobile accent drifted from Gemini\'s measured --bard-color-lm-glow-chat');
  assert.equal(HOME_GLOW_MOBILE_ACCENT.blue, 'rgb(31, 59, 155)',
    'the blue mobile glow is no longer Gemini\'s #1f3b9b');
  assert.equal(HOME_GLOW_MOBILE_ACCENT.blue, asRgb(GEMINI_GLOW_ACCENT_MOBILE_HEX),
    'the baked blue and the measured mobile hex disagree');
});

it('anchors the mobile transform on the Gemini pair it was measured from', () => {
  assert.equal(deriveGlowMobileAccent(WORKSPACE_COLOR_HEX.blue), asRgb(GEMINI_GLOW_ACCENT_MOBILE_HEX),
    'the mobile transform no longer reproduces #1f3b9b from #3b82f6');
});

it('keeps every derived mobile accent equal to the derivation', () => {
  for (const name of Object.keys(HOME_GLOW_MOBILE_ACCENT)) {
    assert.equal(
      HOME_GLOW_MOBILE_ACCENT[name],
      deriveGlowMobileAccent(WORKSPACE_COLOR_HEX[name]),
      `the baked ${name} mobile accent drifted from deriveGlowMobileAccent(${WORKSPACE_COLOR_HEX[name]})`,
    );
  }
});

// ── Green is the default and must not move ──────────────────────────────────

it('holds green at the colour that ships today', () => {
  assert.equal(DEFAULT_GLOW_ACCENT, 'rgb(6, 78, 59)',
    'the default glow green changed — switching back to green no longer restores it');
  assert.equal(HOME_GLOW_ACCENT.green, DEFAULT_GLOW_ACCENT,
    'green is no longer the default accent');
  assert.equal(DEFAULT_GLOW_ACCENT_LIGHT, 'rgb(158, 174, 153)',
    'the default light glow green changed');
  assert.equal(HOME_GLOW_ACCENT_LIGHT.green, DEFAULT_GLOW_ACCENT_LIGHT,
    'green is no longer the default light accent');
  assert.equal(DEFAULT_GLOW_ACCENT_MOBILE, 'rgb(19, 67, 44)',
    'the default mobile glow green changed');
  assert.equal(HOME_GLOW_MOBILE_ACCENT.green, DEFAULT_GLOW_ACCENT_MOBILE,
    'green is no longer the default mobile accent');
});

it('falls back to green for a missing or unknown workspace colour', () => {
  for (const value of [undefined, null, '', 'magenta', 'GREEN']) {
    assert.equal(homeGlowAccent(value), DEFAULT_GLOW_ACCENT,
      `homeGlowAccent(${JSON.stringify(value)}) must fall back to the default green`);
    assert.equal(homeGlowAccentLight(value), DEFAULT_GLOW_ACCENT_LIGHT,
      `homeGlowAccentLight(${JSON.stringify(value)}) must fall back to default light green`);
    assert.equal(homeGlowMobileAccent(value), DEFAULT_GLOW_ACCENT_MOBILE,
      `homeGlowMobileAccent(${JSON.stringify(value)}) must fall back to default mobile green`);
  }
  assert.equal(homeGlowAccent('blue'), 'rgb(20, 32, 79)');
  assert.equal(homeGlowAccentLight('blue'), 'rgb(157, 210, 255)');
  assert.equal(homeGlowMobileAccent('blue'), 'rgb(31, 59, 155)');
  assert.equal(homeGlowAccent('green'), 'rgb(6, 78, 59)');
  assert.equal(homeGlowAccentLight('green'), 'rgb(158, 174, 153)');
  assert.equal(homeGlowMobileAccent('green'), 'rgb(19, 67, 44)');
});

// ── The desktop accent ──────────────────────────────────────────────────────

it('anchors the desktop step on Gemini\'s two measured blues', async () => {
  const { hexToRgb, rgbToOklch } = await importTs(path.join(repoRoot, 'features', 'chat', 'src', 'voice-orb', 'orb-palette.ts'));
  const [Lo, Co, ho] = rgbToOklch(hexToRgb(GEMINI_GLOW_ACCENT_HEX));
  const [Ln, Cn, hn] = rgbToOklch(hexToRgb(GEMINI_GLOW_ACCENT_MOBILE_HEX));
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(close(GLOW_ACCENT_DESKTOP_STEP.lightnessRatio, Ln / Lo), 'the lightness step is not #14204f -> #1f3b9b');
  assert.ok(close(GLOW_ACCENT_DESKTOP_STEP.chromaRatio, Cn / Co), 'the chroma step is not #14204f -> #1f3b9b');
  assert.ok(close(GLOW_ACCENT_DESKTOP_STEP.hueShiftDeg, ((hn - ho + 540) % 360) - 180), 'the hue step is not #14204f -> #1f3b9b');
  assert.equal(stepGlowAccentToDesktop(asRgb(GEMINI_GLOW_ACCENT_HEX)), asRgb(GEMINI_GLOW_ACCENT_MOBILE_HEX),
    'the step no longer carries Gemini\'s old blue onto its new one');
});

it('brightens every colour\'s desktop glow by the step Gemini\'s blue took', () => {
  // The derived swatches took the step by construction; green, whose old accent was
  // hand-picked, has to be carried across it, or it alone would dim while the rest brighten.
  assert.equal(DEFAULT_GLOW_ACCENT_DESKTOP, stepGlowAccentToDesktop(DEFAULT_GLOW_ACCENT),
    'the desktop green is not the shipped green carried across the step');
  assert.equal(HOME_GLOW_DESKTOP_ACCENT.green, DEFAULT_GLOW_ACCENT_DESKTOP);
  for (const name of Object.keys(HOME_GLOW_ACCENT)) {
    const want = stepGlowAccentToDesktop(HOME_GLOW_ACCENT[name]).match(/\d+/g).map(Number);
    const got = HOME_GLOW_DESKTOP_ACCENT[name].match(/\d+/g).map(Number);
    assert.ok(got.every((c, i) => Math.abs(c - want[i]) <= 1),
      `${name}'s desktop glow ${HOME_GLOW_DESKTOP_ACCENT[name]} is not its old ${HOME_GLOW_ACCENT[name]} brightened like blue (${want.join(', ')})`);
    if (name !== 'green') {
      assert.equal(HOME_GLOW_DESKTOP_ACCENT[name], HOME_GLOW_MOBILE_ACCENT[name],
        `${name} differs between the desktop and mobile glows, which share Gemini's token`);
    }
  }
  assert.deepEqual(Object.keys(HOME_GLOW_DESKTOP_ACCENT).sort(), Object.keys(WORKSPACE_COLOR_HEX).sort());
  for (const value of [undefined, null, '', 'magenta']) {
    assert.equal(homeGlowDesktopAccent(value), DEFAULT_GLOW_ACCENT_DESKTOP);
  }
  assert.equal(homeGlowDesktopAccent('blue'), 'rgb(31, 59, 155)');
});

// ── The CSS and the host ────────────────────────────────────────────────────

it('drives the accent through custom properties, with green as the fallback', () => {
  const css = flat(INDEX_HTML());

  assert.match(
    css,
    /\.willow-gemini-home-glow > \.willow-home-glow-layer::before \{[^}]*background: var\(--willow-home-glow-desktop-accent, rgb\(0, 140, 103\)\);/,
    'the desktop glow no longer reads its accent from --willow-home-glow-desktop-accent with the green fallback',
  );

  assert.match(
    css,
    /:is\(\.light-theme, \[data-theme="light"\]\) \.willow-gemini-home-glow > \.willow-home-glow-layer::before \{ background: var\(--willow-home-glow-accent, rgb\(158, 174, 153\)\); \}/,
    'the light desktop glow no longer takes the light accent, Gemini\'s #9dd2ff for blue',
  );

  // The fallback is what paints before the profile loads. Without it the stop is
  // invalid and the whole gradient is dropped — the glow disappears, it does not
  // merely lose its colour.
  assert.ok(
    !/var\(--willow-home-glow-accent\)/.test(codeOnly(INDEX_HTML())),
    'the accent var lost its fallback — the glow will vanish until the profile loads',
  );
});

it('sets the accent on the glow host so ::before inherits it', () => {
  const source = codeOnly(MEDIA_HOME());

  assert.match(source, /homeGlowAccent\(workspaceColor\)/,
    'the glow accent is no longer derived from the workspace colour');
  assert.match(source, /'--willow-home-glow-accent': glowAccent/,
    'the accent custom property is not being set on the glow host');
  assert.match(source, /homeGlowDesktopAccent\(workspaceColor\)/,
    'the desktop accent is no longer derived from the workspace colour');
  assert.match(source, /'--willow-home-glow-desktop-accent': glowAccentDesktop/,
    'the desktop accent custom property is not being set on the glow host');
  // Above 960px the glow paints on a layer inside the host, which inherits the accents from it.
  assert.match(source, /\{initialMode === 'chat' && <div className="willow-home-glow-layer" aria-hidden="true" \/>\}/,
    'the desktop glow layer is no longer rendered inside the glow host');

  // It has to be the same element that carries `willow-gemini-home-glow`:
  // a custom property on a parent would inherit, but one on a child would not
  // reach the ::before at all.
  //
  // The class reaches the host through `glowClass` rather than inline, because
  // it is now also gated on the greeting being ready — the glow and the heading
  // are one visual event and must not arrive separately. So this checks the
  // binding in two steps: the host interpolates `glowClass`, and `glowClass` is
  // the glow class. Following the indirection keeps the original guarantee
  // (same element carries both) instead of weakening it to "appears somewhere".
  const host = source.match(/<div\s+className=\{`flex-1 flex flex-col items-center[\s\S]{0,600}?\/>|<div\s+className=\{`flex-1 flex flex-col items-center[\s\S]{0,600}?>/);
  assert.ok(host, 'could not locate the glow host div');
  assert.ok(/\$\{glowClass\}/.test(host[0]),
    'the glow class is not on the element that declares the accent');
  assert.ok(/--willow-home-glow-accent/.test(host[0]),
    'the accent property is not on the element that carries the glow class');

  const glowClass = source.match(/const glowClass =([\s\S]{0,300}?);/);
  assert.ok(glowClass, 'could not locate the glowClass binding');
  assert.match(glowClass[1], /willow-gemini-home-glow/,
    'glowClass no longer resolves to the glow class');
  assert.match(glowClass[1], /initialMode === 'chat'/,
    'the glow is no longer restricted to chat mode');
  assert.match(glowClass[1], /isGreetingReady/,
    'the glow no longer waits for the greeting — the two must arrive together');
});

it('keeps temporary chat on its literal gray at every workspace colour', () => {
  const css = flat(INDEX_HTML());

  // Gemini's `is-temporary-chat` replaces the accent stop outright, so the gray
  // must not reference the workspace accent.
  for (const selector of [
    /\.willow-gemini-home-glow\.willow-gemini-home-glow-gray > \.willow-home-glow-layer::before \{([^}]*)\}/,
    /\.willow-gemini-home-glow\.willow-gemini-home-glow-gray::before \{([^}]*)\}/,
  ]) {
    const modifier = css.match(selector);
    assert.ok(modifier, `could not locate the temporary-chat glow modifier ${selector}`);
    assert.ok(
      !/--willow-home-glow-(desktop-|mobile-)?accent/.test(modifier[1]),
      'temporary chat now follows the workspace colour — Gemini keeps it neutral gray',
    );
    assert.match(modifier[1], /rgb\(68, 71, 70\)/,
      'the temporary-chat gray drifted from Gemini\'s measured --gem-sys-color--outline-variant');
  }
});

it('leaves no hardcoded green in the desktop glow rule', () => {
  const css = codeOnly(INDEX_HTML());
  const base = css.match(/\.willow-gemini-home-glow > \.willow-home-glow-layer::before \{([\s\S]*?)\}/);
  assert.ok(base, 'could not locate the desktop glow rule');
  // The only green left in the rule must be the var() fallback.
  const greens = base[1].match(/rgb\(0,\s*140,\s*103\)/g) || [];
  assert.equal(greens.length, 1,
    'the glow rule mentions the green more than once — the accent is probably hardcoded again');
  assert.match(base[1], /var\(--willow-home-glow-desktop-accent, rgb\(0, 140, 103\)\)/,
    'the remaining green is not the custom-property fallback');
});
