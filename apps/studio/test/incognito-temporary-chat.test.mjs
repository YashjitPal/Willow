/**
 * Regression tests for temporary ("incognito") chat presentation.
 *
 * Every number asserted here was measured off the live Gemini app over CDP —
 * `getAnimations()` for resolved keyframes and timing, `document.styleSheets`
 * for the authored cascade, and `getComputedStyle` for resolved tokens. None of
 * it is eyeballed, and none of it should be "tidied" to rounder values.
 *
 * The three defects these pin, in the order a user notices them:
 *
 *  1. The gray glow was `rgba(255,255,255,0.08) -> transparent`, a translucent
 *     white haze. Gemini's is the *same opaque radial as normal mode* with only
 *     the outer stop swapped to `--gem-sys-color--outline-variant` (#444746).
 *     That mismatch is why it read as washed out and "corrupted".
 *
 *  2. The gray variant was a *sibling* class, so toggling swapped one `::before`
 *     rule for another and restarted the grow animation — the glow visibly
 *     collapsed to scale(0) and regrew on every toggle. In the capture,
 *     `lm-background-grow` fired exactly twice in ten minutes (load, New chat)
 *     across ~7 toggles, so it must NOT restart. Hence a modifier that overrides
 *     `background` alone.
 *
 *  3. The zero-state text animated via max-height/opacity/margin-top, a height
 *     collapse. Gemini uses `_lm-fade-in-up`: translateY(40px)->0 with opacity
 *     0->1 over 300ms on cubic-bezier(0.2,0,0,1).
 *
 * Source assertions, because this is CSS in `index.html` plus inline styles in
 * TSX — there is no module boundary to import.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

const INDEX_HTML = () => read(appDir, 'index.html');
const MEDIA_HOME = () => read(repoRoot, 'features', 'media', 'src', 'MediaHome.tsx');
const CHAT_VIEW = () => read(repoRoot, 'features', 'chat', 'src', 'ChatView.tsx');
const STUDIO_LAYOUT = () => read(appDir, 'src', 'shell', 'StudioLayout.tsx');

/**
 * Strip comments before any *absence* assertion.
 *
 * This file documents the values it replaced, so the old ones appear verbatim in
 * prose. Without stripping, "the washed-out gradient is gone" would match its own
 * explanation and never fail. This has already bitten this repo twice.
 */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

/** Collapse whitespace so multi-line CSS declarations can be matched as one string. */
const flat = (source) => source.replace(/\s+/g, ' ');

// ── The glow ────────────────────────────────────────────────────────────────

it('paints the temporary-chat glow with Gemini\'s measured stops', () => {
  const css = flat(INDEX_HTML());

  // `--lumi-sys-color--surface` #0f0f0f -> `--gem-sys-color--outline-variant` #444746.
  assert.match(
    css,
    /\.willow-gemini-home-glow\.willow-gemini-home-glow-gray::before \{ background: radial-gradient\( ellipse 100% 100% at center 8%, rgb\(15, 15, 15\) 0, rgb\(68, 71, 70\) 50% \); \}/,
    'the temporary-chat glow no longer uses Gemini\'s measured gradient stops',
  );
});

it('keeps the washed-out white haze out of the glow', () => {
  const css = codeOnly(INDEX_HTML());

  assert.ok(
    !/rgba\(255,\s*255,\s*255,\s*0\.08\)/.test(css),
    'the translucent white gradient is back — this is the "corrupted" gray glow',
  );
});

it('makes the temporary variant a modifier so the grow animation cannot restart', () => {
  const css = flat(INDEX_HTML());

  // Compound selector, i.e. layered on top of the base rule rather than replacing it.
  assert.match(
    css,
    /\.willow-gemini-home-glow\.willow-gemini-home-glow-gray::before/,
    'the gray glow is a standalone selector again — every toggle will restart grow',
  );

  // The modifier must override `background` and nothing else: any geometry,
  // blur or animation of its own re-creates the restart it exists to avoid.
  const modifier = css.match(
    /\.willow-gemini-home-glow\.willow-gemini-home-glow-gray::before \{([^}]*)\}/,
  );
  assert.ok(modifier, 'could not locate the temporary-chat glow modifier rule');
  for (const forbidden of ['animation', 'filter', 'width', 'height', 'transform', 'content']) {
    assert.ok(
      !new RegExp(`(^|[;{\\s])${forbidden}\\s*:`).test(modifier[1]),
      `the glow modifier redeclares "${forbidden}" — it must override background alone`,
    );
  }
});

it('keeps the glow class applied across the toggle', () => {
  const source = codeOnly(MEDIA_HOME());

  // The base class must be unconditional, with the modifier appended.
  assert.match(
    source,
    /willow-gemini-home-glow\$\{isIncognito \? ' willow-gemini-home-glow-gray' : ''\}/,
    'the glow classes are being swapped again instead of layered',
  );
  assert.ok(
    !/isIncognito \? 'willow-gemini-home-glow-gray' : 'willow-gemini-home-glow'/.test(source),
    'the old swap is back — the glow will collapse and regrow on every toggle',
  );
});

// ── The fade-in-up ──────────────────────────────────────────────────────────

it('defines lm-fade-in-up with the measured keyframes and timing', () => {
  const css = flat(INDEX_HTML());

  assert.match(
    css,
    /@keyframes willow-lm-fade-in-up \{ 0% \{ opacity: 0; transform: translateY\(40px\); \} 100% \{ opacity: 1; transform: translateY\(0px\); \} \}/,
    'the fade-in-up keyframes drifted from Gemini\'s measured translateY(40px)/opacity pair',
  );

  // 300ms on the standard easing, `forwards` so it holds at opacity 1.
  assert.match(
    css,
    /\.willow-lm-fade-in-up \{ opacity: 0; animation: willow-lm-fade-in-up 0\.3s cubic-bezier\(0\.2, 0, 0, 1\) var\(--willow-fade-in-up-delay, 0s\) forwards; \}/,
    'the fade-in-up timing drifted from the measured 300ms / cubic-bezier(0.2,0,0,1) / forwards',
  );
});

it('staggers the greeting 250ms behind the temporary-chat text', () => {
  const source = codeOnly(MEDIA_HOME());

  // Measured: the temporary card leads at 0s, the normal greeting trails at 250ms.
  assert.match(
    source,
    /animationDelay: isIncognito \? '0s' : '250ms'/,
    'the measured 0s / 250ms stagger is gone',
  );
  assert.match(
    source,
    /className="willow-lm-fade-in-up[^"]*"/,
    'the zero-state text is not using the fade-in-up animation',
  );
});

it('replays the fade by remounting on the mode', () => {
  const source = codeOnly(MEDIA_HOME());

  // A CSS animation only re-runs on a fresh element. Without the key, the fade
  // plays once on first paint and every later toggle is an instant cut.
  assert.match(
    source,
    /key=\{isIncognito \? 'incognito' : 'normal'\}/,
    'the fade wrapper lost its key — toggling will no longer replay the animation',
  );
});

it('drops the height-collapse transition it replaced', () => {
  const source = codeOnly(MEDIA_HOME());

  assert.ok(
    !/maxHeight: isIncognito \? '80px' : '0px'/.test(source),
    'the max-height collapse is back in place of the real fade-in-up',
  );
  assert.ok(
    !/transitionProperty: 'max-height, opacity, margin-top'/.test(source),
    'the disclaimer is animating height again instead of fading up',
  );
});

// ── The pinned header ───────────────────────────────────────────────────────

it('pins the Temporary Chat header instead of putting it in the message flow', () => {
  const layout = STUDIO_LAYOUT();
  const header = layout.match(
    /data-test-id="temporary-chat-header"[\s\S]{0,900}?<\/div>\s*\)\}/,
  );
  assert.ok(header, 'the pinned temporary-chat header is missing from StudioLayout');
  const block = header[0];

  // Measured: absolute across the content column, pinned to its top.
  assert.match(block, /absolute inset-x-0 top-0/,
    'the header is no longer pinned across the top of the content column');
  // 16px padding around a 40px line box = the measured 72px band.
  assert.match(block, /\bp-4\b/, 'the header lost its measured 16px padding');
  assert.match(block, /lineHeight: '40px'/, 'the header lost its measured 40px line box');
  assert.match(block, /fontSize: '14px'/, 'the header font size drifted from the measured 14px');
  assert.match(block, /fontWeight: 500/, 'the header weight drifted from the measured 500');
  assert.match(block, /color: '#c4c7c5'/,
    'the header colour drifted from the measured --gem-sys-color--on-surface-variant');
  assert.match(block, /paddingLeft: '8px'/,
    'the .info-text 8px padding-left is gone — the label sits 4px left of where Gemini puts it');
  assert.match(block, />Temporary Chat</, 'the header label text changed');

  // The measured header box fully contains the toggle button (x 1488-1524,
  // y 14-50 against a header spanning x 288-1536, y 0-72). If it absorbs
  // clicks, incognito becomes impossible to leave.
  assert.match(block, /pointer-events-none/,
    'the header can absorb clicks on the toggle button — incognito would be inescapable');
});

it('shows the header only once the thread is under way, never over the zero state', () => {
  const layout = STUDIO_LAYOUT();
  const guard = layout.match(/\{([^\n]*isIncognito[^\n]*) && \(\s*<div\s+data-test-id="temporary-chat-header"/);
  assert.ok(guard, 'could not locate the temporary-chat header render guard');

  // This assertion used to demand the opposite — that the header stay mounted for
  // the whole session — and it outlived the measurement that disproved it. Gemini's
  // temporary chat opens with NO header: the zero state carries the
  // `gemini_chat_temp` glyph and the "Incognito chat" card, and the pinned label
  // only fades in with the thread. Ungated, the label sat above the zero-state
  // card, which Gemini never shows.
  assert.match(guard[1], /\bisChatOngoing\b/,
    'the header is ungated — the label would sit above the zero-state card');
  assert.ok(
    !/!isChatOngoing/.test(guard[1]),
    'the header is gated on the negation — it would show in the zero state only',
  );

  // The header and the toggle button are deliberately complementary: the button
  // carries `!isChatOngoing`, so exactly one of the two occupies the band.
  const button = layout.match(/\{([^\n]*isIncognito[^\n]*) && \(\s*<[\s\S]{0,200}?aria-label="Temporary chat"/);
  if (button) {
    assert.match(button[1], /!isChatOngoing/,
      'the toggle button lost its complementary gate');
  }
});

it('removes the in-flow incognito pill from the message list', () => {
  const source = codeOnly(CHAT_VIEW());

  // The pill lived inside the mapped message column, so it consumed layout
  // height and scrolled away with the thread. The pinned header replaces it.
  assert.ok(
    !/Incognito Mode/.test(source),
    'the in-flow incognito pill is back — it takes flow space and scrolls away',
  );
  assert.ok(
    !/\bGlasses\b/.test(source),
    'the Glasses icon import is unused now that the pill is gone',
  );
});
