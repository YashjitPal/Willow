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
    text.includes('lyria') ||
    text.includes('voice') ||
    text.includes('speech') ||
    text.includes('whisper') ||
    text.includes('realtime') ||
    /(?:^|[-_\s])(?:audio|tts|live)(?:$|[-_\s])/.test(text)
  ) {
    return 'audio';
  }
  return 'text';
};

export const isChatCapableModel = (model: Partial<CatalogModelEntry> | string): boolean =>
  getModelCategory(model) === 'text';

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
