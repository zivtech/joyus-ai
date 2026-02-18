import { describe, it, expect } from 'vitest';
import { handleGetSkills } from '../../../src/mcp/tools/get-skills.js';

describe('handleGetSkills', () => {
  const ctx = {
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test-session',
    auditDir: '/tmp/audit-skills-test',
  };

  it('returns empty skills when no mappings configured', () => {
    const result = handleGetSkills({}, ctx);
    expect(result.activeSkills).toEqual([]);
    expect(result.conflictsResolved).toEqual([]);
    expect(result.skillContext).toBe('');
  });

  it('returns empty skills for file with no matching patterns', () => {
    const result = handleGetSkills({ filePath: 'src/random.xyz' }, ctx);
    expect(result.activeSkills).toEqual([]);
  });

  it('returns correct response shape', () => {
    const result = handleGetSkills({}, ctx);
    expect(result).toHaveProperty('activeSkills');
    expect(result).toHaveProperty('conflictsResolved');
    expect(result).toHaveProperty('skillContext');
    expect(Array.isArray(result.activeSkills)).toBe(true);
    expect(Array.isArray(result.conflictsResolved)).toBe(true);
    expect(typeof result.skillContext).toBe('string');
  });
});
