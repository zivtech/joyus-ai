import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { onBranchSwitch } from '../../../src/enforcement/events/branch-switch.js';
import { listAuditFiles, readEntries } from '../../../src/enforcement/audit/writer.js';
import { EnforcementConfigSchema } from '../../../src/enforcement/schemas.js';
import { mergeConfig } from '../../../src/enforcement/config.js';
import type { DeveloperConfig } from '../../../src/enforcement/types.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeConfig(overrides?: Record<string, unknown>) {
  const project = EnforcementConfigSchema.parse(overrides ?? {});
  const dev: DeveloperConfig = { tier: 'tier-2', gateOverrides: {}, skillOverrides: {} };
  return mergeConfig(project, dev);
}

describe('onBranchSwitch', () => {
  let auditDir: string;
  const ctx = () => ({
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test',
    auditDir,
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `event-branch-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('detects no changes when config is identical', () => {
    const config = makeConfig();
    const result = onBranchSwitch('feature/new-branch', config, ctx());
    expect(result.reloaded).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.newBranch).toBe('feature/new-branch');
  });

  it('creates audit entry with config-reload type', () => {
    const config = makeConfig();
    onBranchSwitch('main', config, ctx());
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('config-reload');
    expect(entries[0].branchName).toBe('main');
  });

  it('returns naming validity', () => {
    const config = makeConfig();
    const result = onBranchSwitch('feature/test', config, ctx());
    expect(typeof result.namingValid).toBe('boolean');
  });

  it('returns auditEntryId', () => {
    const config = makeConfig();
    const result = onBranchSwitch('main', config, ctx());
    expect(result.auditEntryId).toBeTruthy();
    expect(typeof result.auditEntryId).toBe('string');
  });

  it('returns correct shape', () => {
    const config = makeConfig();
    const result = onBranchSwitch('main', config, ctx());
    expect(result).toHaveProperty('reloaded');
    expect(result).toHaveProperty('newBranch');
    expect(result).toHaveProperty('namingValid');
    expect(result).toHaveProperty('changes');
    expect(result).toHaveProperty('auditEntryId');
  });
});
