/**
 * Provider registry + key resolution.
 */

import type { ProviderKeys } from '../domain/types.ts';
import { anthropicProvider } from './anthropic.ts';
import { geminiProvider } from './gemini.ts';
import { mockProvider } from './mock.ts';
import { openaiProvider } from './openai.ts';
import { grokProvider } from './grok.ts';
import { kimiProvider } from './kimi.ts';
import { glmProvider } from './glm.ts';
import { providerForModel, ProviderError, type LLMProvider, type LLMRequest, type LLMResponse } from './types.ts';

const REGISTRY: Record<string, LLMProvider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
  grok: grokProvider,
  kimi: kimiProvider,
  glm: glmProvider,
  mock: mockProvider,
};

export function getProvider(id: string): LLMProvider {
  const p = REGISTRY[id];
  if (!p) throw new Error(`unknown provider '${id}'`);
  return p;
}

export class MissingKeyError extends Error {
  provider: string;
  constructor(provider: string) {
    super(
      `No API key configured for provider '${provider}'. ` +
      `Add one via PUT /api/v1/settings/keys or the x-provider-keys header.`,
    );
    this.name = 'MissingKeyError';
    this.provider = provider;
  }
}

/** Resolve the key for a provider: request keys first, then stored, then env. */
export function resolveKey(
  providerId: 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'mock',
  requestKeys: ProviderKeys | undefined,
  storedKeys: ProviderKeys | undefined,
): string {
  return resolveKeys(providerId, requestKeys, storedKeys)[0] ?? (() => { throw new MissingKeyError(providerId); })();
}

/** Return ordered credential candidates. A request explicitly supplying keys
 * takes precedence over stored/environment credentials, while retaining all
 * supplied candidates so rotation can fail over after an auth rejection. */
export function resolveKeys(
  providerId: 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'mock',
  requestKeys: ProviderKeys | undefined,
  storedKeys: ProviderKeys | undefined,
): string[] {
  if (providerId === 'mock') return ['mock'];
  const fromReq = requestKeys?.[providerId]?.filter((key) => typeof key === 'string' && key.trim().length > 0).map((key) => key.trim());
  if (fromReq?.length) return [...new Set(fromReq)];
  const fromStore = storedKeys?.[providerId]?.filter((key) => typeof key === 'string' && key.trim().length > 0).map((key) => key.trim());
  if (fromStore?.length) return [...new Set(fromStore)];
  const envNames: Record<string, string[]> = {
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    grok: ['XAI_API_KEY', 'GROK_API_KEY'],
    kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    glm: ['ZHIPUAI_API_KEY', 'GLM_API_KEY'],
  };
  for (const name of envNames[providerId] ?? []) {
    const v = process.env[name];
    if (v?.trim()) return [v.trim()];
  }
  return [];
}

/** One-call convenience: route model -> provider, resolve key, chat. */
export async function chatWithModel(
  req: LLMRequest,
  requestKeys: ProviderKeys | undefined,
  storedKeys: ProviderKeys | undefined,
): Promise<LLMResponse> {
  const providerId = providerForModel(req.model);
  const provider = getProvider(providerId);
  const keys = resolveKeys(providerId, requestKeys, storedKeys);
  if (!keys.length) throw new MissingKeyError(providerId);
  let lastError: unknown;
  for (const key of keys) {
    try {
      const response = await provider.chat(req, key);
      response.usage.provider = providerId;
      response.usage.model ||= req.model.replace(/^models\//, '');
      return response;
    } catch (error) {
      lastError = error;
      // Only auth failures indicate a rotated/revoked key. Retrying 5xx,
      // throttles, or timeouts could duplicate model work unexpectedly.
      if (!(error instanceof ProviderError) || (error.status !== 401 && error.status !== 403)) throw error;
    }
  }
  throw lastError;
}

export { providerForKnownModel, providerForModel, UnknownModelError } from './types.ts';
export type {
  LLMInputAttachment,
  LLMInputAttachmentKind,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  LLMToolDef,
  LLMUsage,
  ModelInputModality,
  ProviderId,
} from './types.ts';
export { inputModalitiesForModel, unsupportedInputAttachmentKinds } from './types.ts';
