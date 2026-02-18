import { describe, it, expect } from 'vitest';
import { handleCheckHygiene } from '../../../src/mcp/tools/check-hygiene.js';

describe('handleCheckHygiene', () => {
  const ctx = {
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test-session',
    auditDir: '/tmp/audit-hygiene-test',
  };

  it('returns hygiene report with required fields', () => {
    const result = handleCheckHygiene(ctx);
    expect(Array.isArray(result.staleBranches)).toBe(true);
    expect(typeof result.activeBranchCount).toBe('number');
    expect(typeof result.branchLimit).toBe('number');
    expect(typeof result.overLimit).toBe('boolean');
    expect(typeof result.staleDaysThreshold).toBe('number');
  });

  it('returns default config values', () => {
    const result = handleCheckHygiene(ctx);
    expect(result.branchLimit).toBe(10);
    expect(result.staleDaysThreshold).toBe(14);
  });

  it('returns non-negative branch count', () => {
    const result = handleCheckHygiene(ctx);
    expect(result.activeBranchCount).toBeGreaterThanOrEqual(0);
  });
});
