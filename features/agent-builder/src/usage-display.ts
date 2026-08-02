type UsageRecord = Record<string, unknown>;

export interface UsageCostDisplay {
  value: string;
  detail?: string;
  status: 'priced' | 'partial' | 'unpriced';
}

export interface UsageDetailItem {
  label: string;
  value: number;
}

export interface UsageModelBreakdown {
  key: string;
  model: string;
  provider?: string;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
  estimatedCostUsd?: number;
  pricingStatus?: 'priced' | 'unpriced' | 'partial' | string;
}

export interface UsageEmbeddingBreakdown {
  key: string;
  model: string;
  provider?: string;
  operations: number;
  inputTokens: number;
  unreportedTokenOperations: number;
  estimatedCostUsd?: number;
  pricingStatus?: 'priced' | 'unpriced' | string;
}

function record(value: unknown): UsageRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UsageRecord : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function formatUsd(value: number): string {
  const digits = value === 0 ? 2 : value >= 0.01 ? 4 : 6;
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  })}`;
}

/** Reads normalized and older nested cost shapes without inventing a zero cost. */
export function getUsageCostDisplay(usage: unknown): UsageCostDisplay | null {
  const root = record(usage);
  if (!root) return null;
  const cost = record(root.cost);
  const estimate = record(root.estimatedCost);
  const estimatedUsd = firstNumber(root.estimatedCostUsd, cost?.estimatedUsd, cost?.usd, estimate?.usd);
  const unpricedByModel = Object.values(record(root.byModel) ?? {}).reduce<number>((total, value) => {
    const bucket = record(value);
    const pricing = record(bucket?.pricing);
    return total + (pricing?.status === 'unpriced' ? (finiteNumber(bucket?.llmCalls) ?? 0) : 0);
  }, 0);
  const unpricedCalls = firstNumber(root.unpricedLlmCalls, root.unpricedModelCalls, cost?.unpricedLlmCalls, cost?.unpricedModelCalls) ?? unpricedByModel;
  const unpricedEmbeddings = firstNumber(root.unpricedEmbeddingOperations, cost?.unpricedEmbeddingOperations) ?? 0;
  const unpricedOperations = unpricedCalls + unpricedEmbeddings;
  const byModel = record(root.byModel);
  const pricedCalls = Object.values(byModel ?? {}).reduce<number>((total, value) => {
    const bucket = record(value);
    const pricing = record(bucket?.pricing);
    return total + (pricing?.status === 'priced' ? (finiteNumber(bucket?.llmCalls) ?? 0) : 0);
  }, 0);
  const rawStatus = String(root.pricingStatus ?? cost?.status ?? '').toLowerCase();
  const explicitlyUnpriced = rawStatus === 'unpriced';
  const partial = rawStatus === 'partial' || rawStatus === 'partially_priced' || unpricedOperations > 0;

  if (unpricedOperations > 0 && pricedCalls === 0 && byModel) {
    return {
      value: 'Unpriced',
      detail: formatUnpricedDetail(unpricedCalls, unpricedEmbeddings),
      status: 'unpriced',
    };
  }

  if (estimatedUsd === undefined) {
    if (!explicitlyUnpriced && !partial) return null;
    return {
      value: 'Unpriced',
      detail: unpricedOperations > 0
        ? formatUnpricedDetail(unpricedCalls, unpricedEmbeddings)
        : 'Pricing unavailable for one or more models',
      status: 'unpriced',
    };
  }

  return {
    value: `${partial ? 'At least ' : ''}${formatUsd(estimatedUsd)}`,
    detail: partial
      ? `${formatUnpricedDetail(unpricedCalls, unpricedEmbeddings)} not included in this estimate`
      : undefined,
    status: partial ? 'partial' : 'priced',
  };
}

function formatUnpricedDetail(modelCalls: number, embeddingOperations: number): string {
  const parts: string[] = [];
  if (modelCalls > 0) parts.push(`${modelCalls.toLocaleString()} model ${modelCalls === 1 ? 'call' : 'calls'}`);
  if (embeddingOperations > 0) parts.push(`${embeddingOperations.toLocaleString()} embedding ${embeddingOperations === 1 ? 'operation' : 'operations'}`);
  return `${parts.join(' and ')} without pricing`;
}

/** Optional token categories supplied by normalized provider usage. */
export function getUsageDetailItems(usage: unknown): UsageDetailItem[] {
  const root = record(usage);
  if (!root) return [];
  const details = record(root.tokenDetails) ?? record(root.details);
  const byModel = record(root.byModel);
  const bucketTotal = (field: string): number | undefined => {
    if (!byModel) return undefined;
    return Object.values(byModel).reduce<number>((total, value) => total + (finiteNumber(record(value)?.[field]) ?? 0), 0);
  };
  const items: Array<[string, number | undefined]> = [
    ['Cached input', firstNumber(root.cachedInputTokens, details?.cachedInputTokens, details?.cachedTokens, bucketTotal('cachedInputTokens'))],
    ['Cache write', firstNumber(root.cacheWriteInputTokens, root.cacheWriteTokens, details?.cacheWriteInputTokens, details?.cacheWriteTokens, bucketTotal('cacheWriteInputTokens'))],
    ['Reasoning', firstNumber(root.reasoningTokens, details?.reasoningTokens, bucketTotal('reasoningTokens'))],
    ['Embedding input', firstNumber(root.embeddingInputTokens, root.embeddingTokens, details?.embeddingInputTokens, details?.embeddingTokens)],
    ['Embedding searches', firstNumber(root.embeddingOperations, details?.embeddingOperations)],
  ];
  return items
    .filter((item): item is [string, number] => item[1] !== undefined && item[1] > 0)
    .map(([label, value]) => ({ label, value }));
}

/** Per-model accounting for file-search embedding work. */
export function getUsageEmbeddingBreakdown(usage: unknown): UsageEmbeddingBreakdown[] {
  const root = record(usage);
  const byEmbeddingModel = record(root?.byEmbeddingModel);
  if (!byEmbeddingModel) return [];
  return Object.entries(byEmbeddingModel)
    .map(([key, value]) => {
      const bucket = record(value) ?? {};
      const pricing = record(bucket.pricing);
      return {
        key,
        model: typeof bucket.model === 'string' && bucket.model ? bucket.model : key,
        provider: typeof bucket.provider === 'string' ? bucket.provider : undefined,
        operations: finiteNumber(bucket.operations) ?? 0,
        inputTokens: finiteNumber(bucket.inputTokens) ?? 0,
        unreportedTokenOperations: finiteNumber(bucket.unreportedTokenOperations) ?? 0,
        estimatedCostUsd: firstNumber(bucket.estimatedCostUsd, pricing?.estimatedCostUsd),
        pricingStatus: typeof pricing?.status === 'string' ? pricing.status : undefined,
      } satisfies UsageEmbeddingBreakdown;
    })
    .filter((bucket) => bucket.operations > 0 || bucket.inputTokens > 0)
    .sort((a, b) => b.operations - a.operations || b.inputTokens - a.inputTokens);
}

/** Returns auditable per-model accounting when a rich usage payload is available. */
export function getUsageModelBreakdown(usage: unknown): UsageModelBreakdown[] {
  const root = record(usage);
  const byModel = record(root?.byModel);
  if (!byModel) return [];
  return Object.entries(byModel)
    .map(([key, value]) => {
      const bucket = record(value) ?? {};
      const pricing = record(bucket.pricing);
      return {
        key,
        model: typeof bucket.model === 'string' && bucket.model ? bucket.model : key,
        provider: typeof bucket.provider === 'string' ? bucket.provider : undefined,
        llmCalls: finiteNumber(bucket.llmCalls) ?? 0,
        inputTokens: finiteNumber(bucket.inputTokens) ?? 0,
        outputTokens: finiteNumber(bucket.outputTokens) ?? 0,
        cachedInputTokens: finiteNumber(bucket.cachedInputTokens) ?? 0,
        cacheWriteInputTokens: finiteNumber(bucket.cacheWriteInputTokens) ?? 0,
        reasoningTokens: finiteNumber(bucket.reasoningTokens) ?? 0,
        estimatedCostUsd: firstNumber(bucket.estimatedCostUsd, pricing?.estimatedCostUsd),
        pricingStatus: typeof pricing?.status === 'string' ? pricing.status : undefined,
      } satisfies UsageModelBreakdown;
    })
    .filter((bucket) => bucket.llmCalls > 0 || bucket.inputTokens > 0 || bucket.outputTokens > 0)
    .sort((a, b) => b.llmCalls - a.llmCalls || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
}

/** Explicit count of model calls that could not be priced, when available. */
export function getUsageUnpricedCallCount(usage: unknown): number {
  const root = record(usage);
  if (!root) return 0;
  const explicit = firstNumber(root.unpricedLlmCalls, root.unpricedModelCalls, record(root.cost)?.unpricedLlmCalls, record(root.cost)?.unpricedModelCalls);
  if (explicit !== undefined) return explicit;
  return getUsageModelBreakdown(usage)
    .filter((bucket) => bucket.pricingStatus === 'unpriced')
    .reduce((total, bucket) => total + bucket.llmCalls, 0);
}
