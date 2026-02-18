import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillCache } from '../../../src/enforcement/skills/cache.js';
import type { SkillContent } from '../../../src/enforcement/skills/cache.js';

function makeContent(overrides: Partial<SkillContent> = {}): SkillContent {
  return {
    id: 'drupal-security',
    name: 'Drupal Security',
    constraints: 'Use parameterized queries.',
    antiPatterns: ['db_query('],
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SkillCache', () => {
  let cacheDir: string;
  let cache: SkillCache;

  beforeEach(() => {
    cacheDir = join(tmpdir(), `skill-cache-test-${Date.now()}`);
    cache = new SkillCache(cacheDir);
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('caches and retrieves a skill', () => {
    const content = makeContent();
    cache.cacheSkill('drupal-security', content);
    const result = cache.getCachedSkill('drupal-security');
    expect(result).toEqual(content);
  });

  it('returns null for uncached skill', () => {
    const result = cache.getCachedSkill('nonexistent');
    expect(result).toBeNull();
  });

  it('overwrites existing cache', () => {
    cache.cacheSkill('drupal-security', makeContent({ name: 'Old' }));
    cache.cacheSkill('drupal-security', makeContent({ name: 'New' }));
    const result = cache.getCachedSkill('drupal-security');
    expect(result!.name).toBe('New');
  });

  it('reports cache age', () => {
    cache.cacheSkill('drupal-security', makeContent());
    const age = cache.getCacheAge('drupal-security');
    expect(age).toBeLessThan(1000); // Should be near-instant
  });

  it('reports Infinity age for uncached skill', () => {
    expect(cache.getCacheAge('nonexistent')).toBe(Infinity);
  });

  it('checks freshness', () => {
    cache.cacheSkill('drupal-security', makeContent());
    expect(cache.isFresh('drupal-security', 60000)).toBe(true); // 60s threshold
    expect(cache.isFresh('nonexistent', 60000)).toBe(false);
  });
});
