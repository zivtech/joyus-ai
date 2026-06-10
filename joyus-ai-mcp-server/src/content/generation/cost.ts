export interface GenerationOperationMetadata {
  citationCount: number;
  sourcesUsed: number;
  profileId: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  estimatedCostUsd?: number;
  cacheHitRate?: number;
  model?: string;
  tokensAvailable?: boolean;
  pricingAvailable?: boolean;
  pricingVersion?: string;
}

export interface ModelPricing {
  inputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
  outputPerMTok: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': {
    inputPerMTok: 3.0,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.3,
    outputPerMTok: 15.0,
  },
  'claude-opus-4-6': {
    inputPerMTok: 5.0,
    cacheWritePerMTok: 6.25,
    cacheReadPerMTok: 0.5,
    outputPerMTok: 25.0,
  },
  // claude-opus-4-7 rates assumed identical to the opus-4-6 tier pending
  // confirmed published pricing; revisit alongside PRICING_VERSION if rates differ.
  'claude-opus-4-7': {
    inputPerMTok: 5.0,
    cacheWritePerMTok: 6.25,
    cacheReadPerMTok: 0.5,
    outputPerMTok: 25.0,
  },
  'claude-haiku-4-5': {
    inputPerMTok: 1.0,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
    outputPerMTok: 5.0,
  },
};

export const PRICING_VERSION = '2026-04-14';

export interface GenerationTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface AnthropicUsageShape {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

const USD_SCALE = 1_000_000;

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  // Math.trunc is deliberate: token counts are whole units, so fractional
  // provider values are floored toward zero rather than rounded.
  return Math.trunc(value);
}

function hasNumericField(source: Record<string, unknown>, field: string): boolean {
  return typeof source[field] === 'number' && Number.isFinite(source[field]);
}

export function normalizeAnthropicUsage(
  usage: AnthropicUsageShape | null | undefined
): GenerationTokenUsage | null {
  if (!usage) return null;

  const source = usage as Record<string, unknown>;
  const hasUsage = [
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
  ].some(field => hasNumericField(source, field));

  if (!hasUsage) return null;

  return {
    inputTokens: nonNegativeInteger(usage.input_tokens),
    outputTokens: nonNegativeInteger(usage.output_tokens),
    cacheWriteTokens: nonNegativeInteger(usage.cache_creation_input_tokens),
    cacheReadTokens: nonNegativeInteger(usage.cache_read_input_tokens),
  };
}

export function resolveModelPricing(model: string | null | undefined): ModelPricing | null {
  if (!model) return null;
  if (PRICING[model]) return PRICING[model];

  const modelFamily = Object.keys(PRICING).find(key => model.startsWith(`${key}-`));
  return modelFamily ? PRICING[modelFamily] : null;
}

export function estimateGenerationCostMicroUsd(
  usage: GenerationTokenUsage,
  pricing: ModelPricing
): number {
  return Math.round(
    usage.inputTokens * pricing.inputPerMTok +
      usage.outputTokens * pricing.outputPerMTok +
      usage.cacheWriteTokens * pricing.cacheWritePerMTok +
      usage.cacheReadTokens * pricing.cacheReadPerMTok
  );
}

export function formatCostUsd(microUsd: number): string {
  return (microUsd / USD_SCALE).toFixed(6);
}

export function costUsdNumber(microUsd: number): number {
  return Number(formatCostUsd(microUsd));
}

/**
 * Resolved cost for a single generation. Computed once per generation so the
 * operation-log metadata and the session-accumulator update share an identical
 * figure and cannot diverge. `microUsd` is null when the model has no pricing.
 */
export interface ResolvedGenerationCost {
  pricing: ModelPricing | null;
  microUsd: number | null;
}

export function resolveGenerationCost(
  model: string | null | undefined,
  usage: GenerationTokenUsage | null | undefined
): ResolvedGenerationCost {
  const pricing = resolveModelPricing(model);
  if (!pricing || !usage) {
    return { pricing, microUsd: null };
  }
  return { pricing, microUsd: estimateGenerationCostMicroUsd(usage, pricing) };
}

export function buildGenerationCostMetadata(
  model: string | null | undefined,
  usage: GenerationTokenUsage | null | undefined,
  cost?: ResolvedGenerationCost
): Partial<GenerationOperationMetadata> | null {
  if (!usage) return null;

  // cacheHitRate denominator = inputTokens + cacheWriteTokens + cacheReadTokens.
  // Anthropic's input_tokens already excludes cached tokens, so cache reads/writes
  // are additive here with no double-count.
  const promptTokenTotal = usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
  const resolved = cost ?? resolveGenerationCost(model, usage);
  const pricing = resolved.pricing;
  const metadata: Partial<GenerationOperationMetadata> = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    tokensAvailable: true,
    pricingAvailable: pricing !== null,
    ...(model ? { model } : {}),
    ...(promptTokenTotal > 0 ? { cacheHitRate: usage.cacheReadTokens / promptTokenTotal } : {}),
  };

  if (resolved.microUsd === null) return metadata;

  return {
    ...metadata,
    estimatedCostUsd: costUsdNumber(resolved.microUsd),
    pricingVersion: PRICING_VERSION,
  };
}

const parsedTtl = parseInt(process.env.JOYUS_CACHE_TTL_SECONDS ?? '', 10);
export const CACHE_TTL_SECONDS: number =
  Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 300;
