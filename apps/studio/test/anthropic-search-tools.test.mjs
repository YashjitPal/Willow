/**
 * Anthropic server-side search: sent to whatever endpoint is configured, and
 * recognised in the reply however that endpoint spells it.
 *
 * The design decision here is deliberate and was made against evidence, so the
 * evidence is recorded rather than the conclusion alone. Measured against a
 * configured New API-family relay (reached through the dev `/llm-proxy`), with
 * `tools` present:
 *
 *  1. it accepted the tool block without validating it — `web_search_20250305`
 *     and a nonexistent `web_search_29999999` returned byte-identical responses,
 *     where api.anthropic.com rejects an unknown tool type with a 400;
 *  2. it replaced the answer with its own template, `I'll search for
 *     "<prompt>".Here are the search results for "<prompt>": 1. …`, dumping
 *     results *as* the reply so the model never answered. Because the template
 *     only varies by echoing the prompt, every turn rendered as the same message
 *     with no error anywhere;
 *  3. it emitted zero `citations_delta` events.
 *
 * Dropping `tools` restored correct answers on that same gateway ("4", "Paris",
 * "banana" for three control prompts). An endpoint gate was therefore possible,
 * and was rejected: it tests endpoint *identity*, not *capability*, so a relay
 * that faithfully passes the tool through would lose a feature that works. A
 * custom base URL is taken to mean its owner supplies the tool natively.
 *
 * What replaces the gate is tolerance in the other direction — the reply reader
 * no longer requires Anthropic's exact spelling, so an endpoint offering the same
 * tool as `Web_Search` / `WebSearch` / `websearch` still produces source cards
 * with nothing configured or stored.
 *
 * `namesWebSearch` and `resolveAnthropicCitations` carry the decision and are
 * exercised for real. The request build is asserted as source text, because
 * reaching it would require standing up an SDK double.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const GROUNDING = path.join(repoRoot, 'platform', 'ai', 'src', 'grounding.ts');
const CHAT = () => fs.readFileSync(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'), 'utf8');

describe('anthropic search tools', () => {
  let grounding;
  before(async () => {
    grounding = await importTs(GROUNDING);
  });

  it('accepts any spelling of web search a gateway might use', () => {
    const { namesWebSearch } = grounding;
    // Anthropic's own strings, including the block wrapper and the dated tool
    // version, which changes with each release of the tool.
    for (const name of [
      'web_search',
      'web_search_20250305',
      'web_search_20260209',
      'web_search_tool_result',
      'web_search_result',
      'web_search_result_location',
    ]) assert.equal(namesWebSearch(name), true, name);

    // The point of the change: a relay is under no obligation to copy the
    // spelling, and an unrecognised block is dropped silently rather than
    // erroring, so the search would run and no card would render.
    for (const name of [
      'Web_Search',
      'WebSearch',
      'websearch',
      'WEBSEARCH',
      'web-search',
      'web.search',
      'web search',
      'webSearchPreview',
      'my_gateway/WebSearch@v2',
    ]) assert.equal(namesWebSearch(name), true, name);
  });

  it('still rejects the block types it sits next to', () => {
    const { namesWebSearch } = grounding;
    // These arrive in the same streams and must not be read as search results.
    for (const name of [
      'text',
      'thinking',
      'char_location',
      'page_location',
      'content_block_location',
      'code_execution_tool_result',
      'bash_code_execution_tool_result',
      'server_tool_use',
      'tool_use',
      'document',
    ]) assert.equal(namesWebSearch(name), false, name);

    // Non-strings arrive whenever a field is absent.
    for (const value of [undefined, null, 0, {}, ['web_search']]) {
      assert.equal(namesWebSearch(value), false, String(value));
    }
  });

  it('reads a gateway-spelled search result into the same source cards', () => {
    const { resolveAnthropicCitations } = grounding;
    // Anthropic's shape with every `web_search_*` string replaced by a spelling
    // it does not itself use. Nothing about this is configured anywhere.
    const resolved = resolveAnthropicCitations(
      [{ type: 'WebSearchResult', url: 'https://example.com/a', title: 'A' }],
      [{
        start: 0,
        end: 10,
        citations: [{
          type: 'WebSearch.Result.Location',
          url: 'https://example.com/a',
          title: 'A',
          cited_text: 'quoted passage',
        }],
      }],
    );
    assert.equal(resolved.sources.length, 1);
    assert.equal(resolved.sources[0].uri, 'https://example.com/a');
    assert.equal(resolved.sources[0].domain, 'example.com');
    // The result carries the title and the citation carries the quote; they are
    // two objects for one page and must merge into one card, not two.
    assert.equal(resolved.sources[0].snippet, 'quoted passage');
    assert.deepEqual(resolved.citations, [{ startIndex: 0, endIndex: 10, sourceIndices: [0] }]);
  });

  it('drops the error object that shares the result array', () => {
    const { resolveAnthropicCitations, namesWebSearch } = grounding;
    // `web_search_tool_result_error` normalises to something containing
    // `websearch`, so name-matching alone would admit it.
    assert.equal(namesWebSearch('web_search_tool_result_error'), true);
    const resolved = resolveAnthropicCitations(
      [{ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }],
      [{ start: 0, end: 5, citations: [{ type: 'web_search_result_location', url: 'https://example.com/b', title: 'B' }] }],
    );
    assert.deepEqual(resolved.sources.map((s) => s.uri), ['https://example.com/b']);
  });

  it('sends search to a custom endpoint, gated on the toggle alone', () => {
    const chat = CHAT();
    assert.match(
      chat,
      /const anthropicSearchEnabled = options\.enableSearch !== false;/,
      'a custom base URL is taken to supply the tool natively — no endpoint gate',
    );
    assert.ok(
      !/anthropicSearchEnabled[\s\S]{0,120}?isOfficialEndpoint/.test(chat),
      'endpoint identity is not capability, so it must not decide this',
    );
  });

  it('degrades to a plain turn rather than an error when search is off', () => {
    const chat = CHAT();
    // The spread is what makes this a degrade: no `tools` key at all, rather than
    // an empty array, which some endpoints also reject.
    assert.match(
      chat,
      /\.\.\.\(anthropicTools\.length \? \{ tools: anthropicTools as any \} : \{\}\),/,
      'an empty `tools: []` is not the same request as no `tools` key',
    );
    assert.ok(
      !/anthropicSearchEnabled[\s\S]{0,200}?throw /.test(chat),
      'a turn without search must still be a turn',
    );
  });

  it('still sends the direct-calling tool version', () => {
    // From `web_search_20260209` onward `allowed_callers` defaults to
    // `["code_execution_20260120"]`, which 400s on models without programmatic
    // tool calling. `20250305` calls directly and is documented for claude-opus-5.
    assert.match(
      CHAT(),
      /\{ type: 'web_search_20250305', name: 'web_search' \}/,
      'the version choice is load-bearing, not incidental',
    );
  });

  it('matches the result block by name, not by literal type', () => {
    // The stream reader is the other half: a differently-spelled tool is useless
    // if its result block is skipped before `resolveAnthropicCitations` sees it.
    assert.match(
      CHAT(),
      /namesWebSearch\(block\?\.type\) \|\| namesWebSearch\(block\?\.name\)/,
      'a relay can put the tool name in either field',
    );
    // `server_tool_use` named `web_search` also matches by name; only the array
    // guard keeps the invocation from being read as a result.
    assert.match(CHAT(), /if \(Array\.isArray\(block\.content\)\) anthropicSearchResults\.push/);
  });
});
