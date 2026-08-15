import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const profiles = read('platform', 'ai', 'src', 'providers', 'profiles.ts');
const chat = read('platform', 'ai', 'src', 'chat.ts');
const settings = read('apps', 'studio', 'src', 'settings', 'tabs', 'ModelsTab.tsx');
const modelMenu = read('platform', 'ui', 'src', 'models', 'ModelsMenu.tsx');

describe('provider profiles', () => {
  it('keeps every built-in provider on an explicit default API format', () => {
    assert.match(profiles, /gemini:\s*'native-gemini'/);
    assert.match(profiles, /openai:\s*'openai-chat-completions'/);
    assert.match(profiles, /anthropic:\s*'anthropic-messages'/);
    assert.match(profiles, /spacexai:\s*'xai-chat-completions'/);
  });

  it('routes changed formats through adapter decisions without merging Grok into Gemini', () => {
    assert.match(chat, /usesGeminiAdapter/);
    assert.match(chat, /usesOpenAIAdapter/);
    assert.match(chat, /usesAnthropicAdapter/);
    assert.match(chat, /usesXaiAdapter/);
    assert.match(chat, /const configuredFormat = options\.apiFormat \|\| defaultApiFormatForProvider/);
  });

  it('keeps provider setup direct while preserving custom models and reasoning efforts', () => {
    assert.match(settings, /Add custom model/);
    assert.match(settings, /reasoningEfforts/);
    assert.doesNotMatch(settings, /Provider profiles/);
    assert.doesNotMatch(settings, /Start from a preset/);
    assert.doesNotMatch(settings, />Resources</);
    assert.doesNotMatch(profiles, /PROVIDER_PROFILE_PRESETS/);
    assert.match(settings, /DEFAULT_PROFILE_IDS\[managingProvider/);
    assert.match(modelMenu, /Array\.isArray\(\(base as any\)\.reasoningEfforts\)/);
  });
});
