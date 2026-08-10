/**
 * Gemini's tooltip alignment: centred normally, left when the bubble wrapped.
 *
 * This started as a report that the two sidebar tab tooltips were left-aligned while
 * Willow centred them. Special-casing those two buttons would have been wrong — and would
 * have left the next long tooltip mis-aligned — because the behaviour is a general rule.
 *
 * The rule could not be read from the page: `.mat-mdc-tooltip-surface` is authored in a
 * gstatic sheet that is CORS-blocked, so `document.styleSheets` cannot see its text at all.
 * CDP's `CSS.getMatchedStylesForNode` reads the cascade the engine actually resolved,
 * cross-origin sheets included, and returned the pair:
 *
 *   .mat-mdc-tooltip-surface                        { text-align: center }
 *   .mdc-tooltip--multiline .mat-mdc-tooltip-surface { text-align: left }
 *   [dir=rtl] .mdc-tooltip--multiline .mat-...      { text-align: right }
 *
 * The modifier is applied from JS, so the condition lives in the bundle, verbatim:
 *
 *   Sa() { var a = this.wc.Ua.getBoundingClientRect();
 *          return a.height > 24 && a.width >= 200 }
 *   template: _.Q("mdc-tooltip--multiline", b.eCc)     // eCc = Sa()
 *
 * Both constants are the surface's own limits — `min-height: 24px`, `max-width: 200px` —
 * so the test reads as "taller than one line AND pinned at the cap", i.e. "it wrapped".
 *
 * Checks out against every tooltip measured on Gemini so far:
 *
 *   "Switch to Spark (Ctrl+Shift+S)"   200 x 48   -> multiline -> text-align: left
 *   "Code, write, or make slides"      187 x 32   -> centred
 *   "Make audio tracks"              136.2 x 32   -> centred
 *   "Bring ideas to life"            131.5 x 32   -> centred
 *   "Visualize and edit"             131.8 x 32   -> centred
 *
 * which is also why the plus-menu tooltips must NOT pick up the left alignment.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const uiSrc = (...p) => path.join(repoRoot, 'platform', 'ui', 'src', ...p);

const TSX = () => fs.readFileSync(uiSrc('Tooltip.tsx'), 'utf8');
const CSS = () => fs.readFileSync(uiSrc('Tooltip.css'), 'utf8');

/** Strips comments so a doc block quoting a value can't satisfy an assertion. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the multiline test', () => {
  it('is Gemini\'s exact predicate, both halves', () => {
    const s = codeOnly(TSX());
    const fn = s.match(/const isMultiline[\s\S]{0,400}?\n\};/);
    assert.ok(fn, 'the predicate must exist as its own function');
    assert.match(fn[0], /getBoundingClientRect\(\)/,
      'Material measures the rendered box, not the string length');
    assert.match(fn[0], /box\.height > 24/, 'taller than one line');
    assert.match(fn[0], /box\.width >= 200/, 'pinned at max-width, i.e. it wrapped');
    // `>` and `>=` are not interchangeable here: a 200px-wide bubble IS multiline
    // (measured: the tab tooltip renders exactly 200), while a 24px-tall one is not.
    assert.ok(!/box\.width > 200/.test(fn[0]), 'width is >=, and 200 is a real case');
    assert.ok(!/box\.height >= 24/.test(fn[0]), 'height is >, a 24px box is single-line');
  });

  it('runs after placement, on the surface, and only toggles alignment', () => {
    const s = codeOnly(TSX());
    assert.match(s, /surface\.classList\.toggle\(\s*'willow-tooltip-surface--multiline',\s*isMultiline\(surface\)\s*\)/,
      'toggled so a re-measure can turn it back off');
    // It must sit inside reposition(), after the box has been placed — measuring
    // before placement reads the pane at its previous position and can report a
    // squeezed width (the same trap reposition() already documents).
    const repo = s.match(/const reposition = React\.useCallback\([\s\S]*?\}, \[anchor, position\]\);/);
    assert.ok(repo, 'could not locate reposition()');
    assert.ok(repo[0].includes('isMultiline(surface)'), 'the test belongs inside reposition');
    assert.ok(
      repo[0].indexOf('transformOrigin') < repo[0].indexOf('isMultiline(surface)'),
      'alignment is decided last, once the box is final',
    );
  });
});

describe('the alignment rules', () => {
  it('keeps centre as the base, exactly as Material authors it', () => {
    assert.match(CSS(), /\.willow-tooltip-surface\s*\{[\s\S]*?text-align:\s*center/,
      'short tooltips stay centred — that is most of them');
  });

  it('adds left only under the modifier', () => {
    const css = CSS();
    assert.match(css, /\.willow-tooltip-surface--multiline\s*\{\s*text-align:\s*left;\s*\}/,
      'the wrapped case');
    assert.match(css, /\[dir="rtl"\]\s*\.willow-tooltip-surface--multiline\s*\{\s*text-align:\s*right;\s*\}/,
      'Material mirrors it for RTL; so does this');
  });

  it('does not left-align every tooltip', () => {
    // The reported symptom was two left-aligned bubbles. Fixing it by flipping the
    // base rule would silently re-align the ~230 other title= sites, every one of
    // which measured centred on Gemini.
    const css = CSS();
    const base = css.match(/\.willow-tooltip-surface\s*\{[\s\S]*?\n\}/);
    assert.ok(base, 'could not locate the surface rule');
    assert.ok(!/text-align:\s*left/.test(base[0]),
      'the base surface is centred; left belongs to the modifier alone');
  });
});
