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
const grokStart = chat.indexOf('} else if (usesXaiAdapter)', openaiStart);

assert.ok(geminiStart >= 0, 'Gemini provider branch must exist');
assert.ok(openaiStart > geminiStart, 'Gemini branch must end before OpenAI');
assert.ok(grokStart > openaiStart, 'Grok must have a dedicated provider branch');

const geminiBranch = chat.slice(geminiStart, openaiStart);
const grokBranch = chat.slice(grokStart);

describe('Gemini and Grok tool isolation', () => {
  it('keeps Gemini server-side built-in tools compatible with function calling', () => {
    assert.match(geminiBranch, /include_server_side_tool_invocations:\s*true/);
    assert.match(geminiBranch, /if \(part\?\.functionCall\) \{/);
    assert.doesNotMatch(geminiBranch, /functionCall\.name\.toLowerCase\(\)\.includes\('search'\)/);
  });

  it('keeps Grok search functions inside the dedicated Grok branch', () => {
    assert.doesNotMatch(geminiBranch, /name:\s*'web_search'|name:\s*'x_search'/);
    assert.match(grokBranch, /name:\s*'web_search'/);
    assert.match(grokBranch, /name:\s*'x_search'/);
  });
});
