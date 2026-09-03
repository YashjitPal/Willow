import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const loadReveal = () => importTs(
  path.join(root, 'platform/ui/src/streaming-text-reveal.ts'),
);

describe('Gemini-style streaming text reveal', () => {
  it('keeps every promoted chunk as an ordered prefix', async () => {
    const { nextStreamingRevealLength } = await loadReveal();
    const source = 'One small step for Willow, one smoother response for the screen.';
    let length = 0;
    const prefixes = [];

    while (length < source.length) {
      const next = nextStreamingRevealLength(source, length);
      assert.ok(next > length, 'each release must make progress');
      length = next;
      prefixes.push(source.slice(0, length));
    }

    assert.equal(prefixes.at(-1), source);
    assert.ok(prefixes.every((prefix) => source.startsWith(prefix)));
  });

  it('releases a larger chunk when a buffered response has a large backlog', async () => {
    const { nextStreamingRevealLength } = await loadReveal();
    const small = 'one two three';
    const large = Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ');

    const smallRelease = nextStreamingRevealLength(small, 0);
    const largeRelease = nextStreamingRevealLength(large, 0);

    assert.ok(smallRelease < small.length, 'a small live suffix is still paced');
    assert.ok(largeRelease > smallRelease * 4, 'a large backlog catches up more aggressively');
    assert.ok(largeRelease < large.length, 'a buffered response is not dumped all at once');
  });

  it('promotes complete sentence and paragraph runs instead of ticking word by word', async () => {
    const { nextStreamingRevealLength } = await loadReveal();
    const source = 'First sentence arrives together. Second sentence follows.\n\nThird paragraph.';

    const first = nextStreamingRevealLength(source, 0);
    const second = nextStreamingRevealLength(source, first);

    assert.equal(source.slice(0, first), 'First sentence arrives together. ');
    assert.equal(source.slice(first, second), 'Second sentence follows.\n\n');
  });

  it('uses Gemini measured variable pacing rather than a fixed interval', async () => {
    const {
      nextStreamingRevealDelayMs,
      STREAM_REVEAL_MIN_INTERVAL_MS,
      STREAM_REVEAL_MAX_INTERVAL_MS,
    } = await loadReveal();
    const short = 'Hi. More follows.';
    const long = `${'A'.repeat(180)}. More follows.`;

    assert.equal(nextStreamingRevealDelayMs(short, 0), STREAM_REVEAL_MIN_INTERVAL_MS);
    assert.equal(nextStreamingRevealDelayMs(long, 0), STREAM_REVEAL_MAX_INTERVAL_MS);
    assert.ok(
      nextStreamingRevealDelayMs(`${'A'.repeat(80)}. More follows.`, 0)
        > nextStreamingRevealDelayMs(short, 0),
    );
  });

  it('continues draining the final pending suffix after generation completes', async () => {
    const { initialStreamingReveal, nextStreamingRevealLength } = await loadReveal();
    const source = Array.from({ length: 32 }, (_, index) => `token${index}`).join(' ');
    let visible = initialStreamingReveal(source, true);

    assert.notEqual(visible, source);
    while (visible.length < source.length) {
      visible = source.slice(0, nextStreamingRevealLength(source, visible.length));
    }

    assert.equal(visible, source);
  });

  it('keeps an extending stream but resets text belonging to another response', async () => {
    const { reconcileStreamingReveal } = await loadReveal();

    assert.equal(
      reconcileStreamingReveal('hello ', 'hello world', true),
      'hello ',
    );
    assert.equal(
      reconcileStreamingReveal('first answer', 'replacement answer', true),
      '',
    );
    assert.equal(
      reconcileStreamingReveal('too much text', 'too much', true),
      'too much',
    );
  });

  it('shows everything immediately when pacing is disabled', async () => {
    const { initialStreamingReveal, reconcileStreamingReveal } = await loadReveal();
    const source = 'Reduced motion and settled messages should not be delayed.';

    assert.equal(initialStreamingReveal(source, false), source);
    assert.equal(reconcileStreamingReveal('', source, false), source);
  });

  it('routes newly-created assistant errors through the same reveal path', () => {
    const ui = fs.readFileSync(
      path.join(root, 'platform/ui/src/StreamingMarkdown.tsx'),
      'utf8',
    );
    const chat = fs.readFileSync(
      path.join(root, 'features/chat/src/ChatView.tsx'),
      'utf8',
    );

    assert.match(
      chat,
      /role: 'assistant',[\s\S]{0,140}isGenerating: true,[\s\S]{0,80}isNew: true,/,
      'new assistant placeholders need a transient flag that saved errors do not retain',
    );
    assert.match(
      chat,
      /reveal=\{generating \|\| \(!!msg\.isError && !!msg\.isNew\)\}/,
      'a hard-coded inline error should use the same animated reveal path as a model stream',
    );
    assert.match(
      chat,
      /revealAsSingleChunk=\{!!msg\.isError && !!msg\.isNew\}/,
      'both sentences of a hard-coded error must enter as one complete animated chunk',
    );
    assert.match(
      ui,
      /if \(revealAsSingleChunk && revealRequested\)/,
      'a static error replacing a mounted stream must promote its complete text',
    );
  });

  it('holds response actions until the renderer reports reveal completion', () => {
    const ui = fs.readFileSync(
      path.join(root, 'platform/ui/src/StreamingMarkdown.tsx'),
      'utf8',
    );
    const chat = fs.readFileSync(
      path.join(root, 'features/chat/src/ChatView.tsx'),
      'utf8',
    );

    assert.match(ui, /onRevealComplete\?: \(\) => void/);
    assert.match(ui, /revealCompletionSent/);
    assert.match(ui, /onRevealComplete\?\.\(\)/);
    assert.match(
      chat,
      /const actionsReady =\s*!generating[\s\S]{0,180}responseRevealComplete\[msg\.id\]/,
      'the action row must use the renderer completion state, not only isGenerating',
    );
    assert.doesNotMatch(
      chat,
      /const actionsReady =\s*!generating\s*&&\s*\(msg\.isError \|\|/,
      'a new error must wait for the same final reveal callback as generated text',
    );
    assert.match(chat, /height: actionsReady \? 'auto' : 0/);
  });

  it('uses one ordered fade for each newly-mounted reveal unit', async () => {
    const { geminiBlockRevealTimings, geminiRevealTailMs } = await loadReveal();
    const ui = fs.readFileSync(
      path.join(root, 'platform/ui/src/StreamingMarkdown.tsx'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'platform/ui/src/streaming-markdown-styles.ts'),
      'utf8',
    );

    const [timing] = geminiBlockRevealTimings(
      'Seven tiny birds rested quietly beside the old garden wall.',
    );

    assert.equal(timing.durationMs, 610);
    assert.equal(timing.innerDelayMs, 150);
    assert.equal(timing.completionMs, 760);
    assert.equal(geminiRevealTailMs('Something went wrong. Please try again.'), 760);
    assert.match(ui, /smd-reveal-block/);
    assert.match(styles, /animation-delay: var\(--smd-inner-delay, 0ms\)/);
    assert.doesNotMatch(
      styles,
      /\.smd-streaming \.smd-reveal-block,/,
      'the reveal container must not add a second opacity fade around its words',
    );
    assert.match(
      ui,
      /<RichResourceGroup[\s\S]{0,220}style=\{revealTimingStyle\(nextRevealBlockTiming\(/,
      'resource previews must consume the next reveal slot instead of starting at time zero',
    );
  });

  it('keeps reveal delays strictly increasing in document order', async () => {
    const { geminiBlockRevealTimings } = await loadReveal();
    const source = Array.from(
      { length: 12 },
      (_, index) => `Paragraph ${index + 1} ends here.`,
    ).join('\n\n');
    const timings = geminiBlockRevealTimings(source);

    assert.equal(timings.length, 12);
    assert.ok(timings.every((timing) => timing.durationMs === 610));
    assert.equal(timings[0].innerDelayMs, 150);
    assert.equal(timings.at(-1).innerDelayMs, 1470);
    assert.ok(timings.every((timing, index) => (
      index === 0 || timing.innerDelayMs > timings[index - 1].innerDelayMs
    )));
  });

  it('counts every list item as its own reveal unit even without a blank line', async () => {
    const { geminiBlockRevealTimings } = await loadReveal();
    const timings = geminiBlockRevealTimings([
      'Previous paragraph.',
      '- First item.',
      '- Second item.',
    ].join('\n'));

    assert.equal(timings.length, 3);
    assert.deepEqual(timings.map((timing) => timing.innerDelayMs), [150, 270, 390]);
  });

  it('delays generated list markers with their accompanying text', () => {
    const ui = fs.readFileSync(
      path.join(root, 'platform/ui/src/StreamingMarkdown.tsx'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'platform/ui/src/streaming-markdown-styles.ts'),
      'utf8',
    );
    const markerSelector = '.smd-streaming .smd-list > li.smd-reveal-block:not(.smd-settled)::before';

    assert.equal(
      styles.split(markerSelector).length - 1,
      3,
      'the marker must share the animation, hidden state, and reduced-motion rules',
    );
    assert.match(styles, /li\.smd-reveal-block[^']*::before,'[\s\S]{0,260}opacity: 0/);
    assert.match(styles, /animation-delay: var\(--smd-inner-delay, 0ms\)/);
    assert.match(
      ui,
      /<RevealBlock[\s\S]{0,180}as="li"[\s\S]{0,220}nextRevealBlockTiming\(context, settled\)/,
      'each list item must consume its own reveal slot',
    );
  });

  it('keeps an already-visible word painted when the tree reshapes under it', () => {
    const styles = fs.readFileSync(
      path.join(root, 'platform/ui/src/streaming-markdown-styles.ts'),
      'utf8',
    );

    // A word re-created under a new inline parent (plain `**Item ` becoming
    // `strong` on the next promotion, or a link closing) mounts with
    // `.smd-settled`, which sets `animation: none`. The hidden start state
    // must therefore exclude settled leaves, or nothing lifts them back to
    // opacity 1 until the whole response leaves `.smd-streaming`.
    assert.match(
      styles,
      /\.smd-streaming \.smd-reveal-block:not\(\.smd-settled\) \.smd-w:not\(\.smd-settled\),/,
      'the hidden start state must not apply to a settled word inside a live block',
    );
    assert.match(
      styles,
      /\.smd-streaming \.smd-reveal-block:not\(\.smd-settled\) \.smd-h:not\(\.smd-settled\) \{/,
      'heading words follow the same rule',
    );
    assert.doesNotMatch(
      styles,
      /\.smd-reveal-block:not\(\.smd-settled\) \.smd-w,/,
      'an unqualified .smd-w in the hidden rule strands re-mounted words at opacity 0',
    );
  });

  it('appends grounding pills without remounting the existing paragraph words', () => {
    const ui = fs.readFileSync(
      path.join(root, 'platform/ui/src/StreamingMarkdown.tsx'),
      'utf8',
    );

    assert.match(
      ui,
      /const appendedChildren = Array\.isArray\(existing\)[\s\S]{0,120}\? \[\.\.\.existing, chip\][\s\S]{0,80}: \[existing, chip\]/,
      'the source pill must be appended to the existing flat child list',
    );
    assert.match(
      ui,
      /React\.cloneElement\([\s\S]{0,140}appendedChildren/,
      'the cloned paragraph must receive the flat child list',
    );
    assert.doesNotMatch(
      ui,
      /undefined,\s*existing,\s*chip,/,
      'nesting the existing array changes every word key and remounts the text',
    );
  });

  it('does not restart a pending reveal timer for every provider token', () => {
    const ui = fs.readFileSync(
      path.join(root, 'platform/ui/src/StreamingMarkdown.tsx'),
      'utf8',
    );

    assert.match(ui, /const revealTimer = useRef<number \| null>\(null\)/);
    assert.match(ui, /if \(revealTimer\.current !== null\) return/);
    assert.match(ui, /const source = latestText\.current/);
  });

  it('nulls the reveal timer ref wherever the timer is cancelled', () => {
    const ui = fs.readFileSync(
      path.join(root, 'platform/ui/src/StreamingMarkdown.tsx'),
      'utf8',
    );

    // The ref doubles as "a promotion is already scheduled", and the guard above
    // returns early on the strength of it. So a cancelled timer that leaves the
    // handle behind permanently convinces the guard not to schedule anything.
    //
    // StrictMode is what made that fatal rather than theoretical: React runs
    // every cleanup between its two dev mount passes, so the unmount cleanup
    // cancelled the first promotion before it could fire and the re-run then
    // refused to replace it. Measured against a live turn, the provider sent 955
    // characters and the DOM rendered 16 -- the initial chunk, forever, with the
    // root stuck in `smd-streaming` because `shown` never reached `text`.
    const clears = [...ui.matchAll(/window\.clearTimeout\(revealTimer\.current\)/g)];
    assert.ok(clears.length >= 2, 'reveal timer should be cancelled in unmount cleanup and on deactivate');
    for (const clear of clears) {
      assert.match(
        ui.slice(clear.index, clear.index + 200),
        /revealTimer\.current = null/,
        'every cancellation of the reveal timer must also clear its ref',
      );
    }
  });
});
