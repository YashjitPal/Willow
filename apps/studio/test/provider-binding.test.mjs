/**
 * The API section, end to end: what Settings shows is what the request carries.
 *
 * Every case here is a shipped bug. The settings themselves were always wired —
 * `chat.ts` really does branch on the wire format — but four things between the
 * dropdown and the request disagreed with it, and each one made the UI lie in a
 * way no typecheck could see:
 *
 *  - four of the five surfaces read the format off the SAVED MODEL rather than the
 *    profile, so a catalogue model silently used the provider default and a custom
 *    model used whatever was set the day it was added,
 *  - the profile schema stamp was dropped before persisting, so the one-time
 *    tool-policy migration re-ran on every boot and reverted two legal choices,
 *  - `disabled` withheld only the built-ins on Gemini,
 *  - the key field's own hint described splitting and rotation that did not exist.
 *
 * Source-text assertions appear where a module cannot be imported: `chat.ts` pulls
 * the provider SDKs in as bare specifiers, which the runner's TS loader cannot
 * resolve from a data: URL. Same reason as `stop-response.test.mjs`.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const SOURCE = {
  chat: ['platform', 'ai', 'src', 'chat.ts'],
  profiles: ['platform', 'ai', 'src', 'providers', 'profiles.ts'],
  providerSettings: ['apps', 'studio', 'src', 'settings', 'provider-settings.ts'],
  app: ['apps', 'studio', 'src', 'app', 'App.tsx'],
  chatView: ['features', 'chat', 'src', 'ChatView.tsx'],
  modelsApiPage: ['apps', 'studio', 'src', 'settings', 'tabs', 'models-api', 'ModelsApiPage.tsx'],
  modelsTab: ['apps', 'studio', 'src', 'settings', 'tabs', 'ModelsTab.tsx'],
};

const {
  DEFAULT_PROFILE_IDS,
  PROFILE_SCHEMA_VERSION,
  apiKeysForBinding,
  createDefaultProviderProfiles,
  normalizeProviderProfileState,
  resolveProviderBinding,
} = await importTs(path.join(repoRoot, ...SOURCE.profiles));

const { splitApiKeys } = await importTs(path.join(repoRoot, ...SOURCE.providerSettings));

const chat = read(...SOURCE.chat);

/** A modelConfig holding one edited profile, in the shape App.tsx persists. */
const configWith = (provider, patch, savedModels = []) => ({
  [provider]: { savedModels, baseUrl: 'https://from-model-config.example' },
  providerProfiles: createDefaultProviderProfiles({
    [provider]: 'https://default.example',
  }).map((profile) => (profile.id === DEFAULT_PROFILE_IDS[provider]
    ? { ...profile, ...patch }
    : profile)),
});

/* ------------------------------------------------- the binding is read live */

/*
 * The core of it. A custom model froze `apiFormat`/`toolPolicy`/`baseUrl` at the
 * moment it was added, so changing the dropdown afterwards moved the screen and
 * not the request. The stale copy is still on disk for anyone who added a model
 * before the fix, so ignoring it has to be asserted, not assumed.
 */
it('prefers the live profile over the values frozen onto a saved model', () => {
  const config = configWith('anthropic', {
    apiFormat: 'openai-chat-completions',
    toolPolicy: 'function-calling',
    baseUrl: 'https://relay.example/v1',
  });
  const staleModel = {
    profileId: DEFAULT_PROFILE_IDS.anthropic,
    apiFormat: 'anthropic-messages',
    toolPolicy: 'provider-native',
    baseUrl: 'https://stale.example',
  };

  const binding = resolveProviderBinding(config, 'anthropic', staleModel);
  assert.equal(binding.apiFormat, 'openai-chat-completions');
  assert.equal(binding.toolPolicy, 'function-calling');
  assert.equal(binding.baseUrl, 'https://relay.example/v1');
});

/*
 * The other half of the same bug, and the quieter one: a model added from the
 * catalogue never carried these fields at all, so every surface but Chat fell
 * through to the provider's default format however the dropdown was set.
 */
it('resolves a catalogue model that carries no binding of its own', () => {
  const config = configWith('spacexai', { apiFormat: 'openai-responses', toolPolicy: 'disabled' });
  const binding = resolveProviderBinding(config, 'spacexai', { id: 'x', modelId: 'grok-4.6' });

  assert.equal(binding.apiFormat, 'openai-responses');
  assert.equal(binding.toolPolicy, 'disabled');
  assert.equal(binding.profileId, DEFAULT_PROFILE_IDS.spacexai);
});

it('falls back to the provider block only when the profile names no endpoint', () => {
  const binding = resolveProviderBinding(configWith('openai', { baseUrl: '' }), 'openai', null);
  assert.equal(binding.baseUrl, 'https://from-model-config.example');
});

/*
 * Every surface has to agree, which is the whole point of there being one helper.
 * Chat was the only one resolving the profile before, so the same dropdown meant
 * different things in Chat, the Workbench, Spark, Design and visual editing.
 */
it('is the only way any surface resolves a binding', () => {
  const callers = [
    ['features', 'chat', 'src', 'chat-model.ts'],
    ['features', 'spark', 'src', 'SparkWorkspace.tsx'],
    ['features', 'design', 'src', 'DesignChat.tsx'],
    ['features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'],
    ['features', 'code', 'src', 'visual-editing', 'VisualEditingOverlay.tsx'],
  ];
  for (const caller of callers) {
    const source = read(...caller);
    const name = caller[caller.length - 1];
    assert.match(source, /resolveProviderBinding\(/, `${name} must resolve the live profile`);
    assert.doesNotMatch(
      source,
      /apiFormat:\s*(selected|selectedModel)\??\.apiFormat/,
      `${name} must not read the wire format off a saved model`,
    );
    assert.doesNotMatch(
      source,
      /toolPolicy:\s*(selected|selectedModel)\??\.toolPolicy/,
      `${name} must not read the tool policy off a saved model`,
    );
  }
});

/* Adding a model must not start a fresh copy of the drift. */
it('does not stamp the profile onto a newly added custom model', () => {
  for (const source of [read(...SOURCE.modelsApiPage), read(...SOURCE.modelsTab)]) {
    assert.doesNotMatch(source, /apiFormat:\s*profile\?\.apiFormat/);
    assert.doesNotMatch(source, /toolPolicy:\s*profile\?\.toolPolicy/);
    assert.doesNotMatch(source, /baseUrl:\s*profile\?\.baseUrl/);
    assert.match(source, /profileId,/, 'the profile id is the whole binding a saved model needs');
  }
});

/* ------------------------------------------------------- the schema version */

/*
 * `normalizeProviderProfileState` stamps the state so its one-time tool-policy
 * migration runs once. App.tsx read the stamp back out of the result and then
 * dropped it, so every boot looked unversioned and the migration re-ran — which
 * silently reverted the two values it is allowed to rewrite. Both halves of the
 * round trip are asserted, because either one alone leaves the bug.
 */
it('round-trips the schema stamp through the persisted config', () => {
  const app = read(...SOURCE.app);
  assert.match(app, /schemaVersion: parsed\.profileSchemaVersion/, 'the stored stamp must be read back in');
  assert.match(app, /profileSchemaVersion: normalizedProfiles\.schemaVersion/, 'and written back out');
  assert.match(app, /profileSchemaVersion: PROFILE_SCHEMA_VERSION/, 'a fresh install starts stamped');
});

it('keeps a hand-picked policy that matches a migrated default, once stamped', () => {
  const stored = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profiles: [
      { id: DEFAULT_PROFILE_IDS.spacexai, transportProvider: 'spacexai', toolPolicy: 'function-calling' },
      { id: DEFAULT_PROFILE_IDS.moonshot, transportProvider: 'moonshot', toolPolicy: 'disabled' },
    ],
    resources: [],
  };

  // Re-reading its own output must be a fixed point, which is what a boot is.
  let state = normalizeProviderProfileState(stored);
  for (let boot = 0; boot < 3; boot += 1) state = normalizeProviderProfileState(state);

  const byId = Object.fromEntries(state.profiles.map((profile) => [profile.id, profile]));
  assert.equal(byId[DEFAULT_PROFILE_IDS.spacexai].toolPolicy, 'function-calling');
  assert.equal(byId[DEFAULT_PROFILE_IDS.moonshot].toolPolicy, 'disabled');
});

/* --------------------------------------------------------------- API keys */

it('reads the key field as a list, on commas and newlines', () => {
  assert.deepEqual(splitApiKeys('sk-aaa, sk-bbb'), ['sk-aaa', 'sk-bbb']);
  assert.deepEqual(splitApiKeys('sk-aaa\nsk-bbb\r\nsk-ccc'), ['sk-aaa', 'sk-bbb', 'sk-ccc']);
  assert.deepEqual(splitApiKeys('  sk-only  '), ['sk-only']);
  assert.deepEqual(splitApiKeys('sk-aaa,,  ,'), ['sk-aaa'], 'a trailing comma is not an empty credential');
  assert.deepEqual(splitApiKeys(''), []);
});

it('draws keys from the profile bucket, falling back to the provider', () => {
  const keys = { openai: ['sk-provider'], 'my-relay': ['sk-relay-1', '  ', 'sk-relay-2'] };
  assert.deepEqual(apiKeysForBinding({ apiKeyId: 'my-relay' }, 'openai', keys), ['sk-relay-1', 'sk-relay-2']);
  assert.deepEqual(apiKeysForBinding({ apiKeyId: 'unset' }, 'openai', keys), ['sk-provider']);
  assert.deepEqual(apiKeysForBinding({ apiKeyId: 'unset' }, 'anthropic', keys), []);
  assert.deepEqual(apiKeysForBinding({ apiKeyId: 'openai' }, 'openai', undefined), []);
});

/*
 * Rotation is only safe before the first token, because an SDK `create` rejects on
 * the response head — the same reason `createWithSearchFallback` is safe. A quota
 * error is deliberately not an auth failure: the key is valid and the next one is
 * throttled too, so rotating would spend every key on one rate limit.
 */
it('rotates keys on rejection, and only while nothing has been emitted', () => {
  assert.match(chat, /apiKeyFallbacks\?: string\[\]/);
  assert.match(chat, /const namesAuthRejection = \(error: any\): boolean => \{/);
  assert.match(chat, /if \(\/quota\|rate\.\?limit\|too many requests\|overloaded\|429\/i\.test\(text\)\) return false;/);
  assert.match(
    chat,
    /if \(emitted \|\| isLastKey \|\| isAbortError\(error\) \|\| !namesAuthRejection\(error\)\) throw error;/,
  );
  // The field promises this in both surfaces; it has to remain true in both.
  for (const source of [read(...SOURCE.modelsApiPage), read(...SOURCE.modelsTab)]) {
    assert.match(source, /tried from left to right when authentication is rejected/);
  }
});

/* ------------------------------------------------------------ tool policy */

/*
 * `disabled` used to withhold only the built-ins on Gemini, while OpenAI and
 * Anthropic withheld everything — one dropdown, two meanings.
 */
it('means the same thing on all three adapters', () => {
  const geminiStart = chat.indexOf('if (usesGeminiAdapter)');
  const openaiStart = chat.indexOf('} else if (usesOpenAIAdapter)', geminiStart);
  assert.ok(geminiStart >= 0 && openaiStart > geminiStart, 'adapter branches must be findable');
  const geminiBranch = chat.slice(geminiStart, openaiStart);

  assert.match(
    geminiBranch,
    /if \(toolsAllowed\) \{\s*for \(const block of options\.personalTools/,
    'Gemini must withhold its function declarations too',
  );
  assert.match(geminiBranch, /const mediaToolsEnabled = toolsAllowed &&/);
  assert.match(chat, /const openaiDeclarations = toolsAllowed/);
  assert.match(chat, /\.\.\.\(toolsAllowed \? anthropicFunctionTools\(\[/);
});

/*
 * Anthropic degraded prompt caching, thinking and max_tokens but had no step for
 * the search tool, so a relay that 400s on `web_search_20250305` failed the whole
 * turn — Claude on a custom base URL was the one setup that could not answer.
 */
it('drops Anthropic server-side search rather than failing the turn', () => {
  assert.match(chat, /let anthropicSearchDropped = false;/);
  assert.match(chat, /const buildAnthropicTools = \(\) => \[/);
  assert.match(chat, /anthropicSearchEnabled && !anthropicSearchDropped/);
  assert.match(chat, /dropped = 'server-side web search';/);
});

/* ------------------------------------------------- Willow's own web search */

/*
 * The client tool existed, fully written, and no caller ever passed it — so an
 * endpoint that could not run a server-side search simply had none. Declaring it
 * is conditional because `web_search` is also the name of Anthropic's and OpenAI's
 * built-ins: two tools of one name in a request is the collision this avoids.
 */
it('supplies a client web_search exactly when no native one is sent', () => {
  const chatView = read(...SOURCE.chatView);
  assert.match(chatView, /webSearchTools: clientSearchEnabled \? webSearchToolDeclaration\(\) : undefined/);
  assert.match(chatView, /runWebSearch: clientSearchEnabled/);
  assert.match(
    chatView,
    /const endpointRunsOwnSearch = toolPolicy !== 'function-calling'\s*&& !!nativeToolFormatForProvider\(/,
    'the condition must be the negation of "a native search tool is going out"',
  );
  assert.match(
    chatView,
    /const clientSearchEnabled = toolPolicy !== 'disabled'\s*&& !endpointRunsOwnSearch\s*&& !!searchBackendKey/,
    'and it must be gated on an executor existing to answer the call',
  );
});

/* ------------------------------------------------ multi-round answer text */

/*
 * A model that narrates before calling a tool ("I'll look that up.") answers in
 * the NEXT round, and every adapter streams each round straight through
 * `onToken` — so the two arrived as one unbroken string:
 * `…hunt down the actual link.Don't have that tweet on hand.`
 *
 * Nothing asks for the narration and nothing strips it; both adapters relay text
 * that arrives alongside a tool call, so this is model temperament, not wiring.
 * The rule is the one the thought summaries already used, applied to answers.
 */
it('starts a new paragraph when a later round speaks after an earlier one', () => {
  // Turn-level flags, distinct from the per-round ones they are compared against.
  assert.match(chat, /let hasEmittedAnyAnswerText = false;/);
  assert.match(chat, /let hasEmittedTextThisIteration = false;/);
  assert.match(chat, /let hasEmittedTextThisRound = false;/);

  // Gemini, OpenAI-compatible, Anthropic — one rule, three adapters.
  assert.match(chat, /const separator = hasEmittedAnyAnswerText && !hasEmittedTextThisIteration \? '\\n\\n' : '';/);
  assert.match(chat, /const separator = !hasEmittedText && hasEmittedAnyAnswerText \? '\\n\\n' : '';/);
  assert.match(chat, /const separator = hasEmittedAnthropicText && !hasEmittedTextThisRound && delta\.text \? '\\n\\n' : '';/);
});

/*
 * The separator is part of the answer the reader sees, so anything indexing that
 * answer has to count it. Miss this and every citation on a multi-round turn
 * underlines text two characters upstream of where it belongs.
 */
it('counts the separator into the offsets that index the answer', () => {
  assert.match(chat, /openaiAnswerText \+= emitted;/);
  assert.match(chat, /anthropicTextLength \+= emitted\.length;/);
  assert.match(chat, /iterationText \+= emitted;/);
});

/*
 * The break replaces the space a model uses to join two rounds into one sentence
 * (`…look that up.` + `` Done — …``). Leaving that space in renders the second
 * paragraph indented by one character.
 */
it('absorbs the leading space a continuation opens with', () => {
  assert.match(chat, /const stripLeadingSpace = \(text: string\): string => text\.replace\(\/\^\[\^\\S\\r\\n\]\+\/, ''\);/);
  assert.equal(
    (chat.match(/separator \+ stripLeadingSpace\(/g) ?? []).length,
    4,
    'all four streaming paths: Gemini, Chat Completions, Responses, Anthropic',
  );
});

/*
 * Only what the reader sees carries the break. Both `roundText` and Anthropic's
 * text block are echoed back to the endpoint to continue the turn, and the model's
 * own words have to go back as it wrote them.
 */
it('keeps the break out of the text echoed back to the endpoint', () => {
  assert.match(chat, /roundText \+= content;/);
  assert.match(chat, /if \(textBlock\) textBlock\.text \+= delta\.text;/);
});

/*
 * Gemini's `hasEmittedText` is also set by a bare `functionCall` part, so it means
 * "something happened" rather than "the answer has text in it". Reusing it as the
 * per-iteration half would skip the break on exactly the turns that need it.
 */
it('does not reuse the Gemini phase flag as the per-iteration text flag', () => {
  const geminiStart = chat.indexOf('if (usesGeminiAdapter)');
  const openaiStart = chat.indexOf('} else if (usesOpenAIAdapter)', geminiStart);
  const geminiBranch = chat.slice(geminiStart, openaiStart);
  assert.match(geminiBranch, /if \(part\?\.functionCall\) \{[\s\S]{0,220}?hasEmittedText = true;/);
  assert.match(geminiBranch, /hasEmittedTextThisIteration = true;/);
});

/* ---------------------------------------------------------- the base URL */

/*
 * Both Files API calls named Google outright, so attaching a file on a profile
 * pointed at a gateway sent the key and the file straight to Google — the one
 * direct call a custom base URL exists to prevent.
 */
it('sends Gemini attachments to the configured endpoint', () => {
  assert.doesNotMatch(
    chat,
    /https:\/\/generativelanguage\.googleapis\.com\/upload/,
    'the Files upload must not hardcode Google',
  );
  assert.match(chat, /\$\{filesOrigin\}\/upload\/v1beta\/files\?key=/);
  assert.match(chat, /\$\{filesOrigin\}\/v1beta\/\$\{resourceName\}\?key=/);
  assert.match(chat, /const filesOrigin = geminiFilesOrigin\(options\.baseUrl, provider as ProviderId\);/);
  // A `files/...` URI is issued by one endpoint and meaningless to another.
  assert.match(chat, /const fingerprint = `\$\{filesOrigin\}::\$\{getAttachmentFingerprint\(att\)\}`;/);
});

/*
 * The Interactions transport is the counter-example that shows the rule: it is
 * genuinely Google-only, so it stays gated on the endpoint being the official one.
 */
it('keeps the Interactions transport gated on the official endpoint', () => {
  assert.match(chat, /const interactionsEligible = isOfficialEndpoint\('gemini', options\.baseUrl\)/);
});

/* ------------------------------------------------------------ the UI copy */

/*
 * These two dropdowns decide whether a turn gets the provider's built-ins or
 * Willow's substitute, which is not guessable from three words in a menu. The hint
 * is shared so the two surfaces cannot describe the same setting differently.
 */
it('explains the current pair of settings on both surfaces', () => {
  const shared = read('apps', 'studio', 'src', 'settings', 'provider-models.ts');
  assert.match(shared, /export const toolPolicyHint = \(/);
  assert.match(shared, /nativeToolFormatForProvider\(provider, format\)/, 'the hint reads the same predicate as the request layer');
  for (const source of [read(...SOURCE.modelsApiPage), read(...SOURCE.modelsTab)]) {
    assert.match(source, /toolPolicyHint\(/);
  }
});
