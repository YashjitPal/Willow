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
}

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

const DEFAULT_TOOL_POLICIES: Record<ProviderId, ProviderToolPolicy> = {
  gemini: 'provider-native',
  openai: 'provider-native',
  anthropic: 'provider-native',
  moonshot: 'disabled',
  spacexai: 'function-calling',
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
  const rawProfiles = Array.isArray(input.profiles) ? input.profiles : [];
  const profiles = rawProfiles
    .filter((profile): profile is ProviderProfile => Boolean(profile && typeof profile === 'object'))
    .map((profile) => {
      const transportProvider = isProvider(profile.transportProvider) ? profile.transportProvider : 'openai';
      const fallback = defaults.find((candidate) => candidate.id === DEFAULT_PROFILE_IDS[transportProvider])!;
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
        toolPolicy: isToolPolicy(profile.toolPolicy) ? profile.toolPolicy : fallback.toolPolicy,
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

  return { profiles, resources };
};

export const profileForProvider = (state: ProviderProfileState | undefined, provider: ProviderId): ProviderProfile | undefined => {
  const profiles = state?.profiles || [];
  return profiles.find((profile) => profile.id === DEFAULT_PROFILE_IDS[provider])
    || profiles.find((profile) => profile.transportProvider === provider && profile.enabled);
};

export const profileForModel = (state: ProviderProfileState | undefined, provider: ProviderId, profileId?: string): ProviderProfile | undefined => {
  if (profileId) {
    const exact = state?.profiles?.find((profile) => profile.id === profileId);
    if (exact) return exact;
  }
  return profileForProvider(state, provider);
};
