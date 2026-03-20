import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkForcePush,
  checkUncommittedChanges,
  auditForcePush,
  auditUncommitted,
  auditNamingViolation,
  auditBranchHygiene,
} from '../../../src/enforcement/git/guardrails.js';
import { AuditWriter } from '../../../src/enforcement/audit/writer.js';
import { listAuditFiles, readEntries } from '../../../src/enforcement/audit/writer.js';
import type { BranchRule } from '../../../src/enforcement/types.js';

const defaultRules: BranchRule = {
  staleDays: 14,
  maxActiveBranches: 10,
  protectedBranches: ['main', 'master'],
};

describe('checkForcePush', () => {
  it('returns none when no force flag', () => {
    const result = checkForcePush(['origin', 'main'], 'main', defaultRules);
    expect(result.warning).toBe('none');
  });

  it('returns critical for --force on protected branch', () => {
    const result = checkForcePush(['--force', 'origin', 'main'], 'main', defaultRules);
    expect(result.warning).toBe('critical');
    expect(result.isProtectedBranch).toBe(true);
    expect(result.message).toContain('protected branch');
  });

  it('returns critical for -f on protected branch', () => {
    const result = checkForcePush(['-f', 'origin', 'master'], 'master', defaultRules);
    expect(result.warning).toBe('critical');
  });

  it('returns caution for force on non-protected branch', () => {
    const result = checkForcePush(['--force'], 'feature/my-branch', defaultRules);
    expect(result.warning).toBe('caution');
    expect(result.isProtectedBranch).toBe(false);
  });

  it('detects --force-with-lease', () => {
    const result = checkForcePush(['--force-with-lease'], 'feature/x', defaultRules);
    expect(result.warning).toBe('caution');
  });
});

describe('checkUncommittedChanges', () => {
  it('runs without error in current directory', async () => {
    const result = await checkUncommittedChanges();
    expect(typeof result.hasChanges).toBe('boolean');
    expect(typeof result.modified).toBe('number');
    expect(typeof result.untracked).toBe('number');
    expect(typeof result.summary).toBe('string');
  });

  it('handles non-git directory', async () => {
    const result = await checkUncommittedChanges('/tmp');
    expect(result.hasChanges).toBe(false);
  });
});

describe('audit helpers', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = join(tmpdir(), `guardrails-audit-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  const auditConfig = {
    sessionId: 'test',
    userTier: 'tier-2' as const,
    activeSkills: [],
    branchName: 'feature/test',
  };

  it('writes force-push-warning audit entry', () => {
    const writer = new AuditWriter(auditDir);
    auditForcePush(
      { warning: 'critical', message: 'test', isProtectedBranch: true },
      writer,
      auditConfig,
    );
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('force-push-warning');
    expect(entries[0].result).toBe('fail');
  });

  it('writes uncommitted-warning audit entry', () => {
    const writer = new AuditWriter(auditDir);
    auditUncommitted(
      { hasChanges: true, modified: 2, untracked: 1, deleted: 0, summary: '2 modified, 1 untracked' },
      writer,
      auditConfig,
    );
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('uncommitted-warning');
    expect(entries[0].result).toBe('fail');
  });

  it('writes naming-violation audit entry', () => {
    const writer = new AuditWriter(auditDir);
    auditNamingViolation(
      { valid: false, branchName: 'bad-name', suggestedName: 'feature/bad-name' },
      writer,
      auditConfig,
    );
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('naming-violation');
  });

  it('writes branch-hygiene audit entry', () => {
    const writer = new AuditWriter(auditDir);
    auditBranchHygiene(
      [{ name: 'old-branch', lastModified: '2025-01-01', daysSinceModified: 400 }],
      { count: 15, limit: 10, overLimit: true },
      writer,
      auditConfig,
    );
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('branch-hygiene');
    expect(entries[0].result).toBe('fail');
  });
});
