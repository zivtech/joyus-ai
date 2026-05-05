/**
 * Unit tests for local development auth bypass gating
 */

import { describe, expect, it } from 'vitest';

import { isDevAuthBypassEnabled } from '../../src/auth/dev-bypass.js';

describe('isDevAuthBypassEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(isDevAuthBypassEnabled({})).toBe(false);
  });

  it('is enabled for non-production environments when explicitly requested', () => {
    expect(isDevAuthBypassEnabled({ ENABLE_DEV_AUTH_BYPASS: 'true', NODE_ENV: 'development' })).toBe(true);
    expect(isDevAuthBypassEnabled({ ENABLE_DEV_AUTH_BYPASS: 'true', NODE_ENV: undefined })).toBe(true);
  });

  it('is disabled in production even when explicitly requested', () => {
    expect(isDevAuthBypassEnabled({ ENABLE_DEV_AUTH_BYPASS: 'true', NODE_ENV: 'production' })).toBe(false);
  });
});
