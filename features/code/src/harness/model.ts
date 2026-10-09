/**
 * The selected model, as a binding the harness can run against.
 *
 * Endpoint, wire format, tool policy and key bucket come from the live provider
 * profile through `resolveProviderBinding`, like every other surface — never
 * from the saved model, whose copies go stale (see `platform/ai/AGENTS.md`).
 * The whole key bucket is passed on, so `streamChat` can rotate past a rejected
 * key the way the Settings field promises.
 */

import { apiKeysForBinding, resolveProviderBinding } from '@willow/ai/providers/profiles';
import { collectSavedModelsInCatalogOrder, isChatCapableModel, type ModelProviderId } from '@willow/core/model-catalog';
import type { ModelBinding } from './turn';

const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  moonshot: 'Moonshot AI',
  spacexai: 'xAI',
  zhipuai: 'Zhipu AI',
};

const FALLBACK_GEMINI_MODEL = 'gemini-3.8-flash';

export class MissingApiKeyError extends Error {
  constructor(readonly providerLabel: string) {
    super(`API Key for ${providerLabel} is missing. Please add it in settings.`);
    this.name = 'MissingApiKeyError';
  }
}

export function resolveHarnessModel(modelConfig: any, selectedModelId: string | undefined, apiKeys: unknown): ModelBinding {
  const saved = collectSavedModelsInCatalogOrder(modelConfig);
  const chatModels = saved.filter(isChatCapableModel);
  const baseId = selectedModelId ? selectedModelId.split('::effort-')[0] : '';

  // An image or video model selected elsewhere cannot write code; the first
  // chat model stands in rather than sending a request that cannot succeed.
  const selected =
    chatModels.find((model) => model.id === selectedModelId || model.id === baseId) ??
    chatModels.find((model) => model.providerId === 'gemini') ??
    chatModels[0];

  const provider = (selected?.providerId ?? 'gemini') as ModelProviderId;
  const modelId = String(selected?.modelId ?? modelConfig?.gemini?.model ?? FALLBACK_GEMINI_MODEL);
  const selectedEffort = selected && (selected.id === selectedModelId || selected.id === baseId) && selectedModelId?.includes('::effort-')
    ? Number(selectedModelId.split('::effort-')[1])
    : undefined;
  const thinkingLevel = Number.isFinite(selectedEffort) ? selectedEffort! : (typeof selected?.thinkingLevel === 'number' ? selected.thinkingLevel : 0);

  const binding = resolveProviderBinding(modelConfig, provider, selected ? { profileId: selected.profileId } : undefined);
  const keys = apiKeysForBinding(binding, provider, apiKeys);
  if (!keys[0]) throw new MissingApiKeyError(PROVIDER_LABEL[provider] ?? provider);

  return {
    label: String(selected?.name ?? modelId),
    options: {
      provider,
      model: modelId,
      apiKey: keys[0],
      apiKeyFallbacks: keys.slice(1),
      thinkingLevel,
      // Thought summaries feed the thinking row's heading, as in Chat.
      includeThoughts: thinkingLevel > 0,
      baseUrl: binding.baseUrl,
      apiFormat: binding.apiFormat,
      toolPolicy: binding.toolPolicy,
      profileId: binding.profileId,
      // The harness runs its own tools over text; provider-side search or code
      // execution would produce results this loop has no way to show.
      enableSearch: false,
      enableCodeExecution: false,
      maxToolIterations: 2,
    },
  };
}
