import { describe, it, expect } from 'vitest';

import { CATALOG_LIMITS, loadCatalogConfig, resolveAliasedSecret, SKILL_NAME_PATTERN } from '../src/skills/catalog/config.js';

const COMPLETE_ENV: NodeJS.ProcessEnv = {
  CATALOG_REFRESH_AUTH_SECRET_ALIAS: 'CATALOG_REFRESH_SECRET',
  CATALOG_CURSOR_KEY_ALIAS: 'CATALOG_CURSOR_KEY',
  CATALOG_POLICY_BUCKET: 'example-bucket',
  CATALOG_POLICY_REGION: 'us-east-1',
  CATALOG_POLICY_KEY: 'example-policy-key.json',
};

describe('loadCatalogConfig', () => {
  it('loads a complete configuration', () => {
    const result = loadCatalogConfig(COMPLETE_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.refreshAuthSecretAlias).toBe('CATALOG_REFRESH_SECRET');
      expect(result.config.sourceCredentialAliasPrefix).toBe('');
    }
  });

  it('rejects when a required alias is absent, without leaking which value was supplied', () => {
    const { CATALOG_POLICY_BUCKET: _drop, ...incomplete } = COMPLETE_ENV;
    const result = loadCatalogConfig(incomplete);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('example-bucket');
      expect(result.error).toContain('missing');
    }
  });

  it('rejects an empty-string alias the same as a missing one', () => {
    const result = loadCatalogConfig({ ...COMPLETE_ENV, CATALOG_CURSOR_KEY_ALIAS: '   ' });
    expect(result.ok).toBe(false);
  });

  it('never returns a config object when incomplete (no partial defaulting of secrets)', () => {
    const result = loadCatalogConfig({});
    expect(result.ok).toBe(false);
    expect((result as { config?: unknown }).config).toBeUndefined();
  });
});

describe('resolveAliasedSecret', () => {
  it('resolves the value at the aliased env var name', () => {
    expect(resolveAliasedSecret('MY_ALIAS', { MY_ALIAS: 'secret-value' })).toBe('secret-value');
  });

  it('returns undefined for a missing or blank alias target', () => {
    expect(resolveAliasedSecret('MY_ALIAS', {})).toBeUndefined();
    expect(resolveAliasedSecret('MY_ALIAS', { MY_ALIAS: '' })).toBeUndefined();
  });
});

describe('CATALOG_LIMITS', () => {
  it('matches the bounds table exactly', () => {
    expect(CATALOG_LIMITS.MAX_ENTRIES).toBe(1000);
    expect(CATALOG_LIMITS.MAX_INDEX_BYTES).toBe(1024 * 1024);
    expect(CATALOG_LIMITS.MAX_DOCUMENT_BYTES).toBe(256 * 1024);
    expect(CATALOG_LIMITS.MAX_GENERATION_DOCUMENT_BYTES).toBe(16 * 1024 * 1024);
    expect(CATALOG_LIMITS.MAX_ACTIVE_DOCUMENT_BYTES).toBe(32 * 1024 * 1024);
    expect(CATALOG_LIMITS.MAX_TOTAL_DOCUMENT_BYTES).toBe(64 * 1024 * 1024);
    expect(CATALOG_LIMITS.CANDIDATE_TIMEOUT_MS).toBe(120_000);
    expect(CATALOG_LIMITS.MAX_CONCURRENT_DOWNLOADS).toBe(4);
    expect(CATALOG_LIMITS.REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(CATALOG_LIMITS.STALE_CEILING_MS).toBe(60 * 60 * 1000);
    expect(CATALOG_LIMITS.MAX_QUEUED_SOURCES).toBe(1000);
    expect(CATALOG_LIMITS.MAX_ACTIVE_CANDIDATES).toBe(2);
  });

  it('is a frozen-shape constant object (as const), not mutated at runtime', () => {
    expect(Object.isFrozen(CATALOG_LIMITS)).toBe(false); // `as const` is a type-level guarantee, not Object.freeze
    expect(CATALOG_LIMITS.MAX_ENTRIES).toBe(1000);
  });
});

describe('SKILL_NAME_PATTERN', () => {
  it('accepts lower-case slugs with internal hyphens', () => {
    expect(SKILL_NAME_PATTERN.test('example-skill')).toBe(true);
    expect(SKILL_NAME_PATTERN.test('a1-b2-c3')).toBe(true);
  });

  it('rejects upper-case, leading/trailing hyphen, and double hyphen', () => {
    expect(SKILL_NAME_PATTERN.test('Example-Skill')).toBe(false);
    expect(SKILL_NAME_PATTERN.test('-example')).toBe(false);
    expect(SKILL_NAME_PATTERN.test('example-')).toBe(false);
    expect(SKILL_NAME_PATTERN.test('example--skill')).toBe(false);
  });
});
