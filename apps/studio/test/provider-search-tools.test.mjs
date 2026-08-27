/**
 * Server-side web search for the OpenAI-compatible providers: what is sent, and
 * how four mutually incompatible reply shapes become the same source cards.
 *
 * Every request shape below is the provider's own documented one, not a guess:
 *
 *  - OpenAI documents `tools: [{ type: 'web_search' }]` for new integrations on
 *    the Responses API (`web_search_preview` is its legacy spelling). Chat
 *    Completions is the awkward half — OpenAI itself only offers search there
 *    through dedicated always-searching models — so the tool is sent with a
 *    retry-without-search behind it rather than gated off.
 *  - xAI supersedes `search_parameters`/`return_citations`/`mode: 'auto'` with
 *    `tools: [{ type: 'web_search' }]`.
 *  - Zhipu nests its config: `{ type: 'web_search', web_search: { enable, ... } }`,
 *    and `search_result` is what makes the results come back at all.
 *  - Moonshot/Kimi is absent on purpose. Its `$web_search` builtin could not be
 *    verified against Moonshot's current docs, and a guessed schema sent to a
 *    relay turns a working turn into a 400. Its replies are still *read*.
 *
 * The reply side splits into two kinds, and the split is the point:
 *
 *  - offsets present (OpenAI/xAI `url_citation` annotations) → inline chips,
 *  - offsets absent (xAI's flat URL array, Zhipu's `web_search` array) → the
 *    sources panel and no chips.
 *
 * The second kind is why `resolveAnthropicCitations` and `sanitizeSavedCitations`
 * no longer require a citation to keep a source: for those two providers a bare
 * list is all there ever was, and demanding spans meant their search rendered
 * nothing at all.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const GROUNDING = path.join(repoRoot, 'platform', 'ai', 'src', 'grounding.ts');
const CHAT_MESSAGE = path.join(repoRoot, 'features', 'chat', 'src', 'chat-message.ts');
const CHAT = () => fs.readFileSync(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'), 'utf8');

/**
 * The same source with comments stripped, for the assertions that say a string
 * must *not* appear. The comments in `chat.ts` name the shapes that were
 * considered and rejected — the legacy `web_search_preview`, Kimi's unverified
 * `$web_search` — and a bare `includes` check cannot tell a rejected shape being
 * documented from one being sent.
 */
const CHAT_CODE = () => CHAT()
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('compatible-provider search: reply shapes', () => {
  let grounding;
  before(async () => {
    grounding = await importTs(GROUNDING);
  });

  it('anchors chips from OpenAI Chat Completions annotations', () => {
    const { resolveCompatCitations } = grounding;
    const answer = 'Rain is likely tomorrow.';
    // The documented Chat Completions shape: the payload is nested under a key
    // matching the type, unlike the Responses API, which inlines it.
    const resolved = resolveCompatCitations({
      annotations: [{
        type: 'url_citation',
        url_citation: {
          url: 'https://weather.example/forecast',
          title: 'Forecast',
          start_index: 0,
          end_index: 4,
        },
      }],
      sources: [],
    }, answer);

    assert.deepEqual(resolved.sources, [{
      uri: 'https://weather.example/forecast',
      title: 'Forecast',
      domain: 'weather.example',
    }]);
    assert.deepEqual(resolved.citations, [{ startIndex: 0, endIndex: 4, sourceIndices: [0] }]);
    assert.equal(answer.slice(0, 4), 'Rain', 'the span has to land on real text');
  });

  it('anchors chips from Responses-API annotations, which inline the same fields', () => {
    const { resolveCompatCitations } = grounding;
    const resolved = resolveCompatCitations({
      annotations: [{
        type: 'url_citation',
        url: 'https://example.com/a',
        title: 'A',
        start_index: 2,
        end_index: 9,
      }],
      sources: [],
    }, 'ab cdefghij');
    assert.equal(resolved.sources.length, 1);
    assert.deepEqual(resolved.citations, [{ startIndex: 2, endIndex: 9, sourceIndices: [0] }]);
  });

  it('keeps xAI sources when the provider sends no offsets at all', () => {
    const { resolveCompatCitations } = grounding;
    // xAI's chat path returns a flat array of URL strings — no title, no span.
    const resolved = resolveCompatCitations({
      annotations: [],
      sources: ['https://x.example/post/1', 'https://news.example/story'],
    }, 'Some answer text.');

    // The sources are the load-bearing part: they are all xAI sends, so dropping
    // them for want of offsets would mean its search showed nothing at all.
    assert.deepEqual(resolved.sources.map((s) => s.uri), [
      'https://x.example/post/1',
      'https://news.example/story',
    ]);
    // With no offsets the spans are synthesised per markdown block rather than
    // left empty, so an offset-less provider still gets inline chips. A
    // single-block answer is one span carrying every source.
    assert.deepEqual(resolved.citations, [
      { startIndex: 0, endIndex: 17, sourceIndices: [0, 1] },
    ]);
    // With no title field, the host stands in — an empty card label would be
    // worse than a domain.
    assert.deepEqual(resolved.sources.map((s) => s.title), ['x.example', 'news.example']);
  });

  it('reads Zhipu result objects, which name the url `link`', () => {
    const { resolveCompatCitations } = grounding;
    const resolved = resolveCompatCitations({
      annotations: [],
      sources: [{
        title: 'GLM release notes',
        link: 'https://docs.z.example/glm',
        content: 'x'.repeat(400),
        publish_date: '2026-01-01',
        refer: 'ref_1',
      }],
      }, '');
    assert.equal(resolved.sources[0].uri, 'https://docs.z.example/glm');
    assert.equal(resolved.sources[0].title, 'GLM release notes');
    // Zhipu's `content` is page body rather than an excerpt, and this value is
    // persisted with the message, so it is capped before it reaches storage.
    assert.equal(resolved.sources[0].snippet.length, 301);
    assert.ok(resolved.sources[0].snippet.endsWith('…'));
  });

  it('drops a span that does not fit the answer, keeping its source', () => {
    const { resolveCompatCitations } = grounding;
    // Offsets are trusted as sent — there is no `cited_text` here to verify them
    // against the way the Gemini path does — so they are only range-checked.
    const resolved = resolveCompatCitations({
      annotations: [
        { type: 'url_citation', url: 'https://a.example/', start_index: 900, end_index: 950 },
        { type: 'url_citation', url: 'https://b.example/', start_index: 5, end_index: 5 },
      ],
      sources: [],
    }, 'short answer');
    assert.deepEqual(resolved.citations, [], 'an out-of-range or empty span anchors nothing');
    assert.equal(resolved.sources.length, 2, 'but the pages were still consulted');
  });

  it('merges one page cited twice into one card', () => {
    const { resolveCompatCitations } = grounding;
    const resolved = resolveCompatCitations({
      annotations: [{
        type: 'url_citation',
        url: 'https://example.com/a',
        start_index: 0,
        end_index: 3,
      }],
      // The same page arriving again in the bare list, this time with the title
      // and excerpt the annotation lacked.
      sources: [{ url: 'https://example.com/a', title: 'A', content: 'an excerpt' }],
    }, 'abcdef');
    assert.equal(resolved.sources.length, 1);
    assert.equal(resolved.sources[0].title, 'A');
    assert.equal(resolved.sources[0].snippet, 'an excerpt');
    assert.deepEqual(resolved.citations, [{ startIndex: 0, endIndex: 3, sourceIndices: [0] }]);
  });

  it('skips an annotation that is not a citation, and junk that is not a source', () => {
    const { resolveCompatCitations, namesUrlCitation } = grounding;
    assert.equal(namesUrlCitation('url_citation'), true);
    assert.equal(namesUrlCitation('urlCitation'), true);
    assert.equal(namesUrlCitation('URL-Citation'), true);
    assert.equal(namesUrlCitation('file_citation'), false, 'a file citation has no url to open');
    assert.equal(namesUrlCitation('container_file_citation'), false);

    const resolved = resolveCompatCitations({
      annotations: [{ type: 'file_citation', file_id: 'f-1', start_index: 0, end_index: 3 }],
      sources: ['not a url', '', null, 42],
    }, 'abcdef');
    assert.deepEqual(resolved, { sources: [], citations: [] });
  });
});

describe('compatible-provider search: what gets sent', () => {
  it('sends xAI the current tool, not the superseded search block', () => {
    const chat = CHAT();
    // Both of xAI's server-side tools, or Grok cannot reach X (Twitter). They
    // are keyed on the wire format rather than the provider name so a Grok
    // model reached through a relay gets the same pair.
    assert.match(
      chat,
      /usesXaiAdapter\s*\r?\n\s*\? \[\{ type: 'web_search' \}, \{ type: 'x_search' \}\]/,
    );
    // `search_parameters` was xAI's previous shape and is no longer current.
    assert.ok(
      !/search_parameters:/.test(chat),
      'the superseded Live Search block must not come back',
    );
  });

  it('sends Zhipu the nested config that makes results come back', () => {
    const chat = CHAT();
    assert.match(chat, /zhipuai: \[\{[\s\S]{0,200}?type: 'web_search',/);
    // Without `search_result` the model searches and returns nothing citable,
    // which reads exactly like search being broken.
    assert.match(chat, /web_search: \{ enable: 'True', search_result: 'True' \}/);
  });

  it('leaves Moonshot out rather than guessing its schema', () => {
    const chat = CHAT();
    assert.ok(
      !/moonshot: \[\{ type: 'web_search'/.test(chat),
      'Kimi $web_search is unverified — a guessed schema 400s the turn',
    );
    assert.ok(!/\$web_search/.test(CHAT_CODE()), 'named in a comment as rejected, never sent');
    // It must still be read, so a relay that searches on its own initiative
    // still fills the panel.
    assert.match(chat, /harvestCompatSearchChunk\(chunk, compatHarvest\);/);
  });

  it('sends OpenAI the documented tool on both of its request paths', () => {
    const chat = CHAT();
    assert.match(chat, /: \[\{ type: 'web_search' \}\];/);
    // `web_search_preview` is the legacy spelling and is not what new
    // integrations are told to send.
    assert.ok(!/web_search_preview/.test(CHAT_CODE()));
    // The Responses path and the streaming Chat Completions path both attach it.
    const attachments = chat.match(/\.\.\.\(searchEnabled \? \{ tools: openaiSearchTools \} : \{\}\),/g) || [];
    assert.equal(attachments.length, 2, 'both OpenAI request paths, or the file path silently loses search');
  });

  it('gates every provider on the one toggle, never on the endpoint', () => {
    const chat = CHAT();
    // Each gate reads the same user-facing toggle plus the profile's tool
    // policy. What none of them may read is which host the credential points at.
    for (const line of [
      /const openaiSearchEnabled = toolsAllowed\b/,
      /&& \(usesXaiAdapter \|\| options\.toolPolicy !== 'function-calling'\)\s*\r?\n\s*&& options\.enableSearch !== false;/,
      /const anthropicSearchEnabled = toolsAllowed && options\.enableSearch !== false;/,
      /const compatSearchEnabled = toolsAllowed && options\.enableSearch !== false/,
    ]) assert.match(chat, line);
    assert.ok(
      !/SearchEnabled[\s\S]{0,160}?isOfficialEndpoint/.test(chat),
      'endpoint identity is not capability',
    );
  });

  it('degrades to a plain turn when the endpoint rejects the tool', () => {
    const chat = CHAT();
    // Every provider here except Gemini is configured against a relay, and a
    // relay is free not to implement a tool its upstream documents. Failing the
    // whole turn over it is strictly worse than having no search.
    assert.match(chat, /const createWithSearchFallback = async/);
    assert.match(chat, /return attempt\(false\);/);
    // The retry is only safe because it wraps `create`, which resolves on the
    // response head — retrying after tokens had been emitted would double them.
    assert.match(chat, /const stream = await createWithSearchFallback<any>\(/);
    // An abort is the user pressing stop, not an unsupported parameter.
    assert.match(chat, /if \(isAbortError\(error\) \|\| !namesSearchToolRejection\(error\)\) throw error;/);
  });

  it('does not retry an error that never mentioned a tool', () => {
    const chat = CHAT();
    // Matching on the message rather than the status code, because the relays
    // are inconsistent about which code an unsupported parameter gets. Requiring
    // the tool to be named is what stops a 401 or 429 burning a second request.
    assert.match(chat, /const namesSearchToolRejection = \(error: any\): boolean =>/);
    assert.match(chat, /web\[\\s\._-\]\*search/);
  });

  it('fires the citation callback on sources, not on spans', () => {
    const chat = CHAT();
    // xAI and Zhipu send no offsets, and the measured Anthropic relay sends
    // results with zero `citations_delta`. Requiring citations here meant those
    // searches ran, were paid for, and showed nothing.
    const guards = chat.match(/if \(resolved\.sources\.length\) onCitations\?\.\(resolved\);/g) || [];
    assert.equal(guards.length, 3, 'openai, anthropic and the compatible providers');
  });
});

describe('sources survive the round trip to disk', () => {
  let chatMessage;
  before(async () => {
    chatMessage = await importTs(CHAT_MESSAGE);
  });

  it('keeps a source list that has no citations', () => {
    const { sanitizeSavedCitations } = chatMessage;
    // Requiring both arrays used to drop this on load, so an xAI or Zhipu turn
    // showed its sources until it was reopened and then lost them.
    const restored = sanitizeSavedCitations({
      sources: [{ uri: 'https://example.com/a', title: 'A', domain: 'example.com' }],
      citations: [],
    });
    assert.equal(restored.sources.length, 1);
    assert.deepEqual(restored.citations, []);
  });

  it('keeps the snippet, which is the second line of the card', () => {
    const { sanitizeSavedCitations } = chatMessage;
    const restored = sanitizeSavedCitations({
      sources: [{ uri: 'https://example.com/a', title: 'A', domain: 'example.com', snippet: 'two lines' }],
      citations: [{ startIndex: 0, endIndex: 4, sourceIndices: [0] }],
    });
    assert.equal(restored.sources[0].snippet, 'two lines');
  });

  it('still drops a chip whose source index does not exist', () => {
    const { sanitizeSavedCitations } = chatMessage;
    // The chat file is user-editable; a chip pointing at nothing would render an
    // undefined label. The source itself is unaffected and stays.
    const restored = sanitizeSavedCitations({
      sources: [{ uri: 'https://example.com/a', title: 'A', domain: 'example.com' }],
      citations: [{ startIndex: 0, endIndex: 4, sourceIndices: [7] }],
    });
    assert.deepEqual(restored.citations, []);
    assert.equal(restored.sources.length, 1);
  });

  it('still refuses a citation object with no sources', () => {
    const { sanitizeSavedCitations } = chatMessage;
    assert.equal(sanitizeSavedCitations({ sources: [], citations: [] }), undefined);
    assert.equal(sanitizeSavedCitations(null), undefined);
    assert.equal(sanitizeSavedCitations({ citations: [{ startIndex: 0, endIndex: 1, sourceIndices: [0] }] }), undefined);
  });
});
