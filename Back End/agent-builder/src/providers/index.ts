/**
 * Provider registry + key resolution.
 */

import type { ProviderKeys } from '../domain/types.ts';
import { anthropicProvider } from './anthropic.ts';
import { geminiProvider } from './gemini.ts';
import { mockProvider } from './mock.ts';
import { openaiProvider } from './openai.ts';
import { providerForModel, type LLMProvider, type LLMRequest, type LLMResponse } from './types.ts';

const REGISTRY: Record<string, LLMProvider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
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
  providerId: 'gemini' | 'openai' | 'anthropic' | 'mock',
  requestKeys: ProviderKeys | undefined,
  storedKeys: ProviderKeys | undefined,
): string {
  if (providerId === 'mock') return 'mock';
  const fromReq = requestKeys?.[providerId]?.[0];
  if (fromReq) return fromReq;
  const fromStore = storedKeys?.[providerId]?.[0];
  if (fromStore) return fromStore;
  const envNames: Record<string, string[]> = {
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
  };
  for (const name of envNames[providerId] ?? []) {
    const v = process.env[name];
    if (v) return v;
  }
  throw new MissingKeyError(providerId);
}

/** One-call convenience: route model -> provider, resolve key, chat. */
export async function chatWithModel(
  req: LLMRequest,
  requestKeys: ProviderKeys | undefined,
  storedKeys: ProviderKeys | undefined,
): Promise<LLMResponse> {
  const providerId = providerForModel(req.model);
  const provider = getProvider(providerId);
  const key = resolveKey(providerId, requestKeys, storedKeys);
  return provider.chat(req, key);
}

export { providerForModel } from './types.ts';
export type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  LLMToolDef,
  LLMUsage,
} from './types.ts';
