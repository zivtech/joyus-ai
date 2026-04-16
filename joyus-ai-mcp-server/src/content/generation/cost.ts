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
  'claude-haiku-4-5': {
    inputPerMTok: 1.0,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
    outputPerMTok: 5.0,
  },
};

export const PRICING_VERSION = '2026-04-14';

const parsedTtl = parseInt(process.env.JOYUS_CACHE_TTL_SECONDS ?? '', 10);
export const CACHE_TTL_SECONDS: number =
  Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 300;
