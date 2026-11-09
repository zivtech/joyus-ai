import { describe, it, expect } from 'vitest';

import {
  isSafeCredentialAlias,
  resolveSourceCredential,
  resolveSourceCredentialEnvName,
} from '../src/skills/catalog/source-credential.js';

describe('isSafeCredentialAlias', () => {
  it('accepts an uppercase-with-underscores alias', () => {
    expect(isSafeCredentialAlias('EXAMPLE_TENANT_TOKEN')).toBe(true);
  });

  it('rejects an alias that could traverse to another env var shape', () => {
    expect(isSafeCredentialAlias('../ESCAPE')).toBe(false);
    expect(isSafeCredentialAlias('has space')).toBe(false);
    expect(isSafeCredentialAlias('')).toBe(false);
    expect(isSafeCredentialAlias('1STARTS_WITH_DIGIT')).toBe(false);
  });

  it('rejects an alias beyond the configured maximum length', () => {
    expect(isSafeCredentialAlias('A'.repeat(65))).toBe(false);
    expect(isSafeCredentialAlias('A'.repeat(64))).toBe(true);
  });
});

describe('resolveSourceCredentialEnvName', () => {
  it('combines a configured prefix with a safe alias', () => {
    expect(
      resolveSourceCredentialEnvName({ aliasPrefix: 'CATALOG_SRC_', credentialAlias: 'EXAMPLE_TENANT' }),
    ).toBe('CATALOG_SRC_EXAMPLE_TENANT');
  });

  it('refuses to resolve without a configured, non-empty prefix (no bare-alias env access)', () => {
    expect(resolveSourceCredentialEnvName({ aliasPrefix: '', credentialAlias: 'EXAMPLE_TENANT' })).toBeUndefined();
    expect(resolveSourceCredentialEnvName({ aliasPrefix: '   ', credentialAlias: 'EXAMPLE_TENANT' })).toBeUndefined();
  });

  it('refuses an unsafe alias even with a configured prefix', () => {
    expect(
      resolveSourceCredentialEnvName({ aliasPrefix: 'CATALOG_SRC_', credentialAlias: 'bad alias' }),
    ).toBeUndefined();
  });
});

describe('resolveSourceCredential', () => {
  it('resolves the secret value at the combined prefix+alias env var, never the bare alias', () => {
    const env = { CATALOG_SRC_EXAMPLE_TENANT: 'secret-value', EXAMPLE_TENANT: 'wrong-value' };
    expect(
      resolveSourceCredential({ aliasPrefix: 'CATALOG_SRC_', credentialAlias: 'EXAMPLE_TENANT' }, env),
    ).toBe('secret-value');
  });

  it('cannot be used to read an unrelated secret outside the configured prefix', () => {
    const env = { AWS_SECRET_ACCESS_KEY: 'unrelated-secret' };
    expect(
      resolveSourceCredential({ aliasPrefix: 'CATALOG_SRC_', credentialAlias: 'AWS_SECRET_ACCESS_KEY' }, env),
    ).toBeUndefined();
  });

  it('returns undefined when no prefix is configured, regardless of alias', () => {
    const env = { EXAMPLE_TENANT: 'secret-value' };
    expect(resolveSourceCredential({ aliasPrefix: '', credentialAlias: 'EXAMPLE_TENANT' }, env)).toBeUndefined();
  });
});
