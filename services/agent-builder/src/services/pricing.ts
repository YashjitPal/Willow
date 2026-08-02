import type { EmbeddingPricingSnapshot, ModelPricingSnapshot } from '../domain/types.ts';
import type { LLMUsage } from '../providers/types.ts';

export const PRICING_CATALOG_VERSION = '2026-07-16.1';

interface ModelRate {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  cacheWriteInputUsdPerMillion?: number;
}

// Pricing changes independently from application code. Keep entries exact and
// versioned; an unknown model is explicitly unpriced instead of silently $0.
const EXACT_RATES: Record<string, ModelRate> = {
  'mock/echo': { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
  'mock/upper': { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
  'mock/json': { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
  'mock/script': { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
};

function roundUsd(value: number): number {
  return Number(value.toFixed(12));
}

export function priceModelUsage(usage: LLMUsage): ModelPricingSnapshot {
  if (usage.tokenStatus === 'not_reported') {
    return { status: 'unpriced', catalogVersion: PRICING_CATALOG_VERSION, currency: 'USD' };
  }
  const model = (usage.model ?? '').toLowerCase().replace(/^models\//, '');
  const rate = EXACT_RATES[model] ?? (model.startsWith('mock/tool:')
    ? { inputUsdPerMillion: 0, outputUsdPerMillion: 0 }
    : undefined);
  if (!rate) {
    return { status: 'unpriced', catalogVersion: PRICING_CATALOG_VERSION, currency: 'USD' };
  }

  const cached = Math.min(usage.inputTokens, Math.max(0, usage.cachedInputTokens ?? 0));
  const cacheWrite = Math.min(
    Math.max(0, usage.inputTokens - cached),
    Math.max(0, usage.cacheWriteInputTokens ?? 0),
  );
  const uncached = Math.max(0, usage.inputTokens - cached - cacheWrite);
  const estimatedCostUsd = (
    uncached * rate.inputUsdPerMillion
    + cached * (rate.cachedInputUsdPerMillion ?? rate.inputUsdPerMillion)
    + cacheWrite * (rate.cacheWriteInputUsdPerMillion ?? rate.inputUsdPerMillion)
    + Math.max(0, usage.outputTokens) * rate.outputUsdPerMillion
  ) / 1_000_000;

  return {
    status: 'priced',
    catalogVersion: PRICING_CATALOG_VERSION,
    currency: 'USD',
    inputUsdPerMillion: rate.inputUsdPerMillion,
    outputUsdPerMillion: rate.outputUsdPerMillion,
    ...(rate.cachedInputUsdPerMillion !== undefined ? { cachedInputUsdPerMillion: rate.cachedInputUsdPerMillion } : {}),
    ...(rate.cacheWriteInputUsdPerMillion !== undefined ? { cacheWriteInputUsdPerMillion: rate.cacheWriteInputUsdPerMillion } : {}),
    estimatedCostUsd: roundUsd(estimatedCostUsd),
  };
}

export function priceEmbeddingUsage(model: string, inputTokens?: number): EmbeddingPricingSnapshot {
  const normalized = model.toLowerCase().replace(/^models\//, '');
  const inputUsdPerMillion = normalized === 'text-embedding-3-small' ? 0.02 : undefined;
  if (inputTokens === undefined || inputUsdPerMillion === undefined) {
    return { status: 'unpriced', catalogVersion: PRICING_CATALOG_VERSION, currency: 'USD' };
  }
  return {
    status: 'priced',
    catalogVersion: PRICING_CATALOG_VERSION,
    currency: 'USD',
    inputUsdPerMillion,
    estimatedCostUsd: roundUsd((inputTokens * inputUsdPerMillion) / 1_000_000),
  };
}
