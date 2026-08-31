/**
 * Source-text assertions over the "View sources" menu row and the sources
 * sidebar, checked against the values measured off the live Gemini app.
 *
 * These are text assertions, not a render, for the same reason the rest of this
 * suite is: there is no DOM harness here. What they protect is every number that
 * came out of the extraction, so a later edit cannot quietly drift off Gemini's
 * geometry without a test naming the measurement it broke.
 *
 * Measured on Gemini at viewport 1536x826:
 *   context-sidebar    400 x 793.6 at (1120, 16), margin 16px
 *   .container         bg #131314, radius 16px, border 0.8px rgba(255,255,255,.12)
 *   .header            64px tall, padding 12px 12px 12px 24px
 *   h2 "Sources"       20px / 24px, weight 470, ROND 20 / wdth 94
 *   close button       40x40, radius 9999px, #c4c7c5, aria-label "Close sidebar"
 *   side-bar-sources   padding 0 12px
 *   .all-sources       gap 12px, padding 0 0 12px, overflow auto
 *   inline-source-card 12px card-to-card, measured not inferred
 *   menu row           36px tall; "View sources" icon link_2, ns lumi-symbols
 */
import { it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), 'utf8');

const CHROME = () => read('features', 'chat', 'src', 'ChatResponseChrome.tsx');
const CHAT_VIEW = () => read('features', 'chat', 'src', 'ChatView.tsx');
const SOURCE_CHIP = () => read('platform', 'ui', 'src', 'SourceChip.tsx');
const STYLES = () => read('platform', 'ui', 'src', 'streaming-markdown-styles.ts');

it('offers "View sources" only on a grounded turn', () => {
  const chrome = CHROME();
  assert.match(
    chrome,
    /\.\.\.\(canShowSources \? \[\{ label: 'View sources', symbol: 'link_2'/,
    'the row must stay gated on canShowSources — Gemini hides it when nothing was searched',
  );
  assert.match(
    CHAT_VIEW(),
    /canShowSources=\{!!msg\.citations\?\.sources\?\.length\}/,
    'the gate must read the turn\'s own sources, not a global search flag',
  );
});

it('keeps Gemini\'s measured row order', () => {
  const chrome = CHROME();
  const sources = chrome.indexOf("label: 'View sources'");
  const legal = chrome.indexOf("label: 'Report legal issue'");
  const thinking = chrome.indexOf("label: 'Show thinking steps'");
  assert.ok(sources > 0 && legal > 0 && thinking > 0, 'could not locate all three menu rows');
  assert.ok(
    legal < sources && sources < thinking,
    'measured order is Report legal issue -> View sources -> Show thinking steps',
  );
});

it('derives the menu height from the measured 36px row', () => {
  assert.match(
    CHROME(),
    /const menuHeight = menuItems\.length \* 36 \+ 16;/,
    'a tabulated height goes wrong the moment a row becomes conditional',
  );
});

it('renders both context panels through one measured shell', () => {
  const chrome = CHROME();
  assert.match(chrome, /const ContextSidebar/, 'the shared shell is gone');
  assert.match(chrome, /export const SourcesSidebar/, 'SourcesSidebar is not exported');
  assert.match(chrome, /export const ThinkingStepsSidebar/, 'ThinkingStepsSidebar is not exported');

  const shellCount = (chrome.match(/w-\[400px\] max-w-\[calc\(100%_-_32px\)\]/g) || []).length;
  assert.equal(shellCount, 1, 'the 400px shell is declared more than once — Gemini reuses one element');
});

it('keeps the measured sidebar list geometry', () => {
  const chrome = CHROME();
  const list = chrome.match(/className="[^"]*gap-3[^"]*"/g) || [];
  assert.ok(list.length > 0, 'the 12px measured card gap (gap-3) is missing');
  assert.match(chrome, /px-3 pb-3/, 'side-bar-sources padding was 0 12px with 12px below the list');
});

it('reuses Gemini\'s shared source card rather than a parallel copy', () => {
  assert.match(
    SOURCE_CHIP(),
    /export const SourceCard/,
    'SourceCard must stay exported — Gemini uses inline-source-card in both places',
  );
  assert.match(
    CHROME(),
    /SourceCard/,
    'the sidebar must render SourceCard, not a second set of card rules',
  );
});

it('clears the other panels when sources opens', () => {
  const view = CHAT_VIEW();
  const handler = view.match(/const handleOpenSources = useCallback\(([\s\S]{0,340}?)\n {2}\}/);
  assert.ok(handler, 'could not locate handleOpenSources');
  assert.match(handler[1], /setOpenThinkingMessageId\(null\)/, 'thinking steps would stack behind sources');
  assert.match(handler[1], /setOpenResource\(null\)/, 'the resource panel would stack behind sources');
});

it('swaps the right-hand panels one at a time, not over each other', () => {
  /*
   * All four panels — thinking, sources, resource preview, canvas — occupy the
   * same corner and animate along the same axis, sliding in from x:424 and back
   * out to x:424. (The canvas is the exception on that last point: it scales in
   * like Gemini's immersive panel. It still shares the slot.)
   *
   * Given an AnimatePresence each, swapping one for another ran both
   * animations at once: the outgoing panel slid right while the incoming one
   * slid left across it, which reads as a flicker rather than a transition.
   * `handleOpenThinking` clears the resource and sets the thinking id in the
   * same commit, so opening "Show thinking steps" over a resource preview is
   * the case that shows it.
   *
   * One presence in `mode="wait"` is the fix: the outgoing panel finishes
   * leaving before the incoming one starts arriving.
   */
  const view = CHAT_VIEW();

  const presence = /<AnimatePresence mode="wait">([\s\S]*?)<\/AnimatePresence>/.exec(view);
  assert.ok(presence, 'the right-hand panels must share one presence, in wait mode');
  for (const panel of ['ThinkingStepsSidebar', 'SourcesSidebar', 'RichResourcePanel', 'CanvasPanel']) {
    assert.ok(
      presence[1].includes(`<${panel}`),
      `${panel} must be inside the shared presence, not in one of its own`,
    );
  }

  // Prefixed keys: two different panels can belong to the same message id, and
  // an unchanged key would swap the contents without animating at all.
  assert.match(view, /key=\{`thinking-\$\{thinkingMessage\.id\}`\}/);
  assert.match(view, /key=\{`sources-\$\{sourcesMessage\.id\}`\}/);

  // And the panels must still have an exit for the wait to wait on.
  assert.match(CHROME(), /exit=\{\{ opacity: 0, x: 424 \}\}/);
});

it('gates the 428px layout shift on either panel', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /const contextSidebarOpen = !!thinkingMessage \|\| !!sourcesMessage;/,
    'both panels share the slot, so the shift must gate on either',
  );
  assert.ok(
    !/thinkingMessage \? 'min-\[1024px\]:mr-\[428px\]'/.test(view),
    'the margin still gates on thinkingMessage alone — the thread will not move for sources',
  );
});

it('resets the open panel when the chat changes', () => {
  assert.match(
    CHAT_VIEW(),
    /setOpenSourcesMessageId\(null\)/,
    'a stale sources panel would survive a chat switch',
  );
});

/*
 * The favicon host.
 *
 * A live capture of `streamGenerateContent` showed every groundingChunk's `uri`
 * pointing at `vertexaisearch.cloud.google.com/grounding-api-redirect/…`.
 * Deriving the favicon host from `uri` therefore asked Google for the icon of
 * its own redirect service, which answers HTTP 404 with a 16x16 generic globe --
 * measured, alongside the same request for `nasa.gov` / `wikipedia.org` /
 * `spacedaily.com`, which each answered 200 with a 32x32 icon.
 */
it('builds the favicon from the publisher host, never the redirect uri', () => {
  const chip = SOURCE_CHIP();

  assert.match(
    chip,
    /const faviconUrl = \(source: SourceChipItem\)/,
    'faviconUrl must take the source — taking a bare uri is what caused the globe',
  );
  assert.ok(
    !/faviconUrl\(source\.uri\)/.test(chip),
    'faviconUrl is being handed the redirect uri again; every card will show a globe',
  );
  assert.match(
    chip,
    /const hostFor = \(source: SourceChipItem\): string => \{[\s\S]{0,200}?if \(source\.domain\) return source\.domain;/,
    'hostFor must prefer `domain` — it is the only field carrying the real publisher host',
  );
  assert.match(
    chip,
    /host\.endsWith\('\.google\.com'\) \? '' : host/,
    'the uri fallback must reject google.com hosts, or the redirect host returns through the back door',
  );
});

/*
 * Rows 1 and 2 must not print the same string.
 *
 * On the captured payload `title` and `domain` are both the bare host
 * ("nasa.gov"), so rendering both unconditionally repeats it. Gemini's two rows
 * always differ: a publisher name over a page headline.
 */
it('drops the title row when it would only repeat the host', () => {
  assert.match(
    SOURCE_CHIP(),
    /const title = source\.title && source\.title !== path \? source\.title : '';/,
    'the title row must be suppressed when it equals the path row',
  );
  assert.match(
    SOURCE_CHIP(),
    /\{title && <div className="smd-src-card-title">\{title\}<\/div>\}/,
    'the title row must be conditionally rendered',
  );
});

/*
 * Row 3, the snippet.
 *
 * Its values could not be read for a long time: Angular injects
 * `inline-source-card`'s stylesheet on first mount, and with no card mounted a
 * full CSSOM walk found the chip's rules and none of the card's (4,657 rules
 * examined, zero hits). Hovering a source chip mounts the component, after which
 * the live `div.snippet.gds-body-s` measured:
 *
 *   padding      8px 0 0        <- this IS the gap; no `gap`, no `margin`
 *   font         13px / 17px    <- gds-body-s
 *   color        #c4c7c5        <- rgb(196, 199, 197)
 *   clamp        2 lines, overflow-wrap: anywhere
 *   box          x 542.73, y 82, w 348, h 42, in a 364x104 card
 *
 * The card is 104px tall with the row and 82px without it, against our previous
 * 56.4px.
 */
it('carries the measured snippet row', () => {
  const styles = STYLES();
  const rule = styles.match(/'\.smd-src-card-snippet \{',([\s\S]*?)'\}',/);
  assert.ok(rule, '.smd-src-card-snippet is missing — the third row has no styling');
  const body = rule[1];

  assert.match(body, /padding-top: 8px;/, 'the 8px padding-top IS the measured title-to-snippet gap');
  assert.match(body, /font-size: 13px;/, 'measured 13px (gds-body-s)');
  assert.match(body, /line-height: 17px;/, 'measured 17px');
  assert.match(body, /color: #c4c7c5;/, 'measured rgb(196, 199, 197)');
  assert.match(body, /-webkit-line-clamp: 2;/, 'Gemini clamps the snippet at 2 lines, not 1 like the title');
  assert.match(body, /overflow-wrap: anywhere;/, 'measured overflow-wrap');
  assert.ok(
    !/width:|max-width:|align-self:/.test(body),
    'the measured 348px is just the content box (364 - 8 - 8); pinning a width breaks the short-title case',
  );
});

/*
 * The card renders in two places and one of them inherits from the wrong
 * ancestor: `.smd-src-pane` is portalled to <body>, outside `.smd-root`, so it
 * never sees the font-family that rule sets. Measured in Willow — a probe element
 * carrying `.smd-src-card-title` in <body> computed `Inter, sans-serif` at 16/24,
 * the page default, against Gemini's "Google Sans Flex" / wdth 92 / wght 400.
 */
it('gives the card its own font, since the pane is portalled out of .smd-root', () => {
  const styles = STYLES();
  const rule = styles.match(/'\.smd-src-card-inner \{',([\s\S]*?)'\}',/);
  assert.ok(rule, '.smd-src-card-inner is missing');
  assert.match(
    rule[1],
    /font-family: "Google Sans Flex"/,
    'without this the portalled card falls back to the page font (measured: Inter)',
  );
  assert.match(
    rule[1],
    /font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;/,
    'measured off Gemini\'s own rows',
  );
});

/*
 * The excerpt is bracketed by two curly-quote spans in Gemini's template, not in
 * the data: its live row read `<span>“</span>Lyrically, Swift was…<span>”</span>`.
 * Reproducing it as spans keeps the structure that was measured.
 */
it('brackets the snippet in Gemini\'s own quote spans', () => {
  assert.match(
    SOURCE_CHIP(),
    /<div className="smd-src-card-snippet">\s*<span>\{'“'\}<\/span>\{snippet\}<span>\{'”'\}<\/span>/,
    'the quotation marks are template chrome, measured inside the clamped box',
  );
});

/*
 * The row is per-provider, not a preference. Gemini's `groundingChunks[].web`
 * carries no excerpt; Anthropic's `cited_text` does. A source without one must
 * render the two-row card exactly as it shipped, never an empty third row.
 */
it('renders the snippet row only when the provider sent one', () => {
  const chip = SOURCE_CHIP();
  assert.match(
    chip,
    /const snippet = \(source\.snippet \|\| ''\)\.trim\(\);/,
    'the snippet must be read defensively — most providers never send one',
  );
  assert.match(chip, /\{snippet && \(/, 'the row must be conditional, or a snippet-less source shows a gap');
  assert.match(
    chip,
    /snippet\?: string;/,
    'SourceChipItem must declare snippet as optional, mirroring GroundingSource',
  );
  assert.ok(
    !/-webkit-line-clamp: 2[\s\S]*?slice\(0,|snippet\.slice\(/.test(chip),
    'clamping belongs to CSS — the card is fluid, so a character count cuts at a different place per width',
  );
});
