import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleEnforcementStatus } from '../../../src/mcp/tools/enforcement-status.js';
import { disableEnforcement, enableEnforcement } from '../../../src/enforcement/kill-switch.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('handleEnforcementStatus', () => {
  let auditDir: string;
  const ctx = () => ({
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test-session',
    auditDir,
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `mcp-status-test-${Date.now()}`);
    enableEnforcement();
  });

  afterEach(() => {
    enableEnforcement();
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('returns active status', () => {
    const result = handleEnforcementStatus(ctx());
    expect(result.enforcementActive).toBe(true);
    expect(result.killSwitchEngagedAt).toBeNull();
  });

  it('returns inactive when kill switch engaged', () => {
    disableEnforcement('testing');
    const result = handleEnforcementStatus(ctx());
    expect(result.enforcementActive).toBe(false);
    expect(result.killSwitchEngagedAt).toBeTruthy();
  });

  it('returns config details', () => {
    const result = handleEnforcementStatus(ctx());
    expect(result.userTier).toBe('tier-2');
    expect(typeof result.configuredGates).toBe('number');
    expect(typeof result.skillMappings).toBe('number');
    expect(typeof result.auditStorageUsed).toBe('string');
    expect(typeof result.auditStorageWarning).toBe('boolean');
    expect(typeof result.companionServiceRunning).toBe('boolean');
    expect(typeof result.branchRulesConfigured).toBe('boolean');
  });

  it('returns correct shape', () => {
    const result = handleEnforcementStatus(ctx());
    expect(result).toHaveProperty('enforcementActive');
    expect(result).toHaveProperty('userTier');
    expect(result).toHaveProperty('configuredGates');
    expect(result).toHaveProperty('activeSkills');
    expect(result).toHaveProperty('skillMappings');
    expect(result).toHaveProperty('branchRulesConfigured');
    expect(result).toHaveProperty('auditStorageUsed');
    expect(result).toHaveProperty('auditStorageWarning');
    expect(result).toHaveProperty('companionServiceRunning');
    expect(result).toHaveProperty('killSwitchEngagedAt');
  });
});
