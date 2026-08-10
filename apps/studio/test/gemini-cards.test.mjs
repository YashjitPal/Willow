/**
 * Gemini's `bento-card` tiles and its markdown `.inline-image-container`.
 *
 * Every number asserted here was measured off the running Gemini app over CDP,
 * or transcribed from the authored stylesheet its lazy chunk inlines. Nothing is
 * a design choice.
 *
 * THE SIZE ENUM. The card component derives three mutually exclusive host
 * classes from a numeric input:
 *
 *   this.n5b = _.X(() => this.TZa() === 3)   // large
 *   this.y5b = _.X(() => this.TZa() === 2)   // medium
 *   this.S6b = _.X(() => this.TZa() === 1)   // small
 *
 * THE BOXES, from the sheet (`--gem-sys-spacing--s` = 8px):
 *
 *   .small  { min-width: calc((350px - 8px) / 2); height: calc((350px - 8px) / 2) }
 *   .medium { min-width: 350px; height: calc((350px - 8px) / 2) }
 *   .large  { min-width: 350px; height: 350px }
 *
 * Live, the four cards on the page measured [350,350], [350,171], [171,171],
 * [171,171] — so small is 171, medium 350x171, large 350x350.
 *
 * THE TILING, from the live tree (all gaps `var(--gem-sys-spacing--s)` = 8px):
 *
 *   div.flex-container-root  display:flex; flex-direction:row;    gap:8px
 *     div.flex-container     display:flex; flex-direction:column; gap:8px
 *       div.flex-container   display:flex; flex-direction:row;    gap:8px
 *         div               width:100%; height:100%   -> one card
 *
 * A column is 350 wide and 350 tall, so the packing is forced by the boxes
 * alone: 171*2 + 8 = 350 is why two smalls share a row, and 171 + 8 + 171 = 350
 * is why two half-height rows fill a column.
 *
 * THE ATTRIBUTION, from the component's `attribution` signal:
 *
 *   if (this.S6b()) return "";                     // never on a small card
 *   this.n5b() && (author && provider
 *     ? "Credit {AUTHOR}/{PROVIDER}"
 *     : author ? "Credit {AUTHOR}" : "");          // large only
 *   if (!e || e.length > 40) e = provider ?? "";   // too long -> provider alone
 *
 * THE INLINE IMAGE. Its emitter, verbatim (`_.X1` = escape):
 *
 *   Yb(a, b) {
 *     var c = _.X1(a.alt),
 *       d = `<div class="inline-image-wrapper">${
 *         `<img class="inline-img" src="${_.X1(a.url)}" alt="${c}" />`}</div>`,
 *       e = "", f = !(!a.Af || !a.Sh), g = !!c;
 *     if (f || g) { ... }
 *     return V3({ tag: "div", classes: ["inline-image-container", a.orientation], ... });
 *   }
 *
 * so the wrapper holds the `<img>` alone, and the caption is credit + " · " +
 * alt with the separator only when both exist.
 *
 * ORDER IS LOAD-BEARING in the inline image's CSS. The authored sheet reads:
 *
 *   .inline-image-container{overflow:hidden}
 *   @media only screen and (min-width:768px){ ... float:right; max-width:40% }
 *   .inline-image-container.landscape{max-width:362px}
 *
 * The orientation cap comes last and wins, which is why a probe in the live
 * 708px panel measured 362px wide and not 40% of 708 (283px).
 *
 * NOT REPRODUCED, deliberately: a `@media (max-width:959.98px)` rule that undoes
 * the float. It targets `.hero-overlay-container` / `.hero-image`, which belong
 * to the separate `single-image` component, not to this path.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const uiSrc = (...parts) => path.join(repoRoot, 'platform', 'ui', 'src', ...parts);
const chatSrc = (...parts) => path.join(repoRoot, 'features', 'chat', 'src', ...parts);

const CARDS_TS = () => fs.readFileSync(uiSrc('gemini-cards.ts'), 'utf8');
const CARD_TSX = () => fs.readFileSync(uiSrc('GeminiBentoCard.tsx'), 'utf8');
const INLINE_TSX = () => fs.readFileSync(uiSrc('GeminiInlineImage.tsx'), 'utf8');
const HERO_TSX = () => fs.readFileSync(uiSrc('GeminiSingleImage.tsx'), 'utf8');
const STYLES = () => fs.readFileSync(uiSrc('streaming-markdown-styles.ts'), 'utf8');
const MARKDOWN = () => fs.readFileSync(uiSrc('StreamingMarkdown.tsx'), 'utf8');

/** Strip comments first — these sources quote the measurements in prose. */
const codeOnly = (source) => source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

/** The declarations of a rule in the injected stylesheet array. */
const rule = (selector) => {
  const source = codeOnly(STYLES())
    // The sheet is an array of string literals; join them into plain CSS.
    .replace(/',\s*\r?\n\s*'/g, '\n')
    .replace(/\\'/g, "'");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `could not locate the ${selector} rule`);
  return match[1];
};

const declares = (selector, property, value) => {
  const body = rule(selector);
  const found = body.match(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`));
  assert.ok(found, `${selector} does not declare ${property}`);
  assert.equal(found[1].trim(), value, `${selector} { ${property} }`);
};

// ── The measured boxes ───────────────────────────────────────────────────────

it('uses the column and gap the sheet declares, not rounded stand-ins', async () => {
  const { BENTO_GAP, BENTO_COLUMN, BENTO_HALF } = await importTs(uiSrc('gemini-cards.ts'));
  assert.equal(BENTO_GAP, 8);
  assert.equal(BENTO_COLUMN, 350);
  // calc((350px - 8px) / 2) — the live smalls measured exactly 171.
  assert.equal(BENTO_HALF, 171);
});

it('gives each size the box measured on the live card', async () => {
  const { bentoCardHeight, bentoCardWidth } = await importTs(uiSrc('gemini-cards.ts'));
  assert.deepEqual(
    [bentoCardWidth('large'), bentoCardHeight('large')],
    [350, 350],
  );
  assert.deepEqual(
    [bentoCardWidth('medium'), bentoCardHeight('medium')],
    [350, 171],
  );
  assert.deepEqual(
    [bentoCardWidth('small'), bentoCardHeight('small')],
    [171, 171],
  );
});

it('pins each size with min-width AND width, so a card never stretches', () => {
  // The bug this guards: the group used to size cards with `width: 100%`, so a
  // two-card response stretched them to ~440px. Live, every card resolved to its
  // declared box at container widths 708/420/300px and at emulated viewports
  // 1536/1100/900/760/700/600/480px — `min-width` is a floor nothing overrides.
  for (const [selector, width, height] of [
    ['.smd-bento-small', '171px', '171px'],
    ['.smd-bento-medium', '350px', '171px'],
    ['.smd-bento-large', '350px', '350px'],
  ]) {
    declares(selector, 'min-width', width);
    declares(selector, 'width', width);
    declares(selector, 'height', height);
  }
});

it('leaves the base card unsized, so the size class is the only authority', () => {
  const body = rule('.smd-bento-card');
  assert.ok(
    !/(?:^|[;{\s])width\s*:/.test(body),
    '.smd-bento-card must not declare a width — it stretched cards to fill the column',
  );
  assert.ok(!/(?:^|[;{\s])height\s*:/.test(body), '.smd-bento-card must not declare a height');
});

it('hugs its content at the root instead of filling the column', () => {
  declares('.smd-bento-root', 'width', 'fit-content');
});

it('never wraps or reflows the tiling, which is what the live app measured', () => {
  const source = codeOnly(STYLES());
  assert.ok(
    !/smd-bento-root\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(source),
    'the live root stayed flex-wrap: nowrap at all seven emulated viewport widths',
  );
  assert.ok(
    !/smd-bento-column\s*\{[^}]*width\s*:\s*100%/.test(source),
    'a full-width column re-introduces the stretch the fixed widths remove',
  );
});

// ── The attribution rules, straight off the component's signal ───────────────

it('never shows an attribution on a small card', async () => {
  const { bentoAttribution } = await importTs(uiSrc('gemini-cards.ts'));
  // `if (this.S6b()) return ""` — the very first line of the signal.
  assert.equal(
    bentoAttribution({ size: 'small', author: 'A. Photographer', provider: 'Getty' }),
    '',
  );
});

it('builds "Credit AUTHOR/PROVIDER" on a large card only', async () => {
  const { bentoAttribution } = await importTs(uiSrc('gemini-cards.ts'));
  assert.equal(
    bentoAttribution({ size: 'large', author: 'Ana Ruiz', provider: 'Reuters' }),
    'Credit Ana Ruiz/Reuters',
  );
  assert.equal(bentoAttribution({ size: 'large', author: 'Ana Ruiz' }), 'Credit Ana Ruiz');
  // A medium card skips the credit form and falls through to the provider.
  assert.equal(
    bentoAttribution({ size: 'medium', author: 'Ana Ruiz', provider: 'Reuters' }),
    'Reuters',
  );
});

it('falls back to the provider past the 40 character cap', async () => {
  const { bentoAttribution } = await importTs(uiSrc('gemini-cards.ts'));
  const long = { size: 'large', author: 'Wilhelmina Featherstonehaugh-Cholmondeley', provider: 'AP' };
  // "Credit " + 41 chars = 48 > 40, so `e = provider`.
  assert.ok(('Credit ' + long.author).length > 40);
  assert.equal(bentoAttribution(long), 'AP');
});

// ── Packing, forced by the measured boxes ────────────────────────────────────

it('pairs two smalls into one row, because 171 + 8 + 171 = 350', async () => {
  const { packBentoColumns } = await importTs(uiSrc('gemini-cards.ts'));
  const columns = packBentoColumns([
    { size: 'small', heading: 'a' },
    { size: 'small', heading: 'b' },
  ]);
  assert.equal(columns.length, 1);
  assert.equal(columns[0].length, 1);
  assert.equal(columns[0][0].length, 2);
});

it('closes a column once its rows reach the 350px height', async () => {
  const { packBentoColumns } = await importTs(uiSrc('gemini-cards.ts'));
  // Two mediums are 171 + 8 + 171 = 350 exactly, so the third starts a column.
  const columns = packBentoColumns([
    { size: 'medium', heading: 'a' },
    { size: 'medium', heading: 'b' },
    { size: 'medium', heading: 'c' },
  ]);
  assert.equal(columns.length, 2);
  assert.equal(columns[0].length, 2);
  assert.equal(columns[1].length, 1);
});

it('gives a large card a column to itself', async () => {
  const { packBentoColumns } = await importTs(uiSrc('gemini-cards.ts'));
  const columns = packBentoColumns([
    { size: 'large', heading: 'a' },
    { size: 'medium', heading: 'b' },
  ]);
  assert.equal(columns.length, 2);
  assert.deepEqual(columns[0][0].map((card) => card.size), ['large']);
  assert.deepEqual(columns[1][0].map((card) => card.size), ['medium']);
});

// The live `lmss` response, walked over CDP. `.flex-container-root` is 708 wide
// (350 + 8 + 350) and holds exactly two columns:
//
//   flex-0-0  [350,350] column -> flex-0-0-0 [350,350] row -> large  [350,350]
//   flex-0-1  [350,350] column -> flex-0-1-0 [350,171] row -> medium [350,350]
//                                 flex-0-1-1 [350,171] row -> small  [171,171]
//                                                            small  [171,171]
//
// The two smalls share one row. Pinned because an earlier revision closed a
// column the moment its height reached 350, which split them into a third
// column — height being full is not the same fact as the last row being full.
it('packs the measured live lmss response into two columns', async () => {
  const { packBentoColumns } = await importTs(uiSrc('gemini-cards.ts'));
  const columns = packBentoColumns([
    { size: 'large', heading: 'a' },
    { size: 'medium', heading: 'b' },
    { size: 'small', heading: 'c' },
    { size: 'small', heading: 'd' },
  ]);
  const shape = columns.map((column) =>
    column.map((row) => row.map((card) => card.size).join('+')).join('/')
  );
  assert.deepEqual(shape, ['large', 'medium/small+small']);
});

it('fills a column with two pairs of smalls before starting another', async () => {
  const { packBentoColumns } = await importTs(uiSrc('gemini-cards.ts'));
  // Four smalls are two rows of 171, i.e. one full 350 column — not two.
  const columns = packBentoColumns([
    { size: 'small', heading: 'a' },
    { size: 'small', heading: 'b' },
    { size: 'small', heading: 'c' },
    { size: 'small', heading: 'd' },
  ]);
  assert.equal(columns.length, 1);
  assert.deepEqual(
    columns[0].map((row) => row.length),
    [2, 2]
  );
});

// ── Parsing the fence ────────────────────────────────────────────────────────

it('renders nothing until the streamed JSON closes', async () => {
  const { parseBentoCards } = await importTs(uiSrc('gemini-cards.ts'));
  // Mid-stream, a fence body is not valid JSON. Returning null is what keeps a
  // half-arrived block from flashing a broken card.
  assert.equal(parseBentoCards('[{"size":"medium","heading":"Bejewe'), null);
  assert.equal(parseBentoCards(''), null);
  assert.equal(parseBentoCards('not json at all'), null);
});

it('drops a card with neither heading nor subheading', async () => {
  const { parseBentoCards } = await importTs(uiSrc('gemini-cards.ts'));
  // `has-text` is `!(!heading && !iUa)`; a card with neither is not renderable.
  assert.equal(parseBentoCards('[{"size":"medium","image":"https://x/y.png"}]'), null);
  const cards = parseBentoCards(
    '[{"size":"medium","heading":"Keeps"},{"size":"small","image":"https://x/y.png"}]',
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].heading, 'Keeps');
});

it('accepts both a bare array and a { cards } envelope', async () => {
  const { parseBentoCards } = await importTs(uiSrc('gemini-cards.ts'));
  const bare = parseBentoCards('[{"size":"large","heading":"A"}]');
  const wrapped = parseBentoCards('{"cards":[{"size":"large","heading":"A"}]}');
  assert.deepEqual(bare, wrapped);
});

it('defaults an unknown size to medium rather than dropping the card', async () => {
  const { parseBentoCards } = await importTs(uiSrc('gemini-cards.ts'));
  assert.equal(parseBentoCards('[{"size":"enormous","heading":"A"}]')[0].size, 'medium');
  assert.equal(parseBentoCards('[{"heading":"A"}]')[0].size, 'medium');
  // Case is normalised, so "Large" is still the large box.
  assert.equal(parseBentoCards('[{"size":"Large","heading":"A"}]')[0].size, 'large');
});

it('recognises the card fence by language, case-insensitively', async () => {
  const { isBentoFence } = await importTs(uiSrc('gemini-cards.ts'));
  assert.ok(isBentoFence('bento-cards'));
  assert.ok(isBentoFence('  Bento-Cards '));
  assert.ok(!isBentoFence('json'));
  assert.ok(!isBentoFence(''));
  assert.ok(!isBentoFence(undefined));
});

// ── The typography bindings ──────────────────────────────────────────────────

it('binds each size to the type scale its sub-template names', () => {
  const source = codeOnly(CARD_TSX());
  // heading:    _.Q("gds-headline-s", medium)("gds-emphasized-headline-l", large)("gds-body-l", small)
  // subheading: _.Q("gds-body-l", large)("gds-body-m", medium)("gds-body-s", small)
  for (const [key, value] of [
    ['small', 'gds-body-l'],
    ['medium', 'gds-headline-s'],
    ['large', 'gds-emphasized-headline-l'],
  ]) {
    assert.match(source, new RegExp(`HEADING_CLASS[\\s\\S]*?${key}:\\s*'${value}'`));
  }
  for (const [key, value] of [
    ['small', 'gds-body-s'],
    ['medium', 'gds-body-m'],
    ['large', 'gds-body-l'],
  ]) {
    assert.match(source, new RegExp(`SUBHEADING_CLASS[\\s\\S]*?${key}:\\s*'${value}'`));
  }
});

it('carries the live font metrics for every gds scale it uses', () => {
  // Read off the classes themselves in the running app.
  declares('.smd-bento-card .gds-emphasized-headline-l', 'font-size', '28px');
  declares('.smd-bento-card .gds-emphasized-headline-l', 'line-height', '36px');
  declares('.smd-bento-card .gds-headline-s', 'font-size', '20px');
  declares('.smd-bento-card .gds-headline-s', 'line-height', '24px');
  declares('.smd-bento-card .gds-body-l', 'font-size', '17px');
  declares('.smd-bento-card .gds-body-l', 'line-height', '24px');
  declares('.smd-bento-card .gds-body-m', 'font-size', '15px');
  declares('.smd-bento-card .gds-body-m', 'line-height', '20px');
  declares('.smd-bento-card .gds-body-s', 'font-size', '13px');
  declares('.smd-bento-card .gds-body-s', 'line-height', '17px');
  // ROND 20 / wdth 94 on the headline, ROND 0 / wdth 92 on the bodies — the two
  // families differ, so a single shared setting would be wrong.
  assert.match(rule('.smd-bento-card .gds-headline-s'), /"ROND" 20/);
  assert.match(rule('.smd-bento-card .gds-headline-s'), /"wdth" 94/);
  assert.match(rule('.smd-bento-card .gds-body-m'), /"ROND" 0/);
  assert.match(rule('.smd-bento-card .gds-body-m'), /"wdth" 92/);
});

// ── The card host, as measured ───────────────────────────────────────────────

it('keeps the measured host box, radius and background', () => {
  declares('.smd-bento-card', 'border-radius', '40px');
  declares('.smd-bento-card', 'background-color', 'rgb(23, 23, 23)');
  declares('.smd-bento-card', 'background-size', 'cover');
  declares('.smd-bento-card', 'overflow', 'hidden');
  declares('.smd-bento-card', 'box-sizing', 'border-box');
  declares('.smd-bento-card', 'text-align', 'center');
  // --gem-sys-color--on-surface. The image variant overrides to #fff.
  declares('.smd-bento-card', 'color', 'rgb(227, 227, 227)');
  declares('.smd-bento-has-image', 'color', '#fff');
});

it('gates the scrim on has-text, and sets that class from the same condition', () => {
  // The authored selector is `.has-background-image.has-text:after`, so an
  // image-only card gets no gradient — the gradient exists for the text.
  const source = codeOnly(CARD_TSX());
  assert.match(source, /const hasText = Boolean\(card\.heading \|\| card\.subheading\)/);
  assert.match(source, /hasText \? ' smd-bento-has-text' : ''/);
});

it('uses the per-size padding and alignment measured on each card', () => {
  // large: pad 20px, justify flex-end. medium: pad 16px 32px, justify center.
  declares('.smd-bento-large', 'padding', '20px');
  declares('.smd-bento-large', 'justify-content', 'flex-end');
  declares('.smd-bento-medium', 'padding', '16px 32px');
  // A small card centres its text until it has a background image, then it
  // bottom-aligns like the large one. Both were read live.
  declares('.smd-bento-small.smd-bento-has-image', 'justify-content', 'flex-end');
});

it('keeps the scrim gradient verbatim, including its oklab interpolation', () => {
  const body = rule('.smd-bento-has-image.smd-bento-has-text::after');
  // `in oklab` changes the midpoint ramp, so dropping it would visibly alter the
  // fade even though the stops are identical.
  assert.match(body, /linear-gradient\(\s*0deg in oklab/);
  assert.match(body, /rgba\(0, 0, 0, 0\.82\) 3%/);
  assert.match(body, /transparent 60%/);
  // The large card stops at 50% instead of 60%.
  assert.match(rule('.smd-bento-large.smd-bento-has-image.smd-bento-has-text::after'), /transparent 50%/);
});

it('positions the attribution as the measured pill', () => {
  declares('.smd-bento-attribution', 'position', 'absolute');
  declares('.smd-bento-attribution', 'backdrop-filter', 'blur(17px)');
  declares('.smd-bento-attribution', 'background-color', 'rgba(0, 0, 0, 0.5)');
  declares('.smd-bento-attribution', 'padding', '4px 21px 4px 8px');
  // Rounded on the inner two corners only, and expressed as logical longhands
  // exactly as authored (`border-start-end-radius:.875rem` = 14px), so it flips
  // correctly in RTL where a shorthand would not.
  declares('.smd-bento-attribution', 'border-start-start-radius', '0');
  declares('.smd-bento-attribution', 'border-start-end-radius', '14px');
  declares('.smd-bento-attribution', 'border-end-start-radius', '14px');
  declares('.smd-bento-attribution', 'border-end-end-radius', '0');
  declares('.smd-bento-attribution', 'white-space', 'nowrap');
});

it('renders the attribution before the text, matching the live child order', () => {
  const source = codeOnly(CARD_TSX());
  const attribution = source.indexOf('smd-bento-attribution');
  const text = source.indexOf('smd-bento-text');
  assert.ok(attribution > 0 && text > 0);
  // Measured childOrder: [div.bg-image-attribution, div.text-content]. It is
  // absolutely positioned, so order only affects paint — but paint is the point.
  assert.ok(attribution < text, 'attribution must precede the text content');
});

it('has no entrance animation, transition or hover state', () => {
  // Probed: getAnimations({subtree:true}) empty, computed animation `none`,
  // transition the initial `all`, and no hover rule anywhere in the sheet.
  const body = rule('.smd-bento-card');
  assert.ok(!/animation\s*:/.test(body), 'the live card animates nothing');
  assert.ok(!/transition\s*:/.test(body), 'the live card has no transition');
  const sheet = codeOnly(STYLES());
  assert.ok(
    !/smd-bento-card[^'"\n]*:hover/.test(sheet),
    'the live card has no hover state — only the Material ripple',
  );
});

// ── Keyboard and click behaviour, from the component's own bindings ──────────

it('is only interactive when the card carries a link', () => {
  const source = codeOnly(CARD_TSX());
  assert.match(source, /role=\{clickable \? 'button' : undefined\}/);
  assert.match(source, /tabIndex=\{clickable \? 0 : undefined\}/);
  assert.match(source, /const clickable = Boolean\(card\.href\)/);
});

it('activates on Enter and Space, the two keys the component listens for', () => {
  const source = codeOnly(CARD_TSX());
  // `keydown.enter` and `keydown.space` in the template.
  assert.match(source, /event\.key !== 'Enter' && event\.key !== ' '/);
  // `g3.execute` opens HQa.url with exactly these window features.
  assert.match(source, /window\.open\(card\.href, '_blank', 'noopener,noreferrer'\)/);
});

// ── A card whose image fails to load ────────────────────────────────────────
//
// This is the blank second card in the report. Gemini paints the picture as a
// CSS `background-image`, which fires no error event — so an earlier revision
// fetched the URL a SECOND time off-DOM with `new Image()` just to learn whether
// the first one worked. That is the one mechanism we deliberately diverge on:
// the picture is an `<img>` layer, which reports its own failure and carries its
// own `referrerPolicy`. Two fetches under two policies could disagree, and a
// probe that loads where the paint does not leaves exactly the blank tile the
// probe was added to prevent.

it('paints the picture as an img layer, not a CSS background', () => {
  const source = codeOnly(CARD_TSX());
  assert.match(source, /className="smd-bento-image"/);
  assert.match(source, /src=\{resolveImageSource\(image\)\}/);
  // The whole reason for the swap: a per-element policy and a real error event.
  assert.match(source, /referrerPolicy=\{IMAGE_REFERRER_POLICY\}/);
  assert.match(source, /onError=\{onError\}/);
  // No second fetch anywhere — that is what makes the two impossible to disagree.
  assert.ok(!/new window\.Image\(\)/.test(source), 'the off-DOM probe is back');
  assert.ok(!/backgroundImage/.test(source), 'the CSS background is back alongside the img');
  // Decorative: the heading carries the meaning, and a card with neither heading
  // nor subheading is dropped by `normalizeCard`, so no description is owed.
  assert.match(source, /alt=""/);
  assert.match(source, /aria-hidden="true"/);
});

it('keeps the img layer in the background’s used box', () => {
  const styles = codeOnly(STYLES());
  const start = styles.indexOf('.smd-bento-image {');
  assert.ok(start > 0, 'the image layer should be in the sheet');
  const rule = styles.slice(start, styles.indexOf("'}',", start));
  // `object-fit: cover` + `object-position: 50%` against `inset: 0` is the same
  // used box as the measured `background-size: cover` + `background-position: 50%`.
  assert.match(rule, /position: absolute/);
  assert.match(rule, /inset: 0/);
  assert.match(rule, /object-fit: cover/);
  assert.match(rule, /object-position: 50%/);
  // Under the scrim (also z-index 0, painted later) and under the text
  // (`.smd-bento-card > *` is z-index 1, which would otherwise catch this too).
  assert.match(rule, /z-index: 0/);
  // `overflow: hidden` clips a background to the border box for free; a child
  // has to ask for the corners.
  assert.match(rule, /border-radius: inherit/);
  // The host is the click target when a card has an href.
  assert.match(rule, /pointer-events: none/);
});

it('drops the has-image flag and the layer when the image is broken', () => {
  const source = codeOnly(CARD_TSX());
  assert.match(source, /const broken = Boolean\(card\.image\) && failed/);
  assert.match(source, /const image = broken \? undefined : card\.image/);
  // Both the class and the layer must read the resolved `image`, not
  // `card.image` — otherwise the scrim paints over an empty box and the host
  // keeps forcing `color: #fff`.
  assert.match(source, /\(image \? ' smd-bento-has-image' : ''\)/);
  assert.match(source, /\{image \? \(/);
  // The failure is remembered per URL, so a card that swaps to a working image
  // is not held broken by its predecessor.
  assert.match(source, /failedSrc === src/);
});

it('fills a broken image-only card instead of leaving a hole', () => {
  const source = codeOnly(CARD_TSX());
  // Only when there is no text: a card with text falls back to the plain
  // surface, which is already legible.
  assert.match(source, /\{broken && !hasText \?/);
  assert.match(source, /className="smd-bento-broken"/);
  assert.match(source, /aria-label="Image unavailable"/);

  const styles = codeOnly(STYLES());
  const broken = styles.indexOf('.smd-bento-broken {');
  assert.ok(broken > 0, 'the broken-card fill should be in the sheet');
  const rule = styles.slice(broken, styles.indexOf("'}',", broken));
  // The same token the hero placeholder uses, resolved live: #35383b.
  assert.match(rule, /background-color: #35383b/);
  // Absolutely positioned, so the host's own surface colour still shows for a
  // card that does have text.
  assert.match(rule, /position: absolute/);
  assert.match(rule, /inset: 0/);
});

it('uses the measured placeholder token and radius, not a guessed grey', () => {
  const styles = codeOnly(STYLES());
  const start = styles.indexOf('.smd-hero-placeholder {');
  assert.ok(start > 0);
  const rule = styles.slice(start, styles.indexOf("'}',", start));
  // `--bard-color-image-placeholder-background` = #35383b on the live page.
  assert.match(rule, /background-color: #35383b/);
  // `.luminous-layout` overrides the base 16px with
  // `--gem-sys-shape--corner-extra-large-max` = 40px, matching the hero image.
  assert.match(rule, /border-radius: 40px/);
  assert.ok(
    !/rgb\(23, 23, 23\)/.test(rule),
    'the placeholder must not reuse the card surface colour'
  );
});

it('pulses a loading placeholder on the captured curve', () => {
  const styles = codeOnly(STYLES());
  assert.match(styles, /animation: smd-hero-pulse 1\.5s linear infinite/);
  // Captured from the live keyframes: 1 → 0.65 at 33% → 1.
  const at = styles.indexOf('@keyframes smd-hero-pulse {');
  assert.ok(at > 0, 'the pulse keyframes should be in the sheet');
  const frames = styles.slice(at, styles.indexOf("'}',", at));
  assert.match(frames, /0% \{ opacity: 1; \}/);
  assert.match(frames, /33% \{ opacity: 0\.65; \}/);
  assert.match(frames, /100% \{ opacity: 1; \}/);
});

// ── The inline image ────────────────────────────────────────────────────────

it('keeps the wrapper holding the image alone, as the emitter builds it', () => {
  const source = codeOnly(INLINE_TSX());
  const wrapper = source.indexOf('smd-inline-image-wrapper');
  const caption = source.indexOf('smd-inline-image-caption');
  assert.ok(wrapper > 0 && caption > wrapper);
  // The sheet also defines `.inline-image-source` and `.inline-expand-button`
  // inside the wrapper, but `Yb` never emits them on this path — they belong to
  // another host that shares the sheet.
  assert.ok(!/inline-image-source/.test(source));
  assert.ok(!/inline-expand-button/.test(source));
});

it('shows the separator only when both a credit and an alt exist', () => {
  const source = codeOnly(INLINE_TSX());
  // f && g && (e += '<span class="caption-separator"> · </span>')
  assert.match(source, /hasCredit && hasAlt \?/);
  // if (f || g) { ... } — no caption element at all otherwise.
  assert.match(source, /const showCaption = hasCredit \|\| hasAlt/);
});

it('caps width by orientation, and lets that cap beat the float rule', () => {
  declares('.smd-inline-landscape', 'max-width', '362px');
  declares('.smd-inline-portrait', 'max-width', '300px');
  const sheet = codeOnly(STYLES()).replace(/',\s*\r?\n\s*'/g, '\n');
  const float = sheet.indexOf('float: right');
  const landscape = sheet.indexOf('.smd-inline-landscape');
  assert.ok(float > 0 && landscape > 0);
  // Authored order: the 768px float block first, the orientation caps after. A
  // probe in the live 708px panel measured 362px, so 40% never applies.
  assert.ok(landscape > float, 'the orientation cap must come after the float');
});

it('does not apply the 959.98px override to the floated container', () => {
  // That rule targets .hero-overlay-container / .hero-image in the separate
  // `single-image` component, so it lives with the hero block. Letting it reach
  // this path would kill the float at every width our panel renders at.
  const joined = codeOnly(STYLES()).replace(/',\s*\r?\n\s*'/g, '\n');
  const blocks = joined.split(/@media/).filter((block) => /959/.test(block));
  assert.ok(blocks.length > 0, 'the hero override should still be present');
  for (const block of blocks) {
    assert.ok(
      !/smd-inline-/.test(block.slice(0, block.indexOf('}') + 1) + block),
      'the 959.98px block must not name the inline-image path'
    );
  }
});

it('keeps the caption in the mono caption face measured live', () => {
  declares('.smd-inline-image-caption', 'font-family', '"Google Sans Code", monospace');
  declares('.smd-inline-image-caption', 'font-size', '13px');
  declares('.smd-inline-image-caption', 'line-height', '20px');
  declares('.smd-inline-image-caption', 'font-style', 'italic');
  declares('.smd-inline-image-caption', 'padding-block', '8px 24px');
  declares('.smd-inline-image-caption', 'padding-inline-start', '16px');
  declares('.smd-inline-image-caption', 'text-overflow', 'ellipsis');
  assert.match(rule('.smd-inline-image-caption'), /"MONO" 0/);
});

it('backs the wrapper cursor with a real click, so the pointer is not a lie', () => {
  // `cursor: pointer` is Gemini's own value on the wrapper. Reproducing it
  // without an action would promise a click that does nothing.
  declares('.smd-inline-image-wrapper', 'cursor', 'pointer');
  const source = codeOnly(INLINE_TSX());
  assert.match(source, /className="smd-inline-image-wrapper"[\s\S]{0,240}onClick=/);
  assert.match(source, /window\.open\(src, '_blank', 'noopener,noreferrer'\)/);
});

it('rounds the wrapper to the measured 28px and offsets it by 24px', () => {
  // 1.75rem and 1.5rem at the measured 16px root.
  declares('.smd-inline-image-wrapper', 'border-radius', '28px');
  declares('.smd-inline-image-wrapper', 'margin-block-start', '24px');
  declares('.smd-inline-img', 'width', '100%');
  declares('.smd-inline-img', 'height', 'auto');
});

// ── Wiring into the renderer ────────────────────────────────────────────────

it('dispatches the card fence from the existing code branch', () => {
  const source = codeOnly(MARKDOWN());
  assert.match(source, /isBentoFence\(node\.lang\)/);
  // Nothing, not a code block, while the JSON is still incomplete.
  assert.match(source, /cards \? <BentoCardGroup key=\{key\} cards=\{cards\} \/> : null/);
});

it('routes a lone markdown image to the hero host, not the floated one', () => {
  // Live, `single-image` hangs off `div.attachment-container.search-images` —
  // a block sibling of the prose, which is the shape an "images of …" answer
  // takes. The floated `.inline-image-container` is the in-prose case.
  const source = codeOnly(MARKDOWN());
  assert.match(source, /<GeminiSingleImage/);
  assert.match(source, /<GeminiInlineImage/);
  // `media-id:` images stay with MediaGallery — they carry a status, a ratio and
  // a fullscreen action that a cited image has none of.
  assert.match(source, /url\.startsWith\('media-id:'\)/);
  const inline = source.indexOf('standaloneInlineImage(node, context)');
  const media = source.indexOf('standaloneMedia(node, context)', inline);
  assert.ok(inline > 0 && media > inline, 'the inline check must run first');
});

it('hoists an in-prose image out of the paragraph, as the parser does', () => {
  // Gemini's host writes markdown as an HTML string, so Chrome's parser has the
  // last word — and it hoists: `<p>a<div/>b</p>` parses to `<p>a</p><div/>"b"`.
  // A `<span>` in the same slot stays nested, so it is the block display doing
  // it. React would nest the div instead, so the hoist is explicit.
  const source = codeOnly(MARKDOWN());
  const hoist = source.indexOf('hoistableInlineImage(child, context)');
  assert.ok(hoist > 0, 'the paragraph walk must offer each child to the hoist');
  const flush = source.indexOf('flushInline();', hoist);
  assert.ok(flush > hoist && flush - hoist < 200, 'the open paragraph must be flushed first');
  // Same media-id exclusion as the hero path.
  assert.match(
    source.slice(source.indexOf('function hoistableInlineImage')),
    /^[\s\S]{0,900}?url\.startsWith\('media-id:'\)/
  );
});

// ── The hero host (`single-image`) ──────────────────────────────────────────

it('reproduces the captured hero tree exactly', () => {
  const source = codeOnly(HERO_TSX());
  // single-image > .image-container > .overlay-container > button > img
  const order = [
    'smd-single-image',
    'smd-image-container',
    'smd-hero-overlay-container',
    'smd-image-button',
    'smd-hero-image',
    'smd-hero-caption-row',
    'smd-hero-caption',
  ];
  let at = -1;
  for (const cls of order) {
    const next = source.indexOf(cls, at + 1);
    assert.ok(next > at, `${cls} is missing or out of order`);
    at = next;
  }
  assert.match(source, /data-full-size-image-uri=/);
});

it('leaves the hero img inline, because the 4px gap is a line box', () => {
  // Measured: button 263x384 around a 380px img, with the button's computed
  // padding at 0. The delta is the inline descender gap. Forcing display:block
  // would silently lose those 4px.
  const body = rule('.smd-hero-image');
  assert.ok(!/display\s*:/.test(body), '.smd-hero-image must not set display');
  declares('.smd-hero-image', 'border-radius', '40px');
  declares('.smd-image-button', 'padding', '0');
  declares('.smd-image-button', 'border', 'none');
});

it('splits the hero caption into a bare text node and a source span', () => {
  // Measured on the live node: the caption's children are
  //   #text " Sabrina Carpenter performing live. "   (230.8x16.8)
  //   span  "Source: Wikipedia"                      (116x16.8)
  // The description is NOT wrapped — only the attribution is. The span computes
  // identically to its parent, so it is structural, and the text node's
  // trailing space is what separates the halves.
  const tsx = HERO_TSX();
  assert.ok(
    /captionSource\?: string/.test(tsx),
    'the source half must be its own prop, not concatenated into the caption'
  );
  assert.ok(
    /\{captionText \? ' ' \+ captionText \+ ' ' : null\}/.test(tsx),
    'the description must render as a bare padded text node, not inside a span'
  );
  assert.ok(
    /\{captionSource \? <span>\{captionSource\}<\/span> : null\}/.test(tsx),
    'only the source belongs in the span'
  );
  assert.ok(
    !/<span>\{caption\}<\/span>/.test(tsx),
    'the whole caption must not be wrapped in one span'
  );
});

it('caps the hero against the declared width, at both measured breakpoints', () => {
  // --hero-declared-width is the intrinsic width (263 = the width attribute =
  // naturalWidth), published so the CSS can cap against it.
  assert.match(rule('.smd-hero-overlay-container'), /max-width:\s*min\(var\(--hero-declared-width/);
  const joined = codeOnly(STYLES()).replace(/',\s*\r?\n\s*'/g, '\n');
  assert.match(joined, /min-width:\s*600px[\s\S]{0,200}36\.25rem/);
  assert.match(joined, /max-width:\s*959\.98px[\s\S]{0,160}smd-hero-overlay-container/);
  const source = codeOnly(HERO_TSX());
  assert.match(source, /'--hero-declared-width'/);
  assert.match(source, /naturalWidth/);
});

it('emits no vertical margin on the container, matching the live computed 0', () => {
  // The authored sheet declares margin-block: var(--gem-sys-spacing--m) (12px),
  // but the live node computes 0px top and bottom. The measurement wins.
  const body = rule('.smd-image-container');
  assert.ok(!/margin/.test(body), '.smd-image-container must not set a margin');
  declares('.smd-image-container', 'flex-direction', 'column');
  declares('.smd-image-container', 'align-items', 'center');
  // 384 + 8 + 40 = 432, the measured overlay height.
  declares('.smd-hero-caption-row', 'margin-top', '8px');
});

it('gives a failed hero image Gemini’s own error placeholder', () => {
  // The blank second card in the report was a card-shaped hole. Gemini's
  // .placeholder.error is a 200px block with a centred message.
  const source = codeOnly(HERO_TSX());
  assert.match(source, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(source, /smd-hero-error/);
  declares('.smd-hero-placeholder', 'height', '200px');
  // 40px, not the base sheet's 16px: `.luminous-layout:host .placeholder`
  // overrides it with --gem-sys-shape--corner-extra-large-max, which resolves
  // to 40px on the live page — the same radius as the hero image it replaces.
  declares('.smd-hero-placeholder', 'border-radius', '40px');
  declares('.smd-hero-placeholder', 'align-items', 'center');
  declares('.smd-hero-message', 'text-align', 'center');
});

it('keeps the hero image keyboard-reachable and opens the full-size original', () => {
  // Gemini's is a real <button> opening its lightbox. We have no lightbox for a
  // cited image, so it opens data-full-size-image-uri — the original, not the
  // encrypted-tbn0.gstatic.com thumbnail sitting in src.
  const source = codeOnly(HERO_TSX());
  assert.match(source, /<button\s+type="button"/);
  assert.match(source, /const openTarget = fullSizeUri \|\| src;/);
  assert.match(source, /window\.open\(openTarget, '_blank', 'noopener,noreferrer'\)/);
  assert.match(source, /aria-label=/);
});

it('animates the hero in only once decoded, so a cached image still shows', () => {
  declares('.smd-hero-image.loaded', 'animation', 'smd-hero-zoom-load 0.2s cubic-bezier(0.2, 0, 0, 1) forwards');
  const joined = codeOnly(STYLES()).replace(/',\s*\r?\n\s*'/g, '\n');
  assert.match(joined, /@keyframes smd-hero-zoom-load[\s\S]{0,200}scale\(1\.15\)/);
  // The class gates the animation, not visibility — no onLoad, no animation,
  // but the image is still there.
  const body = rule('.smd-hero-image');
  assert.ok(!/opacity/.test(body), 'the base hero rule must not hide the image');
});

it('offers the card fence to the providers it has been exercised against', async () => {
  const { chatSystemPromptFor, supportsCards, CARD_CAPABLE_PROVIDERS, CHAT_SYSTEM_PROMPT, CARD_SYSTEM_PROMPT } =
    await importTs(chatSrc('chat-model.ts'));
  const ALL = ['gemini', 'openai', 'anthropic', 'moonshot', 'spacexai', 'zhipuai'];
  // Driven by the set, not by a provider literal: whatever is listed gets the
  // card prompt and whatever is not gets the base one. Adding a provider to
  // CARD_CAPABLE_PROVIDERS is then the whole change, and this test moves with it.
  // The prompt now carries a per-turn date line, so this asserts on the prefix
  // rather than on equality — pinning the whole string would make the suite fail
  // at midnight rather than on a real regression.
  for (const provider of ALL) {
    const expected = CARD_CAPABLE_PROVIDERS.includes(provider)
      ? CHAT_SYSTEM_PROMPT + CARD_SYSTEM_PROMPT
      : CHAT_SYSTEM_PROMPT;
    assert.ok(chatSystemPromptFor(provider).startsWith(expected), provider);
    assert.equal(supportsCards(provider), CARD_CAPABLE_PROVIDERS.includes(provider), provider);
  }
  assert.ok(CARD_CAPABLE_PROVIDERS.length > 0, 'no provider can emit a card');
  assert.match(CARD_SYSTEM_PROMPT, /bento-cards/);
});

it('grounds every turn in the current date without hardcoding one', async () => {
  // Gemini's prompt ships a literal "Monday, May 18, 2026" line, which is right
  // for a server that re-renders per request and wrong for a source file: a
  // committed date is stale the next day and the model dates its answers by it.
  const { chatSystemPromptFor, liveSystemPrompt, currentDateLine, CHAT_SYSTEM_PROMPT } =
    await importTs(chatSrc('chat-model.ts'));

  const day = new Date('2026-08-10T12:00:00Z');
  assert.equal(currentDateLine(day), 'Current date: Monday, August 10, 2026');
  // A different date must actually move the line, or it is hardcoded again.
  assert.notEqual(currentDateLine(new Date('2027-01-02T12:00:00Z')), currentDateLine(day));

  for (const built of [chatSystemPromptFor('gemini', day), liveSystemPrompt(day)]) {
    assert.match(built, /Current date: Monday, August 10, 2026/);
  }
  // The constant stays date-free so the date can only come from the builder.
  assert.ok(!/Current date:/.test(CHAT_SYSTEM_PROMPT), 'a date leaked into the constant');
});

it('does not promise chat-mode media generation it cannot perform', async () => {
  // Image/video/music are real Willow features, but they belong to the media
  // agent — `enableMediaTools` in platform/ai/src/chat.ts, which chat mode
  // leaves off. A chat turn told it can generate video announces a render that
  // never lands, which is the exact failure the media-tools gate exists to stop.
  const { CHAT_SYSTEM_PROMPT } = await importTs(chatSrc('chat-model.ts'));
  assert.match(CHAT_SYSTEM_PROMPT, /Media/);
  assert.match(CHAT_SYSTEM_PROMPT, /cannot generate, edit or render images, video or audio/);
  // Quota and subscription language described Google's tiers, not an app that
  // runs on the user's own API keys.
  for (const dead of [/\bquota\b/i, /\bAI Plus\b/, /\bUltra\b/, /subscriber/i, /per day/i]) {
    assert.ok(!dead.test(CHAT_SYSTEM_PROMPT), `tier/quota language survived: ${dead}`);
  }
  // Renderer-less affordances from the source prompt.
  assert.ok(!/<Image of/.test(CHAT_SYSTEM_PROMPT), 'diagram tag has no renderer');
  assert.ok(!/GenerateWidget/.test(CHAT_SYSTEM_PROMPT), 'widget schema has no renderer');
});

it('presents the assistant as Willow', async () => {
  const { CHAT_SYSTEM_PROMPT } = await importTs(chatSrc('chat-model.ts'));
  assert.match(CHAT_SYSTEM_PROMPT, /^You are Willow\./);
  // The card prompt legitimately mentions Gemini in its doc comment; the prompt
  // text the model actually receives must not name another product.
  assert.ok(!/\bGemini\b/.test(CHAT_SYSTEM_PROMPT), 'Gemini survived in the prompt body');
});

it('keeps the Code agent out of the chat prompt', async () => {
  // Chat, Code and Media are three agents with three prompts. This one used to
  // carry `Do not wrap responses in boltArtifact or any XML tags` — a negative
  // instruction naming Code's artifact envelope, which taught the tag to the one
  // agent that must not emit it. A chat model never shown that grammar cannot
  // fall into it, and nothing in features/chat parses an artifact, so a leaked
  // envelope would render as literal text rather than a workbench.
  const { CHAT_SYSTEM_PROMPT, CARD_SYSTEM_PROMPT } = await importTs(chatSrc('chat-model.ts'));
  for (const prompt of [CHAT_SYSTEM_PROMPT, CARD_SYSTEM_PROMPT]) {
    assert.ok(!/boltArtifact|boltAction/i.test(prompt), "Code's artifact envelope leaked into a chat prompt");
  }
});

it('keeps the deferred blocks as comments rather than losing them', async () => {
  // Four blocks from the source prompt are held out of the shipped prompt
  // because no tool backs them — not because they are unwanted. Each is the
  // spec half of an unbuilt feature and gets pasted back the day its tool is
  // declared, so they are kept verbatim as comments at the prompt they slot
  // into. The source they came from was never committed, so if these go, the
  // text is gone; that is what this test is really protecting.
  const chatModel = fs.readFileSync(chatSrc('chat-model.ts'), 'utf8');
  const mediaView = fs.readFileSync(
    path.join(repoRoot, 'features', 'media', 'src', 'MediaView.tsx'),
    'utf8',
  );

  // The three chat-surface blocks live at Chat's prompt.
  for (const block of [/<Image of X>/, /MASTER RULE/, /Interactive Widget Architect/]) {
    assert.match(chatModel, block, `a deferred chat block went missing: ${block}`);
  }
  // The media block lives at the media agent's prompt instead, because that is
  // the one surface with `enableMediaTools` on — a chat turn carrying it would
  // announce a render that never lands, which is the whole reason for the split.
  assert.match(mediaView, /music_generation/, 'the deferred media block went missing');
  assert.match(mediaView, /enableMediaTools: true/, 'the media block lost its executor');

  // Comments, not code. `codeOnly` strips block comments, so if a block ever
  // becomes a live string constant it shows up here — which matters because a
  // stray constant is one concatenation away from reaching a real prompt.
  const chatCode = codeOnly(chatModel);
  for (const block of [/<Image of X>/, /MASTER RULE/, /GenerateWidget/]) {
    assert.ok(!block.test(chatCode), `a deferred block became live code: ${block}`);
  }
  assert.ok(
    !/music_generation/.test(codeOnly(mediaView)),
    'the deferred media block became live code',
  );

  // Stored already converted, so pasting one back cannot silently reintroduce
  // the source's plan tiers into a shipped prompt.
  for (const dead of [/\bAI Plus\b/, /\bUltra\b/, /subscriber/i, /\bQuota:/]) {
    for (const [name, source] of [['chat-model.ts', chatModel], ['MediaView.tsx', mediaView]]) {
      assert.ok(!dead.test(source), `${name} still carries tier language: ${dead}`);
    }
  }

  // The temp file these were recovered from must not come back as a stray copy
  // at the repo root; the comments above are the one home for this text.
  assert.ok(
    !fs.existsSync(path.join(repoRoot, 'gemini-system-prompt.md')),
    'the scratch prompt file is back — fold it into the comments and delete it',
  );
});

it('does not reach into another feature for the composer dialog', () => {
  // The composer's GitHub import lived in features/code and was imported from
  // chat, which was the whole of Chat's dependency on Code — Code never used it.
  // It now sits in platform/ui, so this asserts the edge stays gone.
  const composer = fs.readFileSync(chatSrc('composer/Composer.tsx'), 'utf8');
  assert.match(composer, /from '@willow\/ui\/github\/GithubImportDialog'/);
  assert.ok(
    !/@willow\/code/.test(codeOnly(composer)),
    'the composer imports from features/code again',
  );
});

it('gates the card prompt on the capability set rather than on a provider name', () => {
  // The gate used to read `provider === 'gemini'`, which made "enable cards for
  // grok" a code change in a function instead of a one-line data change. The
  // renderer never saw a provider even then, so this was the only hardcoding.
  const source = codeOnly(fs.readFileSync(chatSrc('chat-model.ts'), 'utf8'));
  const start = source.indexOf('export const chatSystemPromptFor');
  assert.ok(start > 0, 'could not find the prompt gate');
  // Stop at the next declaration. `resolveChatModel` further down legitimately
  // reads `provider === 'openai'` to pick a -pro model id, and that has nothing
  // to do with cards.
  const gate = source.slice(start, source.indexOf('export type ChatProvider'));
  assert.match(gate, /supportsCards\(provider\)/);
  assert.ok(
    !/provider\s*===\s*'/.test(gate),
    'the gate compares against a provider literal again'
  );
});

it('keeps the card render path blind to the provider', () => {
  // Universality is only real if nothing downstream of the fence knows who wrote
  // it. The parser dispatches on the fence language; the renderer takes cards.
  for (const [name, source] of [
    ['gemini-cards.ts', CARDS_TS()],
    ['GeminiBentoCard.tsx', CARD_TSX()],
  ]) {
    const code = codeOnly(source);
    assert.ok(
      !/\bprovider\s*===/.test(code),
      `${name} branches on a provider`
    );
    assert.ok(
      !/\b(gemini|openai|anthropic|moonshot|spacexai|zhipuai)\b/i.test(
        // `provider` is a legitimate card *field* (image credit) in both files.
        code.replace(/GeminiBentoCard|gemini-cards/g, '')
      ),
      `${name} names a provider in code`
    );
  }
});

it('keeps pictures out of the card fence, whatever the count', () => {
  // The reported bug: "show me two images" came back as two cards, the second
  // blank. The prompt had said to use markdown for a *single* ordinary image,
  // so two images read as a job for the card fence's `image` field. The rule
  // has to be count-independent, or the same reading returns.
  const source = fs.readFileSync(chatSrc('chat-model.ts'), 'utf8');
  const start = source.indexOf('export const CARD_SYSTEM_PROMPT');
  assert.ok(start > 0, 'could not find the card prompt');
  // End at the next declaration, not at `chatSystemPromptFor` — the capability
  // set now sits between them, and slicing past it would let its doc comment
  // satisfy assertions that are supposed to be about the prompt.
  const prompt = source.slice(start, source.indexOf('export const CARD_CAPABLE_PROVIDERS'));

  assert.match(prompt, /Never use cards to show pictures/);
  assert.match(prompt, /one image ' \+\s*'or several/);
  assert.ok(
    !/for a single ordinary image/i.test(prompt),
    'the singular carve-out is what let two images become two cards'
  );
});
