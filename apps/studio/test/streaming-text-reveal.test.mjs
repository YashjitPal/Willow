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

  it('layers short Gemini responses using its adaptive pending-node queue', async () => {
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
    assert.equal(timing.innerDelayMs, 305);
    assert.equal(timing.completionMs, 915);
    assert.equal(geminiRevealTailMs('Something went wrong. Please try again.'), 915);
    assert.match(ui, /smd-reveal-block/);
    assert.match(styles, /\.smd-streaming \.smd-reveal-block/);
    assert.match(styles, /animation-delay: var\(--smd-inner-delay, 0ms\)/);
  });

  it('keeps dense multi-paragraph responses on Gemini default 400ms fades', async () => {
    const { geminiBlockRevealTimings } = await loadReveal();
    const source = Array.from(
      { length: 12 },
      (_, index) => `Paragraph ${index + 1} ends here.`,
    ).join('\n\n');
    const timings = geminiBlockRevealTimings(source);

    assert.equal(timings.length, 12);
    assert.equal(timings[0].durationMs, 400);
    assert.ok(timings[0].innerDelayMs < timings.at(-1).innerDelayMs);
    assert.ok(timings.at(-1).durationMs > timings[0].durationMs);
  });

  it('delays generated list markers with their accompanying text', () => {
    const styles = fs.readFileSync(
      path.join(root, 'platform/ui/src/streaming-markdown-styles.ts'),
      'utf8',
    );
    const markerSelector = '.smd-streaming .smd-reveal-block:not(.smd-settled) > li::before';

    assert.equal(
      styles.split(markerSelector).length - 1,
      3,
      'the marker must share the animation, inner delay, and reduced-motion rules',
    );
    assert.match(styles, /li::before,'[\s\S]{0,220}opacity: 0/);
    assert.match(styles, /li::before,'[\s\S]{0,300}animation-delay: var\(--smd-inner-delay, 0ms\)/);
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
