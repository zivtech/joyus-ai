import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAndFallback, loadProjectConfig, mergeConfig } from '../../src/enforcement/config.js';
import { EnforcementConfigSchema } from '../../src/enforcement/schemas.js';
import type { EnforcementConfig, DeveloperConfig } from '../../src/enforcement/types.js';

function tmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProjectConfig(projectRoot: string, config: Record<string, unknown>): void {
  const configDir = join(projectRoot, '.joyus-ai');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ enforcement: config }), 'utf-8');
}

describe('Integration: Config Validation Edge Cases', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = tmpDir('config-test');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('missing config file: no .joyus-ai/config.json -> safe defaults returned', () => {
    const result = loadProjectConfig(projectRoot);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.config.gates).toEqual([]);
    expect(result.config.branchRules.staleDays).toBe(14);
  });

  it('empty config: {} -> defaults applied', () => {
    writeProjectConfig(projectRoot, {});
    const result = loadProjectConfig(projectRoot);
    expect(result.valid).toBe(true);
    expect(result.config.gates).toEqual([]);
    expect(result.config.branchRules.maxActiveBranches).toBe(10);
  });

  it('invalid gate config: timeout is string -> warning, default used', () => {
    const result = validateAndFallback(
      { gates: [{ id: 'lint', name: 'lint', type: 'lint', command: 'echo ok', triggerPoints: ['pre-commit'], timeout: 'bad' }] },
      EnforcementConfigSchema,
      'Test config',
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    // Falls back to safe defaults (empty gates)
    expect(result.config.gates).toEqual([]);
  });

  it('invalid regex in naming convention: bad regex -> naming check skipped', async () => {
    const config = EnforcementConfigSchema.parse({
      branchRules: { namingConvention: '[invalid-regex(' },
    });
    const { checkBranchNaming } = await import('../../src/enforcement/git/branch-hygiene.js');
    const result = checkBranchNaming('my-branch', config.branchRules);
    // Invalid regex should not block
    expect(result.valid).toBe(true);
  });

  it('conflicting overrides: developer overrides mandatory gate -> override rejected', () => {
    const project: EnforcementConfig = EnforcementConfigSchema.parse({
      gates: [{
        id: 'security-scan', name: 'Security Scan', type: 'custom',
        command: 'echo scan', triggerPoints: ['pre-commit'],
      }],
      enforcementPolicy: { mandatoryGates: ['security-scan'] },
    });

    const developer: DeveloperConfig = {
      tier: 'tier-2',
      gateOverrides: { 'security-scan': 'skip' },
      skillOverrides: {},
    };

    const merged = mergeConfig(project, developer);
    // Mandatory gate override should be rejected
    const rejected = merged.overridesApplied.find(
      (o) => o.field === 'gate:security-scan' && !o.applied,
    );
    expect(rejected).toBeTruthy();
    expect(rejected!.reason).toContain('mandatory');
    // Gate should keep original tier
    expect(merged.gates[0].defaultTier).toBe('always-run');
  });

  it('unknown gate type: invalid type -> warning, fallback to defaults', () => {
    const result = validateAndFallback(
      { gates: [{ id: 'lint', name: 'lint', type: 'unknown', command: 'echo ok', triggerPoints: ['pre-commit'] }] },
      EnforcementConfigSchema,
      'Test config',
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes('type'))).toBe(true);
  });

  it('negative timeout: timeout=-1 -> warning, default used', () => {
    const result = validateAndFallback(
      { gates: [{ id: 'lint', name: 'lint', type: 'lint', command: 'echo ok', triggerPoints: ['pre-commit'], timeout: -1 }] },
      EnforcementConfigSchema,
      'Test config',
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('missing required fields: gate without command -> warning, gate skipped', () => {
    const result = validateAndFallback(
      { gates: [{ id: 'lint', name: 'lint', type: 'lint', triggerPoints: ['pre-commit'] }] },
      EnforcementConfigSchema,
      'Test config',
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    // Falls back to defaults (no gates)
    expect(result.config.gates).toEqual([]);
  });

  it('config inheritance: project + developer merge correctly with policy', () => {
    const project: EnforcementConfig = EnforcementConfigSchema.parse({
      gates: [
        { id: 'lint', name: 'lint', type: 'lint', command: 'echo lint', triggerPoints: ['pre-commit'] },
        { id: 'test', name: 'test', type: 'test', command: 'echo test', triggerPoints: ['pre-commit'] },
      ],
      skillMappings: [
        { id: 'map1', filePatterns: ['*.module'], skills: ['drupal-security', 'drupal-coding'] },
      ],
      enforcementPolicy: {
        mandatoryGates: ['lint'],
        mandatorySkills: ['drupal-security'],
        tierOverridable: true,
      },
    });

    const developer: DeveloperConfig = {
      tier: 'tier-1',
      gateOverrides: { lint: 'skip', test: 'skip' },
      skillOverrides: { 'drupal-security': 'disabled', 'drupal-coding': 'disabled' },
    };

    const merged = mergeConfig(project, developer);

    // Tier override should be applied since tierOverridable is true
    expect(merged.resolvedTier).toBe('tier-1');

    // lint is mandatory -> override rejected
    expect(merged.gates[0].defaultTier).toBe('always-run');
    // test is not mandatory -> override applied
    expect(merged.gates[1].defaultTier).toBe('skip');

    // drupal-security is mandatory skill -> override rejected, still in mapping
    expect(merged.skillMappings[0].skills).toContain('drupal-security');
    // drupal-coding is not mandatory -> override applied, removed from mapping
    expect(merged.skillMappings[0].skills).not.toContain('drupal-coding');

    // Verify override log entries
    const rejectedGate = merged.overridesApplied.find((o) => o.field === 'gate:lint');
    expect(rejectedGate?.applied).toBe(false);

    const appliedGate = merged.overridesApplied.find((o) => o.field === 'gate:test');
    expect(appliedGate?.applied).toBe(true);

    const rejectedSkill = merged.overridesApplied.find((o) => o.field === 'skill:drupal-security');
    expect(rejectedSkill?.applied).toBe(false);

    const appliedSkill = merged.overridesApplied.find((o) => o.field === 'skill:drupal-coding');
    expect(appliedSkill?.applied).toBe(true);
  });
});
