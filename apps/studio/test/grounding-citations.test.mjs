/**
 * Grounding-metadata normalisation, exercised rather than read as text.
 *
 * The chips are cosmetic; the offsets behind them are not. A citation resolved
 * one character wide of the mark attaches a source to the wrong sentence, and
 * nothing in the UI would reveal it. Three properties carry essentially all of
 * that risk and are each expensive to re-derive later:
 *
 *  1. `segment.startIndex`/`endIndex` are UTF-8 **byte** offsets. They agree
 *     with JS string indices only for ASCII, so any answer containing an emoji,
 *     an accent or CJK silently shifts every later citation unless converted.
 *  2. The two installed SDKs disagree on the wire shape. `@google/generative-ai`
 *     declares `segment?: string` and misspells the index array as
 *     `groundingChunckIndices`; `@google/genai` uses `segment?: Segment` and the
 *     correct spelling. Both have to parse.
 *  3. A support's chunk indices are only meaningful inside its own metadata
 *     object, so merging two objects would silently repoint citations at the
 *     wrong sources. `pickGroundingMetadata` must choose, never merge.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it, before } from 'node:test';

import { importTs } from './ts-module.mjs';

const MODULE = path.resolve(
  import.meta.dirname,
  '../../../platform/ai/src/grounding.ts',
);

/** A metadata object in the newer `@google/genai` shape. */
const meta = (chunks, supports) => ({
  groundingChunks: chunks.map((c) => ({ web: c })),
  groundingSupports: supports,
});

const utf8 = (text) => Buffer.byteLength(text, 'utf8');

describe('grounding normalisation', () => {
  let mod;
  before(async () => {
    mod = await importTs(MODULE);
  });

  describe('byteOffsetToCharIndex', () => {
    it('is the identity for ASCII', () => {
      const text = 'Pakistan signed a deal.';
      assert.equal(mod.byteOffsetToCharIndex(text, 0), 0);
      assert.equal(mod.byteOffsetToCharIndex(text, 8), 8);
      assert.equal(mod.byteOffsetToCharIndex(text, utf8(text)), text.length);
    });

    it('converts multi-byte code points', () => {
      // "é" is 2 bytes, "—" is 3, "😀" is 4 bytes and 2 UTF-16 units.
      const text = 'café — 😀 done';
      const prefix = 'café — 😀';
      assert.equal(
        mod.byteOffsetToCharIndex(text, utf8(prefix)),
        prefix.length,
        'byte offset at the end of the emoji must land after its surrogate pair',
      );
      // Every byte boundary must map back to a valid index, never inside a pair.
      for (let byte = 0; byte <= utf8(text); byte += 1) {
        const index = mod.byteOffsetToCharIndex(text, byte);
        assert.ok(index >= 0 && index <= text.length);
        const code = text.charCodeAt(index);
        assert.ok(
          Number.isNaN(code) || code < 0xdc00 || code > 0xdfff,
          `byte ${byte} mapped into the middle of a surrogate pair`,
        );
      }
    });

    it('clamps a past-the-end offset instead of overrunning', () => {
      const text = 'short';
      assert.equal(mod.byteOffsetToCharIndex(text, 9999), text.length);
      assert.equal(mod.byteOffsetToCharIndex(text, -5), 0);
    });
  });

  describe('resolveCitations', () => {
    const text = 'Pakistan signed a deal. The US is negotiating a route.';

    it('resolves byte offsets to the exact cited run', () => {
      const first = 'Pakistan signed a deal.';
      const result = mod.resolveCitations(
        meta(
          [{ uri: 'https://ndtv.com/a', title: 'NDTV', domain: 'ndtv.com' }],
          [{ segment: { startIndex: 0, endIndex: utf8(first), text: first }, groundingChunkIndices: [0] }],
        ),
        text,
      );
      assert.equal(result.citations.length, 1);
      assert.equal(
        text.slice(result.citations[0].startIndex, result.citations[0].endIndex),
        first,
      );
      assert.deepEqual(result.sources[0], {
        uri: 'https://ndtv.com/a',
        title: 'NDTV',
        domain: 'ndtv.com',
      });
    });

    it('stays correct when earlier text is multi-byte', () => {
      // The bug this guards: byte offsets read as string indices would place the
      // second citation four characters early, straddling the sentence before it.
      const emoji = 'Aché 😀 signed a deal. The US is negotiating a route.';
      const second = 'The US is negotiating a route.';
      const start = emoji.indexOf(second);
      const result = mod.resolveCitations(
        meta(
          [{ uri: 'https://ht.com/b', title: '', domain: 'www.hindustantimes.com' }],
          [{
            segment: {
              startIndex: utf8(emoji.slice(0, start)),
              endIndex: utf8(emoji),
              text: second,
            },
            groundingChunkIndices: [0],
          }],
        ),
        emoji,
      );
      assert.equal(
        emoji.slice(result.citations[0].startIndex, result.citations[0].endIndex),
        second,
      );
      // Title falls back to the domain, which is what Gemini's chips show for
      // sources with no publisher name.
      assert.equal(result.sources[0].title, 'www.hindustantimes.com');
    });

    it('accepts the legacy SDK spelling and string segment', () => {
      const first = 'Pakistan signed a deal.';
      const result = mod.resolveCitations(
        meta(
          [{ uri: 'https://ndtv.com/a', title: 'NDTV', domain: 'ndtv.com' }],
          // Both quirks at once: `segment` as a bare string (no offsets at all)
          // and the SDK's own `Chunck` typo.
          [{ segment: first, groundingChunckIndices: [0] }],
        ),
        text,
      );
      assert.equal(result.citations.length, 1);
      assert.equal(
        text.slice(result.citations[0].startIndex, result.citations[0].endIndex),
        first,
      );
    });

    it('falls back to search when the offsets disagree with the text', () => {
      const second = 'The US is negotiating a route.';
      const result = mod.resolveCitations(
        meta(
          [{ uri: 'https://x.com/a', title: 'X', domain: 'x.com' }],
          // Deliberately stale offsets pointing at the wrong sentence; the
          // provider's own copy of the text is the tie-breaker.
          [{ segment: { startIndex: 0, endIndex: 5, text: second }, groundingChunkIndices: [0] }],
        ),
        text,
      );
      assert.equal(
        text.slice(result.citations[0].startIndex, result.citations[0].endIndex),
        second,
      );
    });

    it('shifts every index by the iteration offset', () => {
      const first = 'Pakistan signed a deal.';
      const result = mod.resolveCitations(
        meta(
          [{ uri: 'https://ndtv.com/a', title: 'NDTV', domain: 'ndtv.com' }],
          [{ segment: { startIndex: 0, endIndex: utf8(first), text: first }, groundingChunkIndices: [0] }],
        ),
        text,
        1000,
      );
      assert.equal(result.citations[0].startIndex, 1000);
      assert.equal(result.citations[0].endIndex, 1000 + first.length);
    });

    it('keeps chunk indices stable when a chunk fails to parse', () => {
      const first = 'Pakistan signed a deal.';
      const result = mod.resolveCitations(
        {
          // Index 0 has no web payload at all; index 1 is the real source. A
          // naive filter would shift index 1 to 0 and cite the wrong page.
          groundingChunks: [{}, { web: { uri: 'https://ndtv.com/a', title: 'NDTV', domain: 'ndtv.com' } }],
          groundingSupports: [
            { segment: { startIndex: 0, endIndex: utf8(first), text: first }, groundingChunkIndices: [1] },
          ],
        },
        text,
      );
      assert.equal(result.sources.length, 1);
      assert.deepEqual(result.citations[0].sourceIndices, [0]);
      assert.equal(result.sources[0].uri, 'https://ndtv.com/a');
    });

    it('drops supports whose sources are all unresolvable', () => {
      const result = mod.resolveCitations(
        meta(
          [{ uri: 'https://ndtv.com/a', title: 'NDTV', domain: 'ndtv.com' }],
          [{ segment: { startIndex: 0, endIndex: 5, text: 'Pakis' }, groundingChunkIndices: [7] }],
        ),
        text,
      );
      assert.deepEqual(result, { sources: [], citations: [] });
    });

    it('returns empty for absent or malformed metadata', () => {
      for (const bad of [null, undefined, {}, { groundingChunks: [] }]) {
        assert.deepEqual(mod.resolveCitations(bad, text), { sources: [], citations: [] });
      }
    });
  });

  describe('pickGroundingMetadata', () => {
    it('takes the object with the most supports, never a merge', () => {
      const thin = meta([{ uri: 'a', title: 'A', domain: 'a.com' }], [{ segment: { text: 'x' } }]);
      const full = meta(
        [{ uri: 'b', title: 'B', domain: 'b.com' }],
        [{ segment: { text: 'x' } }, { segment: { text: 'y' } }],
      );
      assert.equal(mod.pickGroundingMetadata([thin, full]), full);
      assert.equal(mod.pickGroundingMetadata([full, thin]), full);
    });

    it('prefers the later object on a tie, and ignores empty ones', () => {
      const early = meta([{ uri: 'a', title: 'A', domain: 'a.com' }], [{ segment: { text: 'x' } }]);
      const late = meta([{ uri: 'b', title: 'B', domain: 'b.com' }], [{ segment: { text: 'x' } }]);
      assert.equal(mod.pickGroundingMetadata([early, late]), late);
      assert.equal(mod.pickGroundingMetadata([null, { webSearchQueries: ['q'] }, undefined]), null);
    });
  });

  describe('mergeCitations', () => {
    it('re-bases indices across iterations and collapses repeated URLs', () => {
      const a = {
        sources: [{ uri: 'https://ndtv.com/a', title: 'NDTV', domain: 'ndtv.com' }],
        citations: [{ startIndex: 0, endIndex: 10, sourceIndices: [0] }],
      };
      const b = {
        // Same page cited again in a later tool-loop iteration, plus a new one.
        sources: [
          { uri: 'https://ht.com/b', title: 'HT', domain: 'ht.com' },
          { uri: 'https://ndtv.com/a', title: 'NDTV', domain: 'ndtv.com' },
        ],
        citations: [{ startIndex: 20, endIndex: 30, sourceIndices: [0, 1] }],
      };
      const merged = mod.mergeCitations([a, b]);
      assert.equal(merged.sources.length, 2, 'the repeated URL must collapse');
      assert.deepEqual(merged.citations[0].sourceIndices, [0]);
      // b's local [0, 1] maps onto the merged list, keeping NDTV at index 0.
      assert.deepEqual(merged.citations[1].sourceIndices, [1, 0]);
      assert.equal(merged.sources[1].uri, 'https://ht.com/b');
    });

    it('orders citations by end offset regardless of arrival order', () => {
      const merged = mod.mergeCitations([
        {
          sources: [{ uri: 'u1', title: 'A', domain: 'a.com' }],
          citations: [{ startIndex: 40, endIndex: 50, sourceIndices: [0] }],
        },
        {
          sources: [{ uri: 'u2', title: 'B', domain: 'b.com' }],
          citations: [{ startIndex: 0, endIndex: 10, sourceIndices: [0] }],
        },
      ]);
      assert.deepEqual(merged.citations.map((c) => c.endIndex), [10, 50]);
    });

    it('is empty when nothing survives', () => {
      assert.deepEqual(mod.mergeCitations([]), { sources: [], citations: [] });
      assert.deepEqual(
        mod.mergeCitations([{ sources: [], citations: [] }]),
        { sources: [], citations: [] },
      );
    });

    /*
     * Anthropic sends a page twice: once as a `web_search_result` (title, no
     * excerpt) and again as a `web_search_result_location` (excerpt, and often a
     * title that is only the host). Discarding the second copy on a URL match --
     * which is what a plain first-wins dedupe does -- drops `cited_text` and
     * silently downgrades a three-row card to two rows, with no error anywhere.
     */
    it('fills a missing snippet from a later copy of the same URL', () => {
      const merged = mod.mergeCitations([
        {
          sources: [{ uri: 'https://x.com/a', title: 'Rolling Stone', domain: 'x.com' }],
          citations: [{ startIndex: 0, endIndex: 5, sourceIndices: [0] }],
        },
        {
          sources: [{ uri: 'https://x.com/a', title: 'x.com', domain: 'x.com', snippet: 'Quoted passage.' }],
          citations: [{ startIndex: 6, endIndex: 9, sourceIndices: [0] }],
        },
      ]);
      assert.equal(merged.sources.length, 1);
      assert.equal(merged.sources[0].snippet, 'Quoted passage.', 'the excerpt was dropped');
      assert.equal(merged.sources[0].title, 'Rolling Stone', 'a real headline must not lose to a bare host');
    });

    it('does not let a merge mutate the caller\'s source objects', () => {
      const first = { uri: 'https://x.com/a', title: 'x.com', domain: 'x.com' };
      mod.mergeCitations([
        { sources: [first], citations: [{ startIndex: 0, endIndex: 5, sourceIndices: [0] }] },
        {
          sources: [{ uri: 'https://x.com/a', title: 'Real Headline', domain: 'x.com', snippet: 'Quote.' }],
          citations: [{ startIndex: 6, endIndex: 9, sourceIndices: [0] }],
        },
      ]);
      assert.equal(first.snippet, undefined, 'merging wrote back into the input');
      assert.equal(first.title, 'x.com', 'merging wrote back into the input');
    });
  });

  /*
   * Anthropic's citations carry no offsets into the answer -- unlike Gemini's
   * `segment.startIndex/endIndex` and OpenAI's `start_index/end_index`. A
   * `web_search_result_location` says which page was used and quotes it, but
   * locates it only by which content block it hangs off, so the block's own span
   * in the accumulated answer IS the cited span. That span can only come from the
   * stream reader, which is why `resolveAnthropicCitations` takes it as input
   * rather than deriving it.
   */
  describe('resolveAnthropicCitations', () => {
    const result = (url, title) => ({ type: 'web_search_result', url, title });
    const cite = (url, title, cited_text) => ({ type: 'web_search_result_location', url, title, cited_text });

    it('anchors a citation to its block span and keeps cited_text as the snippet', () => {
      const resolved = mod.resolveAnthropicCitations(
        [result('https://nasa.gov/europa', 'Europa Clipper')],
        [{ start: 10, end: 42, citations: [cite('https://nasa.gov/europa', 'nasa.gov', 'Up to 150 chars of page.')] }],
      );
      assert.deepEqual(resolved.citations, [{ startIndex: 10, endIndex: 42, sourceIndices: [0] }]);
      assert.equal(resolved.sources.length, 1, 'the search result and its citation are one page');
      assert.equal(resolved.sources[0].snippet, 'Up to 150 chars of page.');
      assert.equal(resolved.sources[0].title, 'Europa Clipper', 'the search result carries the real title');
      assert.equal(resolved.sources[0].domain, 'nasa.gov', 'domain comes from the real url, not a redirect');
    });

    it('leaves snippet undefined when only a search result is sent', () => {
      const resolved = mod.resolveAnthropicCitations(
        [result('https://nasa.gov/europa', 'Europa Clipper')],
        [{ start: 0, end: 8, citations: [{ type: 'web_search_result_location', url: 'https://nasa.gov/europa' }] }],
      );
      assert.equal(resolved.sources.length, 1);
      assert.equal(
        resolved.sources[0].snippet,
        undefined,
        'an absent excerpt must stay absent — the card degrades to two rows, never a blank third',
      );
    });

    it('keeps a search that produced no citation, as sources with no chips', () => {
      // This used to return nothing at all, on the reasoning that a citation is
      // what a chip anchors to. It is — but chips are driven by `citations` and
      // the sources panel by `sources`, so returning the sources renders the
      // panel and no chips rather than chips over no text.
      //
      // The case is real and measured: a relay returns genuine
      // `web_search_tool_result` blocks and emits zero `citations_delta`. The
      // pages were fetched and are worth offering; only the spans are missing.
      const resolved = mod.resolveAnthropicCitations([result('https://nasa.gov/europa', 'Europa')], []);
      assert.deepEqual(resolved.citations, [], 'nothing to anchor, so no chips');
      assert.deepEqual(resolved.sources.map((s) => s.uri), ['https://nasa.gov/europa']);

      // A zero-width block is the same case: no run to attach a chip to, but the
      // page behind it still exists.
      const zeroWidth = mod.resolveAnthropicCitations(
        [result('https://nasa.gov/europa', 'Europa')],
        [{ start: 12, end: 12, citations: [cite('https://nasa.gov/europa', 'nasa.gov', 'Quote.')] }],
      );
      assert.deepEqual(zeroWidth.citations, []);
      assert.deepEqual(zeroWidth.sources.map((s) => s.uri), ['https://nasa.gov/europa']);
    });

    it('still returns nothing when there was no search at all', () => {
      // The empty case has to stay empty, or an ungrounded turn grows a panel.
      assert.deepEqual(mod.resolveAnthropicCitations([], []), { sources: [], citations: [] });
      assert.deepEqual(
        mod.resolveAnthropicCitations([{ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }], []),
        { sources: [], citations: [] },
        'a failed search is not a source',
      );
    });

    it('collapses one page cited by two blocks and orders by end offset', () => {
      const resolved = mod.resolveAnthropicCitations(
        [result('https://a.com/1', 'A'), result('https://b.com/2', 'B')],
        [
          { start: 30, end: 40, citations: [cite('https://b.com/2', 'b.com', 'Second.')] },
          { start: 0, end: 10, citations: [cite('https://a.com/1', 'a.com', 'First.'), cite('https://a.com/1', 'a.com', 'First.')] },
        ],
      );
      assert.deepEqual(resolved.citations.map((c) => c.endIndex), [10, 40]);
      assert.deepEqual(resolved.citations[0].sourceIndices, [0], 'the same page twice in one block is one index');
      assert.equal(resolved.sources.length, 2);
    });

    it('ignores foreign block types and tolerates junk', () => {
      const resolved = mod.resolveAnthropicCitations(
        [{ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }, result('https://a.com/1', 'A')],
        [
          null,
          { start: 0, end: 5, citations: [{ type: 'char_location', document_index: 0 }] },
          { start: 6, end: 9, citations: [cite('https://a.com/1', 'a.com', 'Quote.')] },
        ],
      );
      assert.equal(resolved.sources.length, 1, 'the error object must not become a source');
      assert.deepEqual(resolved.citations, [{ startIndex: 6, endIndex: 9, sourceIndices: [0] }]);
    });

    it('returns empty for absent input instead of throwing', () => {
      assert.deepEqual(mod.resolveAnthropicCitations(undefined, undefined), { sources: [], citations: [] });
      assert.deepEqual(mod.resolveAnthropicCitations(null, null), { sources: [], citations: [] });
    });
  });
});
