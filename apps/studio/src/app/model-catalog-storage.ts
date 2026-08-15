import { MODEL_PROVIDER_IDS, type ModelProviderId } from '@willow/core/model-catalog';

export const MODEL_CONFIG_STORAGE_KEY = 'modelConfig';
export const MODEL_CATALOG_UPDATED_EVENT = 'willow_model_catalog_updated';

export interface ModelCatalogSnapshot {
  version: 1;
  savedModels: Record<ModelProviderId, Array<Record<string, unknown>>>;
  modelOrder: string[];
}

const emptySavedModels = (): ModelCatalogSnapshot['savedModels'] => ({
  gemini: [],
  openai: [],
  anthropic: [],
  moonshot: [],
  spacexai: [],
  zhipuai: [],
});

const narrowSavedModels = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.filter((model): model is Record<string, unknown> => {
    if (!model || typeof model !== 'object') return false;
    const candidate = model as Record<string, unknown>;
    return typeof candidate.id === 'string' && typeof candidate.modelId === 'string' && typeof candidate.name === 'string';
  });
};

export const extractModelCatalogSnapshot = (modelConfig: any): ModelCatalogSnapshot => {
  const savedModels = emptySavedModels();
  for (const provider of MODEL_PROVIDER_IDS) {
    savedModels[provider] = narrowSavedModels(modelConfig?.[provider]?.savedModels);
  }
  return {
    version: 1,
    savedModels,
    modelOrder: Array.isArray(modelConfig?.modelOrder)
      ? modelConfig.modelOrder.filter((key: unknown): key is string => typeof key === 'string')
      : [],
  };
};

export const parseModelCatalogSnapshot = (contents: string): ModelCatalogSnapshot | null => {
  try {
    const raw = JSON.parse(contents) as Partial<ModelCatalogSnapshot>;
    if (!raw || typeof raw !== 'object' || !raw.savedModels || typeof raw.savedModels !== 'object') return null;
    return extractModelCatalogSnapshot({
      ...Object.fromEntries(MODEL_PROVIDER_IDS.map((provider) => [provider, {
        savedModels: narrowSavedModels(raw.savedModels?.[provider]),
      }])),
      modelOrder: raw.modelOrder,
    });
  } catch {
    return null;
  }
};

export const mergeModelCatalogSnapshot = (modelConfig: any, snapshot: ModelCatalogSnapshot): any => {
  const next = { ...modelConfig, modelOrder: [...snapshot.modelOrder] };
  for (const provider of MODEL_PROVIDER_IDS) {
    next[provider] = {
      ...(modelConfig?.[provider] || {}),
      savedModels: snapshot.savedModels[provider].map((model) => ({ ...model })),
    };
  }
  return next;
};
