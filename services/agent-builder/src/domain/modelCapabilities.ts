export type ModelLimitsSource = 'provider' | 'pinned' | 'unknown';

export interface ModelTokenLimits {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  limitsSource: ModelLimitsSource;
  limitsCatalogVersion?: string;
}

export const MODEL_LIMITS_CATALOG_VERSION = '2026-07-18.1';

// Only exact ids with limits controlled by this repository belong here.
// Provider model limits are returned dynamically when their model API exposes
// them; otherwise they remain explicitly unknown rather than being guessed.
const PINNED_EXACT_LIMITS: Record<string, Omit<ModelTokenLimits, 'limitsSource' | 'limitsCatalogVersion'>> = {
  'mock/echo': { contextWindowTokens: 10_000_000, maxOutputTokens: 1_000_000 },
  'mock/upper': { contextWindowTokens: 10_000_000, maxOutputTokens: 1_000_000 },
  'mock/json': { contextWindowTokens: 10_000_000, maxOutputTokens: 1_000_000 },
  'mock/script': { contextWindowTokens: 10_000_000, maxOutputTokens: 1_000_000 },
};

export function pinnedModelTokenLimits(model: string): ModelTokenLimits {
  const limits = PINNED_EXACT_LIMITS[model.toLowerCase().replace(/^models\//, '')];
  return limits
    ? { ...limits, limitsSource: 'pinned', limitsCatalogVersion: MODEL_LIMITS_CATALOG_VERSION }
    : { limitsSource: 'unknown' };
}
