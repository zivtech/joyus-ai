import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleVerifyBranch } from '../../../src/mcp/tools/verify-branch.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listAuditFiles } from '../../../src/enforcement/audit/writer.js';

describe('handleVerifyBranch', () => {
  let auditDir: string;
  const ctx = () => ({
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test-session',
    auditDir,
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `mcp-verify-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('returns match true when no expected branch', () => {
    const result = handleVerifyBranch({ operation: 'commit' }, ctx());
    expect(result.match).toBe(true);
    expect(result.enforcement).toBe('none');
    expect(result.currentBranch).toBeTruthy();
    expect(result.expectedBranch).toBeNull();
  });

  it('creates audit entry', () => {
    handleVerifyBranch({ operation: 'push' }, ctx());
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
  });

  it('returns auditEntryId', () => {
    const result = handleVerifyBranch({ operation: 'merge' }, ctx());
    expect(result.auditEntryId).toBeTruthy();
    expect(typeof result.auditEntryId).toBe('string');
  });

  it('includes naming validity', () => {
    const result = handleVerifyBranch({ operation: 'commit' }, ctx());
    expect(typeof result.namingValid).toBe('boolean');
  });

  it('returns correct shape', () => {
    const result = handleVerifyBranch({ operation: 'commit' }, ctx());
    expect(result).toHaveProperty('currentBranch');
    expect(result).toHaveProperty('expectedBranch');
    expect(result).toHaveProperty('match');
    expect(result).toHaveProperty('enforcement');
    expect(result).toHaveProperty('namingValid');
    expect(result).toHaveProperty('suggestedName');
    expect(result).toHaveProperty('auditEntryId');
  });
});
