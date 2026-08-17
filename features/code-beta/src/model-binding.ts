/**
 * Turning Willow's saved model config into a harness `ModelBinding`.
 *
 * `features/code` inlines this resolution at each of its call sites, which is
 * why the same six-provider spread appears there several times over. Code Beta
 * resolves it once, here, so the harness receives a single well-formed object
 * and never sees provider plumbing.
 */

import {
  collectSavedModelsInCatalogOrder,
  isChatCapableModel,
  type ModelProviderId,
} from '@willow/core/model-catalog';
import type { ModelBinding } from './harness/runtime/agent';
import { levelToEffort, resolveEffort, type CodexEffort } from './harness/overlay/effort';

/**
 * Keys as `@willow/auth` holds them.
 *
 * Typed against the provider union rather than `Record<string, …>` so it
 * accepts the shell's `ApiKeys` interface directly — a plain string index
 * signature would not, since interfaces do not gain one implicitly.
 */
export type ProviderKeys = Partial<Record<ModelProviderId, string[]>>;

export interface ResolvedModel {
  /** Stable id used by the picker and persisted as the selection. */
  id: string;
  /** Display name. */
  name: string;
  /** Provider label, e.g. "Google". */
  providerLabel: string;
  providerId: string;
  modelId: string;
  thinkingLevel?: number;
  baseUrl?: string;
  apiFormat?: string;
  toolPolicy?: unknown;
  profileId?: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  moonshot: 'Moonshot AI',
  spacexai: 'SpaceXAI',
  zhipuai: 'Zhipu AI',
};

/** Every chat-capable saved model, in catalog order. */
export function listModels(modelConfig: unknown): ResolvedModel[] {
  return collectSavedModelsInCatalogOrder(modelConfig)
    .filter(isChatCapableModel)
    .map((entry) => ({
      id: String(entry.id ?? entry.modelId ?? ''),
      name: String(entry.name ?? entry.modelId ?? 'Model'),
      providerId: entry.providerId,
      providerLabel: PROVIDER_LABEL[entry.providerId] ?? entry.providerId,
      modelId: String(entry.modelId ?? entry.id ?? ''),
      thinkingLevel: typeof entry.thinkingLevel === 'number' ? entry.thinkingLevel : undefined,
      baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : undefined,
      apiFormat: typeof entry.apiFormat === 'string' ? entry.apiFormat : undefined,
      toolPolicy: entry.toolPolicy,
      profileId: typeof entry.profileId === 'string' ? entry.profileId : undefined,
    }))
    .filter((model) => model.id !== '');
}

export class MissingApiKeyError extends Error {
  constructor(readonly providerLabel: string) {
    super(
      `No API key for ${providerLabel}. Add one in Settings → Models before running Code Beta.`,
    );
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Builds the binding the harness runs against.
 *
 * Throws `MissingApiKeyError` rather than returning a partial binding: a turn
 * that starts without a key fails deep inside the provider adapter with a
 * message the user cannot act on.
 */
export function resolveBinding(
  modelConfig: unknown,
  selectedModelId: string | undefined,
  apiKeys: ProviderKeys,
  /** Codex-ladder effort. Defaults to the model's own saved level. */
  effort?: CodexEffort,
): ModelBinding {
  const models = listModels(modelConfig);
  const selected =
    models.find((model) => model.id === selectedModelId) ??
    models.find((model) => model.providerId === 'gemini') ??
    models[0];

  if (!selected) {
    throw new Error(
      'No models are configured. Add one in Settings → Models before running Code Beta.',
    );
  }

  const apiKey = apiKeys[selected.providerId as ModelProviderId]?.[0];
  if (!apiKey) throw new MissingApiKeyError(selected.providerLabel);

  const config = modelConfig as Record<string, { baseUrl?: string }> | undefined;

  // Effort travels on Codex's ladder, then clamps to what the model actually
  // accepts. Sending a level the provider silently lowers would leave the UI
  // claiming an effort that never took effect.
  const requested = effort ?? levelToEffort(selected.thinkingLevel);
  const resolved = resolveEffort(requested, selected);

  return {
    label: selected.name,
    effort: resolved,
    options: {
      provider: selected.providerId as never,
      model: selected.modelId,
      apiKey,
      thinkingLevel: resolved.level,
      baseUrl: selected.baseUrl ?? config?.[selected.providerId]?.baseUrl,
      apiFormat: selected.apiFormat as never,
      toolPolicy: selected.toolPolicy as never,
      profileId: selected.profileId,
      // The harness runs its own loop, so provider-side iteration must not also
      // fire — two loops would double every tool call.
      maxToolIterations: 1,
    },
  };
}
