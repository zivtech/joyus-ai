import { describe, it, expect } from 'vitest';
import {
  EnforcementConfigSchema,
  DeveloperConfigSchema,
  QualityGateSchema,
  SkillMappingSchema,
  BranchRuleSchema,
  AuditEntrySchema,
  CorrectionSchema,
  EnforcementPolicySchema,
} from '../../../src/enforcement/schemas.js';

describe('QualityGateSchema', () => {
  it('validates a complete gate config', () => {
    const gate = QualityGateSchema.parse({
      id: 'lint-eslint',
      name: 'ESLint Linting',
      type: 'lint',
      command: 'npx eslint .',
      triggerPoints: ['pre-push'],
    });
    expect(gate.id).toBe('lint-eslint');
    expect(gate.timeout).toBe(60);
    expect(gate.defaultTier).toBe('always-run');
    expect(gate.order).toBe(0);
  });

  it('rejects gate with missing required fields', () => {
    expect(() => QualityGateSchema.parse({ id: 'x' })).toThrow();
  });

  it('rejects invalid gate type', () => {
    expect(() =>
      QualityGateSchema.parse({
        id: 'x',
        name: 'x',
        type: 'invalid',
        command: 'x',
        triggerPoints: ['pre-commit'],
      }),
    ).toThrow();
  });
});

describe('SkillMappingSchema', () => {
  it('validates a skill mapping with defaults', () => {
    const mapping = SkillMappingSchema.parse({
      id: 'drupal-modules',
      filePatterns: ['*.module', '*.install'],
      skills: ['drupal-coding-standards'],
    });
    expect(mapping.precedence).toBe('platform-default');
  });
});

describe('BranchRuleSchema', () => {
  it('provides sensible defaults', () => {
    const rules = BranchRuleSchema.parse({});
    expect(rules.staleDays).toBe(14);
    expect(rules.maxActiveBranches).toBe(10);
    expect(rules.protectedBranches).toEqual(['main', 'master']);
  });
});

describe('EnforcementPolicySchema', () => {
  it('defaults to empty mandatory lists and non-overridable tier', () => {
    const policy = EnforcementPolicySchema.parse({});
    expect(policy.mandatoryGates).toEqual([]);
    expect(policy.mandatorySkills).toEqual([]);
    expect(policy.tierOverridable).toBe(false);
  });
});

describe('EnforcementConfigSchema', () => {
  it('provides safe defaults for empty config', () => {
    const config = EnforcementConfigSchema.parse({});
    expect(config.gates).toEqual([]);
    expect(config.skillMappings).toEqual([]);
    expect(config.branchRules.staleDays).toBe(14);
    expect(config.enforcementPolicy.mandatoryGates).toEqual([]);
  });

  it('validates a full project config', () => {
    const config = EnforcementConfigSchema.parse({
      gates: [
        {
          id: 'lint-eslint',
          name: 'ESLint',
          type: 'lint',
          command: 'npx eslint .',
          triggerPoints: ['pre-push'],
        },
      ],
      skillMappings: [
        {
          id: 'drupal',
          filePatterns: ['*.module'],
          skills: ['drupal-coding-standards'],
        },
      ],
      branchRules: { staleDays: 7 },
      enforcementPolicy: { mandatoryGates: ['lint-eslint'] },
    });
    expect(config.gates).toHaveLength(1);
    expect(config.branchRules.staleDays).toBe(7);
    expect(config.enforcementPolicy.mandatoryGates).toEqual(['lint-eslint']);
  });
});

describe('DeveloperConfigSchema', () => {
  it('defaults to tier-2 with no overrides', () => {
    const config = DeveloperConfigSchema.parse({});
    expect(config.tier).toBe('tier-2');
    expect(config.gateOverrides).toEqual({});
    expect(config.skillOverrides).toEqual({});
  });

  it('validates tier and overrides', () => {
    const config = DeveloperConfigSchema.parse({
      tier: 'tier-1',
      gateOverrides: { 'lint-eslint': 'skip' },
      skillOverrides: { 'drupal-security': 'disabled' },
    });
    expect(config.tier).toBe('tier-1');
    expect(config.gateOverrides['lint-eslint']).toBe('skip');
  });
});

describe('AuditEntrySchema', () => {
  it('validates a complete audit entry', () => {
    const entry = AuditEntrySchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2026-02-17T15:00:00Z',
      sessionId: 'session-123',
      actionType: 'gate-execution',
      result: 'pass',
      userTier: 'tier-2',
      activeSkills: ['drupal-coding-standards'],
      gateId: 'lint-eslint',
    });
    expect(entry.actionType).toBe('gate-execution');
    expect(entry.details).toEqual({});
  });
});

describe('CorrectionSchema', () => {
  it('validates a correction entry', () => {
    const correction = CorrectionSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440001',
      timestamp: '2026-02-17T16:00:00Z',
      sessionId: 'session-123',
      skillId: 'drupal-security',
      originalOutput: 'db_query("SELECT * FROM users WHERE id = $id")',
      correctedOutput: '\\Drupal::database()->select("users")->condition("id", $id)->execute()',
    });
    expect(correction.skillId).toBe('drupal-security');
  });
});
