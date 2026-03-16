/**
 * Retry utilities — exponential backoff with jitter cap.
 *
 * Pure functions that compute delays and decide whether to retry a failed step.
 */

import type { RetryPolicy, StepError } from '../types.js';

/**
 * Compute the delay for a given retry attempt using exponential backoff,
 * capped at the policy's maxDelayMs.
 */
export function computeRetryDelay(attempt: number, policy: RetryPolicy): number {
  return Math.min(
    policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt),
    policy.maxDelayMs,
  );
}

/**
 * Decide whether to retry based on error transience and remaining budget.
 */
export function shouldRetry(
  error: StepError,
  currentAttempt: number,
  policy: RetryPolicy,
): { retry: boolean; delayMs?: number } {
  if (!error.isTransient) return { retry: false };
  if (currentAttempt >= policy.maxRetries) return { retry: false };
  return { retry: true, delayMs: computeRetryDelay(currentAttempt, policy) };
}

/**
 * Wait for the specified delay before retrying.
 */
export function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
