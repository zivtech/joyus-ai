import { describe, it, expect } from 'vitest';
import { resolveSkillPrecedence, getPrecedenceRank } from '../../../src/enforcement/skills/precedence.js';
import type { Skill } from '../../../src/enforcement/types.js';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'drupal-security',
    name: 'Drupal Security',
    source: 'auto-loaded',
    precedence: 'core',
    constraints: 'Use safe queries.',
    antiPatterns: [],
    loadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('resolveSkillPrecedence', () => {
  it('returns single skill unchanged', () => {
    const skills = [makeSkill()];
    const result = resolveSkillPrecedence(skills);
    expect(result.resolvedSkills).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns empty for no skills', () => {
    const result = resolveSkillPrecedence([]);
    expect(result.resolvedSkills).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('sorts by precedence (highest first)', () => {
    const skills = [
      makeSkill({ id: 'drupal-low', precedence: 'platform-default' }),
      makeSkill({ id: 'drupal-high', precedence: 'client-override' }),
      makeSkill({ id: 'drupal-mid', precedence: 'core' }),
    ];
    const result = resolveSkillPrecedence(skills);
    expect(result.resolvedSkills[0].id).toBe('drupal-high');
    expect(result.resolvedSkills[1].id).toBe('drupal-mid');
    expect(result.resolvedSkills[2].id).toBe('drupal-low');
  });

  it('detects conflicts in same domain', () => {
    const skills = [
      makeSkill({ id: 'drupal-security', precedence: 'client-override' }),
      makeSkill({ id: 'drupal-coding-standards', precedence: 'core' }),
    ];
    const result = resolveSkillPrecedence(skills);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].winner).toBe('drupal-security');
    expect(result.conflicts[0].loser).toBe('drupal-coding-standards');
  });

  it('includes all skills in resolved list (additive)', () => {
    const skills = [
      makeSkill({ id: 'drupal-security', precedence: 'client-override' }),
      makeSkill({ id: 'drupal-coding-standards', precedence: 'core' }),
    ];
    const result = resolveSkillPrecedence(skills);
    expect(result.resolvedSkills).toHaveLength(2);
  });

  it('no conflicts for different domains', () => {
    const skills = [
      makeSkill({ id: 'drupal-security', precedence: 'core' }),
      makeSkill({ id: 'js-best-practices', precedence: 'platform-default' }),
    ];
    const result = resolveSkillPrecedence(skills);
    expect(result.conflicts).toHaveLength(0);
  });

  it('is deterministic — same input different order produces same output', () => {
    const skills1 = [
      makeSkill({ id: 'drupal-a', precedence: 'core' }),
      makeSkill({ id: 'drupal-b', precedence: 'core' }),
    ];
    const skills2 = [
      makeSkill({ id: 'drupal-b', precedence: 'core' }),
      makeSkill({ id: 'drupal-a', precedence: 'core' }),
    ];
    const result1 = resolveSkillPrecedence(skills1);
    const result2 = resolveSkillPrecedence(skills2);
    expect(result1.resolvedSkills.map((s) => s.id)).toEqual(
      result2.resolvedSkills.map((s) => s.id),
    );
  });
});

describe('getPrecedenceRank', () => {
  it('ranks client-override highest', () => {
    expect(getPrecedenceRank('client-override')).toBe(4);
  });

  it('ranks platform-default lowest', () => {
    expect(getPrecedenceRank('platform-default')).toBe(1);
  });
});
