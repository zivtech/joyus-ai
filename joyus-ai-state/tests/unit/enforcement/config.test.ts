import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateAndFallback, mergeConfig } from '../../../src/enforcement/config.js';
import { EnforcementConfigSchema, DeveloperConfigSchema } from '../../../src/enforcement/schemas.js';
import type { EnforcementConfig, DeveloperConfig } from '../../../src/enforcement/types.js';

describe('validateAndFallback', () => {
  it('returns valid result for correct config', () => {
    const result = validateAndFallback({}, EnforcementConfigSchema, 'test');
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.config.gates).toEqual([]);
  });

  it('returns safe defaults and warnings for invalid config', () => {
    const result = validateAndFallback(
      { gates: 'not-an-array' },
      EnforcementConfigSchema,
      'Project config',
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Project config');
    // Falls back to safe defaults
    expect(result.config.gates).toEqual([]);
  });

  it('returns safe defaults for developer config with invalid tier', () => {
    const result = validateAndFallback(
      { tier: 'invalid-tier' },
      DeveloperConfigSchema,
      'Developer config',
    );
    expect(result.valid).toBe(false);
    expect(result.config.tier).toBe('tier-2');
  });
});

describe('mergeConfig', () => {
  const baseProject: EnforcementConfig = {
    gates: [
      {
        id: 'lint-eslint',
        name: 'ESLint',
        type: 'lint',
        command: 'npx eslint .',
        triggerPoints: ['pre-push'],
        defaultTier: 'always-run',
        timeout: 60,
        order: 0,
      },
      {
        id: 'test-vitest',
        name: 'Vitest',
        type: 'test',
        command: 'npx vitest run',
        triggerPoints: ['pre-push'],
        defaultTier: 'always-run',
        timeout: 120,
        order: 1,
      },
    ],
    skillMappings: [
      {
        id: 'drupal',
        filePatterns: ['*.module'],
        skills: ['drupal-coding-standards', 'drupal-security'],
        precedence: 'core',
      },
    ],
    branchRules: {
      staleDays: 14,
      maxActiveBranches: 10,
      protectedBranches: ['main', 'master'],
    },
    enforcementPolicy: {
      mandatoryGates: ['lint-eslint'],
      mandatorySkills: ['drupal-security'],
      tierOverridable: false,
    },
  };

  const baseDeveloper: DeveloperConfig = {
    tier: 'tier-2',
    gateOverrides: {},
    skillOverrides: {},
  };

  it('returns project config with no overrides when developer config is default', () => {
    const merged = mergeConfig(baseProject, baseDeveloper);
    expect(merged.gates).toHaveLength(2);
    expect(merged.resolvedTier).toBe('tier-2');
    expect(merged.overridesApplied).toHaveLength(0);
  });

  it('blocks tier override when policy disallows it', () => {
    const merged = mergeConfig(baseProject, { ...baseDeveloper, tier: 'tier-1' });
    expect(merged.resolvedTier).toBe('tier-2');
    const tierOverride = merged.overridesApplied.find((o) => o.field === 'tier');
    expect(tierOverride).toBeDefined();
    expect(tierOverride!.applied).toBe(false);
    expect(tierOverride!.reason).toContain('not permitted');
  });

  it('allows tier override when policy permits it', () => {
    const permissiveProject = {
      ...baseProject,
      enforcementPolicy: { ...baseProject.enforcementPolicy, tierOverridable: true },
    };
    const merged = mergeConfig(permissiveProject, { ...baseDeveloper, tier: 'tier-1' });
    expect(merged.resolvedTier).toBe('tier-1');
    const tierOverride = merged.overridesApplied.find((o) => o.field === 'tier');
    expect(tierOverride!.applied).toBe(true);
  });

  it('blocks override of mandatory gates', () => {
    const developer: DeveloperConfig = {
      ...baseDeveloper,
      gateOverrides: { 'lint-eslint': 'skip' },
    };
    const merged = mergeConfig(baseProject, developer);
    const lintGate = merged.gates.find((g) => g.id === 'lint-eslint')!;
    expect(lintGate.defaultTier).toBe('always-run'); // Not overridden
    const gateOverride = merged.overridesApplied.find((o) => o.field === 'gate:lint-eslint');
    expect(gateOverride!.applied).toBe(false);
    expect(gateOverride!.reason).toContain('mandatory');
  });

  it('allows override of non-mandatory gates', () => {
    const developer: DeveloperConfig = {
      ...baseDeveloper,
      gateOverrides: { 'test-vitest': 'ask-me' },
    };
    const merged = mergeConfig(baseProject, developer);
    const testGate = merged.gates.find((g) => g.id === 'test-vitest')!;
    expect(testGate.defaultTier).toBe('ask-me');
    const gateOverride = merged.overridesApplied.find((o) => o.field === 'gate:test-vitest');
    expect(gateOverride!.applied).toBe(true);
  });

  it('blocks disabling mandatory skills', () => {
    const developer: DeveloperConfig = {
      ...baseDeveloper,
      skillOverrides: { 'drupal-security': 'disabled' },
    };
    const merged = mergeConfig(baseProject, developer);
    const drupalMapping = merged.skillMappings.find((m) => m.id === 'drupal')!;
    expect(drupalMapping.skills).toContain('drupal-security');
    const skillOverride = merged.overridesApplied.find((o) => o.field === 'skill:drupal-security');
    expect(skillOverride!.applied).toBe(false);
  });

  it('allows disabling non-mandatory skills', () => {
    const developer: DeveloperConfig = {
      ...baseDeveloper,
      skillOverrides: { 'drupal-coding-standards': 'disabled' },
    };
    const merged = mergeConfig(baseProject, developer);
    const drupalMapping = merged.skillMappings.find((m) => m.id === 'drupal')!;
    expect(drupalMapping.skills).not.toContain('drupal-coding-standards');
    expect(drupalMapping.skills).toContain('drupal-security');
  });
});
