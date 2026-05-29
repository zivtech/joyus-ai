import { describe, expect, it } from 'vitest';

import {
  buildGenerationCostMetadata,
  estimateGenerationCostMicroUsd,
  normalizeAnthropicUsage,
  PRICING,
  resolveModelPricing,
} from '../cost.js';

describe('generation cost helpers', () => {
  it('calculates Sonnet input and output token costs', () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    };

    expect(estimateGenerationCostMicroUsd(usage, PRICING['claude-sonnet-4-6'])).toBe(10_500);
    expect(buildGenerationCostMetadata('claude-sonnet-4-6', usage)).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedCostUsd: 0.0105,
      pricingAvailable: true,
      pricingVersion: '2026-04-14',
    });
  });

  it('includes cache write and cache read token costs', () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheWriteTokens: 100,
      cacheReadTokens: 50,
    };

    expect(buildGenerationCostMetadata('claude-sonnet-4-6', usage)).toMatchObject({
      cacheWriteTokens: 100,
      cacheReadTokens: 50,
      estimatedCostUsd: 0.01089,
      pricingAvailable: true,
    });
  });

  it('matches dated provider model names to a configured model family', () => {
    expect(resolveModelPricing('claude-sonnet-4-6-20260501')).toBe(PRICING['claude-sonnet-4-6']);
  });

  it('prices claude-opus-4-7 at the opus tier', () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    };

    expect(resolveModelPricing('claude-opus-4-7')).toBe(PRICING['claude-opus-4-7']);
    // 1000 * 5.0 + 500 * 25.0 = 17_500 microUSD
    expect(estimateGenerationCostMicroUsd(usage, PRICING['claude-opus-4-7'])).toBe(17_500);
    expect(buildGenerationCostMetadata('claude-opus-4-7', usage)).toMatchObject({
      estimatedCostUsd: 0.0175,
      pricingAvailable: true,
      pricingVersion: '2026-04-14',
    });
  });

  it('preserves token metadata without estimating cost for unpriced models', () => {
    const metadata = buildGenerationCostMetadata('model-without-price', {
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });

    expect(metadata).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      tokensAvailable: true,
      pricingAvailable: false,
      model: 'model-without-price',
    });
    expect(metadata).not.toHaveProperty('estimatedCostUsd');
  });

  it('returns no token metadata when provider usage is absent', () => {
    expect(normalizeAnthropicUsage(undefined)).toBeNull();
    expect(normalizeAnthropicUsage({})).toBeNull();
    expect(buildGenerationCostMetadata('claude-sonnet-4-6', null)).toBeNull();
  });

  it('normalizes Anthropic usage fields', () => {
    expect(
      normalizeAnthropicUsage({
        input_tokens: 10.9,
        output_tokens: 5,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 2,
      })
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheWriteTokens: 3,
      cacheReadTokens: 2,
    });
  });
});
