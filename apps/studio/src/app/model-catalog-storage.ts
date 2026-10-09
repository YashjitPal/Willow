import { MODEL_PROVIDER_IDS, migrateRetiredSavedModels, type ModelProviderId } from '@willow/core/model-catalog';

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
      savedModels: migrateRetiredSavedModels(snapshot.savedModels[provider]).map((model) => ({ ...model })),
    };
  }
  return next;
};

/**
 * `modelConfig` carrying `snapshot`'s catalog, or `modelConfig` itself when it
 * already does, so that a write which left the catalog alone renders nothing.
 */
export const adoptModelCatalogSnapshot = (modelConfig: any, snapshot: ModelCatalogSnapshot): any => {
  const next = mergeModelCatalogSnapshot(modelConfig, snapshot);
  const unchanged = JSON.stringify(extractModelCatalogSnapshot(next))
    === JSON.stringify(extractModelCatalogSnapshot(modelConfig));
  return unchanged ? modelConfig : next;
};

/**
 * Follows the catalog other tabs write.
 *
 * Every tab stores its whole `modelConfig` under one key, but only the catalog is
 * shared: the model picked in each provider's menu, thinking levels and system
 * defaults stay the tab's own. So a config taken from another tab must never be
 * written back. It differs from what that tab wrote, the write reads there as a
 * fresh change, and the two tabs trade writes for as long as both are open, with
 * an added model flickering in and out of both while they do.
 */
export const createTabCatalogSync = () => {
  const fromOtherTabs = new WeakSet<object>();
  return {
    /**
     * `current` carrying the catalog in `stored`, or `current` itself when that
     * changes nothing or `stored` does not parse.
     *
     * Pass what is stored now, not the event's `newValue`: a later write may
     * already have replaced it, and adopting it would roll this tab back to a
     * catalog that is no longer stored.
     */
    adoptStored(current: any, stored: string | null): any {
      if (!stored) return current;
      let snapshot: ModelCatalogSnapshot;
      try {
        snapshot = extractModelCatalogSnapshot(JSON.parse(stored));
      } catch {
        return current;
      }
      const next = adoptModelCatalogSnapshot(current, snapshot);
      if (next !== current) fromOtherTabs.add(next);
      return next;
    },
    /** Whether `modelConfig` was taken from another tab's write, so is already stored. */
    isFromOtherTab: (modelConfig: any): boolean => fromOtherTabs.has(modelConfig),
  };
};
