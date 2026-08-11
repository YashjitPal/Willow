/**
 * Behaviour tests for dropping per-word spans from settled markdown.
 *
 * Every word in a reply renders inside its own `<span>` carrying inline
 * `font-variation-settings`, so the streaming fade can address it. Those spans
 * are never taken down, so a long conversation holds thousands of them — and
 * because each declares its own variation settings, the font engine shapes every
 * word as an isolated run instead of caching glyph runs across a line. The whole
 * thread then re-shapes word by word on each frame of the context panel's 300ms
 * width animation, which is the lag being fixed.
 *
 * What makes dropping them safe is narrow and worth pinning: `.smd-w` and
 * `.smd-settled` carry NO styling outside `.smd-streaming`, and a default body
 * word's inline styles restate exactly what `.smd-root` already provides. Both
 * facts are asserted here, because the day either stops being true the
 * flattening starts changing how text looks rather than only how fast it lays
 * out — and a visual regression in settled text is close to invisible in review.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), 'utf8');

const SOURCE = () => read('platform', 'ui', 'src', 'StreamingMarkdown.tsx');
const STYLES = () => read('platform', 'ui', 'src', 'streaming-markdown-styles.ts');

it('drops word spans only when the fade is off and the style is inherited', () => {
  assert.match(
    SOURCE(),
    /if \(!context\.animating && isInertWordStyle\(context\)\) return \[value\];/,
    'both conditions are load-bearing: a streaming message still needs its per-word handles',
  );
});

it('keeps the spans for every case where they carry real style', () => {
  const source = SOURCE();
  const guard = source.slice(
    source.indexOf('const isInertWordStyle'),
    source.indexOf('interface WordProps'),
  );

  // Headings render at their own weight/width/roundness via HEADING_METRICS, and
  // strong/em/strike each change the rendered glyphs. Flattening any of them
  // would silently restyle text rather than only speed it up.
  for (const condition of [
    "context.variant === 'w'",
    '!context.strong',
    '!context.em',
    '!context.strike',
    'context.weight === ROOT_TYPOGRAPHY.weight',
    'context.width === ROOT_TYPOGRAPHY.width',
    'context.roundness === ROOT_TYPOGRAPHY.roundness',
  ]) {
    assert.ok(
      guard.includes(condition),
      `isInertWordStyle must still require ${condition} — dropping it flattens styled text`,
    );
  }
});

it('pins the root typography the redundancy test is judged against', () => {
  // If the root moved off these values, every default word span would become
  // meaningful and flattening would render settled text at the wrong weight.
  assert.match(
    SOURCE(),
    /const ROOT_TYPOGRAPHY = \{ weight: 400, width: 92, roundness: 0 \} as const;/,
    'root typography is the baseline the whole optimisation rests on',
  );
});

it('derives the root element style from that same constant', () => {
  const source = SOURCE();
  assert.match(
    source,
    /style=\{\{ fontVariationSettings: ROOT_VARIATION \}\}/,
    'the root must not restate the numbers — the two would drift apart',
  );
  assert.doesNotMatch(
    source,
    /fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400'/,
    'the hardcoded root variation string must be gone, not merely duplicated',
  );
});

it('keeps the stylesheet font-weight agreeing with ROOT_TYPOGRAPHY', () => {
  // The third copy of 400. streaming-markdown-styles.ts cannot import from
  // StreamingMarkdown.tsx without a cycle, so this is the seam that catches it.
  assert.match(
    STYLES(),
    /'\s*font-weight: 400;',/,
    '.smd-root font-weight must match ROOT_TYPOGRAPHY.weight',
  );
});

it('confirms .smd-w and .smd-settled style nothing outside .smd-streaming', () => {
  // The reason flattening is invisible. Every rule naming either class must be
  // scoped to .smd-streaming; an unscoped one would mean settled words are
  // styled by their span and removing it would change their appearance.
  const styles = STYLES();
  const offenders = [];

  for (const line of styles.split('\n')) {
    if (!/\.smd-w\b|\.smd-settled\b/.test(line)) continue;
    if (line.trimStart().startsWith('//')) continue;
    // Selector lists span lines, so a bare `.smd-w,` continuation is judged by
    // the .smd-streaming prefix on its own segment.
    const segments = line.split(',');
    for (const segment of segments) {
      if (!/\.smd-w\b|\.smd-settled\b/.test(segment)) continue;
      // `.smd-inline-code smd-w` is a className string in the TSX, not a rule.
      if (!segment.includes('.smd-')) continue;
      if (!segment.includes('.smd-streaming')) offenders.push(segment.trim());
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'an unscoped .smd-w/.smd-settled rule means settled words depend on their span',
  );
});

it('still splits words while a message is streaming', () => {
  // The fade addresses one span per word; flattening a streaming message would
  // delete the animation this component exists for.
  const source = SOURCE();
  const body = source.slice(source.indexOf('function renderAnimatedText'));
  assert.match(body.slice(0, 900), /<Word/, 'the per-word path must survive for the streaming case');
});
