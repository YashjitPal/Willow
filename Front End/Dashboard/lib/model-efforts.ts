export interface ModelEffortRecord {
  id: string;
  name: string;
  modelId?: string;
  provider?: string;
  thinkingLevel?: number;
  thinkingLabel?: string;
  effortLabel?: string;
  [key: string]: unknown;
}

export const getModelGroupKey = (model: ModelEffortRecord) =>
  `${model.provider || 'AI'}::${model.modelId || model.name}`;

export const sortModelEfforts = <T extends ModelEffortRecord>(models: T[]) =>
  [...models].sort((a, b) => Number(a.thinkingLevel || 0) - Number(b.thinkingLevel || 0));

const GENERIC_EFFORT_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Extra High',
  5: 'Max',
  6: 'Pro',
};

export const getThinkingEffortLabel = (model: ModelEffortRecord) => {
  const level = Number(model.thinkingLevel || 0);
  const provider = String(model.provider || '').toLowerCase();
  const modelId = String(model.modelId || model.name || '').toLowerCase();

  // These fallbacks cover saved presets created before exact labels were persisted.
  if (modelId.includes('gemini-2.5-flash-lite')) {
    return ({ 0: 'None', 1: '8k Tokens', 2: '16k Tokens', 3: '24k Tokens' } as Record<number, string>)[level]
      || `Level ${level}`;
  }
  if (modelId.includes('kimi-k2.7-code')) {
    return ({ 0: 'None', 1: 'Fast', 2: 'Deep' } as Record<number, string>)[level]
      || `Level ${level}`;
  }
  if (provider.includes('openai') || modelId.includes('gpt')) {
    if (level === 4) return 'Extra High';
    if (level === 5) return 'Max';
    if (level === 6) return 'Pro';
  }

  return GENERIC_EFFORT_LABELS[level] || `Level ${level}`;
};
