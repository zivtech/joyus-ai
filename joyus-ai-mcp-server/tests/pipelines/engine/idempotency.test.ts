/**
 * Tests for idempotency key generation.
 */

import { describe, it, expect } from 'vitest';
import { computeIdempotencyKey } from '../../../src/pipelines/engine/idempotency.js';

describe('computeIdempotencyKey', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const key = computeIdempotencyKey('exec-1', 'step-1', 0);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same key for the same inputs', () => {
    const key1 = computeIdempotencyKey('exec-1', 'step-1', 0);
    const key2 = computeIdempotencyKey('exec-1', 'step-1', 0);
    expect(key1).toBe(key2);
  });

  it('produces different keys for different attempt numbers', () => {
    const key0 = computeIdempotencyKey('exec-1', 'step-1', 0);
    const key1 = computeIdempotencyKey('exec-1', 'step-1', 1);
    const key2 = computeIdempotencyKey('exec-1', 'step-1', 2);
    expect(key0).not.toBe(key1);
    expect(key1).not.toBe(key2);
    expect(key0).not.toBe(key2);
  });

  it('produces different keys for different execution IDs', () => {
    const keyA = computeIdempotencyKey('exec-a', 'step-1', 0);
    const keyB = computeIdempotencyKey('exec-b', 'step-1', 0);
    expect(keyA).not.toBe(keyB);
  });

  it('produces different keys for different step IDs', () => {
    const keyA = computeIdempotencyKey('exec-1', 'step-a', 0);
    const keyB = computeIdempotencyKey('exec-1', 'step-b', 0);
    expect(keyA).not.toBe(keyB);
  });
});
