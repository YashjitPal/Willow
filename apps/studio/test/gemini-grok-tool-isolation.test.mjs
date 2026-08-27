import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const chat = fs.readFileSync(
  path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'),
  'utf8',
);

const geminiStart = chat.indexOf('if (usesGeminiAdapter)');
const openaiStart = chat.indexOf('} else if (usesOpenAIAdapter)', geminiStart);
const anthropicStart = chat.indexOf('} else if (usesAnthropicAdapter)', openaiStart);

assert.ok(geminiStart >= 0, 'Gemini provider branch must exist');
assert.ok(openaiStart > geminiStart, 'Gemini branch must end before OpenAI');
assert.ok(anthropicStart > openaiStart, 'OpenAI branch must end before Anthropic');

const geminiBranch = chat.slice(geminiStart, openaiStart);
const openaiBranch = chat.slice(openaiStart, anthropicStart);

describe('Gemini and Grok tool isolation', () => {
  it('keeps Gemini server-side built-in tools compatible with function calling', () => {
    assert.match(geminiBranch, /include_server_side_tool_invocations:\s*true/);
    assert.match(geminiBranch, /if \(part\?\.functionCall\) \{/);
    assert.match(geminiBranch, /const reportedSearchQueries = new Set<string>\(\)/);
    assert.match(geminiBranch, /setPhase\('searching'\)/);
    assert.match(geminiBranch, /if \(part\?\.executableCode\) \{/);
    assert.match(geminiBranch, /setPhase\('executing'\)/);
    assert.doesNotMatch(
      geminiBranch,
      /if \(!hasEmittedText\) setPhase\('thinking'\);\s*\/\/ Search backwards/,
      'a code result must not immediately erase the Running code phase before a paint',
    );
    assert.match(
      geminiBranch,
      /if \(!hasEmittedText && hasSearchGrounding\)/,
      'native search activity belongs to the pre-answer status row only',
    );
    assert.match(geminiBranch, /const hasWebGrounding = Array\.isArray\(groundingMetadata\.groundingChunks\)/);
    assert.match(geminiBranch, /const nativeSearchCall = part\?\.googleSearchCall/);
    assert.match(geminiBranch, /const interactionsEligible = isOfficialEndpoint\('gemini', options\.baseUrl\)/);
    assert.match(geminiBranch, /google_search_call/);
    assert.doesNotMatch(geminiBranch, /!\(options\.personalTools\?\.some/);
    assert.match(geminiBranch, /interactionFunctionTools\(options\.personalTools\)/);
    assert.match(geminiBranch, /interactionFunctionTools\(options\.toolDeclarations\)/);
    assert.doesNotMatch(geminiBranch, /functionCall\.name\.toLowerCase\(\)\.includes\('search'\)/);
  });

  it('gives Grok the shared chat harness instead of a dedicated agentic one', () => {
    // Grok used to own a branch that declared web_search/x_search as client
    // functions and looped: round one had no results, so the model narrated
    // ("Okay, I will search this") and that preamble was saved into the turn.
    // Chat mode has no client-side search executor, so the tools have to be the
    // provider's own -- one request, answer only.
    assert.doesNotMatch(
      chat,
      /\} else if \(usesXaiAdapter\)/,
      'Grok must not have a provider branch of its own',
    );
    assert.match(
      chat,
      /const usesOpenAIAdapter = [^;]*\|\|\s*usesXaiAdapter/,
      'the xAI wire format must resolve to the shared OpenAI-compatible branch',
    );
    // Anthropic's server-side tool legitimately carries both a type and a name
    // (`{ type: 'web_search_20250305', name: 'web_search' }`), so this looks for
    // the client-function shape specifically: a `function:` block with a search
    // name inside it.
    assert.doesNotMatch(
      chat,
      /function:\s*\{\s*\r?\n\s*name:\s*'(?:web|x)_search'/,
      'search must never be declared as a client-executed function tool',
    );
    assert.doesNotMatch(chat, /\/llm-search/, 'the client-side search fetch must be gone');
    assert.match(
      openaiBranch,
      /usesXaiAdapter\s*\r?\n\s*\? \[\{ type: 'web_search' \}, \{ type: 'x_search' \}\]/,
      'xAI needs both server-side search tools declared',
    );
  });

  it('does not let a stale function-calling policy silence Grok search', () => {
    // Profiles stored before this change carry `toolPolicy: 'function-calling'`
    // from the old xAI default. Gemini and Anthropic both ignore that policy for
    // search, so xAI has to as well or every existing install loses search.
    assert.match(
      openaiBranch,
      /&& \(usesXaiAdapter \|\| options\.toolPolicy !== 'function-calling'\)/,
    );
    // `disabled` must still disable, for xAI as for everything else.
    assert.match(chat, /const toolsAllowed = options\.toolPolicy !== 'disabled';/);
    assert.match(openaiBranch, /const openaiSearchEnabled = toolsAllowed/);
  });
});
