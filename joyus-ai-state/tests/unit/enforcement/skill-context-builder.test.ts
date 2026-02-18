import { describe, it, expect } from 'vitest';
import { buildSkillContext, buildSkillSummary } from '../../../src/enforcement/skills/context-builder.js';
import type { Skill } from '../../../src/enforcement/types.js';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'drupal-security',
    name: 'Drupal Security',
    source: 'auto-loaded',
    precedence: 'core',
    constraints: 'Use parameterized queries for all database access.',
    antiPatterns: [],
    loadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildSkillContext', () => {
  it('returns empty string for no skills', () => {
    expect(buildSkillContext([])).toBe('');
  });

  it('formats a single skill', () => {
    const result = buildSkillContext([makeSkill()]);
    expect(result).toContain('## Drupal Security (precedence: core)');
    expect(result).toContain('parameterized queries');
  });

  it('sorts by precedence (highest first)', () => {
    const skills = [
      makeSkill({ id: 'low', name: 'Low', precedence: 'platform-default', constraints: 'Low rules' }),
      makeSkill({ id: 'high', name: 'High', precedence: 'client-override', constraints: 'High rules' }),
    ];
    const result = buildSkillContext(skills);
    const highPos = result.indexOf('High');
    const lowPos = result.indexOf('Low');
    expect(highPos).toBeLessThan(lowPos);
  });

  it('includes all skills', () => {
    const skills = [
      makeSkill({ id: 'a', name: 'Skill A', constraints: 'Rule A' }),
      makeSkill({ id: 'b', name: 'Skill B', constraints: 'Rule B' }),
    ];
    const result = buildSkillContext(skills);
    expect(result).toContain('Skill A');
    expect(result).toContain('Skill B');
    expect(result).toContain('Rule A');
    expect(result).toContain('Rule B');
  });
});

describe('buildSkillSummary', () => {
  it('returns summaries for all skills', () => {
    const skills = [
      makeSkill({ id: 'a', name: 'Skill A' }),
      makeSkill({ id: 'b', name: 'Skill B', cachedFrom: '2026-02-17T00:00:00Z' }),
    ];
    const result = buildSkillSummary(skills);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].cachedFrom).toBe('2026-02-17T00:00:00Z');
  });
});
