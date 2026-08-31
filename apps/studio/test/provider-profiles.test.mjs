/**
 * Provider profiles: the two selectors in Manage <provider>, and what a stored
 * profile becomes when it is read back.
 *
 * Both settings apply to every provider — any of the five wire formats can be
 * chosen for any credential, and the tool policy means one thing everywhere. That
 * is newer than the selectors themselves, which is why the migration below exists:
 * two providers shipped defaults that the policy no longer says.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const {
  DEFAULT_PROFILE_IDS,
  PROFILE_SCHEMA_VERSION,
  createDefaultProviderProfiles,
  defaultApiFormatForProvider,
  defaultToolPolicyForProvider,
  nativeToolFormatForProvider,
  normalizeProviderProfileState,
} = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'providers', 'profiles.ts'));

const PROVIDERS = ['gemini', 'openai', 'anthropic', 'moonshot', 'spacexai', 'zhipuai'];

/* ------------------------------------------------------------- the defaults */

/*
 * Each provider starts on its own native format. Nothing else would be honest: a
 * default of Chat Completions for Gemini would work (the adapter supports it) while
 * quietly costing `googleSearch`, code execution and the Interactions transport.
 */
it('defaults every provider to its own wire format', () => {
  assert.deepEqual(PROVIDERS.map(defaultApiFormatForProvider), [
    'native-gemini',
    'openai-chat-completions',
    'anthropic-messages',
    'openai-chat-completions',
    'xai-chat-completions',
    'openai-chat-completions',
  ]);
});

/*
 * `provider-native` everywhere except Moonshot, whose search builtin has no
 * verified shape — `function-calling` withholds exactly that and nothing else.
 * Moonshot used to default to `disabled`, which also withheld Canvas and the
 * personalization tools, so Kimi could not write a document at all.
 */
it('defaults the tool policy to the most capable setting each endpoint supports', () => {
  for (const provider of PROVIDERS) {
    assert.equal(
      defaultToolPolicyForProvider(provider),
      provider === 'moonshot' ? 'function-calling' : 'provider-native',
      provider,
    );
  }
});

it('builds one enabled profile per provider, keyed to its own credential bucket', () => {
  const profiles = createDefaultProviderProfiles({}, 1000);
  assert.equal(profiles.length, PROVIDERS.length);
  for (const provider of PROVIDERS) {
    const profile = profiles.find((entry) => entry.id === DEFAULT_PROFILE_IDS[provider]);
    assert.ok(profile, provider);
    assert.equal(profile.transportProvider, provider);
    assert.equal(profile.apiKeyId, provider, 'a shared key bucket would leak one provider\'s key to another');
    assert.equal(profile.enabled, true);
  }
});

/* ------------------------------------------------- which built-ins a format has */

/*
 * Built-in tools belong to the wire format, not to the credential: an endpoint
 * addressed with Chat Completions cannot be asked for `googleSearch` however
 * Google-shaped the key is. So a profile that switches format switches tool
 * vocabulary with it.
 */
it('reads the built-in tool vocabulary off the format, not the provider', () => {
  assert.equal(nativeToolFormatForProvider('openai', 'native-gemini'), 'gemini');
  assert.equal(nativeToolFormatForProvider('zhipuai', 'anthropic-messages'), 'anthropic');
  assert.equal(nativeToolFormatForProvider('openai', 'xai-chat-completions'), 'spacexai');
  assert.equal(nativeToolFormatForProvider('zhipuai', 'openai-chat-completions'), 'zhipuai');
  assert.equal(
    nativeToolFormatForProvider('moonshot', 'openai-chat-completions'),
    null,
    'Moonshot is the one provider with no verified search shape',
  );
  assert.equal(
    nativeToolFormatForProvider('moonshot', 'anthropic-messages'),
    'anthropic',
    'and pointing it at a format that has one gives it that one',
  );
});

/* ------------------------------------------------------------ reading it back */

it('keeps every field a user chose', () => {
  const stored = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profiles: [{
      id: DEFAULT_PROFILE_IDS.gemini,
      name: 'My relay',
      transportProvider: 'gemini',
      apiFormat: 'openai-chat-completions',
      baseUrl: 'https://relay.example/openai',
      apiKeyId: 'gemini',
      toolPolicy: 'function-calling',
      enabled: true,
      modelIds: ['a'],
      createdAt: 1,
      updatedAt: 2,
    }],
    resources: [],
  };
  const gemini = normalizeProviderProfileState(stored).profiles
    .find((profile) => profile.id === DEFAULT_PROFILE_IDS.gemini);
  assert.equal(gemini.apiFormat, 'openai-chat-completions', 'a Gemini key on an OpenAI-shaped relay is a real setup');
  assert.equal(gemini.toolPolicy, 'function-calling');
  assert.equal(gemini.baseUrl, 'https://relay.example/openai');
  assert.equal(gemini.name, 'My relay');
});

it('repairs a profile that is missing or malformed rather than dropping it', () => {
  const { profiles } = normalizeProviderProfileState({
    profiles: [{
      id: DEFAULT_PROFILE_IDS.anthropic,
      transportProvider: 'anthropic',
      apiFormat: 'not-a-format',
      toolPolicy: 'nonsense',
    }],
    resources: [],
  });
  const anthropic = profiles.find((profile) => profile.id === DEFAULT_PROFILE_IDS.anthropic);
  assert.equal(anthropic.apiFormat, 'anthropic-messages');
  assert.equal(anthropic.toolPolicy, 'provider-native');
  assert.equal(profiles.length, PROVIDERS.length, 'and every provider still has one');
});

/* --------------------------------------------------------------- the migration */

/*
 * The two stale defaults, cleared ONCE.
 *
 * xAI carried `function-calling` from a time when the policy did nothing on that
 * path; now that it means "no server-side built-ins" it would cost Grok the X
 * search that is the reason to use it. Moonshot carried `disabled`, which now also
 * withholds Canvas. Both are rewritten when the stored state predates the version
 * that redefined them — and only then, so a value chosen by hand afterwards stands.
 */
it('clears the two stale tool-policy defaults on an unversioned state', () => {
  const { profiles, schemaVersion } = normalizeProviderProfileState({
    profiles: [
      { id: DEFAULT_PROFILE_IDS.spacexai, transportProvider: 'spacexai', toolPolicy: 'function-calling' },
      { id: DEFAULT_PROFILE_IDS.moonshot, transportProvider: 'moonshot', toolPolicy: 'disabled' },
    ],
    resources: [],
  });
  assert.equal(
    profiles.find((profile) => profile.transportProvider === 'spacexai').toolPolicy,
    'provider-native',
    'Grok gets web_search and x_search back',
  );
  assert.equal(
    profiles.find((profile) => profile.transportProvider === 'moonshot').toolPolicy,
    'function-calling',
    'Kimi gets Canvas, and still no unverified search shape',
  );
  assert.equal(schemaVersion, PROFILE_SCHEMA_VERSION, 'the state is stamped so it happens once');
});

it('leaves the same values alone once the state is versioned', () => {
  const { profiles } = normalizeProviderProfileState({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profiles: [
      { id: DEFAULT_PROFILE_IDS.spacexai, transportProvider: 'spacexai', toolPolicy: 'function-calling' },
      { id: DEFAULT_PROFILE_IDS.moonshot, transportProvider: 'moonshot', toolPolicy: 'disabled' },
    ],
    resources: [],
  });
  assert.equal(profiles.find((profile) => profile.transportProvider === 'spacexai').toolPolicy, 'function-calling');
  assert.equal(profiles.find((profile) => profile.transportProvider === 'moonshot').toolPolicy, 'disabled');
});

it('does not touch a policy that was never one of the stale defaults', () => {
  const { profiles } = normalizeProviderProfileState({
    profiles: [{ id: DEFAULT_PROFILE_IDS.openai, transportProvider: 'openai', toolPolicy: 'disabled' }],
    resources: [],
  });
  assert.equal(
    profiles.find((profile) => profile.transportProvider === 'openai').toolPolicy,
    'disabled',
    'OpenAI never defaulted to disabled, so this one is a choice',
  );
});
