import { type ProviderId } from './endpoints';

/** Wire protocols supported by Willow's provider adapters. */
export type ProviderApiFormat =
  | 'native-gemini'
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'xai-chat-completions';

export type ProviderToolPolicy = 'provider-native' | 'function-calling' | 'disabled';

export interface ProviderReasoningEffort {
  id: string;
  label: string;
  /** Numeric value used by Willow's existing model selector. */
  level: number;
  /** Optional provider-specific wire value (for example `minimal` or `xhigh`). */
  value?: string;
}

export interface ProviderCatalogModel {
  id: string;
  name: string;
  modelId: string;
  thinkingLevel: number;
  thinkingLabel?: string;
  effortLabel?: string;
  capabilities?: string[];
  reasoningEfforts?: ProviderReasoningEffort[];
  profileId?: string;
}

export interface WillowResource {
  id: string;
  name: string;
  type: 'url' | 'file' | 'text' | 'collection';
  uri?: string;
  content?: string;
  createdAt: number;
  tags?: string[];
}

export interface ProviderProfile {
  id: string;
  name: string;
  /** Existing Willow transport that executes this profile. */
  transportProvider: ProviderId;
  apiFormat: ProviderApiFormat;
  baseUrl: string;
  /** Key bucket. Built-ins use their provider id; custom profiles get their own bucket. */
  apiKeyId: string;
  toolPolicy: ProviderToolPolicy;
  enabled: boolean;
  modelIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ProviderProfileState {
  profiles: ProviderProfile[];
  resources: WillowResource[];
  /** See `PROFILE_SCHEMA_VERSION`. Absent on anything written before it existed. */
  schemaVersion?: number;
}

/**
 * Bumped when a stored profile has to be re-read rather than merely defaulted.
 *
 * 1 — the tool policy became uniform across providers. Two stored defaults meant
 *     something the selector no longer says: xAI carried `function-calling` from an
 *     older default (which now means "no server-side search", costing Grok the X
 *     search that is the reason to use it), and Moonshot carried `disabled` (which
 *     now also withholds Canvas). Both are rewritten to the current default ONCE.
 *     A user who picks either value by hand after this keeps it — the migration
 *     runs on the version, not on the value.
 */
export const PROFILE_SCHEMA_VERSION = 1;

/** The stale defaults version 1 exists to clear, per provider. */
const MIGRATED_TOOL_POLICIES: Partial<Record<ProviderId, ProviderToolPolicy>> = {
  spacexai: 'function-calling',
  moonshot: 'disabled',
};

export const DEFAULT_PROFILE_IDS: Record<ProviderId, string> = {
  gemini: 'gemini-default',
  openai: 'openai-default',
  anthropic: 'anthropic-default',
  moonshot: 'moonshot-default',
  spacexai: 'xai-default',
  zhipuai: 'zhipu-default',
};

const DEFAULT_API_FORMATS: Record<ProviderId, ProviderApiFormat> = {
  gemini: 'native-gemini',
  openai: 'openai-chat-completions',
  anthropic: 'anthropic-messages',
  moonshot: 'openai-chat-completions',
  spacexai: 'xai-chat-completions',
  zhipuai: 'openai-chat-completions',
};

export const defaultApiFormatForProvider = (provider: ProviderId): ProviderApiFormat => DEFAULT_API_FORMATS[provider];

/**
 * Which provider's server-side tools a format can carry.
 *
 * Built-in tools are part of the wire format, not of the credential: an endpoint
 * addressed with Chat Completions cannot be asked for `googleSearch` however
 * Google-shaped the key is. Adapters read this so a profile that switches format
 * switches tool vocabulary with it.
 */
export const nativeToolFormatForProvider = (
  provider: ProviderId,
  format: ProviderApiFormat,
): ProviderId | null => {
  if (format === 'native-gemini') return 'gemini';
  if (format === 'anthropic-messages') return 'anthropic';
  if (format === 'xai-chat-completions') return 'spacexai';
  /* The two OpenAI formats are shared by four providers, and their search tools
     differ — OpenAI's flat `web_search`, Zhipu's nested config, Moonshot's
     unverified builtin (which is why it has none here). So the provider decides. */
  return provider === 'moonshot' ? null : provider;
};

/*
 * `provider-native` everywhere, including the two that used to opt out.
 *
 * The policy means one thing on every provider now — `provider-native` sends the
 * endpoint's own built-in tools alongside Willow's function declarations,
 * `function-calling` sends the declarations alone, `disabled` sends nothing — so a
 * per-provider default that quietly meant something else was the reason the
 * selector did not behave the same way twice.
 *
 * Moonshot was `disabled`, which was written when `disabled` was the only way to
 * withhold a search tool whose shape could not be verified. It also withheld
 * Canvas and the personalization tools, so Kimi could not write a document at all.
 * It is `function-calling` now: no server-side search (there is still no verified
 * shape for it), every client tool present.
 */
const DEFAULT_TOOL_POLICIES: Record<ProviderId, ProviderToolPolicy> = {
  gemini: 'provider-native',
  openai: 'provider-native',
  anthropic: 'provider-native',
  moonshot: 'function-calling',
  spacexai: 'provider-native',
  zhipuai: 'provider-native',
};

export const defaultToolPolicyForProvider = (provider: ProviderId): ProviderToolPolicy => DEFAULT_TOOL_POLICIES[provider];

export const createDefaultProviderProfiles = (
  baseUrls: Partial<Record<ProviderId, string>> = {},
  now = Date.now(),
): ProviderProfile[] => (Object.keys(DEFAULT_PROFILE_IDS) as ProviderId[]).map((provider) => ({
  id: DEFAULT_PROFILE_IDS[provider],
  name: provider === 'spacexai' ? 'xAI / Grok' : provider.charAt(0).toUpperCase() + provider.slice(1),
  transportProvider: provider,
  apiFormat: DEFAULT_API_FORMATS[provider],
  baseUrl: baseUrls[provider] || '',
  apiKeyId: provider,
  toolPolicy: DEFAULT_TOOL_POLICIES[provider],
  enabled: true,
  modelIds: [],
  createdAt: now,
  updatedAt: now,
}));

const isProvider = (value: unknown): value is ProviderId =>
  value === 'gemini' || value === 'openai' || value === 'anthropic' || value === 'moonshot' || value === 'spacexai' || value === 'zhipuai';

const isApiFormat = (value: unknown): value is ProviderApiFormat =>
  value === 'native-gemini' || value === 'openai-chat-completions' || value === 'openai-responses' || value === 'anthropic-messages' || value === 'xai-chat-completions';

const isToolPolicy = (value: unknown): value is ProviderToolPolicy =>
  value === 'provider-native' || value === 'function-calling' || value === 'disabled';

export const normalizeProviderProfileState = (
  value: unknown,
  baseUrls: Partial<Record<ProviderId, string>> = {},
): ProviderProfileState => {
  const input = value && typeof value === 'object' ? value as Partial<ProviderProfileState> : {};
  const defaults = createDefaultProviderProfiles(baseUrls);
  const storedVersion = Number(input.schemaVersion) || 0;
  const rawProfiles = Array.isArray(input.profiles) ? input.profiles : [];
  const profiles = rawProfiles
    .filter((profile): profile is ProviderProfile => Boolean(profile && typeof profile === 'object'))
    .map((profile) => {
      const transportProvider = isProvider(profile.transportProvider) ? profile.transportProvider : 'openai';
      const fallback = defaults.find((candidate) => candidate.id === DEFAULT_PROFILE_IDS[transportProvider])!;
      /* See `PROFILE_SCHEMA_VERSION`: a stale default is replaced once, and only
         while the stored state predates the version that redefined it. */
      const stale = storedVersion < 1
        && isToolPolicy(profile.toolPolicy)
        && MIGRATED_TOOL_POLICIES[transportProvider] === profile.toolPolicy;
      return {
        ...fallback,
        ...profile,
        id: typeof profile.id === 'string' && profile.id.trim()
          ? profile.id
          : `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : fallback.name,
        transportProvider,
        apiFormat: isApiFormat(profile.apiFormat) ? profile.apiFormat : fallback.apiFormat,
        baseUrl: typeof profile.baseUrl === 'string' ? profile.baseUrl : fallback.baseUrl,
        apiKeyId: typeof profile.apiKeyId === 'string' && profile.apiKeyId.trim() ? profile.apiKeyId : transportProvider,
        toolPolicy: !stale && isToolPolicy(profile.toolPolicy) ? profile.toolPolicy : fallback.toolPolicy,
        enabled: profile.enabled !== false,
        modelIds: Array.isArray(profile.modelIds) ? profile.modelIds.filter((id): id is string => typeof id === 'string') : [],
        createdAt: Number(profile.createdAt) || fallback.createdAt,
        updatedAt: Number(profile.updatedAt) || fallback.updatedAt,
      };
    });

  for (const fallback of defaults) {
    if (!profiles.some((profile) => profile.id === fallback.id)) profiles.push(fallback);
  }

  const resources = Array.isArray(input.resources)
    ? input.resources.filter((resource): resource is WillowResource => Boolean(resource && typeof resource === 'object' && typeof resource.id === 'string' && typeof resource.name === 'string'))
      .map((resource): WillowResource => ({
        ...resource,
        type: resource.type === 'url' || resource.type === 'file' || resource.type === 'collection' ? resource.type : 'text',
        createdAt: Number(resource.createdAt) || Date.now(),
      }))
    : [];

  return { profiles, resources, schemaVersion: PROFILE_SCHEMA_VERSION };
};

// Model configuration historically exposed these profiles as `providerProfiles`,
// while the profile helpers used the shorter `profiles` field. Accept both
// shapes so persisted configs from either schema resolve the same endpoint.
const profilesFromState = (state: (ProviderProfileState & { providerProfiles?: ProviderProfile[] }) | undefined): ProviderProfile[] => {
  if (Array.isArray(state?.providerProfiles)) return state.providerProfiles;
  return state?.profiles || [];
};

export const profileForProvider = (state: (ProviderProfileState & { providerProfiles?: ProviderProfile[] }) | undefined, provider: ProviderId): ProviderProfile | undefined => {
  const profiles = profilesFromState(state);
  return profiles.find((profile) => profile.id === DEFAULT_PROFILE_IDS[provider])
    || profiles.find((profile) => profile.transportProvider === provider && profile.enabled);
};

export const profileForModel = (state: (ProviderProfileState & { providerProfiles?: ProviderProfile[] }) | undefined, provider: ProviderId, profileId?: string): ProviderProfile | undefined => {
  const profiles = profilesFromState(state);
  if (profileId) {
    const exact = profiles.find((profile) => profile.id === profileId);
    if (exact) return exact;
  }
  return profileForProvider(state, provider);
};

/** The transport fields one turn needs, in the shape `AiOptions` takes them. */
export interface ProviderTransportBinding {
  baseUrl?: string;
  apiFormat?: ProviderApiFormat;
  toolPolicy?: ProviderToolPolicy;
  profileId?: string;
  /** Which key bucket to draw from. Falls back to the provider's own. */
  apiKeyId: string;
}

/**
 * Resolve a turn's endpoint, wire format and tool policy from the LIVE profile.
 *
 * Every surface has to go through here, because the obvious alternative — reading
 * the fields off the saved model — is wrong in two directions at once. A model
 * added from the catalogue never carried them, so it silently fell back to the
 * provider's default format however the dropdown was set; and a custom model
 * carried a copy snapshotted when it was added, which went stale the moment the
 * user changed the dropdown afterwards. Chat resolved the profile and the other
 * four surfaces did not, so the same setting meant different things depending on
 * which part of the app you were in.
 *
 * `savedModel.profileId` still selects WHICH profile — it just no longer supplies
 * the values.
 */
export const resolveProviderBinding = (
  modelConfig: any,
  provider: ProviderId,
  savedModel?: { profileId?: string } | null,
): ProviderTransportBinding => {
  const profile = profileForModel(modelConfig, provider, savedModel?.profileId);
  return {
    baseUrl: profile?.baseUrl || modelConfig?.[provider]?.baseUrl,
    apiFormat: profile?.apiFormat,
    toolPolicy: profile?.toolPolicy,
    profileId: profile?.id ?? savedModel?.profileId,
    apiKeyId: profile?.apiKeyId || provider,
  };
};

/**
 * The keys a binding may authenticate with, in the order they should be tried.
 *
 * Returns the whole bucket rather than one key, because `streamChat` rotates
 * through them when one is rejected. Blank entries are dropped here so a trailing
 * comma in the Settings field cannot produce an empty credential.
 *
 * `apiKeys` is `unknown` and narrowed at runtime on purpose: `apiKeyId` is a free
 * string (a custom profile may name its own bucket), so the set of keys is not
 * statically known, and the callers' own `ApiKeys` interface has no index
 * signature to satisfy one with.
 */
export const apiKeysForBinding = (
  binding: Pick<ProviderTransportBinding, 'apiKeyId'>,
  provider: ProviderId,
  apiKeys?: unknown,
): string[] => {
  const buckets = (apiKeys ?? {}) as Record<string, unknown>;
  const bucket = buckets[binding.apiKeyId] ?? buckets[provider];
  if (!Array.isArray(bucket)) return [];
  return bucket
    .filter((key): key is string => typeof key === 'string')
    .map((key) => key.trim())
    .filter(Boolean);
};
