/**
 * Tests for retry utilities: computeRetryDelay, shouldRetry.
 */

import { describe, it, expect } from 'vitest';
import { computeRetryDelay, shouldRetry } from '../../../src/pipelines/engine/retry.js';
import type { RetryPolicy, StepError } from '../../../src/pipelines/types.js';
import { DEFAULT_RETRY_POLICY } from '../../../src/pipelines/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const policy: RetryPolicy = DEFAULT_RETRY_POLICY;
// policy = { maxRetries: 3, baseDelayMs: 30000, maxDelayMs: 300000, backoffMultiplier: 2 }

function makeTransientError(msg = 'timeout'): StepError {
  return { message: msg, type: 'TIMEOUT', isTransient: true, retryable: true };
}

function makeNonTransientError(msg = 'bad input'): StepError {
  return { message: msg, type: 'VALIDATION', isTransient: false, retryable: false };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeRetryDelay', () => {
  it('returns baseDelayMs * backoffMultiplier^attempt for attempt 0', () => {
    expect(computeRetryDelay(0, policy)).toBe(30_000); // 30000 * 2^0
  });

  it('doubles delay for each subsequent attempt', () => {
    expect(computeRetryDelay(1, policy)).toBe(60_000); // 30000 * 2^1
    expect(computeRetryDelay(2, policy)).toBe(120_000); // 30000 * 2^2
  });

  it('caps at maxDelayMs', () => {
    expect(computeRetryDelay(10, policy)).toBe(300_000); // would be 30000 * 1024 = 30,720,000
  });

  it('respects custom policy values', () => {
    const custom: RetryPolicy = {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 3,
    };
    expect(computeRetryDelay(0, custom)).toBe(1000);  // 1000 * 3^0
    expect(computeRetryDelay(1, custom)).toBe(3000);  // 1000 * 3^1
    expect(computeRetryDelay(2, custom)).toBe(5000);  // 1000 * 3^2 = 9000 → capped at 5000
  });
});

describe('shouldRetry', () => {
  it('returns false for non-transient errors', () => {
    const result = shouldRetry(makeNonTransientError(), 0, policy);
    expect(result.retry).toBe(false);
    expect(result.delayMs).toBeUndefined();
  });

  it('returns false when retries are exhausted', () => {
    const result = shouldRetry(makeTransientError(), policy.maxRetries, policy);
    expect(result.retry).toBe(false);
  });

  it('returns true with delay for transient error within budget', () => {
    const result = shouldRetry(makeTransientError(), 1, policy);
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBe(60_000); // computeRetryDelay(1, policy) = 30000 * 2^1
    expect(result.delayMs).toBe(computeRetryDelay(1, policy));
  });

  it('returns true on first attempt for transient error', () => {
    const result = shouldRetry(makeTransientError(), 0, policy);
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBe(30_000); // computeRetryDelay(0, policy)
  });
});
