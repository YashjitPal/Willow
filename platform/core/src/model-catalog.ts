export const MODEL_PROVIDER_IDS = [
  'gemini',
  'openai',
  'anthropic',
  'moonshot',
  'spacexai',
  'zhipuai',
] as const;

export type ModelProviderId = typeof MODEL_PROVIDER_IDS[number];
export type ModelCategory = 'text' | 'image' | 'video' | 'audio' | 'embedding';

export interface CatalogModelEntry {
  id: string;
  modelId: string;
  name: string;
  capabilities?: string[];
  thinkingLevel?: number;
  thinkingLabel?: string;
  effortLabel?: string;
  reasoningEfforts?: Array<Record<string, unknown>>;
  providerId: ModelProviderId;
  [key: string]: any;
}

const asSearchText = (model: Partial<CatalogModelEntry> | string): string => {
  if (typeof model === 'string') return model.toLowerCase();
  return `${model.modelId || model.id || ''} ${model.name || ''}`.toLowerCase();
};

export const getModelCategory = (model: Partial<CatalogModelEntry> | string): ModelCategory => {
  const text = asSearchText(model);
  const capabilities = typeof model === 'string' || !Array.isArray(model.capabilities)
    ? []
    : model.capabilities.map((capability) => String(capability).toLowerCase());

  if (capabilities.some((capability) => capability.includes('embedding')) || /\bembed(?:ding|dings)?\b/.test(text)) {
    return 'embedding';
  }
  if (
    capabilities.includes('image') ||
    text.includes('gpt-image') ||
    text.includes('dall-e') ||
    text.includes('imagine') ||
    text.includes('banana') ||
    /(?:^|[-_\s])image(?:$|[-_\s])/.test(text)
  ) {
    return 'image';
  }
  if (
    capabilities.includes('video') ||
    text.includes('veo') ||
    text.includes('sora') ||
    text.includes('omni-flash') ||
    /(?:^|[-_\s])video(?:$|[-_\s])/.test(text)
  ) {
    return 'video';
  }
  if (
    capabilities.includes('audio') ||
    capabilities.includes('transcription') ||
    text.includes('lyria') ||
    text.includes('voice') ||
    text.includes('speech') ||
    text.includes('whisper') ||
    text.includes('realtime') ||
    text.includes('transcribe') ||
    /(?:^|[-_\s])(?:audio|tts|live|transcribe)(?:$|[-_\s])/.test(text)
  ) {
    return 'audio';
  }
  return 'text';
};

export const isChatCapableModel = (model: Partial<CatalogModelEntry> | string): boolean =>
  getModelCategory(model) === 'text';

/**
 * Ids Willow no longer offers, mapped to the id that replaced them: ones the provider shut
 * down, where a request naming them fails, and ones taken out of Settings' catalogue. Saved
 * configs, synced catalog files and old media items still hold them.
 */
export const RETIRED_MODEL_IDS: Readonly<Record<string, string>> = {
  'gemini-3-pro-image-preview': 'gemini-3-pro-image',
  'gemini-3.1-flash-image-preview': 'gemini-nano-banana-2.1',
  // Nano Banana 2, shut down on 2026-10-29 with Nano Banana 2.1 as its replacement.
  'gemini-3.1-flash-image': 'gemini-nano-banana-2.1',
  // Still served, but no longer offered: 3.8 Flash stands in for them.
  'gemini-3.7-flash': 'gemini-3.8-flash',
  'gemini-3.6-flash': 'gemini-3.8-flash',
  'gemini-3.5-flash': 'gemini-3.8-flash',
};

/** The names those were added under, where what replaced them goes by another. */
const RETIRED_MODEL_NAMES: Readonly<Record<string, string>> = {
  'Nano Banana 2': 'Nano Banana 2.1',
  'Gemini 3.7 Flash': 'Gemini 3.8 Flash',
  'Gemini 3.6 Flash': 'Gemini 3.8 Flash',
  'Gemini 3.5 Flash': 'Gemini 3.8 Flash',
};

export const liveModelId = (modelId: string): string => RETIRED_MODEL_IDS[modelId] ?? modelId;

/** A saved model moved onto the id that replaced its own, and its name with it unless the user gave it one. */
export const liveSavedModel = <T extends Record<string, any>>(model: T): T => {
  if (typeof model.modelId !== 'string') return model;
  const modelId = liveModelId(model.modelId);
  if (modelId === model.modelId) return model;
  const name = typeof model.name === 'string' ? RETIRED_MODEL_NAMES[model.name] ?? model.name : model.name;
  return { ...model, modelId, name };
};

const savedModelKey = (model: Record<string, any>): string => `${model.profileId || 'default'}:${model.modelId || model.id}`;

/**
 * Saved models with retired ids rewritten, one record per profile and model: the one already
 * on that id when there is one, which keeps its own thinking level and name, else the first.
 */
export const migrateRetiredSavedModels = <T extends Record<string, any>>(models: T[]): T[] => {
  const live = models.map(liveSavedModel);
  const current = new Set(live.filter((model, index) => model === models[index]).map(savedModelKey));
  const seen = new Set<string>();
  return live.filter((model, index) => {
    const key = savedModelKey(model);
    if (seen.has(key) || (model !== models[index] && current.has(key))) return false;
    seen.add(key);
    return true;
  });
};

/**
 * The selection `selectedId` makes among `after`, the saved models `migrateRetiredSavedModels`
 * made of `before`: a record it dropped hands the selection to the one its model is kept under.
 * An `::effort-N` suffix stays.
 */
export const migrateSelectedModelId = (
  selectedId: string,
  before: ReadonlyArray<Record<string, any>>,
  after: ReadonlyArray<Record<string, any>>,
): string => {
  const baseId = selectedId.split('::effort-')[0];
  if (!baseId || after.some((model) => model.id === baseId)) return selectedId;
  const was = before.find((model) => model.id === baseId);
  if (!was || typeof was.modelId !== 'string') return selectedId;
  const key = savedModelKey({ ...was, modelId: liveModelId(was.modelId) });
  const kept = after.find((model) => model.providerId === was.providerId && savedModelKey(model) === key);
  return kept ? `${kept.id}${selectedId.slice(baseId.length)}` : selectedId;
};

export const getModelCatalogKey = (
  model: Pick<CatalogModelEntry, 'id' | 'modelId' | 'providerId'>,
): string => `${model.providerId}:${model.id || model.modelId || ''}`;

export const collectSavedModelsInCatalogOrder = (modelConfig: any): CatalogModelEntry[] => {
  const entries = MODEL_PROVIDER_IDS.flatMap((providerId) => {
    const savedModels = Array.isArray(modelConfig?.[providerId]?.savedModels)
      ? modelConfig[providerId].savedModels
      : [];
    return savedModels
      .filter((model: unknown): model is Record<string, unknown> => Boolean(model && typeof model === 'object'))
      .map((model: Record<string, unknown>) => ({ ...model, providerId } as CatalogModelEntry));
  });
  const order = Array.isArray(modelConfig?.modelOrder)
    ? modelConfig.modelOrder.filter((key: unknown): key is string => typeof key === 'string')
    : [];
  const orderIndex = new Map<string, number>(order.map((key: string, index: number) => [key, index] as const));

  return entries
    .map((model, sourceIndex) => ({ model, sourceIndex }))
    .sort((left, right) => {
      const leftIndex = orderIndex.get(getModelCatalogKey(left.model));
      const rightIndex = orderIndex.get(getModelCatalogKey(right.model));
      if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
      if (leftIndex !== undefined) return -1;
      if (rightIndex !== undefined) return 1;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ model }) => model);
};

export const getNormalizedModelOrder = (modelConfig: any): string[] =>
  collectSavedModelsInCatalogOrder(modelConfig).map(getModelCatalogKey);
