import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyBranch, getCurrentBranch, auditBranchVerify } from '../../../src/enforcement/git/branch-verify.js';
import { AuditWriter } from '../../../src/enforcement/audit/writer.js';
import { listAuditFiles, readEntries } from '../../../src/enforcement/audit/writer.js';

describe('verifyBranch', () => {
  it('returns match when expectedBranch is null', () => {
    const result = verifyBranch({
      currentBranch: 'feature/anything',
      expectedBranch: null,
      operation: 'commit',
      userTier: 'tier-2',
    });
    expect(result.match).toBe(true);
    expect(result.enforcement).toBe('none');
  });

  it('returns match when branches are equal', () => {
    const result = verifyBranch({
      currentBranch: 'feature/PROJ-42',
      expectedBranch: 'feature/PROJ-42',
      operation: 'commit',
      userTier: 'tier-2',
    });
    expect(result.match).toBe(true);
    expect(result.enforcement).toBe('none');
  });

  it('returns block for tier-1 on mismatch', () => {
    const result = verifyBranch({
      currentBranch: 'main',
      expectedBranch: 'feature/PROJ-42',
      operation: 'commit',
      userTier: 'tier-1',
    });
    expect(result.match).toBe(false);
    expect(result.enforcement).toBe('block');
  });

  it('returns warn for tier-2 on mismatch', () => {
    const result = verifyBranch({
      currentBranch: 'main',
      expectedBranch: 'feature/PROJ-42',
      operation: 'push',
      userTier: 'tier-2',
    });
    expect(result.match).toBe(false);
    expect(result.enforcement).toBe('warn');
  });

  it('returns block for tier-3 on mismatch', () => {
    const result = verifyBranch({
      currentBranch: 'main',
      expectedBranch: 'feature/PROJ-42',
      operation: 'merge',
      userTier: 'tier-3',
    });
    expect(result.match).toBe(false);
    expect(result.enforcement).toBe('block');
  });
});

describe('getCurrentBranch', () => {
  it('returns a branch name in the current repo', async () => {
    const branch = await getCurrentBranch();
    expect(branch).toBeTruthy();
    expect(typeof branch).toBe('string');
  });

  it('returns HEAD for non-git directory', async () => {
    const branch = await getCurrentBranch('/tmp');
    expect(branch).toBe('HEAD');
  });
});

describe('auditBranchVerify', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = join(tmpdir(), `git-audit-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('writes branch-verify entry on match', () => {
    const writer = new AuditWriter(auditDir);
    auditBranchVerify(
      { match: true, enforcement: 'none', currentBranch: 'feature/x', expectedBranch: 'feature/x' },
      writer,
      { sessionId: 'test', userTier: 'tier-2', activeSkills: [] },
    );
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('branch-verify');
    expect(entries[0].result).toBe('pass');
  });

  it('writes branch-mismatch entry on mismatch', () => {
    const writer = new AuditWriter(auditDir);
    auditBranchVerify(
      { match: false, enforcement: 'block', currentBranch: 'main', expectedBranch: 'feature/x' },
      writer,
      { sessionId: 'test', userTier: 'tier-1', activeSkills: [] },
    );
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('branch-mismatch');
    expect(entries[0].result).toBe('fail');
  });
});
